-- FEFUTIN: incorporar el rol referente al circuito existente de solicitudes.
-- Los referentes solicitan el rol; nunca se lo asignan desde el navegador.
-- Admin y directivos pueden aprobar/desestimar referentes. Los directivos
-- siguen sin poder aprobar solicitudes de otros directivos.

begin;

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'directivo', 'arbitro', 'referente', 'visitante'));

alter table public.profiles
  drop constraint if exists profiles_requested_role_check;
alter table public.profiles
  add constraint profiles_requested_role_check
  check (requested_role is null or requested_role in ('directivo', 'arbitro', 'referente'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_role text;
begin
  v_requested_role := case
    when new.raw_user_meta_data ->> 'requested_role' in ('directivo', 'arbitro', 'referente')
      then new.raw_user_meta_data ->> 'requested_role'
    else null
  end;

  insert into public.profiles (
    id, username, email, role, requested_role, approval_status
  )
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
      'Jugador_' || substr(new.id::text, 1, 8)
    ),
    new.email,
    'visitante',
    v_requested_role,
    case when v_requested_role is null then 'aprobado' else 'pendiente' end
  )
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.get_fefutin_pending_requests()
returns table (
  id uuid,
  username text,
  email text,
  requested_role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
begin
  select p.role
    into v_actor_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenés permisos para consultar solicitudes';
  end if;

  return query
  select p.id, p.username, p.email, p.requested_role, p.created_at
  from public.profiles p
  where p.approval_status = 'pendiente'
    and p.requested_role in ('directivo', 'arbitro', 'referente')
    and (v_actor_role = 'admin' or p.requested_role in ('arbitro', 'referente'))
  order by p.created_at asc;
end;
$$;

create or replace function public.approve_fefutin_access(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target public.profiles%rowtype;
begin
  select p.role
    into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenés permisos para aprobar solicitudes';
  end if;

  select p.*
    into v_target
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found or v_target.approval_status <> 'pendiente' then
    raise exception 'La solicitud ya no está pendiente o no existe';
  end if;

  if v_target.requested_role not in ('directivo', 'arbitro', 'referente') then
    raise exception 'La solicitud no contiene un rol válido';
  end if;

  if v_actor_role = 'directivo' and v_target.requested_role not in ('arbitro', 'referente') then
    raise exception 'Un directivo solo puede aprobar solicitudes de árbitro o referente';
  end if;

  update public.profiles
  set role = v_target.requested_role,
      approval_status = 'aprobado',
      approved_by = v_actor_id,
      approved_at = now(),
      deactivated_at = null
  where id = p_user_id;

  insert into public.fefutin_access_audit (
    actor_id, target_user_id, action, old_role, new_role,
    old_status, new_status, details
  )
  values (
    v_actor_id, p_user_id, 'solicitud_aprobada',
    v_target.role, v_target.requested_role,
    v_target.approval_status, 'aprobado',
    jsonb_build_object('requested_role', v_target.requested_role)
  );
end;
$$;

create or replace function public.reject_fefutin_access(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target public.profiles%rowtype;
begin
  select p.role
    into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenés permisos para desestimar solicitudes';
  end if;

  select p.*
    into v_target
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found or v_target.approval_status <> 'pendiente' then
    raise exception 'La solicitud ya no está pendiente o no existe';
  end if;

  if v_target.requested_role not in ('directivo', 'arbitro', 'referente') then
    raise exception 'La solicitud no contiene un rol válido';
  end if;

  if v_actor_role = 'directivo' and v_target.requested_role not in ('arbitro', 'referente') then
    raise exception 'Un directivo solo puede desestimar solicitudes de árbitro o referente';
  end if;

  update public.profiles
  set role = 'visitante',
      approval_status = 'desestimado',
      approved_by = v_actor_id,
      approved_at = now()
  where id = p_user_id;

  insert into public.fefutin_access_audit (
    actor_id, target_user_id, action, old_role, new_role,
    old_status, new_status, details
  )
  values (
    v_actor_id, p_user_id, 'solicitud_desestimada',
    v_target.role, 'visitante',
    v_target.approval_status, 'desestimado',
    jsonb_build_object('requested_role', v_target.requested_role)
  );
end;
$$;

revoke all on function public.get_fefutin_pending_requests() from public, anon;
revoke all on function public.approve_fefutin_access(uuid) from public, anon;
revoke all on function public.reject_fefutin_access(uuid) from public, anon;

grant execute on function public.get_fefutin_pending_requests() to authenticated;
grant execute on function public.approve_fefutin_access(uuid) to authenticated;
grant execute on function public.reject_fefutin_access(uuid) to authenticated;

commit;
