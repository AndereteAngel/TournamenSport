-- FEFUTIN: lectura segura de turnos y clubes por turno mediante RPC.
begin;

alter table public.fefutin_tournament_turns enable row level security;
alter table public.fefutin_turn_journeys enable row level security;
alter table public.fefutin_legacy_match_migration_audit enable row level security;

revoke all on public.fefutin_tournament_turns from public, anon, authenticated;
revoke all on public.fefutin_turn_journeys from public, anon, authenticated;
revoke all on public.fefutin_legacy_match_migration_audit from public, anon, authenticated;

create or replace function public.get_fefutin_tournament_turns(
  p_tournament_id uuid default null
)
returns table (
  turn_id uuid,
  tournament_id uuid,
  tournament_title text,
  branch_name text,
  turno text,
  turn_status text,
  categories jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  return query
  select
    tt.id,
    t.id,
    t.title,
    b.name,
    tt.turno,
    tt.status,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'tournament_category_id', tc.id,
          'category_id', cat.id,
          'name', cat.name,
          'format', tc.format,
          'status', tc.status,
          'settings', tc.settings,
          'sort_order', cat.sort_order
        ) order by cat.sort_order, cat.name
      ) filter (where tc.id is not null),
      '[]'::jsonb
    )
  from public.fefutin_tournament_turns tt
  join public.tournaments t on t.id = tt.tournament_id
  join public.fefutin_branches b on b.id = t.fefutin_branch_id
  left join public.fefutin_tournament_categories tc on tc.turn_id = tt.id
  left join public.fefutin_categories cat on cat.id = tc.category_id
  where (p_tournament_id is null or t.id = p_tournament_id)
    and (
      t.is_public = true
      or coalesce(v_role, '') in ('admin', 'directivo')
    )
  group by tt.id, t.id, t.title, b.name, tt.turno, tt.status
  order by b.sort_order, b.name, tt.turno;
end;
$function$;

create or replace function public.get_fefutin_tournament_turn_clubs(
  p_turn_id uuid
)
returns table (
  tournament_category_club_id uuid,
  tournament_category_id uuid,
  turn_id uuid,
  tournament_id uuid,
  club_id uuid,
  club_name text,
  logo_path text,
  headquarters_address text,
  category_id uuid,
  category_name text,
  category_label text,
  club_tournament_id uuid,
  team_id uuid,
  team_status text,
  player_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_is_public boolean;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  select t.is_public into v_is_public
  from public.fefutin_tournament_turns tt
  join public.tournaments t on t.id = tt.tournament_id
  where tt.id = p_turn_id;

  if not found then
    raise exception 'No se encontro el turno seleccionado';
  end if;

  if not coalesce(v_is_public, false)
     and coalesce(v_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenes permisos para consultar las inscripciones de este turno';
  end if;

  return query
  select
    tcc.id,
    tc.id,
    tt.id,
    t.id,
    c.id,
    c.name,
    c.logo_path,
    c.headquarters_address,
    cat.id,
    cat.name,
    b.name || ' · ' || cat.name,
    legacy.id,
    ft.id,
    ft.status,
    coalesce(player_counts.player_count, 0)::integer
  from public.fefutin_tournament_turns tt
  join public.tournaments t on t.id = tt.tournament_id
  join public.fefutin_tournament_categories tc on tc.turn_id = tt.id
  join public.fefutin_categories cat on cat.id = tc.category_id
  join public.fefutin_branches b on b.id = cat.branch_id
  join public.fefutin_tournament_category_clubs tcc
    on tcc.tournament_category_id = tc.id
   and tcc.status = 'aprobado'
  join public.fefutin_clubs c on c.id = tcc.club_id and c.is_active = true
  left join public.fefutin_club_tournaments legacy
    on legacy.club_id = c.id
   and legacy.tournament_id = t.id
   and legacy.turn_id = tt.id
   and lower(trim(legacy.category_label)) = lower(trim(b.name || ' · ' || cat.name))
  left join public.fefutin_teams ft on ft.club_tournament_id = legacy.id
  left join lateral (
    select count(*)::integer as player_count
    from public.fefutin_team_players ftp
    where ftp.team_id = ft.id
  ) player_counts on true
  where tt.id = p_turn_id
  order by cat.sort_order, cat.name, c.name;
end;
$function$;

revoke all on function public.get_fefutin_tournament_turns(uuid) from public;
revoke all on function public.get_fefutin_tournament_turn_clubs(uuid) from public;
grant execute on function public.get_fefutin_tournament_turns(uuid) to anon, authenticated;
grant execute on function public.get_fefutin_tournament_turn_clubs(uuid) to anon, authenticated;

commit;
