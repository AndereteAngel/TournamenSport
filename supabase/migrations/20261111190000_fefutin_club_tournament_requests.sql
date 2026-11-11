-- FEFUTIN: solicitudes de participación de clubes ya registrados en nuevos torneos.
-- No crea ni modifica clubes, perfiles, jugadores o listas de buena fe.

begin;

create table if not exists public.fefutin_club_tournament_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.fefutin_clubs(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_label text not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aprobado', 'desestimado')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fefutin_club_tournament_request_category_not_empty
    check (char_length(trim(category_label)) > 0)
);

create index if not exists fefutin_club_tournament_requests_pending_idx
  on public.fefutin_club_tournament_requests(created_at)
  where status = 'pendiente';

create unique index if not exists fefutin_club_tournament_requests_one_pending
  on public.fefutin_club_tournament_requests(club_id, tournament_id)
  where status = 'pendiente';

alter table public.fefutin_club_tournament_requests enable row level security;
revoke all on public.fefutin_club_tournament_requests from anon, public, authenticated;

-- El referente solicita una nueva participación usando el club que ya tiene asociado.
create or replace function public.submit_fefutin_club_tournament_request(
  p_tournament_id uuid,
  p_category_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_club public.fefutin_clubs%rowtype;
  v_request_id uuid;
begin
  if v_user_id is null then
    raise exception 'Tenés que iniciar sesión para solicitar una participación';
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
    raise exception 'Solo un referente habilitado con un club asociado puede solicitar participación';
  end if;

  select c.* into v_club
  from public.fefutin_clubs c
  where c.id = v_profile.club_id
    and c.referente_user_id = v_user_id
    and c.is_active = true
  for update;

  if not found then
    raise exception 'El club asociado todavía no está habilitado';
  end if;

  if p_tournament_id is null
     or not exists (
       select 1 from public.tournaments t where t.id = p_tournament_id
     ) then
    raise exception 'El torneo seleccionado ya no existe';
  end if;

  if nullif(trim(p_category_label), '') is null
     or char_length(trim(p_category_label)) > 120 then
    raise exception 'No se pudo identificar una rama y categoría válida';
  end if;

  if exists (
    select 1 from public.fefutin_club_tournaments ct
    where ct.club_id = v_club.id and ct.tournament_id = p_tournament_id
  ) then
    raise exception 'Tu club ya está habilitado para participar en ese torneo';
  end if;

  if exists (
    select 1 from public.fefutin_club_tournament_requests r
    where r.club_id = v_club.id
      and r.tournament_id = p_tournament_id
      and r.status = 'pendiente'
  ) then
    raise exception 'Ya existe una solicitud pendiente para ese torneo';
  end if;

  insert into public.fefutin_club_tournament_requests (
    club_id, tournament_id, category_label, requested_by
  )
  values (
    v_club.id, p_tournament_id, trim(p_category_label), v_user_id
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

-- El referente puede consultar solamente el historial de solicitudes de su club.
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
as $$
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
    raise exception 'No tenés permisos para consultar estas solicitudes';
  end if;

  return query
  select r.id, r.tournament_id, t.title, r.category_label, r.status, r.created_at
  from public.fefutin_club_tournament_requests r
  join public.fefutin_clubs c on c.id = r.club_id
  join public.tournaments t on t.id = r.tournament_id
  where c.id = v_profile.club_id
    and c.referente_user_id = auth.uid()
  order by r.created_at desc;
end;
$$;

-- Admin y directivo consultan la bandeja de solicitudes pendientes.
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
as $$
declare
  v_actor_role text;
begin
  select p.role into v_actor_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenés permisos para consultar solicitudes de participación';
  end if;

  return query
  select r.id, c.name, p.username, p.email, t.title, r.category_label, r.created_at
  from public.fefutin_club_tournament_requests r
  join public.fefutin_clubs c on c.id = r.club_id
  join public.profiles p on p.id = c.referente_user_id
  join public.tournaments t on t.id = r.tournament_id
  where r.status = 'pendiente'
    and c.is_active = true
    and p.role = 'referente'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null
  order by r.created_at asc;
end;
$$;

-- Solo Admin o Directivo puede aprobar/desestimar. La aprobación crea la relación
-- club-torneo; las listas y los jugadores se crean/gestionan por su circuito habitual.
create or replace function public.decide_fefutin_club_tournament_request(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_request public.fefutin_club_tournament_requests%rowtype;
  v_club public.fefutin_clubs%rowtype;
begin
  select p.role into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'Solo Admin o Directivo puede resolver solicitudes de participación';
  end if;

  select r.* into v_request
  from public.fefutin_club_tournament_requests r
  where r.id = p_request_id
  for update;

  if not found or v_request.status <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta o no existe';
  end if;

  select c.* into v_club
  from public.fefutin_clubs c
  where c.id = v_request.club_id
    and c.is_active = true
  for update;

  if not found then
    raise exception 'El club ya no está habilitado';
  end if;

  if p_approve then
    insert into public.fefutin_club_tournaments (club_id, tournament_id, category_label)
    values (v_request.club_id, v_request.tournament_id, v_request.category_label)
    on conflict (club_id, tournament_id) do nothing;

    update public.fefutin_club_tournament_requests
    set status = 'aprobado', reviewed_by = v_actor_id, reviewed_at = now()
    where id = p_request_id;
  else
    update public.fefutin_club_tournament_requests
    set status = 'desestimado', reviewed_by = v_actor_id, reviewed_at = now()
    where id = p_request_id;
  end if;
end;
$$;

revoke all on function public.submit_fefutin_club_tournament_request(uuid, text) from public, anon;
revoke all on function public.get_fefutin_my_tournament_requests() from public, anon;
revoke all on function public.get_fefutin_pending_club_tournament_requests() from public, anon;
revoke all on function public.decide_fefutin_club_tournament_request(uuid, boolean) from public, anon;

grant execute on function public.submit_fefutin_club_tournament_request(uuid, text) to authenticated;
grant execute on function public.get_fefutin_my_tournament_requests() to authenticated;
grant execute on function public.get_fefutin_pending_club_tournament_requests() to authenticated;
grant execute on function public.decide_fefutin_club_tournament_request(uuid, boolean) to authenticated;

commit;
