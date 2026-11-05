-- FEFUTIN: habilitar gestion de torneos para administradores y directivos aprobados.
-- La eliminacion permanece reservada exclusivamente al administrador.

begin;

create or replace function public.has_fefutin_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = any (p_roles)
      and p.approval_status = 'aprobado'
      and p.deactivated_at is null
  );
$$;

revoke all on function public.has_fefutin_role(text[]) from public, anon;
grant execute on function public.has_fefutin_role(text[]) to authenticated;

drop policy if exists tournaments_insert_admin on public.tournaments;
drop policy if exists tournaments_insert_management on public.tournaments;
create policy tournaments_insert_management
on public.tournaments
for insert
to authenticated
with check (
  (auth.uid() = '006b7cfc-6517-4e66-8892-1bb5b9931115'::uuid
   or public.has_fefutin_role(array['directivo']))
  and created_by_user_id = auth.uid()
);

drop policy if exists tournaments_update_admin on public.tournaments;
drop policy if exists tournaments_update_management on public.tournaments;
create policy tournaments_update_management
on public.tournaments
for update
to authenticated
using (
  (auth.uid() = '006b7cfc-6517-4e66-8892-1bb5b9931115'::uuid
   or public.has_fefutin_role(array['directivo']))
)
with check (
  public.has_fefutin_role(array['admin', 'directivo'])
);

commit;
