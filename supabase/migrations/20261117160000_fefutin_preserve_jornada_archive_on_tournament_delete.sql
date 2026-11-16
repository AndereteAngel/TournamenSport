-- FEFUTIN: conservar el archivo de jornadas al eliminar un torneo.
-- La planilla cerrada contiene su propio título, equipos, resultados y detalles.
-- Al eliminar el torneo, se conserva el archivo y se desvincula su FK directa.
begin;

alter table public.fefutin_jornada_sheets
  alter column tournament_id drop not null;

alter table public.fefutin_jornada_sheets
  drop constraint if exists fefutin_jornada_sheets_tournament_id_fkey;

alter table public.fefutin_jornada_sheets
  add constraint fefutin_jornada_sheets_tournament_id_fkey
  foreign key (tournament_id)
  references public.tournaments(id)
  on delete set null;

commit;
