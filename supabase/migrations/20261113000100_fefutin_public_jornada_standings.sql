-- Vista pública de solo lectura para las tablas generales FEFUTIN.
-- Expone resultados de jornadas archivadas, sin datos de identidad del árbitro.
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
        jsonb_agg(detail - 'referee_id' - 'referee_closed'),
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
