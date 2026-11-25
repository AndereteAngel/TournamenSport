-- Mercado Pago Checkout Pro using the current Orders API.
begin;

alter table public.fefutin_payments
  add column if not exists provider_order_id text,
  add column if not exists provider_idempotency_key uuid;

create unique index if not exists fefutin_payments_provider_order_id_uidx
  on public.fefutin_payments(provider_order_id)
  where provider_order_id is not null;

create or replace function public.begin_fefutin_payment(
  p_user_id uuid,
  p_charge_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_payment_id uuid;
  v_external_reference text;
  v_idempotency_key uuid := gen_random_uuid();
  v_total numeric(12,2);
  v_count integer;
  v_items jsonb;
begin
  if p_user_id is null or p_charge_ids is null
     or cardinality(p_charge_ids) < 1 or cardinality(p_charge_ids) > 50 then
    raise exception 'Seleccioná entre 1 y 50 fichajes pendientes';
  end if;

  if (select count(distinct x) from unnest(p_charge_ids) x) <> cardinality(p_charge_ids) then
    raise exception 'La selección contiene cargos duplicados';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id
  for share;

  if not found or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null
     or v_profile.club_id is null then
    raise exception 'Solo un referente activo y aprobado puede iniciar pagos de su club';
  end if;

  perform ch.id
  from public.fefutin_player_charges ch
  where ch.id = any(p_charge_ids)
  order by ch.id
  for update;

  select count(*), coalesce(sum(ch.amount),0)
  into v_count, v_total
  from public.fefutin_player_charges ch
  where ch.id = any(p_charge_ids)
    and ch.club_id = v_profile.club_id
    and ch.status = 'pendiente';

  if v_count <> cardinality(p_charge_ids) or v_total <= 0 then
    raise exception 'Uno o más cargos ya no están pendientes o no pertenecen a tu club';
  end if;

  if exists (
    select 1
    from public.fefutin_payment_items pi
    join public.fefutin_payments pay on pay.id = pi.payment_id
    where pi.charge_id = any(p_charge_ids)
      and pay.status = 'pending'
      and pay.initiated_at > now() - interval '26 hours'
  ) then
    raise exception 'Hay un pago en proceso para uno o más jugadores. Actualizá el estado antes de generar otro intento';
  end if;

  v_payment_id := gen_random_uuid();
  v_external_reference := 'FEFUTIN-' || v_payment_id::text;

  insert into public.fefutin_payments (
    id, status, amount, currency, external_reference,
    provider_idempotency_key, payer_user_id, metadata
  ) values (
    v_payment_id, 'pending', v_total, 'ARS', v_external_reference,
    v_idempotency_key, p_user_id,
    jsonb_build_object('flow','player_fichaje','charge_count',v_count)
  );

  insert into public.fefutin_payment_items(payment_id,charge_id,amount)
  select v_payment_id,ch.id,ch.amount
  from public.fefutin_player_charges ch
  where ch.id = any(p_charge_ids);

  select jsonb_agg(
    jsonb_build_object(
      'title', left(ch.concept_name || ' - ' || trim(coalesce(rp.first_name,'') || ' ' || coalesce(rp.last_name,'')), 250),
      'quantity', 1,
      'unit_price', round(ch.amount,2)::text
    ) order by rp.last_name,rp.first_name
  )
  into v_items
  from public.fefutin_payment_items pi
  join public.fefutin_player_charges ch on ch.id=pi.charge_id
  join public.fefutin_club_roster_players rp on rp.id=ch.roster_player_id
  where pi.payment_id=v_payment_id;

  return jsonb_build_object(
    'payment_id',v_payment_id,
    'external_reference',v_external_reference,
    'idempotency_key',v_idempotency_key,
    'amount',round(v_total,2)::text,
    'currency','ARS',
    'items',coalesce(v_items,'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.begin_fefutin_payment(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.begin_fefutin_payment(uuid,uuid[]) to service_role;

create or replace function public.apply_fefutin_payment_order_update(
  p_order_id text,
  p_external_reference text,
  p_order_status text,
  p_status_detail text,
  p_order_total_amount numeric,
  p_total_paid_amount numeric,
  p_currency text,
  p_provider_payment_id text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.fefutin_payments%rowtype;
begin
  select * into v_payment
  from public.fefutin_payments
  where provider_order_id = p_order_id
  for update;

  if not found then
    return 'NOT_FOUND';
  end if;

  if p_external_reference is distinct from v_payment.external_reference
     or round(coalesce(p_order_total_amount,0),2) <> round(v_payment.amount,2)
     or (p_currency is not null and p_currency <> v_payment.currency) then
    raise exception 'La orden de Mercado Pago no coincide con el importe o la referencia local';
  end if;

  if p_order_status = 'processed'
     and p_status_detail = 'accredited'
     and round(coalesce(p_total_paid_amount,0),2) >= round(v_payment.amount,2) then

    if exists (
      select 1
      from public.fefutin_payment_items pi
      join public.fefutin_payment_items other_item on other_item.charge_id=pi.charge_id
      join public.fefutin_payments other_pay on other_pay.id=other_item.payment_id
      where pi.payment_id=v_payment.id
        and other_pay.id <> v_payment.id
        and other_pay.status='approved'
    ) then
      raise exception 'El cargo ya fue acreditado mediante otra operación';
    end if;

    update public.fefutin_payments
    set status='approved',
        provider_payment_id=coalesce(p_provider_payment_id,provider_payment_id),
        provider_status=p_order_status,
        provider_status_detail=p_status_detail,
        paid_at=coalesce(paid_at,now()),
        webhook_received_at=now(),
        updated_at=now()
    where id=v_payment.id;

    update public.fefutin_player_charges ch
    set status='pagado',paid_at=coalesce(ch.paid_at,now()),updated_at=now()
    from public.fefutin_payment_items pi
    where pi.payment_id=v_payment.id and pi.charge_id=ch.id;

    return 'APPROVED';
  elsif p_order_status in ('canceled','failed') then
    update public.fefutin_payments
    set status=case when p_order_status='canceled' then 'cancelled' else 'rejected' end,
        provider_status=p_order_status,
        provider_status_detail=p_status_detail,
        webhook_received_at=now(),
        updated_at=now()
    where id=v_payment.id;
    return 'NOT_PAID';
  elsif p_order_status in ('refunded','charged_back')
     or (p_order_status='processed' and p_status_detail='partially_refunded') then
    update public.fefutin_payments
    set status='refunded',
        provider_status=p_order_status,
        provider_status_detail=p_status_detail,
        webhook_received_at=now(),
        updated_at=now()
    where id=v_payment.id;

    update public.fefutin_player_charges ch
    set status=case when exists (
          select 1
          from public.fefutin_payment_items other_item
          join public.fefutin_payments other_pay on other_pay.id=other_item.payment_id
          where other_item.charge_id=ch.id
            and other_pay.id<>v_payment.id
            and other_pay.status='approved'
        ) then 'pagado' else 'pendiente' end,
        paid_at=case when exists (
          select 1
          from public.fefutin_payment_items other_item
          join public.fefutin_payments other_pay on other_pay.id=other_item.payment_id
          where other_item.charge_id=ch.id
            and other_pay.id<>v_payment.id
            and other_pay.status='approved'
        ) then ch.paid_at else null end,
        updated_at=now()
    from public.fefutin_payment_items pi
    where pi.payment_id=v_payment.id and pi.charge_id=ch.id;
    return 'REFUNDED';
  else
    update public.fefutin_payments
    set provider_status=p_order_status,
        provider_status_detail=p_status_detail,
        webhook_received_at=now(),
        updated_at=now()
    where id=v_payment.id;
    return 'PENDING';
  end if;
end;
$function$;

revoke all on function public.apply_fefutin_payment_order_update(text,text,text,text,numeric,numeric,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_fefutin_payment_order_update(text,text,text,text,numeric,numeric,text,text)
  to service_role;

commit;
