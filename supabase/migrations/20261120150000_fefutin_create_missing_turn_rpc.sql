-- FEFUTIN: crear el turno faltante dentro de una rama sin copiar inscripciones.
begin;

create or replace function public.create_fefutin_tournament_turn(
  p_tournament_id uuid,
  p_turno text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_tournament public.tournaments%rowtype;
  v_source_turn_id uuid;
  v_new_turn_id uuid;
  v_category_count integer;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede crear un turno';
  end if;

  if p_turno not in ('Semanal', 'Fin de semana') then
    raise exception 'El turno debe ser Semanal o Fin de semana';
  end if;

  select t.* into v_tournament
  from public.tournaments t
  where t.id = p_tournament_id
    and t.fefutin_branch_id is not null
  for update;

  if not found then
    raise exception 'No se encontro el torneo de rama FEFUTIN';
  end if;

  if exists (
    select 1 from public.fefutin_tournament_turns tt
    where tt.tournament_id = p_tournament_id
      and tt.turno = p_turno
  ) then
    raise exception 'Ese turno ya existe dentro de la rama';
  end if;

  select tt.id into v_source_turn_id
  from public.fefutin_tournament_turns tt
  where tt.tournament_id = p_tournament_id
  order by case tt.turno when 'Semanal' then 0 else 1 end, tt.created_at
  limit 1;

  if v_source_turn_id is null then
    raise exception 'La rama todavia no tiene un turno base del que copiar sus categorias';
  end if;

  insert into public.fefutin_tournament_turns (tournament_id, turno, status)
  values (p_tournament_id, p_turno, 'inscripcion')
  returning id into v_new_turn_id;

  insert into public.fefutin_tournament_categories (
    tournament_id, turn_id, category_id, format, status, settings
  )
  select
    tc.tournament_id,
    v_new_turn_id,
    tc.category_id,
    tc.format,
    'inscripcion',
    tc.settings
  from public.fefutin_tournament_categories tc
  where tc.turn_id = v_source_turn_id;

  get diagnostics v_category_count = row_count;

  if v_category_count = 0 then
    raise exception 'El turno base no tiene categorias configuradas';
  end if;

  return v_new_turn_id;
end;
$function$;

revoke all on function public.create_fefutin_tournament_turn(uuid, text) from public, anon;
grant execute on function public.create_fefutin_tournament_turn(uuid, text) to authenticated;

commit;
