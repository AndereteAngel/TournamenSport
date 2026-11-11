-- FEFUTIN: eliminación completa y autorizada de torneos con sus datos vinculados.
-- Preserva clubes, perfiles y el registro institucional general de jugadores.
begin;

-- La protección de planillas cerradas sigue vigente para todo uso normal.
-- Solo permite DELETE durante la RPC de eliminación que valida Admin/Directivo.
create or replace function public.prevent_closed_fefutin_match_sheet_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sheet_status text;
  v_tournament_delete text;
begin
  v_tournament_delete := current_setting('app.fefutin_tournament_delete', true);

  if tg_op = 'DELETE' and v_tournament_delete = 'authorized' then
    return old;
  end if;

  if tg_table_name = 'fefutin_match_sheets' then
    if lower(trim(coalesce(old.estado, ''))) in ('cerrada', 'cerrado') then
      raise exception 'La planilla esta cerrada y no admite modificaciones.';
    end if;

    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select lower(trim(coalesce(s.estado, '')))
    into v_sheet_status
    from public.fefutin_match_sheets s
    where s.id = old.match_sheet_id;

    if v_sheet_status in ('cerrada', 'cerrado') then
      raise exception 'La planilla esta cerrada y sus jugadores no pueden modificarse.';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select lower(trim(coalesce(s.estado, '')))
    into v_sheet_status
    from public.fefutin_match_sheets s
    where s.id = new.match_sheet_id;

    if v_sheet_status in ('cerrada', 'cerrado') then
      raise exception 'La planilla esta cerrada y sus jugadores no pueden modificarse.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

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

  -- Se capturan las rutas de Storage para que el cliente retire los objetos privados.
  select coalesce(jsonb_agg(p.storage_path), '[]'::jsonb)
  into v_photo_paths
  from public.fefutin_jornada_photos p
  where p.tournament_id = p_tournament_id;

  -- Historial vinculado a las entradas de jugadores de planteles de este torneo.
  delete from public.fefutin_player_status_history h
  where exists (
    select 1
    from public.fefutin_team_players tp
    join public.fefutin_teams ft on ft.id = tp.team_id
    join public.fefutin_club_tournaments ct on ct.id = ft.club_tournament_id
    where tp.id = h.player_entry_id
      and ct.tournament_id = p_tournament_id
  );

  -- El trigger permite retirar las planillas cerradas únicamente en este contexto.
  perform set_config('app.fefutin_tournament_delete', 'authorized', true);

  delete from public.fefutin_match_sheet_players sp
  where exists (
    select 1 from public.fefutin_match_sheets s
    where s.id = sp.match_sheet_id
      and s.tournament_id = p_tournament_id
  );

  delete from public.fefutin_match_sheets s
  where s.tournament_id = p_tournament_id;

  -- Eliminar metadatos fotográficos antes del torneo (FK RESTRICT).
  delete from public.fefutin_jornada_photos p
  where p.tournament_id = p_tournament_id;

  -- Inscripciones son específicas de este torneo. CASCADE retira equipos/planteles,
  -- pero fefutin_clubs y fefutin_players (registro global) no se borran.
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

-- Admin/Directivo habilitado debe poder borrar los objetos de Storage de las fotos
-- después de que la RPC retire las referencias de la base.
drop policy if exists fefutin_jornada_photos_storage_admin_delete on storage.objects;
create policy fefutin_jornada_photos_storage_admin_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fefutin-jornada-photos'
    and public.has_fefutin_role(array['admin', 'directivo'])
  );

commit;
