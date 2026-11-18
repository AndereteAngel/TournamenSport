-- FEFUTIN: los vinculos nuevos no deben impedir preservar archivos historicos.
begin;

-- Una ronda pertenece a su jornada compartida; si esa jornada se elimina,
-- se eliminan sus rondas y partidos operativos en cascada.
alter table public.fefutin_rounds
  drop constraint if exists fefutin_rounds_turn_journey_id_fkey;

alter table public.fefutin_rounds
  add constraint fefutin_rounds_turn_journey_id_fkey
  foreign key (turn_journey_id)
  references public.fefutin_turn_journeys(id)
  on delete cascade;

-- Las planillas digitales generales sobreviven a la baja de una competencia.
alter table public.fefutin_jornada_sheets
  drop constraint if exists fefutin_jornada_sheets_turn_id_fkey,
  drop constraint if exists fefutin_jornada_sheets_turn_journey_id_fkey;

alter table public.fefutin_jornada_sheets
  add constraint fefutin_jornada_sheets_turn_id_fkey
    foreign key (turn_id) references public.fefutin_tournament_turns(id) on delete set null,
  add constraint fefutin_jornada_sheets_turn_journey_id_fkey
    foreign key (turn_journey_id) references public.fefutin_turn_journeys(id) on delete set null;

-- Las planillas individuales conservan su texto, jugadores y fotos aunque
-- se elimine el partido normalizado al que estaban vinculadas.
alter table public.fefutin_match_sheets
  drop constraint if exists fefutin_match_sheets_normalized_match_id_fkey,
  drop constraint if exists fefutin_match_sheets_turn_id_fkey,
  drop constraint if exists fefutin_match_sheets_tournament_category_id_fkey;

alter table public.fefutin_match_sheets
  add constraint fefutin_match_sheets_normalized_match_id_fkey
    foreign key (normalized_match_id) references public.fefutin_matches(id) on delete set null,
  add constraint fefutin_match_sheets_turn_id_fkey
    foreign key (turn_id) references public.fefutin_tournament_turns(id) on delete set null,
  add constraint fefutin_match_sheets_tournament_category_id_fkey
    foreign key (tournament_category_id) references public.fefutin_tournament_categories(id) on delete set null;

commit;
