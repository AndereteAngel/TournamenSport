-- FEFUTIN: una solicitud por torneo; al aprobar, habilita toda la tira de categorías.
-- Conserva las solicitudes existentes y genera una participación por cada categoría del torneo.

begin;

-- Una participación por club, torneo y categoría permite que el club quede habilitado
-- en todas las categorías sin duplicar equipos dentro de una misma categoría.
alter table public.fefutin_club_tournaments
  drop constraint if exists fefutin_club_tournaments_unique;

alter table public.fefutin_club_tournaments
  add constraint fefutin_club_tournaments_unique
  unique (club_id, tournament_id, category_label);

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

  if exists (
    select 1 from public.fefutin_club_tournament_requests r
    where r.club_id = v_club.id
      and r.tournament_id = p_tournament_id
      and r.status = 'pendiente'
  ) then
    raise exception 'Ya existe una solicitud pendiente para ese torneo';
  end if;

  if exists (
    select 1 from public.fefutin_club_tournaments ct
    where ct.club_id = v_club.id
      and ct.tournament_id = p_tournament_id
  ) then
    raise exception 'Tu club ya está inscripto en ese torneo';
  end if;

  insert into public.fefutin_club_tournament_requests (
    club_id, tournament_id, category_label, requested_by
  )
  values (
    v_club.id, p_tournament_id, 'TODA LA TIRA', v_user_id
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

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
  v_inserted_count integer := 0;
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
    insert into public.fefutin_club_tournaments (
      club_id, tournament_id, category_label
    )
    select
      v_request.club_id,
      v_request.tournament_id,
      trim(branch.value->>'division') || ' · ' || trim(category.value #>> '{}')
    from public.tournaments t
    cross join lateral jsonb_array_elements(coalesce(t.groups, '[]'::jsonb)) registration_group(value)
    cross join lateral jsonb_array_elements(coalesce(registration_group.value->'category_config', '[]'::jsonb)) branch(value)
    cross join lateral jsonb_array_elements(coalesce(branch.value->'categories', '[]'::jsonb)) category(value)
    where t.id = v_request.tournament_id
      and registration_group.value->>'name' = '__INSCRIPCIONES__'
      and nullif(trim(branch.value->>'division'), '') is not null
      and nullif(trim(category.value #>> '{}'), '') is not null
    on conflict (club_id, tournament_id, category_label) do nothing;

    get diagnostics v_inserted_count = row_count;

    if v_inserted_count = 0
       and not exists (
         select 1 from public.fefutin_club_tournaments ct
         where ct.club_id = v_request.club_id
           and ct.tournament_id = v_request.tournament_id
       ) then
      raise exception 'El torneo no tiene ramas y categorías configuradas para habilitar';
    end if;

    -- Cierra también solicitudes pendientes antiguas por categoría del mismo torneo.
    update public.fefutin_club_tournament_requests
    set status = 'aprobado', reviewed_by = v_actor_id, reviewed_at = now()
    where club_id = v_request.club_id
      and tournament_id = v_request.tournament_id
      and status = 'pendiente';
  else
    update public.fefutin_club_tournament_requests
    set status = 'desestimado', reviewed_by = v_actor_id, reviewed_at = now()
    where club_id = v_request.club_id
      and tournament_id = v_request.tournament_id
      and status = 'pendiente';
  end if;
end;
$$;

revoke all on function public.submit_fefutin_club_tournament_request(uuid, text) from public, anon;
revoke all on function public.decide_fefutin_club_tournament_request(uuid, boolean) from public, anon;

grant execute on function public.submit_fefutin_club_tournament_request(uuid, text) to authenticated;
grant execute on function public.decide_fefutin_club_tournament_request(uuid, boolean) to authenticated;

commit;
