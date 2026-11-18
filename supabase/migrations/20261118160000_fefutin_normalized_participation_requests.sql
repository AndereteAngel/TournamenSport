-- FEFUTIN: migracion historica reubicada.
-- Esta fecha precede al esquema normalizado y no debe crear funciones que dependan
-- de tablas todavia inexistentes. La implementacion vigente y dependiente del turno
-- se instala en 20261120130000_fefutin_turn_scoped_participation_requests.sql.
-- Se conserva este archivo para no alterar el historial de migraciones ya aplicado.
begin;
commit;
