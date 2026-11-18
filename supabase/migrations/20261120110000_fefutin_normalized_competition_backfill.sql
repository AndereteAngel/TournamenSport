-- FEFUTIN: migración inicial de los torneos y participaciones al modelo normalizado.
-- No elimina ni modifica registros legacy; solo completa las tablas nuevas.
begin;

-- 1) Completar rama y turno en la cabecera existente.
update public.tournaments t
set
  fefutin_branch_id = b.id,
  fefutin_turno = case
    when t.game ilike '%Fin de semana%' then 'Fin de semana'
    when t.game ilike '%Semanal%' then 'Semanal'
    else null
  end
from public.fefutin_branches b
where t.fefutin_branch_id is null
  and (
    (b.name = 'Baby fútbol' and (t.game ilike '%Baby fútbol%' or t.game ilike '%Infantil%'))
    or (b.name = 'Femenino' and t.game ilike '%Femenino%')
    or (b.name = 'Sénior' and (t.game ilike '%Sénior%' or t.game ilike '%Mayores%'))
    or (b.name = 'Futsal' and t.game ilike '%Futsal%')
  );

-- 2) Crear las categorías del torneo leyendo la configuración que hoy guarda
-- CreateTournament en el grupo técnico __INSCRIPCIONES__.
with configured_categories as (
  select
    t.id as tournament_id,
    case trim(branch.value->>'division')
      when 'Infantil' then 'Baby fútbol'
      when 'Mayores' then 'Sénior'
      else trim(branch.value->>'division')
    end as branch_name,
    trim(category.value) as category_name,
    t.format,
    case
      when lower(trim(coalesce(t.status, ''))) in ('finalizado', 'finalizada', 'completed') then 'finalizada'
      when lower(trim(coalesce(t.status, ''))) in ('en curso', 'en_curso', 'iniciado') then 'en_curso'
      else 'inscripcion'
    end as category_status
  from public.tournaments t
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(t.groups) = 'array' then t.groups else '[]'::jsonb end
  ) registration_group(value)
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(registration_group.value->'category_config') = 'array'
        then registration_group.value->'category_config'
      else '[]'::jsonb
    end
  ) branch(value)
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(branch.value->'categories') = 'array'
        then branch.value->'categories'
      else '[]'::jsonb
    end
  ) category(value)
  where registration_group.value->>'name' = '__INSCRIPCIONES__'
    and nullif(trim(branch.value->>'division'), '') is not null
    and nullif(trim(category.value), '') is not null
)
insert into public.fefutin_tournament_categories (
  tournament_id, category_id, format, status
)
select
  cc.tournament_id,
  c.id,
  case
    when cc.format in ('groups_playoff', 'playoff') then cc.format
    else 'league'
  end,
  cc.category_status
from configured_categories cc
join public.fefutin_branches b on b.name = cc.branch_name
join public.fefutin_categories c
  on c.branch_id = b.id and c.name = cc.category_name
on conflict (tournament_id, category_id) do nothing;

-- Respaldo para torneos que ya fueron iniciados y por eso no conservan
-- el grupo técnico __INSCRIPCIONES__: reconstruir sus categorías desde las
-- participaciones club/categoría que ya existen.
with legacy_categories as (
  select distinct
    legacy.tournament_id,
    case trim(split_part(legacy.category_label, ' · ', 1))
      when 'Infantil' then 'Baby fútbol'
      when 'Mayores' then 'Sénior'
      else trim(split_part(legacy.category_label, ' · ', 1))
    end as branch_name,
    trim(substr(legacy.category_label, length(split_part(legacy.category_label, ' · ', 1)) + 4)) as category_name
  from public.fefutin_club_tournaments legacy
  where position(' · ' in legacy.category_label) > 0
)
insert into public.fefutin_tournament_categories (
  tournament_id, category_id, format, status
)
select
  lc.tournament_id,
  c.id,
  'league',
  case
    when lower(trim(coalesce(t.status, ''))) in ('finalizado', 'finalizada', 'completed') then 'finalizada'
    when lower(trim(coalesce(t.status, ''))) in ('en curso', 'en_curso', 'iniciado') then 'en_curso'
    else 'inscripcion'
  end
from legacy_categories lc
join public.tournaments t on t.id = lc.tournament_id
join public.fefutin_branches b on b.name = lc.branch_name
join public.fefutin_categories c
  on c.branch_id = b.id and lower(c.name) = lower(lc.category_name)
on conflict (tournament_id, category_id) do nothing;

-- 3) Pasar las participaciones ya aprobadas a cada categoría normalizada.
-- La relación antigua permanece intacta para permitir una transición gradual.
insert into public.fefutin_tournament_category_clubs (
  tournament_category_id, club_id, status, requested_at, reviewed_at
)
select
  tc.id,
  legacy.club_id,
  'aprobado',
  legacy.created_at,
  legacy.created_at
from public.fefutin_club_tournaments legacy
join public.fefutin_tournament_categories tc
  on tc.tournament_id = legacy.tournament_id
join public.fefutin_categories c on c.id = tc.category_id
join public.fefutin_branches b on b.id = c.branch_id
where lower(trim(legacy.category_label)) =
      lower(b.name || ' · ' || c.name)
on conflict (tournament_category_id, club_id) do nothing;

-- 4) Relacionar las inscripciones de jugadores ya existentes con la nueva
-- inscripción club/categoría. Los datos permanentes siguen en sus tablas actuales.
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
from public.fefutin_roster_tournament_entries entry
join public.fefutin_club_tournaments legacy
  on legacy.id = entry.club_tournament_id
join public.fefutin_tournament_categories tc
  on tc.tournament_id = legacy.tournament_id
join public.fefutin_categories c on c.id = tc.category_id
join public.fefutin_branches b on b.id = c.branch_id
join public.fefutin_tournament_category_clubs tcc
  on tcc.tournament_category_id = tc.id
 and tcc.club_id = legacy.club_id
where lower(trim(legacy.category_label)) =
      lower(b.name || ' · ' || c.name)
on conflict (tournament_category_club_id, roster_player_id) do nothing;

commit;
