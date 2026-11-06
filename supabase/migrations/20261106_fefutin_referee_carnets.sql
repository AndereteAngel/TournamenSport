-- FEFUTIN: carnet digital de árbitros con lectura restringida.
begin;

alter table public.profiles
  add column if not exists referee_first_name text,
  add column if not exists referee_last_name text,
  add column if not exists referee_number text,
  add column if not exists referee_locality text,
  add column if not exists referee_birth_date date,
  add column if not exists referee_photo_path text;

create or replace function public.can_view_fefutin_referee_carnets()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approval_status = 'aprobado'
      and p.deactivated_at is null
      and p.role in ('admin', 'directivo')
  );
$$;

create or replace function public.get_fefutin_referee_carnets()
returns table (
  id uuid,
  username text,
  first_name text,
  last_name text,
  referee_number text,
  locality text,
  birth_date date,
  photo_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_role, '') not in ('admin', 'directivo', 'arbitro') then
    raise exception 'No tenés permisos para consultar carnets';
  end if;

  return query
  select p.id, p.username, p.referee_first_name, p.referee_last_name,
         p.referee_number, p.referee_locality, p.referee_birth_date,
         p.referee_photo_path
  from public.profiles p
  where p.role = 'arbitro'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null
    and (v_role in ('admin', 'directivo') or p.id = auth.uid())
  order by coalesce(nullif(p.referee_last_name, ''), p.username), p.username;
end;
$$;

create or replace function public.save_my_fefutin_referee_carnet(
  p_first_name text,
  p_last_name text,
  p_referee_number text,
  p_locality text,
  p_birth_date date,
  p_photo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'arbitro'
      and p.approval_status = 'aprobado'
      and p.deactivated_at is null
  ) then
    raise exception 'Solo un árbitro habilitado puede editar su carnet';
  end if;

  if p_photo_path is not null and p_photo_path <> (auth.uid()::text || '/photo') then
    raise exception 'Ruta de fotografía inválida';
  end if;

  update public.profiles
  set referee_first_name = nullif(trim(p_first_name), ''),
      referee_last_name = nullif(trim(p_last_name), ''),
      referee_number = nullif(trim(p_referee_number), ''),
      referee_locality = nullif(trim(p_locality), ''),
      referee_birth_date = p_birth_date,
      referee_photo_path = p_photo_path
  where id = auth.uid();
end;
$$;

revoke all on function public.can_view_fefutin_referee_carnets() from public, anon;
revoke all on function public.get_fefutin_referee_carnets() from public, anon;
revoke all on function public.save_my_fefutin_referee_carnet(text,text,text,text,date,text) from public, anon;
grant execute on function public.can_view_fefutin_referee_carnets() to authenticated;
grant execute on function public.get_fefutin_referee_carnets() to authenticated;
grant execute on function public.save_my_fefutin_referee_carnet(text,text,text,text,date,text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fefutin-carnets', 'fefutin-carnets', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists fefutin_carnet_photo_read on storage.objects;
create policy fefutin_carnet_photo_read
on storage.objects for select to authenticated
using (
  bucket_id = 'fefutin-carnets'
  and (
    public.can_view_fefutin_referee_carnets()
    or (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'arbitro' and p.approval_status = 'aprobado' and p.deactivated_at is null)
    )
  )
);

drop policy if exists fefutin_carnet_photo_insert on storage.objects;
create policy fefutin_carnet_photo_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fefutin-carnets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.filename(name)) = 'photo'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'arbitro'
      and p.approval_status = 'aprobado' and p.deactivated_at is null
  )
);

drop policy if exists fefutin_carnet_photo_update on storage.objects;
create policy fefutin_carnet_photo_update
on storage.objects for update to authenticated
using (
  bucket_id = 'fefutin-carnets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.filename(name)) = 'photo'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'arbitro' and p.approval_status = 'aprobado' and p.deactivated_at is null)
)
with check (
  bucket_id = 'fefutin-carnets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.filename(name)) = 'photo'
);

drop policy if exists fefutin_carnet_photo_delete on storage.objects;
create policy fefutin_carnet_photo_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'fefutin-carnets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.filename(name)) = 'photo'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'arbitro' and p.approval_status = 'aprobado' and p.deactivated_at is null)
);

commit;
