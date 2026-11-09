-- FEFUTIN: datos ampliados de la institución para su ficha y carnet.
begin;

alter table public.fefutin_clubs
  add column if not exists court_type text,
  add column if not exists referente_phone text;

-- Nueva versión del registro: incorpora tipo de cancha y teléfono del referente.
create or replace function public.submit_fefutin_club_registration(
  p_name text,
  p_headquarters_address text,
  p_logo_path text,
  p_court_type text,
  p_referente_phone text,
  p_tournaments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_club_id uuid;
  v_item jsonb;
  v_tournament_id uuid;
  v_category_label text;
begin
  if v_user_id is null then
    raise exception 'Tenés que iniciar sesión para enviar la inscripción';
  end if;

  select p.*
    into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;

  if not found
     or v_profile.role <> 'referente'
     or v_profile.approval_status <> 'aprobado'
     or v_profile.deactivated_at is not null then
    raise exception 'Solo un referente habilitado puede enviar la inscripción del club';
  end if;

  if v_profile.club_id is not null then
    raise exception 'Tu cuenta ya tiene un club asociado';
  end if;

  if nullif(trim(p_name), '') is null
     or char_length(trim(p_name)) > 100 then
    raise exception 'Ingresá un nombre de club válido';
  end if;

  if nullif(trim(p_headquarters_address), '') is null
     or char_length(trim(p_headquarters_address)) > 200 then
    raise exception 'Ingresá un domicilio válido';
  end if;

  if nullif(trim(p_logo_path), '') is null
     or split_part(p_logo_path, '/', 1) <> v_user_id::text
     or not exists (
       select 1
       from storage.objects o
       where o.bucket_id = 'fefutin-clubs'
         and o.name = p_logo_path
     ) then
    raise exception 'No se encontró el escudo del club subido a tu carpeta';
  end if;

  if coalesce(jsonb_typeof(p_tournaments), '') <> 'array'
     or jsonb_array_length(p_tournaments) = 0 then
    raise exception 'Seleccioná al menos un torneo';
  end if;

  insert into public.fefutin_clubs (
    name, headquarters_address, logo_path, court_type, referente_phone, referente_user_id, is_active
  )
  values (
    trim(p_name), trim(p_headquarters_address), p_logo_path,
    nullif(trim(p_court_type), ''), nullif(trim(p_referente_phone), ''), v_user_id, false
  )
  returning id into v_club_id;

  for v_item in
    select value from jsonb_array_elements(p_tournaments)
  loop
    v_tournament_id := nullif(v_item ->> 'tournament_id', '')::uuid;
    v_category_label := nullif(trim(v_item ->> 'category_label'), '');

    if v_tournament_id is null or v_category_label is null then
      raise exception 'Hay una selección de torneo o categoría incompleta';
    end if;

    if not exists (
      select 1 from public.tournaments t where t.id = v_tournament_id
    ) then
      raise exception 'Uno de los torneos seleccionados ya no existe';
    end if;

    insert into public.fefutin_club_tournaments (
      club_id, tournament_id, category_label
    )
    values (v_club_id, v_tournament_id, v_category_label);
  end loop;

  update public.profiles
  set club_id = v_club_id,
      role = 'visitante',
      requested_role = 'referente',
      approval_status = 'pendiente',
      approved_by = null,
      approved_at = null
  where id = v_user_id;

  return v_club_id;
end;
$$;

revoke all on function public.submit_fefutin_club_registration(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.submit_fefutin_club_registration(text, text, text, text, text, jsonb) to authenticated;

-- La ficha del club entrega también sus datos institucionales y de contacto.
drop function if exists public.get_fefutin_my_teams();
create or replace function public.get_fefutin_my_teams()
returns table (
  club_id uuid,
  club_name text,
  affiliate_number text,
  headquarters_address text,
  logo_path text,
  court_type text,
  referente_name text,
  referente_email text,
  referente_phone text,
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
    c.court_type,
    p.username,
    p.email,
    c.referente_phone,
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
  join public.profiles p on p.id = c.referente_user_id
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
