-- FEFUTIN: jerarquia definitiva rama/torneo -> turnos -> categorias -> jornadas -> partidos.
-- Migracion aditiva: conserva groups/playoffs, inscripciones y archivos historicos.
begin;

-- Un torneo de FEFUTIN representa una rama. Cada rama puede tener uno o ambos turnos.
create table if not exists public.fefutin_tournament_turns (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  turno text not null check (turno in ('Semanal', 'Fin de semana')),
  status text not null default 'inscripcion'
    check (status in ('inscripcion', 'en_curso', 'finalizada', 'suspendida')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fefutin_tournament_turns_tournament_turno_key unique (tournament_id, turno),
  constraint fefutin_tournament_turns_id_tournament_key unique (id, tournament_id)
);

create index if not exists fefutin_tournament_turns_tournament_idx
  on public.fefutin_tournament_turns(tournament_id, turno);

-- Cada rama dispone de ambos turnos. El turno que ya existia conserva
-- el estado historico; el segundo comienza con inscripciones abiertas.
insert into public.fefutin_tournament_turns (tournament_id, turno, status)
select
  t.id,
  v.turno,
  case
    when v.turno = case
      when coalesce(t.fefutin_turno, '') = 'Fin de semana'
        or coalesce(t.game, '') ilike '%Fin de semana%' then 'Fin de semana'
      else 'Semanal'
    end then
      case
        when lower(trim(coalesce(t.status, ''))) in ('finalizado', 'finalizada', 'completed') then 'finalizada'
        when lower(trim(coalesce(t.status, ''))) in ('en curso', 'en_curso', 'iniciado') then 'en_curso'
        else 'inscripcion'
      end
    else 'inscripcion'
  end
from public.tournaments t
cross join (values ('Semanal'::text), ('Fin de semana'::text)) as v(turno)
where t.fefutin_branch_id is not null
on conflict (tournament_id, turno) do nothing;

-- Cada categoria ahora pertenece a un turno concreto, no directamente a toda la rama.
alter table public.fefutin_tournament_categories
  add column if not exists turn_id uuid;

update public.fefutin_tournament_categories tc
set turn_id = tt.id
from public.fefutin_tournament_turns tt, public.tournaments t
where t.id = tc.tournament_id
  and tt.tournament_id = tc.tournament_id
  and tt.turno = case
    when coalesce(t.fefutin_turno, '') = 'Fin de semana'
      or coalesce(t.game, '') ilike '%Fin de semana%' then 'Fin de semana'
    else 'Semanal'
  end
  and tc.turn_id is null;

do $migration$
begin
  if exists (
    select 1
    from public.fefutin_tournament_categories
    where turn_id is null
  ) then
    raise exception 'Hay categorias normalizadas sin turno. Revisar tournaments.fefutin_branch_id y el backfill antes de continuar.';
  end if;
end;
$migration$;

alter table public.fefutin_tournament_categories
  alter column turn_id set not null;

alter table public.fefutin_tournament_categories
  drop constraint if exists fefutin_tournament_categories_unique;

alter table public.fefutin_tournament_categories
  drop constraint if exists fefutin_tournament_categories_turn_tournament_fkey;

alter table public.fefutin_tournament_categories
  add constraint fefutin_tournament_categories_turn_tournament_fkey
  foreign key (turn_id, tournament_id)
  references public.fefutin_tournament_turns(id, tournament_id)
  on delete cascade;

alter table public.fefutin_tournament_categories
  add constraint fefutin_tournament_categories_turn_category_key
  unique (turn_id, category_id);

create index if not exists fefutin_tournament_categories_turn_idx
  on public.fefutin_tournament_categories(turn_id, status);

-- Una jornada general pertenece al turno y agrupa las rondas de todas sus categorias.
create table if not exists public.fefutin_turn_journeys (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references public.fefutin_tournament_turns(id) on delete cascade,
  journey_number integer not null,
  scheduled_date date,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'en_curso', 'finalizada', 'suspendida')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fefutin_turn_journeys_number_positive check (journey_number > 0),
  constraint fefutin_turn_journeys_turn_number_key unique (turn_id, journey_number)
);

create index if not exists fefutin_turn_journeys_date_idx
  on public.fefutin_turn_journeys(turn_id, scheduled_date, journey_number);

-- La ronda de cada categoria se vincula a la jornada general correspondiente del turno.
alter table public.fefutin_rounds
  add column if not exists turn_journey_id uuid
    references public.fefutin_turn_journeys(id) on delete restrict;

create unique index if not exists fefutin_rounds_category_journey_key
  on public.fefutin_rounds(tournament_category_id, turn_journey_id)
  where turn_journey_id is not null;

create index if not exists fefutin_rounds_turn_journey_idx
  on public.fefutin_rounds(turn_journey_id);

-- Referencia estable al partido legacy para verificar cada migracion sin borrar el JSON.
alter table public.fefutin_matches
  add column if not exists legacy_tournament_id uuid references public.tournaments(id) on delete set null,
  add column if not exists legacy_phase text,
  add column if not exists legacy_match_id text,
  add column if not exists legacy_group_index integer,
  add column if not exists legacy_round_index integer,
  add column if not exists legacy_match_payload jsonb not null default '{}'::jsonb,
  add column if not exists local_name_snapshot text not null default '',
  add column if not exists visitor_name_snapshot text not null default '';

alter table public.fefutin_matches
  drop constraint if exists fefutin_matches_legacy_phase_check;

alter table public.fefutin_matches
  add constraint fefutin_matches_legacy_phase_check
  check (legacy_phase is null or legacy_phase in ('groups', 'playoffs'));

create unique index if not exists fefutin_matches_legacy_source_key
  on public.fefutin_matches(legacy_tournament_id, legacy_phase, legacy_match_id)
  where legacy_tournament_id is not null
    and legacy_phase is not null
    and legacy_match_id is not null;

-- Los partidos legacy que no puedan vincularse a clubes/categorias quedan auditados,
-- nunca se descartan ni se consideran migrados silenciosamente.
create table if not exists public.fefutin_legacy_match_migration_audit (
  id uuid primary key default gen_random_uuid(),
  source_tournament_id uuid,
  source_tournament_uuid text not null,
  source_phase text not null check (source_phase in ('groups', 'playoffs')),
  source_group_index integer,
  source_round_index integer,
  source_match_id text,
  match_payload jsonb not null,
  migration_status text not null default 'pendiente'
    check (migration_status in ('pendiente', 'migrado', 'requiere_revision')),
  reason text,
  checked_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists fefutin_legacy_match_audit_tournament_idx
  on public.fefutin_legacy_match_migration_audit(source_tournament_uuid, migration_status);

-- Mantener la referencia al turno en las tablas legacy que aun alimentan fichas y solicitudes.
alter table public.fefutin_club_tournaments
  add column if not exists turn_id uuid;

update public.fefutin_club_tournaments ct
set turn_id = tt.id
from public.fefutin_tournament_turns tt, public.tournaments t
where t.id = ct.tournament_id
  and tt.tournament_id = ct.tournament_id
  and tt.turno = case
    when coalesce(t.fefutin_turno, '') = 'Fin de semana'
      or coalesce(t.game, '') ilike '%Fin de semana%' then 'Fin de semana'
    else 'Semanal'
  end
  and ct.turn_id is null;

alter table public.fefutin_club_tournaments
  drop constraint if exists fefutin_club_tournaments_unique;

alter table public.fefutin_club_tournaments
  drop constraint if exists fefutin_club_tournaments_turn_tournament_fkey;

alter table public.fefutin_club_tournaments
  add constraint fefutin_club_tournaments_turn_tournament_fkey
  foreign key (turn_id, tournament_id)
  references public.fefutin_tournament_turns(id, tournament_id)
  on delete restrict;

create unique index if not exists fefutin_club_tournaments_turn_category_key
  on public.fefutin_club_tournaments(club_id, tournament_id, turn_id, category_label)
  where turn_id is not null;

-- Compatibilidad de participaciones antiguas marcadas como TODA LA TIRA:
-- crear una relacion legacy por categoria para que el disparador de planteles
-- permanentes pueda copiar el roster exacto de cada categoria. La fila original
-- TODA LA TIRA se conserva como respaldo.
insert into public.fefutin_club_tournaments (
  club_id, tournament_id, turn_id, category_label
)
select
  legacy.club_id,
  legacy.tournament_id,
  legacy.turn_id,
  b.name || ' · ' || cat.name
from public.fefutin_club_tournaments legacy
join public.fefutin_tournament_categories tc
  on tc.turn_id = legacy.turn_id
join public.fefutin_categories cat on cat.id = tc.category_id
join public.fefutin_branches b on b.id = cat.branch_id
where lower(trim(legacy.category_label)) = 'toda la tira'
  and legacy.turn_id is not null
on conflict (club_id, tournament_id, turn_id, category_label)
  where turn_id is not null
  do nothing;

-- El trigger anterior puede haber sembrado las inscripciones desde los planteles
-- permanentes. Vincular esos jugadores a la nueva relacion normalizada por categoria.
insert into public.fefutin_category_club_players (
  tournament_category_club_id, roster_player_id, jersey_number, sort_order, status
)
select
  tcc.id,
  entry.roster_player_id,
  entry.jersey_number,
  entry.sort_order,
  case entry.approval_status
    when 'aprobado' then 'aprobado'
    when 'rechazado' then 'rechazado'
    else 'pendiente'
  end
from public.fefutin_club_tournaments legacy
join public.fefutin_tournament_categories tc
  on tc.turn_id = legacy.turn_id
join public.fefutin_categories cat on cat.id = tc.category_id
join public.fefutin_branches b on b.id = cat.branch_id
join public.fefutin_tournament_category_clubs tcc
  on tcc.tournament_category_id = tc.id
 and tcc.club_id = legacy.club_id
 and tcc.status = 'aprobado'
join public.fefutin_roster_tournament_entries entry
  on entry.club_tournament_id = legacy.id
where lower(trim(legacy.category_label)) = lower(trim(b.name || ' · ' || cat.name))
on conflict (tournament_category_club_id, roster_player_id) do nothing;

alter table public.fefutin_club_tournament_requests
  add column if not exists turn_id uuid;

update public.fefutin_club_tournament_requests r
set turn_id = tt.id
from public.fefutin_tournament_turns tt, public.tournaments t
where t.id = r.tournament_id
  and tt.tournament_id = r.tournament_id
  and tt.turno = case
    when coalesce(t.fefutin_turno, '') = 'Fin de semana'
      or coalesce(t.game, '') ilike '%Fin de semana%' then 'Fin de semana'
    else 'Semanal'
  end
  and r.turn_id is null;

drop index if exists public.fefutin_club_tournament_requests_one_pending;

alter table public.fefutin_club_tournament_requests
  drop constraint if exists fefutin_club_tournament_requests_turn_tournament_fkey;

alter table public.fefutin_club_tournament_requests
  add constraint fefutin_club_tournament_requests_turn_tournament_fkey
  foreign key (turn_id, tournament_id)
  references public.fefutin_tournament_turns(id, tournament_id)
  on delete restrict;

create unique index if not exists fefutin_club_tournament_requests_one_pending_turn
  on public.fefutin_club_tournament_requests(club_id, tournament_id, turn_id)
  where status = 'pendiente' and turn_id is not null;

-- El archivo conserva sus columnas y filas actuales; los nuevos registros identifican turno/jornada.
alter table public.fefutin_jornada_sheets
  add column if not exists turn_id uuid references public.fefutin_tournament_turns(id) on delete restrict,
  add column if not exists turn_journey_id uuid references public.fefutin_turn_journeys(id) on delete restrict;

alter table public.fefutin_jornada_photos
  add column if not exists turn_id uuid references public.fefutin_tournament_turns(id) on delete restrict,
  add column if not exists turn_journey_id uuid references public.fefutin_turn_journeys(id) on delete restrict;

-- La planilla individual mantiene match_id (texto) para el archivo anterior y suma el UUID nuevo.
alter table public.fefutin_match_sheets
  add column if not exists normalized_match_id uuid references public.fefutin_matches(id) on delete restrict,
  add column if not exists turn_id uuid references public.fefutin_tournament_turns(id) on delete restrict,
  add column if not exists tournament_category_id uuid references public.fefutin_tournament_categories(id) on delete restrict;

create index if not exists fefutin_match_sheets_normalized_match_idx
  on public.fefutin_match_sheets(normalized_match_id)
  where normalized_match_id is not null;

create index if not exists fefutin_match_sheets_turn_category_idx
  on public.fefutin_match_sheets(turn_id, tournament_category_id)
  where turn_id is not null;

comment on table public.fefutin_tournament_turns is
  'Turnos Semanal y Fin de semana dentro de cada torneo de rama FEFUTIN.';
comment on table public.fefutin_turn_journeys is
  'Jornada general del turno; agrupa las rondas y partidos de todas las categorias de ese turno.';
comment on column public.fefutin_matches.legacy_match_payload is
  'Copia de respaldo del partido anterior de tournaments.groups/playoffs para auditoria de migracion.';
comment on column public.fefutin_match_sheets.normalized_match_id is
  'UUID del partido normalizado; match_id texto se conserva para compatibilidad historica.';

commit;
