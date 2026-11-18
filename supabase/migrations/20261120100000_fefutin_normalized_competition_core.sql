-- FEFUTIN: nueva estructura normalizada de competencias.
-- Esta migración es exclusivamente aditiva: no elimina ni modifica datos legacy,
-- planteles permanentes, planillas ni archivos históricos.
begin;

-- Catálogo institucional de ramas y categorías.
create table if not exists public.fefutin_branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.fefutin_categories (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.fefutin_branches(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint fefutin_categories_branch_name_key unique (branch_id, name),
  constraint fefutin_categories_name_not_empty check (char_length(trim(name)) > 0)
);

insert into public.fefutin_branches (name, sort_order)
values ('Baby fútbol', 1), ('Femenino', 2), ('Sénior', 3), ('Futsal', 4)
on conflict (name) do nothing;

insert into public.fefutin_categories (branch_id, name, sort_order)
select b.id, v.category_name, v.sort_order
from public.fefutin_branches b
join (values
  ('Baby fútbol', 'Cat. 2014', 1),
  ('Baby fútbol', 'Cat. 2015', 2),
  ('Baby fútbol', 'Cat. 2016', 3),
  ('Baby fútbol', 'Cat. 2017', 4),
  ('Baby fútbol', 'Cat. 2018', 5),
  ('Baby fútbol', 'Cat. 2019', 6),
  ('Baby fútbol', 'Cat. 2020', 7),
  ('Baby fútbol', 'Cat. 2021', 8),
  ('Femenino', '+30', 1),
  ('Femenino', 'Libre', 2),
  ('Sénior', '+30', 1),
  ('Sénior', 'Libre', 2),
  ('Futsal', 'U15', 1),
  ('Futsal', 'U17', 2),
  ('Futsal', 'Primera', 3)
) as v(branch_name, category_name, sort_order)
  on v.branch_name = b.name
on conflict (branch_id, name) do nothing;

-- Datos normalizados de rama y turno en la cabecera del torneo.
-- Se conserva game para compatibilidad temporal con la interfaz anterior.
alter table public.tournaments
  add column if not exists fefutin_branch_id uuid
    references public.fefutin_branches(id) on delete restrict,
  add column if not exists fefutin_turno text;

alter table public.tournaments
  drop constraint if exists tournaments_fefutin_turno_check;

alter table public.tournaments
  add constraint tournaments_fefutin_turno_check
  check (fefutin_turno is null or fefutin_turno in ('Semanal', 'Fin de semana'));

-- Categorías habilitadas dentro de cada torneo. El formato y la configuración
-- pasan a pertenecer a cada categoría, no a un JSON compartido de grupos.
create table if not exists public.fefutin_tournament_categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id uuid not null references public.fefutin_categories(id) on delete restrict,
  format text not null default 'league',
  status text not null default 'inscripcion'
    check (status in ('inscripcion', 'en_curso', 'finalizada', 'suspendida')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fefutin_tournament_categories_unique unique (tournament_id, category_id),
  constraint fefutin_tournament_categories_format_check
    check (format in ('league', 'groups_playoff', 'playoff')),
  constraint fefutin_tournament_categories_settings_object
    check (jsonb_typeof(settings) = 'object')
);

-- Inscripción independiente de un club en una categoría concreta del torneo.
-- No depende de la restricción legacy (club_id, tournament_id).
create table if not exists public.fefutin_tournament_category_clubs (
  id uuid primary key default gen_random_uuid(),
  tournament_category_id uuid not null
    references public.fefutin_tournament_categories(id) on delete cascade,
  club_id uuid not null references public.fefutin_clubs(id) on delete restrict,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aprobado', 'desestimado', 'retirado')),
  requested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fefutin_tournament_category_clubs_unique
    unique (tournament_category_id, club_id)
);

-- Vincula jugadores del plantel permanente a la inscripción de ese club/categoría.
-- La ficha permanente sigue viviendo en fefutin_club_roster_players.
create table if not exists public.fefutin_category_club_players (
  id uuid primary key default gen_random_uuid(),
  tournament_category_club_id uuid not null
    references public.fefutin_tournament_category_clubs(id) on delete cascade,
  roster_player_id uuid not null
    references public.fefutin_club_roster_players(id) on delete restrict,
  jersey_number text not null default '',
  sort_order integer not null default 0,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aprobado', 'rechazado')),
  created_at timestamptz not null default now(),
  constraint fefutin_category_club_players_unique
    unique (tournament_category_club_id, roster_player_id)
);

-- Jornadas propias de cada categoría.
create table if not exists public.fefutin_rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_category_id uuid not null
    references public.fefutin_tournament_categories(id) on delete cascade,
  round_number integer not null,
  name text,
  scheduled_date date,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'en_curso', 'finalizada', 'suspendida')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fefutin_rounds_number_positive check (round_number > 0),
  constraint fefutin_rounds_category_number_key unique (tournament_category_id, round_number)
);

-- Partido con identidad UUID estable. La planilla y el resultado se relacionarán
-- con este registro, sin buscar el partido por índice dentro de tournaments.groups.
create table if not exists public.fefutin_matches (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.fefutin_rounds(id) on delete cascade,
  local_club_id uuid not null references public.fefutin_clubs(id) on delete restrict,
  visitor_club_id uuid not null references public.fefutin_clubs(id) on delete restrict,
  scheduled_date date,
  scheduled_time time,
  venue_address text,
  referee_id uuid references auth.users(id) on delete set null,
  local_score integer,
  visitor_score integer,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'programado', 'en_juego', 'finalizado', 'suspendido')),
  referee_closed_at timestamptz,
  referee_closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fefutin_matches_distinct_clubs check (local_club_id <> visitor_club_id),
  constraint fefutin_matches_scores_nonnegative
    check ((local_score is null or local_score >= 0) and (visitor_score is null or visitor_score >= 0))
);

create index if not exists fefutin_categories_branch_order_idx
  on public.fefutin_categories(branch_id, sort_order);

create index if not exists fefutin_tournament_categories_tournament_idx
  on public.fefutin_tournament_categories(tournament_id);

create index if not exists fefutin_tournament_category_clubs_club_idx
  on public.fefutin_tournament_category_clubs(club_id, status);

create index if not exists fefutin_category_club_players_roster_idx
  on public.fefutin_category_club_players(roster_player_id);

create index if not exists fefutin_rounds_category_date_idx
  on public.fefutin_rounds(tournament_category_id, scheduled_date, round_number);

create index if not exists fefutin_matches_round_idx
  on public.fefutin_matches(round_id, scheduled_date, scheduled_time);

create index if not exists fefutin_matches_referee_idx
  on public.fefutin_matches(referee_id, status)
  where referee_id is not null;

-- Cerradas al acceso directo hasta publicar las RPC con validación de roles.
alter table public.fefutin_branches enable row level security;
alter table public.fefutin_categories enable row level security;
alter table public.fefutin_tournament_categories enable row level security;
alter table public.fefutin_tournament_category_clubs enable row level security;
alter table public.fefutin_category_club_players enable row level security;
alter table public.fefutin_rounds enable row level security;
alter table public.fefutin_matches enable row level security;

revoke all on public.fefutin_branches from public, anon, authenticated;
revoke all on public.fefutin_categories from public, anon, authenticated;
revoke all on public.fefutin_tournament_categories from public, anon, authenticated;
revoke all on public.fefutin_tournament_category_clubs from public, anon, authenticated;
revoke all on public.fefutin_category_club_players from public, anon, authenticated;
revoke all on public.fefutin_rounds from public, anon, authenticated;
revoke all on public.fefutin_matches from public, anon, authenticated;

commit;
