-- FEFUTIN: proxima jornada normalizada del club del referente.
-- Devuelve solo los partidos del club dentro de la jornada mas cercana de cualquiera de sus turnos.
begin;

create or replace function public.get_fefutin_my_next_turn_journey()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_next record;
  v_result jsonb;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'No tenes permisos para consultar la proxima jornada del club';
  end if;

  select
    j.id as turn_journey_id,
    j.turn_id,
    j.journey_number,
    j.scheduled_date,
    tt.turno,
    tt.tournament_id,
    t.title as tournament_title,
    b.name as branch_name
  into v_next
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc
    on tc.id = tcc.tournament_category_id
  join public.fefutin_categories cat on cat.id = tc.category_id
  join public.fefutin_branches b on b.id = cat.branch_id
  join public.fefutin_rounds r on r.tournament_category_id = tc.id
  join public.fefutin_turn_journeys j on j.id = r.turn_journey_id
  join public.fefutin_tournament_turns tt on tt.id = tc.turn_id
  join public.tournaments t on t.id = tt.tournament_id
  join public.fefutin_matches m on m.round_id = r.id
  where tcc.club_id = v_profile.club_id
    and tcc.status = 'aprobado'
    and j.scheduled_date >= current_date
    and m.status <> 'finalizado'
    and (m.local_club_id = v_profile.club_id or m.visitor_club_id = v_profile.club_id)
  order by j.scheduled_date, j.journey_number,
    case tt.turno when 'Semanal' then 1 else 2 end,
    cat.sort_order
  limit 1;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'tournament_id', v_next.tournament_id,
    'tournament_title', v_next.tournament_title,
    'branch_name', v_next.branch_name,
    'turn_id', v_next.turn_id,
    'turno', v_next.turno,
    'turn_journey_id', v_next.turn_journey_id,
    'journey_number', v_next.journey_number,
    'scheduled_date', v_next.scheduled_date,
    'club_id', v_profile.club_id,
    'matches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'round_id', r.id,
          'turn_id', v_next.turn_id,
          'turn_journey_id', v_next.turn_journey_id,
          'journey_number', v_next.journey_number,
          'match_date', coalesce(m.scheduled_date, v_next.scheduled_date),
          'scheduled_time', case when m.scheduled_time is null then null else to_char(m.scheduled_time, 'HH24:MI') end,
          'venue_address', coalesce(nullif(trim(m.venue_address), ''), nullif(trim(home_club.headquarters_address), '')),
          'categoria', b.name || ' · ' || cat.name,
          'category_name', cat.name,
          'team1', home_club.name,
          'team2', away_club.name,
          'score1', m.local_score,
          'score2', m.visitor_score,
          'local_logo_path', home_club.logo_path,
          'visitor_logo_path', away_club.logo_path,
          'local_address', home_club.headquarters_address,
          'visitor_address', away_club.headquarters_address,
          'referee_id', m.referee_id,
          'referee_closed', (m.status = 'finalizado' or m.referee_closed_at is not null),
          'status', m.status
        ) order by cat.sort_order, m.scheduled_time nulls last, home_club.name
      )
      from public.fefutin_matches m
      join public.fefutin_rounds r on r.id = m.round_id
      join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
      join public.fefutin_categories cat on cat.id = tc.category_id
      join public.fefutin_branches b on b.id = cat.branch_id
      join public.fefutin_tournament_category_clubs tcc
        on tcc.tournament_category_id = tc.id
       and tcc.club_id = v_profile.club_id
       and tcc.status = 'aprobado'
      join public.fefutin_clubs home_club on home_club.id = m.local_club_id
      join public.fefutin_clubs away_club on away_club.id = m.visitor_club_id
      where r.turn_journey_id = v_next.turn_journey_id
        and (m.local_club_id = v_profile.club_id or m.visitor_club_id = v_profile.club_id)
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_fefutin_my_next_turn_journey() from public, anon;
grant execute on function public.get_fefutin_my_next_turn_journey() to authenticated;

commit;
