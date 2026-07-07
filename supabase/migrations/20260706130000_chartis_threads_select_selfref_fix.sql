-- ===========================================================================
-- CHARTIS FIX - chartis_threads SELECT/UPDATE-Policy: Selbst-Referenz-Bug
-- ===========================================================================
-- BUG: Direkt-/Gruppenchat anlegen scheiterte mit
--   "new row violates row-level security policy for table chartis_threads".
-- URSACHE: Die SELECT-Policy nutzte chartis_can_see_thread(id). Diese Funktion
--   ist STABLE und macht `SELECT ... FROM chartis_threads WHERE id = t`. Beim
--   INSERT ... RETURNING wird die SELECT-Policy auf die zurückzugebende Zeile
--   angewandt, aber die STABLE-Funktion sieht im Command-Snapshot die eben
--   eingefügte Zeile NOCH NICHT -> Zeile wird nicht gefunden -> created_by-Check
--   greift nie -> Policy verweigert -> RETURNING (und damit .select() im Client)
--   schlägt fehl. (Insert OHNE RETURNING klappt; can_see_thread einzeln = true.)
-- FIX: Auf chartis_threads die Zeilen-Spalten DIREKT prüfen (kein Self-Subquery).
--   Für Fremd-Tabellen (messages/participants/…) bleibt chartis_can_see_thread
--   korrekt, weil dort thread_id auf eine BEREITS existierende Zeile zeigt.
-- Idempotent.
-- ===========================================================================

BEGIN;

DROP POLICY IF EXISTS chartis_threads_select ON chartis_threads;
CREATE POLICY chartis_threads_select ON chartis_threads FOR SELECT USING (
  created_by = auth.uid()
  OR (thread_type = 'objekt' AND chartis_is_staff())
  OR EXISTS (SELECT 1 FROM chartis_participants p WHERE p.thread_id = chartis_threads.id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS chartis_threads_update ON chartis_threads;
CREATE POLICY chartis_threads_update ON chartis_threads FOR UPDATE
USING (
  created_by = auth.uid()
  OR (thread_type = 'objekt' AND chartis_is_staff())
  OR EXISTS (SELECT 1 FROM chartis_participants p WHERE p.thread_id = chartis_threads.id AND p.user_id = auth.uid())
)
WITH CHECK (
  created_by = auth.uid()
  OR (thread_type = 'objekt' AND chartis_is_staff())
  OR EXISTS (SELECT 1 FROM chartis_participants p WHERE p.thread_id = chartis_threads.id AND p.user_id = auth.uid())
);

COMMIT;
