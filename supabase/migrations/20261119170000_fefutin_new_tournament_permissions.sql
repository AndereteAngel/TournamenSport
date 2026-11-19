-- FEFUTIN: permisos iniciales para el nuevo modelo de torneos por rama y turno.
-- Lectura pública de torneos/categorías; escritura solo para Admin y Directivo aprobados.

begin;

create or replace function public.fefutin_puede_gestionar_torneos_nuevos()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'directivo')
      and p.approval_status = 'aprobado'
      and p.deactivated_at is null
  );
$$;

revoke all on function public.fefutin_puede_gestionar_torneos_nuevos() from public, anon;
grant execute on function public.fefutin_puede_gestionar_torneos_nuevos() to authenticated;

alter table public.fefutin_branches enable row level security;
alter table public.fefutin_torneos enable row level security;
alter table public.fefutin_torneo_categorias enable row level security;
alter table public.fefutin_competencias enable row level security;

drop policy if exists fefutin_branches_public_active_read on public.fefutin_branches;
create policy fefutin_branches_public_active_read
  on public.fefutin_branches
  for select to anon, authenticated
  using (active = true);

drop policy if exists fefutin_torneos_public_read on public.fefutin_torneos;
create policy fefutin_torneos_public_read
  on public.fefutin_torneos
  for select to anon, authenticated
  using (true);

drop policy if exists fefutin_torneos_manager_insert on public.fefutin_torneos;
create policy fefutin_torneos_manager_insert
  on public.fefutin_torneos
  for insert to authenticated
  with check (public.fefutin_puede_gestionar_torneos_nuevos());

drop policy if exists fefutin_torneos_manager_update on public.fefutin_torneos;
create policy fefutin_torneos_manager_update
  on public.fefutin_torneos
  for update to authenticated
  using (public.fefutin_puede_gestionar_torneos_nuevos())
  with check (public.fefutin_puede_gestionar_torneos_nuevos());

drop policy if exists fefutin_torneos_manager_delete on public.fefutin_torneos;
create policy fefutin_torneos_manager_delete
  on public.fefutin_torneos
  for delete to authenticated
  using (public.fefutin_puede_gestionar_torneos_nuevos());

drop policy if exists fefutin_torneo_categorias_public_read on public.fefutin_torneo_categorias;
create policy fefutin_torneo_categorias_public_read
  on public.fefutin_torneo_categorias
  for select to anon, authenticated
  using (true);

drop policy if exists fefutin_torneo_categorias_manager_insert on public.fefutin_torneo_categorias;
create policy fefutin_torneo_categorias_manager_insert
  on public.fefutin_torneo_categorias
  for insert to authenticated
  with check (public.fefutin_puede_gestionar_torneos_nuevos());

drop policy if exists fefutin_torneo_categorias_manager_update on public.fefutin_torneo_categorias;
create policy fefutin_torneo_categorias_manager_update
  on public.fefutin_torneo_categorias
  for update to authenticated
  using (public.fefutin_puede_gestionar_torneos_nuevos())
  with check (public.fefutin_puede_gestionar_torneos_nuevos());

drop policy if exists fefutin_torneo_categorias_manager_delete on public.fefutin_torneo_categorias;
create policy fefutin_torneo_categorias_manager_delete
  on public.fefutin_torneo_categorias
  for delete to authenticated
  using (public.fefutin_puede_gestionar_torneos_nuevos());

drop policy if exists fefutin_competencias_public_read on public.fefutin_competencias;
create policy fefutin_competencias_public_read
  on public.fefutin_competencias
  for select to anon, authenticated
  using (true);

grant select on public.fefutin_branches to anon, authenticated;
grant select, insert, update, delete on public.fefutin_torneos to authenticated;
grant select on public.fefutin_torneos to anon;
grant select, insert, update, delete on public.fefutin_torneo_categorias to authenticated;
grant select on public.fefutin_torneo_categorias to anon;
grant select on public.fefutin_competencias to anon, authenticated;

-- El registro en tournaments funciona solo como proyección para las pantallas
-- actuales. La marca JSON evita habilitar estas escrituras para torneos antiguos.
drop policy if exists tournaments_insert_fefutin_normalized on public.tournaments;
create policy tournaments_insert_fefutin_normalized
  on public.tournaments
  for insert to authenticated
  with check (
    public.fefutin_puede_gestionar_torneos_nuevos()
    and created_by_user_id = auth.uid()
    and groups -> 0 ->> 'fefutin_normalized' = 'true'
  );

drop policy if exists tournaments_delete_fefutin_normalized on public.tournaments;
create policy tournaments_delete_fefutin_normalized
  on public.tournaments
  for delete to authenticated
  using (
    public.fefutin_puede_gestionar_torneos_nuevos()
    and groups -> 0 ->> 'fefutin_normalized' = 'true'
  );

commit;
