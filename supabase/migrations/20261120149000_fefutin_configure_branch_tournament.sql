-- FEFUTIN: crear una competencia de rama con sus turnos y categorias independientes.
-- Cada turno comparte el torneo de rama, pero conserva inscripciones y jornadas propias.
begin;

alter table public.fefutin_tournament_categories
  drop constraint if exists fefutin_tournament_categories_format_check;

alter table public.fefutin_tournament_categories
  add constraint fefutin_tournament_categories_format_check
  check (format in ('league', 'groups', 'groups_playoff', 'playoff', 'single_elimination'));

create or replace function public.configure_fefutin_branch_tournament(
  p_tournament_id uuid,
  p_branch_name text,
  p_turnos text[],
  p_categories text[],
  p_format text default 'league',
  p_settings jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_branch public.fefutin_branches%rowtype;
  v_tournament public.tournaments%rowtype;
  v_turn text;
  v_category text;
  v_turn_id uuid;
  v_category_id uuid;
  v_turn_ids uuid[] := array[]::uuid[];
  v_category_count integer := 0;
  v_format text;
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
begin
  if auth.uid() is null or not public.has_fefutin_role(array['admin','directivo']) then
    raise exception 'Solo Admin o Directivo puede configurar una rama FEFUTIN';
  end if;

  if p_tournament_id is null then
    raise exception 'No se recibio el torneo de rama';
  end if;

  select t.* into v_tournament
  from public.tournaments t
  where t.id = p_tournament_id
  for update;

  if not found then
    raise exception 'No se encontro el torneo de rama';
  end if;

  select b.* into v_branch
  from public.fefutin_branches b
  where lower(trim(b.name)) = lower(trim(p_branch_name))
    and b.active = true;

  if not found then
    raise exception 'La rama indicada no existe en el catalogo FEFUTIN';
  end if;

  if coalesce(cardinality(p_turnos), 0) = 0 then
    raise exception 'Selecciona al menos un turno';
  end if;

  if coalesce(cardinality(p_categories), 0) = 0 then
    raise exception 'Selecciona al menos una categoria';
  end if;

  if exists (
    select 1
    from unnest(p_turnos) as requested(value)
    where trim(requested.value) not in ('Semanal', 'Fin de semana')
  ) then
    raise exception 'Los turnos permitidos son Semanal y Fin de semana';
  end if;

  if exists (
    select 1
    from unnest(p_categories) as requested(value)
    where nullif(trim(requested.value), '') is null
  ) then
    raise exception 'Hay una categoria vacia';
  end if;

  if jsonb_typeof(v_settings) <> 'object' then
    raise exception 'La configuracion de categorias debe ser un objeto JSON';
  end if;

  v_format := case
    when p_format = 'single_elimination' then 'playoff'
    when p_format in ('league', 'groups', 'groups_playoff', 'playoff') then p_format
    else 'league'
  end;

  if exists (
    select 1
    from public.fefutin_tournament_turns tt
    where tt.tournament_id = p_tournament_id
  ) or exists (
    select 1
    from public.fefutin_tournament_categories tc
    where tc.tournament_id = p_tournament_id
  ) then
    raise exception 'Este torneo ya tiene turnos o categorias normalizados. No se puede volver a configurar desde el alta inicial';
  end if;

  update public.tournaments
  set fefutin_branch_id = v_branch.id,
      fefutin_turno = null
  where id = p_tournament_id;

  -- Las categorias personalizadas se incorporan al catalogo de esa rama sin duplicar las existentes.
  insert into public.fefutin_categories (branch_id, name, sort_order)
  select
    v_branch.id,
    trim(requested.value),
    coalesce((select max(c.sort_order) from public.fefutin_categories c where c.branch_id = v_branch.id), 0)
      + requested.ordinality::integer
  from unnest(p_categories) with ordinality as requested(value, ordinality)
  on conflict (branch_id, name) do nothing;

  for v_turn in
    select distinct trim(value)
    from unnest(p_turnos) as turns(value)
    order by trim(value)
  loop
    insert into public.fefutin_tournament_turns (tournament_id, turno, status)
    values (p_tournament_id, v_turn, 'inscripcion')
    on conflict (tournament_id, turno) do nothing
    returning id into v_turn_id;

    if v_turn_id is null then
      select tt.id into v_turn_id
      from public.fefutin_tournament_turns tt
      where tt.tournament_id = p_tournament_id and tt.turno = v_turn;
    end if;

    v_turn_ids := array_append(v_turn_ids, v_turn_id);

    for v_category in
      select distinct trim(value)
      from unnest(p_categories) as categories(value)
      order by trim(value)
    loop
      select c.id into v_category_id
      from public.fefutin_categories c
      where c.branch_id = v_branch.id
        and lower(trim(c.name)) = lower(trim(v_category))
      order by c.sort_order
      limit 1;

      if v_category_id is null then
        raise exception 'No se pudo resolver la categoria % de la rama %', v_category, v_branch.name;
      end if;

      insert into public.fefutin_tournament_categories (
        tournament_id, turn_id, category_id, format, status, settings
      )
      values (
        p_tournament_id, v_turn_id, v_category_id, v_format, 'inscripcion', v_settings
      )
      on conflict (turn_id, category_id) do nothing;

      v_category_count := v_category_count + 1;
    end loop;

    v_turn_id := null;
  end loop;

  return jsonb_build_object(
    'tournament_id', p_tournament_id,
    'branch_id', v_branch.id,
    'branch_name', v_branch.name,
    'turn_ids', to_jsonb(v_turn_ids),
    'turn_count', cardinality(v_turn_ids),
    'category_count', v_category_count,
    'format', v_format
  );
end;
$function$;

revoke all on function public.configure_fefutin_branch_tournament(uuid, text, text[], text[], text, jsonb) from public, anon;
grant execute on function public.configure_fefutin_branch_tournament(uuid, text, text[], text[], text, jsonb) to authenticated;

commit;
