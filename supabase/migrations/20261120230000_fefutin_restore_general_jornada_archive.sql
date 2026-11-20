-- FEFUTIN: restaura el archivo general de jornadas conectado a turnos y jornadas normalizadas.
-- No elimina ni reemplaza datos. La planilla general conserva la copia institucional
-- de la jornada; las planillas individuales siguen viviendo en fefutin_match_sheets.

begin;

create table if not exists public.fefutin_jornada_sheets (
  id uuid primary key default gen_random_uuid(),
  jornada_key text not null unique,
  tournament_id uuid references public.tournaments(id) on delete set null,
  tournament_ids uuid[] not null default '{}'::uuid[],
  turn_id uuid references public.fefutin_tournament_turns(id) on delete set null,
  turn_journey_id uuid references public.fefutin_turn_journeys(id) on delete set null,
  tournament_title text not null,
  rama text not null,
  turno text,
  journey_number integer,
  team_local text not null,
  team_visitante text not null,
  referee_id uuid not null references auth.users(id) on delete restrict,
  referee_name text,
  jornada_date date not null default current_date,
  categorias jsonb not null default '[]'::jsonb,
  detalles jsonb not null default '[]'::jsonb,
  puntos_local integer not null default 0,
  puntos_visitante integer not null default 0,
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint fefutin_jornada_sheets_categories_array check (jsonb_typeof(categorias) = 'array'),
  constraint fefutin_jornada_sheets_details_array check (jsonb_typeof(detalles) = 'array'),
  constraint fefutin_jornada_sheets_points_nonnegative check (puntos_local >= 0 and puntos_visitante >= 0)
);

alter table public.fefutin_jornada_sheets
  add column if not exists tournament_ids uuid[] not null default '{}'::uuid[],
  add column if not exists turn_id uuid references public.fefutin_tournament_turns(id) on delete set null,
  add column if not exists turn_journey_id uuid references public.fefutin_turn_journeys(id) on delete set null,
  add column if not exists turno text,
  add column if not exists journey_number integer;

-- Compatibilidad con la migración histórica que conservaba el archivo al borrar torneos.
alter table public.fefutin_jornada_sheets
  alter column tournament_id drop not null;

alter table public.fefutin_jornada_sheets
  drop constraint if exists fefutin_jornada_sheets_tournament_id_fkey;

alter table public.fefutin_jornada_sheets
  add constraint fefutin_jornada_sheets_tournament_id_fkey
  foreign key (tournament_id) references public.tournaments(id) on delete set null;

create index if not exists fefutin_jornada_sheets_archive_idx
  on public.fefutin_jornada_sheets (tournament_id, jornada_date desc);

create index if not exists fefutin_jornada_sheets_tournament_ids_idx
  on public.fefutin_jornada_sheets using gin (tournament_ids);

create index if not exists fefutin_jornada_sheets_turn_journey_idx
  on public.fefutin_jornada_sheets(turn_id, turn_journey_id, jornada_date desc);

alter table public.fefutin_jornada_sheets enable row level security;

drop policy if exists fefutin_jornada_sheets_admin_select on public.fefutin_jornada_sheets;
create policy fefutin_jornada_sheets_admin_select
  on public.fefutin_jornada_sheets
  for select to authenticated
  using (public.has_fefutin_role(array['admin', 'directivo']));

drop policy if exists fefutin_jornada_sheets_referee_select on public.fefutin_jornada_sheets;
create policy fefutin_jornada_sheets_referee_select
  on public.fefutin_jornada_sheets
  for select to authenticated
  using (referee_id = auth.uid() and public.has_fefutin_role(array['arbitro']));

drop policy if exists fefutin_jornada_sheets_referee_insert on public.fefutin_jornada_sheets;
create policy fefutin_jornada_sheets_referee_insert
  on public.fefutin_jornada_sheets
  for insert to authenticated
  with check (referee_id = auth.uid() and public.has_fefutin_role(array['arbitro']));

grant select, insert on public.fefutin_jornada_sheets to authenticated;

notify pgrst, 'reload schema';

commit;
