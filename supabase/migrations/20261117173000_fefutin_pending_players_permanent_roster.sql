-- FEFUTIN: conectar el buzón de altas generales con los planteles permanentes.
-- La versión anterior consultaba fefutin_team_players (tabla legacy), mientras
-- el flujo vigente guarda las altas en fefutin_club_roster_players.
begin;

create or replace function public.get_fefutin_pending_players()
returns table (
  player_entry_id uuid,
  team_id uuid,
  club_name text,
  tournament_title text,
  category_label text,
  first_name text,
  last_name text,
  dni text,
  birth_date date,
  jersey_number text,
  photo_path text,
  approval_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'No tenés permisos para revisar altas de jugadores';
  end if;

  return query
  select distinct on (rp.id)
    e.id,
    ft.id,
    c.name,
    t.title,
    cr.category_label,
    rp.first_name,
    rp.last_name,
    rp.dni,
    rp.birth_date,
    e.jersey_number,
    rp.photo_path,
    rp.approval_status
  from public.fefutin_club_roster_players rp
  join public.fefutin_club_rosters cr
    on cr.id = rp.roster_id
  join public.fefutin_clubs c
    on c.id = cr.club_id
  join public.fefutin_roster_tournament_entries e
    on e.roster_player_id = rp.id
  join public.fefutin_club_tournaments ct
    on ct.id = e.club_tournament_id
  join public.fefutin_teams ft
    on ft.club_tournament_id = ct.id
  join public.tournaments t
    on t.id = ct.tournament_id
  where rp.approval_status = 'pendiente'
  order by rp.id, e.created_at desc, t.created_at desc;
end;
$function$;

revoke all on function public.get_fefutin_pending_players() from public, anon;
grant execute on function public.get_fefutin_pending_players() to authenticated;

commit;
