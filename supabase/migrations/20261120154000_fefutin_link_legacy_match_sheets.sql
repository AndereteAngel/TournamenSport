-- FEFUTIN: conectar planillas individuales y fotografias existentes con los partidos UUID migrados.
begin;

update public.fefutin_match_sheets sheet
set normalized_match_id = match.id,
    turn_id = category.turn_id,
    tournament_category_id = category.id
from public.fefutin_matches match
join public.fefutin_rounds round on round.id = match.round_id
join public.fefutin_tournament_categories category
  on category.id = round.tournament_category_id
where sheet.normalized_match_id is null
  and sheet.tournament_id = match.legacy_tournament_id
  and sheet.match_id = match.legacy_match_id;

commit;
