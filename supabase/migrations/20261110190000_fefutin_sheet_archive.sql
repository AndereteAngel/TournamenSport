-- FEFUTIN: archivo de planillas digitales y fotos de jornadas.
begin;

create table if not exists public.fefutin_jornada_photos (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  jornada_date date not null,
  jornada_label text,
  referee_id uuid not null references auth.users(id) on delete restrict,
  referee_name text,
  storage_path text not null unique,
  original_filename text,
  created_at timestamptz not null default now()
);

create index if not exists fefutin_jornada_photos_tournament_date_idx
  on public.fefutin_jornada_photos (tournament_id, jornada_date desc);

alter table public.fefutin_jornada_photos enable row level security;

drop policy if exists fefutin_jornada_photos_admin_select on public.fefutin_jornada_photos;
create policy fefutin_jornada_photos_admin_select
  on public.fefutin_jornada_photos
  for select to authenticated
  using (public.has_fefutin_role(array['admin', 'directivo']));

drop policy if exists fefutin_jornada_photos_referee_insert on public.fefutin_jornada_photos;
create policy fefutin_jornada_photos_referee_insert
  on public.fefutin_jornada_photos
  for insert to authenticated
  with check (
    referee_id = auth.uid()
    and public.has_fefutin_role(array['arbitro'])
  );

grant select, insert on public.fefutin_jornada_photos to authenticated;

-- El archivo privado evita que las fotos firmadas queden expuestas mediante URL pública.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fefutin-jornada-photos', 'fefutin-jornada-photos', false, 12582912, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = 12582912,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists fefutin_jornada_photos_storage_referee_insert on storage.objects;
create policy fefutin_jornada_photos_storage_referee_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fefutin-jornada-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_fefutin_role(array['arbitro'])
  );

drop policy if exists fefutin_jornada_photos_storage_admin_select on storage.objects;
create policy fefutin_jornada_photos_storage_admin_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fefutin-jornada-photos'
    and public.has_fefutin_role(array['admin', 'directivo'])
  );

-- Lectura de planillas cerradas y sus jugadores únicamente para el archivo institucional.
drop policy if exists fefutin_match_sheets_archive_select on public.fefutin_match_sheets;
create policy fefutin_match_sheets_archive_select
  on public.fefutin_match_sheets
  for select to authenticated
  using (
    lower(trim(coalesce(estado, ''))) in ('cerrada', 'cerrado')
    and public.has_fefutin_role(array['admin', 'directivo'])
  );

drop policy if exists fefutin_match_sheet_players_archive_select on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_archive_select
  on public.fefutin_match_sheet_players
  for select to authenticated
  using (
    exists (
      select 1
      from public.fefutin_match_sheets s
      where s.id = match_sheet_id
        and lower(trim(coalesce(s.estado, ''))) in ('cerrada', 'cerrado')
    )
    and public.has_fefutin_role(array['admin', 'directivo'])
  );

grant select on public.fefutin_match_sheets to authenticated;
grant select on public.fefutin_match_sheet_players to authenticated;

commit;
