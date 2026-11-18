-- FEFUTIN: mantener sincronizados los vinculos de jugadores por categoria/turno.
-- El plantel permanente sigue siendo la ficha maestra; esta tabla registra la participacion.
begin;

create or replace function public.sync_fefutin_category_club_player_from_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entry public.fefutin_roster_tournament_entries%rowtype;
  v_legacy public.fefutin_club_tournaments%rowtype;
  v_tournament_category_id uuid;
  v_category_club_id uuid;
  v_branch_name text;
  v_category_name text;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_entry := old;
  else
    v_entry := new;
  end if;

  select ct.* into v_legacy
  from public.fefutin_club_tournaments ct
  where ct.id = v_entry.club_tournament_id;

  if not found or v_legacy.turn_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select tc.id, tcc.id, b.name, cat.name
  into v_tournament_category_id, v_category_club_id, v_branch_name, v_category_name
  from public.fefutin_tournament_categories tc
  join public.fefutin_categories cat on cat.id = tc.category_id
  join public.fefutin_branches b on b.id = cat.branch_id
  join public.fefutin_tournament_category_clubs tcc
    on tcc.tournament_category_id = tc.id
   and tcc.club_id = v_legacy.club_id
  where tc.turn_id = v_legacy.turn_id
    and lower(trim(v_legacy.category_label)) =
        lower(trim(b.name || ' · ' || cat.name))
  limit 1;

  if v_tournament_category_id is null or v_category_club_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    update public.fefutin_category_club_players
    set status = 'rechazado'
    where tournament_category_club_id = v_category_club_id
      and roster_player_id = v_entry.roster_player_id;
    return old;
  end if;

  v_status := case v_entry.approval_status
    when 'aprobado' then 'aprobado'
    when 'rechazado' then 'rechazado'
    else 'pendiente'
  end;

  insert into public.fefutin_category_club_players (
    tournament_category_club_id, roster_player_id, jersey_number, sort_order, status
  )
  values (
    v_category_club_id,
    v_entry.roster_player_id,
    coalesce(v_entry.jersey_number, ''),
    coalesce(v_entry.sort_order, 0),
    v_status
  )
  on conflict (tournament_category_club_id, roster_player_id) do update
    set jersey_number = excluded.jersey_number,
        sort_order = excluded.sort_order,
        status = excluded.status;

  return new;
end;
$function$;

drop trigger if exists fefutin_sync_category_club_player_from_entry
  on public.fefutin_roster_tournament_entries;

create trigger fefutin_sync_category_club_player_from_entry
after insert or update of club_tournament_id, roster_player_id, jersey_number, sort_order, approval_status
or delete on public.fefutin_roster_tournament_entries
for each row execute function public.sync_fefutin_category_club_player_from_entry();

-- Backfill idempotente de las entradas ya existentes, sin tocar planteles ni registros oficiales.
insert into public.fefutin_category_club_players (
  tournament_category_club_id, roster_player_id, jersey_number, sort_order, status
)
select
  tcc.id,
  entry.roster_player_id,
  coalesce(entry.jersey_number, ''),
  coalesce(entry.sort_order, 0),
  case entry.approval_status
    when 'aprobado' then 'aprobado'
    when 'rechazado' then 'rechazado'
    else 'pendiente'
  end
from public.fefutin_roster_tournament_entries entry
join public.fefutin_club_tournaments legacy on legacy.id = entry.club_tournament_id
join public.fefutin_tournament_categories tc on tc.turn_id = legacy.turn_id
join public.fefutin_categories cat on cat.id = tc.category_id
join public.fefutin_branches b on b.id = cat.branch_id
join public.fefutin_tournament_category_clubs tcc
  on tcc.tournament_category_id = tc.id
 and tcc.club_id = legacy.club_id
where lower(trim(legacy.category_label)) =
      lower(trim(b.name || ' · ' || cat.name))
on conflict (tournament_category_club_id, roster_player_id) do update
  set jersey_number = excluded.jersey_number,
      sort_order = excluded.sort_order,
      status = excluded.status;

commit;
