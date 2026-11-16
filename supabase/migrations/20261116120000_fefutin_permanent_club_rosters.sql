-- FEFUTIN: planteles permanentes por club/categoría.
-- Migración aditiva: no elimina ni modifica las tablas actuales de torneos.
-- Cada fila histórica se archiva antes de crear las relaciones permanentes.

begin;

create table if not exists public.fefutin_club_rosters (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.fefutin_clubs(id) on delete restrict,
  category_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, category_label)
);

create table if not exists public.fefutin_club_roster_players (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.fefutin_club_rosters(id) on delete restrict,
  identity_key text not null,
  first_name text not null default '',
  last_name text not null default '',
  dni text not null default '',
  birth_date date,
  photo_path text,
  approval_status text not null default 'pendiente'
    check (approval_status in ('pendiente', 'aprobado', 'rechazado')),
  registry_player_id uuid references public.fefutin_players(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_id, identity_key)
);

create index if not exists fefutin_club_roster_players_roster_idx
  on public.fefutin_club_roster_players(roster_id, last_name, first_name);

-- Relación de un jugador permanente con cada torneo en el que fue inscripto.
-- El número de camiseta y el orden pertenecen a la participación, no al jugador.
create table if not exists public.fefutin_roster_tournament_entries (
  id uuid primary key default gen_random_uuid(),
  roster_player_id uuid not null
    references public.fefutin_club_roster_players(id) on delete restrict,
  club_tournament_id uuid not null
    references public.fefutin_club_tournaments(id) on delete cascade,
  jersey_number text not null default '',
  sort_order integer not null default 0,
  approval_status text not null default 'pendiente'
    check (approval_status in ('pendiente', 'aprobado', 'rechazado')),
  created_at timestamptz not null default now(),
  unique (roster_player_id, club_tournament_id)
);

create index if not exists fefutin_roster_tournament_entries_tournament_idx
  on public.fefutin_roster_tournament_entries(club_tournament_id, sort_order);

-- Archivo inmutable de cada fila original. No tiene FK hacia el torneo,
-- por lo que sobrevive cuando se eliminen las competencias de prueba.
create table if not exists public.fefutin_roster_migration_sources (
  source_team_player_id uuid primary key,
  source_team_id uuid,
  source_club_tournament_id uuid,
  source_tournament_id uuid,
  club_id uuid not null,
  category_label text not null,
  roster_player_id uuid not null
    references public.fefutin_club_roster_players(id) on delete restrict,
  source_snapshot jsonb not null,
  archived_at timestamptz not null default now()
);

create index if not exists fefutin_roster_migration_sources_roster_idx
  on public.fefutin_roster_migration_sources(roster_player_id);

-- Seed de una ficha permanente por club y categoría ya habilitada.
insert into public.fefutin_club_rosters (club_id, category_label)
select distinct ct.club_id, trim(ct.category_label)
from public.fefutin_club_tournaments ct
where nullif(trim(ct.category_label), '') is not null
on conflict (club_id, category_label) do nothing;

-- Crear un único jugador permanente por club/categoría/DNI.
-- Si hay duplicados históricos, se elige como registro principal el más completo
-- y aprobado; cada fila original se conserva íntegra en el archivo inferior.
with source_rows as (
  select
    pl.*,
    ft.club_tournament_id,
    ct.club_id,
    trim(ct.category_label) as category_label,
    case
      when nullif(regexp_replace(coalesce(pl.dni, ''), '[^0-9]', '', 'g'), '') is not null
        then regexp_replace(pl.dni, '[^0-9]', '', 'g')
      else 'legacy:' || pl.id::text
    end as identity_key,
    row_number() over (
      partition by ct.club_id, trim(ct.category_label),
        case
          when nullif(regexp_replace(coalesce(pl.dni, ''), '[^0-9]', '', 'g'), '') is not null
            then regexp_replace(pl.dni, '[^0-9]', '', 'g')
          else 'legacy:' || pl.id::text
        end
      order by
        case pl.approval_status when 'aprobado' then 0 when 'pendiente' then 1 else 2 end,
        (pl.registry_player_id is not null) desc,
        (nullif(trim(pl.photo_path), '') is not null) desc,
        (pl.birth_date is not null) desc,
        pl.created_at asc,
        pl.id
    ) as pick_order
  from public.fefutin_team_players pl
  join public.fefutin_teams ft on ft.id = pl.team_id
  join public.fefutin_club_tournaments ct on ct.id = ft.club_tournament_id
)
insert into public.fefutin_club_roster_players (
  roster_id, identity_key, first_name, last_name, dni, birth_date,
  photo_path, approval_status, registry_player_id
)
select
  cr.id,
  s.identity_key,
  s.first_name,
  s.last_name,
  s.dni,
  s.birth_date,
  s.photo_path,
  s.approval_status,
  s.registry_player_id
from source_rows s
join public.fefutin_club_rosters cr
  on cr.club_id = s.club_id and cr.category_label = s.category_label
where s.pick_order = 1
on conflict (roster_id, identity_key) do nothing;

-- Archivar todas las filas originales y vincularlas con el jugador permanente.
with source_rows as (
  select
    pl.*,
    ft.id as source_team_id,
    ft.club_tournament_id as source_club_tournament_id,
    ct.tournament_id as source_tournament_id,
    ct.club_id,
    trim(ct.category_label) as category_label,
    case
      when nullif(regexp_replace(coalesce(pl.dni, ''), '[^0-9]', '', 'g'), '') is not null
        then regexp_replace(pl.dni, '[^0-9]', '', 'g')
      else 'legacy:' || pl.id::text
    end as identity_key
  from public.fefutin_team_players pl
  join public.fefutin_teams ft on ft.id = pl.team_id
  join public.fefutin_club_tournaments ct on ct.id = ft.club_tournament_id
)
insert into public.fefutin_roster_migration_sources (
  source_team_player_id, source_team_id, source_club_tournament_id,
  source_tournament_id, club_id, category_label, roster_player_id, source_snapshot
)
select
  s.id, s.source_team_id, s.source_club_tournament_id,
  s.source_tournament_id, s.club_id, s.category_label, rp.id, to_jsonb(s)
from source_rows s
join public.fefutin_club_rosters cr
  on cr.club_id = s.club_id and cr.category_label = s.category_label
join public.fefutin_club_roster_players rp
  on rp.roster_id = cr.id and rp.identity_key = s.identity_key
on conflict (source_team_player_id) do nothing;

-- Migrar la camiseta, el orden y el estado de cada participación.
-- Si el mismo DNI aparece más de una vez en la misma categoría/torneo,
-- conservar una única relación operativa; las filas fuente quedan archivadas.
insert into public.fefutin_roster_tournament_entries (
  roster_player_id, club_tournament_id, jersey_number, sort_order, approval_status
)
select distinct on (src.roster_player_id, src.source_club_tournament_id)
  src.roster_player_id,
  src.source_club_tournament_id,
  coalesce(src.source_snapshot ->> 'jersey_number', ''),
  coalesce((src.source_snapshot ->> 'sort_order')::integer, 0),
  coalesce(src.source_snapshot ->> 'approval_status', 'pendiente')
from public.fefutin_roster_migration_sources src
where src.source_club_tournament_id is not null
order by
  src.roster_player_id,
  src.source_club_tournament_id,
  case src.source_snapshot ->> 'approval_status'
    when 'aprobado' then 0 when 'pendiente' then 1 else 2
  end,
  src.source_team_player_id
on conflict (roster_player_id, club_tournament_id) do nothing;

-- Conservar el historial de sanciones/aprobaciones sin depender de la fila
-- que se eliminará en cascada al borrar un torneo.
alter table public.fefutin_player_status_history
  add column if not exists roster_player_id uuid
    references public.fefutin_club_roster_players(id) on delete restrict;

alter table public.fefutin_player_status_history
  alter column player_entry_id drop not null;

update public.fefutin_player_status_history h
set roster_player_id = src.roster_player_id
from public.fefutin_roster_migration_sources src
where src.source_team_player_id = h.player_entry_id
  and h.roster_player_id is null;

create index if not exists fefutin_player_status_history_roster_idx
  on public.fefutin_player_status_history(roster_player_id, created_at desc);

-- Las tablas nuevas quedan cerradas al acceso directo; las lecturas/escrituras
-- se expondrán mediante funciones SECURITY DEFINER con validación de rol/club.
alter table public.fefutin_club_rosters enable row level security;
alter table public.fefutin_club_roster_players enable row level security;
alter table public.fefutin_roster_tournament_entries enable row level security;
alter table public.fefutin_roster_migration_sources enable row level security;

revoke all on public.fefutin_club_rosters from public, anon, authenticated;
revoke all on public.fefutin_club_roster_players from public, anon, authenticated;
revoke all on public.fefutin_roster_tournament_entries from public, anon, authenticated;
revoke all on public.fefutin_roster_migration_sources from public, anon, authenticated;

commit;
