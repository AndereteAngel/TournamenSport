-- FEFUTIN: conservar el historial de altas, exponer estados reales y registrar sanciones.
begin;

-- Historial administrativo: una sanción nunca elimina el jugador ni su carnet.
create table if not exists public.fefutin_player_status_history (
  id uuid primary key default gen_random_uuid(),
  player_entry_id uuid not null references public.fefutin_team_players(id),
  registry_player_id uuid not null references public.fefutin_players(id),
  previous_status text not null,
  new_status text not null check (new_status in ('no_habilitado')),
  reason text not null,
  changed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists fefutin_player_status_history_entry_idx
  on public.fefutin_player_status_history(player_entry_id, created_at desc);

alter table public.fefutin_player_status_history enable row level security;
revoke all on public.fefutin_player_status_history from public, anon, authenticated;

-- La consulta devuelve los estados que consume la interfaz de altas y carnets.
drop function if exists public.get_fefutin_my_teams();
create function public.get_fefutin_my_teams()
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
as $$
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
          'id', pl.id,
          'first_name', pl.first_name,
          'last_name', pl.last_name,
          'dni', pl.dni,
          'birth_date', pl.birth_date,
          'jersey_number', pl.jersey_number,
          'photo_path', pl.photo_path,
          'approval_status', pl.approval_status,
          'registry_player_id', pl.registry_player_id,
          'carnet_number', fp.carnet_number,
          'carnet_status', fp.carnet_status,
          'sort_order', pl.sort_order
        ) order by pl.sort_order, pl.created_at
      )
      from public.fefutin_team_players pl
      left join public.fefutin_players fp on fp.id = pl.registry_player_id
      where pl.team_id = ft.id
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
$$;

revoke all on function public.get_fefutin_my_teams() from public, anon;
grant execute on function public.get_fefutin_my_teams() to authenticated;

-- La bandeja cuenta pendientes tanto en borrador como en listas presentadas.
create or replace function public.get_fefutin_pending_players()
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
  approval_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found or v_profile.role not in ('admin', 'directivo')
    or v_profile.approval_status <> 'aprobado'
    or v_profile.deactivated_at is not null then
    raise exception 'No tenés permisos para revisar altas de jugadores';
  end if;

  return query
  select pl.id, ft.id, c.name, t.title, ct.category_label,
         pl.first_name, pl.last_name, pl.dni, pl.birth_date,
         pl.jersey_number, pl.photo_path, pl.approval_status
  from public.fefutin_team_players pl
  join public.fefutin_teams ft on ft.id = pl.team_id
  join public.fefutin_club_tournaments ct on ct.id = ft.club_tournament_id
  join public.fefutin_clubs c on c.id = ct.club_id
  join public.tournaments t on t.id = ct.tournament_id
  where pl.approval_status = 'pendiente'
  order by c.name, t.title, ct.category_label, pl.last_name, pl.first_name;
end;
$$;

revoke all on function public.get_fefutin_pending_players() from public, anon;
grant execute on function public.get_fefutin_pending_players() to authenticated;

-- Guardar la lista sin borrar altas aprobadas ni sus carnets.
create or replace function public.save_fefutin_team_roster(
  p_club_tournament_id uuid,
  p_players jsonb,
  p_submit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_team_id uuid;
  v_existing_status text;
  v_item jsonb;
  v_index integer := 0;
  v_first_name text;
  v_last_name text;
  v_dni text;
  v_birth_date date;
  v_jersey_number text;
  v_photo_path text;
  v_entry_id uuid;
  v_entry_id_text text;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if not found or v_profile.role <> 'referente' or v_profile.approval_status <> 'aprobado'
    or v_profile.deactivated_at is not null or v_profile.club_id is null then
    raise exception 'Solo un referente habilitado puede modificar la lista de su club';
  end if;

  if not exists (
    select 1 from public.fefutin_club_tournaments ct
    join public.fefutin_clubs c on c.id = ct.club_id
    where ct.id = p_club_tournament_id and c.id = v_profile.club_id
      and c.referente_user_id = auth.uid() and c.is_active = true
  ) then
    raise exception 'Esta categoría no pertenece a tu club o ya no está habilitada';
  end if;

  if coalesce(jsonb_typeof(p_players), '') <> 'array' then
    raise exception 'La lista de jugadores tiene un formato inválido';
  end if;
  if jsonb_array_length(p_players) > 40 then
    raise exception 'La lista no puede superar los 40 jugadores';
  end if;

  select ft.id, ft.status into v_team_id, v_existing_status
  from public.fefutin_teams ft
  where ft.club_tournament_id = p_club_tournament_id
  for update;

  if v_existing_status = 'presentada' then
    raise exception 'La lista ya fue presentada. Solicitá a Admin o Directivo que habilite una corrección.';
  end if;

  if v_team_id is null then
    insert into public.fefutin_teams (club_tournament_id, created_by, status, submitted_at)
    values (p_club_tournament_id, auth.uid(), 'borrador', null)
    returning id into v_team_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_players) loop
    v_index := v_index + 1;
    v_first_name := coalesce(trim(v_item ->> 'first_name'), '');
    v_last_name := coalesce(trim(v_item ->> 'last_name'), '');
    v_dni := coalesce(trim(v_item ->> 'dni'), '');
    v_birth_date := nullif(trim(coalesce(v_item ->> 'birth_date', '')), '')::date;
    v_jersey_number := coalesce(trim(v_item ->> 'jersey_number'), '');
    v_photo_path := nullif(trim(coalesce(v_item ->> 'photo_path', '')), '');
    v_entry_id := null;
    v_entry_id_text := coalesce(v_item ->> 'id', '');

    if v_entry_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_entry_id := v_entry_id_text::uuid;
    end if;

    if p_submit and (v_first_name = '' or v_last_name = '' or v_dni = ''
      or v_birth_date is null or v_jersey_number = '' or v_photo_path is null) then
      raise exception 'Completá los datos y cargá la foto de cada jugador antes de presentar la lista';
    end if;

    if v_entry_id is not null and exists (
      select 1 from public.fefutin_team_players
      where id = v_entry_id and team_id = v_team_id
    ) then
      -- Solo se editan altas aún pendientes. Los aprobados/rechazados conservan su historia.
      update public.fefutin_team_players
      set first_name = v_first_name,
          last_name = v_last_name,
          dni = v_dni,
          birth_date = v_birth_date,
          jersey_number = v_jersey_number,
          photo_path = v_photo_path,
          sort_order = v_index
      where id = v_entry_id
        and team_id = v_team_id
        and approval_status = 'pendiente'
        and registry_player_id is null;
    else
      insert into public.fefutin_team_players (
        team_id, first_name, last_name, dni, birth_date, jersey_number,
        photo_path, approval_status, sort_order
      ) values (
        v_team_id, v_first_name, v_last_name, v_dni, v_birth_date, v_jersey_number,
        v_photo_path, 'pendiente', v_index
      );
    end if;
  end loop;

  if p_submit and jsonb_array_length(p_players) = 0 then
    raise exception 'Agregá al menos un jugador antes de presentar la lista';
  end if;

  -- Solo se retiran filas todavía pendientes y sin registro oficial.
  delete from public.fefutin_team_players pl
  where pl.team_id = v_team_id
    and pl.approval_status = 'pendiente'
    and pl.registry_player_id is null
    and not exists (
      select 1
      from jsonb_array_elements(p_players) item
      where item ->> 'id' = pl.id::text
    );

  update public.fefutin_teams
  set status = case when p_submit then 'presentada' else 'borrador' end,
      submitted_at = case when p_submit then now() else null end,
      updated_at = now()
  where id = v_team_id;

  return v_team_id;
end;
$$;

revoke all on function public.save_fefutin_team_roster(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_fefutin_team_roster(uuid, jsonb, boolean) to authenticated;

-- Sanción administrativa con motivo e historial. No borra el carnet ni la inscripción.
create or replace function public.set_fefutin_player_no_habilitado(
  p_player_entry_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_registry_id uuid;
  v_previous_status text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found or v_profile.role not in ('admin', 'directivo')
    or v_profile.approval_status <> 'aprobado'
    or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede registrar una sanción';
  end if;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Indicá el motivo de la sanción';
  end if;

  select pl.registry_player_id into v_registry_id
  from public.fefutin_team_players pl
  where pl.id = p_player_entry_id
    and pl.approval_status = 'aprobado'
    and pl.registry_player_id is not null
  for update;

  if not found then
    raise exception 'El jugador no tiene un alta activa y un carnet oficial';
  end if;

  select fp.carnet_status into v_previous_status
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
  set carnet_status = 'no_habilitado'
  where id = v_registry_id;

  insert into public.fefutin_player_status_history (
    player_entry_id, registry_player_id, previous_status, new_status, reason, changed_by
  ) values (
    p_player_entry_id, v_registry_id, v_previous_status, 'no_habilitado',
    trim(p_reason), auth.uid()
  );

  return 'NO HABILITADO';
end;
$$;

revoke all on function public.set_fefutin_player_no_habilitado(uuid, text) from public, anon;
grant execute on function public.set_fefutin_player_no_habilitado(uuid, text) to authenticated;

commit;
