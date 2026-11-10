-- FEFUTIN: tabla pública de goleadores por torneo.
-- Solo computa jugadores y goles de planillas oficialmente cerradas.
begin;

create or replace function public.get_fefutin_tournament_top_scorers(
  p_tournament_id uuid
)
returns table (
  player_id uuid,
  jugador text,
  club text,
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
    sum(greatest(coalesce(p.goles, 0), 0))::bigint as goles
  from public.fefutin_match_sheet_players p
  join public.fefutin_match_sheets s on s.id = p.match_sheet_id
  where s.tournament_id = p_tournament_id
    and lower(trim(coalesce(s.estado, ''))) in ('cerrada', 'cerrado')
    and p.player_id is not null
  group by p.player_id, lower(trim(coalesce(p.club, '')))
  having sum(greatest(coalesce(p.goles, 0), 0)) > 0
  order by goles desc, jugador asc, club asc;
$function$;

revoke all on function public.get_fefutin_tournament_top_scorers(uuid) from public;
grant execute on function public.get_fefutin_tournament_top_scorers(uuid) to anon, authenticated;

commit;
