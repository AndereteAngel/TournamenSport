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
begin
  v_round_id := case when tg_op = 'DELETE' then old.round_id else new.round_id end;

  select r.turn_journey_id into v_journey_id
  from public.fefutin_rounds r
  where r.id = v_round_id;

  if v_round_id is not null then
    update public.fefutin_rounds r
    set status = case
      when exists (
        select 1 from public.fefutin_matches m
        where m.round_id = r.id and m.status = 'en_curso'
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

  if v_journey_id is not null then
    update public.fefutin_turn_journeys j
    set status = case
      when exists (
        select 1
        from public.fefutin_rounds r
        join public.fefutin_matches m on m.round_id = r.id
        where r.turn_journey_id = j.id and m.status = 'en_curso'
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

commit;
