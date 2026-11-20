-- FEFUTIN: asigna un árbitro a todos los partidos de una jornada general.
begin;

create or replace function public.assign_fefutin_referee_to_turn_journey(
  p_turn_journey_id uuid,
  p_referee_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.profiles%rowtype;
  v_referee public.profiles%rowtype;
  v_match_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión para designar un árbitro';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.deactivated_at is null;

  if not found or coalesce(v_actor.role, '') not in ('admin', 'directivo') then
    raise exception 'No tenés permisos para designar árbitros';
  end if;

  select p.* into v_referee
  from public.profiles p
  where p.id = p_referee_id
    and p.role = 'arbitro'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if not found then
    raise exception 'El árbitro seleccionado no está aprobado o se encuentra inactivo';
  end if;

  if not exists (
    select 1
    from public.fefutin_turn_journeys j
    where j.id = p_turn_journey_id
  ) then
    raise exception 'La jornada seleccionada ya no existe';
  end if;

  select count(*)::integer
  into v_match_count
  from public.fefutin_matches m
  join public.fefutin_rounds r on r.id = m.round_id
  where r.turn_journey_id = p_turn_journey_id;

  if v_match_count = 0 then
    raise exception 'La jornada no tiene partidos para designar';
  end if;

  if exists (
    select 1
    from public.fefutin_matches m
    join public.fefutin_rounds r on r.id = m.round_id
    where r.turn_journey_id = p_turn_journey_id
      and (m.status = 'finalizado' or m.referee_closed_at is not null)
      and m.referee_id is distinct from p_referee_id
  ) then
    raise exception 'La jornada contiene partidos cerrados con otro árbitro y no puede modificarse';
  end if;

  update public.fefutin_matches m
  set referee_id = p_referee_id
  from public.fefutin_rounds r
  where m.round_id = r.id
    and r.turn_journey_id = p_turn_journey_id;

  get diagnostics v_match_count = row_count;
  return v_match_count;
end;
$function$;

revoke all on function public.assign_fefutin_referee_to_turn_journey(uuid, uuid) from public;
revoke all on function public.assign_fefutin_referee_to_turn_journey(uuid, uuid) from anon;
grant execute on function public.assign_fefutin_referee_to_turn_journey(uuid, uuid) to authenticated;

commit;
