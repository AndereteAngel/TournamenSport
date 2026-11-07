-- Permite eliminar torneos únicamente a usuarios con rol admin o directivo.
-- La autorización se verifica en la base de datos mediante el perfil autenticado.

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournaments_delete_admin_directivo
ON public.tournaments;

CREATE POLICY tournaments_delete_admin_directivo
ON public.tournaments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.role IN ('admin', 'directivo')
      AND profile.deactivated_at IS NULL
  )
);
