-- FEFUTIN: vincular fotos nuevas a la jornada normalizada y permitir que
-- el árbitro consulte únicamente sus propias fotos para reintentos seguros.
-- Los registros históricos quedan con turn_journey_id NULL y no se mezclan.
begin;

alter table public.fefutin_jornada_photos
  add column if not exists turn_journey_id uuid
    references public.fefutin_turn_journeys(id) on delete set null;

create index if not exists fefutin_jornada_photos_turn_journey_idx
  on public.fefutin_jornada_photos (turn_journey_id, referee_id)
  where turn_journey_id is not null;

drop policy if exists fefutin_jornada_photos_referee_own_select
  on public.fefutin_jornada_photos;
create policy fefutin_jornada_photos_referee_own_select
  on public.fefutin_jornada_photos
  for select to authenticated
  using (
    referee_id = auth.uid()
    and public.has_fefutin_role(array['arbitro'])
  );

drop policy if exists fefutin_jornada_photos_storage_referee_own_select
  on storage.objects;
create policy fefutin_jornada_photos_storage_referee_own_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fefutin-jornada-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_fefutin_role(array['arbitro'])
  );

commit;
