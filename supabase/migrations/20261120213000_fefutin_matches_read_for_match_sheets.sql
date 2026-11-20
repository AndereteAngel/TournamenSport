-- FEFUTIN: permite consultar partidos normalizados a los roles que gestionan su planilla.
-- El acceso queda limitado a administradores/directivos y al árbitro asignado.
begin;

grant select on public.fefutin_matches to authenticated;

drop policy if exists fefutin_matches_match_sheet_read on public.fefutin_matches;
create policy fefutin_matches_match_sheet_read
on public.fefutin_matches
for select
to authenticated
using (
  public.has_fefutin_role(array['admin','directivo'])
  or (
    public.has_fefutin_role(array['arbitro'])
    and referee_id = auth.uid()
  )
);

notify pgrst, 'reload schema';
commit;
