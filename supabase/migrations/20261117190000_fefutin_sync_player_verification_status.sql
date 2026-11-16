-- FEFUTIN: compatibilidad del estado de verificación del carnet.
-- La interfaz y las RPC vigentes consultan verification_status, mientras que
-- instalaciones anteriores solo tenían carnet_status. Se sincronizan ambos
-- campos para conservar compatibilidad sin alterar carnets ni historiales.

begin;

alter table public.fefutin_players
  add column if not exists verification_status text;

update public.fefutin_players
set verification_status = coalesce(verification_status, carnet_status, 'pendiente')
where verification_status is null;

create or replace function public.sync_fefutin_player_verification_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.verification_status := coalesce(new.verification_status, new.carnet_status, 'pendiente');
    new.carnet_status := new.verification_status;
  elsif new.verification_status is distinct from old.verification_status then
    new.carnet_status := new.verification_status;
  elsif new.carnet_status is distinct from old.carnet_status then
    new.verification_status := new.carnet_status;
  else
    new.verification_status := coalesce(new.verification_status, new.carnet_status, 'pendiente');
    new.carnet_status := new.verification_status;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_sync_fefutin_player_verification_status
  on public.fefutin_players;

create trigger trg_sync_fefutin_player_verification_status
before insert or update of carnet_status, verification_status
on public.fefutin_players
for each row
execute function public.sync_fefutin_player_verification_status();

commit;
