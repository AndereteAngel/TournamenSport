-- FEFUTIN: exponer el origen legacy de cada partido normalizado para evitar duplicados en la vista arbitral.
begin;

create or replace function public.get_fefutin_referee_journeys()
returns table (
  turn_journey_id uuid,
  turn_id uuid,
  tournament_id uuid,
  tournament_title text,
  branch_name text,
  turno text,
  journey_number integer,
  scheduled_date date,
  matches jsonb
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
     or v_profile.role not in ('arbitro', 'admin', 'directivo') then
    raise exception 'No tenes permisos para consultar las jornadas arbitrales';
  end if;

  return query
  select
    tj.id,
    tt.id,
    t.id,
    t.title,
    b.name,
    tt.turno,
    tj.journey_number,
    tj.scheduled_date,
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'match_id', m.id,
        'round_id', r.id,
        'turn_id', tt.id,
        'tournament_category_id', tc.id,
        'category_id', cat.id,
        'category', cat.name,
        'categoria', cat.name,
        'category_label', b.name || ' · ' || cat.name,
        'team1', local_club.name,
        'team2', visitor_club.name,
        'local_club_id', local_club.id,
        'visitor_club_id', visitor_club.id,
        'score1', m.local_score,
        'score2', m.visitor_score,
        'referee_id', m.referee_id,
        'referee_name', (select p.username from public.profiles p where p.id = m.referee_id),
        'referee_closed', m.status = 'finalizado' or m.referee_closed_at is not null,
        'referee_closed_at', m.referee_closed_at,
        'round', tj.journey_number,
        'match_date', coalesce(m.scheduled_date, tj.scheduled_date),
        'scheduled_time', m.scheduled_time,
        'venue_address', m.venue_address,
        'phase', 'normalized',
        'legacy_phase', m.legacy_phase,
        'legacy_group_index', m.legacy_group_index,
        'legacy_source_match_id', m.legacy_match_payload->>'id',
        'legacy_pending_review', exists (
          select 1
          from public.fefutin_legacy_match_migration_audit audit
          where audit.source_tournament_id = t.id
            and audit.migration_status = 'requiere_revision'
            and (
              nullif(trim(audit.match_payload->>'turno'), '') = tt.turno
              or t.fefutin_turno = tt.turno
              or t.game ilike '%' || tt.turno || '%'
              or (
                nullif(trim(audit.match_payload->>'turno'), '') is null
                and t.fefutin_turno is null
                and coalesce(t.game, '') not ilike '%Semanal%'
                and coalesce(t.game, '') not ilike '%Fin de semana%'
              )
            )
        ),
        'groupName', 'Jornada ' || tj.journey_number::text
      ) order by cat.sort_order, local_club.name, visitor_club.name, m.scheduled_time nulls last
    ) as matches
  from public.fefutin_turn_journeys tj
  join public.fefutin_tournament_turns tt on tt.id = tj.turn_id
  join public.tournaments t on t.id = tt.tournament_id
  join public.fefutin_branches b on b.id = t.fefutin_branch_id
  join public.fefutin_rounds r on r.turn_journey_id = tj.id
  join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
  join public.fefutin_categories cat on cat.id = tc.category_id
  join public.fefutin_matches m on m.round_id = r.id
  join public.fefutin_clubs local_club on local_club.id = m.local_club_id
  join public.fefutin_clubs visitor_club on visitor_club.id = m.visitor_club_id
  where (
    v_profile.role in ('admin', 'directivo')
    or exists (
      select 1
      from public.fefutin_matches assigned
      join public.fefutin_rounds assigned_round on assigned_round.id = assigned.round_id
      where assigned_round.turn_journey_id = tj.id
        and assigned.referee_id = auth.uid()
    )
  )
  group by tj.id, tt.id, t.id, t.title, b.name, tt.turno, tj.journey_number, tj.scheduled_date
  order by tj.scheduled_date nulls last, b.name, tt.turno, tj.journey_number;
end;
$function$;

revoke all on function public.get_fefutin_referee_journeys() from public, anon;
grant execute on function public.get_fefutin_referee_journeys() to authenticated;

commit;
