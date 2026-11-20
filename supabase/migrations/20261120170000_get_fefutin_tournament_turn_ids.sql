-- FEFUTIN: expone únicamente los IDs de turnos mediante una función controlada.
-- Evita que el cliente necesite permisos directos sobre fefutin_tournament_turns.
begin;

create or replace function public.get_fefutin_tournament_turn_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  select t.id
  from public.fefutin_tournament_turns t
  order by t.id;
$function$;

revoke all on function public.get_fefutin_tournament_turn_ids() from public;
revoke all on function public.get_fefutin_tournament_turn_ids() from anon;
grant execute on function public.get_fefutin_tournament_turn_ids() to authenticated;

commit;
