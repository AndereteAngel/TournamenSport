-- FEFUTIN: lectura pública y administración exclusiva de torneos.
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- El UID debe coincidir con VITE_ADMIN_USER_ID en el despliegue.

alter table public.tournaments enable row level security;
alter table public.visitas enable row level security;

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

drop policy if exists "visitas_select_admin" on public.visitas;
create policy "visitas_select_admin"
  on public.visitas for select to authenticated
  using (auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid);

revoke insert, update, delete on public.tournaments from anon, public;
grant select on public.tournaments to anon, authenticated;
grant insert, update, delete on public.tournaments to authenticated;

drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
  on public.profiles for select to authenticated
  using (auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid);

create or replace function public.list_registered_players()
returns table (id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $
  select p.id, p.username
  from public.profiles p
  where auth.uid() = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid
  order by lower(p.username);
$;

revoke all on function public.list_registered_players() from public, anon;
grant execute on function public.list_registered_players() to authenticated;
