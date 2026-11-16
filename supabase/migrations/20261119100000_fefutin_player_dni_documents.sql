-- FEFUTIN: documentación de identidad para la ficha permanente del jugador.
-- Aditiva: conserva todos los jugadores, carnets, fotos e historiales existentes.

begin;

alter table public.fefutin_club_roster_players
  add column if not exists dni_front_path text,
  add column if not exists dni_back_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fefutin-player-dni',
  'fefutin-player-dni',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fefutin_player_dni_upload_own" on storage.objects;
create policy "fefutin_player_dni_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fefutin-player-dni'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "fefutin_player_dni_read_authorized" on storage.objects;
create policy "fefutin_player_dni_read_authorized"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fefutin-player-dni'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role in ('admin', 'directivo')
          and p.approval_status = 'aprobado'
          and p.deactivated_at is null
      )
    )
  );

drop policy if exists "fefutin_player_dni_update_own" on storage.objects;
create policy "fefutin_player_dni_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'fefutin-player-dni'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'fefutin-player-dni'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Guarda el plantel completo y adjunta los documentos al jugador identificado
-- por DNI. El llamador debe enviar todas las filas vigentes de la categoría
-- más el nuevo jugador; así no se retiran lógicamente otros pendientes.
create or replace function public.save_fefutin_permanent_roster_with_dni(
  p_roster_id uuid,
  p_players jsonb,
  p_player_dni text,
  p_dni_front_path text,
  p_dni_back_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_dni_key text;
  v_front text := nullif(trim(coalesce(p_dni_front_path, '')), '');
  v_back text := nullif(trim(coalesce(p_dni_back_path, '')), '');
  v_saved_roster uuid;
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = v_user_id;

  if v_user_id is null
     or not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'Solo un referente habilitado puede inscribir jugadores';
  end if;

  v_dni_key := nullif(regexp_replace(coalesce(p_player_dni, ''), '[^0-9]', '', 'g'), '');
  if v_dni_key is null then
    raise exception 'Ingresá un DNI válido';
  end if;

  if v_front is null or v_back is null then
    raise exception 'Tenés que adjuntar el frente y el dorso del DNI';
  end if;

  if split_part(v_front, '/', 1) <> v_user_id::text
     or split_part(v_back, '/', 1) <> v_user_id::text
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'fefutin-player-dni' and o.name = v_front
     )
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'fefutin-player-dni' and o.name = v_back
     ) then
    raise exception 'No se encontraron los dos documentos DNI en tu carpeta privada';
  end if;

  -- No permite registrar al mismo DNI dos veces en distintos planteles.
  if exists (
    select 1
    from public.fefutin_club_roster_players rp
    where rp.identity_key = v_dni_key
      and rp.removed_at is null
      and rp.roster_id <> p_roster_id
  ) then
    raise exception 'Ese DNI ya está registrado en otro plantel FEFUTIN. Revisá el registro existente antes de duplicarlo.';
  end if;

  -- El guardado original valida la propiedad del club/categoría, conserva
  -- aprobados/rechazados y aplica la lógica vigente de vinculación por DNI.
  v_saved_roster := public.save_fefutin_permanent_roster(p_roster_id, p_players);

  update public.fefutin_club_roster_players rp
  set dni_front_path = v_front,
      dni_back_path = v_back,
      updated_at = now()
  where rp.roster_id = v_saved_roster
    and rp.identity_key = v_dni_key
    and rp.removed_at is null
    and rp.approval_status = 'pendiente';

  if not found then
    raise exception 'No se pudo asociar la documentación al jugador pendiente';
  end if;

  return v_saved_roster;
end;
$function$;

revoke all on function public.save_fefutin_permanent_roster_with_dni(uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.save_fefutin_permanent_roster_with_dni(uuid, jsonb, text, text, text) to authenticated;


-- Admin/Directivo obtiene únicamente las rutas de documentos del jugador.
-- La interfaz genera URLs firmadas de corta duración desde el bucket privado.
create or replace function public.get_fefutin_player_dni_documents(
  p_player_entry_id uuid
)
returns table (dni_front_path text, dni_back_path text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role not in ('admin', 'directivo')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo habilitado puede consultar documentos de identidad';
  end if;

  return query
  select rp.dni_front_path, rp.dni_back_path
  from public.fefutin_club_roster_players rp
  where rp.id = p_player_entry_id
    and rp.removed_at is null;
end;
$function$;

revoke all on function public.get_fefutin_player_dni_documents(uuid) from public, anon;
grant execute on function public.get_fefutin_player_dni_documents(uuid) to authenticated;

commit;
