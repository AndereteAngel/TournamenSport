-- FEFUTIN: vincular fotos nuevas a la jornada normalizada y permitir que
-- los árbitros designados en esa jornada consulten los documentos ya cargados.
-- Los registros históricos quedan con turn_journey_id NULL y no se mezclan.
begin;

alter table public.fefutin_jornada_photos
  add column if not exists turn_journey_id uuid
    references public.fefutin_turn_journeys(id) on delete set null;

create index if not exists fefutin_jornada_photos_turn_journey_idx
  on public.fefutin_jornada_photos (turn_journey_id, referee_id)
  where turn_journey_id is not null;

create unique index if not exists fefutin_jornada_photos_one_general_per_journey_idx
  on public.fefutin_jornada_photos (turn_journey_id)
  where document_type = 'general' and turn_journey_id is not null;

create or replace function public.can_referee_access_journey_photos(
  p_turn_journey_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    public.has_fefutin_role(array['arbitro'])
    and exists (
      select 1
      from public.fefutin_matches m
      join public.fefutin_rounds r on r.id = m.round_id
      where r.turn_journey_id = p_turn_journey_id
        and m.referee_id = auth.uid()
    );
$function$;

revoke all on function public.can_referee_access_journey_photos(uuid) from public, anon;
grant execute on function public.can_referee_access_journey_photos(uuid) to authenticated;

drop policy if exists fefutin_jornada_photos_referee_own_select
  on public.fefutin_jornada_photos;
create policy fefutin_jornada_photos_referee_own_select
  on public.fefutin_jornada_photos
  for select to authenticated
  using (
    referee_id = auth.uid()
    and public.has_fefutin_role(array['arbitro'])
  );

drop policy if exists fefutin_jornada_photos_referee_journey_select
  on public.fefutin_jornada_photos;
create policy fefutin_jornada_photos_referee_journey_select
  on public.fefutin_jornada_photos
  for select to authenticated
  using (
    turn_journey_id is not null
    and public.can_referee_access_journey_photos(turn_journey_id)
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
