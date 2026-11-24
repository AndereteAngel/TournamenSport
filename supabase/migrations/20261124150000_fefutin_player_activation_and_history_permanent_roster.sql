-- FEFUTIN: activar desde el padron permanente y registrar todo el ciclo del carnet.
-- No depende de tablas de inscripcion por torneo que ya no forman parte del flujo.

begin;

-- El historial institucional debe admitir tanto la habilitacion inicial como las sanciones.
alter table public.fefutin_player_status_history
  drop constraint if exists fefutin_player_status_history_new_status_check;

alter table public.fefutin_player_status_history
  add constraint fefutin_player_status_history_new_status_check
  check (new_status in ('habilitado', 'no_habilitado'));

-- Admin/Directivo activa directamente la ficha permanente enviada por el buzón.
create or replace function public.decide_fefutin_player(
  p_player_entry_id uuid,
  p_approve boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_roster_player public.fefutin_club_roster_players%rowtype;
  v_registry_id uuid;
  v_carnet text;
  v_previous_status text := 'pendiente';
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'No tenés permisos para aprobar altas de jugadores';
  end if;

  select rp.* into v_roster_player
  from public.fefutin_club_roster_players rp
  where rp.id = p_player_entry_id
    and rp.removed_at is null
  for update;

  if not found then
    raise exception 'No se encontró el jugador del plantel permanente';
  end if;

  if v_roster_player.approval_status <> 'pendiente' then
    raise exception 'Este jugador ya fue revisado';
  end if;

  if not p_approve then
    update public.fefutin_club_roster_players
    set approval_status = 'rechazado',
        updated_at = now()
    where id = v_roster_player.id;

    return 'RECHAZADO';
  end if;

  if nullif(trim(v_roster_player.dni), '') is null
     or v_roster_player.birth_date is null
     or nullif(trim(v_roster_player.first_name), '') is null
     or nullif(trim(v_roster_player.last_name), '') is null then
    raise exception 'La ficha necesita nombre, apellido, DNI y fecha de nacimiento para generar el carnet';
  end if;

  -- Si el DNI ya existe, conservamos el carnet y registramos el estado anterior.
  select fp.id,
         case
           when fp.verification_status = 'no_habilitado' or fp.carnet_status = 'no_habilitado' then 'no_habilitado'
           when fp.verification_status = 'habilitado' or fp.carnet_status = 'habilitado' then 'habilitado'
           else coalesce(fp.verification_status, fp.carnet_status, 'pendiente')
         end
    into v_registry_id, v_previous_status
  from public.fefutin_players fp
  where fp.dni = v_roster_player.dni
  for update;

  insert into public.fefutin_players (
    dni, first_name, last_name, birth_date, photo_path, approved_by,
    carnet_status, verification_status
  )
  values (
    v_roster_player.dni,
    v_roster_player.first_name,
    v_roster_player.last_name,
    v_roster_player.birth_date,
    v_roster_player.photo_path,
    auth.uid(),
    'habilitado',
    'habilitado'
  )
  on conflict (dni) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    birth_date = excluded.birth_date,
    photo_path = coalesce(excluded.photo_path, public.fefutin_players.photo_path),
    carnet_status = 'habilitado',
    verification_status = 'habilitado'
  where public.fefutin_players.status = 'aprobado'
  returning id, carnet_number
    into v_registry_id, v_carnet;

  if v_registry_id is null then
    raise exception 'El DNI ya pertenece a un registro FEFUTIN rechazado. Debe revisarlo Admin o Directivo.';
  end if;

  update public.fefutin_club_roster_players
  set approval_status = 'aprobado',
      registry_player_id = v_registry_id,
      updated_at = now()
  where id = v_roster_player.id;

  insert into public.fefutin_player_status_history (
    player_entry_id,
    registry_player_id,
    roster_player_id,
    previous_status,
    new_status,
    reason,
    changed_by
  ) values (
    null,
    v_registry_id,
    v_roster_player.id,
    coalesce(v_previous_status, 'pendiente'),
    'habilitado',
    'Alta inicial habilitada por Admin/Directivo',
    auth.uid()
  );

  return v_carnet;
end;
$function$;

revoke all on function public.decide_fefutin_player(uuid, boolean) from public, anon;
grant execute on function public.decide_fefutin_player(uuid, boolean) to authenticated;

-- La sancion tambien trabaja con el ID permanente que envia el buzón.
create or replace function public.set_fefutin_player_no_habilitado(
  p_player_entry_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_registry_id uuid;
  v_previous_status text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede registrar una sanción';
  end if;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Indicá el motivo de la sanción';
  end if;

  select rp.registry_player_id into v_registry_id
  from public.fefutin_club_roster_players rp
  where rp.id = p_player_entry_id
    and rp.approval_status = 'aprobado'
    and rp.registry_player_id is not null
    and rp.removed_at is null
  for update;

  if not found or v_registry_id is null then
    raise exception 'El jugador no tiene un alta aprobada y un carnet oficial';
  end if;

  select case
    when fp.verification_status = 'no_habilitado' or fp.carnet_status = 'no_habilitado' then 'no_habilitado'
    when fp.verification_status = 'habilitado' or fp.carnet_status = 'habilitado' then 'habilitado'
    else coalesce(fp.verification_status, fp.carnet_status, 'pendiente')
  end into v_previous_status
  from public.fefutin_players fp
  where fp.id = v_registry_id
  for update;

  if not found then
    raise exception 'No se encontró el registro oficial del jugador';
  end if;

  if v_previous_status = 'no_habilitado' then
    raise exception 'El jugador ya figura como NO HABILITADO';
  end if;

  update public.fefutin_players
  set carnet_status = 'no_habilitado',
      verification_status = 'no_habilitado'
  where id = v_registry_id;

  insert into public.fefutin_player_status_history (
    player_entry_id,
    registry_player_id,
    roster_player_id,
    previous_status,
    new_status,
    reason,
    changed_by
  ) values (
    null,
    v_registry_id,
    p_player_entry_id,
    v_previous_status,
    'no_habilitado',
    trim(p_reason),
    auth.uid()
  );

  return 'NO HABILITADO';
end;
$function$;

revoke all on function public.set_fefutin_player_no_habilitado(uuid, text) from public, anon;
grant execute on function public.set_fefutin_player_no_habilitado(uuid, text) to authenticated;

commit;
