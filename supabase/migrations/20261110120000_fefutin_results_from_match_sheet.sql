-- FEFUTIN: el resultado del fixture se calcula desde los goles de la planilla
-- y se publica en el mismo cierre que bloquea la planilla.
begin;

create or replace function public.referee_close_match_from_sheet(
  p_tournament_id uuid,
  p_phase text,
  p_match_id text,
  p_group_index integer default null,
  p_round_index integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tournament public.tournaments%rowtype;
  v_sheet public.fefutin_match_sheets%rowtype;
  v_groups jsonb;
  v_rounds jsonb;
  v_matches jsonb;
  v_match jsonb;
  v_match_index integer;
  v_score1 integer := 0;
  v_score2 integer := 0;
  v_local_count integer := 0;
  v_visitor_count integer := 0;
  v_winner text;
begin
  if auth.uid() is null or not public.has_fefutin_role(array['arbitro']) then
    raise exception 'Se requiere un arbitro aprobado y activo.';
  end if;

  if p_match_id is null or length(trim(p_match_id)) = 0 then
    raise exception 'Identificador de partido invalido.';
  end if;

  select t.* into v_tournament
  from public.tournaments t
  where t.id = p_tournament_id
  for update;

  if not found then
    raise exception 'No se encontro el torneo.';
  end if;

  if lower(trim(coalesce(v_tournament.status, ''))) = 'finalizado' then
    raise exception 'El torneo esta finalizado.';
  end if;

  if p_phase = 'groups' then
    if p_group_index is null or p_group_index < 0 then
      raise exception 'Indice de grupo invalido.';
    end if;

    v_groups := coalesce(v_tournament.groups, '[]'::jsonb);
    if jsonb_typeof(v_groups) <> 'array' or p_group_index >= jsonb_array_length(v_groups) then
      raise exception 'No se encontro el grupo.';
    end if;

    v_matches := v_groups -> p_group_index -> 'matches';
    if jsonb_typeof(v_matches) <> 'array' then
      raise exception 'Lista de partidos invalida.';
    end if;

    select (e.ordinality - 1)::integer into v_match_index
    from jsonb_array_elements(v_matches) with ordinality as e(value, ordinality)
    where e.value ->> 'id' = p_match_id
    limit 1;

    if v_match_index is null then
      raise exception 'No se encontro el partido.';
    end if;

    v_match := v_matches -> v_match_index;

  elsif p_phase = 'playoffs' then
    if p_round_index is null or p_round_index < 0 then
      raise exception 'Indice de ronda invalido.';
    end if;

    v_rounds := coalesce(v_tournament.playoffs, '[]'::jsonb);
    if jsonb_typeof(v_rounds) <> 'array' or p_round_index >= jsonb_array_length(v_rounds) then
      raise exception 'No se encontro la ronda.';
    end if;

    v_matches := v_rounds -> p_round_index;
    if jsonb_typeof(v_matches) <> 'array' then
      raise exception 'Lista de partidos invalida.';
    end if;

    select (e.ordinality - 1)::integer into v_match_index
    from jsonb_array_elements(v_matches) with ordinality as e(value, ordinality)
    where e.value ->> 'id' = p_match_id
    limit 1;

    if v_match_index is null then
      raise exception 'No se encontro el partido.';
    end if;

    v_match := v_matches -> v_match_index;

  else
    raise exception 'Fase de torneo invalida.';
  end if;

  if v_match ->> 'referee_id' is distinct from auth.uid()::text then
    raise exception 'Este partido no esta designado a tu usuario.';
  end if;

  if coalesce((v_match ->> 'referee_closed')::boolean, false) then
    raise exception 'El partido ya estaba cerrado y no admite modificaciones.';
  end if;

  select s.* into v_sheet
  from public.fefutin_match_sheets s
  where s.tournament_id = p_tournament_id
    and s.match_id = p_match_id
  for update;

  if not found then
    raise exception 'Primero tenes que guardar la planilla oficial.';
  end if;

  if lower(trim(coalesce(v_sheet.estado, ''))) in ('cerrada', 'cerrado') then
    raise exception 'La planilla ya esta cerrada.';
  end if;

  if lower(trim(coalesce(v_sheet.club_local, ''))) <> lower(trim(coalesce(v_match ->> 'team1', '')))
     or lower(trim(coalesce(v_sheet.club_visitante, ''))) <> lower(trim(coalesce(v_match ->> 'team2', ''))) then
    raise exception 'Los clubes de la planilla no coinciden con los del fixture.';
  end if;

  select count(*)::integer, coalesce(sum(p.goles), 0)::integer
  into v_local_count, v_score1
  from public.fefutin_match_sheet_players p
  where p.match_sheet_id = v_sheet.id
    and lower(trim(coalesce(p.club, ''))) = lower(trim(coalesce(v_match ->> 'team1', '')));

  select count(*)::integer, coalesce(sum(p.goles), 0)::integer
  into v_visitor_count, v_score2
  from public.fefutin_match_sheet_players p
  where p.match_sheet_id = v_sheet.id
    and lower(trim(coalesce(p.club, ''))) = lower(trim(coalesce(v_match ->> 'team2', '')));

  if v_local_count = 0 or v_visitor_count = 0 then
    raise exception 'La planilla debe incluir jugadores de ambos clubes.';
  end if;

  if p_phase = 'groups' then
    v_match := v_match || jsonb_build_object(
      'score1', v_score1,
      'score2', v_score2,
      'referee_closed', true,
      'referee_closed_at', now(),
      'referee_closed_by', auth.uid(),
      'result_loaded_at', now()
    );

    v_groups := jsonb_set(
      v_groups,
      array[p_group_index::text, 'matches', v_match_index::text],
      v_match,
      false
    );

    update public.tournaments
    set groups = v_groups
    where id = p_tournament_id
    returning * into v_tournament;

  else
    if v_score1 > v_score2 then
      v_winner := v_match ->> 'team1';
    elsif v_score2 > v_score1 then
      v_winner := v_match ->> 'team2';
    else
      v_winner := 'Empate (Definir)';
    end if;

    v_match := v_match || jsonb_build_object(
      'score1', v_score1,
      'score2', v_score2,
      'winner', v_winner,
      'referee_closed', true,
      'referee_closed_at', now(),
      'referee_closed_by', auth.uid(),
      'result_loaded_at', now()
    );

    v_rounds := jsonb_set(
      v_rounds,
      array[p_round_index::text, v_match_index::text],
      v_match,
      false
    );

    update public.tournaments
    set playoffs = v_rounds
    where id = p_tournament_id
    returning * into v_tournament;
  end if;

  update public.fefutin_match_sheets
  set estado = 'cerrada',
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_sheet.id;

  return to_jsonb(v_tournament);
end;
$function$;

revoke all on function public.referee_close_match_from_sheet(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.referee_close_match_from_sheet(uuid, text, text, integer, integer) to authenticated;

-- Las funciones anteriores permitian escribir un marcador separado del cierre.
-- Se retiran sus permisos para que el resultado solo se publique desde la planilla.
revoke all on function public.referee_update_match_result(uuid, text, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.referee_close_match(uuid, text, text, integer, integer) from public, anon, authenticated;

create or replace function public.prevent_closed_fefutin_match_sheet_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sheet_id uuid;
  v_sheet_status text;
begin
  if tg_table_name = 'fefutin_match_sheets' then
    if lower(trim(coalesce(old.estado, ''))) in ('cerrada', 'cerrado') then
      raise exception 'La planilla esta cerrada y no admite modificaciones.';
    end if;

    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_sheet_id := old.match_sheet_id;
  else
    v_sheet_id := new.match_sheet_id;
  end if;

  select lower(trim(coalesce(s.estado, '')))
  into v_sheet_status
  from public.fefutin_match_sheets s
  where s.id = v_sheet_id;

  if v_sheet_status in ('cerrada', 'cerrado') then
    raise exception 'La planilla esta cerrada y sus jugadores no pueden modificarse.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists fefutin_match_sheets_immutable_after_close on public.fefutin_match_sheets;
create trigger fefutin_match_sheets_immutable_after_close
before update or delete on public.fefutin_match_sheets
for each row execute function public.prevent_closed_fefutin_match_sheet_changes();

drop trigger if exists fefutin_match_sheet_players_immutable_after_close on public.fefutin_match_sheet_players;
create trigger fefutin_match_sheet_players_immutable_after_close
before insert or update or delete on public.fefutin_match_sheet_players
for each row execute function public.prevent_closed_fefutin_match_sheet_changes();

commit;
