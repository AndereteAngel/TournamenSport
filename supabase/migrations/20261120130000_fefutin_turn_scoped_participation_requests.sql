-- FEFUTIN: una solicitud identifica un turno y habilita solo sus categorias.
-- La solicitud y la aprobacion se resuelven por (club, torneo de rama, turno).
begin;

create or replace function public.submit_fefutin_club_tournament_request(
  p_tournament_id uuid,
  p_turn_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_club public.fefutin_clubs%rowtype;
  v_turn public.fefutin_tournament_turns%rowtype;
  v_request_id uuid;
  v_category_count integer;
begin
  if v_user_id is null then
    raise exception 'Tenes que iniciar sesion para solicitar una participacion';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'Solo un referente habilitado con un club asociado puede solicitar participacion';
  end if;

  select c.* into v_club
  from public.fefutin_clubs c
  where c.id = v_profile.club_id
    and c.referente_user_id = v_user_id
    and c.is_active = true
  for update;

  if not found then
    raise exception 'El club asociado todavia no esta habilitado';
  end if;

  select tt.* into v_turn
  from public.fefutin_tournament_turns tt
  where tt.id = p_turn_id
    and tt.tournament_id = p_tournament_id
  for update;

  if not found then
    raise exception 'El turno seleccionado no pertenece a esa rama';
  end if;

  if v_turn.status <> 'inscripcion' then
    raise exception 'Las inscripciones de este turno estan cerradas';
  end if;

  select count(*)::integer into v_category_count
  from public.fefutin_tournament_categories tc
  where tc.turn_id = v_turn.id
    and tc.status = 'inscripcion';

  if v_category_count = 0 then
    raise exception 'Este turno no tiene categorias disponibles para inscripcion';
  end if;

  if exists (
    select 1
    from public.fefutin_tournament_category_clubs tcc
    join public.fefutin_tournament_categories tc on tc.id = tcc.tournament_category_id
    where tc.turn_id = v_turn.id
      and tcc.club_id = v_club.id
      and tcc.status in ('pendiente', 'aprobado')
  ) then
    raise exception 'Tu club ya tiene una solicitud pendiente o una participacion aprobada en este turno';
  end if;

  insert into public.fefutin_club_tournament_requests (
    club_id, tournament_id, turn_id, category_label, requested_by, status
  )
  values (
    v_club.id, p_tournament_id, v_turn.id, 'TODA LA TIRA', v_user_id, 'pendiente'
  )
  returning id into v_request_id;

  insert into public.fefutin_tournament_category_clubs (
    tournament_category_id, club_id, status, requested_by, requested_at, reviewed_by, reviewed_at
  )
  select
    tc.id, v_club.id, 'pendiente', v_user_id, now(), null, null
  from public.fefutin_tournament_categories tc
  where tc.turn_id = v_turn.id
    and tc.status = 'inscripcion'
  on conflict (tournament_category_id, club_id) do update
    set status = 'pendiente',
        requested_by = excluded.requested_by,
        requested_at = now(),
        reviewed_by = null,
        reviewed_at = null
    where public.fefutin_tournament_category_clubs.status in ('desestimado', 'retirado');

  return v_request_id;
exception
  when unique_violation then
    raise exception 'Ya existe una solicitud pendiente para este turno';
end;
$function$;

-- La firma anterior no podia distinguir turnos: se conserva solo para informar el cambio.
create or replace function public.submit_fefutin_club_tournament_request(
  p_tournament_id uuid,
  p_category_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'La solicitud ahora debe identificar un turno. Actualiza la aplicacion para enviar p_turn_id.';
end;
$function$;

create or replace function public.get_fefutin_my_tournament_requests()
returns table (
  id uuid,
  tournament_id uuid,
  tournament_title text,
  turn_id uuid,
  turno text,
  category_label text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'No tenes permisos para consultar estas solicitudes';
  end if;

  return query
  select
    r.id,
    r.tournament_id,
    t.title,
    r.turn_id,
    tt.turno,
    coalesce(string_agg(b.name || ' · ' || c.name, ', ' order by b.sort_order, c.sort_order), 'Sin categorias'),
    r.status,
    r.created_at
  from public.fefutin_club_tournament_requests r
  join public.fefutin_tournament_turns tt on tt.id = r.turn_id
  join public.tournaments t on t.id = r.tournament_id
  left join public.fefutin_tournament_categories tc
    on tc.turn_id = tt.id and tc.status = 'inscripcion'
  left join public.fefutin_categories c on c.id = tc.category_id
  left join public.fefutin_branches b on b.id = c.branch_id
  where r.club_id = v_profile.club_id
    and r.requested_by = auth.uid()
  group by r.id, r.tournament_id, t.title, r.turn_id, tt.turno, r.status, r.created_at
  order by r.created_at desc;
end;
$function$;

create or replace function public.get_fefutin_pending_club_tournament_requests()
returns table (
  id uuid,
  club_name text,
  referente_name text,
  referente_email text,
  tournament_title text,
  turn_id uuid,
  turno text,
  category_label text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_role text;
begin
  select p.role into v_actor_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenes permisos para consultar solicitudes de participacion';
  end if;

  return query
  select
    r.id,
    c.name,
    p.username,
    p.email,
    t.title,
    r.turn_id,
    tt.turno,
    coalesce(string_agg(b.name || ' · ' || cat.name, ', ' order by b.sort_order, cat.sort_order), 'Sin categorias'),
    r.created_at
  from public.fefutin_club_tournament_requests r
  join public.fefutin_tournament_turns tt on tt.id = r.turn_id
  join public.tournaments t on t.id = r.tournament_id
  join public.fefutin_clubs c on c.id = r.club_id
  join public.profiles p on p.id = c.referente_user_id
  left join public.fefutin_tournament_categories tc
    on tc.turn_id = tt.id and tc.status = 'inscripcion'
  left join public.fefutin_categories cat on cat.id = tc.category_id
  left join public.fefutin_branches b on b.id = cat.branch_id
  where r.status = 'pendiente'
    and c.is_active = true
    and p.role = 'referente'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null
  group by r.id, c.name, p.username, p.email, t.title, r.turn_id, tt.turno, r.created_at
  order by r.created_at asc;
end;
$function$;

create or replace function public.decide_fefutin_club_tournament_request(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_request public.fefutin_club_tournament_requests%rowtype;
  v_updated_count integer;
  v_expected_count integer;
begin
  select p.role into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'Solo Admin o Directivo puede resolver solicitudes de participacion';
  end if;

  select r.* into v_request
  from public.fefutin_club_tournament_requests r
  where r.id = p_request_id
  for update;

  if not found or v_request.status <> 'pendiente' or v_request.turn_id is null then
    raise exception 'La solicitud ya fue resuelta, no existe o no tiene turno';
  end if;

  if not exists (
    select 1 from public.fefutin_clubs c
    where c.id = v_request.club_id and c.is_active = true
  ) then
    raise exception 'El club ya no esta habilitado';
  end if;

  select count(*)::integer into v_expected_count
  from public.fefutin_tournament_categories tc
  where tc.turn_id = v_request.turn_id
    and tc.status = 'inscripcion';

  if p_approve then
    update public.fefutin_tournament_category_clubs tcc
    set status = 'aprobado',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    from public.fefutin_tournament_categories tc
    where tc.id = tcc.tournament_category_id
      and tc.turn_id = v_request.turn_id
      and tcc.club_id = v_request.club_id
      and tcc.status = 'pendiente';

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> v_expected_count then
      raise exception 'La solicitud no contiene todas las categorias del turno. No se aprobo para evitar una inscripcion incompleta.';
    end if;

    insert into public.fefutin_club_tournaments (
      club_id, tournament_id, turn_id, category_label
    )
    select
      v_request.club_id,
      v_request.tournament_id,
      v_request.turn_id,
      b.name || ' · ' || cat.name
    from public.fefutin_tournament_categories tc
    join public.fefutin_categories cat on cat.id = tc.category_id
    join public.fefutin_branches b on b.id = cat.branch_id
    where tc.turn_id = v_request.turn_id
      and tc.status = 'inscripcion'
    on conflict (club_id, tournament_id, turn_id, category_label)
      where turn_id is not null
      do nothing;

    update public.fefutin_club_tournament_requests
    set status = 'aprobado', reviewed_by = v_actor_id, reviewed_at = now()
    where id = p_request_id;
  else
    update public.fefutin_tournament_category_clubs tcc
    set status = 'desestimado',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    from public.fefutin_tournament_categories tc
    where tc.id = tcc.tournament_category_id
      and tc.turn_id = v_request.turn_id
      and tcc.club_id = v_request.club_id
      and tcc.status = 'pendiente';

    update public.fefutin_club_tournament_requests
    set status = 'desestimado', reviewed_by = v_actor_id, reviewed_at = now()
    where id = p_request_id;
  end if;
end;
$function$;

revoke all on function public.submit_fefutin_club_tournament_request(uuid, uuid) from public, anon;
revoke all on function public.submit_fefutin_club_tournament_request(uuid, text) from public, anon;
revoke all on function public.get_fefutin_my_tournament_requests() from public, anon;
revoke all on function public.get_fefutin_pending_club_tournament_requests() from public, anon;
revoke all on function public.decide_fefutin_club_tournament_request(uuid, boolean) from public, anon;

grant execute on function public.submit_fefutin_club_tournament_request(uuid, uuid) to authenticated;
grant execute on function public.submit_fefutin_club_tournament_request(uuid, text) to authenticated;
grant execute on function public.get_fefutin_my_tournament_requests() to authenticated;
grant execute on function public.get_fefutin_pending_club_tournament_requests() to authenticated;
grant execute on function public.decide_fefutin_club_tournament_request(uuid, boolean) to authenticated;

commit;
