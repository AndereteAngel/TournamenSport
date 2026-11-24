-- FEFUTIN: activar altas desde el padron permanente, sin tablas de participacion legacy.
-- La pantalla Admin/Directivo envia fefutin_club_roster_players.id.
begin;

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
  v_registry_status text;
  v_carnet text;
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
    'habilitado', 'habilitado'
  )
  on conflict (dni) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    birth_date = excluded.birth_date,
    photo_path = coalesce(excluded.photo_path, public.fefutin_players.photo_path),
    carnet_status = 'habilitado',
    verification_status = 'habilitado'
  where public.fefutin_players.status = 'aprobado'
  returning id, carnet_number, status
    into v_registry_id, v_carnet, v_registry_status;

  if v_registry_id is null then
    raise exception 'El DNI ya pertenece a un registro FEFUTIN rechazado. Debe revisarlo Admin o Directivo.';
  end if;

  update public.fefutin_club_roster_players
  set approval_status = 'aprobado',
      registry_player_id = v_registry_id,
      updated_at = now()
  where id = v_roster_player.id;

  return v_carnet;
end;
$function$;

revoke all on function public.decide_fefutin_player(uuid, boolean) from public, anon;
grant execute on function public.decide_fefutin_player(uuid, boolean) to authenticated;

commit;
