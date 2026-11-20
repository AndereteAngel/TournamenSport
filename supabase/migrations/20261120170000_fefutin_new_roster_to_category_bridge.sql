-- FEFUTIN: puente definitivo entre padron permanente, inscripcion por categoria y lista de buena fe.
-- No consulta ni escribe tablas legacy. Los jugadores siguen siendo fichas unicas del padron.
begin;

create or replace function public.decide_fefutin_club_tournament_request(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_request public.fefutin_club_tournament_requests%rowtype;
  v_updated_count integer;
  v_expected_count integer;
begin
  select p.role into v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'Solo Admin o Directivo puede resolver solicitudes de participacion';
  end if;

  select r.* into v_request
  from public.fefutin_club_tournament_requests r
  where r.id = p_request_id
  for update;

  if not found or v_request.status <> 'pendiente' or v_request.turn_id is null then
    raise exception 'La solicitud ya fue resuelta, no existe o no tiene turno';
  end if;

  if not exists (
    select 1
    from public.fefutin_clubs c
    where c.id = v_request.club_id
      and c.is_active = true
  ) then
    raise exception 'El club ya no esta habilitado';
  end if;

  select count(*)::integer into v_expected_count
  from public.fefutin_tournament_categories tc
  where tc.turn_id = v_request.turn_id
    and tc.status = 'inscripcion';

  if p_approve then
    update public.fefutin_tournament_category_clubs tcc
    set status = 'aprobado',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    from public.fefutin_tournament_categories tc
    where tc.id = tcc.tournament_category_id
      and tc.turn_id = v_request.turn_id
      and tc.status = 'inscripcion'
      and tcc.club_id = v_request.club_id
      and tcc.status = 'pendiente';

    get diagnostics v_updated_count = row_count;

    if v_updated_count <> v_expected_count then
      raise exception 'La solicitud no contiene todas las categorias del turno. No se aprobo para evitar una inscripcion incompleta.';
    end if;

    -- La lista de buena fe se arma desde el padron permanente del mismo club
    -- y la categoria exacta. Ej.: Infantil · 2018 -> Baby fútbol / Cat. 2018.
    insert into public.fefutin_category_club_players (
      tournament_category_club_id,
      roster_player_id,
      jersey_number,
      sort_order,
      status
    )
    select
      tcc.id,
      rp.id,
      '',
      row_number() over (
        partition by tcc.id
        order by rp.last_name, rp.first_name, rp.created_at, rp.id
      )::integer,
      case rp.approval_status
        when 'aprobado' then 'aprobado'
        when 'rechazado' then 'rechazado'
        else 'pendiente'
      end
    from public.fefutin_tournament_categories tc
    join public.fefutin_categories cat on cat.id = tc.category_id
    join public.fefutin_branches b on b.id = cat.branch_id
    join public.fefutin_tournament_category_clubs tcc
      on tcc.tournament_category_id = tc.id
     and tcc.club_id = v_request.club_id
     and tcc.status = 'aprobado'
    join public.fefutin_club_rosters cr
      on cr.club_id = tcc.club_id
     and lower(trim(cr.category_label)) =
         lower(trim(
           case
             when b.name = 'Baby fútbol'
               then 'Infantil · ' || regexp_replace(cat.name, '^Cat\\.\\s*', '')
             else b.name || ' · ' || cat.name
           end
         ))
    join public.fefutin_club_roster_players rp
      on rp.roster_id = cr.id
     and rp.removed_at is null
    where tc.turn_id = v_request.turn_id
      and tc.status = 'inscripcion'
    on conflict (tournament_category_club_id, roster_player_id) do nothing;

    update public.fefutin_club_tournament_requests
    set status = 'aprobado',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    where id = p_request_id;
  else
    update public.fefutin_tournament_category_clubs tcc
    set status = 'desestimado',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    from public.fefutin_tournament_categories tc
    where tc.id = tcc.tournament_category_id
      and tc.turn_id = v_request.turn_id
      and tc.status = 'inscripcion'
      and tcc.club_id = v_request.club_id
      and tcc.status = 'pendiente';

    update public.fefutin_club_tournament_requests
    set status = 'desestimado',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    where id = p_request_id;
  end if;
end;
$function$;

revoke all on function public.decide_fefutin_club_tournament_request(uuid, boolean) from public, anon;
grant execute on function public.decide_fefutin_club_tournament_request(uuid, boolean) to authenticated;

-- Backfill idempotente para los clubes/categorias que ya estaban aprobados.
-- No altera las inscripciones ni duplica jugadores: respeta la clave unica del puente.
insert into public.fefutin_category_club_players (
  tournament_category_club_id,
  roster_player_id,
  jersey_number,
  sort_order,
  status
)
select
  tcc.id,
  rp.id,
  '',
  row_number() over (
    partition by tcc.id
    order by rp.last_name, rp.first_name, rp.created_at, rp.id
  )::integer,
  case rp.approval_status
    when 'aprobado' then 'aprobado'
    when 'rechazado' then 'rechazado'
    else 'pendiente'
  end
from public.fefutin_tournament_category_clubs tcc
join public.fefutin_tournament_categories tc
  on tc.id = tcc.tournament_category_id
 and tc.status = 'inscripcion'
join public.fefutin_categories cat on cat.id = tc.category_id
join public.fefutin_branches b on b.id = cat.branch_id
join public.fefutin_club_rosters cr
  on cr.club_id = tcc.club_id
 and lower(trim(cr.category_label)) =
     lower(trim(
       case
         when b.name = 'Baby fútbol'
           then 'Infantil · ' || regexp_replace(cat.name, '^Cat\\.\\s*', '')
         else b.name || ' · ' || cat.name
       end
     ))
join public.fefutin_club_roster_players rp
  on rp.roster_id = cr.id
 and rp.removed_at is null
where tcc.status = 'aprobado'
on conflict (tournament_category_club_id, roster_player_id) do nothing;

commit;
