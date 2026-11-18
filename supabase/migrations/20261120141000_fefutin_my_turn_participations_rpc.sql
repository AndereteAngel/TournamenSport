-- FEFUTIN: consulta de participaciones normalizadas del referente por turno.
begin;

create or replace function public.get_fefutin_my_turn_participations()
returns table (
  turn_id uuid,
  tournament_id uuid,
  tournament_title text,
  turno text,
  status text,
  categories jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'No tenes permisos para consultar las participaciones de tu club';
  end if;

  return query
  select
    tt.id,
    t.id,
    t.title,
    tt.turno,
    case
      when bool_and(tcc.status = 'aprobado') then 'aprobado'
      when bool_or(tcc.status = 'pendiente') then 'pendiente'
      when bool_or(tcc.status = 'retirado') then 'retirado'
      else 'desestimado'
    end,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', cat.name,
          'status', tcc.status,
          'category_club_id', tcc.id
        ) order by cat.sort_order, cat.name
      ),
      '[]'::jsonb
    )
  from public.fefutin_tournament_category_clubs tcc
  join public.fefutin_tournament_categories tc on tc.id = tcc.tournament_category_id
  join public.fefutin_categories cat on cat.id = tc.category_id
  join public.fefutin_tournament_turns tt on tt.id = tc.turn_id
  join public.tournaments t on t.id = tt.tournament_id
  where tcc.club_id = v_profile.club_id
  group by tt.id, t.id, t.title, tt.turno
  order by t.title, tt.turno;
end;
$function$;

revoke all on function public.get_fefutin_my_turn_participations() from public, anon;
grant execute on function public.get_fefutin_my_turn_participations() to authenticated;

commit;
