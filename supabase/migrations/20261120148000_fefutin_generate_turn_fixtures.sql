-- FEFUTIN: generar fixture todos-contra-todos por categoria dentro de un turno.
-- La jornada compartida agrupa todos los partidos de las categorias del mismo turno.
begin;

create or replace function public.generate_fefutin_turn_fixtures(
  p_turn_id uuid,
  p_start_date date default null,
  p_days_between integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_turn public.fefutin_tournament_turns%rowtype;
  v_category record;
  v_team_ids uuid[];
  v_team_count integer;
  v_rotation_count integer;
  v_round_count integer;
  v_max_rounds integer := 0;
  v_round_number integer;
  v_pair_number integer;
  v_left_id uuid;
  v_right_id uuid;
  v_temp_id uuid;
  v_last_id uuid;
  v_journey_id uuid;
  v_round_id uuid;
  v_match_count integer := 0;
  v_category_count integer := 0;
  v_start_date date := coalesce(p_start_date, current_date);
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede iniciar un turno';
  end if;

  if p_days_between is null or p_days_between < 1 or p_days_between > 60 then
    raise exception 'La frecuencia entre jornadas debe estar entre 1 y 60 dias';
  end if;

  select tt.* into v_turn
  from public.fefutin_tournament_turns tt
  where tt.id = p_turn_id
  for update;

  if not found then
    raise exception 'No se encontro el turno seleccionado';
  end if;

  if v_turn.status <> 'inscripcion' then
    raise exception 'Este turno ya no esta en etapa de inscripcion';
  end if;

  if exists (
    select 1
    from public.fefutin_rounds r
    join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
    where tc.turn_id = p_turn_id
  ) or exists (
    select 1
    from public.fefutin_matches m
    join public.fefutin_rounds r on r.id = m.round_id
    join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
    where tc.turn_id = p_turn_id
  ) then
    raise exception 'Este turno ya tiene jornadas o partidos generados';
  end if;

  if not exists (
    select 1
    from public.fefutin_tournament_categories tc
    where tc.turn_id = p_turn_id
      and tc.status = 'inscripcion'
  ) then
    raise exception 'Este turno no tiene categorias abiertas';
  end if;

  if exists (
    select 1
    from public.fefutin_tournament_categories tc
    where tc.turn_id = p_turn_id
      and tc.status = 'inscripcion'
      and tc.format <> 'league'
  ) then
    raise exception 'Este generador inicial admite todos-contra-todos. Los formatos de grupos y eliminacion se habilitaran por categoria en el siguiente bloque.';
  end if;

  if exists (
    select 1
    from public.fefutin_tournament_categories tc
    left join public.fefutin_tournament_category_clubs tcc
      on tcc.tournament_category_id = tc.id
     and tcc.status = 'aprobado'
    where tc.turn_id = p_turn_id
      and tc.status = 'inscripcion'
    group by tc.id, tc.category_id
    having count(tcc.club_id) < 2
  ) then
    raise exception 'Cada categoria necesita al menos dos clubes aprobados para iniciar el turno';
  end if;

  select max(
    case when club_count % 2 = 0 then club_count - 1 else club_count end
  )::integer
  into v_max_rounds
  from (
    select tc.id, count(tcc.club_id)::integer as club_count
    from public.fefutin_tournament_categories tc
    left join public.fefutin_tournament_category_clubs tcc
      on tcc.tournament_category_id = tc.id
     and tcc.status = 'aprobado'
    where tc.turn_id = p_turn_id
      and tc.status = 'inscripcion'
    group by tc.id
  ) category_counts;

  if coalesce(v_max_rounds, 0) < 1 then
    raise exception 'No hay suficientes clubes para generar jornadas';
  end if;

  for v_round_number in 1..v_max_rounds loop
    insert into public.fefutin_turn_journeys (
      turn_id, journey_number, scheduled_date, status
    )
    values (
      p_turn_id,
      v_round_number,
      v_start_date + ((v_round_number - 1) * p_days_between),
      'pendiente'
    );
  end loop;

  for v_category in
    select
      tc.id as tournament_category_id,
      tc.category_id,
      cat.name as category_name,
      tc.format
    from public.fefutin_tournament_categories tc
    join public.fefutin_categories cat on cat.id = tc.category_id
    where tc.turn_id = p_turn_id
      and tc.status = 'inscripcion'
    order by cat.sort_order, cat.name
  loop
    select array_agg(tcc.club_id order by c.name, c.id)
    into v_team_ids
    from public.fefutin_tournament_category_clubs tcc
    join public.fefutin_clubs c on c.id = tcc.club_id
    where tcc.tournament_category_id = v_category.tournament_category_id
      and tcc.status = 'aprobado';

    v_team_count := coalesce(cardinality(v_team_ids), 0);
    if v_team_count < 2 then
      raise exception 'La categoria % necesita al menos dos clubes aprobados', v_category.category_name;
    end if;

    if v_team_count % 2 <> 0 then
      v_team_ids := array_append(v_team_ids, null::uuid);
    end if;

    v_rotation_count := cardinality(v_team_ids);
    v_round_count := v_rotation_count - 1;

    for v_round_number in 1..v_round_count loop
      select tj.id into v_journey_id
      from public.fefutin_turn_journeys tj
      where tj.turn_id = p_turn_id
        and tj.journey_number = v_round_number;

      insert into public.fefutin_rounds (
        tournament_category_id,
        turn_journey_id,
        round_number,
        name,
        scheduled_date,
        status
      )
      values (
        v_category.tournament_category_id,
        v_journey_id,
        v_round_number,
        'Jornada ' || v_round_number::text,
        v_start_date + ((v_round_number - 1) * p_days_between),
        'pendiente'
      )
      returning id into v_round_id;

      for v_pair_number in 1..(v_rotation_count / 2) loop
        v_left_id := v_team_ids[v_pair_number];
        v_right_id := v_team_ids[v_rotation_count - v_pair_number + 1];

        if v_left_id is not null and v_right_id is not null then
          if (v_round_number + v_pair_number) % 2 = 0 then
            v_temp_id := v_left_id;
            v_left_id := v_right_id;
            v_right_id := v_temp_id;
          end if;

          insert into public.fefutin_matches (
            round_id,
            local_club_id,
            visitor_club_id,
            scheduled_date,
            venue_address,
            status
          )
          select
            v_round_id,
            v_left_id,
            v_right_id,
            v_start_date + ((v_round_number - 1) * p_days_between),
            local_club.headquarters_address,
            'programado'
          from public.fefutin_clubs local_club
          where local_club.id = v_left_id;

          v_match_count := v_match_count + 1;
        end if;
      end loop;

      -- Rotacion circular: el primer club queda fijo y el ultimo pasa a la segunda posicion.
      v_last_id := v_team_ids[v_rotation_count];
      for v_pair_number in reverse v_rotation_count..3 loop
        v_team_ids[v_pair_number] := v_team_ids[v_pair_number - 1];
      end loop;
      v_team_ids[2] := v_last_id;
    end loop;

    update public.fefutin_tournament_categories
    set status = 'en_curso', updated_at = now()
    where id = v_category.tournament_category_id;

    v_category_count := v_category_count + 1;
  end loop;

  update public.fefutin_tournament_turns
  set status = 'en_curso', updated_at = now()
  where id = p_turn_id;

  return jsonb_build_object(
    'turn_id', p_turn_id,
    'turno', v_turn.turno,
    'status', 'en_curso',
    'categories_started', v_category_count,
    'journeys_generated', v_max_rounds,
    'matches_generated', v_match_count,
    'start_date', v_start_date,
    'days_between', p_days_between
  );
end;
$function$;

revoke all on function public.generate_fefutin_turn_fixtures(uuid, date, integer) from public, anon;
grant execute on function public.generate_fefutin_turn_fixtures(uuid, date, integer) to authenticated;

commit;
