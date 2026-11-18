-- FEFUTIN: exponer turno y jornada en el archivo público sin alterar el histórico.
begin;

alter table public.fefutin_jornada_sheets
  add column if not exists turno text,
  add column if not exists journey_number integer;

alter table public.fefutin_jornada_photos
  add column if not exists turno text,
  add column if not exists journey_number integer;

create index if not exists fefutin_jornada_sheets_turn_journey_idx
  on public.fefutin_jornada_sheets(turn_id, turn_journey_id, jornada_date desc);

create or replace view public.fefutin_public_jornada_sheets as
select
  id,
  jornada_key,
  tournament_id,
  tournament_ids,
  turn_id,
  turn_journey_id,
  turno,
  journey_number,
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
  closed_at
from public.fefutin_jornada_sheets
where closed_at is not null;

grant select on public.fefutin_public_jornada_sheets to anon, authenticated;

commit;
