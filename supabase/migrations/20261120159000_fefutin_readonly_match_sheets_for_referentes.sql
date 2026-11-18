-- FEFUTIN: permitir que el referente consulte, en modo lectura, planillas de partidos de su club.
begin;

create or replace function public.fefutin_referente_can_read_normalized_match(
  p_match_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    join public.fefutin_matches m on m.id = p_match_id
    where p.id = auth.uid()
      and p.role = 'referente'
      and p.approval_status = 'aprobado'
      and p.deactivated_at is null
      and p.club_id in (m.local_club_id, m.visitor_club_id)
  );
$function$;

create or replace function public.fefutin_referente_can_read_normalized_sheet(
  p_sheet_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.fefutin_match_sheets s
    where s.id = p_sheet_id
      and public.fefutin_referente_can_read_normalized_match(s.normalized_match_id)
  );
$function$;

revoke all on function public.fefutin_referente_can_read_normalized_match(uuid) from public, anon;
revoke all on function public.fefutin_referente_can_read_normalized_sheet(uuid) from public, anon;
grant execute on function public.fefutin_referente_can_read_normalized_match(uuid) to authenticated;
grant execute on function public.fefutin_referente_can_read_normalized_sheet(uuid) to authenticated;

drop policy if exists fefutin_match_sheets_normalized_referente_select
  on public.fefutin_match_sheets;
create policy fefutin_match_sheets_normalized_referente_select
on public.fefutin_match_sheets
for select to authenticated
using (
  normalized_match_id is not null
  and public.fefutin_referente_can_read_normalized_match(normalized_match_id)
);

drop policy if exists fefutin_match_sheet_players_normalized_referente_select
  on public.fefutin_match_sheet_players;
create policy fefutin_match_sheet_players_normalized_referente_select
on public.fefutin_match_sheet_players
for select to authenticated
using (
  public.fefutin_referente_can_read_normalized_sheet(match_sheet_id)
);

create or replace function public.get_fefutin_match_sheet_roster(
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_match public.fefutin_matches%rowtype;
  v_tournament_id uuid;
  v_turn_id uuid;
  v_turno text;
  v_tournament_category_id uuid;
  v_category_id uuid;
  v_category_name text;
  v_journey_number integer;
  v_journey_date date;
  v_local public.fefutin_clubs%rowtype;
  v_visitor public.fefutin_clubs%rowtype;
  v_local_players jsonb;
  v_visitor_players jsonb;
  v_result jsonb;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.role not in ('arbitro', 'admin', 'directivo', 'referente') then
    raise exception 'No tenes permisos para consultar esta planilla';
  end if;

  select m.* into v_match
  from public.fefutin_matches m
  where m.id = p_match_id;

  if not found then
    raise exception 'No se encontro el partido normalizado';
  end if;

  if v_profile.role = 'arbitro' and v_match.referee_id is distinct from auth.uid() then
    raise exception 'Este partido no esta designado a tu usuario';
  end if;

  if v_profile.role = 'referente'
     and (v_profile.club_id is null or v_profile.club_id not in (v_match.local_club_id, v_match.visitor_club_id)) then
    raise exception 'Solo podes consultar planillas de partidos en los que participa tu club';
  end if;

  select
    tc.tournament_id,
    tc.turn_id,
    tt.turno,
    tc.id,
    cat.id,
    cat.name,
    r.round_number,
    coalesce(v_match.scheduled_date, r.scheduled_date, tj.scheduled_date)
  into
    v_tournament_id,
    v_turn_id,
    v_turno,
    v_tournament_category_id,
    v_category_id,
    v_category_name,
    v_journey_number,
    v_journey_date
  from public.fefutin_rounds r
  join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
  join public.fefutin_tournament_turns tt on tt.id = tc.turn_id
  join public.fefutin_categories cat on cat.id = tc.category_id
  left join public.fefutin_turn_journeys tj on tj.id = r.turn_journey_id
  where r.id = v_match.round_id;

  if not found then
    raise exception 'No se encontro la categoria y jornada del partido';
  end if;

  select c.* into v_local
  from public.fefutin_clubs c
  where c.id = v_match.local_club_id;

  select c.* into v_visitor
  from public.fefutin_clubs c
  where c.id = v_match.visitor_club_id;

  if not found or v_local.id is null or v_visitor.id is null then
    raise exception 'No se encontraron los clubes del partido';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_id', fp.id,
        'club', v_local.name,
        'nombre', coalesce(fp.first_name, rp.first_name),
        'apellido', coalesce(fp.last_name, rp.last_name),
        'carnet_number', fp.carnet_number,
        'dni', coalesce(fp.dni, rp.dni),
        'numero_camiseta', ccp.jersey_number,
        'goles', 0,
        'es_capitan', false,
        'tarjetas_amarillas', 0,
        'tarjetas_rojas', 0,
        'status', case when fp.status = 'rechazado' then 'rechazado' else ccp.status end,
        'carnet_status', coalesce(fp.verification_status, fp.carnet_status, 'pendiente'),
        'observaciones', ''
      ) order by ccp.sort_order, rp.last_name, rp.first_name
    ),
    '[]'::jsonb
  )
  into v_local_players
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_category_club_players ccp
    on ccp.tournament_category_club_id = tcc.id
   and ccp.status = 'aprobado'
  join public.fefutin_club_roster_players rp
    on rp.id = ccp.roster_player_id
   and rp.approval_status = 'aprobado'
   and rp.removed_at is null
  join public.fefutin_players fp
    on fp.id = rp.registry_player_id
  where tcc.tournament_category_id = v_category_id
    and tcc.club_id = v_local.id
    and tcc.status = 'aprobado';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_id', fp.id,
        'club', v_visitor.name,
        'nombre', coalesce(fp.first_name, rp.first_name),
        'apellido', coalesce(fp.last_name, rp.last_name),
        'carnet_number', fp.carnet_number,
        'dni', coalesce(fp.dni, rp.dni),
        'numero_camiseta', ccp.jersey_number,
        'goles', 0,
        'es_capitan', false,
        'tarjetas_amarillas', 0,
        'tarjetas_rojas', 0,
        'status', case when fp.status = 'rechazado' then 'rechazado' else ccp.status end,
        'carnet_status', coalesce(fp.verification_status, fp.carnet_status, 'pendiente'),
        'observaciones', ''
      ) order by ccp.sort_order, rp.last_name, rp.first_name
    ),
    '[]'::jsonb
  )
  into v_visitor_players
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_category_club_players ccp
    on ccp.tournament_category_club_id = tcc.id
   and ccp.status = 'aprobado'
  join public.fefutin_club_roster_players rp
    on rp.id = ccp.roster_player_id
   and rp.approval_status = 'aprobado'
   and rp.removed_at is null
  join public.fefutin_players fp
    on fp.id = rp.registry_player_id
  where tcc.tournament_category_id = v_category_id
    and tcc.club_id = v_visitor.id
    and tcc.status = 'aprobado';

  v_result := jsonb_build_object(
    'match_id', v_match.id,
    'tournament_id', v_tournament_id,
    'turn_id', v_turn_id,
    'turno', v_turno,
    'tournament_category_id', v_tournament_category_id,
    'category_id', v_category_id,
    'category_name', v_category_name,
    'round_id', v_match.round_id,
    'round_number', v_journey_number,
    'scheduled_date', v_journey_date,
    'scheduled_time', v_match.scheduled_time,
    'venue_address', v_match.venue_address,
    'referee_id', v_match.referee_id,
    'referee_closed', v_match.status = 'finalizado' or v_match.referee_closed_at is not null,
    'local', jsonb_build_object(
      'club_id', v_local.id,
      'name', v_local.name,
      'headquarters_address', v_local.headquarters_address,
      'players', v_local_players
    ),
    'visitor', jsonb_build_object(
      'club_id', v_visitor.id,
      'name', v_visitor.name,
      'headquarters_address', v_visitor.headquarters_address,
      'players', v_visitor_players
    )
  );

  return v_result;
end;
$function$;

revoke all on function public.get_fefutin_match_sheet_roster(uuid) from public, anon;
grant execute on function public.get_fefutin_match_sheet_roster(uuid) to authenticated;

commit;
