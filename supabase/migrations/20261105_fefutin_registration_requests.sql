-- FEFUTIN: registro de solicitudes de acceso.
-- El rol activo siempre nace como visitante. El cliente solo puede pedir
-- directivo o arbitro; nunca puede asignarse permisos administrativos.

begin;

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
    when new.raw_user_meta_data ->> 'requested_role' in ('directivo', 'arbitro')
      then new.raw_user_meta_data ->> 'requested_role'
    else null
  end;

  insert into public.profiles (
    id,
    username,
    email,
    role,
    requested_role,
    approval_status
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

commit;
