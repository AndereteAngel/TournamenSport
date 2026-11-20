-- FEFUTIN: la planilla respeta el estado aprobado del padron permanente.
-- La participacion por categoria habilita al club; no debe volver a poner
-- pendiente a un jugador que ya fue aprobado en Mi club / Lista de buena fe.
begin;

do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_replacements integer;
begin
  select pg_get_functiondef(
    'public.get_fefutin_match_sheet_roster(uuid)'::regprocedure
  )
  into v_definition;

  v_updated_definition := replace(
    v_definition,
    'coalesce(ccp.status, ''aprobado'')',
    '''aprobado'''
  );

  v_replacements :=
    (length(v_definition) - length(v_updated_definition))
    / length('coalesce(ccp.status, ''aprobado'')');

  if v_replacements <> 2 then
    raise exception
      'Se esperaba corregir las dos listas de la planilla (local y visitante); reemplazos encontrados: %',
      v_replacements;
  end if;

  execute v_updated_definition;
end;
$migration$;

commit;
