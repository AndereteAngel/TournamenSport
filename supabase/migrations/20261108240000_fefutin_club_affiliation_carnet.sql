-- FEFUTIN: afiliación institucional única y carnet digital del club.
begin;

create sequence if not exists public.fefutin_club_affiliation_seq start with 1;

alter table public.fefutin_clubs
  add column if not exists affiliate_number text;

create unique index if not exists fefutin_clubs_affiliate_number_uidx
  on public.fefutin_clubs (affiliate_number)
  where affiliate_number is not null;

-- Asignar número a los clubes que ya estaban habilitados.
update public.fefutin_clubs
set affiliate_number = 'FEF-' || lpad(nextval('public.fefutin_club_affiliation_seq')::text, 6, '0')
where is_active = true
  and affiliate_number is null;

-- Al aprobar por primera vez al referente, el club recibe su número permanente.
create or replace function public.assign_fefutin_club_affiliation_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requested_role = 'referente'
     and new.approval_status = 'aprobado'
     and old.approval_status is distinct from new.approval_status then
    update public.fefutin_clubs
    set affiliate_number = 'FEF-' || lpad(nextval('public.fefutin_club_affiliation_seq')::text, 6, '0')
    where referente_user_id = new.id
      and affiliate_number is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_fefutin_club_affiliation_number on public.profiles;
create trigger trg_assign_fefutin_club_affiliation_number
after update of approval_status on public.profiles
for each row
execute function public.assign_fefutin_club_affiliation_number();

-- Exponer el número a la ficha del club mediante la RPC ya utilizada por la app.
drop function if exists public.get_fefutin_my_teams();
create or replace function public.get_fefutin_my_teams()
returns table (
  club_id uuid,
  club_name text,
  affiliate_number text,
  headquarters_address text,
  logo_path text,
  club_tournament_id uuid,
  tournament_id uuid,
  tournament_title text,
  category_label text,
  team_id uuid,
  team_status text,
  submitted_at timestamptz,
  players jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.role not in ('referente', 'admin', 'directivo') then
    raise exception 'No tenés permisos para consultar las fichas de equipos';
  end if;

  if v_profile.role = 'referente' and v_profile.club_id is null then
    raise exception 'Tu usuario todavía no tiene un club asociado';
  end if;

  return query
  select
    c.id,
    c.name,
    c.affiliate_number,
    c.headquarters_address,
    c.logo_path,
    ct.id,
    ct.tournament_id,
    t.title,
    ct.category_label,
    ft.id,
    ft.status,
    ft.submitted_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pl.id,
          'first_name', pl.first_name,
          'last_name', pl.last_name,
          'dni', pl.dni,
          'birth_date', pl.birth_date,
          'jersey_number', pl.jersey_number,
          'carnet_number', pl.carnet_number,
          'sort_order', pl.sort_order
        ) order by pl.sort_order, pl.created_at
      )
      from public.fefutin_team_players pl
      where pl.team_id = ft.id
    ), '[]'::jsonb)
  from public.fefutin_club_tournaments ct
  join public.fefutin_clubs c on c.id = ct.club_id
  join public.tournaments t on t.id = ct.tournament_id
  left join public.fefutin_teams ft on ft.club_tournament_id = ct.id
  where c.is_active = true
    and (v_profile.role in ('admin', 'directivo') or c.id = v_profile.club_id)
  order by c.name, t.title, ct.category_label;
end;
$$;

revoke all on function public.get_fefutin_my_teams() from public, anon;
grant execute on function public.get_fefutin_my_teams() to authenticated;

commit;
