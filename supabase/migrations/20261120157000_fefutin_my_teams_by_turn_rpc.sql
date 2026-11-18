-- FEFUTIN: consulta de equipos del referente diferenciada por turno.
begin;

create or replace function public.get_fefutin_my_turn_teams()
returns table (
  club_id uuid,
  club_name text,
  headquarters_address text,
  logo_path text,
  club_tournament_id uuid,
  tournament_id uuid,
  tournament_title text,
  category_label text,
  team_id uuid,
  team_status text,
  submitted_at timestamptz,
  players jsonb,
  turn_id uuid,
  turno text
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
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.role not in ('referente', 'admin', 'directivo') then
    raise exception 'No tenes permisos para consultar las fichas de equipos';
  end if;

  if v_profile.role = 'referente' and v_profile.club_id is null then
    raise exception 'Tu usuario todavia no tiene un club asociado';
  end if;

  return query
  select
    c.id,
    c.name,
    c.headquarters_address,
    c.logo_path,
    ct.id,
    ct.tournament_id,
    t.title,
    ct.category_label,
    ft.id,
    ft.status,
    ft.submitted_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pl.id,
          'first_name', pl.first_name,
          'last_name', pl.last_name,
          'dni', pl.dni,
          'birth_date', pl.birth_date,
          'jersey_number', pl.jersey_number,
          'carnet_number', pl.carnet_number,
          'sort_order', pl.sort_order
        ) order by pl.sort_order, pl.created_at
      )
      from public.fefutin_team_players pl
      where pl.team_id = ft.id
    ), '[]'::jsonb),
    ct.turn_id,
    tt.turno
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  join public.tournaments t on t.id = ct.tournament_id
  left join public.fefutin_teams ft on ft.club_tournament_id = ct.id
  left join public.fefutin_tournament_turns tt on tt.id = ct.turn_id
  where c.is_active = true
    and (v_profile.role in ('admin', 'directivo') or c.id = v_profile.club_id)
  order by c.name, t.title, tt.turno, ct.category_label;
end;
$function$;

revoke all on function public.get_fefutin_my_turn_teams() from public, anon;
grant execute on function public.get_fefutin_my_turn_teams() to authenticated;

commit;
