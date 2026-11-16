-- FEFUTIN: preservar el historial de sanciones al eliminar torneos.
-- El UUID original queda como referencia histórica, mientras roster_player_id
-- mantiene el vínculo permanente con el jugador del club/categoría.
begin;

-- El FK antiguo impedía conservar una referencia histórica independiente
-- y la RPC de eliminación borraba esas filas explícitamente.
alter table public.fefutin_player_status_history
  drop constraint if exists fefutin_player_status_history_player_entry_id_fkey;

alter table public.fefutin_player_status_history
  alter column player_entry_id drop not null;

-- Compatibilidad temporal con la interfaz anterior: cada sanción nueva
-- queda vinculada también al jugador permanente mediante la tabla de mapeo.
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
  v_roster_player_id uuid;
  v_previous_status text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found or v_profile.role not in ('admin', 'directivo')
    or v_profile.approval_status <> 'aprobado'
    or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede registrar una sanción';
  end if;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Indicá el motivo de la sanción';
  end if;

  select pl.registry_player_id, src.roster_player_id
    into v_registry_id, v_roster_player_id
  from public.fefutin_team_players pl
  join public.fefutin_roster_migration_sources src
    on src.source_team_player_id = pl.id
  where pl.id = p_player_entry_id
    and pl.approval_status = 'aprobado'
    and pl.registry_player_id is not null
  for update of pl;

  if not found then
    raise exception 'No se encontró el jugador aprobado en el registro permanente';
  end if;

  select fp.carnet_status into v_previous_status
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
  set carnet_status = 'no_habilitado'
  where id = v_registry_id;

  insert into public.fefutin_player_status_history (
    player_entry_id, registry_player_id, roster_player_id,
    previous_status, new_status, reason, changed_by
  ) values (
    p_player_entry_id, v_registry_id, v_roster_player_id,
    v_previous_status, 'no_habilitado', trim(p_reason), auth.uid()
  );

  return 'NO HABILITADO';
end;
$function$;

revoke all on function public.set_fefutin_player_no_habilitado(uuid, text) from public, anon;
grant execute on function public.set_fefutin_player_no_habilitado(uuid, text) to authenticated;

-- La eliminación retira únicamente información propia del torneo.
-- El historial de sanciones ya no se borra y conserva roster_player_id.
create or replace function public.delete_fefutin_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_photo_paths jsonb := '[]'::jsonb;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo habilitado puede eliminar torneos';
  end if;

  perform 1
  from public.tournaments t
  where t.id = p_tournament_id
  for update;

  if not found then
    raise exception 'No se encontró el torneo solicitado';
  end if;

  select coalesce(jsonb_agg(p.storage_path), '[]'::jsonb)
    into v_photo_paths
  from public.fefutin_jornada_photos p
  where p.tournament_id = p_tournament_id;

  -- El trigger permite retirar las planillas cerradas solo en este contexto.
  perform set_config('app.fefutin_tournament_delete', 'authorized', true);

  delete from public.fefutin_match_sheet_players sp
  where exists (
    select 1
    from public.fefutin_match_sheets s
    where s.id = sp.match_sheet_id
      and s.tournament_id = p_tournament_id
  );

  delete from public.fefutin_match_sheets s
  where s.tournament_id = p_tournament_id;

  delete from public.fefutin_jornada_photos p
  where p.tournament_id = p_tournament_id;

  -- La FK CASCADE elimina la participación y sus equipos/filas antiguas,
  -- pero no toca los planteles permanentes ni el historial de sanciones.
  delete from public.fefutin_club_tournaments ct
  where ct.tournament_id = p_tournament_id;

  delete from public.tournaments t
  where t.id = p_tournament_id;

  perform set_config('app.fefutin_tournament_delete', '', true);

  return jsonb_build_object(
    'deleted_tournament_id', p_tournament_id,
    'photo_storage_paths', v_photo_paths
  );
exception
  when others then
    perform set_config('app.fefutin_tournament_delete', '', true);
    raise;
end;
$function$;

revoke all on function public.delete_fefutin_tournament(uuid) from public, anon;
grant execute on function public.delete_fefutin_tournament(uuid) to authenticated;

commit;
