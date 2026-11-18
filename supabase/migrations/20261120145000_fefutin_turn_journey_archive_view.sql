-- FEFUTIN: exponer turno y jornada en el archivo público sin alterar el histórico.
begin;

alter table public.fefutin_jornada_sheets
  add column if not exists turno text,
  add column if not exists journey_number integer;

alter table public.fefutin_jornada_photos
  add column if not exists turno text,
  add column if not exists journey_number integer;

-- Asignar el turno a los archivos anteriores cuando su torneo legacy tiene un turno identificable.
-- Solo inferir el turno cuando hay una unica opcion o cuando el archivo ya
-- conserva el nombre del turno. Si la rama tiene ambos turnos y el archivo
-- antiguo no indica cual corresponde, dejarlo sin vincular para no inventar historial.
with resolved as (
  select archive.id as archive_id, selected.id as turn_id, selected.turno
  from public.fefutin_jornada_sheets archive
  join lateral (
    select tt.id, tt.turno
    from public.fefutin_tournament_turns tt
    where tt.tournament_id = archive.tournament_id
      and (
        (archive.turno is not null and tt.turno = archive.turno)
        or (
          archive.turno is null
          and (select count(*) from public.fefutin_tournament_turns all_turns
               where all_turns.tournament_id = archive.tournament_id) = 1
        )
      )
    limit 1
  ) selected on true
  where archive.turn_id is null
)
update public.fefutin_jornada_sheets archive
set turn_id = resolved.turn_id,
    turno = resolved.turno
from resolved
where resolved.archive_id = archive.id;

with resolved as (
  select archive.id as archive_id, selected.id as turn_id, selected.turno
  from public.fefutin_jornada_photos archive
  join lateral (
    select tt.id, tt.turno
    from public.fefutin_tournament_turns tt
    where tt.tournament_id = archive.tournament_id
      and (
        (archive.turno is not null and tt.turno = archive.turno)
        or (
          archive.turno is null
          and (select count(*) from public.fefutin_tournament_turns all_turns
               where all_turns.tournament_id = archive.tournament_id) = 1
        )
      )
    limit 1
  ) selected on true
  where archive.turn_id is null
)
update public.fefutin_jornada_photos archive
set turn_id = resolved.turn_id,
    turno = resolved.turno
from resolved
where resolved.archive_id = archive.id;

create index if not exists fefutin_jornada_sheets_turn_journey_idx
  on public.fefutin_jornada_sheets(turn_id, turn_journey_id, jornada_date desc);

create or replace view public.fefutin_public_jornada_sheets as
select
  id,
  jornada_key,
  tournament_id,
  tournament_ids,
  rama,
  team_local,
  team_visitante,
  jornada_date,
  categorias,
  case
    when jsonb_typeof(detalles) = 'array' then (
      select coalesce(
        jsonb_agg(detail - 'referee_id' - 'referee_closed' - 'referee_closed_by'),
        '[]'::jsonb
      )
      from jsonb_array_elements(detalles) as item(detail)
    )
    else '[]'::jsonb
  end as detalles,
  puntos_local,
  puntos_visitante,
  closed_at,
  turn_id,
  turn_journey_id,
  turno,
  journey_number
from public.fefutin_jornada_sheets
where closed_at is not null;

grant select on public.fefutin_public_jornada_sheets to anon, authenticated;

commit;
