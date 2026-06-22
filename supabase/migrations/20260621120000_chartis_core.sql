-- ===========================================================================
-- CHARTIS - kontextbezogenes Chat-/Kommunikationsmodul (Entwurf v1)
-- ===========================================================================
-- Verallgemeinerung des Ticket-Musters (support_tickets/ticket_messages) auf
-- ALLE Module. Ein Faden haengt an genau einem Datensatz (module, record_id).
-- Nachrichten sind INTERN (App-only) oder EXTERN (E-Mail raus, Kundenantwort
-- kommt ueber signiertes Token in DENSELBEN Faden zurueck).
--
-- WICHTIG / Abgrenzung:
--  * Eigener Rueckkanal (eigene Domain + transaktionaler Provider, Option A).
--    Die produktive MS365-Mail-Integration (sync-support-mailbox /
--    send-ticket-reply) wird NICHT angefasst (CLAUDE.md: hands-off).
--  * Routing-Anker = unfaelschbares serverseitiges Token (NICHT Message-ID:
--    In-Reply-To/References sind faelschbar -> nur Fallback).
--
-- Mandanten-RLS folgt dem bestehenden Muster (fibu_mandanten /
-- fibu_user_mandant_access / fibu_mandant_ids_for_user()).
-- v1-RLS = Staff-Sichtbarkeit (profiles-Zeile vorhanden); die feinere
-- Mandanten-Isolation wird aktiviert, sobald die kanonische Kundentabelle je
-- Modul feststeht (TODO unten).
-- ===========================================================================

BEGIN;

-- ── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE chartis_module AS ENUM (
    'task','unternehmen','dokument','frist','projekt','abschluss',
    'aktennotiz','aktienbuch','fahrzeug','anlage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chartis_kind AS ENUM ('intern','email_out','email_in');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chartis_thread_status AS ENUM ('aktiv','wartet_kunde','erledigt');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Faden: genau einer pro Datensatz ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS chartis_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    UUID,                              -- nullable v1; FK folgt (TODO)
  module        chartis_module NOT NULL,
  record_id     UUID NOT NULL,                     -- PK des verknuepften Datensatzes
  subject       TEXT NOT NULL,                     -- Basis-Betreff fuer Outbound
  status        chartis_thread_status NOT NULL DEFAULT 'aktiv',
  owner_id      UUID REFERENCES auth.users(id),    -- zustaendiger Sachbearbeiter
  ext_contact_email TEXT,                          -- erwartete Kunden-From-Adresse
  reply_token   TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
                                                   -- stabile Reply-Adresse je Faden:
                                                   -- reply+<reply_token>@<domain>, 128-bit, nicht erratbar
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module, record_id)
);
CREATE INDEX IF NOT EXISTS chartis_threads_record_idx  ON chartis_threads (module, record_id);
CREATE INDEX IF NOT EXISTS chartis_threads_mandant_idx ON chartis_threads (mandant_id, status);
CREATE INDEX IF NOT EXISTS chartis_threads_owner_idx   ON chartis_threads (owner_id, status);

-- ── Nachrichten ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chartis_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     UUID NOT NULL REFERENCES chartis_threads(id) ON DELETE CASCADE,
  mandant_id    UUID,                              -- denormalisiert fuer RLS
  kind          chartis_kind NOT NULL,
  body_text     TEXT,                              -- gestrippte Anzeige
  body_html     TEXT,
  raw_eml_path  TEXT,                              -- Roh-MIME im Storage (Audit)
  message_id    TEXT,                              -- RFC5322 Message-ID (out + in)
  in_reply_to   TEXT,
  references_h  TEXT,
  from_addr     TEXT,                              -- bei email_in: Kunden-Absender
  to_addr       TEXT,
  reply_token   TEXT,                              -- bei email_out gesetztes Token
  created_by    UUID REFERENCES auth.users(id),    -- NULL bei email_in
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chartis_messages_thread_idx ON chartis_messages (thread_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS chartis_messages_msgid_idx
  ON chartis_messages (message_id) WHERE message_id IS NOT NULL;

-- ── Idempotenz/Dedup (Inbound ist at-least-once) ───────────────────────────
CREATE TABLE IF NOT EXISTS chartis_inbound_dedup (
  provider            TEXT NOT NULL,               -- 'postmark' | 'mailgun' | 'imap'
  external_message_id TEXT NOT NULL,
  thread_id           UUID REFERENCES chartis_threads(id),
  message_id          UUID REFERENCES chartis_messages(id),
  processed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_message_id)
);

-- ── Unrouted/Triage (kein/ungueltiges Token, From-Mismatch, Bounce) ────────
CREATE TABLE IF NOT EXISTS chartis_unrouted (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL,
  external_message_id TEXT,
  from_addr           TEXT,
  subject             TEXT,
  raw_eml_path        TEXT,
  reason              TEXT,                         -- 'no_token'|'bad_hmac'|'from_mismatch'|'bounce'
  resolved_thread_id  UUID REFERENCES chartis_threads(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Read-State pro User/Faden ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chartis_read_state (
  thread_id    UUID NOT NULL REFERENCES chartis_threads(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

-- ── Anhaenge: Pfad referenzieren, KEINE Signed-URLs persistieren ───────────
CREATE TABLE IF NOT EXISTS chartis_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID NOT NULL REFERENCES chartis_messages(id) ON DELETE CASCADE,
  mandant_id   UUID,
  bucket_id    TEXT NOT NULL DEFAULT 'dokumente',
  storage_path TEXT NOT NULL,
  filename     TEXT,
  content_type TEXT,
  size_bytes   BIGINT
);

-- ── updated_at-Trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chartis_set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chartis_threads_updated_at ON chartis_threads;
CREATE TRIGGER chartis_threads_updated_at
  BEFORE UPDATE ON chartis_threads
  FOR EACH ROW EXECUTE FUNCTION chartis_set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
-- v1: Staff-Sichtbarkeit (eine profiles-Zeile = Mitarbeiter; Portal-/Kunden-
-- Logins haben keine). TODO v2: pro Modul die kanonische Mandanten-/Kunden-
-- tabelle bestimmen und auf mandant_id = ANY(<helper>) verschaerfen.
CREATE OR REPLACE FUNCTION chartis_is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid());
$$;

ALTER TABLE chartis_threads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE chartis_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chartis_read_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chartis_attachments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chartis_unrouted      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chartis_inbound_dedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY chartis_threads_staff     ON chartis_threads     FOR ALL USING (chartis_is_staff()) WITH CHECK (chartis_is_staff());
CREATE POLICY chartis_messages_staff    ON chartis_messages    FOR ALL USING (chartis_is_staff()) WITH CHECK (chartis_is_staff());
CREATE POLICY chartis_read_state_self   ON chartis_read_state  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY chartis_attachments_staff ON chartis_attachments FOR ALL USING (chartis_is_staff()) WITH CHECK (chartis_is_staff());
CREATE POLICY chartis_unrouted_staff    ON chartis_unrouted    FOR ALL USING (chartis_is_staff()) WITH CHECK (chartis_is_staff());
-- dedup/inbound nur Service-Role (kein anon/auth-Zugriff): keine Policy -> deny-by-default

COMMIT;

-- ===========================================================================
-- TEST nach dem Einspielen:
--   SELECT typname FROM pg_type WHERE typname LIKE 'chartis%';        -- 3 enums
--   \d chartis_threads
--   INSERT INTO chartis_threads(module, record_id, subject)
--     VALUES('dokument', gen_random_uuid(), 'Test');                  -- als Staff
-- ===========================================================================
