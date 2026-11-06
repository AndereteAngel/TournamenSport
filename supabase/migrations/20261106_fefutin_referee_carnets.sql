-- FEFUTIN: carnet digital de árbitros con datos personales aislados y acceso restringido.
begin;

-- La información del carnet vive en una tabla separada: no amplía los datos
-- visibles mediante las consultas ordinarias de profiles.
create table if not exists public.fefutin_referee_carnets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  first_name text,
  last_name text,
  referee_number text,
  locality text,
  birth_date date,
  photo_path text,
  updated_at timestamptz not null default now(),
  constraint fefutin_referee_photo_path_check
    check (photo_path is null or photo_path = user_id::text || '/photo')
);

alter table public.fefutin_referee_carnets enable row level security;
revoke all on public.fefutin_referee_carnets from public, anon, authenticated;

create or replace function public.can_view_fefutin_referee_carnets()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
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
  select p.id, p.username, c.first_name, c.last_name,
         c.referee_number, c.locality, c.birth_date, c.photo_path
  from public.profiles p
  left join public.fefutin_referee_carnets c on c.user_id = p.id
  where p.role = 'arbitro'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null
    and (v_role in ('admin', 'directivo') or p.id = auth.uid())
  order by coalesce(nullif(c.last_name, ''), p.username), p.username;
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

  insert into public.fefutin_referee_carnets (
    user_id, first_name, last_name, referee_number, locality, birth_date, photo_path, updated_at
  )
  values (
    auth.uid(), nullif(trim(p_first_name), ''), nullif(trim(p_last_name), ''),
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
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'arbitro'
          and p.approval_status = 'aprobado' and p.deactivated_at is null
      )
    )
  )
);

drop policy if exists fefutin_carnet_photo_insert on storage.objects;
create policy fefutin_carnet_photo_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fefutin-carnets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and storage.filename(name) = 'photo'
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
  and storage.filename(name) = 'photo'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'arbitro'
      and p.approval_status = 'aprobado' and p.deactivated_at is null
  )
)
with check (
  bucket_id = 'fefutin-carnets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and storage.filename(name) = 'photo'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'arbitro'
      and p.approval_status = 'aprobado' and p.deactivated_at is null
  )
);

drop policy if exists fefutin_carnet_photo_delete on storage.objects;
create policy fefutin_carnet_photo_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'fefutin-carnets'
  and (storage.foldername(name))[1] = auth.uid()::text
  and storage.filename(name) = 'photo'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'arbitro'
      and p.approval_status = 'aprobado' and p.deactivated_at is null
  )
);

commit;
