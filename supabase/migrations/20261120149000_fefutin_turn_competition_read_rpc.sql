-- FEFUTIN: consulta de un turno con categorias, jornadas y todos sus partidos.
begin;

create or replace function public.get_fefutin_turn_competition(
  p_turn_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_turn public.fefutin_tournament_turns%rowtype;
  v_tournament public.tournaments%rowtype;
  v_branch_name text;
  v_categories jsonb;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  select tt.* into v_turn
  from public.fefutin_tournament_turns tt
  where tt.id = p_turn_id;

  if not found then
    raise exception 'No se encontro el turno seleccionado';
  end if;

  select t.* into v_tournament
  from public.tournaments t
  where t.id = v_turn.tournament_id;

  select b.name into v_branch_name
  from public.fefutin_branches b
  where b.id = v_tournament.fefutin_branch_id;

  if not coalesce(v_tournament.is_public, false)
     and coalesce(v_profile.role, '') not in ('admin', 'directivo') then
    raise exception 'No tenes permisos para consultar esta competencia';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tournament_category_id', tc.id,
        'category_id', cat.id,
        'name', cat.name,
        'format', tc.format,
        'status', tc.status,
        'settings', tc.settings,
        'sort_order', cat.sort_order,
        'clubs', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'club_id', c.id,
                'club_name', c.name,
                'logo_path', c.logo_path,
                'headquarters_address', c.headquarters_address
              ) order by c.name
            ),
            '[]'::jsonb
          )
          from public.fefutin_tournament_category_clubs tcc
          join public.fefutin_clubs c on c.id = tcc.club_id
          where tcc.tournament_category_id = tc.id
            and tcc.status = 'aprobado'
            and c.is_active = true
        ),
        'rounds', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'round_id', r.id,
                'round_number', r.round_number,
                'name', r.name,
                'scheduled_date', r.scheduled_date,
                'turn_journey_id', r.turn_journey_id,
                'matches', (
                  select coalesce(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', m.id,
                        'round_id', r.id,
                        'turn_id', tt.id,
                        'tournament_category_id', tc.id,
                        'category_id', cat.id,
                        'category', cat.name,
                        'categoria', cat.name,
                        'category_label', v_branch_name || ' · ' || cat.name,
                        'team1', local_club.name,
                        'team2', visitor_club.name,
                        'local_club_id', local_club.id,
                        'visitor_club_id', visitor_club.id,
                        'score1', m.local_score,
                        'score2', m.visitor_score,
                        'referee_id', m.referee_id,
                        'referee_closed', m.status = 'finalizado' or m.referee_closed_at is not null,
                        'round', r.round_number,
                        'match_date', coalesce(m.scheduled_date, r.scheduled_date),
                        'scheduled_time', m.scheduled_time,
                        'venue_address', m.venue_address,
                        'status', m.status,
                        'phase', 'normalized'
                      ) order by m.scheduled_time nulls last, local_club.name
                    ),
                    '[]'::jsonb
                  )
                  from public.fefutin_matches m
                  join public.fefutin_clubs local_club on local_club.id = m.local_club_id
                  join public.fefutin_clubs visitor_club on visitor_club.id = m.visitor_club_id
                  where m.round_id = r.id
                )
              ) order by r.round_number
            ),
            '[]'::jsonb
          )
          from public.fefutin_rounds r
          where r.tournament_category_id = tc.id
        )
      ) order by cat.sort_order, cat.name
    ),
    '[]'::jsonb
  )
  into v_categories
  from public.fefutin_tournament_categories tc
  join public.fefutin_categories cat on cat.id = tc.category_id
  where tc.turn_id = p_turn_id;

  return jsonb_build_object(
    'turn_id', v_turn.id,
    'tournament_id', v_tournament.id,
    'tournament_title', v_tournament.title,
    'branch_name', v_branch_name,
    'turno', v_turn.turno,
    'turn_status', v_turn.status,
    'categories', v_categories
  );
end;
$function$;

revoke all on function public.get_fefutin_turn_competition(uuid) from public;
grant execute on function public.get_fefutin_turn_competition(uuid) to anon, authenticated;

commit;
