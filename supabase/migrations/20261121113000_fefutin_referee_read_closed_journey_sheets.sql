-- FEFUTIN: el árbitro que tiene una designación en una jornada puede
-- consultar las planillas cerradas de los demás partidos de esa misma jornada
-- para completar el archivo fotográfico conjunto. No habilita edición ni lectura
-- de partidos de otras jornadas.
begin;

drop policy if exists fefutin_match_sheets_normalized_select
  on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_select
on public.fefutin_match_sheets
for select to authenticated
using (
  normalized_match_id is not null
  and exists (
    select 1
    from public.fefutin_matches target_match
    join public.fefutin_rounds target_round
      on target_round.id = target_match.round_id
    where target_match.id = normalized_match_id
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and (
            target_match.referee_id = auth.uid()
            or (
              lower(trim(coalesce(estado, ''))) in ('cerrada', 'cerrado')
              and exists (
                select 1
                from public.fefutin_matches assigned_match
                join public.fefutin_rounds assigned_round
                  on assigned_round.id = assigned_match.round_id
                where assigned_match.referee_id = auth.uid()
                  and assigned_round.turn_journey_id = target_round.turn_journey_id
              )
            )
          )
        )
      )
  )
);

commit;
