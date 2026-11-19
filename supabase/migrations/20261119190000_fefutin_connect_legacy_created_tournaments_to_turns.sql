-- FEFUTIN: conectar los torneos creados por el formulario anterior
-- con el flujo normalizado de turnos, categorias, fixture y planillas.
-- Migracion aditiva e idempotente: no borra ni modifica inscripciones historicas.
begin;

-- Los torneos creados por el formulario FEFUTIN guardan su rama y turno
-- en fefutin_torneos. Replicamos esos identificadores en la cabecera usada
-- por el modelo deportivo normalizado.
update public.tournaments t
set
  fefutin_branch_id = ft.rama_id,
  fefutin_turno = ft.turno
from public.fefutin_torneos ft
where ft.id = t.id
  and ft.rama_id is not null
  and ft.turno in ('Semanal', 'Fin de semana')
  and (
    t.fefutin_branch_id is distinct from ft.rama_id
    or t.fefutin_turno is distinct from ft.turno
  );

-- Crear el turno correspondiente al torneo. Estos registros fueron creados
-- como un torneo por rama y turno, por eso no generamos el turno hermano.
insert into public.fefutin_tournament_turns (tournament_id, turno, status)
select
  t.id,
  t.fefutin_turno,
  case
    when lower(trim(coalesce(t.status, ''))) in ('finalizado', 'finalizada', 'completed') then 'finalizada'
    when lower(trim(coalesce(t.status, ''))) in ('en curso', 'en_curso', 'iniciado') then 'en_curso'
    else 'inscripcion'
  end
from public.tournaments t
where t.fefutin_branch_id is not null
  and t.fefutin_turno in ('Semanal', 'Fin de semana')
on conflict (tournament_id, turno) do nothing;

-- Recuperar las categorias desde el grupo tecnico que conserva el formulario.
with configured_categories as (
  select
    t.id as tournament_id,
    t.fefutin_branch_id,
    t.fefutin_turno,
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
    and nullif(trim(category.value), '') is not null
    and (
      case trim(branch.value->>'division')
        when 'Infantil' then 'Baby fútbol'
        when 'Mayores' then 'Sénior'
        else trim(branch.value->>'division')
      end
    ) is not null
)
insert into public.fefutin_tournament_categories (
  tournament_id, turn_id, category_id, format, status
)
select
  cc.tournament_id,
  tt.id,
  c.id,
  case
    when cc.format in ('groups_playoff', 'playoff') then cc.format
    else 'league'
  end,
  cc.category_status
from configured_categories cc
join public.fefutin_branches b
  on b.id = cc.fefutin_branch_id
 and b.name = case
   when cc.fefutin_branch_id is null then ''
   else b.name
 end
join public.fefutin_categories c
  on c.branch_id = b.id
 and c.name = cc.category_name
join public.fefutin_tournament_turns tt
  on tt.tournament_id = cc.tournament_id
 and tt.turno = cc.fefutin_turno
on conflict (tournament_id, category_id) do update
set turn_id = excluded.turn_id;

commit;
