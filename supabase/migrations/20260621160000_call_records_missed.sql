-- ===========================================================================
-- call_records: explizites "missed"-Flag (entgangener Anruf)
-- ===========================================================================
-- Additiv (Muster wie customer_id_manual). Bis der Sync das Flag setzt, leitet
-- das Frontend "verpasst" heuristisch ab (direction='incoming' + Dauer 0/null).
-- sync-teams-calls wird erweitert, missed aus dem Graph-raw zu setzen.
-- ===========================================================================

ALTER TABLE call_records ADD COLUMN IF NOT EXISTS missed BOOLEAN NOT NULL DEFAULT false;

-- Bestehende Datensätze einmalig heuristisch markieren (eingehend + nie verbunden)
UPDATE call_records
   SET missed = true
 WHERE direction = 'incoming'
   AND (duration_seconds IS NULL OR duration_seconds < 5)
   AND missed = false;

CREATE INDEX IF NOT EXISTS call_records_missed_idx
  ON call_records (artis_user_name, missed, start_time DESC);
