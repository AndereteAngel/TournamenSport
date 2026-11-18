-- FEFUTIN: solicitudes de participacion sobre el modelo normalizado.
-- Una solicitud del referente abarca todas las categorias activas del torneo.
-- La aprobacion/desestimacion resuelve en una sola transaccion todas esas categorias.
-- Las tablas y RPC legacy se conservan durante la migracion del frontend.

begin;

create or replace function public.submit_fefutin_club_tournament_request(
  p_tournament_id uuid,
  p_category_label text default 'TODA LA TIRA'
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

  if p_tournament_id is null then
    raise exception 'Selecciona un torneo valido';
  end if;

  select count(*)::integer into v_category_count
  from public.fefutin_tournament_categories tc
  where tc.tournament_id = p_tournament_id
    and tc.status = 'inscripcion';

  if v_category_count = 0 then
    raise exception 'El torneo no tiene categorias disponibles para inscripcion';
  end if;

  if exists (
    select 1
    from public.fefutin_tournament_category_clubs tcc
    join public.fefutin_tournament_categories tc on tc.id = tcc.tournament_category_id
    where tc.tournament_id = p_tournament_id
      and tcc.club_id = v_club.id
      and tcc.status in ('pendiente', 'aprobado')
  ) then
    raise exception 'Tu club ya tiene una solicitud pendiente o una participacion aprobada en ese torneo';
  end if;

  with upserted as (
    insert into public.fefutin_tournament_category_clubs (
      tournament_category_id, club_id, status, requested_by, requested_at,
      reviewed_by, reviewed_at
    )
    select
      tc.id, v_club.id, 'pendiente', v_user_id, now(), null, null
    from public.fefutin_tournament_categories tc
    where tc.tournament_id = p_tournament_id
      and tc.status = 'inscripcion'
    on conflict (tournament_category_id, club_id) do update
      set status = 'pendiente',
          requested_by = excluded.requested_by,
          requested_at = now(),
          reviewed_by = null,
          reviewed_at = null
      where public.fefutin_tournament_category_clubs.status in ('desestimado', 'retirado')
    returning id
  )
  select (array_agg(id order by id))[1]
  into v_request_id
  from upserted;

  if v_request_id is null then
    raise exception 'No se pudo generar la solicitud. Verifica si el club ya participa en el torneo';
  end if;

  return v_request_id;
end;
$function$;

create or replace function public.get_fefutin_my_tournament_requests()
returns table (
  id uuid,
  tournament_id uuid,
  tournament_title text,
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
    (array_agg(tcc.id order by tcc.id))[1],
    tc.tournament_id,
    t.title,
    string_agg(b.name || ' · ' || c.name, ', ' order by b.sort_order, c.sort_order),
    tcc.status,
    min(tcc.requested_at)
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc on tc.id = tcc.tournament_category_id
  join public.fefutin_categories c on c.id = tc.category_id
  join public.fefutin_branches b on b.id = c.branch_id
  join public.tournaments t on t.id = tc.tournament_id
  where tcc.club_id = v_profile.club_id
    and tcc.requested_by = auth.uid()
  group by tc.tournament_id, t.title, tcc.status
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
    (array_agg(tcc.id order by tcc.id))[1],
    c.name,
    p.username,
    p.email,
    t.title,
    string_agg(b.name || ' · ' || cat.name, ', ' order by b.sort_order, cat.sort_order),
    min(tcc.requested_at)
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc on tc.id = tcc.tournament_category_id
  join public.fefutin_categories cat on cat.id = tc.category_id
  join public.fefutin_branches b on b.id = cat.branch_id
  join public.fefutin_clubs c on c.id = tcc.club_id
  join public.profiles p on p.id = c.referente_user_id
  join public.tournaments t on t.id = tc.tournament_id
  where tcc.status = 'pendiente'
    and c.is_active = true
    and p.role = 'referente'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null
  group by c.id, c.name, p.username, p.email, t.id, t.title, tcc.requested_by
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
  v_tournament_id uuid;
  v_club_id uuid;
  v_updated_count integer;
begin
  select p.role into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'Solo Admin o Directivo puede resolver solicitudes de participacion';
  end if;

  select tc.tournament_id, tcc.club_id
    into v_tournament_id, v_club_id
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc on tc.id = tcc.tournament_category_id
  where tcc.id = p_request_id
    and tcc.status = 'pendiente'
  for update of tcc;

  if not found then
    raise exception 'La solicitud ya fue resuelta o no existe';
  end if;

  if not exists (
    select 1 from public.fefutin_clubs c
    where c.id = v_club_id and c.is_active = true
  ) then
    raise exception 'El club ya no esta habilitado';
  end if;

  update public.fefutin_tournament_category_clubs tcc
  set status = case when p_approve then 'aprobado' else 'desestimado' end,
      reviewed_by = v_actor_id,
      reviewed_at = now()
  from public.fefutin_tournament_categories tc
  where tc.id = tcc.tournament_category_id
    and tc.tournament_id = v_tournament_id
    and tcc.club_id = v_club_id
    and tcc.status = 'pendiente';

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception 'No hay categorias pendientes para resolver';
  end if;
end;
$function$;

revoke all on function public.submit_fefutin_club_tournament_request(uuid, text) from public, anon;
revoke all on function public.get_fefutin_my_tournament_requests() from public, anon;
revoke all on function public.get_fefutin_pending_club_tournament_requests() from public, anon;
revoke all on function public.decide_fefutin_club_tournament_request(uuid, boolean) from public, anon;

grant execute on function public.submit_fefutin_club_tournament_request(uuid, text) to authenticated;
grant execute on function public.get_fefutin_my_tournament_requests() to authenticated;
grant execute on function public.get_fefutin_pending_club_tournament_requests() to authenticated;
grant execute on function public.decide_fefutin_club_tournament_request(uuid, boolean) to authenticated;

commit;
