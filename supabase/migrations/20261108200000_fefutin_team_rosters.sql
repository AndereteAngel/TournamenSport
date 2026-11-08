-- FEFUTIN: fichas independientes por torneo/categoría y listas de buena fe.
-- Cada fila de fefutin_club_tournaments representa una participación/categoría.

begin;

create table if not exists public.fefutin_teams (
  id uuid primary key default gen_random_uuid(),
  club_tournament_id uuid not null unique
    references public.fefutin_club_tournaments(id) on delete cascade,
  status text not null default 'borrador'
    check (status in ('borrador', 'presentada')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists public.fefutin_team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.fefutin_teams(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  dni text not null default '',
  birth_date date,
  jersey_number text not null default '',
  carnet_number text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists fefutin_team_players_team_order_idx
  on public.fefutin_team_players(team_id, sort_order, created_at);

create unique index if not exists fefutin_team_players_unique_dni
  on public.fefutin_team_players(team_id, dni)
  where dni <> '';

alter table public.fefutin_teams enable row level security;
alter table public.fefutin_team_players enable row level security;
revoke all on public.fefutin_teams from anon, public, authenticated;
revoke all on public.fefutin_team_players from anon, public, authenticated;

-- Devuelve las participaciones del referente (o todas para administración/directivos).
create or replace function public.get_fefutin_my_teams()
returns table (
  club_id uuid,
  club_name text,
  headquarters_address text,
  logo_path text,
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
    c.headquarters_address,
    c.logo_path,
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
          'carnet_number', pl.carnet_number,
          'sort_order', pl.sort_order
        ) order by pl.sort_order, pl.created_at
      )
      from public.fefutin_team_players pl
      where pl.team_id = ft.id
    ), '[]'::jsonb)
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  join public.tournaments t on t.id = ct.tournament_id
  left join public.fefutin_teams ft on ft.club_tournament_id = ct.id
  where c.is_active = true
    and (v_profile.role in ('admin', 'directivo') or c.id = v_profile.club_id)
  order by c.name, t.title, ct.category_label;
end;
$$;

-- Guarda la lista completa enviada por el referente. Si p_submit=true, valida y presenta.
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
  v_item jsonb;
  v_index integer := 0;
  v_first_name text;
  v_last_name text;
  v_dni text;
  v_birth_date date;
  v_jersey_number text;
  v_carnet_number text;
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

  if not exists (
    select 1
    from public.fefutin_club_tournaments ct
    join public.fefutin_clubs c on c.id = ct.club_id
    where ct.id = p_club_tournament_id
      and c.id = v_profile.club_id
      and c.referente_user_id = auth.uid()
      and c.is_active = true
  ) then
    raise exception 'Esta categoría no pertenece a tu club o ya no está habilitada';
  end if;

  if coalesce(jsonb_typeof(p_players), '') <> 'array' then
    raise exception 'La lista de jugadores tiene un formato inválido';
  end if;

  if jsonb_array_length(p_players) > 40 then
    raise exception 'La lista no puede superar los 40 jugadores';
  end if;

  insert into public.fefutin_teams (club_tournament_id, created_by, status, submitted_at)
  values (p_club_tournament_id, auth.uid(), 'borrador', null)
  on conflict (club_tournament_id) do update
    set status = 'borrador', submitted_at = null, updated_at = now()
  returning id into v_team_id;

  delete from public.fefutin_team_players where team_id = v_team_id;

  for v_item in select value from jsonb_array_elements(p_players)
  loop
    v_index := v_index + 1;
    v_first_name := coalesce(trim(v_item ->> 'first_name'), '');
    v_last_name := coalesce(trim(v_item ->> 'last_name'), '');
    v_dni := coalesce(trim(v_item ->> 'dni'), '');
    v_birth_date := nullif(trim(coalesce(v_item ->> 'birth_date', '')), '')::date;
    v_jersey_number := coalesce(trim(v_item ->> 'jersey_number'), '');
    v_carnet_number := coalesce(trim(v_item ->> 'carnet_number'), '');

    if p_submit and (
      v_first_name = '' or v_last_name = '' or v_dni = ''
      or v_birth_date is null or v_jersey_number = '' or v_carnet_number = ''
    ) then
      raise exception 'Completá todos los datos de cada jugador antes de presentar la lista';
    end if;

    insert into public.fefutin_team_players (
      team_id, first_name, last_name, dni, birth_date,
      jersey_number, carnet_number, sort_order
    ) values (
      v_team_id, v_first_name, v_last_name, v_dni, v_birth_date,
      v_jersey_number, v_carnet_number, v_index
    );
  end loop;

  if p_submit and jsonb_array_length(p_players) = 0 then
    raise exception 'Agregá al menos un jugador antes de presentar la lista';
  end if;

  update public.fefutin_teams
  set status = case when p_submit then 'presentada' else 'borrador' end,
      submitted_at = case when p_submit then now() else null end,
      updated_at = now()
  where id = v_team_id;

  return v_team_id;
end;
$$;

revoke all on function public.get_fefutin_my_teams() from public, anon;
grant execute on function public.get_fefutin_my_teams() to authenticated;
revoke all on function public.save_fefutin_team_roster(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_fefutin_team_roster(uuid, jsonb, boolean) to authenticated;

commit;
