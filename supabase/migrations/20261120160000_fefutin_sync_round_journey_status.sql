-- FEFUTIN: mantener el estado de ronda y jornada general sincronizado con sus partidos.
begin;

create or replace function public.sync_fefutin_round_and_turn_journey_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_round_id uuid;
  v_journey_id uuid;
  v_category_id uuid;
  v_turn_id uuid;
begin
  v_round_id := case when tg_op = 'DELETE' then old.round_id else new.round_id end;

  select r.turn_journey_id, r.tournament_category_id
    into v_journey_id, v_category_id
  from public.fefutin_rounds r
  where r.id = v_round_id;

  select tc.turn_id into v_turn_id
  from public.fefutin_tournament_categories tc
  where tc.id = v_category_id;

  if v_round_id is not null then
    update public.fefutin_rounds r
    set status = case
      when exists (
        select 1 from public.fefutin_matches m
        where m.round_id = r.id and m.status = 'en_juego'
      ) then 'en_curso'
      when exists (
        select 1 from public.fefutin_matches m
        where m.round_id = r.id
      ) and not exists (
        select 1 from public.fefutin_matches m
        where m.round_id = r.id and m.status <> 'finalizado'
      ) then 'finalizada'
      else 'pendiente'
    end,
    updated_at = now()
    where r.id = v_round_id;
  end if;

  if v_category_id is not null then
    update public.fefutin_tournament_categories tc
    set status = case
      when exists (
        select 1 from public.fefutin_matches m
        join public.fefutin_rounds r on r.id = m.round_id
        where r.tournament_category_id = tc.id and m.status = 'en_juego'
      ) then 'en_curso'
      when exists (
        select 1 from public.fefutin_matches m
        join public.fefutin_rounds r on r.id = m.round_id
        where r.tournament_category_id = tc.id
      ) and not exists (
        select 1 from public.fefutin_matches m
        join public.fefutin_rounds r on r.id = m.round_id
        where r.tournament_category_id = tc.id and m.status <> 'finalizado'
      ) then 'finalizada'
      else 'en_curso'
    end,
    updated_at = now()
    where tc.id = v_category_id;

    update public.fefutin_tournament_turns tt
    set status = case
      when exists (
        select 1 from public.fefutin_tournament_categories tc
        where tc.turn_id = tt.id
      ) and not exists (
        select 1 from public.fefutin_tournament_categories tc
        where tc.turn_id = tt.id and tc.status <> 'finalizada'
      ) then 'finalizada'
      when exists (
        select 1 from public.fefutin_tournament_categories tc
        where tc.turn_id = tt.id and tc.status in ('en_curso', 'finalizada')
      ) then 'en_curso'
      else 'inscripcion'
    end,
    updated_at = now()
    where tt.id = v_turn_id;
  end if;

  if v_journey_id is not null then
    update public.fefutin_turn_journeys j
    set status = case
      when exists (
        select 1
        from public.fefutin_rounds r
        join public.fefutin_matches m on m.round_id = r.id
        where r.turn_journey_id = j.id and m.status = 'en_juego'
      ) then 'en_curso'
      when exists (
        select 1
        from public.fefutin_rounds r
        join public.fefutin_matches m on m.round_id = r.id
        where r.turn_journey_id = j.id
      ) and not exists (
        select 1
        from public.fefutin_rounds r
        join public.fefutin_matches m on m.round_id = r.id
        where r.turn_journey_id = j.id and m.status <> 'finalizado'
      ) then 'finalizada'
      else 'pendiente'
    end,
    updated_at = now()
    where j.id = v_journey_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists fefutin_match_sync_round_journey_status
  on public.fefutin_matches;
create trigger fefutin_match_sync_round_journey_status
after insert or update of status or delete
on public.fefutin_matches
for each row
execute function public.sync_fefutin_round_and_turn_journey_status();

-- El estado visible del torneo de rama resume sus dos turnos independientes.
create or replace function public.sync_fefutin_branch_tournament_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tournament_id uuid;
begin
  v_tournament_id := case when tg_op = 'DELETE' then old.tournament_id else new.tournament_id end;

  update public.tournaments t
  set status = case
    when exists (
      select 1 from public.fefutin_tournament_turns tt
      where tt.tournament_id = v_tournament_id
        and tt.status in ('en_curso', 'finalizada')
    ) and exists (
      select 1 from public.fefutin_tournament_turns tt
      where tt.tournament_id = v_tournament_id
        and tt.status <> 'finalizada'
    ) then 'En curso'
    when exists (
      select 1 from public.fefutin_tournament_turns tt
      where tt.tournament_id = v_tournament_id
    ) and not exists (
      select 1 from public.fefutin_tournament_turns tt
      where tt.tournament_id = v_tournament_id
        and tt.status <> 'finalizada'
    ) then 'Finalizado'
    else 'Inscripciones'
  end
  where t.id = v_tournament_id
    and t.fefutin_branch_id is not null;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists fefutin_turn_sync_branch_tournament_status
  on public.fefutin_tournament_turns;
create trigger fefutin_turn_sync_branch_tournament_status
after insert or update of status or delete
on public.fefutin_tournament_turns
for each row
execute function public.sync_fefutin_branch_tournament_status();

-- Reconstruir los estados de categorias y turnos que ya recibieron partidos del backfill.
update public.fefutin_tournament_categories tc
set status = case
  when exists (
    select 1
    from public.fefutin_legacy_match_migration_audit audit
    where audit.source_tournament_id = tc.tournament_id
      and audit.migration_status = 'requiere_revision'
  ) then 'en_curso'
  when exists (
    select 1
    from public.fefutin_rounds r
    join public.fefutin_matches m on m.round_id = r.id
    where r.tournament_category_id = tc.id
  ) and not exists (
    select 1
    from public.fefutin_rounds r
    join public.fefutin_matches m on m.round_id = r.id
    where r.tournament_category_id = tc.id
      and m.status <> 'finalizado'
  ) then 'finalizada'
  else 'en_curso'
end,
updated_at = now()
where exists (
  select 1
  from public.fefutin_rounds r
  join public.fefutin_matches m on m.round_id = r.id
  where r.tournament_category_id = tc.id
);

update public.fefutin_tournament_turns tt
set status = case
  when exists (
    select 1
    from public.fefutin_legacy_match_migration_audit audit
    where audit.source_tournament_id = tt.tournament_id
      and audit.migration_status = 'requiere_revision'
  ) then 'en_curso'
  when exists (
    select 1
    from public.fefutin_rounds r
    join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
    join public.fefutin_matches m on m.round_id = r.id
    where tc.turn_id = tt.id
  ) and not exists (
    select 1
    from public.fefutin_rounds r
    join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
    join public.fefutin_matches m on m.round_id = r.id
    where tc.turn_id = tt.id
      and m.status <> 'finalizado'
  ) then 'finalizada'
  else 'en_curso'
end,
updated_at = now()
where exists (
  select 1
  from public.fefutin_rounds r
  join public.fefutin_tournament_categories tc on tc.id = r.tournament_category_id
  join public.fefutin_matches m on m.round_id = r.id
  where tc.turn_id = tt.id
);

commit;
