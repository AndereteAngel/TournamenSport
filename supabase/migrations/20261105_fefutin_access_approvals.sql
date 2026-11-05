-- FEFUTIN: aprobaciones seguras de solicitudes de acceso y auditoría.

begin;

create table if not exists public.fefutin_access_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('solicitud_aprobada', 'solicitud_desestimada')),
  old_role text,
  new_role text,
  old_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.fefutin_access_audit enable row level security;
revoke all on public.fefutin_access_audit from public, anon, authenticated;

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
    and p.requested_role in ('directivo', 'arbitro')
    and (v_actor_role = 'admin' or p.requested_role = 'arbitro')
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

  if v_target.requested_role not in ('directivo', 'arbitro') then
    raise exception 'La solicitud no contiene un rol válido';
  end if;

  if v_actor_role = 'directivo' and v_target.requested_role <> 'arbitro' then
    raise exception 'Un directivo solo puede aprobar solicitudes de árbitro';
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

  if v_target.requested_role not in ('directivo', 'arbitro') then
    raise exception 'La solicitud no contiene un rol válido';
  end if;

  if v_actor_role = 'directivo' and v_target.requested_role <> 'arbitro' then
    raise exception 'Un directivo solo puede desestimar solicitudes de árbitro';
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
