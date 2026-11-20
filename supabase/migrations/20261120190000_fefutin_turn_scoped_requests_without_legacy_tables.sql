-- FEFUTIN: solicitudes por turno usando exclusivamente el esquema normalizado.
-- La identidad de una solicitud se guarda en fefutin_tournament_category_clubs.participation_request_id.
-- No crea tablas ni consulta estructuras legacy.

begin;

-- Asignar una identidad comun a las solicitudes pendientes antiguas que aun no tenian
-- participation_request_id. Se agrupan por club, turno, referente y fecha de solicitud.
with pending_groups as (
  select
    tcc.club_id,
    tc.turn_id,
    tcc.requested_by,
    tcc.requested_at,
    gen_random_uuid() as request_id
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc
    on tc.id = tcc.tournament_category_id
  where tcc.status = 'pendiente'
    and tcc.participation_request_id is null
  group by
    tcc.club_id,
    tc.turn_id,
    tcc.requested_by,
    tcc.requested_at
)
update public.fefutin_tournament_category_clubs tcc
set participation_request_id = pg.request_id
from public.fefutin_tournament_categories tc,
     pending_groups pg
where tc.id = tcc.tournament_category_id
  and tcc.club_id = pg.club_id
  and tc.turn_id = pg.turn_id
  and tcc.requested_by is not distinct from pg.requested_by
  and tcc.requested_at = pg.requested_at
  and tcc.status = 'pendiente'
  and tcc.participation_request_id is null;

-- La firma anterior recibia texto y no podia identificar el turno.
drop function if exists public.submit_fefutin_club_tournament_request(uuid, text);
drop function if exists public.get_fefutin_my_tournament_requests();
drop function if exists public.get_fefutin_pending_club_tournament_requests();

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
  v_request_id uuid := gen_random_uuid();
  v_category_count integer := 0;
  v_inserted_count integer := 0;
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
    raise exception 'El turno seleccionado no pertenece a ese torneo';
  end if;

  if v_turn.status <> 'inscripcion' then
    raise exception 'Las inscripciones de este turno estan cerradas';
  end if;

  select count(*)::integer
  into v_category_count
  from public.fefutin_tournament_categories tc
  where tc.turn_id = v_turn.id
    and tc.status = 'inscripcion';

  if v_category_count = 0 then
    raise exception 'Este turno no tiene categorias disponibles para inscripcion';
  end if;

  if exists (
    select 1
    from public.fefutin_tournament_category_clubs tcc
    join public.fefutin_tournament_categories tc
      on tc.id = tcc.tournament_category_id
    where tc.turn_id = v_turn.id
      and tcc.club_id = v_club.id
      and tcc.status in ('pendiente', 'aprobado')
  ) then
    raise exception 'Tu club ya tiene una solicitud pendiente o una participacion aprobada en este turno';
  end if;

  with inserted_rows as (
    insert into public.fefutin_tournament_category_clubs (
      tournament_category_id,
      club_id,
      status,
      requested_by,
      requested_at,
      reviewed_by,
      reviewed_at,
      participation_request_id
    )
    select
      tc.id,
      v_club.id,
      'pendiente',
      v_user_id,
      now(),
      null,
      null,
      v_request_id
    from public.fefutin_tournament_categories tc
    where tc.turn_id = v_turn.id
      and tc.status = 'inscripcion'
    on conflict (tournament_category_id, club_id) do update
      set status = 'pendiente',
          requested_by = excluded.requested_by,
          requested_at = excluded.requested_at,
          reviewed_by = null,
          reviewed_at = null,
          participation_request_id = excluded.participation_request_id
      where public.fefutin_tournament_category_clubs.status in ('desestimado', 'retirado')
    returning id
  )
  select count(*)::integer into v_inserted_count
  from inserted_rows;

  if v_inserted_count <> v_category_count then
    raise exception 'No se pudo registrar la solicitud en todas las categorias abiertas del turno';
  end if;

  return v_request_id;
end;
$function$;

create or replace function public.get_fefutin_my_tournament_requests()
returns table (
  id uuid,
  tournament_id uuid,
  turn_id uuid,
  turno text,
  tournament_title text,
  category_label text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz
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
    coalesce(tcc.participation_request_id, min(tcc.id)),
    tc.tournament_id,
    tc.turn_id,
    tt.turno,
    t.title,
    string_agg(
      b.name || ' · ' || cat.name,
      ', ' order by b.sort_order, cat.sort_order
    ),
    tcc.status,
    min(tcc.requested_at),
    max(tcc.reviewed_at)
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc
    on tc.id = tcc.tournament_category_id
  join public.fefutin_tournament_turns tt
    on tt.id = tc.turn_id
  join public.tournaments t
    on t.id = tc.tournament_id
  join public.fefutin_categories cat
    on cat.id = tc.category_id
  join public.fefutin_branches b
    on b.id = cat.branch_id
  where tcc.club_id = v_profile.club_id
    and tcc.requested_by = auth.uid()
  group by
    tcc.participation_request_id,
    tc.tournament_id,
    tc.turn_id,
    tt.turno,
    t.title,
    tcc.status
  order by min(tcc.requested_at) desc;
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
    coalesce(tcc.participation_request_id, min(tcc.id)),
    c.name,
    p.username,
    p.email,
    t.title,
    tc.turn_id,
    tt.turno,
    string_agg(
      b.name || ' · ' || cat.name,
      ', ' order by b.sort_order, cat.sort_order
    ),
    min(tcc.requested_at)
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc
    on tc.id = tcc.tournament_category_id
  join public.fefutin_tournament_turns tt
    on tt.id = tc.turn_id
  join public.fefutin_categories cat
    on cat.id = tc.category_id
  join public.fefutin_branches b
    on b.id = cat.branch_id
  join public.fefutin_clubs c
    on c.id = tcc.club_id
  join public.profiles p
    on p.id = c.referente_user_id
  join public.tournaments t
    on t.id = tc.tournament_id
  where tcc.status = 'pendiente'
    and tcc.participation_request_id is not null
    and c.is_active = true
    and p.role = 'referente'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null
  group by
    tcc.participation_request_id,
    c.id,
    c.name,
    p.username,
    p.email,
    t.id,
    t.title,
    tc.turn_id,
    tt.turno
  order by min(tcc.requested_at) asc;
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
  v_request_id uuid;
  v_turn_id uuid;
  v_club_id uuid;
  v_updated_count integer := 0;
begin
  select p.role into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'Solo Admin o Directivo puede resolver solicitudes de participacion';
  end if;

  select
    coalesce(tcc.participation_request_id, tcc.id),
    tc.turn_id,
    tcc.club_id
  into v_request_id, v_turn_id, v_club_id
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc
    on tc.id = tcc.tournament_category_id
  where (
      tcc.participation_request_id = p_request_id
      or tcc.id = p_request_id
    )
    and tcc.status = 'pendiente'
  limit 1
  for update of tcc;

  if not found then
    raise exception 'La solicitud ya fue resuelta o no existe';
  end if;

  if not exists (
    select 1
    from public.fefutin_clubs c
    where c.id = v_club_id
      and c.is_active = true
  ) then
    raise exception 'El club ya no esta habilitado';
  end if;

  if p_approve then
    update public.fefutin_tournament_category_clubs tcc
    set status = 'aprobado',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    where tcc.club_id = v_club_id
      and tcc.status = 'pendiente'
      and (
        tcc.participation_request_id = v_request_id
        or (tcc.participation_request_id is null and tcc.id = v_request_id)
      );

    get diagnostics v_updated_count = row_count;

    if v_updated_count = 0 then
      raise exception 'No hay categorias pendientes para aprobar en esta solicitud';
    end if;

    -- Conectar el padron permanente con la lista de buena fe de cada categoria aprobada.
    insert into public.fefutin_category_club_players (
      tournament_category_club_id,
      roster_player_id,
      jersey_number,
      sort_order,
      status
    )
    select
      tcc.id,
      rp.id,
      '',
      row_number() over (
        partition by tcc.id
        order by rp.last_name, rp.first_name, rp.created_at, rp.id
      )::integer,
      case rp.approval_status
        when 'aprobado' then 'aprobado'
        when 'rechazado' then 'rechazado'
        else 'pendiente'
      end
    from public.fefutin_tournament_category_clubs tcc
    join public.fefutin_tournament_categories tc
      on tc.id = tcc.tournament_category_id
    join public.fefutin_categories cat
      on cat.id = tc.category_id
    join public.fefutin_branches b
      on b.id = cat.branch_id
    join public.fefutin_club_rosters cr
      on cr.club_id = tcc.club_id
     and lower(trim(cr.category_label)) = lower(trim(
       case
         when b.name = 'Baby fútbol'
           then 'Infantil · ' || replace(cat.name, 'Cat. ', '')
         else b.name || ' · ' || cat.name
       end
     ))
    join public.fefutin_club_roster_players rp
      on rp.roster_id = cr.id
     and rp.removed_at is null
    where tcc.club_id = v_club_id
      and tcc.status = 'aprobado'
      and (
        tcc.participation_request_id = v_request_id
        or (tcc.participation_request_id is null and tcc.id = v_request_id)
      )
    on conflict (tournament_category_club_id, roster_player_id) do nothing;
  else
    update public.fefutin_tournament_category_clubs tcc
    set status = 'desestimado',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    where tcc.club_id = v_club_id
      and tcc.status = 'pendiente'
      and (
        tcc.participation_request_id = v_request_id
        or (tcc.participation_request_id is null and tcc.id = v_request_id)
      );

    get diagnostics v_updated_count = row_count;

    if v_updated_count = 0 then
      raise exception 'No hay categorias pendientes para desestimar en esta solicitud';
    end if;
  end if;
end;
$function$;

revoke all on function public.submit_fefutin_club_tournament_request(uuid, uuid) from public, anon;
revoke all on function public.get_fefutin_my_tournament_requests() from public, anon;
revoke all on function public.get_fefutin_pending_club_tournament_requests() from public, anon;
revoke all on function public.decide_fefutin_club_tournament_request(uuid, boolean) from public, anon;

grant execute on function public.submit_fefutin_club_tournament_request(uuid, uuid) to authenticated;
grant execute on function public.get_fefutin_my_tournament_requests() to authenticated;
grant execute on function public.get_fefutin_pending_club_tournament_requests() to authenticated;
grant execute on function public.decide_fefutin_club_tournament_request(uuid, boolean) to authenticated;

commit;
