-- FEFUTIN: finalizar un turno sin cerrar ni mezclar el otro turno de la rama.
begin;

create or replace function public.finish_fefutin_turn(
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
  v_tournament_id uuid;
  v_match_count integer;
  v_open_count integer;
  v_all_turns_finished boolean;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede finalizar un turno';
  end if;

  select tt.* into v_turn
  from public.fefutin_tournament_turns tt
  where tt.id = p_turn_id
  for update;

  if not found then
    raise exception 'No se encontro el turno seleccionado';
  end if;

  if v_turn.status = 'finalizada' then
    raise exception 'Este turno ya esta finalizado';
  end if;

  select count(*)::integer,
         count(*) filter (where m.status <> 'finalizado' or m.referee_closed_at is null)::integer
  into v_match_count, v_open_count
  from public.fefutin_tournament_categories tc
  join public.fefutin_rounds r on r.tournament_category_id = tc.id
  join public.fefutin_matches m on m.round_id = r.id
  where tc.turn_id = p_turn_id;

  if v_match_count = 0 then
    raise exception 'El turno no tiene partidos generados';
  end if;

  if v_open_count > 0 then
    raise exception 'No se puede finalizar: todavia hay % partido(s) sin cierre arbitral', v_open_count;
  end if;

  update public.fefutin_tournament_turns
  set status = 'finalizada', updated_at = now()
  where id = p_turn_id;

  update public.fefutin_tournament_categories
  set status = 'finalizada', updated_at = now()
  where turn_id = p_turn_id;

  update public.fefutin_turn_journeys
  set status = 'finalizada', updated_at = now()
  where turn_id = p_turn_id;

  update public.fefutin_rounds r
  set status = 'finalizada', updated_at = now()
  from public.fefutin_tournament_categories tc
  where tc.id = r.tournament_category_id
    and tc.turn_id = p_turn_id;

  select tt.tournament_id into v_tournament_id
  from public.fefutin_tournament_turns tt
  where tt.id = p_turn_id;

  select bool_and(tt.status = 'finalizada') into v_all_turns_finished
  from public.fefutin_tournament_turns tt
  where tt.tournament_id = v_tournament_id;

  if coalesce(v_all_turns_finished, false) then
    update public.tournaments
    set status = 'Finalizado'
    where id = v_tournament_id;
  else
    update public.tournaments
    set status = 'En curso'
    where id = v_tournament_id
      and lower(trim(coalesce(status, ''))) <> 'finalizado';
  end if;

  return jsonb_build_object(
    'turn_id', p_turn_id,
    'tournament_id', v_tournament_id,
    'status', 'finalizada',
    'matches_closed', v_match_count,
    'all_turns_finished', coalesce(v_all_turns_finished, false)
  );
end;
$function$;

revoke all on function public.finish_fefutin_turn(uuid) from public, anon;
grant execute on function public.finish_fefutin_turn(uuid) to authenticated;

commit;
