-- FEFUTIN: cierre de planilla y resultado sobre el partido UUID normalizado.
begin;

create or replace function public.referee_close_normalized_match_from_sheet(
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
  v_local_sheet public.fefutin_match_sheets%rowtype;
  v_visitor_sheet public.fefutin_match_sheets%rowtype;
  v_local_count integer := 0;
  v_visitor_count integer := 0;
  v_local_score integer := 0;
  v_visitor_score integer := 0;
  v_local_name text;
  v_visitor_name text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.role not in ('arbitro', 'admin', 'directivo') then
    raise exception 'Se requiere un arbitro aprobado, un directivo o un administrador';
  end if;

  select m.* into v_match
  from public.fefutin_matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception 'No se encontro el partido';
  end if;

  if v_match.status = 'finalizado' or v_match.referee_closed_at is not null then
    raise exception 'El partido ya esta cerrado y no admite modificaciones';
  end if;

  if v_profile.role = 'arbitro' and v_match.referee_id is distinct from auth.uid() then
    raise exception 'Este partido no esta designado a tu usuario';
  end if;

  select c.name into v_local_name
  from public.fefutin_clubs c
  where c.id = v_match.local_club_id;

  select c.name into v_visitor_name
  from public.fefutin_clubs c
  where c.id = v_match.visitor_club_id;

  select s.* into v_local_sheet
  from public.fefutin_match_sheets s
  where s.normalized_match_id = p_match_id
    and s.lado = 'local'
  for update;

  if not found then
    raise exception 'Primero tenes que guardar la planilla del equipo local';
  end if;

  select s.* into v_visitor_sheet
  from public.fefutin_match_sheets s
  where s.normalized_match_id = p_match_id
    and s.lado = 'visitante'
  for update;

  if not found then
    raise exception 'Primero tenes que guardar la planilla del equipo visitante';
  end if;

  if lower(trim(coalesce(v_local_sheet.estado, ''))) in ('cerrada', 'cerrado')
     or lower(trim(coalesce(v_visitor_sheet.estado, ''))) in ('cerrada', 'cerrado') then
    raise exception 'Una de las planillas ya esta cerrada';
  end if;

  if lower(trim(coalesce(v_local_sheet.club_local, ''))) <> lower(trim(coalesce(v_local_name, '')))
     or lower(trim(coalesce(v_visitor_sheet.club_visitante, ''))) <> lower(trim(coalesce(v_visitor_name, ''))) then
    raise exception 'Los clubes de las planillas no coinciden con el partido normalizado';
  end if;

  select count(*)::integer, coalesce(sum(p.goles), 0)::integer
    into v_local_count, v_local_score
  from public.fefutin_match_sheet_players p
  where p.match_sheet_id = v_local_sheet.id
    and lower(trim(coalesce(p.club, ''))) = lower(trim(coalesce(v_local_name, '')));

  select count(*)::integer, coalesce(sum(p.goles), 0)::integer
    into v_visitor_count, v_visitor_score
  from public.fefutin_match_sheet_players p
  where p.match_sheet_id = v_visitor_sheet.id
    and lower(trim(coalesce(p.club, ''))) = lower(trim(coalesce(v_visitor_name, '')));

  if v_local_count = 0 or v_visitor_count = 0 then
    raise exception 'Las dos planillas deben incluir jugadores habilitados de cada club';
  end if;

  update public.fefutin_matches
  set local_score = v_local_score,
      visitor_score = v_visitor_score,
      status = 'finalizado',
      referee_closed_at = now(),
      referee_closed_by = auth.uid(),
      updated_at = now()
  where id = p_match_id
  returning * into v_match;

  update public.fefutin_match_sheets
  set estado = 'cerrada',
      updated_by = auth.uid(),
      updated_at = now()
  where id in (v_local_sheet.id, v_visitor_sheet.id);

  return jsonb_build_object(
    'id', v_match.id,
    'round_id', v_match.round_id,
    'local_club_id', v_match.local_club_id,
    'visitor_club_id', v_match.visitor_club_id,
    'team1', v_local_name,
    'team2', v_visitor_name,
    'score1', v_local_score,
    'score2', v_visitor_score,
    'status', v_match.status,
    'referee_id', v_match.referee_id,
    'referee_closed', true,
    'referee_closed_at', v_match.referee_closed_at,
    'referee_closed_by', v_match.referee_closed_by,
    'scheduled_date', v_match.scheduled_date,
    'scheduled_time', v_match.scheduled_time
  );
end;
$function$;

revoke all on function public.referee_close_normalized_match_from_sheet(uuid) from public, anon;
grant execute on function public.referee_close_normalized_match_from_sheet(uuid) to authenticated;

commit;
