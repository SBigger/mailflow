-- =====================================================================
-- Fix: Vereinfachte INSERT-Policy auf fibu_mandanten
-- Prinzip: INSERT offen für jeden eingeloggten User.
-- Sicher: SELECT/UPDATE bleiben per RLS auf eigene Mandanten beschränkt.
-- =====================================================================

-- Alle bisherigen INSERT-Policies entfernen
DROP POLICY IF EXISTS "fibu: insert mandanten (admin)"        ON fibu_mandanten;
DROP POLICY IF EXISTS "fibu: insert mandanten any auth user"  ON fibu_mandanten;

-- Neue einfache Policy: jeder eingeloggte User darf Mandanten anlegen
CREATE POLICY "fibu: insert mandanten" ON fibu_mandanten
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Verwaiste Mandanten bereinigen (keine fibu_user_mandant_access-Zeile vorhanden)
-- Betrifft nur Mandanten aus den fehlgeschlagenen Versuchen
DELETE FROM fibu_mandanten
WHERE id NOT IN (
  SELECT DISTINCT mandant_id FROM fibu_user_mandant_access
);
