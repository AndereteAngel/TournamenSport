-- FEFUTIN: permitir que arbitros activos consulten clubes e inscripciones
-- para confeccionar las planillas de los partidos que tienen asignados.
begin;

grant select on public.fefutin_club_tournaments to authenticated;
drop policy if exists "fefutin_club_tournaments_select_referee" on public.fefutin_club_tournaments;
create policy "fefutin_club_tournaments_select_referee"
  on public.fefutin_club_tournaments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'arbitro'
        and p.approval_status = 'aprobado'
        and p.deactivated_at is null
    )
  );

grant select on public.fefutin_clubs to authenticated;
drop policy if exists "fefutin_clubs_select_referee" on public.fefutin_clubs;
create policy "fefutin_clubs_select_referee"
  on public.fefutin_clubs
  for select
  to authenticated
  using (
    is_active = true
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'arbitro'
        and p.approval_status = 'aprobado'
        and p.deactivated_at is null
    )
  );

commit;
