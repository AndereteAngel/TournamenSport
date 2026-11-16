-- FEFUTIN: asegurar que la RPC autorizada pueda eliminar planillas cerradas.
-- La protección sigue activa para cualquier operación normal de INSERT/UPDATE/DELETE.
-- La excepción solo existe durante delete_fefutin_tournament(), que valida Admin/Directivo.
begin;

create or replace function public.prevent_closed_fefutin_match_sheet_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sheet_status text;
begin
  -- La RPC establece esta marca antes de borrar datos del torneo.
  -- Se comprueba antes de consultar la planilla, porque puede estar en proceso
  -- de eliminación y no debe bloquearse a sí misma.
  if tg_op = 'DELETE'
     and coalesce(current_setting('app.fefutin_tournament_delete', true), '') = 'authorized' then
    return old;
  end if;

  if tg_table_name = 'fefutin_match_sheets' then
    if lower(trim(coalesce(old.estado, ''))) in ('cerrada', 'cerrado') then
      raise exception 'La planilla esta cerrada y no admite modificaciones.';
    end if;

    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select lower(trim(coalesce(s.estado, '')))
      into v_sheet_status
    from public.fefutin_match_sheets s
    where s.id = old.match_sheet_id;

    if v_sheet_status in ('cerrada', 'cerrado') then
      raise exception 'La planilla esta cerrada y sus jugadores no pueden modificarse.';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select lower(trim(coalesce(s.estado, '')))
      into v_sheet_status
    from public.fefutin_match_sheets s
    where s.id = new.match_sheet_id;

    if v_sheet_status in ('cerrada', 'cerrado') then
      raise exception 'La planilla esta cerrada y sus jugadores no pueden modificarse.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

-- Reasociar explícitamente los triggers a la versión actual de la función.
drop trigger if exists fefutin_match_sheets_immutable_after_close
  on public.fefutin_match_sheets;
create trigger fefutin_match_sheets_immutable_after_close
before update or delete on public.fefutin_match_sheets
for each row
execute function public.prevent_closed_fefutin_match_sheet_changes();

drop trigger if exists fefutin_match_sheet_players_immutable_after_close
  on public.fefutin_match_sheet_players;
create trigger fefutin_match_sheet_players_immutable_after_close
before insert or update or delete on public.fefutin_match_sheet_players
for each row
execute function public.prevent_closed_fefutin_match_sheet_changes();

commit;
