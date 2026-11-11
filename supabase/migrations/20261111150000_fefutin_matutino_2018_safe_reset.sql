-- FEFUTIN: reinicio controlado del torneo Matutino Infantil 2018.
-- Conserva las planillas cerradas y las fotos como archivo histórico.
-- El procedimiento de reinicio queda reservado al SQL Editor (sin permisos API).

begin;

create table if not exists public.fefutin_voided_match_sheets (
  sheet_id uuid primary key references public.fefutin_match_sheets(id) on delete restrict,
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  match_id text not null,
  photo_ids uuid[] not null default '{}'::uuid[],
  reason text not null,
  annulled_at timestamptz not null default now()
);

create index if not exists fefutin_voided_match_sheets_tournament_idx
  on public.fefutin_voided_match_sheets (tournament_id);

alter table public.fefutin_voided_match_sheets enable row level security;

drop policy if exists fefutin_voided_match_sheets_admin_select
  on public.fefutin_voided_match_sheets;

create policy fefutin_voided_match_sheets_admin_select
  on public.fefutin_voided_match_sheets
  for select to authenticated
  using (public.has_fefutin_role(array['admin', 'directivo']));

grant select on public.fefutin_voided_match_sheets to authenticated;

-- Los goles de planillas históricas anuladas no forman parte de la tabla vigente.
create or replace function public.get_fefutin_tournament_top_scorers(
  p_tournament_id uuid
)
returns table (
  player_id uuid,
  jugador text,
  club text,
  goles bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.player_id,
    max(trim(concat_ws(' ', nullif(trim(p.nombre), ''), nullif(trim(p.apellido), ''))))::text as jugador,
    max(trim(p.club))::text as club,
    sum(greatest(coalesce(p.goles, 0), 0))::bigint as goles
  from public.fefutin_match_sheet_players p
  join public.fefutin_match_sheets s on s.id = p.match_sheet_id
  where s.tournament_id = p_tournament_id
    and lower(trim(coalesce(s.estado, ''))) in ('cerrada', 'cerrado')
    and p.player_id is not null
    and not exists (
      select 1
      from public.fefutin_voided_match_sheets v
      where v.sheet_id = s.id
    )
  group by p.player_id, lower(trim(coalesce(p.club, '')))
  having sum(greatest(coalesce(p.goles, 0), 0)) > 0
  order by goles desc, jugador asc, club asc;
$function$;

revoke all on function public.get_fefutin_tournament_top_scorers(uuid) from public;
grant execute on function public.get_fefutin_tournament_top_scorers(uuid) to anon, authenticated;

-- Operación única y específica para Matutino - Fútbol Infantil 2018.
-- No elimina ni modifica planillas, jugadores de planilla o fotos.
create or replace function public.reset_matutino_2018_fefutin()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tournament public.tournaments%rowtype;
  v_sheet public.fefutin_match_sheets%rowtype;
  v_closed_matches integer := 0;
  v_closed_sheets integer := 0;
  v_racing_registered boolean := false;
  v_photo_ids uuid[] := '{}'::uuid[];
  v_generation_id text;
begin
  select t.* into v_tournament
  from public.tournaments t
  where t.id = 'a67bd737-aac5-4d0f-8a7a-6a1015ffdffb'::uuid
  for update;

  if not found then
    raise exception 'No se encontró el torneo Matutino Infantil 2018 esperado.';
  end if;

  if lower(trim(coalesce(v_tournament.title, ''))) <> 'matutino'
     or lower(trim(coalesce(v_tournament.game, ''))) <> lower('Fútbol · Infantil · 2018')
     or v_tournament.format <> 'groups_playoff'
     or lower(trim(coalesce(v_tournament.status, ''))) <> 'en curso' then
    raise exception 'El torneo ya no coincide con el estado esperado. No se realizó ningún cambio.';
  end if;

  select exists (
    select 1
    from public.get_fefutin_tournament_clubs(v_tournament.id) c
    where lower(trim(coalesce(c.club_name, ''))) = 'racing'
  ) into v_racing_registered;

  if not v_racing_registered then
    raise exception 'Racing todavía no aparece en los clubes del torneo. No se realizó ningún cambio.';
  end if;

  select count(*)::integer into v_closed_matches
  from jsonb_array_elements(coalesce(v_tournament.groups, '[]'::jsonb)) g
  cross join lateral jsonb_array_elements(coalesce(g -> 'matches', '[]'::jsonb)) m
  where coalesce((m ->> 'referee_closed')::boolean, false) = true;

  if v_closed_matches <> 1 then
    raise exception 'Se esperaba exactamente un partido cerrado en el fixture. Se encontraron %. No se realizó ningún cambio.', v_closed_matches;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_tournament.groups, '[]'::jsonb)) g
    cross join lateral jsonb_array_elements(coalesce(g -> 'matches', '[]'::jsonb)) m
    where m ->> 'id' = 'San Telmo Celeste-River Plate'
      and m ->> 'team1' = 'San Telmo Celeste'
      and m ->> 'team2' = 'River Plate'
      and coalesce((m ->> 'score1')::integer, -1) = 7
      and coalesce((m ->> 'score2')::integer, -1) = 4
      and coalesce((m ->> 'referee_closed')::boolean, false) = true
  ) then
    raise exception 'El resultado esperado San Telmo Celeste 7-4 River Plate no coincide. No se realizó ningún cambio.';
  end if;

  select count(*)::integer into v_closed_sheets
  from public.fefutin_match_sheets s
  where s.tournament_id = v_tournament.id
    and s.match_id = 'San Telmo Celeste-River Plate'
    and lower(trim(coalesce(s.estado, ''))) in ('cerrada', 'cerrado');

  if v_closed_sheets <> 1 then
    raise exception 'No se encontró exactamente una planilla cerrada para el partido esperado. No se realizó ningún cambio.';
  end if;

  select s.* into v_sheet
  from public.fefutin_match_sheets s
  where s.tournament_id = v_tournament.id
    and s.match_id = 'San Telmo Celeste-River Plate'
    and lower(trim(coalesce(s.estado, ''))) in ('cerrada', 'cerrado')
  for update;

  select coalesce(array_agg(p.id), '{}'::uuid[])
  into v_photo_ids
  from public.fefutin_jornada_photos p
  where p.tournament_id = v_tournament.id;

  if exists (
    select 1
    from public.fefutin_voided_match_sheets v
    where v.sheet_id = v_sheet.id
  ) then
    raise exception 'La planilla ya está marcada como anulada. No se realizó ningún cambio.';
  end if;

  insert into public.fefutin_voided_match_sheets (
    sheet_id, tournament_id, match_id, photo_ids, reason
  ) values (
    v_sheet.id,
    v_tournament.id,
    v_sheet.match_id,
    v_photo_ids,
    'Resultado anulado por reinicio de la competencia Matutino Infantil 2018. Planilla y foto conservadas como historial.'
  );

  v_generation_id := pg_catalog.gen_random_uuid()::text;

  update public.tournaments
  set groups = jsonb_build_array(
        jsonb_build_object(
          'id', 1,
          'name', '__INSCRIPCIONES__',
          'numGroups', 2,
          'fixtureGeneration', v_generation_id
        )
      ),
      playoffs = '[]'::jsonb,
      status = 'Inscripciones'
  where id = v_tournament.id;

  return jsonb_build_object(
    'success', true,
    'tournament_id', v_tournament.id,
    'status', 'Inscripciones',
    'racing_included', v_racing_registered,
    'archived_match', v_sheet.match_id,
    'archived_sheet_id', v_sheet.id,
    'preserved_photos', cardinality(v_photo_ids),
    'fixture_generation', v_generation_id
  );
end;
$function$;

-- Solo el propietario de la base (SQL Editor) puede ejecutar este reinicio puntual.
revoke all on function public.reset_matutino_2018_fefutin() from public, anon, authenticated;

commit;
