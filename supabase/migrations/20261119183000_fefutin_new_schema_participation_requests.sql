-- FEFUTIN: solicitudes y aprobaciones sobre el esquema nuevo de torneos/categorías/competencias.
-- Una solicitud por club y torneo (rama + turno). Al aprobar, vincula al club con todas
-- las competencias activas de ese torneo. No modifica solicitudes históricas.

begin;

create or replace function public.fefutin_nueva_solicitud_participacion(p_torneo_id uuid)
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

  if not exists (
    select 1
    from public.fefutin_torneos t
    join public.fefutin_torneo_categorias cat
      on cat.torneo_id = t.id and cat.activa = true
    join public.fefutin_competencias comp
      on comp.categoria_id = cat.id
    where t.id = p_torneo_id
      and t.estado = 'inscripcion'
  ) then
    raise exception 'El torneo no tiene categorías activas abiertas para inscripción';
  end if;

  if exists (
    select 1 from public.fefutin_clubes_inscriptos i
    where i.torneo_id = p_torneo_id
      and i.club_id = v_club.id
      and i.estado in ('pendiente', 'aprobado')
  ) then
    raise exception 'Tu club ya tiene una solicitud o inscripción para este torneo';
  end if;

  insert into public.fefutin_clubes_inscriptos (
    torneo_id, club_id, tipo_inscripcion, categoria_solicitada_id,
    estado, solicitado_por
  )
  values (
    p_torneo_id, v_club.id, 'toda_la_tira', null, 'pendiente', v_user_id
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.fefutin_nuevas_mis_solicitudes()
returns table (
  id uuid,
  torneo_id uuid,
  estado text,
  fecha_solicitud timestamptz,
  fecha_respuesta timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.torneo_id, i.estado, i.fecha_solicitud, i.fecha_respuesta
  from public.fefutin_clubes_inscriptos i
  join public.fefutin_clubs c on c.id = i.club_id
  where c.referente_user_id = auth.uid()
  order by i.fecha_solicitud desc;
$$;

create or replace function public.fefutin_nuevas_mis_competencias()
returns table (
  torneo_id uuid,
  competencia_id uuid,
  categoria_id uuid,
  categoria_nombre text,
  estado text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    cc.competencia_id,
    cat.id,
    cat.nombre,
    cc.estado
  from public.fefutin_competencia_clubes cc
  join public.fefutin_clubs c on c.id = cc.club_id
  join public.fefutin_competencias comp on comp.id = cc.competencia_id
  join public.fefutin_torneo_categorias cat on cat.id = comp.categoria_id
  join public.fefutin_torneos t on t.id = cat.torneo_id
  where c.referente_user_id = auth.uid()
  order by cat.sort_order, cat.nombre;
$$;

create or replace function public.fefutin_nuevas_solicitudes_pendientes()
returns table (
  id uuid,
  torneo_id uuid,
  club_name text,
  referente_name text,
  referente_email text,
  tournament_title text,
  turno text,
  category_label text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    i.torneo_id,
    c.name,
    coalesce(p.username, 'Sin nombre'),
    p.email,
    t.nombre,
    t.turno,
    coalesce((
      select string_agg(cat.nombre, ' · ' order by cat.sort_order, cat.nombre)
      from public.fefutin_torneo_categorias cat
      where cat.torneo_id = t.id and cat.activa = true
    ), 'Sin categorías activas'),
    i.fecha_solicitud
  from public.fefutin_clubes_inscriptos i
  join public.fefutin_clubs c on c.id = i.club_id
  join public.fefutin_torneos t on t.id = i.torneo_id
  left join public.profiles p on p.id = i.solicitado_por
  where i.estado = 'pendiente'
    and public.fefutin_puede_gestionar_torneos_nuevos()
  order by i.fecha_solicitud asc;
$$;

create or replace function public.fefutin_resolver_nueva_solicitud(
  p_solicitud_id uuid,
  p_aprobar boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.fefutin_clubes_inscriptos%rowtype;
  v_actor_id uuid := auth.uid();
  v_inserted integer := 0;
begin
  if not public.fefutin_puede_gestionar_torneos_nuevos() then
    raise exception 'Solo Admin o Directivo habilitado puede resolver solicitudes';
  end if;

  select i.* into v_request
  from public.fefutin_clubes_inscriptos i
  where i.id = p_solicitud_id
  for update;

  if not found or v_request.estado <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta o no existe';
  end if;

  if p_aprobar then
    insert into public.fefutin_competencia_clubes (
      competencia_id, inscripcion_id, club_id, estado
    )
    select
      comp.id, v_request.id, v_request.club_id, 'habilitado'
    from public.fefutin_competencias comp
    join public.fefutin_torneo_categorias cat on cat.id = comp.categoria_id
    where cat.torneo_id = v_request.torneo_id
      and cat.activa = true
    on conflict (competencia_id, club_id) do nothing;

    get diagnostics v_inserted = row_count;

    if v_inserted = 0 and not exists (
      select 1
      from public.fefutin_competencia_clubes cc
      join public.fefutin_competencias comp on comp.id = cc.competencia_id
      join public.fefutin_torneo_categorias cat on cat.id = comp.categoria_id
      where cc.inscripcion_id = v_request.id
        and cat.torneo_id = v_request.torneo_id
    ) then
      raise exception 'No hay competencias activas para habilitar en este torneo';
    end if;

    update public.fefutin_clubes_inscriptos
    set estado = 'aprobado', fecha_respuesta = now(),
        observaciones = coalesce(observaciones, '')
    where id = v_request.id;
  else
    update public.fefutin_clubes_inscriptos
    set estado = 'desestimado', fecha_respuesta = now()
    where id = v_request.id;
  end if;
end;
$$;

revoke all on function public.fefutin_nueva_solicitud_participacion(uuid) from public, anon;
revoke all on function public.fefutin_nuevas_mis_solicitudes() from public, anon;
revoke all on function public.fefutin_nuevas_mis_competencias() from public, anon;
revoke all on function public.fefutin_nuevas_solicitudes_pendientes() from public, anon;
revoke all on function public.fefutin_resolver_nueva_solicitud(uuid, boolean) from public, anon;

grant execute on function public.fefutin_nueva_solicitud_participacion(uuid) to authenticated;
grant execute on function public.fefutin_nuevas_mis_solicitudes() to authenticated;
grant execute on function public.fefutin_nuevas_mis_competencias() to authenticated;
grant execute on function public.fefutin_nuevas_solicitudes_pendientes() to authenticated;
grant execute on function public.fefutin_resolver_nueva_solicitud(uuid, boolean) to authenticated;

commit;
