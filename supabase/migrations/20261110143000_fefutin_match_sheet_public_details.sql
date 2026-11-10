-- FEFUTIN: datos institucionales y nombre del arbitro para la planilla imprimible.
begin;

create or replace function public.get_fefutin_match_sheet_club_addresses(
  p_tournament_id uuid,
  p_local_club_name text,
  p_visitor_club_name text
)
returns table (
  club_name text,
  headquarters_address text,
  category_label text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    c.name,
    c.headquarters_address,
    ct.category_label
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  where ct.tournament_id = p_tournament_id
    and c.is_active = true
    and (
      lower(trim(c.name)) = lower(trim(p_local_club_name))
      or lower(trim(c.name)) = lower(trim(p_visitor_club_name))
    )
  order by c.name, ct.category_label;
$$;

-- La versión inicial de un parámetro no debe quedar expuesta.
revoke all on function public.get_fefutin_match_sheet_club_addresses(uuid) from public, anon, authenticated;

revoke all on function public.get_fefutin_match_sheet_club_addresses(uuid, text, text) from public;
grant execute on function public.get_fefutin_match_sheet_club_addresses(uuid, text, text) to anon, authenticated;

create or replace function public.get_fefutin_match_sheet_referee_name(
  p_tournament_id uuid,
  p_match_id text,
  p_referee_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_role text;
  v_name text;
  v_assigned boolean;
begin
  select p.role
    into v_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_role, '') <> 'referente' then
    raise exception 'Solo un referente habilitado puede consultar el arbitro de la planilla';
  end if;

  select exists (
    select 1
    from public.tournaments t
    where t.id = p_tournament_id
      and (
        exists (
          select 1
          from jsonb_array_elements(coalesce(t.groups, '[]'::jsonb)) as grp(group_data)
          cross join lateral jsonb_array_elements(coalesce(grp.group_data -> 'matches', '[]'::jsonb)) as mt(match_data)
          where mt.match_data ->> 'id' = p_match_id
            and mt.match_data ->> 'referee_id' = p_referee_id::text
        )
        or exists (
          select 1
          from jsonb_array_elements(coalesce(t.playoffs, '[]'::jsonb)) as rnd(round_data)
          cross join lateral jsonb_array_elements(coalesce(rnd.round_data, '[]'::jsonb)) as mt(match_data)
          where mt.match_data ->> 'id' = p_match_id
            and mt.match_data ->> 'referee_id' = p_referee_id::text
        )
      )
  )
  into v_assigned;

  if not coalesce(v_assigned, false) then
    raise exception 'El arbitro indicado no esta designado para este partido';
  end if;

  select nullif(
    trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.last_name), ''))),
    ''
  )
  into v_name
  from public.profiles p
  left join public.fefutin_referee_carnets c on c.user_id = p.id
  where p.id = p_referee_id
    and p.role = 'arbitro'
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  return v_name;
end;
$$;

revoke all on function public.get_fefutin_match_sheet_referee_name(uuid, text, uuid) from public, anon;
grant execute on function public.get_fefutin_match_sheet_referee_name(uuid, text, uuid) to authenticated;

commit;
