-- FEFUTIN: mostrar clubes habilitados en la pantalla pública de cada torneo.
begin;

create or replace function public.get_fefutin_tournament_clubs(p_tournament_id uuid)
returns table (
  club_tournament_id uuid,
  club_name text,
  logo_path text,
  category_label text,
  team_status text,
  player_count bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    ct.id,
    c.name,
    c.logo_path,
    ct.category_label,
    ft.status,
    count(pl.id)
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  left join public.fefutin_teams ft on ft.club_tournament_id = ct.id
  left join public.fefutin_team_players pl on pl.team_id = ft.id
  where ct.tournament_id = p_tournament_id
    and c.is_active = true
  group by ct.id, c.name, c.logo_path, ct.category_label, ft.status
  order by c.name, ct.category_label;
$$;

revoke all on function public.get_fefutin_tournament_clubs(uuid) from public;
grant execute on function public.get_fefutin_tournament_clubs(uuid) to anon, authenticated;

commit;
