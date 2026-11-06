begin;

-- Los visitantes también pueden consultar cualquier torneo y sus resultados.
-- Esta política es exclusivamente de lectura: no habilita INSERT, UPDATE ni DELETE.
drop policy if exists tournaments_select_public_visitors on public.tournaments;

create policy tournaments_select_public_visitors
on public.tournaments
for select
to anon, authenticated
using (true);

commit;
