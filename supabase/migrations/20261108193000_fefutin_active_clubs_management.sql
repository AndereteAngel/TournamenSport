-- FEFUTIN: consulta de clubes habilitados y baja individual de inscripciones.
-- Quitar una relación club-torneo nunca elimina el club ni el torneo.

begin;

create or replace function public.get_fefutin_active_clubs()
returns table (
  club_id uuid,
  club_name text,
  headquarters_address text,
  logo_path text,
  referente_user_id uuid,
  referente_name text,
  referente_email text,
  tournaments jsonb
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
    raise exception 'No tenés permisos para consultar clubes habilitados';
  end if;

  return query
  select
    c.id,
    c.name,
    c.headquarters_address,
    c.logo_path,
    c.referente_user_id,
    p.username,
    p.email,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', ct.id,
          'tournament_id', t.id,
          'title', t.title,
          'category_label', ct.category_label
        )
        order by t.title, ct.category_label
      ) filter (where ct.id is not null),
      '[]'::jsonb
    )
  from public.fefutin_clubs c
  join public.profiles p on p.id = c.referente_user_id
  left join public.fefutin_club_tournaments ct on ct.club_id = c.id
  left join public.tournaments t on t.id = ct.tournament_id
  where c.is_active = true
    and p.role = 'referente'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null
  group by c.id, c.name, c.headquarters_address, c.logo_path,
           c.referente_user_id, p.username, p.email
  order by c.name;
end;
$$;

revoke all on function public.get_fefutin_active_clubs() from public, anon;
grant execute on function public.get_fefutin_active_clubs() to authenticated;

create or replace function public.remove_fefutin_club_tournament(
  p_club_tournament_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_deleted_count integer;
begin
  select p.role
    into v_actor_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenés permisos para modificar las inscripciones de clubes';
  end if;

  delete from public.fefutin_club_tournaments
  where id = p_club_tournament_id;

  get diagnostics v_deleted_count = row_count;
  if v_deleted_count = 0 then
    raise exception 'No se encontró esa inscripción de club en el torneo';
  end if;
end;
$$;

revoke all on function public.remove_fefutin_club_tournament(uuid) from public, anon;
grant execute on function public.remove_fefutin_club_tournament(uuid) to authenticated;

commit;
