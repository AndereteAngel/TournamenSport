-- FEFUTIN: completar la expansion de inscripciones historicas TODA LA TIRA.
-- Es idempotente y cubre instalaciones donde la migracion base de turnos ya habia sido aplicada.
begin;

-- Crear una participacion normalizada por cada categoria del turno original.
insert into public.fefutin_tournament_category_clubs (
  tournament_category_id, club_id, status, requested_at, reviewed_at
)
select
  tc.id,
  legacy.club_id,
  'aprobado',
  legacy.created_at,
  legacy.created_at
from public.fefutin_club_tournaments legacy
join public.fefutin_tournament_turns tt
  on tt.id = legacy.turn_id
 and tt.tournament_id = legacy.tournament_id
join public.fefutin_tournament_categories tc on tc.turn_id = tt.id
where lower(trim(legacy.category_label)) = 'toda la tira'
on conflict (tournament_category_id, club_id) do nothing;

-- Crear la relacion legacy por categoria para activar el seed de planteles permanentes.
-- La fila TODA LA TIRA original no se borra ni se modifica.
insert into public.fefutin_club_tournaments (
  club_id, tournament_id, turn_id, category_label
)
select
  legacy.club_id,
  legacy.tournament_id,
  legacy.turn_id,
  b.name || ' · ' || cat.name
from public.fefutin_club_tournaments legacy
join public.fefutin_tournament_categories tc on tc.turn_id = legacy.turn_id
join public.fefutin_categories cat on cat.id = tc.category_id
join public.fefutin_branches b on b.id = cat.branch_id
where lower(trim(legacy.category_label)) = 'toda la tira'
  and legacy.turn_id is not null
on conflict (club_id, tournament_id, turn_id, category_label)
  where turn_id is not null
  do nothing;

-- Vincular los jugadores que el trigger haya sembrado desde el plantel permanente.
insert into public.fefutin_category_club_players (
  tournament_category_club_id, roster_player_id, jersey_number, sort_order, status
)
select
  tcc.id,
  entry.roster_player_id,
  entry.jersey_number,
  entry.sort_order,
  case entry.approval_status
    when 'aprobado' then 'aprobado'
    when 'rechazado' then 'rechazado'
    else 'pendiente'
  end
from public.fefutin_club_tournaments legacy
join public.fefutin_tournament_categories tc
  on tc.turn_id = legacy.turn_id
join public.fefutin_categories cat on cat.id = tc.category_id
join public.fefutin_branches b on b.id = cat.branch_id
join public.fefutin_tournament_category_clubs tcc
  on tcc.tournament_category_id = tc.id
 and tcc.club_id = legacy.club_id
 and tcc.status = 'aprobado'
join public.fefutin_roster_tournament_entries entry
  on entry.club_tournament_id = legacy.id
where lower(trim(legacy.category_label)) = lower(trim(b.name || ' · ' || cat.name))
on conflict (tournament_category_club_id, roster_player_id) do nothing;

commit;
