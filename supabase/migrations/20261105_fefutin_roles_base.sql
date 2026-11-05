-- FEFUTIN: base segura para cadena de mando.
-- Esta migracion prepara perfiles y proteccion de campos de rol.
-- No activa directivos/arbitros ni cambia politicas de torneos en esta etapa.

begin;

alter table public.profiles
  add column if not exists role text not null default 'visitante',
  add column if not exists requested_role text,
  add column if not exists approval_status text not null default 'approved',
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists deactivated_at timestamptz;

-- Valores permitidos para rol vigente y rol solicitado.
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'directivo', 'arbitro', 'visitante'));

alter table public.profiles
  drop constraint if exists profiles_requested_role_check;
alter table public.profiles
  add constraint profiles_requested_role_check
  check (requested_role is null or requested_role in ('directivo', 'arbitro'));

alter table public.profiles
  drop constraint if exists profiles_approval_status_check;
alter table public.profiles
  add constraint profiles_approval_status_check
  check (approval_status in ('pendiente', 'aprobado', 'desestimado', 'baja'));

-- Conserva el UID que actualmente administra FEFUTIN.
update public.profiles
set role = 'admin',
    requested_role = null,
    approval_status = 'aprobado',
    approved_at = coalesce(approved_at, created_at)
where id = 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid;

-- Las cuentas existentes que no son el administrador quedan como visitantes.
-- No se les conceden permisos administrativos por el hecho de existir.
update public.profiles
set role = 'visitante',
    requested_role = null,
    approval_status = 'aprobado'
where id <> 'c2089fce-5fb1-430a-8abc-89f5b762b69a'::uuid
  and role not in ('directivo', 'arbitro');

-- El usuario puede modificar datos de perfil ordinarios, pero no el rol,
-- estado de aprobacion, aprobador ni fecha de baja desde el cliente.
revoke update on table public.profiles from anon, public, authenticated;
grant update (username, email) on table public.profiles to authenticated;
grant select, insert on table public.profiles to authenticated;

-- Funciones seguras para que la aplicacion pueda consultar el rol propio.
create or replace function public.get_my_fefutin_access()
returns table (
  role text,
  requested_role text,
  approval_status text,
  approved_at timestamptz,
  deactivated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.role, p.requested_role, p.approval_status, p.approved_at, p.deactivated_at
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_fefutin_access() from public, anon;
grant execute on function public.get_my_fefutin_access() to authenticated;

commit;
