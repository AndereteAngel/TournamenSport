-- FEFUTIN: crear un torneo por rama y sus turnos/categorias normalizados en una sola transaccion.
begin;

alter table public.fefutin_tournament_categories
  drop constraint if exists fefutin_tournament_categories_format_check;

alter table public.fefutin_tournament_categories
  add constraint fefutin_tournament_categories_format_check
  check (format in ('league', 'groups', 'groups_playoff', 'playoff'));

create or replace function public.create_fefutin_branch_tournaments(
  p_branches jsonb,
  p_turnos text[],
  p_format text,
  p_is_public boolean default true,
  p_max_participants integer default 16,
  p_num_groups integer default 2,
  p_qualifiers_per_group integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_branch_input jsonb;
  v_branch public.fefutin_branches%rowtype;
  v_branch_name text;
  v_category_input jsonb;
  v_category_name text;
  v_category_type text;
  v_category_id uuid;
  v_tournament_id uuid;
  v_turn_id uuid;
  v_turno text;
  v_code text;
  v_categories text[];
  v_category_config jsonb;
  v_groups jsonb;
  v_created jsonb := '[]'::jsonb;
  v_sort_order integer;
  v_category_format text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede crear torneos de rama';
  end if;

  if jsonb_typeof(p_branches) <> 'array' or jsonb_array_length(p_branches) = 0 then
    raise exception 'Selecciona al menos una rama con categorias';
  end if;

  if p_turnos is null or cardinality(p_turnos) = 0
     or exists (select 1 from unnest(p_turnos) as value where value not in ('Semanal', 'Fin de semana')) then
    raise exception 'Selecciona al menos un turno valido: Semanal o Fin de semana';
  end if;

  if p_format not in ('league', 'groups', 'groups_playoff', 'single_elimination', 'playoff') then
    raise exception 'El formato de competencia seleccionado no es valido';
  end if;

  if coalesce(p_max_participants, 0) < 2 or coalesce(p_max_participants, 0) > 500 then
    raise exception 'La capacidad maxima debe estar entre 2 y 500';
  end if;

  v_category_format := case
    when p_format = 'single_elimination' then 'playoff'
    else p_format
  end;

  for v_branch_input in
    select value from jsonb_array_elements(p_branches)
  loop
    v_branch_name := trim(v_branch_input->>'division');
    v_category_type := coalesce(nullif(trim(v_branch_input->>'categoryType'), ''), 'Categoría');

    if v_branch_name = 'Infantil' then v_branch_name := 'Baby fútbol'; end if;
    if v_branch_name = 'Mayores' then v_branch_name := 'Sénior'; end if;

    select b.* into v_branch
    from public.fefutin_branches b
    where lower(b.name) = lower(v_branch_name)
      and b.active = true;

    if not found then
      raise exception 'La rama % no existe en el catalogo institucional', v_branch_name;
    end if;

    select array_agg(trim(value #>> '{}') order by ordinality)
    into v_categories
    from jsonb_array_elements(v_branch_input->'categories') with ordinality as item(value, ordinality)
    where nullif(trim(value #>> '{}'), '') is not null;

    if coalesce(cardinality(v_categories), 0) = 0 then
      raise exception 'La rama % no tiene categorias seleccionadas', v_branch_name;
    end if;

    if exists (
      select 1
      from public.tournaments t
      where t.fefutin_branch_id = v_branch.id
        and lower(trim(coalesce(t.status, ''))) not in ('finalizado', 'finalizada', 'completed')
    ) then
      raise exception 'Ya existe una competencia activa para la rama %. Abri esa rama y agrega el turno faltante si corresponde.', v_branch_name;
    end if;

    v_category_config := jsonb_build_array(jsonb_build_object(
      'division', v_branch.name,
      'categoryType', v_category_type,
      'categories', to_jsonb(v_categories)
    ));

    v_groups := jsonb_build_array(jsonb_build_object(
      'id', 0,
      'name', '__INSCRIPCIONES__',
      'teams', '[]'::jsonb,
      'matches', '[]'::jsonb,
      'capacity', p_max_participants,
      'numGroups', case when p_format in ('groups', 'groups_playoff') then greatest(1, coalesce(p_num_groups, 2)) else 1 end,
      'category_config', v_category_config
    ));

    loop
      v_code := 'TS-' || lpad((floor(random() * 9000) + 1000)::integer::text, 4, '0');
      exit when not exists (select 1 from public.tournaments t where t.code = v_code);
    end loop;

    insert into public.tournaments (
      code, title, game, format, qualifiers_per_group, is_public,
      created_by_user_id, created_by, groups, playoffs, status,
      fefutin_branch_id, fefutin_turno
    )
    values (
      v_code, v_branch.name, 'Fútbol · ' || v_branch.name, p_format,
      greatest(1, coalesce(p_qualifiers_per_group, 2)), coalesce(p_is_public, true),
      auth.uid(), v_profile.username, v_groups, null, 'Inscripciones',
      v_branch.id, null
    )
    returning id into v_tournament_id;

    foreach v_turno in array p_turnos loop
      insert into public.fefutin_tournament_turns (tournament_id, turno, status)
      values (v_tournament_id, v_turno, 'inscripcion')
      returning id into v_turn_id;

      for v_category_input in
        select value from jsonb_array_elements(v_branch_input->'categories')
      loop
        v_category_name := trim(v_category_input #>> '{}');
        if v_category_name = '' then continue; end if;

        select coalesce(max(c.sort_order), 0) + 1 into v_sort_order
        from public.fefutin_categories c
        where c.branch_id = v_branch.id;

        insert into public.fefutin_categories (branch_id, name, active, sort_order)
        values (v_branch.id, v_category_name, true, v_sort_order)
        on conflict (branch_id, name) do update set active = true
        returning id into v_category_id;

        insert into public.fefutin_tournament_categories (
          tournament_id, turn_id, category_id, format, status, settings
        )
        values (
          v_tournament_id, v_turn_id, v_category_id, v_category_format, 'inscripcion',
          jsonb_build_object(
            'num_groups', case when p_format in ('groups', 'groups_playoff') then greatest(1, coalesce(p_num_groups, 2)) else 1 end,
            'qualifiers_per_group', greatest(1, coalesce(p_qualifiers_per_group, 2)),
            'max_participants', p_max_participants
          )
        );
      end loop;
    end loop;

    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'id', v_tournament_id, 'title', v_branch.name, 'branch_id', v_branch.id,
      'turnos', to_jsonb(p_turnos), 'categories', to_jsonb(v_categories)
    ));
  end loop;

  return v_created;
end;
$function$;

revoke all on function public.create_fefutin_branch_tournaments(jsonb, text[], text, boolean, integer, integer, integer) from public, anon;
grant execute on function public.create_fefutin_branch_tournaments(jsonb, text[], text, boolean, integer, integer, integer) to authenticated;

commit;
