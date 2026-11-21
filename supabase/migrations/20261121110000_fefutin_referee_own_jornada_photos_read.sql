-- FEFUTIN: permitir que el árbitro consulte únicamente sus propias fotos
-- para validar cargas múltiples y evitar duplicar documentos al reintentar.
begin;

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
