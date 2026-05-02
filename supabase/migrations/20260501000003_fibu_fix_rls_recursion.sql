-- =====================================================================
-- Fix: Infinite Recursion in RLS-Policies auf fibu_user_mandant_access
-- Problem: Policies, die direkt auf der geschützten Tabelle subquerien,
--          lösen RLS erneut aus → PostgreSQL erkennt Endlosrekursion.
-- Lösung:  SECURITY DEFINER-Funktionen umgehen RLS beim internen Check.
-- =====================================================================

-- 1. Hilfsfunktion: Ist der aktuelle User Admin für diesen Mandanten?
CREATE OR REPLACE FUNCTION fibu_user_is_admin_for(p_mandant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM fibu_user_mandant_access
    WHERE user_id = auth.uid()
      AND mandant_id = p_mandant_id
      AND role = 'admin'
  );
$$;

-- 2. Hilfsfunktion: Hat dieser Mandant noch gar keine Zugangszeilen?
CREATE OR REPLACE FUNCTION fibu_mandant_has_no_access(p_mandant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM fibu_user_mandant_access WHERE mandant_id = p_mandant_id
  );
$$;

-- 3. Rekursive Policies entfernen
DROP POLICY IF EXISTS "fibu: admins manage access"              ON fibu_user_mandant_access;
DROP POLICY IF EXISTS "fibu: creator inserts first access row" ON fibu_user_mandant_access;

-- 4. Neue nicht-rekursive Policies
-- Admins dürfen Zugangszeilen für ihren Mandanten lesen/schreiben
CREATE POLICY "fibu: admins manage access" ON fibu_user_mandant_access
  FOR ALL USING (
    mandant_id = ANY(fibu_mandant_ids_for_user())
    AND fibu_user_is_admin_for(mandant_id)
  );

-- Ersteller eines neuen Mandanten darf sich selbst als ersten Admin eintragen
CREATE POLICY "fibu: creator inserts first access row" ON fibu_user_mandant_access
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND fibu_mandant_has_no_access(mandant_id)
  );
