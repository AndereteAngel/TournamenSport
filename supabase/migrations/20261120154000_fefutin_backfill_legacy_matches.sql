-- FEFUTIN: migrar partidos legacy verificables a UUID sin borrar JSON.
-- Solo importa fixtures todos-contra-todos con turno, categoria y ambos clubes identificados.
-- Todo lo demas queda en auditoria para revision; groups/playoffs permanecen intactos.
begin;

create unique index if not exists fefutin_legacy_match_audit_source_key
  on public.fefutin_legacy_match_migration_audit (
    source_tournament_uuid,
    source_phase,
    coalesce(source_group_index, -1),
    coalesce(source_round_index, -1),
    source_match_id
  );

create temporary table if not exists fefutin_turns_with_existing_fixture (
  turn_id uuid primary key
) on commit drop;

insert into fefutin_turns_with_existing_fixture(turn_id)
select distinct tt.id
from public.fefutin_tournament_turns tt
join public.fefutin_tournament_categories tc on tc.turn_id = tt.id
join public.fefutin_rounds r on r.tournament_category_id = tc.id
on conflict (turn_id) do nothing;

do $migration$
declare
  v_tournament record;
  v_group record;
  v_match record;
  v_playoff_round record;
  v_turn_id uuid;
  v_turno text;
  v_turn_count integer;
  v_category_id uuid;
  v_category_format text;
  v_category_raw text;
  v_category_name text;
  v_local_name text;
  v_visitor_name text;
  v_local_id uuid;
  v_visitor_id uuid;
  v_round_number integer;
  v_match_date date;
  v_score1 integer;
  v_score2 integer;
  v_referee_id uuid;
  v_referee_closed_by uuid;
  v_referee_closed boolean;
  v_referee_closed_at timestamptz;
  v_journey_id uuid;
  v_round_id uuid;
  v_source_id text;
  v_legacy_id text;
  v_reason text;
  v_group_index integer;
  v_round_index integer;
  v_status text;
begin
  for v_tournament in
    select t.id, t.title, t.game, t.fefutin_turno, t.groups, t.playoffs
    from public.tournaments t
    where t.fefutin_branch_id is not null
  loop
    if jsonb_typeof(v_tournament.groups) = 'array' then
      for v_group in
        select value, ordinality
        from jsonb_array_elements(v_tournament.groups) with ordinality
      loop
        if v_group.value->>'name' = '__INSCRIPCIONES__' then
          continue;
        end if;

        if coalesce(jsonb_typeof(v_group.value->'matches'), '') <> 'array' then
          continue;
        end if;

        v_group_index := (v_group.ordinality - 1)::integer;

        for v_match in
          select value, ordinality
          from jsonb_array_elements(v_group.value->'matches') with ordinality
        loop
          v_reason := null;
          v_turn_id := null;
          v_category_id := null;
          v_local_id := null;
          v_visitor_id := null;
          v_round_id := null;
          v_journey_id := null;
          v_category_format := null;

          v_source_id := coalesce(
            nullif(trim(v_match.value->>'id'), ''),
            'row'
          ) || '#m' || v_match.ordinality::text;
          v_legacy_id := 'g' || v_group_index::text || '-' || v_source_id;

          v_local_name := trim(coalesce(v_match.value->>'team1', ''));
          v_visitor_name := trim(coalesce(v_match.value->>'team2', ''));
          v_category_raw := coalesce(
            nullif(trim(v_match.value->>'category_label'), ''),
            nullif(trim(v_match.value->>'categoria'), ''),
            nullif(trim(v_group.value->>'categoryLabel'), ''),
            nullif(trim(v_group.value->>'name'), '')
          );
          v_category_name := case
            when position(' · ' in coalesce(v_category_raw, '')) > 0
              then regexp_replace(v_category_raw, '^.* · ', '')
            else v_category_raw
          end;

          if v_local_name = '' or v_visitor_name = '' then
            v_reason := 'Faltan los nombres de los dos clubes en el partido legacy.';
          elsif lower(v_local_name) = 'pasaje directo' or lower(v_visitor_name) = 'pasaje directo' then
            v_reason := 'El registro representa un pasaje directo y no un partido entre dos clubes.';
          end if;

          if v_reason is null then
            v_turno := nullif(trim(v_match.value->>'turno'), '');
            if v_turno not in ('Semanal', 'Fin de semana') then
              v_turno := null;
            end if;

            if v_turno is null and v_tournament.fefutin_turno in ('Semanal', 'Fin de semana') then
              v_turno := v_tournament.fefutin_turno;
            end if;
            if v_turno is null and coalesce(v_tournament.game, '') ilike '%Fin de semana%' then
              v_turno := 'Fin de semana';
            elsif v_turno is null and coalesce(v_tournament.game, '') ilike '%Semanal%' then
              v_turno := 'Semanal';
            end if;

            if v_turno is null then
              select count(*)::integer into v_turn_count
              from public.fefutin_tournament_turns tt
              where tt.tournament_id = v_tournament.id;
              if v_turn_count = 1 then
                select tt.turno into v_turno
                from public.fefutin_tournament_turns tt
                where tt.tournament_id = v_tournament.id;
              end if;
            end if;

            if v_turno is not null then
              select tt.id into v_turn_id
              from public.fefutin_tournament_turns tt
              where tt.tournament_id = v_tournament.id
                and tt.turno = v_turno;
            end if;

            if v_turn_id is null then
              v_reason := 'No se puede identificar de forma segura el turno del partido legacy.';
            elsif exists (
              select 1 from fefutin_turns_with_existing_fixture existing
              where existing.turn_id = v_turn_id
            ) then
              v_reason := 'El turno ya tiene un fixture normalizado. Se conserva este partido legacy para revision y no se mezcla con el nuevo fixture.';
            end if;
          end if;

          if v_reason is null then
            if nullif(v_category_name, '') is not null then
              select tc.id, tc.format
                into v_category_id, v_category_format
              from public.fefutin_tournament_categories tc
              join public.fefutin_categories cat on cat.id = tc.category_id
              join public.fefutin_branches b on b.id = cat.branch_id
              where tc.turn_id = v_turn_id
                and tc.tournament_id = v_tournament.id
                and (
                  lower(trim(cat.name)) = lower(trim(v_category_name))
                  or lower(trim(b.name || ' · ' || cat.name)) = lower(trim(v_category_raw))
                )
              order by cat.sort_order
              limit 1;
            else
              select count(*)::integer into v_turn_count
              from public.fefutin_tournament_categories tc
              where tc.turn_id = v_turn_id;
              if v_turn_count = 1 then
                select tc.id, tc.format
                  into v_category_id, v_category_format
                from public.fefutin_tournament_categories tc
                where tc.turn_id = v_turn_id;
              end if;
            end if;

            if v_category_id is null then
              select count(*)::integer into v_turn_count
              from public.fefutin_tournament_categories tc
              where tc.turn_id = v_turn_id;
              if v_turn_count = 1 then
                select tc.id, tc.format
                  into v_category_id, v_category_format
                from public.fefutin_tournament_categories tc
                where tc.turn_id = v_turn_id;
              end if;
            end if;

            if v_category_id is null then
              v_reason := 'No se pudo asociar el partido a una categoria concreta del turno.';
            elsif v_category_format <> 'league' then
              v_reason := 'El formato de esta categoria requiere una migracion especifica de grupos o eliminatorias.';
            end if;
          end if;

          if v_reason is null then
            if coalesce(v_match.value->>'round', '') ~ '^[0-9]+$' then
              v_round_number := (v_match.value->>'round')::integer;
            else
              v_round_number := null;
              v_reason := 'El partido no contiene un numero de jornada verificable.';
            end if;
          end if;

          if v_reason is null then
            v_match_date := case
              when coalesce(v_match.value->>'match_date', v_match.value->>'scheduled_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
                then coalesce(v_match.value->>'match_date', v_match.value->>'scheduled_date')::date
              else null
            end;

            select c.id into v_local_id
            from public.fefutin_clubs c
            where c.is_active = true
              and lower(trim(c.name)) = lower(trim(v_local_name))
            order by c.id
            limit 1;

            select c.id into v_visitor_id
            from public.fefutin_clubs c
            where c.is_active = true
              and lower(trim(c.name)) = lower(trim(v_visitor_name))
            order by c.id
            limit 1;

            if v_local_id is null or v_visitor_id is null then
              v_reason := 'Uno o ambos clubes del partido no coinciden con un club institucional activo.';
            elsif not exists (
              select 1 from public.fefutin_tournament_category_clubs tcc
              where tcc.tournament_category_id = v_category_id
                and tcc.club_id = v_local_id
                and tcc.status = 'aprobado'
            ) or not exists (
              select 1 from public.fefutin_tournament_category_clubs tcc
              where tcc.tournament_category_id = v_category_id
                and tcc.club_id = v_visitor_id
                and tcc.status = 'aprobado'
            ) then
              v_reason := 'Uno o ambos clubes no tienen participacion aprobada en la categoria normalizada.';
            end if;
          end if;

          if v_reason is null then
            v_referee_id := case
              when coalesce(v_match.value->>'referee_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               and exists (select 1 from auth.users u where u.id = (v_match.value->>'referee_id')::uuid)
                then (v_match.value->>'referee_id')::uuid
              else null
            end;
            v_referee_closed_by := case
              when coalesce(v_match.value->>'referee_closed_by', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               and exists (select 1 from auth.users u where u.id = (v_match.value->>'referee_closed_by')::uuid)
                then (v_match.value->>'referee_closed_by')::uuid
              else null
            end;
            v_referee_closed := lower(coalesce(v_match.value->>'referee_closed', 'false')) = 'true';
            v_referee_closed_at := case
              when coalesce(v_match.value->>'referee_closed_at', '') ~ '^\d{4}-\d{2}-\d{2}T'
                then (v_match.value->>'referee_closed_at')::timestamptz
              else null
            end;
            v_score1 := case when coalesce(v_match.value->>'score1', '') ~ '^\d+$' then (v_match.value->>'score1')::integer else null end;
            v_score2 := case when coalesce(v_match.value->>'score2', '') ~ '^\d+$' then (v_match.value->>'score2')::integer else null end;
            v_status := case when v_referee_closed then 'finalizado' else 'programado' end;

            insert into public.fefutin_turn_journeys as existing_journey (
              turn_id, journey_number, scheduled_date, status
            )
            values (
              v_turn_id, v_round_number, v_match_date, 'pendiente'
            )
            on conflict (turn_id, journey_number) do update
              set scheduled_date = coalesce(existing_journey.scheduled_date, excluded.scheduled_date)
            returning id into v_journey_id;

            insert into public.fefutin_rounds as existing_round (
              tournament_category_id, turn_journey_id, round_number, name, scheduled_date, status
            )
            values (
              v_category_id, v_journey_id, v_round_number, 'Jornada ' || v_round_number::text,
              v_match_date, 'pendiente'
            )
            on conflict (tournament_category_id, round_number) do update
              set turn_journey_id = coalesce(existing_round.turn_journey_id, excluded.turn_journey_id),
                  scheduled_date = coalesce(existing_round.scheduled_date, excluded.scheduled_date)
            returning id into v_round_id;

            insert into public.fefutin_matches (
              round_id, local_club_id, visitor_club_id, scheduled_date, scheduled_time,
              venue_address, referee_id, local_score, visitor_score, status,
              referee_closed_at, referee_closed_by, legacy_tournament_id, legacy_phase,
              legacy_match_id, legacy_group_index, legacy_round_index, legacy_match_payload,
              local_name_snapshot, visitor_name_snapshot
            )
            values (
              v_round_id, v_local_id, v_visitor_id, v_match_date,
              case
                when coalesce(v_match.value->>'scheduled_time', '') ~ '^\d{2}:\d{2}(:\d{2})?$'
                  then (v_match.value->>'scheduled_time')::time
                else null
              end,
              nullif(trim(coalesce(v_match.value->>'venue_address', v_match.value->>'sede', '')), ''),
              v_referee_id, v_score1, v_score2, v_status, v_referee_closed_at, v_referee_closed_by,
              v_tournament.id, 'groups', v_legacy_id, v_group_index, null, v_match.value,
              v_local_name, v_visitor_name
            )
            on conflict (legacy_tournament_id, legacy_phase, legacy_match_id)
              where legacy_tournament_id is not null and legacy_phase is not null and legacy_match_id is not null
              do nothing;
          end if;

          insert into public.fefutin_legacy_match_migration_audit (
            source_tournament_id, source_tournament_uuid, source_phase,
            source_group_index, source_round_index, source_match_id,
            match_payload, migration_status, reason, resolved_at
          )
          values (
            v_tournament.id, v_tournament.id::text, 'groups',
            v_group_index, null, v_source_id, v_match.value,
            case when v_reason is null then 'migrado' else 'requiere_revision' end,
            v_reason,
            case when v_reason is null then now() else null end
          )
          on conflict do nothing;
        end loop;
      end loop;
    end if;

    if jsonb_typeof(v_tournament.playoffs) = 'array' then
      for v_playoff_round in
        select value, ordinality
        from jsonb_array_elements(v_tournament.playoffs) with ordinality
      loop
        if coalesce(jsonb_typeof(v_playoff_round.value), '') <> 'array' then
          continue;
        end if;
        v_round_index := (v_playoff_round.ordinality - 1)::integer;

        for v_match in
          select value, ordinality
          from jsonb_array_elements(v_playoff_round.value) with ordinality
        loop
          v_source_id := coalesce(nullif(trim(v_match.value->>'id'), ''), 'row')
            || '#r' || v_playoff_round.ordinality::text || '-m' || v_match.ordinality::text;

          insert into public.fefutin_legacy_match_migration_audit (
            source_tournament_id, source_tournament_uuid, source_phase,
            source_group_index, source_round_index, source_match_id,
            match_payload, migration_status, reason
          )
          values (
            v_tournament.id, v_tournament.id::text, 'playoffs',
            null, v_round_index, v_source_id, v_match.value,
            'requiere_revision',
            'La fase de eliminatorias legacy necesita asociar su llave y categoria antes de migrarse.'
          )
          on conflict do nothing;
        end loop;
      end loop;
    end if;
  end loop;
end;
$migration$;

-- Actualizar el estado de la ronda/jornada solo cuando todos sus partidos quedaron cerrados.
update public.fefutin_rounds r
set status = 'finalizada',
    updated_at = now()
where exists (
  select 1 from public.fefutin_matches m
  where m.round_id = r.id
)
and not exists (
  select 1 from public.fefutin_matches m
  where m.round_id = r.id
    and m.status <> 'finalizado'
);

update public.fefutin_turn_journeys j
set status = 'finalizada',
    updated_at = now()
where exists (
  select 1
  from public.fefutin_rounds r
  join public.fefutin_matches m on m.round_id = r.id
  where r.turn_journey_id = j.id
)
and not exists (
  select 1
  from public.fefutin_rounds r
  join public.fefutin_matches m on m.round_id = r.id
  where r.turn_journey_id = j.id
    and m.status <> 'finalizado'
);

-- Vincular las planillas digitales históricas al UUID nuevo solo cuando el id
-- legacy identifica un unico partido dentro del torneo. Las filas de jugadores
-- y las fotos siguen unidas a la misma planilla y no se modifican.
with unique_legacy_matches as (
  select
    m.id as normalized_match_id,
    m.legacy_tournament_id as tournament_id,
    m.legacy_match_payload->>'id' as source_match_id,
    tt.id as turn_id,
    tc.id as tournament_category_id,
    count(*) over (
      partition by m.legacy_tournament_id, m.legacy_match_payload->>'id'
    ) as duplicate_count
  from public.fefutin_matches m
  join public.fefutin_rounds r on r.id = m.round_id
  join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
  join public.fefutin_tournament_turns tt on tt.id = tc.turn_id
  where m.legacy_tournament_id is not null
    and m.legacy_phase = 'groups'
    and nullif(m.legacy_match_payload->>'id', '') is not null
)
update public.fefutin_match_sheets sheet
set normalized_match_id = legacy.normalized_match_id,
    turn_id = legacy.turn_id,
    tournament_category_id = legacy.tournament_category_id
from unique_legacy_matches legacy
where legacy.duplicate_count = 1
  and sheet.tournament_id = legacy.tournament_id
  and sheet.match_id = legacy.source_match_id
  and sheet.normalized_match_id is null;

-- Vincular el archivo general por fecha y turno solo cuando la jornada es unica.
-- Si el archivo no identifica el turno y hay dos opciones, se conserva sin asignacion.
with journey_candidates as (
  select
    j.id as turn_journey_id,
    j.turn_id,
    tt.tournament_id,
    tt.turno,
    j.journey_number,
    j.scheduled_date,
    count(*) over (
      partition by tt.tournament_id, j.scheduled_date, tt.turno
    ) as same_turn_count,
    count(*) over (
      partition by tt.tournament_id, j.scheduled_date
    ) as all_turns_count
  from public.fefutin_turn_journeys j
  join public.fefutin_tournament_turns tt on tt.id = j.turn_id
  where j.scheduled_date is not null
)
update public.fefutin_jornada_sheets archive
set turn_journey_id = journey.turn_journey_id,
    turn_id = journey.turn_id,
    turno = journey.turno,
    journey_number = journey.journey_number
from journey_candidates journey
where archive.tournament_id = journey.tournament_id
  and archive.jornada_date = journey.scheduled_date
  and archive.turn_journey_id is null
  and (
    (archive.turno = journey.turno and journey.same_turn_count = 1)
    or (archive.turno is null and journey.all_turns_count = 1)
  );

-- Las fotos de planilla individual se vinculan a la jornada a traves de la
-- planilla digital ya asociada al UUID del partido.
update public.fefutin_jornada_photos photo
set turn_id = tt.id,
    turn_journey_id = r.turn_journey_id,
    turno = tt.turno,
    journey_number = r.round_number
from public.fefutin_match_sheets sheet
join public.fefutin_matches m on m.id = sheet.normalized_match_id
join public.fefutin_rounds r on r.id = m.round_id
join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
join public.fefutin_tournament_turns tt on tt.id = tc.turn_id
where photo.match_sheet_id = sheet.id
  and photo.document_type = 'category'
  and photo.turn_journey_id is null
  and r.turn_journey_id is not null;

-- Las fotos generales se vinculan por fecha/turno solo si la jornada es unica.
with journey_candidates as (
  select
    j.id as turn_journey_id,
    j.turn_id,
    tt.tournament_id,
    tt.turno,
    j.journey_number,
    j.scheduled_date,
    count(*) over (
      partition by tt.tournament_id, j.scheduled_date, tt.turno
    ) as same_turn_count,
    count(*) over (
      partition by tt.tournament_id, j.scheduled_date
    ) as all_turns_count
  from public.fefutin_turn_journeys j
  join public.fefutin_tournament_turns tt on tt.id = j.turn_id
  where j.scheduled_date is not null
)
update public.fefutin_jornada_photos photo
set turn_journey_id = journey.turn_journey_id,
    turn_id = journey.turn_id,
    turno = journey.turno,
    journey_number = journey.journey_number
from journey_candidates journey
where photo.tournament_id = journey.tournament_id
  and photo.jornada_date = journey.scheduled_date
  and photo.document_type is distinct from 'category'
  and photo.turn_journey_id is null
  and (
    (photo.turno = journey.turno and journey.same_turn_count = 1)
    or (photo.turno is null and journey.all_turns_count = 1)
  );

commit;
