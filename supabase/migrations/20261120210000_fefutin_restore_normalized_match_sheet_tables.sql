-- FEFUTIN: restaura la estructura persistente de las planillas oficiales.
-- Idempotente: no elimina ni reemplaza datos existentes.
begin;

create table if not exists public.fefutin_match_sheets (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id text not null,
  normalized_match_id uuid references public.fefutin_matches(id) on delete cascade,
  turn_id uuid references public.fefutin_tournament_turns(id) on delete set null,
  tournament_category_id uuid references public.fefutin_tournament_categories(id) on delete set null,
  jornada text,
  club_local text not null default '',
  club_visitante text not null default '',
  sede text,
  fecha_partido date,
  categoria text,
  arbitro_designado text,
  observaciones text,
  lado text not null default 'conjunta'
    check (lado in ('conjunta', 'local', 'visitante')),
  estado text not null default 'abierta',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Completa columnas incorporadas por las migraciones de turnos y partidos UUID.
alter table public.fefutin_match_sheets
  add column if not exists normalized_match_id uuid references public.fefutin_matches(id) on delete cascade,
  add column if not exists turn_id uuid references public.fefutin_tournament_turns(id) on delete set null,
  add column if not exists tournament_category_id uuid references public.fefutin_tournament_categories(id) on delete set null,
  add column if not exists lado text not null default 'conjunta',
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.fefutin_match_sheets
  drop constraint if exists fefutin_match_sheets_lado_check;
alter table public.fefutin_match_sheets
  add constraint fefutin_match_sheets_lado_check
  check (lado in ('conjunta', 'local', 'visitante'));

create unique index if not exists fefutin_match_sheets_tournament_match_side_key
  on public.fefutin_match_sheets(tournament_id, match_id, lado);

create index if not exists fefutin_match_sheets_normalized_match_idx
  on public.fefutin_match_sheets(normalized_match_id)
  where normalized_match_id is not null;

create table if not exists public.fefutin_match_sheet_players (
  id uuid primary key default gen_random_uuid(),
  match_sheet_id uuid not null references public.fefutin_match_sheets(id) on delete cascade,
  player_id uuid references public.fefutin_players(id) on delete set null,
  club text not null default '',
  nombre text not null default '',
  apellido text not null default '',
  numero_camiseta integer,
  goles integer not null default 0 check (goles >= 0),
  es_capitan boolean not null default false,
  tarjetas_amarillas integer not null default 0 check (tarjetas_amarillas >= 0),
  tarjetas_rojas integer not null default 0 check (tarjetas_rojas >= 0),
  estado_habilitacion text not null default 'pendiente',
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fefutin_match_sheet_players_sheet_idx
  on public.fefutin_match_sheet_players(match_sheet_id);
create index if not exists fefutin_match_sheet_players_player_idx
  on public.fefutin_match_sheet_players(player_id)
  where player_id is not null;
create unique index if not exists fefutin_match_sheet_players_unique_player
  on public.fefutin_match_sheet_players(match_sheet_id, player_id)
  where player_id is not null;

alter table public.fefutin_match_sheets enable row level security;
alter table public.fefutin_match_sheet_players enable row level security;

drop policy if exists fefutin_match_sheets_normalized_select on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_select
on public.fefutin_match_sheets for select to authenticated
using (
  normalized_match_id is not null
  and exists (
    select 1 from public.fefutin_matches m
    where m.id = normalized_match_id
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
);

drop policy if exists fefutin_match_sheets_normalized_insert on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_insert
on public.fefutin_match_sheets for insert to authenticated
with check (
  normalized_match_id is not null
  and estado not in ('cerrada', 'cerrado')
  and exists (
    select 1 from public.fefutin_matches m
    where m.id = normalized_match_id
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
);

drop policy if exists fefutin_match_sheets_normalized_update on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_update
on public.fefutin_match_sheets for update to authenticated
using (
  normalized_match_id is not null
  and estado not in ('cerrada', 'cerrado')
  and exists (
    select 1 from public.fefutin_matches m
    where m.id = normalized_match_id
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
)
with check (
  normalized_match_id is not null
  and estado not in ('cerrada', 'cerrado')
  and exists (
    select 1 from public.fefutin_matches m
    where m.id = normalized_match_id
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
);

drop policy if exists fefutin_match_sheet_players_normalized_select on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_select
on public.fefutin_match_sheet_players for select to authenticated
using (
  exists (
    select 1 from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
);

drop policy if exists fefutin_match_sheet_players_normalized_insert on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_insert
on public.fefutin_match_sheet_players for insert to authenticated
with check (
  exists (
    select 1 from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and s.estado not in ('cerrada', 'cerrado')
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
);

drop policy if exists fefutin_match_sheet_players_normalized_update on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_update
on public.fefutin_match_sheet_players for update to authenticated
using (
  exists (
    select 1 from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and s.estado not in ('cerrada', 'cerrado')
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
)
with check (
  exists (
    select 1 from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and s.estado not in ('cerrada', 'cerrado')
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
);

drop policy if exists fefutin_match_sheet_players_normalized_delete on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_delete
on public.fefutin_match_sheet_players for delete to authenticated
using (
  exists (
    select 1 from public.fefutin_match_sheets s
    join public.fefutin_matches m on m.id = s.normalized_match_id
    where s.id = match_sheet_id
      and s.estado not in ('cerrada', 'cerrado')
      and m.status <> 'finalizado'
      and m.referee_closed_at is null
      and (
        public.has_fefutin_role(array['admin','directivo'])
        or (public.has_fefutin_role(array['arbitro']) and m.referee_id = auth.uid())
      )
  )
);

grant select, insert, update, delete on public.fefutin_match_sheets to authenticated;
grant select, insert, update, delete on public.fefutin_match_sheet_players to authenticated;

notify pgrst, 'reload schema';
commit;
