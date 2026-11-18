-- FEFUTIN: permisos de lectura/escritura para planillas vinculadas a partidos UUID.
-- Las politicas solo amplian el acceso a filas normalizadas y mantienen la validacion legacy existente.
begin;

alter table public.fefutin_match_sheets enable row level security;
alter table public.fefutin_match_sheet_players enable row level security;

drop policy if exists fefutin_match_sheets_normalized_select on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_select
on public.fefutin_match_sheets
for select to authenticated
using (
  normalized_match_id is not null
  and exists (
    select 1
    from public.fefutin_matches m
    where m.id = normalized_match_id
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
);

drop policy if exists fefutin_match_sheets_normalized_insert on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_insert
on public.fefutin_match_sheets
for insert to authenticated
with check (
  normalized_match_id is not null
  and estado not in ('cerrada', 'cerrado')
  and exists (
    select 1
    from public.fefutin_matches m
    where m.id = normalized_match_id
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
);

drop policy if exists fefutin_match_sheets_normalized_update on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_update
on public.fefutin_match_sheets
for update to authenticated
using (
  normalized_match_id is not null
  and estado not in ('cerrada', 'cerrado')
  and exists (
    select 1
    from public.fefutin_matches m
    where m.id = normalized_match_id
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
)
with check (
  normalized_match_id is not null
  and estado not in ('cerrada', 'cerrado')
  and exists (
    select 1
    from public.fefutin_matches m
    where m.id = normalized_match_id
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
);

drop policy if exists fefutin_match_sheets_normalized_delete on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_delete
on public.fefutin_match_sheets
for delete to authenticated
using (
  normalized_match_id is not null
  and estado not in ('cerrada', 'cerrado')
  and (
    public.has_fefutin_role(array['admin','directivo'])
    or exists (
      select 1
      from public.fefutin_matches m
      where m.id = normalized_match_id
        and public.has_fefutin_role(array['arbitro'])
        and m.referee_id = auth.uid()
        and m.status <> 'finalizado'
    )
  )
);

drop policy if exists fefutin_match_sheet_players_normalized_select on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_select
on public.fefutin_match_sheet_players
for select to authenticated
using (
  exists (
    select 1
    from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
);

drop policy if exists fefutin_match_sheet_players_normalized_insert on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_insert
on public.fefutin_match_sheet_players
for insert to authenticated
with check (
  exists (
    select 1
    from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and s.estado not in ('cerrada', 'cerrado')
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
);

drop policy if exists fefutin_match_sheet_players_normalized_update on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_update
on public.fefutin_match_sheet_players
for update to authenticated
using (
  exists (
    select 1
    from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and s.estado not in ('cerrada', 'cerrado')
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and s.estado not in ('cerrada', 'cerrado')
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
);

drop policy if exists fefutin_match_sheet_players_normalized_delete on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_delete
on public.fefutin_match_sheet_players
for delete to authenticated
using (
  exists (
    select 1
    from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and s.estado not in ('cerrada', 'cerrado')
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (
          public.has_fefutin_role(array['arbitro'])
          and m.referee_id = auth.uid()
        )
      )
  )
);

commit;
