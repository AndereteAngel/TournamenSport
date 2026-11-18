-- FEFUTIN: backfill de partidos legacy hacia UUID normalizados.
-- No elimina ni modifica tournaments.groups/playoffs; cada partido conserva su payload de origen.
begin;

do $migration$
declare
  v_tournament record;
  v_group record;
  v_match record;
  v_turn_id uuid;
  v_turn_count integer;
  v_category_id uuid;
  v_group_label text;
  v_category_name text;
  v_round_number integer;
  v_match_date date;
  v_match_time time;
  v_journey_id uuid;
  v_round_id uuid;
  v_local_id uuid;
  v_visitor_id uuid;
  v_local_name text;
  v_visitor_name text;
  v_source_match_id text;
  v_referee_id uuid;
  v_referee_closed_by uuid;
  v_score1 integer;
  v_score2 integer;
  v_is_closed boolean;
  v_reason text;
begin
  for v_tournament in
    select t.id, t.title, t.game, t.fefutin_turno, t.format, t.groups, t.playoffs
    from public.tournaments t
    where t.fefutin_branch_id is not null
  loop
    v_turn_id := null;
    v_turn_count := 0;

    select count(*)::integer into v_turn_count
    from public.fefutin_tournament_turns tt
    where tt.tournament_id = v_tournament.id;

    if coalesce(v_tournament.fefutin_turno, '') in ('Semanal', 'Fin de semana') then
      select tt.id into v_turn_id
      from public.fefutin_tournament_turns tt
      where tt.tournament_id = v_tournament.id
        and tt.turno = v_tournament.fefutin_turno;
    elsif coalesce(v_tournament.game, '') ilike '%Fin de semana%' then
      select tt.id into v_turn_id
      from public.fefutin_tournament_turns tt
      where tt.tournament_id = v_tournament.id and tt.turno = 'Fin de semana';
    elsif coalesce(v_tournament.game, '') ilike '%Semanal%' then
      select tt.id into v_turn_id
      from public.fefutin_tournament_turns tt
      where tt.tournament_id = v_tournament.id and tt.turno = 'Semanal';
    elsif v_turn_count = 1 then
      select min(tt.id) into v_turn_id
      from public.fefutin_tournament_turns tt
      where tt.tournament_id = v_tournament.id;
    end if;

    for v_group in
      select value, (ordinality - 1)::integer as group_index
      from jsonb_array_elements(
        case when jsonb_typeof(v_tournament.groups) = 'array' then v_tournament.groups else '[]'::jsonb end
      ) with ordinality
    loop
      if v_group.value->>'name' = '__INSCRIPCIONES__' then
        continue;
      end if;

      v_group_label := trim(coalesce(v_group.value->>'categoryLabel', v_group.value->>'name', ''));
      v_category_name := trim(regexp_replace(v_group_label, '^.*·', ''));

      v_category_id := null;
      if v_turn_id is not null then
        select tc.id into v_category_id
        from public.fefutin_tournament_categories tc
        join public.fefutin_categories cat on cat.id = tc.category_id
        where tc.turn_id = v_turn_id
          and (
            lower(trim(cat.name)) = lower(trim(v_category_name))
            or lower(trim(cat.name)) = lower(trim(v_group_label))
          )
        order by cat.sort_order
        limit 1;
      end if;

      for v_match in
        select value, (ordinality - 1)::integer as match_index
        from jsonb_array_elements(
          case when jsonb_typeof(v_group.value->'matches') = 'array' then v_group.value->'matches' else '[]'::jsonb end
        ) with ordinality
      loop
        v_local_name := trim(coalesce(v_match.value->>'team1', ''));
        v_visitor_name := trim(coalesce(v_match.value->>'team2', ''));
        v_source_match_id := coalesce(
          nullif(trim(v_match.value->>'id'), ''),
          'legacy-group-' || v_group.group_index::text || '-match-' || v_match.match_index::text
        );

        if v_local_name = '' or v_visitor_name = ''
           or lower(v_local_name) = 'pasaje directo'
           or lower(v_visitor_name) = 'pasaje directo' then
          continue;
        end if;

        v_reason := null;
        if v_turn_id is null then
          v_reason := 'No se pudo identificar un turno unico para el fixture legacy';
        elsif v_category_id is null then
          v_reason := 'No se pudo relacionar el grupo legacy con una categoria normalizada';
        end if;

        v_local_id := null;
        v_visitor_id := null;

        if v_reason is null then
          select c.id into v_local_id
          from public.fefutin_clubs c
          join public.fefutin_tournament_category_clubs tcc
            on tcc.club_id = c.id
           and tcc.tournament_category_id = v_category_id
           and tcc.status = 'aprobado'
          where lower(trim(c.name)) = lower(trim(v_local_name))
            and c.is_active = true
          limit 1;

          select c.id into v_visitor_id
          from public.fefutin_clubs c
          join public.fefutin_tournament_category_clubs tcc
            on tcc.club_id = c.id
           and tcc.tournament_category_id = v_category_id
           and tcc.status = 'aprobado'
          where lower(trim(c.name)) = lower(trim(v_visitor_name))
            and c.is_active = true
          limit 1;

          if v_local_id is null or v_visitor_id is null then
            v_reason := 'Uno o ambos clubes del fixture no tienen una inscripcion aprobada en esa categoria';
          end if;
        end if;

        if v_reason is not null then
          insert into public.fefutin_legacy_match_migration_audit (
            source_tournament_id, source_tournament_uuid, source_phase,
            source_group_index, source_match_id, match_payload,
            migration_status, reason
          )
          values (
            v_tournament.id, v_tournament.id::text, 'groups',
            v_group.group_index, v_source_match_id, v_match.value,
            'requiere_revision', v_reason
          );
          continue;
        end if;

        v_round_number := case
          when coalesce(v_match.value->>'round', '') ~ '^[0-9]+$'
            then greatest(1, (v_match.value->>'round')::integer)
          when coalesce(v_match.value->>'round_number', '') ~ '^[0-9]+$'
            then greatest(1, (v_match.value->>'round_number')::integer)
          else 1
        end;

        v_match_date := case
          when coalesce(v_match.value->>'match_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
            then (v_match.value->>'match_date')::date
          when coalesce(v_match.value->>'scheduled_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
            then (v_match.value->>'scheduled_date')::date
          else null
        end;

        v_match_time := case
          when coalesce(v_match.value->>'scheduled_time', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
            then (v_match.value->>'scheduled_time')::time
          else null
        end;

        insert into public.fefutin_turn_journeys (turn_id, journey_number, scheduled_date, status)
        values (v_turn_id, v_round_number, v_match_date, 'pendiente')
        on conflict (turn_id, journey_number) do update
          set scheduled_date = coalesce(public.fefutin_turn_journeys.scheduled_date, excluded.scheduled_date)
        returning id into v_journey_id;

        if v_journey_id is null then
          select tj.id into v_journey_id
          from public.fefutin_turn_journeys tj
          where tj.turn_id = v_turn_id and tj.journey_number = v_round_number;
        end if;

        insert into public.fefutin_rounds (
          tournament_category_id, turn_journey_id, round_number, name, scheduled_date, status
        )
        values (
          v_category_id, v_journey_id, v_round_number, 'Jornada ' || v_round_number::text,
          v_match_date, 'pendiente'
        )
        on conflict (tournament_category_id, round_number) do update
          set turn_journey_id = coalesce(public.fefutin_rounds.turn_journey_id, excluded.turn_journey_id),
              scheduled_date = coalesce(public.fefutin_rounds.scheduled_date, excluded.scheduled_date)
        returning id into v_round_id;

        if v_round_id is null then
          select r.id into v_round_id
          from public.fefutin_rounds r
          where r.tournament_category_id = v_category_id
            and r.round_number = v_round_number;
        end if;

        v_score1 := case when coalesce(v_match.value->>'score1', '') ~ '^[0-9]+$'
          then (v_match.value->>'score1')::integer else null end;
        v_score2 := case when coalesce(v_match.value->>'score2', '') ~ '^[0-9]+$'
          then (v_match.value->>'score2')::integer else null end;
        v_is_closed := coalesce((v_match.value->>'referee_closed')::boolean, false);
        v_referee_id := case when coalesce(v_match.value->>'referee_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (v_match.value->>'referee_id')::uuid else null end;
        v_referee_closed_by := case when coalesce(v_match.value->>'referee_closed_by', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (v_match.value->>'referee_closed_by')::uuid else null end;

        insert into public.fefutin_matches (
          round_id, local_club_id, visitor_club_id, scheduled_date, scheduled_time,
          venue_address, referee_id, local_score, visitor_score, status,
          referee_closed_at, referee_closed_by, legacy_tournament_id, legacy_phase,
          legacy_match_id, legacy_group_index, legacy_match_payload,
          local_name_snapshot, visitor_name_snapshot
        )
        values (
          v_round_id, v_local_id, v_visitor_id, v_match_date, v_match_time,
          nullif(trim(coalesce(v_match.value->>'venue_address', v_match.value->>'sede', '')), ''),
          v_referee_id, v_score1, v_score2,
          case when v_is_closed then 'finalizado'
               when v_score1 is not null or v_score2 is not null then 'en_juego'
               else 'programado' end,
          case when v_is_closed then coalesce(
            nullif(v_match.value->>'referee_closed_at', '')::timestamptz,
            nullif(v_match.value->>'result_loaded_at', '')::timestamptz,
            now()
          ) else null end,
          v_referee_closed_by,
          v_tournament.id, 'groups', v_source_match_id, v_group.group_index,
          v_match.value, v_local_name, v_visitor_name
        )
        on conflict do nothing;
      end loop;
    end loop;

    -- Los playoffs legacy quedan registrados para revision cuando no se pueden
    -- vincular inequívocamente a una categoria; el JSON original sigue intacto.
    if jsonb_typeof(v_tournament.playoffs) = 'array' then
      for v_group in
        select value, (ordinality - 1)::integer as group_index
        from jsonb_array_elements(v_tournament.playoffs) with ordinality
      loop
        for v_match in
          select value, (ordinality - 1)::integer as match_index
          from jsonb_array_elements(
            case when jsonb_typeof(v_group.value) = 'array' then v_group.value else '[]'::jsonb end
          ) with ordinality
        loop
          v_local_name := trim(coalesce(v_match.value->>'team1', ''));
          v_visitor_name := trim(coalesce(v_match.value->>'team2', ''));
          if v_local_name = '' or v_visitor_name = ''
             or lower(v_local_name) = 'pasaje directo'
             or lower(v_visitor_name) = 'pasaje directo' then
            continue;
          end if;

          v_source_match_id := coalesce(
            nullif(trim(v_match.value->>'id'), ''),
            'legacy-playoff-' || v_group.group_index::text || '-match-' || v_match.match_index::text
          );

          insert into public.fefutin_legacy_match_migration_audit (
            source_tournament_id, source_tournament_uuid, source_phase,
            source_round_index, source_match_id, match_payload,
            migration_status, reason
          )
          values (
            v_tournament.id, v_tournament.id::text, 'playoffs',
            v_group.group_index, v_source_match_id, v_match.value,
            'requiere_revision',
            'El playoff legacy debe vincularse a una categoria y fase normalizadas antes de migrarse'
          );
        end loop;
      end loop;
    end if;
  end loop;
end;
$migration$;

commit;
