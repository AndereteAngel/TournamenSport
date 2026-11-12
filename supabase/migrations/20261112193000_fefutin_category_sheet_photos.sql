-- FEFUTIN: incorporar fotos físicas de planillas por categoría al archivo existente.
begin;

alter table public.fefutin_jornada_photos
  add column if not exists document_type text not null default 'general',
  add column if not exists match_sheet_id uuid references public.fefutin_match_sheets(id) on delete restrict,
  add column if not exists categoria text;

alter table public.fefutin_jornada_photos
  drop constraint if exists fefutin_jornada_photos_document_type_check;
alter table public.fefutin_jornada_photos
  add constraint fefutin_jornada_photos_document_type_check
  check (document_type in ('general', 'category'));

create index if not exists fefutin_jornada_photos_match_sheet_idx
  on public.fefutin_jornada_photos (match_sheet_id)
  where match_sheet_id is not null;

-- Una única foto de planilla física por partido/categoría.
create unique index if not exists fefutin_jornada_photos_one_category_per_sheet_idx
  on public.fefutin_jornada_photos (match_sheet_id)
  where document_type = 'category' and match_sheet_id is not null;

-- Las fotos de categoría solo se incorporan después del cierre digital de su partido.
drop policy if exists fefutin_jornada_photos_referee_insert on public.fefutin_jornada_photos;
create policy fefutin_jornada_photos_referee_insert
  on public.fefutin_jornada_photos
  for insert to authenticated
  with check (
    referee_id = auth.uid()
    and public.has_fefutin_role(array['arbitro'])
    and (
      document_type = 'general'
      or (
        document_type = 'category'
        and match_sheet_id is not null
        and exists (
          select 1 from public.fefutin_match_sheets s
          where s.id = public.fefutin_jornada_photos.match_sheet_id
            and s.tournament_id = public.fefutin_jornada_photos.tournament_id
            and lower(trim(coalesce(s.estado, ''))) in ('cerrada', 'cerrado')
        )
      )
    )
  );

commit;
