-- =====================================================================
-- Fix: INSERT-Policy auf fibu_mandanten blockiert wegen RLS-Subquery
-- auf fibu_user_mandant_access ohne SECURITY DEFINER.
-- =====================================================================

-- Hilfsfunktionen (SECURITY DEFINER → RLS wird umgangen)
CREATE OR REPLACE FUNCTION fibu_user_is_any_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM fibu_user_mandant_access
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION fibu_user_has_any_access()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM fibu_user_mandant_access WHERE user_id = auth.uid()
  );
$$;

-- Alte Policy ersetzen
DROP POLICY IF EXISTS "fibu: insert mandanten (admin)" ON fibu_mandanten;

CREATE POLICY "fibu: insert mandanten (admin)" ON fibu_mandanten
  FOR INSERT WITH CHECK (
    fibu_user_is_any_admin()          -- bestehende Admins dürfen neue Mandanten anlegen
    OR NOT fibu_user_has_any_access() -- Erstbenutzer (noch kein Access-Eintrag) ebenfalls
  );
