-- FEFUTIN: permitir activar jugadores de listas en preparación.
-- La lista de buena fe se completa progresivamente; no requiere estar presentada
-- para que Admin/Directivo active un jugador y se genere su carnet pendiente.
begin;

create or replace function public.decide_fefutin_player(
  p_player_entry_id uuid,
  p_approve boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_entry public.fefutin_team_players%rowtype;
  v_registry_id uuid;
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

  -- Se admite tanto un equipo en borrador como una lista presentada.
  select pl.* into v_entry
  from public.fefutin_team_players pl
  join public.fefutin_teams ft on ft.id = pl.team_id
  where pl.id = p_player_entry_id
  for update of pl;

  if not found then
    raise exception 'No se encontró el jugador de la lista de buena fe';
  end if;

  if v_entry.approval_status <> 'pendiente' then
    raise exception 'Este jugador ya fue revisado';
  end if;

  if not p_approve then
    update public.fefutin_team_players
    set approval_status = 'rechazado'
    where id = p_player_entry_id;
    return 'RECHAZADO';
  end if;

  insert into public.fefutin_players (
    dni, first_name, last_name, birth_date, photo_path, approved_by
  )
  values (
    v_entry.dni, v_entry.first_name, v_entry.last_name,
    v_entry.birth_date, v_entry.photo_path, auth.uid()
  )
  on conflict (dni) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    birth_date = excluded.birth_date,
    photo_path = coalesce(excluded.photo_path, public.fefutin_players.photo_path)
  returning id, carnet_number into v_registry_id, v_carnet;

  -- La activación del jugador y la verificación del carnet son estados distintos.
  -- verification_status queda en 'pendiente' por el default de fefutin_players.
  update public.fefutin_team_players
  set approval_status = 'aprobado',
      registry_player_id = v_registry_id
  where id = p_player_entry_id;

  return v_carnet;
end;
$$;

revoke all on function public.decide_fefutin_player(uuid, boolean) from public, anon;
grant execute on function public.decide_fefutin_player(uuid, boolean) to authenticated;

commit;
