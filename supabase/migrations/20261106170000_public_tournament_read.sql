begin;

-- Permite consultar torneos públicos desde cuentas visitante y sesiones anónimas.
-- No concede INSERT, UPDATE ni DELETE: la carga y gestión de resultados conserva
-- las políticas y validaciones existentes.
drop policy if exists tournaments_select_public_visitors on public.tournaments;

create policy tournaments_select_public_visitors
on public.tournaments
for select
to anon, authenticated
using (coalesce(is_public, false) = true);

commit;
