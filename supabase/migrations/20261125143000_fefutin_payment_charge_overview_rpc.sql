-- Read-only, role-scoped overview for the FEFUTIN payments screen.
begin;

create or replace function public.get_fefutin_payment_charge_overview()
returns table (
  id uuid,
  club_id uuid,
  amount numeric,
  currency text,
  status text,
  created_at timestamptz,
  paid_at timestamptz,
  concept_name text,
  player_first_name text,
  player_last_name text,
  player_approval_status text,
  category_label text,
  club_name text
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
  where p.id=auth.uid();

  if not found
     or v_profile.role not in ('admin','directivo','referente')
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'No tenés permisos para consultar los pagos FEFUTIN';
  end if;

  return query
  select
    ch.id,ch.club_id,ch.amount,ch.currency,ch.status,ch.created_at,ch.paid_at,
    ch.concept_name,rp.first_name,rp.last_name,rp.approval_status,
    cr.category_label,c.name
  from public.fefutin_player_charges ch
  join public.fefutin_club_roster_players rp on rp.id=ch.roster_player_id
  join public.fefutin_club_rosters cr on cr.id=rp.roster_id
  join public.fefutin_clubs c on c.id=ch.club_id
  where v_profile.role in ('admin','directivo')
     or (v_profile.role='referente' and ch.club_id=v_profile.club_id)
  order by ch.created_at desc;
end;
$function$;

revoke all on function public.get_fefutin_payment_charge_overview() from public,anon;
grant execute on function public.get_fefutin_payment_charge_overview() to authenticated;

commit;
