-- FEFUTIN: carga y correccion de resultados por arbitros aprobados.
-- La funcion solo modifica el marcador del partido indicado.
begin;

create or replace function public.referee_update_match_result(
  p_tournament_id uuid,
  p_phase text,
  p_match_id text,
  p_score1 integer,
  p_score2 integer,
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
  v_groups jsonb;
  v_rounds jsonb;
  v_matches jsonb;
  v_match jsonb;
  v_match_index integer;
  v_winner text;
begin
  if auth.uid() is null
     or not public.has_fefutin_role(array['arbitro']) then
    raise exception 'Se requiere un arbitro aprobado y activo.';
  end if;

  if p_match_id is null or length(trim(p_match_id)) = 0 then
    raise exception 'Identificador de partido invalido.';
  end if;

  if (p_score1 is not null and p_score1 < 0)
     or (p_score2 is not null and p_score2 < 0) then
    raise exception 'Los goles no pueden ser negativos.';
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
    if jsonb_typeof(v_groups) <> 'array'
       or p_group_index >= jsonb_array_length(v_groups) then
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
    v_match := v_match || jsonb_build_object(
      'score1', p_score1,
      'score2', p_score2,
      'referee_id', auth.uid()
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

  elsif p_phase = 'playoffs' then
    if p_round_index is null or p_round_index < 0 then
      raise exception 'Indice de ronda invalido.';
    end if;

    v_rounds := coalesce(v_tournament.playoffs, '[]'::jsonb);
    if jsonb_typeof(v_rounds) <> 'array'
       or p_round_index >= jsonb_array_length(v_rounds) then
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

    if p_score1 is null or p_score2 is null then
      v_winner := null;
    elsif p_score1 > p_score2 then
      v_winner := v_match ->> 'team1';
    elsif p_score2 > p_score1 then
      v_winner := v_match ->> 'team2';
    else
      v_winner := 'Empate (Definir)';
    end if;

    v_match := v_match || jsonb_build_object(
      'score1', p_score1,
      'score2', p_score2,
      'winner', v_winner,
      'referee_id', auth.uid()
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

  else
    raise exception 'Fase de torneo invalida.';
  end if;

  return to_jsonb(v_tournament);
end;
$function$;

revoke all on function public.referee_update_match_result(uuid, text, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.referee_update_match_result(uuid, text, text, integer, integer, integer, integer) to authenticated;

commit;