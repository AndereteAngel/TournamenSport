-- FEFUTIN: operación institucional de planteles sin dependencia de torneos.
-- Aditiva y conservadora: no borra clubes, jugadores, carnets ni historial.

begin;

alter table public.fefutin_club_roster_players
  add column if not exists removed_at timestamptz;

create index if not exists fefutin_club_roster_players_active_idx
  on public.fefutin_club_roster_players(roster_id, approval_status)
  where removed_at is null;

-- Devuelve una fila por club/categoría permanente. El UUID de club_tournament_id
-- se reutiliza como identificador de ficha para compatibilidad visual del componente;
-- no es una FK ni representa una participación deportiva.
create or replace function public.get_fefutin_my_permanent_rosters()
returns table (
  club_id uuid,
  club_name text,
  affiliate_number text,
  headquarters_address text,
  logo_path text,
  court_type text,
  referente_name text,
  referente_email text,
  referente_phone text,
  club_tournament_id uuid,
  tournament_id uuid,
  tournament_title text,
  category_label text,
  team_id uuid,
  team_status text,
  submitted_at timestamptz,
  players jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.role not in ('referente', 'admin', 'directivo') then
    raise exception 'No tenés permisos para consultar los planteles permanentes';
  end if;

  if v_profile.role = 'referente' and v_profile.club_id is null then
    raise exception 'Tu usuario todavía no tiene un club asociado';
  end if;

  return query
  select
    c.id,
    c.name,
    c.affiliate_number,
    c.headquarters_address,
    c.logo_path,
    c.court_type,
    p.username,
    p.email,
    c.referente_phone,
    cr.id,
    null::uuid,
    'PLANTEL PERMANENTE'::text,
    cr.category_label,
    null::uuid,
    'borrador'::text,
    null::timestamptz,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rp.id,
          'first_name', rp.first_name,
          'last_name', rp.last_name,
          'dni', rp.dni,
          'birth_date', rp.birth_date,
          'jersey_number', '',
          'photo_path', rp.photo_path,
          'approval_status', rp.approval_status,
          'registry_player_id', rp.registry_player_id,
          'carnet_number', fp.carnet_number,
          'carnet_status', case
            when fp.verification_status = 'no_habilitado' or fp.carnet_status = 'no_habilitado' then 'no_habilitado'
            when fp.verification_status = 'habilitado' or fp.carnet_status = 'habilitado' then 'habilitado'
            else coalesce(fp.verification_status, fp.carnet_status, 'pendiente')
          end,
          'sort_order', 0
        ) order by rp.last_name, rp.first_name, rp.created_at
      )
      from public.fefutin_club_roster_players rp
      left join public.fefutin_players fp on fp.id = rp.registry_player_id
      where rp.roster_id = cr.id
        and rp.removed_at is null
    ), '[]'::jsonb)
  from public.fefutin_club_rosters cr
  join public.fefutin_clubs c on c.id = cr.club_id
  join public.profiles p on p.id = c.referente_user_id
  where c.is_active = true
    and (v_profile.role in ('admin', 'directivo') or c.id = v_profile.club_id)
  order by c.name, cr.category_label;
end;
$function$;

revoke all on function public.get_fefutin_my_permanent_rosters() from public, anon;
grant execute on function public.get_fefutin_my_permanent_rosters() to authenticated;

-- Alta de una categoría permanente. No crea filas en fefutin_club_tournaments.
create or replace function public.create_fefutin_permanent_roster(p_category_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_roster_id uuid;
  v_category text := trim(coalesce(p_category_label, ''));
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'Solo un referente habilitado puede crear categorías';
  end if;

  if char_length(v_category) < 2 or char_length(v_category) > 80 then
    raise exception 'Ingresá un nombre de categoría válido';
  end if;

  if not exists (
    select 1 from public.fefutin_clubs c
    where c.id = v_profile.club_id
      and c.referente_user_id = auth.uid()
      and c.is_active = true
  ) then
    raise exception 'El club todavía no está habilitado';
  end if;

  insert into public.fefutin_club_rosters (club_id, category_label)
  values (v_profile.club_id, v_category)
  on conflict (club_id, category_label) do update
    set category_label = excluded.category_label
  returning id into v_roster_id;

  return v_roster_id;
end;
$function$;

revoke all on function public.create_fefutin_permanent_roster(text) from public, anon;
grant execute on function public.create_fefutin_permanent_roster(text) to authenticated;

-- Guarda el plantel institucional. No crea equipos ni inscripciones de torneo.
-- Los jugadores aprobados/rechazados no se sobrescriben ni se eliminan.
create or replace function public.save_fefutin_permanent_roster(
  p_roster_id uuid,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_roster public.fefutin_club_rosters%rowtype;
  v_item jsonb;
  v_player_id uuid;
  v_player_text text;
  v_first_name text;
  v_last_name text;
  v_dni text;
  v_dni_key text;
  v_birth_date date;
  v_photo_path text;
  v_registry_id uuid;
  v_registry_status text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'Solo un referente habilitado puede modificar el plantel';
  end if;

  select cr.* into v_roster
  from public.fefutin_club_rosters cr
  join public.fefutin_clubs c on c.id = cr.club_id
  where cr.id = p_roster_id
    and cr.club_id = v_profile.club_id
    and c.referente_user_id = auth.uid()
    and c.is_active = true
  for update of cr;

  if not found then
    raise exception 'La categoría no pertenece a tu club o todavía no está habilitada';
  end if;

  if coalesce(jsonb_typeof(p_players), '') <> 'array' then
    raise exception 'La lista de jugadores tiene un formato inválido';
  end if;
  if jsonb_array_length(p_players) > 40 then
    raise exception 'La categoría no puede superar los 40 jugadores';
  end if;

  for v_item in select value from jsonb_array_elements(p_players)
  loop
    v_first_name := coalesce(trim(v_item ->> 'first_name'), '');
    v_last_name := coalesce(trim(v_item ->> 'last_name'), '');
    v_dni := coalesce(trim(v_item ->> 'dni'), '');
    v_dni_key := nullif(regexp_replace(v_dni, '[^0-9]', '', 'g'), '');
    v_birth_date := nullif(trim(coalesce(v_item ->> 'birth_date', '')), '')::date;
    v_photo_path := nullif(trim(coalesce(v_item ->> 'photo_path', '')), '');
    v_player_text := coalesce(v_item ->> 'id', '');
    v_player_id := null;

    if v_player_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_player_id := v_player_text::uuid;
    end if;

    if v_player_id is not null then
      perform 1
      from public.fefutin_club_roster_players rp
      where rp.id = v_player_id
        and rp.roster_id = v_roster.id
        and rp.removed_at is null
      for update;

      if not found then
        v_player_id := null;
      end if;
    end if;

    if v_player_id is null and v_dni_key is not null then
      select rp.id into v_player_id
      from public.fefutin_club_roster_players rp
      where rp.roster_id = v_roster.id
        and rp.identity_key = v_dni_key
      for update;
    end if;

    if v_player_id is null then
      insert into public.fefutin_club_roster_players (
        roster_id, identity_key, first_name, last_name, dni,
        birth_date, photo_path, approval_status, removed_at
      )
      values (
        v_roster.id,
        coalesce(v_dni_key, 'sin-dni:' || gen_random_uuid()::text),
        v_first_name, v_last_name, v_dni, v_birth_date,
        v_photo_path, 'pendiente', null
      )
      returning id into v_player_id;
    else
      select rp.registry_player_id, fp.status
        into v_registry_id, v_registry_status
      from public.fefutin_club_roster_players rp
      left join public.fefutin_players fp on fp.id = rp.registry_player_id
      where rp.id = v_player_id
      for update of rp;

      if v_registry_id is null and v_dni_key is not null then
        select fp.id, fp.status
          into v_registry_id, v_registry_status
        from public.fefutin_players fp
        where regexp_replace(coalesce(fp.dni, ''), '[^0-9]', '', 'g') = v_dni_key
        order by (fp.dni = v_dni) desc, fp.created_at asc
        limit 1;
      end if;

      update public.fefutin_club_roster_players
      set first_name = case when approval_status = 'pendiente' then v_first_name else first_name end,
          last_name = case when approval_status = 'pendiente' then v_last_name else last_name end,
          dni = case when approval_status = 'pendiente' then v_dni else dni end,
          birth_date = case when approval_status = 'pendiente' then v_birth_date else birth_date end,
          photo_path = case when approval_status = 'pendiente' then coalesce(v_photo_path, photo_path) else photo_path end,
          registry_player_id = coalesce(registry_player_id, v_registry_id),
          approval_status = case
            when approval_status = 'pendiente' and v_registry_id is not null and v_registry_status = 'aprobado' then 'aprobado'
            else approval_status
          end,
          removed_at = null,
          updated_at = now()
      where id = v_player_id;
    end if;

    -- Si el DNI ya tiene un carnet FEFUTIN válido, vincularlo sin duplicar el jugador.
    if v_player_id is not null and v_dni_key is not null then
      select rp.registry_player_id, fp.status
        into v_registry_id, v_registry_status
      from public.fefutin_club_roster_players rp
      left join public.fefutin_players fp on fp.id = rp.registry_player_id
      where rp.id = v_player_id;

      if v_registry_id is null then
        select fp.id, fp.status
          into v_registry_id, v_registry_status
        from public.fefutin_players fp
        where regexp_replace(coalesce(fp.dni, ''), '[^0-9]', '', 'g') = v_dni_key
        order by fp.created_at asc
        limit 1;

        if v_registry_id is not null and v_registry_status = 'aprobado' then
          update public.fefutin_club_roster_players
          set registry_player_id = v_registry_id,
              approval_status = 'aprobado',
              updated_at = now()
          where id = v_player_id
            and approval_status = 'pendiente';
        end if;
      end if;
    end if;
  end loop;

  -- Retiro lógico de pendientes omitidos: se conservan sus datos y se pueden
  -- reactivar si el referente vuelve a incluirlos.
  update public.fefutin_club_roster_players rp
  set removed_at = now(), updated_at = now()
  where rp.roster_id = v_roster.id
    and rp.approval_status = 'pendiente'
    and rp.removed_at is null
    and not exists (
      select 1
      from jsonb_array_elements(p_players) item
      where item ->> 'id' = rp.id::text
         or (
           nullif(regexp_replace(coalesce(item ->> 'dni', ''), '[^0-9]', '', 'g'), '') is not null
           and nullif(regexp_replace(coalesce(item ->> 'dni', ''), '[^0-9]', '', 'g'), '') = rp.identity_key
         )
    );

  return v_roster.id;
end;
$function$;

revoke all on function public.save_fefutin_permanent_roster(uuid, jsonb) from public, anon;
grant execute on function public.save_fefutin_permanent_roster(uuid, jsonb) to authenticated;

-- Buzón general: una fila por jugador permanente, haya participado o no en torneos.
create or replace function public.get_fefutin_player_registry_overview()
returns table (
  player_entry_id uuid,
  team_id uuid,
  club_name text,
  tournament_title text,
  category_label text,
  first_name text,
  last_name text,
  dni text,
  birth_date date,
  jersey_number text,
  photo_path text,
  approval_status text,
  carnet_number text,
  carnet_status text,
  club_id uuid,
  tournament_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'No tenés permisos para revisar el registro de jugadores';
  end if;

  return query
  select
    rp.id,
    null::uuid,
    c.name,
    'PLANTEL PERMANENTE'::text,
    cr.category_label,
    rp.first_name,
    rp.last_name,
    rp.dni,
    rp.birth_date,
    ''::text,
    rp.photo_path,
    rp.approval_status,
    fp.carnet_number,
    case
      when fp.verification_status = 'no_habilitado' or fp.carnet_status = 'no_habilitado' then 'no_habilitado'
      when fp.verification_status = 'habilitado' or fp.carnet_status = 'habilitado' then 'habilitado'
      else coalesce(fp.verification_status, fp.carnet_status, 'pendiente')
    end,
    c.id,
    null::uuid
  from public.fefutin_club_roster_players rp
  join public.fefutin_club_rosters cr on cr.id = rp.roster_id
  join public.fefutin_clubs c on c.id = cr.club_id
  left join public.fefutin_players fp on fp.id = rp.registry_player_id
  where rp.removed_at is null
  order by c.name, cr.category_label, rp.last_name, rp.first_name;
end;
$function$;

revoke all on function public.get_fefutin_player_registry_overview() from public, anon;
grant execute on function public.get_fefutin_player_registry_overview() to authenticated;

-- Acepta el ID de inscripción de torneo (flujo histórico) o el ID del jugador
-- permanente (nuevo flujo). El carnet se crea una sola vez en fefutin_players.
create or replace function public.decide_fefutin_player(
  p_player_entry_id uuid,
  p_approve boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_roster_player public.fefutin_club_roster_players%rowtype;
  v_roster_player_id uuid;
  v_registry_id uuid;
  v_registry_status text;
  v_carnet text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'No tenés permisos para aprobar altas de jugadores';
  end if;

  select e.roster_player_id into v_roster_player_id
  from public.fefutin_roster_tournament_entries e
  join public.fefutin_teams ft on ft.club_tournament_id = e.club_tournament_id
  where e.id = p_player_entry_id
  for update of e;

  if v_roster_player_id is null then
    select rp.id into v_roster_player_id
    from public.fefutin_club_roster_players rp
    where rp.id = p_player_entry_id
      and rp.removed_at is null
    for update;
  end if;

  if v_roster_player_id is null then
    raise exception 'No se encontró el jugador del plantel permanente';
  end if;

  select rp.* into v_roster_player
  from public.fefutin_club_roster_players rp
  where rp.id = v_roster_player_id
  for update;

  if v_roster_player.approval_status <> 'pendiente' then
    raise exception 'Este jugador ya fue revisado';
  end if;

  if not p_approve then
    update public.fefutin_club_roster_players
    set approval_status = 'rechazado', updated_at = now()
    where id = v_roster_player.id;

    update public.fefutin_roster_tournament_entries
    set approval_status = 'rechazado'
    where roster_player_id = v_roster_player.id;

    return 'RECHAZADO';
  end if;

  if nullif(trim(v_roster_player.dni), '') is null
     or v_roster_player.birth_date is null
     or nullif(trim(v_roster_player.first_name), '') is null
     or nullif(trim(v_roster_player.last_name), '') is null then
    raise exception 'La ficha necesita nombre, apellido, DNI y fecha de nacimiento para generar el carnet';
  end if;

  insert into public.fefutin_players (
    dni, first_name, last_name, birth_date, photo_path, approved_by
  )
  values (
    v_roster_player.dni, v_roster_player.first_name, v_roster_player.last_name,
    v_roster_player.birth_date, v_roster_player.photo_path, auth.uid()
  )
  on conflict (dni) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    birth_date = excluded.birth_date,
    photo_path = coalesce(excluded.photo_path, public.fefutin_players.photo_path)
  where public.fefutin_players.status = 'aprobado'
  returning id, carnet_number, status
    into v_registry_id, v_carnet, v_registry_status;

  if v_registry_id is null then
    raise exception 'El DNI ya pertenece a un registro FEFUTIN rechazado. Debe revisarlo Admin o Directivo.';
  end if;

  update public.fefutin_club_roster_players
  set approval_status = 'aprobado',
      registry_player_id = v_registry_id,
      updated_at = now()
  where id = v_roster_player.id;

  update public.fefutin_roster_tournament_entries
  set approval_status = 'aprobado'
  where roster_player_id = v_roster_player.id;

  return v_carnet;
end;
$function$;

revoke all on function public.decide_fefutin_player(uuid, boolean) from public, anon;
grant execute on function public.decide_fefutin_player(uuid, boolean) to authenticated;

-- Las sanciones también se asocian directamente al jugador permanente.
create or replace function public.set_fefutin_player_no_habilitado(
  p_player_entry_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_roster_player_id uuid;
  v_registry_id uuid;
  v_entry_id uuid;
  v_previous_status text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede registrar una sanción';
  end if;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Indicá el motivo de la sanción';
  end if;

  select e.id, e.roster_player_id
    into v_entry_id, v_roster_player_id
  from public.fefutin_roster_tournament_entries e
  join public.fefutin_club_roster_players rp on rp.id = e.roster_player_id
  where e.id = p_player_entry_id
    and e.approval_status = 'aprobado'
    and rp.approval_status = 'aprobado'
  order by e.created_at desc
  limit 1
  for update of rp;

  if v_roster_player_id is null then
    select rp.id into v_roster_player_id
    from public.fefutin_club_roster_players rp
    where rp.id = p_player_entry_id
      and rp.approval_status = 'aprobado'
      and rp.registry_player_id is not null
    for update;
  end if;

  if v_roster_player_id is null then
    raise exception 'El jugador no tiene un alta aprobada y un carnet oficial';
  end if;

  select rp.registry_player_id into v_registry_id
  from public.fefutin_club_roster_players rp
  where rp.id = v_roster_player_id;

  select case
    when fp.verification_status = 'no_habilitado' or fp.carnet_status = 'no_habilitado' then 'no_habilitado'
    when fp.verification_status = 'habilitado' or fp.carnet_status = 'habilitado' then 'habilitado'
    else coalesce(fp.verification_status, fp.carnet_status, 'pendiente')
  end into v_previous_status
  from public.fefutin_players fp
  where fp.id = v_registry_id
  for update;

  if not found then
    raise exception 'No se encontró el registro oficial del jugador';
  end if;

  if v_previous_status = 'no_habilitado' then
    raise exception 'El jugador ya figura como NO HABILITADO';
  end if;

  update public.fefutin_players
  set carnet_status = 'no_habilitado',
      verification_status = 'no_habilitado'
  where id = v_registry_id;

  insert into public.fefutin_player_status_history (
    player_entry_id, registry_player_id, roster_player_id,
    previous_status, new_status, reason, changed_by
  ) values (
    v_entry_id, v_registry_id, v_roster_player_id,
    v_previous_status, 'no_habilitado', trim(p_reason), auth.uid()
  );

  return 'NO HABILITADO';
end;
$function$;

revoke all on function public.set_fefutin_player_no_habilitado(uuid, text) from public, anon;
grant execute on function public.set_fefutin_player_no_habilitado(uuid, text) to authenticated;

commit;
