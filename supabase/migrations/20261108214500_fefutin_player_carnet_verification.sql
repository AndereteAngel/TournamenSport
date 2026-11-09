-- FEFUTIN: estado de habilitación del carnet separado del alta administrativa.
-- El alta aprobada conserva su número y carnet; la verificación arbitral solo cambia el estado.
begin;

alter table public.fefutin_players
  add column if not exists carnet_status text not null default 'pendiente'
    check (carnet_status in ('pendiente', 'habilitado', 'no_habilitado')),
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz;

-- Los jugadores que ya tienen registro oficial quedan pendientes de verificación,
-- sin modificar sus números de carnet ni sus aprobaciones.
update public.fefutin_players
set carnet_status = 'pendiente'
where carnet_status is null;

-- La verificación solo puede realizarla el árbitro asignado al partido indicado.
-- El jugador debe pertenecer a uno de los dos clubes que disputan ese partido.
create or replace function public.verify_fefutin_player_for_match(
  p_player_entry_id uuid,
  p_tournament_id uuid,
  p_match_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_registry_id uuid;
  v_club_name text;
  v_is_assigned_match boolean := false;
  v_current_status text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found or v_profile.role <> 'arbitro'
    or v_profile.approval_status <> 'aprobado'
    or v_profile.deactivated_at is not null then
    raise exception 'Solo un árbitro aprobado y activo puede verificar carnets';
  end if;

  select pl.registry_player_id, c.name
    into v_registry_id, v_club_name
  from public.fefutin_team_players pl
  join public.fefutin_teams ft on ft.id = pl.team_id
  join public.fefutin_club_tournaments ct on ct.id = ft.club_tournament_id
  join public.fefutin_clubs c on c.id = ct.club_id
  where pl.id = p_player_entry_id
    and ct.tournament_id = p_tournament_id
    and ft.status = 'presentada'
    and pl.approval_status = 'aprobado'
    and pl.registry_player_id is not null;

  if not found then
    raise exception 'El jugador no tiene un alta aprobada y un carnet generado para este torneo';
  end if;

  select exists (
    select 1
    from public.tournaments t
    cross join lateral jsonb_array_elements(coalesce(t.groups, '[]'::jsonb)) g
    cross join lateral jsonb_array_elements(coalesce(g -> 'matches', '[]'::jsonb)) m
    where t.id = p_tournament_id
      and m ->> 'id' = p_match_id
      and m ->> 'referee_id' = auth.uid()::text
      and (
        lower(trim(coalesce(m ->> 'team1', ''))) = lower(trim(v_club_name))
        or lower(trim(coalesce(m ->> 'team2', ''))) = lower(trim(v_club_name))
      )
    union all
    select 1
    from public.tournaments t
    cross join lateral jsonb_array_elements(coalesce(t.playoffs, '[]'::jsonb)) r
    cross join lateral jsonb_array_elements(coalesce(r, '[]'::jsonb)) m
    where t.id = p_tournament_id
      and m ->> 'id' = p_match_id
      and m ->> 'referee_id' = auth.uid()::text
      and (
        lower(trim(coalesce(m ->> 'team1', ''))) = lower(trim(v_club_name))
        or lower(trim(coalesce(m ->> 'team2', ''))) = lower(trim(v_club_name))
      )
  ) into v_is_assigned_match;

  if not v_is_assigned_match then
    raise exception 'Solo podés verificar jugadores de un partido que tenés asignado y en el que participa su club';
  end if;

  select fp.carnet_status into v_current_status
  from public.fefutin_players fp
  where fp.id = v_registry_id
  for update;

  if not found then
    raise exception 'No se encontró el carnet oficial del jugador';
  end if;

  if v_current_status = 'no_habilitado' then
    raise exception 'El carnet figura como NO HABILITADO. Debe revisarlo Admin o Directivo';
  end if;

  update public.fefutin_players
  set carnet_status = 'habilitado',
      verified_by = auth.uid(),
      verified_at = now()
  where id = v_registry_id;

  return 'HABILITADO';
end;
$$;

revoke all on function public.verify_fefutin_player_for_match(uuid, uuid, text) from public, anon;
grant execute on function public.verify_fefutin_player_for_match(uuid, uuid, text) to authenticated;

-- El estado se entrega junto con el número del registro oficial para mostrar el carnet.
create or replace function public.get_fefutin_my_teams()
returns table (
  club_id uuid, club_name text, headquarters_address text, logo_path text,
  club_tournament_id uuid, tournament_id uuid, tournament_title text,
  category_label text, team_id uuid, team_status text, submitted_at timestamptz,
  players jsonb
)
language plpgsql
security definer
set search_path = ''
as $fefutin$
declare v_profile public.profiles%rowtype;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if not found or v_profile.approval_status <> 'aprobado'
    or v_profile.deactivated_at is not null
    or v_profile.role not in ('referente','admin','directivo') then
    raise exception 'No tenés permisos para consultar las fichas de equipos';
  end if;
  if v_profile.role = 'referente' and v_profile.club_id is null then
    raise exception 'Tu usuario todavía no tiene un club asociado';
  end if;

  return query
  select c.id, c.name, c.headquarters_address, c.logo_path,
    ct.id, ct.tournament_id, t.title, ct.category_label,
    ft.id, ft.status, ft.submitted_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'first_name', pl.first_name, 'last_name', pl.last_name,
        'dni', pl.dni, 'birth_date', pl.birth_date,
        'jersey_number', pl.jersey_number, 'photo_path', pl.photo_path,
        'approval_status', pl.approval_status,
        'carnet_number', fp.carnet_number,
        'carnet_status', fp.carnet_status,
        'sort_order', pl.sort_order
      ) order by pl.sort_order, pl.created_at)
      from public.fefutin_team_players pl
      left join public.fefutin_players fp on fp.id = pl.registry_player_id
      where pl.team_id = ft.id
    ), '[]'::jsonb)
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  join public.tournaments t on t.id = ct.tournament_id
  left join public.fefutin_teams ft on ft.club_tournament_id = ct.id
  where c.is_active = true
    and (v_profile.role in ('admin','directivo') or c.id = v_profile.club_id)
  order by c.name, t.title, ct.category_label;
end;
$fefutin$;

revoke all on function public.get_fefutin_my_teams() from public, anon;
grant execute on function public.get_fefutin_my_teams() to authenticated;

commit;
