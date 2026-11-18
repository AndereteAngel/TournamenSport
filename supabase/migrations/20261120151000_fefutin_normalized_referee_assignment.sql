-- FEFUTIN: asignacion de arbitros a partidos normalizados.
begin;

create or replace function public.assign_fefutin_normalized_match_referee(
  p_match_id uuid,
  p_referee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_referee public.profiles%rowtype;
  v_match public.fefutin_matches%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede designar arbitros';
  end if;

  if p_referee_id is not null then
    select p.* into v_referee
    from public.profiles p
    where p.id = p_referee_id
      and p.role = 'arbitro'
      and p.approval_status = 'aprobado'
      and p.deactivated_at is null;

    if not found then
      raise exception 'El arbitro seleccionado no esta aprobado o activo';
    end if;
  end if;

  select m.* into v_match
  from public.fefutin_matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception 'No se encontro el partido';
  end if;

  if v_match.status = 'finalizado' or v_match.referee_closed_at is not null then
    raise exception 'No se puede cambiar el arbitro de un partido cerrado';
  end if;

  update public.fefutin_matches
  set referee_id = p_referee_id,
      updated_at = now()
  where id = p_match_id
  returning * into v_match;

  return jsonb_build_object(
    'id', v_match.id,
    'referee_id', v_match.referee_id,
    'status', v_match.status,
    'updated_at', v_match.updated_at
  );
end;
$function$;

revoke all on function public.assign_fefutin_normalized_match_referee(uuid, uuid) from public, anon;
grant execute on function public.assign_fefutin_normalized_match_referee(uuid, uuid) to authenticated;

commit;
