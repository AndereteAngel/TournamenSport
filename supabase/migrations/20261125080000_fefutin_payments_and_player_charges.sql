begin;

create table if not exists public.fefutin_payment_concepts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'ARS' check (currency = 'ARS'),
  applies_to text not null default 'player_fichaje'
    check (applies_to in ('player_fichaje','tournament_registration','official_product')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.fefutin_payment_concepts
  (code,name,description,amount,currency,applies_to,is_active)
values
  ('FICHAJE_JUGADOR','Fichaje de jugador','Cargo inicial por inscripción de cada jugador al padrón permanente.',20000.00,'ARS','player_fichaje',true)
on conflict (code) do update
set name=excluded.name,
    description=excluded.description,
    applies_to=excluded.applies_to,
    currency=excluded.currency,
    is_active=true;

create table if not exists public.fefutin_player_charges (
  id uuid primary key default gen_random_uuid(),
  roster_player_id uuid not null unique
    references public.fefutin_club_roster_players(id) on delete restrict,
  club_id uuid not null references public.fefutin_clubs(id) on delete restrict,
  concept_id uuid not null references public.fefutin_payment_concepts(id) on delete restrict,
  concept_code text not null,
  concept_name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'ARS' check (currency = 'ARS'),
  status text not null default 'pendiente'
    check (status in ('pendiente','pagado','exonerado','anulado')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists fefutin_player_charges_club_status_idx
  on public.fefutin_player_charges(club_id,status,created_at desc);

create table if not exists public.fefutin_payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mercadopago'
    check (provider in ('mercadopago')),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled','refunded')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'ARS' check (currency = 'ARS'),
  external_reference text not null unique,
  provider_preference_id text,
  provider_payment_id text unique,
  checkout_url text,
  payer_user_id uuid references auth.users(id) on delete set null,
  provider_status text,
  provider_status_detail text,
  initiated_at timestamptz not null default now(),
  paid_at timestamptz,
  webhook_received_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fefutin_payments_status_created_idx
  on public.fefutin_payments(status,created_at desc);

create table if not exists public.fefutin_payment_items (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.fefutin_payments(id) on delete restrict,
  charge_id uuid not null references public.fefutin_player_charges(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(payment_id,charge_id)
);

create index if not exists fefutin_payment_items_charge_idx
  on public.fefutin_payment_items(charge_id);

create table if not exists public.fefutin_payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null unique references public.fefutin_player_charges(id) on delete restrict,
  authorized_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(trim(reason)) >= 5),
  authorized_at timestamptz not null default now()
);

create table if not exists public.fefutin_official_products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  currency text not null default 'ARS' check (currency = 'ARS'),
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fefutin_payment_concepts enable row level security;
alter table public.fefutin_player_charges enable row level security;
alter table public.fefutin_payments enable row level security;
alter table public.fefutin_payment_items enable row level security;
alter table public.fefutin_payment_exceptions enable row level security;
alter table public.fefutin_official_products enable row level security;

revoke all on public.fefutin_payment_concepts,
  public.fefutin_player_charges,
  public.fefutin_payments,
  public.fefutin_payment_items,
  public.fefutin_payment_exceptions,
  public.fefutin_official_products
from public, anon, authenticated;

grant select on public.fefutin_payment_concepts,
  public.fefutin_player_charges,
  public.fefutin_payments,
  public.fefutin_payment_items,
  public.fefutin_payment_exceptions,
  public.fefutin_official_products
to authenticated;

drop policy if exists fefutin_payment_concepts_read on public.fefutin_payment_concepts;
create policy fefutin_payment_concepts_read
on public.fefutin_payment_concepts for select to authenticated
using (
  is_active
  or exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.role in ('admin','directivo')
      and p.approval_status='aprobado'
      and p.deactivated_at is null
  )
);

drop policy if exists fefutin_player_charges_read on public.fefutin_player_charges;
create policy fefutin_player_charges_read
on public.fefutin_player_charges for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.approval_status='aprobado'
      and p.deactivated_at is null
      and (
        p.role in ('admin','directivo')
        or (p.role='referente' and p.club_id=fefutin_player_charges.club_id)
      )
  )
);

drop policy if exists fefutin_payments_read on public.fefutin_payments;
create policy fefutin_payments_read
on public.fefutin_payments for select to authenticated
using (
  exists (
    select 1
    from public.fefutin_payment_items pi
    join public.fefutin_player_charges ch on ch.id=pi.charge_id
    join public.profiles p on p.id=auth.uid()
    where pi.payment_id=fefutin_payments.id
      and p.approval_status='aprobado'
      and p.deactivated_at is null
      and (
        p.role in ('admin','directivo')
        or (p.role='referente' and p.club_id=ch.club_id)
      )
  )
);

drop policy if exists fefutin_payment_items_read on public.fefutin_payment_items;
create policy fefutin_payment_items_read
on public.fefutin_payment_items for select to authenticated
using (
  exists (
    select 1
    from public.fefutin_player_charges ch
    join public.profiles p on p.id=auth.uid()
    where ch.id=fefutin_payment_items.charge_id
      and p.approval_status='aprobado'
      and p.deactivated_at is null
      and (
        p.role in ('admin','directivo')
        or (p.role='referente' and p.club_id=ch.club_id)
      )
  )
);

drop policy if exists fefutin_payment_exceptions_read on public.fefutin_payment_exceptions;
create policy fefutin_payment_exceptions_read
on public.fefutin_payment_exceptions for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.role in ('admin','directivo')
      and p.approval_status='aprobado'
      and p.deactivated_at is null
  )
);

drop policy if exists fefutin_official_products_read on public.fefutin_official_products;
create policy fefutin_official_products_read
on public.fefutin_official_products for select to authenticated
using (
  is_active
  or exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.role in ('admin','directivo')
      and p.approval_status='aprobado'
      and p.deactivated_at is null
  )
);

create or replace function public.create_fefutin_player_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_club_id uuid;
  v_concept public.fefutin_payment_concepts%rowtype;
begin
  if new.removed_at is not null
     or nullif(regexp_replace(coalesce(new.dni,''),'[^0-9]','','g'),'') is null then
    return new;
  end if;

  select cr.club_id into v_club_id
  from public.fefutin_club_rosters cr
  where cr.id=new.roster_id;

  if v_club_id is null then
    raise exception 'No se pudo determinar el club del jugador para generar el fichaje';
  end if;

  select * into v_concept
  from public.fefutin_payment_concepts
  where code='FICHAJE_JUGADOR' and is_active=true;

  if not found then
    raise exception 'No está configurado el concepto de pago FICHAJE_JUGADOR';
  end if;

  insert into public.fefutin_player_charges
    (roster_player_id,club_id,concept_id,concept_code,concept_name,amount,currency,created_by)
  values
    (new.id,v_club_id,v_concept.id,v_concept.code,v_concept.name,v_concept.amount,v_concept.currency,auth.uid())
  on conflict (roster_player_id) do nothing;

  return new;
end;
$function$;

revoke all on function public.create_fefutin_player_charge() from public,anon,authenticated;

drop trigger if exists trg_fefutin_create_player_charge on public.fefutin_club_roster_players;
create trigger trg_fefutin_create_player_charge
after insert or update of removed_at on public.fefutin_club_roster_players
for each row
when (new.removed_at is null)
execute function public.create_fefutin_player_charge();

insert into public.fefutin_player_charges
  (roster_player_id,club_id,concept_id,concept_code,concept_name,amount,currency)
select rp.id,cr.club_id,pc.id,pc.code,pc.name,pc.amount,pc.currency
from public.fefutin_club_roster_players rp
join public.fefutin_club_rosters cr on cr.id=rp.roster_id
cross join public.fefutin_payment_concepts pc
where rp.removed_at is null
  and pc.code='FICHAJE_JUGADOR'
  and pc.is_active=true
  and nullif(regexp_replace(coalesce(rp.dni,''),'[^0-9]','','g'),'') is not null
on conflict (roster_player_id) do nothing;

create or replace function public.guard_fefutin_roster_approval_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_charge_status text;
  v_exception_exists boolean;
begin
  if old.approval_status='pendiente' and new.approval_status='aprobado' then
    select ch.status into v_charge_status
    from public.fefutin_player_charges ch
    where ch.roster_player_id=new.id;

    select exists (
      select 1
      from public.fefutin_payment_exceptions ex
      join public.fefutin_player_charges ch on ch.id=ex.charge_id
      where ch.roster_player_id=new.id
    ) into v_exception_exists;

    if v_charge_status is distinct from 'pagado' and not coalesce(v_exception_exists,false) then
      new.approval_status := 'pendiente';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_fefutin_roster_approval_payment() from public,anon,authenticated;

drop trigger if exists trg_fefutin_guard_roster_approval_payment on public.fefutin_club_roster_players;
create trigger trg_fefutin_guard_roster_approval_payment
before update of approval_status on public.fefutin_club_roster_players
for each row
execute function public.guard_fefutin_roster_approval_payment();

create or replace function public.decide_fefutin_player(
  p_player_entry_id uuid,
  p_approve boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_roster_player public.fefutin_club_roster_players%rowtype;
  v_registry_id uuid;
  v_carnet text;
  v_previous_status text := 'pendiente';
  v_charge_status text;
  v_exception_exists boolean := false;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id=auth.uid();

  if not found
     or v_profile.role not in ('admin','directivo')
     or v_profile.approval_status<>'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'No tenés permisos para aprobar altas de jugadores';
  end if;

  select rp.* into v_roster_player
  from public.fefutin_club_roster_players rp
  where rp.id=p_player_entry_id
    and rp.removed_at is null
  for update;

  if not found then
    raise exception 'No se encontró el jugador del plantel permanente';
  end if;

  if v_roster_player.approval_status<>'pendiente' then
    raise exception 'Este jugador ya fue revisado';
  end if;

  if not p_approve then
    update public.fefutin_club_roster_players
    set approval_status='rechazado',updated_at=now()
    where id=v_roster_player.id;
    return 'RECHAZADO';
  end if;

  select ch.status into v_charge_status
  from public.fefutin_player_charges ch
  where ch.roster_player_id=v_roster_player.id
  for update;

  if not found then
    raise exception 'El jugador no tiene un cargo de fichaje registrado. No se puede aprobar hasta regularizar el cargo.';
  end if;

  select exists (
    select 1 from public.fefutin_payment_exceptions ex
    join public.fefutin_player_charges ch on ch.id=ex.charge_id
    where ch.roster_player_id=v_roster_player.id
  ) into v_exception_exists;

  if v_charge_status<>'pagado' and not v_exception_exists then
    raise exception 'El fichaje está pendiente de pago. Para aprobar por excepción, Admin o Directivo debe autorizarlo con un motivo.';
  end if;

  if nullif(trim(v_roster_player.dni),'') is null
     or v_roster_player.birth_date is null
     or nullif(trim(v_roster_player.first_name),'') is null
     or nullif(trim(v_roster_player.last_name),'') is null then
    raise exception 'La ficha necesita nombre, apellido, DNI y fecha de nacimiento para generar el carnet';
  end if;

  select fp.id,
    case
      when fp.verification_status='no_habilitado' or fp.carnet_status='no_habilitado'
      then 'no_habilitado'
      else 'habilitado'
    end
  into v_registry_id,v_previous_status
  from public.fefutin_players fp
  where regexp_replace(coalesce(fp.dni,''),'[^0-9]','','g')=v_roster_player.identity_key
  order by fp.created_at asc
  limit 1
  for update;

  if v_registry_id is not null and v_previous_status='no_habilitado' then
    raise exception 'Este DNI ya tiene un carnet NO HABILITADO por sanción. Debe revisarlo Admin/Directivo antes de cualquier nueva habilitación.';
  end if;

  if v_registry_id is null then
    v_previous_status:='pendiente';
    insert into public.fefutin_players (
      dni,first_name,last_name,birth_date,photo_path,approved_by,carnet_status,verification_status
    ) values (
      v_roster_player.dni,v_roster_player.first_name,v_roster_player.last_name,
      v_roster_player.birth_date,v_roster_player.photo_path,auth.uid(),'habilitado','habilitado'
    )
    returning id,carnet_number into v_registry_id,v_carnet;
  else
    update public.fefutin_players
    set first_name=v_roster_player.first_name,
        last_name=v_roster_player.last_name,
        birth_date=v_roster_player.birth_date,
        photo_path=coalesce(v_roster_player.photo_path,photo_path)
    where id=v_registry_id
      and status='aprobado'
      and carnet_status='habilitado'
      and verification_status='habilitado'
    returning carnet_number into v_carnet;

    if v_carnet is null then
      raise exception 'El registro oficial del DNI está rechazado o requiere revisión administrativa.';
    end if;
  end if;

  update public.fefutin_club_roster_players
  set approval_status='aprobado',
      registry_player_id=v_registry_id,
      updated_at=now()
  where id=v_roster_player.id;

  if v_previous_status<>'habilitado' then
    insert into public.fefutin_player_status_history (
      player_entry_id,registry_player_id,roster_player_id,
      previous_status,new_status,reason,changed_by
    ) values (
      null,v_registry_id,v_roster_player.id,v_previous_status,'habilitado',
      case when v_charge_status='pagado'
        then 'Alta inicial habilitada por Admin/Directivo con fichaje saldado'
        else 'Alta inicial habilitada por excepción administrativa; deuda de fichaje conservada'
      end,
      auth.uid()
    );
  end if;

  return v_carnet;
end;
$function$;

create or replace function public.decide_fefutin_player_with_exception(
  p_player_entry_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_charge public.fefutin_player_charges%rowtype;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id=auth.uid();

  if not found
     or v_profile.role not in ('admin','directivo')
     or v_profile.approval_status<>'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo Admin o Directivo puede autorizar una aprobación excepcional';
  end if;

  if nullif(trim(p_reason),'') is null or length(trim(p_reason))<5 then
    raise exception 'Indicá un motivo de al menos 5 caracteres para la excepción';
  end if;

  select ch.* into v_charge
  from public.fefutin_player_charges ch
  join public.fefutin_club_roster_players rp on rp.id=ch.roster_player_id
  where rp.id=p_player_entry_id
    and rp.removed_at is null
  for update of ch;

  if not found then
    raise exception 'No se encontró el cargo de fichaje de este jugador';
  end if;

  if v_charge.status<>'pagado' then
    insert into public.fefutin_payment_exceptions(charge_id,authorized_by,reason)
    values (v_charge.id,auth.uid(),trim(p_reason))
    on conflict (charge_id) do update
      set authorized_by=excluded.authorized_by,
          reason=excluded.reason,
          authorized_at=now();
  end if;

  return public.decide_fefutin_player(p_player_entry_id,true);
end;
$function$;

revoke all on function public.decide_fefutin_player(uuid,boolean) from public,anon;
grant execute on function public.decide_fefutin_player(uuid,boolean) to authenticated;
revoke all on function public.decide_fefutin_player_with_exception(uuid,text) from public,anon;
grant execute on function public.decide_fefutin_player_with_exception(uuid,text) to authenticated;

commit;
