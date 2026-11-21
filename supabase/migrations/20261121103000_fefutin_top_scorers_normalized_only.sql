-- FEFUTIN: la tabla de goleadores usa exclusivamente partidos normalizados
-- cerrados digitalmente y separa los registros por categoría. Las planillas del
-- sistema anterior quedan fuera.
begin;

drop function if exists public.get_fefutin_tournament_top_scorers(uuid);

create function public.get_fefutin_tournament_top_scorers(
  p_tournament_id uuid
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
    max(nullif(trim(s.categoria), ''))::text as categoria,
    sum(greatest(coalesce(p.goles, 0), 0))::bigint as goles
  from public.fefutin_match_sheet_players p
  join public.fefutin_match_sheets s on s.id = p.match_sheet_id
  join public.fefutin_matches m
    on m.id = s.normalized_match_id
   and m.status = 'finalizado'
  where s.tournament_id = p_tournament_id
    and s.normalized_match_id is not null
    and lower(trim(coalesce(s.estado, ''))) in ('cerrada', 'cerrado')
    and p.player_id is not null
  group by
    p.player_id,
    lower(trim(coalesce(p.club, ''))),
    lower(trim(coalesce(s.categoria, '')))
  having sum(greatest(coalesce(p.goles, 0), 0)) > 0
  order by goles desc, jugador asc, club asc;
$function$;

revoke all on function public.get_fefutin_tournament_top_scorers(uuid) from public;
grant execute on function public.get_fefutin_tournament_top_scorers(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
