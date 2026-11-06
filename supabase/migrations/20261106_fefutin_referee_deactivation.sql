-- FEFUTIN: baja logica y segura de cuentas de arbitros.
-- Conserva perfiles, partidos, resultados y estadisticas historicas.

begin;

create or replace function public.deactivate_fefutin_referee(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_target public.profiles%rowtype;
begin
  select p.role
    into v_actor_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenes permisos para dar de baja cuentas de arbitros.';
  end if;

  select p.*
    into v_target
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found then
    raise exception 'No se encontro el perfil del arbitro.';
  end if;

  if v_target.role <> 'arbitro' then
    raise exception 'Esta accion solo permite dar de baja cuentas de arbitros.';
  end if;

  if v_target.approval_status <> 'aprobado' or v_target.deactivated_at is not null then
    raise exception 'El arbitro ya no tiene una cuenta activa.';
  end if;

  update public.profiles
  set approval_status = 'baja',
      deactivated_at = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.deactivate_fefutin_referee(uuid) from public, anon;
grant execute on function public.deactivate_fefutin_referee(uuid) to authenticated;

commit;
