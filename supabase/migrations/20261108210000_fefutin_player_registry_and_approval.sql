-- FEFUTIN: registro único de jugadores, fotografías y altas con carnet automático.
begin;

create sequence if not exists public.fefutin_carnet_sequence start with 1;

create table if not exists public.fefutin_players (
  id uuid primary key default gen_random_uuid(),
  dni text not null unique,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  photo_path text,
  carnet_number text not null unique default (
    'FEFUTIN-' || lpad(nextval('public.fefutin_carnet_sequence')::text, 6, '0')
  ),
  status text not null default 'aprobado' check (status in ('aprobado', 'rechazado')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.fefutin_team_players
  add column if not exists photo_path text,
  add column if not exists approval_status text not null default 'pendiente'
    check (approval_status in ('pendiente', 'aprobado', 'rechazado')),
  add column if not exists registry_player_id uuid references public.fefutin_players(id);

-- El carnet se consulta desde el registro único; nunca lo carga el referente.
alter table public.fefutin_team_players
  drop column if exists carnet_number;

create index if not exists fefutin_team_players_approval_idx
  on public.fefutin_team_players(approval_status, team_id);

alter table public.fefutin_players enable row level security;
revoke all on public.fefutin_players from anon, public, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fefutin-player-photos', 'fefutin-player-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "FEFUTIN player photos public read" on storage.objects;
create policy "FEFUTIN player photos public read"
on storage.objects for select to public
using (bucket_id = 'fefutin-player-photos');

drop policy if exists "FEFUTIN player photos own folder upload" on storage.objects;
create policy "FEFUTIN player photos own folder upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fefutin-player-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "FEFUTIN player photos own folder update" on storage.objects;
create policy "FEFUTIN player photos own folder update"
on storage.objects for update to authenticated
using (bucket_id = 'fefutin-player-photos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'fefutin-player-photos' and (storage.foldername(name))[1] = auth.uid()::text);

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
declare v_profile public.profiles%rowtype;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if not found or v_profile.role not in ('admin','directivo')
    or v_profile.approval_status <> 'aprobado' or v_profile.deactivated_at is not null then
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
  where ft.status = 'presentada' and pl.approval_status = 'pendiente'
  order by c.name, t.title, ct.category_label, pl.last_name, pl.first_name;
end;
$$;

create or replace function public.decide_fefutin_player(
  p_player_entry_id uuid,
  p_approve boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_entry public.fefutin_team_players%rowtype;
  v_registry_id uuid;
  v_carnet text;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if not found or v_profile.role not in ('admin','directivo')
    or v_profile.approval_status <> 'aprobado' or v_profile.deactivated_at is not null then
    raise exception 'No tenés permisos para aprobar altas de jugadores';
  end if;

  select pl.* into v_entry
  from public.fefutin_team_players pl
  join public.fefutin_teams ft on ft.id = pl.team_id
  where pl.id = p_player_entry_id and ft.status = 'presentada'
  for update of pl;

  if not found then raise exception 'No se encontró el jugador presentado'; end if;
  if v_entry.approval_status <> 'pendiente' then
    raise exception 'Este jugador ya fue revisado';
  end if;

  if not p_approve then
    update public.fefutin_team_players
      set approval_status = 'rechazado'
      where id = p_player_entry_id;
    return 'RECHAZADO';
  end if;

  insert into public.fefutin_players (dni, first_name, last_name, birth_date, photo_path, approved_by)
  values (v_entry.dni, v_entry.first_name, v_entry.last_name, v_entry.birth_date, v_entry.photo_path, auth.uid())
  on conflict (dni) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    birth_date = excluded.birth_date,
    photo_path = coalesce(excluded.photo_path, public.fefutin_players.photo_path)
  returning id, carnet_number into v_registry_id, v_carnet;

  update public.fefutin_team_players
    set approval_status = 'aprobado', registry_player_id = v_registry_id
    where id = p_player_entry_id;

  return v_carnet;
end;
$$;

-- Reemplaza la función de guardado para que no solicite carnet y acepte la foto.
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
  ) then raise exception 'Esta categoría no pertenece a tu club o ya no está habilitada'; end if;

  if coalesce(jsonb_typeof(p_players), '') <> 'array' then raise exception 'La lista de jugadores tiene un formato inválido'; end if;
  if jsonb_array_length(p_players) > 40 then raise exception 'La lista no puede superar los 40 jugadores'; end if;

  select ft.id, ft.status into v_team_id, v_existing_status
  from public.fefutin_teams ft where ft.club_tournament_id = p_club_tournament_id;

  if v_existing_status = 'presentada' then
    raise exception 'La lista ya fue presentada. Solicitá a Admin o Directivo que habilite una corrección.';
  end if;

  insert into public.fefutin_teams (club_tournament_id, created_by, status, submitted_at)
  values (p_club_tournament_id, auth.uid(), 'borrador', null)
  on conflict (club_tournament_id) do update
    set status = 'borrador', submitted_at = null, updated_at = now()
  returning id into v_team_id;

  delete from public.fefutin_team_players where team_id = v_team_id;

  for v_item in select value from jsonb_array_elements(p_players) loop
    v_index := v_index + 1;
    v_first_name := coalesce(trim(v_item ->> 'first_name'), '');
    v_last_name := coalesce(trim(v_item ->> 'last_name'), '');
    v_dni := coalesce(trim(v_item ->> 'dni'), '');
    v_birth_date := nullif(trim(coalesce(v_item ->> 'birth_date', '')), '')::date;
    v_jersey_number := coalesce(trim(v_item ->> 'jersey_number'), '');
    v_photo_path := nullif(trim(coalesce(v_item ->> 'photo_path', '')), '');

    if p_submit and (v_first_name = '' or v_last_name = '' or v_dni = ''
      or v_birth_date is null or v_jersey_number = '' or v_photo_path is null) then
      raise exception 'Completá los datos y cargá la foto de cada jugador antes de presentar la lista';
    end if;

    insert into public.fefutin_team_players (
      team_id, first_name, last_name, dni, birth_date, jersey_number,
      photo_path, approval_status, sort_order
    ) values (
      v_team_id, v_first_name, v_last_name, v_dni, v_birth_date, v_jersey_number,
      v_photo_path, 'pendiente', v_index
    );
  end loop;

  if p_submit and jsonb_array_length(p_players) = 0 then
    raise exception 'Agregá al menos un jugador antes de presentar la lista';
  end if;

  update public.fefutin_teams set
    status = case when p_submit then 'presentada' else 'borrador' end,
    submitted_at = case when p_submit then now() else null end,
    updated_at = now()
  where id = v_team_id;

  return v_team_id;
end;
$$;

-- Actualiza el detalle devuelto al referente/directivo con foto, estado y carnet del registro único.
create or replace function public.get_fefutin_my_teams()
returns table (
  club_id uuid, club_name text, headquarters_address text, logo_path text,
  club_tournament_id uuid, tournament_id uuid, tournament_title text,
  category_label text, team_id uuid, team_status text, submitted_at timestamptz,
  players jsonb
)
language plpgsql
security definer
set search_path = ''
as $
declare v_profile public.profiles%rowtype;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if not found or v_profile.approval_status <> 'aprobado'
    or v_profile.deactivated_at is not null
    or v_profile.role not in ('referente','admin','directivo') then
    raise exception 'No tenés permisos para consultar las fichas de equipos';
  end if;
  if v_profile.role = 'referente' and v_profile.club_id is null then
    raise exception 'Tu usuario todavía no tiene un club asociado';
  end if;

  return query
  select c.id, c.name, c.headquarters_address, c.logo_path,
    ct.id, ct.tournament_id, t.title, ct.category_label,
    ft.id, ft.status, ft.submitted_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'first_name', pl.first_name, 'last_name', pl.last_name,
        'dni', pl.dni, 'birth_date', pl.birth_date,
        'jersey_number', pl.jersey_number, 'photo_path', pl.photo_path,
        'approval_status', pl.approval_status,
        'carnet_number', fp.carnet_number,
        'sort_order', pl.sort_order
      ) order by pl.sort_order, pl.created_at)
      from public.fefutin_team_players pl
      left join public.fefutin_players fp on fp.id = pl.registry_player_id
      where pl.team_id = ft.id
    ), '[]'::jsonb)
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  join public.tournaments t on t.id = ct.tournament_id
  left join public.fefutin_teams ft on ft.club_tournament_id = ct.id
  where c.is_active = true
    and (v_profile.role in ('admin','directivo') or c.id = v_profile.club_id)
  order by c.name, t.title, ct.category_label;
end;
$;

revoke all on function public.get_fefutin_pending_players() from public, anon;
grant execute on function public.get_fefutin_pending_players() to authenticated;
revoke all on function public.decide_fefutin_player(uuid, boolean) from public, anon;
grant execute on function public.decide_fefutin_player(uuid, boolean) to authenticated;
revoke all on function public.save_fefutin_team_roster(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_fefutin_team_roster(uuid, jsonb, boolean) to authenticated;

commit;
