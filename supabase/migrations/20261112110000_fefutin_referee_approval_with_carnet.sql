-- FEFUTIN: alta de árbitros con carnet integrado en la aprobación.
-- Admin/Directivo completa los datos y la aprobación + creación del carnet
-- se confirman en una única transacción.

begin;

create or replace function public.approve_fefutin_referee_with_carnet(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_referee_number text,
  p_locality text,
  p_birth_date date default null,
  p_photo_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target public.profiles%rowtype;
begin
  select p.role
    into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenés permisos para aprobar solicitudes de árbitros';
  end if;

  if nullif(trim(p_first_name), '') is null
     or nullif(trim(p_last_name), '') is null
     or nullif(trim(p_referee_number), '') is null
     or nullif(trim(p_locality), '') is null then
    raise exception 'Nombre, apellido, matrícula y localidad son obligatorios';
  end if;

  select p.*
    into v_target
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found
     or v_target.approval_status <> 'pendiente'
     or v_target.requested_role <> 'arbitro' then
    raise exception 'La solicitud de árbitro ya no está pendiente o no existe';
  end if;

  if p_photo_path is not null and p_photo_path <> (p_user_id::text || '/photo') then
    raise exception 'Ruta de fotografía inválida';
  end if;

  update public.profiles
  set role = 'arbitro',
      approval_status = 'aprobado',
      approved_by = v_actor_id,
      approved_at = now(),
      deactivated_at = null
  where id = p_user_id;

  insert into public.fefutin_referee_carnets (
    user_id, first_name, last_name, referee_number, locality,
    birth_date, photo_path, updated_at
  )
  values (
    p_user_id, nullif(trim(p_first_name), ''), nullif(trim(p_last_name), ''),
    nullif(trim(p_referee_number), ''), nullif(trim(p_locality), ''),
    p_birth_date, p_photo_path, now()
  )
  on conflict (user_id) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    referee_number = excluded.referee_number,
    locality = excluded.locality,
    birth_date = excluded.birth_date,
    photo_path = excluded.photo_path,
    updated_at = now();

  insert into public.fefutin_access_audit (
    actor_id, target_user_id, action, old_role, new_role,
    old_status, new_status, details
  )
  values (
    v_actor_id, p_user_id, 'solicitud_aprobada',
    v_target.role, 'arbitro',
    v_target.approval_status, 'aprobado',
    jsonb_build_object(
      'requested_role', 'arbitro',
      'carnet_created', true,
      'photo_uploaded', p_photo_path is not null
    )
  );
end;
$$;

revoke all on function public.approve_fefutin_referee_with_carnet(uuid,text,text,text,text,date,text) from public, anon;
grant execute on function public.approve_fefutin_referee_with_carnet(uuid,text,text,text,text,date,text) to authenticated;

-- Permitir que Admin/Directivo cargue la foto del carnet de una solicitud
-- pendiente de árbitro. El árbitro conserva sus permisos de autoedición.
drop policy if exists fefutin_carnet_photo_insert on storage.objects;
create policy fefutin_carnet_photo_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fefutin-carnets'
  and storage.filename(name) = 'photo'
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'arbitro'
          and p.approval_status = 'aprobado' and p.deactivated_at is null
      )
    )
    or
    (
      exists (
        select 1 from public.profiles actor
        where actor.id = auth.uid() and actor.role in ('admin','directivo')
          and actor.approval_status = 'aprobado' and actor.deactivated_at is null
      )
      and exists (
        select 1 from public.profiles target
        where target.id::text = (storage.foldername(name))[1]
          and target.requested_role = 'arbitro'
          and target.approval_status = 'pendiente'
      )
    )
  )
);

drop policy if exists fefutin_carnet_photo_update on storage.objects;
create policy fefutin_carnet_photo_update
on storage.objects for update to authenticated
using (
  bucket_id = 'fefutin-carnets'
  and storage.filename(name) = 'photo'
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'arbitro'
          and p.approval_status = 'aprobado' and p.deactivated_at is null
      )
    )
    or
    (
      exists (
        select 1 from public.profiles actor
        where actor.id = auth.uid() and actor.role in ('admin','directivo')
          and actor.approval_status = 'aprobado' and actor.deactivated_at is null
      )
      and exists (
        select 1 from public.profiles target
        where target.id::text = (storage.foldername(name))[1]
          and target.requested_role = 'arbitro'
          and target.approval_status = 'pendiente'
      )
    )
  )
)
with check (
  bucket_id = 'fefutin-carnets'
  and storage.filename(name) = 'photo'
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'arbitro'
          and p.approval_status = 'aprobado' and p.deactivated_at is null
      )
    )
    or
    (
      exists (
        select 1 from public.profiles actor
        where actor.id = auth.uid() and actor.role in ('admin','directivo')
          and actor.approval_status = 'aprobado' and actor.deactivated_at is null
      )
      and exists (
        select 1 from public.profiles target
        where target.id::text = (storage.foldername(name))[1]
          and target.requested_role = 'arbitro'
          and target.approval_status = 'pendiente'
      )
    )
  )
);

commit;
