-- ===========================================================================
-- CHARTIS - Lesebestätigung: Teilnehmer dürfen den Read-State des Fadens sehen
-- ===========================================================================
-- Bisher konnte man via chartis_read_state_self NUR den eigenen Read-State
-- lesen. Für "Gelesen von X" muss man in einem Faden, den man sehen darf, auch
-- den Read-State der anderen Teilnehmer lesen können. Schreiben bleibt auf die
-- eigene Zeile beschränkt (chartis_read_state_self, FOR ALL).
-- Policies werden ge-OR-t -> die neue SELECT-Policy erweitert nur die Sicht.
-- Idempotent.
-- ===========================================================================

DROP POLICY IF EXISTS chartis_read_state_thread ON chartis_read_state;
CREATE POLICY chartis_read_state_thread ON chartis_read_state FOR SELECT
  USING (chartis_can_see_thread(thread_id));

-- ===========================================================================
-- TEST:
--   SELECT thread_id, user_id, last_read_at FROM chartis_read_state
--     WHERE thread_id = '<thread-uuid>';   -- als Teilnehmer: mehrere Zeilen
-- ===========================================================================
