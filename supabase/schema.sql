-- TournamenSport: esquema inicial de Supabase
-- Ejecutar en Supabase > SQL Editor > New query.
-- Incluye perfiles, torneos, visitas y función segura para listar jugadores.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text,
  created_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(trim(username)) >= 3)
);

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  game text,
  format text,
  qualifiers_per_group integer,
  is_public boolean not null default true,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_by text not null,
  groups jsonb not null default '[]'::jsonb,
  playoffs jsonb,
  status text not null default 'Inscripciones',
  created_at timestamptz not null default now()
);

create index if not exists tournaments_created_at_idx
  on public.tournaments (created_at desc);

create index if not exists tournaments_creator_idx
  on public.tournaments (created_by_user_id);

create table if not exists public.visitas (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  username text,
  email text,
  device text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  created_at timestamptz not null default now()
);

-- Crear perfil automáticamente al registrar un usuario en Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), 'Jugador_' || substr(new.id::text, 1, 8)),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Función usada por la interfaz para mostrar la lista de jugadores.
create or replace function public.list_registered_players()
returns table (id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username
  from public.profiles p
  where auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid
  order by lower(p.username);
$$;

revoke all on function public.list_registered_players() from public, anon;
grant execute on function public.list_registered_players() to authenticated;

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.visitas enable row level security;

-- Perfiles: cada usuario solo puede consultar su perfil;
-- el administrador puede consultar perfiles para gestionar inscripciones.
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
  on public.profiles for select to authenticated
  using (
    auth.uid() = id
    or auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid
  );

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Torneos: lectura pública para visitantes y usuarios autenticados.
-- Todas las escrituras quedan reservadas al UID administrador de FEFUTIN.
drop policy if exists "tournaments_select_authenticated" on public.tournaments;
drop policy if exists "tournaments_select_public" on public.tournaments;
create policy "tournaments_select_public"
  on public.tournaments for select to anon, authenticated
  using (true);

drop policy if exists "tournaments_insert_creator" on public.tournaments;
drop policy if exists "tournaments_insert_admin" on public.tournaments;
create policy "tournaments_insert_admin"
  on public.tournaments for insert to authenticated
  with check (auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid);

drop policy if exists "tournaments_update_creator" on public.tournaments;
drop policy if exists "tournaments_update_admin" on public.tournaments;
create policy "tournaments_update_admin"
  on public.tournaments for update to authenticated
  using (auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid)
  with check (auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid);

drop policy if exists "tournaments_delete_creator" on public.tournaments;
drop policy if exists "tournaments_delete_admin" on public.tournaments;
create policy "tournaments_delete_admin"
  on public.tournaments for delete to authenticated
  using (auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid);

-- Visitas: cada usuario autenticado solo puede consultar/insertar/actualizar
-- sus propias visitas. No se habilita lectura pública de correos ni actividad.
drop policy if exists "visitas_select_own" on public.visitas;
create policy "visitas_select_own"
  on public.visitas for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "visitas_select_admin" on public.visitas;
create policy "visitas_select_admin"
  on public.visitas for select to authenticated
  using (auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid);

drop policy if exists "visitas_insert_own" on public.visitas;
create policy "visitas_insert_own"
  on public.visitas for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "visitas_update_own" on public.visitas;
create policy "visitas_update_own"
  on public.visitas for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.profiles to authenticated;
grant select on public.tournaments to anon, authenticated;
grant insert, update, delete on public.tournaments to authenticated;
grant select, insert, update on public.visitas to authenticated;
