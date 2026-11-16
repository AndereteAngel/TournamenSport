-- FEFUTIN: permite al referente consultar exclusivamente los DNI de su propio club.
-- Los documentos siguen en un bucket privado y no se habilita acceso anonimo/publico.

begin;

drop policy if exists "fefutin_player_dni_read_authorized" on storage.objects;
create policy "fefutin_player_dni_read_authorized"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fefutin-player-dni'
    and (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role in ('admin', 'directivo')
          and p.approval_status = 'aprobado'
          and p.deactivated_at is null
      )
      or exists (
        select 1
        from public.profiles p
        join public.fefutin_clubs c on c.id = p.club_id
        join public.fefutin_club_rosters cr on cr.club_id = c.id
        join public.fefutin_club_roster_players rp on rp.roster_id = cr.id
        where p.id = auth.uid()
          and p.role = 'referente'
          and p.approval_status = 'aprobado'
          and p.deactivated_at is null
          and c.id = p.club_id
          and c.referente_user_id = auth.uid()
          and c.is_active = true
          and rp.removed_at is null
          and (rp.dni_front_path = storage.objects.name or rp.dni_back_path = storage.objects.name)
      )
    )
  );

create or replace function public.get_fefutin_player_dni_documents(
  p_player_entry_id uuid
)
returns table (dni_front_path text, dni_back_path text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_front text;
  v_back text;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Tu usuario no está habilitado para consultar documentos de identidad';
  end if;

  if v_profile.role in ('admin', 'directivo') then
    select rp.dni_front_path, rp.dni_back_path
      into v_front, v_back
    from public.fefutin_club_roster_players rp
    where rp.id = p_player_entry_id
      and rp.removed_at is null;
  elsif v_profile.role = 'referente' and v_profile.club_id is not null then
    select rp.dni_front_path, rp.dni_back_path
      into v_front, v_back
    from public.fefutin_club_roster_players rp
    join public.fefutin_club_rosters cr on cr.id = rp.roster_id
    join public.fefutin_clubs c on c.id = cr.club_id
    where rp.id = p_player_entry_id
      and rp.removed_at is null
      and c.id = v_profile.club_id
      and c.referente_user_id = auth.uid()
      and c.is_active = true;
  else
    raise exception 'Solo el referente del club, Admin o Directivo habilitado puede consultar documentos de identidad';
  end if;

  if not found then
    raise exception 'No tenés autorización para consultar el DNI de este jugador';
  end if;

  return query select v_front, v_back;
end;
$function$;

revoke all on function public.get_fefutin_player_dni_documents(uuid) from public, anon;
grant execute on function public.get_fefutin_player_dni_documents(uuid) to authenticated;

commit;
