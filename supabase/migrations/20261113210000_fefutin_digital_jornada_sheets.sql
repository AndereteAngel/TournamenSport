-- FEFUTIN: archivo digital e inmutable de planillas generales por cruce de clubes.
begin;

create table if not exists public.fefutin_jornada_sheets (
  id uuid primary key default gen_random_uuid(),
  jornada_key text not null unique,
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  tournament_title text not null,
  rama text not null,
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

create index if not exists fefutin_jornada_sheets_archive_idx
  on public.fefutin_jornada_sheets (tournament_id, jornada_date desc);

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
  using (
    referee_id = auth.uid()
    and public.has_fefutin_role(array['arbitro'])
  );

drop policy if exists fefutin_jornada_sheets_referee_insert on public.fefutin_jornada_sheets;
create policy fefutin_jornada_sheets_referee_insert
  on public.fefutin_jornada_sheets
  for insert to authenticated
  with check (
    referee_id = auth.uid()
    and public.has_fefutin_role(array['arbitro'])
  );

grant select, insert on public.fefutin_jornada_sheets to authenticated;

comment on table public.fefutin_jornada_sheets is
  'Copia cerrada e inmutable de la planilla digital general por cruce de clubes, con todas las categorías y puntos acumulados.';

commit;
