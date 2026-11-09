-- Panel de administración FEFUTIN: lista completa de jugadores y estado de carnet.
begin;

create or replace function public.get_fefutin_player_admin_list()
returns table (
  player_entry_id uuid,
  first_name text,
  last_name text,
  dni text,
  birth_date date,
  jersey_number text,
  photo_path text,
  club_id uuid,
  club_name text,
  tournament_id uuid,
  tournament_title text,
  category_label text,
  approval_status text,
  carnet_number text,
  carnet_status text
)
language plpgsql
security definer
set search_path = ''
as $$
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
    raise exception 'Solo Admin o Directivo aprobado puede consultar el padrón de jugadores';
  end if;

  return query
  select
    pl.id,
    pl.first_name::text,
    pl.last_name::text,
    pl.dni::text,
    pl.birth_date,
    pl.jersey_number::text,
    pl.photo_path::text,
    c.id,
    c.name::text,
    t.id,
    t.title::text,
    ct.category_label::text,
    pl.approval_status::text,
    fp.carnet_number::text,
    coalesce(fp.carnet_status, 'pendiente')::text
  from public.fefutin_team_players pl
  join public.fefutin_teams ft on ft.id = pl.team_id
  join public.fefutin_club_tournaments ct on ct.id = ft.club_tournament_id
  join public.fefutin_clubs c on c.id = ct.club_id
  join public.tournaments t on t.id = ct.tournament_id
  left join public.fefutin_players fp on fp.id = pl.registry_player_id
  where c.is_active = true
  order by c.name, ct.category_label, pl.last_name, pl.first_name;
end;
$$;

revoke all on function public.get_fefutin_player_admin_list() from public, anon;
grant execute on function public.get_fefutin_player_admin_list() to authenticated;

commit;
