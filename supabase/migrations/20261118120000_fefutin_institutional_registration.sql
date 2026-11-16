-- FEFUTIN: alta institucional independiente de los torneos.
-- Migración aditiva: no elimina clubes, participaciones, planteles ni jugadores.

begin;

alter table public.fefutin_clubs
  add column if not exists locality text;

create table if not exists public.fefutin_club_documents (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.fefutin_clubs(id) on delete restrict,
  document_type text not null default 'documentacion_institucional',
  file_name text not null,
  file_path text not null unique,
  review_status text not null default 'pendiente'
    check (review_status in ('pendiente', 'aprobado', 'observado')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);

create index if not exists fefutin_club_documents_club_idx
  on public.fefutin_club_documents(club_id, created_at desc);

alter table public.fefutin_club_documents enable row level security;
revoke all on public.fefutin_club_documents from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fefutin-club-documents',
  'fefutin-club-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fefutin_club_documents_upload_own" on storage.objects;
create policy "fefutin_club_documents_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fefutin-club-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "fefutin_club_documents_read_authorized" on storage.objects;
create policy "fefutin_club_documents_read_authorized"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fefutin-club-documents'
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

drop policy if exists "fefutin_club_documents_delete_own" on storage.objects;
create policy "fefutin_club_documents_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'fefutin-club-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Nueva firma: registra institución y documentación, sin crear participaciones.
create or replace function public.submit_fefutin_club_registration(
  p_name text,
  p_headquarters_address text,
  p_locality text,
  p_logo_path text,
  p_court_type text,
  p_referente_phone text,
  p_documents jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_club_id uuid;
  v_document jsonb;
  v_file_path text;
  v_file_name text;
begin
  if v_user_id is null then
    raise exception 'Tenés que iniciar sesión para enviar la inscripción';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo un referente habilitado puede enviar la inscripción del club';
  end if;

  if v_profile.club_id is not null then
    raise exception 'Tu cuenta ya tiene un club asociado';
  end if;

  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 100 then
    raise exception 'Ingresá un nombre de club válido';
  end if;

  if nullif(trim(p_headquarters_address), '') is null
     or char_length(trim(p_headquarters_address)) > 200 then
    raise exception 'Ingresá un domicilio válido';
  end if;

  if nullif(trim(p_locality), '') is null or char_length(trim(p_locality)) > 100 then
    raise exception 'Ingresá la localidad del club';
  end if;

  if nullif(trim(p_logo_path), '') is null
     or split_part(p_logo_path, '/', 1) <> v_user_id::text
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'fefutin-clubs'
         and o.name = p_logo_path
     ) then
    raise exception 'No se encontró el escudo del club subido a tu carpeta';
  end if;

  if coalesce(jsonb_typeof(p_documents), '') <> 'array' then
    raise exception 'La documentación tiene un formato inválido';
  end if;

  if jsonb_array_length(p_documents) > 10 then
    raise exception 'Podés adjuntar hasta 10 documentos institucionales';
  end if;

  insert into public.fefutin_clubs (
    name, headquarters_address, locality, logo_path,
    court_type, referente_phone, referente_user_id, is_active
  )
  values (
    trim(p_name), trim(p_headquarters_address), trim(p_locality), p_logo_path,
    nullif(trim(p_court_type), ''), nullif(trim(p_referente_phone), ''),
    v_user_id, false
  )
  returning id into v_club_id;

  for v_document in
    select value from jsonb_array_elements(p_documents)
  loop
    v_file_path := nullif(trim(v_document ->> 'file_path'), '');
    v_file_name := nullif(trim(v_document ->> 'file_name'), '');

    if v_file_path is null
       or v_file_name is null
       or split_part(v_file_path, '/', 1) <> v_user_id::text
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'fefutin-club-documents'
           and o.name = v_file_path
       ) then
      raise exception 'No se encontró uno de los documentos institucionales adjuntos';
    end if;

    insert into public.fefutin_club_documents (
      club_id, file_name, file_path
    )
    values (v_club_id, v_file_name, v_file_path);
  end loop;

  -- La institución queda pendiente de aprobación; no se crea ninguna
  -- relación en fefutin_club_tournaments.
  update public.profiles
  set club_id = v_club_id,
      role = 'visitante',
      requested_role = 'referente',
      approval_status = 'pendiente',
      approved_by = null,
      approved_at = null
  where id = v_user_id;

  return v_club_id;
end;
$function$;

revoke all on function public.submit_fefutin_club_registration(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.submit_fefutin_club_registration(text, text, text, text, text, text, jsonb) to authenticated;

-- Compatibilidad temporal con clientes anteriores: acepta la firma vieja,
-- pero ignora p_tournaments para que el alta institucional no dependa de ellos.
create or replace function public.submit_fefutin_club_registration(
  p_name text,
  p_headquarters_address text,
  p_logo_path text,
  p_court_type text,
  p_referente_phone text,
  p_tournaments jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $function$
  select public.submit_fefutin_club_registration(
    p_name,
    p_headquarters_address,
    'Localidad pendiente de completar',
    p_logo_path,
    p_court_type,
    p_referente_phone,
    '[]'::jsonb
  );
$function$;

revoke all on function public.submit_fefutin_club_registration(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.submit_fefutin_club_registration(text, text, text, text, text, jsonb) to authenticated;

commit;
