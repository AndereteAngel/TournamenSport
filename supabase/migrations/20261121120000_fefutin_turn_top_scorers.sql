-- FEFUTIN: goleadores separados por turno y categoría.
-- Solo cuentan goles de planillas digitales nuevas, cerradas y vinculadas
-- a partidos normalizados finalizados. No consulta las tablas históricas.
begin;

create or replace function public.get_fefutin_turn_top_scorers(
  p_turn_id uuid
)
returns table (
  player_id uuid,
  jugador text,
  club text,
  categoria text,
  goles bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.player_id,
    max(trim(concat_ws(' ', nullif(trim(p.nombre), ''), nullif(trim(p.apellido), ''))))::text as jugador,
    max(trim(p.club))::text as club,
    max(cat.name)::text as categoria,
    sum(greatest(coalesce(p.goles, 0), 0))::bigint as goles
  from public.fefutin_match_sheet_players p
  join public.fefutin_match_sheets s on s.id = p.match_sheet_id
  join public.fefutin_matches m
    on m.id = s.normalized_match_id
   and m.status = 'finalizado'
   and m.referee_closed_at is not null
  join public.fefutin_rounds r on r.id = m.round_id
  join public.fefutin_tournament_categories tc
    on tc.id = r.tournament_category_id
   and tc.turn_id = p_turn_id
  join public.fefutin_categories cat on cat.id = tc.category_id
  join public.fefutin_tournament_turns tt on tt.id = tc.turn_id
  join public.tournaments t on t.id = tt.tournament_id
  where lower(trim(coalesce(s.estado, ''))) in ('cerrada', 'cerrado')
    and s.normalized_match_id is not null
    and p.player_id is not null
    and (
      t.is_public = true
      or public.has_fefutin_role(array['admin','directivo'])
    )
  group by
    p.player_id,
    lower(trim(coalesce(p.club, ''))),
    lower(trim(cat.name))
  having sum(greatest(coalesce(p.goles, 0), 0)) > 0
  order by goles desc, jugador asc, club asc;
$function$;

revoke all on function public.get_fefutin_turn_top_scorers(uuid) from public;
grant execute on function public.get_fefutin_turn_top_scorers(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
