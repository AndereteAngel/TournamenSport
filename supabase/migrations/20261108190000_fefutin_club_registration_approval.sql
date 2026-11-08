-- FEFUTIN: envío y aprobación de inscripciones institucionales.
-- Reutiliza fefutin_clubs y profiles.club_id existentes.
-- Los referentes no pueden autoaprobarse ni escribir directamente en las tablas.

begin;

create table if not exists public.fefutin_club_tournaments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.fefutin_clubs(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  category_label text not null,
  created_at timestamptz not null default now(),
  constraint fefutin_club_tournaments_unique unique (club_id, tournament_id),
  constraint fefutin_club_tournaments_category_not_empty check (char_length(trim(category_label)) > 0)
);

alter table public.fefutin_club_tournaments enable row level security;
revoke all on public.fefutin_club_tournaments from anon, public, authenticated;
grant select on public.fefutin_club_tournaments to authenticated;

drop policy if exists "fefutin_club_tournaments_select_authorized" on public.fefutin_club_tournaments;
create policy "fefutin_club_tournaments_select_authorized"
  on public.fefutin_club_tournaments for select to authenticated
  using (
    exists (
      select 1
      from public.fefutin_clubs c
      where c.id = club_id
        and (
          c.referente_user_id = auth.uid()
          or public.fefutin_is_manager()
        )
    )
  );

-- Los escudos son públicos para poder mostrarlos en la plataforma.
-- Solo el usuario dueño de la carpeta puede subir o borrar sus archivos.
insert into storage.buckets (id, name, public)
values ('fefutin-clubs', 'fefutin-clubs', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "fefutin_club_logos_public_read" on storage.objects;
create policy "fefutin_club_logos_public_read"
  on storage.objects for select to public
  using (bucket_id = 'fefutin-clubs');

drop policy if exists "fefutin_club_logos_upload_own" on storage.objects;
create policy "fefutin_club_logos_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fefutin-clubs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "fefutin_club_logos_delete_own" on storage.objects;
create policy "fefutin_club_logos_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'fefutin-clubs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.submit_fefutin_club_registration(
  p_name text,
  p_headquarters_address text,
  p_logo_path text,
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
    name, headquarters_address, logo_path, referente_user_id, is_active
  )
  values (
    trim(p_name), trim(p_headquarters_address), p_logo_path, v_user_id, false
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

revoke all on function public.submit_fefutin_club_registration(text, text, text, jsonb) from public, anon;
grant execute on function public.submit_fefutin_club_registration(text, text, text, jsonb) to authenticated;

-- Al aprobar o desestimar el perfil, se activa o mantiene inactivo el club.
create or replace function public.sync_fefutin_club_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requested_role = 'referente'
     and new.approval_status is distinct from old.approval_status then
    update public.fefutin_clubs
    set is_active = (new.approval_status = 'aprobado')
    where referente_user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_fefutin_club_approval on public.profiles;
create trigger trg_sync_fefutin_club_approval
after update of approval_status on public.profiles
for each row
execute function public.sync_fefutin_club_approval();

-- La bandeja de solicitudes existente ahora incluye los datos de la institución.
drop function if exists public.get_fefutin_pending_requests();

create function public.get_fefutin_pending_requests()
returns table (
  id uuid,
  username text,
  email text,
  requested_role text,
  created_at timestamptz,
  club_name text,
  headquarters_address text,
  logo_path text,
  selected_tournaments jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
begin
  select p.role
    into v_actor_role
  from public.profiles p
  where p.id = auth.uid()
    and p.approval_status = 'aprobado'
    and p.deactivated_at is null;

  if coalesce(v_actor_role, '') not in ('admin', 'directivo') then
    raise exception 'No tenés permisos para consultar solicitudes';
  end if;

  return query
  select
    p.id,
    p.username,
    p.email,
    p.requested_role,
    coalesce(c.created_at, p.created_at),
    c.name,
    c.headquarters_address,
    c.logo_path,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title', t.title,
          'category_label', ct.category_label
        )
        order by t.title
      )
      from public.fefutin_club_tournaments ct
      join public.tournaments t on t.id = ct.tournament_id
      where ct.club_id = c.id
    ), '[]'::jsonb)
  from public.profiles p
  left join public.fefutin_clubs c on c.referente_user_id = p.id
  where p.approval_status = 'pendiente'
    and p.requested_role in ('directivo', 'arbitro', 'referente')
    and (v_actor_role = 'admin' or p.requested_role in ('arbitro', 'referente'))
  order by coalesce(c.created_at, p.created_at) asc;
end;
$$;

revoke all on function public.get_fefutin_pending_requests() from public, anon;
grant execute on function public.get_fefutin_pending_requests() to authenticated;

commit;
