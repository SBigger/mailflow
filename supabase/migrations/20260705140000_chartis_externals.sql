-- ===========================================================================
-- CHARTIS - externe Teilnehmer in Direkt-/Gruppenchats (per E-Mail)
-- ===========================================================================
-- Man kann externe Personen (per E-Mail) in einen Chat einladen. Ein Chat MIT
-- Externen wird zur "geteilten Unterhaltung": jede interne Nachricht geht auch
-- per E-Mail an die Externen raus (Edge Function chartis-fanout), und deren
-- Antwort kommt ueber das stabile Faden-Token (chartis_threads.reply_token) via
-- chartis-inbound als email_in in DENSELBEN Faden zurueck.
--
-- Alle Externen eines Fadens teilen sich EIN reply_token; from_addr der
-- eingehenden Nachricht unterscheidet, wer geantwortet hat. Keine Aenderung an
-- der produktiven MS365-Integration. Idempotent.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS chartis_thread_externals (
  thread_id  UUID NOT NULL REFERENCES chartis_threads(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,                    -- normalisiert (lowercase/trim) im Client
  name       TEXT,
  added_by   UUID REFERENCES auth.users(id),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, email)
);
CREATE INDEX IF NOT EXISTS chartis_thread_externals_thread_idx ON chartis_thread_externals (thread_id);

ALTER TABLE chartis_thread_externals ENABLE ROW LEVEL SECURITY;

-- Sichtbar/aenderbar fuer alle, die den Faden sehen duerfen (Objekt=Staff,
-- Direkt/Gruppe=Teilnehmer/Ersteller). Schreiben zusaetzlich nur Staff.
DROP POLICY IF EXISTS chartis_externals_select ON chartis_thread_externals;
DROP POLICY IF EXISTS chartis_externals_insert ON chartis_thread_externals;
DROP POLICY IF EXISTS chartis_externals_delete ON chartis_thread_externals;
CREATE POLICY chartis_externals_select ON chartis_thread_externals FOR SELECT
  USING (chartis_can_see_thread(thread_id));
CREATE POLICY chartis_externals_insert ON chartis_thread_externals FOR INSERT
  WITH CHECK (chartis_is_staff() AND chartis_can_see_thread(thread_id));
CREATE POLICY chartis_externals_delete ON chartis_thread_externals FOR DELETE
  USING (chartis_is_staff() AND chartis_can_see_thread(thread_id));

COMMIT;

-- ===========================================================================
-- TEST:
--   INSERT INTO chartis_thread_externals(thread_id, email, name)
--     VALUES ('<thread-uuid>', 'kunde@example.com', 'Max Kunde');   -- als Staff
--   SELECT thread_id, email, name FROM chartis_thread_externals;
-- ===========================================================================
