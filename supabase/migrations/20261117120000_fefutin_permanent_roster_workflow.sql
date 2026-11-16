-- FEFUTIN: flujo operativo de planteles permanentes por club/categoría.
-- Mantiene las RPC que consume la interfaz y conserva el registro histórico.
begin;

-- Toda nueva participación recibe su equipo de trabajo y copia el plantel
-- permanente de la misma categoría. No se modifica ninguna participación vieja.
create or replace function public.seed_fefutin_permanent_roster_for_tournament()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_roster_id uuid;
  v_team_id uuid;
  v_created_by uuid;
begin
  select c.referente_user_id
    into v_created_by
  from public.fefutin_clubs c
  where c.id = new.club_id;

  insert into public.fefutin_teams (
    club_tournament_id, created_by, status, submitted_at
  )
  values (
    new.id, coalesce(auth.uid(), v_created_by), 'borrador', null
  )
  on conflict (club_tournament_id) do nothing
  returning id into v_team_id;

  if v_team_id is null then
    select ft.id into v_team_id
    from public.fefutin_teams ft
    where ft.club_tournament_id = new.id;
  end if;

  select cr.id into v_roster_id
  from public.fefutin_club_rosters cr
  where cr.club_id = new.club_id
    and cr.category_label = trim(new.category_label);

  if v_roster_id is not null then
    insert into public.fefutin_roster_tournament_entries (
      roster_player_id, club_tournament_id, jersey_number,
      sort_order, approval_status
    )
    select
      rp.id, new.id, '', row_number() over (
        order by rp.last_name, rp.first_name, rp.created_at
      )::integer, rp.approval_status
    from public.fefutin_club_roster_players rp
    where rp.roster_id = v_roster_id
    on conflict (roster_player_id, club_tournament_id) do nothing;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_fefutin_seed_permanent_roster on public.fefutin_club_tournaments;
create trigger trg_fefutin_seed_permanent_roster
after insert on public.fefutin_club_tournaments
for each row
execute function public.seed_fefutin_permanent_roster_for_tournament();

-- Mantiene la firma y las 17 columnas que ya consume el frontend.
-- El id incluido en players.id es ahora el id de la inscripción del torneo.
create or replace function public.get_fefutin_my_teams()
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
    raise exception 'No tenés permisos para consultar las fichas de equipos';
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
    ct.id,
    ct.tournament_id,
    t.title,
    ct.category_label,
    ft.id,
    ft.status,
    ft.submitted_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'first_name', rp.first_name,
          'last_name', rp.last_name,
          'dni', rp.dni,
          'birth_date', rp.birth_date,
          'jersey_number', e.jersey_number,
          'photo_path', rp.photo_path,
          'approval_status', e.approval_status,
          'registry_player_id', rp.registry_player_id,
          'carnet_number', fp.carnet_number,
          'carnet_status', case
            when fp.verification_status = 'no_habilitado' or fp.carnet_status = 'no_habilitado' then 'no_habilitado'
            when fp.verification_status = 'habilitado' or fp.carnet_status = 'habilitado' then 'habilitado'
            else coalesce(fp.verification_status, fp.carnet_status, 'pendiente')
          end,
          'sort_order', e.sort_order
        ) order by e.sort_order, rp.last_name, rp.first_name, e.created_at
      )
      from public.fefutin_roster_tournament_entries e
      join public.fefutin_club_roster_players rp
        on rp.id = e.roster_player_id
      left join public.fefutin_players fp
        on fp.id = rp.registry_player_id
      where e.club_tournament_id = ct.id
    ), '[]'::jsonb)
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  join public.profiles p on p.id = c.referente_user_id
  join public.tournaments t on t.id = ct.tournament_id
  left join public.fefutin_teams ft on ft.club_tournament_id = ct.id
  where c.is_active = true
    and (v_profile.role in ('admin', 'directivo') or c.id = v_profile.club_id)
  order by c.name, t.title, ct.category_label;
end;
$function$;

-- Guarda cambios en la participación sin borrar la ficha permanente.
-- Solo se pueden editar o retirar inscripciones pendientes; las aprobadas,
-- rechazadas y sus carnets permanecen intactos.
create or replace function public.save_fefutin_team_roster(
  p_club_tournament_id uuid,
  p_players jsonb,
  p_submit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_ct public.fefutin_club_tournaments%rowtype;
  v_team_id uuid;
  v_roster_id uuid;
  v_roster_player_id uuid;
  v_entry_id uuid;
  v_entry_text text;
  v_registry_id uuid;
  v_registry_status text;
  v_item jsonb;
  v_index integer := 0;
  v_first_name text;
  v_last_name text;
  v_dni text;
  v_dni_key text;
  v_birth_date date;
  v_jersey_number text;
  v_photo_path text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'Solo un referente habilitado puede modificar la lista de su club';
  end if;

  select ct.* into v_ct
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  where ct.id = p_club_tournament_id
    and c.id = v_profile.club_id
    and c.referente_user_id = auth.uid()
    and c.is_active = true
  for update of ct;

  if not found then
    raise exception 'Esta categoría no pertenece a tu club o ya no está habilitada';
  end if;

  if coalesce(jsonb_typeof(p_players), '') <> 'array' then
    raise exception 'La lista de jugadores tiene un formato inválido';
  end if;
  if jsonb_array_length(p_players) > 40 then
    raise exception 'La lista no puede superar los 40 jugadores';
  end if;

  select ft.id, ft.status into v_team_id, v_registry_status
  from public.fefutin_teams ft
  where ft.club_tournament_id = p_club_tournament_id
  for update;

  if v_registry_status = 'presentada' then
    raise exception 'La lista ya fue presentada. Solicitá a Admin o Directivo que habilite una corrección.';
  end if;

  if v_team_id is null then
    insert into public.fefutin_teams (
      club_tournament_id, created_by, status, submitted_at
    ) values (
      p_club_tournament_id, auth.uid(), 'borrador', null
    )
    returning id into v_team_id;
  end if;

  select cr.id into v_roster_id
  from public.fefutin_club_rosters cr
  where cr.club_id = v_ct.club_id
    and cr.category_label = trim(v_ct.category_label);

  if v_roster_id is null then
    insert into public.fefutin_club_rosters (club_id, category_label)
    values (v_ct.club_id, trim(v_ct.category_label))
    on conflict (club_id, category_label) do update
      set category_label = excluded.category_label
    returning id into v_roster_id;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_players)
  loop
    v_index := v_index + 1;
    v_first_name := coalesce(trim(v_item ->> 'first_name'), '');
    v_last_name := coalesce(trim(v_item ->> 'last_name'), '');
    v_dni := coalesce(trim(v_item ->> 'dni'), '');
    v_dni_key := nullif(regexp_replace(v_dni, '[^0-9]', '', 'g'), '');
    v_birth_date := nullif(trim(coalesce(v_item ->> 'birth_date', '')), '')::date;
    v_jersey_number := coalesce(trim(v_item ->> 'jersey_number'), '');
    v_photo_path := nullif(trim(coalesce(v_item ->> 'photo_path', '')), '');
    v_entry_id := null;
    v_roster_player_id := null;
    v_registry_id := null;
    v_entry_text := coalesce(v_item ->> 'id', '');

    if p_submit and (
      v_first_name = '' or v_last_name = '' or v_dni_key is null
      or v_birth_date is null or v_jersey_number = '' or v_photo_path is null
    ) then
      raise exception 'Completá los datos y cargá la foto de cada jugador antes de presentar la lista';
    end if;

    if v_entry_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_entry_id := v_entry_text::uuid;
    end if;

    if v_entry_id is not null then
      select e.roster_player_id into v_roster_player_id
      from public.fefutin_roster_tournament_entries e
      where e.id = v_entry_id
        and e.club_tournament_id = p_club_tournament_id
      for update;
    end if;

    if v_roster_player_id is null and v_dni_key is not null then
      select rp.id into v_roster_player_id
      from public.fefutin_club_roster_players rp
      where rp.roster_id = v_roster_id
        and rp.identity_key = v_dni_key
      for update;
    end if;

    if v_roster_player_id is null then
      insert into public.fefutin_club_roster_players (
        roster_id, identity_key, first_name, last_name, dni,
        birth_date, photo_path, approval_status
      ) values (
        v_roster_id,
        coalesce(v_dni_key, 'sin-dni:' || gen_random_uuid()::text),
        v_first_name, v_last_name, v_dni, v_birth_date,
        v_photo_path, 'pendiente'
      )
      on conflict (roster_id, identity_key) do update
        set identity_key = excluded.identity_key
      returning id into v_roster_player_id;
    end if;

    select rp.registry_player_id, fp.status
      into v_registry_id, v_registry_status
    from public.fefutin_club_roster_players rp
    left join public.fefutin_players fp on fp.id = rp.registry_player_id
    where rp.id = v_roster_player_id
    for update of rp;

    if v_registry_id is null and v_dni_key is not null then
      select fp.id, fp.status
        into v_registry_id, v_registry_status
      from public.fefutin_players fp
      where regexp_replace(coalesce(fp.dni, ''), '[^0-9]', '', 'g') = v_dni_key
      order by (fp.dni = v_dni) desc, fp.created_at asc
      limit 1;
      if v_registry_status = 'rechazado' then
        raise exception 'El DNI corresponde a un registro FEFUTIN rechazado. Debe revisarlo Admin o Directivo.';
      end if;
    end if;

    if v_registry_id is not null then
      update public.fefutin_club_roster_players
      set registry_player_id = v_registry_id,
          approval_status = 'aprobado',
          updated_at = now()
      where id = v_roster_player_id
        and approval_status = 'pendiente';
    else
      update public.fefutin_club_roster_players
      set first_name = v_first_name,
          last_name = v_last_name,
          dni = v_dni,
          birth_date = v_birth_date,
          photo_path = coalesce(v_photo_path, photo_path),
          updated_at = now()
      where id = v_roster_player_id
        and approval_status = 'pendiente'
        and registry_player_id is null;
    end if;

    insert into public.fefutin_roster_tournament_entries as current_entry (
      roster_player_id, club_tournament_id, jersey_number,
      sort_order, approval_status
    ) values (
      v_roster_player_id, p_club_tournament_id, v_jersey_number,
      v_index,
      case when v_registry_id is not null then 'aprobado'
           else (select rp.approval_status from public.fefutin_club_roster_players rp where rp.id = v_roster_player_id)
      end
    )
    on conflict (roster_player_id, club_tournament_id) do update
      set jersey_number = case
            when current_entry.approval_status in ('aprobado', 'rechazado')
              then current_entry.jersey_number
            else excluded.jersey_number
          end,
          sort_order = case
            when current_entry.approval_status in ('aprobado', 'rechazado')
              then current_entry.sort_order
            else excluded.sort_order
          end,
          approval_status = case
            when current_entry.approval_status in ('aprobado', 'rechazado')
              then current_entry.approval_status
            else excluded.approval_status
          end;
  end loop;

  if p_submit and jsonb_array_length(p_players) = 0 then
    raise exception 'Agregá al menos un jugador antes de presentar la lista';
  end if;

  -- Retirar de este torneo solo las inscripciones pendientes omitidas.
  -- La ficha permanente no se elimina y las inscripciones aprobadas/rechazadas
  -- quedan conservadas aunque el referente ya no las incluya en el borrador.
  delete from public.fefutin_roster_tournament_entries e
  where e.club_tournament_id = p_club_tournament_id
    and e.approval_status = 'pendiente'
    and not exists (
      select 1
      from jsonb_array_elements(p_players) item
      where item ->> 'id' = e.id::text
         or (
           nullif(regexp_replace(coalesce(item ->> 'dni', ''), '[^0-9]', '', 'g'), '') is not null
           and nullif(regexp_replace(coalesce(item ->> 'dni', ''), '[^0-9]', '', 'g'), '') =
               (select rp.identity_key
                from public.fefutin_club_roster_players rp
                where rp.id = e.roster_player_id)
         )
    );

  update public.fefutin_teams
  set status = case when p_submit then 'presentada' else 'borrador' end,
      submitted_at = case when p_submit then now() else null end,
      updated_at = now()
  where id = v_team_id;

  return v_team_id;
end;
$function$;

-- Aprobar/rechazar la ficha permanente y propagar el resultado a sus
-- participaciones. Si el DNI ya tiene carnet FEFUTIN se reutiliza ese registro.
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
  v_entry public.fefutin_roster_tournament_entries%rowtype;
  v_roster_player public.fefutin_club_roster_players%rowtype;
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

  select e.* into v_entry
  from public.fefutin_roster_tournament_entries e
  join public.fefutin_teams ft on ft.club_tournament_id = e.club_tournament_id
  where e.id = p_player_entry_id
  for update of e;

  if not found then
    raise exception 'No se encontró el jugador de la lista de buena fe';
  end if;

  select rp.* into v_roster_player
  from public.fefutin_club_roster_players rp
  where rp.id = v_entry.roster_player_id
  for update;

  if not found then
    raise exception 'No se encontró la ficha permanente del jugador';
  end if;

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

-- Sanción vinculada a la inscripción recibida por la interfaz y a la ficha
-- permanente. Conserva carnet, participación e historial.
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

  select rp.id, rp.registry_player_id
    into v_roster_player_id, v_registry_id
  from public.fefutin_roster_tournament_entries e
  join public.fefutin_club_roster_players rp
    on rp.id = e.roster_player_id
  where e.id = p_player_entry_id
    and e.approval_status = 'aprobado'
    and rp.approval_status = 'aprobado'
    and rp.registry_player_id is not null
  for update of rp;

  if not found then
    raise exception 'El jugador no tiene un alta aprobada y un carnet oficial';
  end if;

  select case
           when fp.verification_status = 'no_habilitado' or fp.carnet_status = 'no_habilitado' then 'no_habilitado'
           when fp.verification_status = 'habilitado' or fp.carnet_status = 'habilitado' then 'habilitado'
           else coalesce(fp.verification_status, fp.carnet_status, 'pendiente')
         end
    into v_previous_status
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
    p_player_entry_id, v_registry_id, v_roster_player_id,
    v_previous_status, 'no_habilitado', trim(p_reason), auth.uid()
  );

  return 'NO HABILITADO';
end;
$function$;

-- Verificación arbitral sobre la inscripción del torneo, no sobre la fila legacy.
-- Conserva la validación de árbitro asignado y de los clubes del partido.
create or replace function public.verify_fefutin_player_for_match(
  p_player_entry_id uuid,
  p_tournament_id uuid,
  p_match_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_registry_id uuid;
  v_club_name text;
  v_is_assigned_match boolean := false;
  v_current_status text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role <> 'arbitro'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo un árbitro aprobado y activo puede verificar carnets';
  end if;

  select rp.registry_player_id, c.name
    into v_registry_id, v_club_name
  from public.fefutin_roster_tournament_entries e
  join public.fefutin_club_roster_players rp on rp.id = e.roster_player_id
  join public.fefutin_club_tournaments ct on ct.id = e.club_tournament_id
  join public.fefutin_teams ft on ft.club_tournament_id = ct.id
  join public.fefutin_clubs c on c.id = ct.club_id
  where e.id = p_player_entry_id
    and ct.tournament_id = p_tournament_id
    and ft.status = 'presentada'
    and e.approval_status = 'aprobado'
    and rp.approval_status = 'aprobado'
    and rp.registry_player_id is not null;

  if not found then
    raise exception 'El jugador no tiene un alta aprobada y un carnet generado para este torneo';
  end if;

  select exists (
    select 1
    from public.tournaments t
    cross join lateral jsonb_array_elements(coalesce(t.groups, '[]'::jsonb)) g
    cross join lateral jsonb_array_elements(coalesce(g -> 'matches', '[]'::jsonb)) m
    where t.id = p_tournament_id
      and m ->> 'id' = p_match_id
      and m ->> 'referee_id' = auth.uid()::text
      and (
        lower(trim(coalesce(m ->> 'team1', ''))) = lower(trim(v_club_name))
        or lower(trim(coalesce(m ->> 'team2', ''))) = lower(trim(v_club_name))
      )
    union all
    select 1
    from public.tournaments t
    cross join lateral jsonb_array_elements(coalesce(t.playoffs, '[]'::jsonb)) r
    cross join lateral jsonb_array_elements(coalesce(r, '[]'::jsonb)) m
    where t.id = p_tournament_id
      and m ->> 'id' = p_match_id
      and m ->> 'referee_id' = auth.uid()::text
      and (
        lower(trim(coalesce(m ->> 'team1', ''))) = lower(trim(v_club_name))
        or lower(trim(coalesce(m ->> 'team2', ''))) = lower(trim(v_club_name))
      )
  ) into v_is_assigned_match;

  if not v_is_assigned_match then
    raise exception 'Solo podés verificar jugadores de un partido que tenés asignado y en el que participa su club';
  end if;

  select case
           when fp.verification_status = 'no_habilitado' or fp.carnet_status = 'no_habilitado' then 'no_habilitado'
           when fp.verification_status = 'habilitado' or fp.carnet_status = 'habilitado' then 'habilitado'
           else coalesce(fp.verification_status, fp.carnet_status, 'pendiente')
         end
    into v_current_status
  from public.fefutin_players fp
  where fp.id = v_registry_id
  for update;

  if not found then
    raise exception 'No se encontró el carnet oficial del jugador';
  end if;

  if v_current_status = 'no_habilitado' then
    raise exception 'El carnet figura como NO HABILITADO. Debe revisarlo Admin o Directivo';
  end if;

  update public.fefutin_players
  set carnet_status = 'habilitado',
      verification_status = 'habilitado',
      verified_by = auth.uid(),
      verified_at = now()
  where id = v_registry_id;

  return 'HABILITADO';
end;
$function$;

revoke all on function public.seed_fefutin_permanent_roster_for_tournament() from public, anon, authenticated;
revoke all on function public.get_fefutin_my_teams() from public, anon;
revoke all on function public.save_fefutin_team_roster(uuid, jsonb, boolean) from public, anon;
revoke all on function public.decide_fefutin_player(uuid, boolean) from public, anon;
revoke all on function public.set_fefutin_player_no_habilitado(uuid, text) from public, anon;
revoke all on function public.verify_fefutin_player_for_match(uuid, uuid, text) from public, anon;

grant execute on function public.get_fefutin_my_teams() to authenticated;
grant execute on function public.save_fefutin_team_roster(uuid, jsonb, boolean) to authenticated;
grant execute on function public.decide_fefutin_player(uuid, boolean) to authenticated;
grant execute on function public.set_fefutin_player_no_habilitado(uuid, text) to authenticated;
grant execute on function public.verify_fefutin_player_for_match(uuid, uuid, text) to authenticated;

commit;
