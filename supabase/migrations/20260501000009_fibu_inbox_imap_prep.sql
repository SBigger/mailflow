-- =====================================================================
-- Inbox: IMAP-Vorbereitung + manueller Import
-- =====================================================================

-- 1. Source-Spalte: woher kam die Rechnung?
ALTER TABLE fibu_rechnung_inbox
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'webhook'
    CHECK (source IN ('webhook', 'imap', 'manual'));

-- 2. IMAP-Tracking: verhindert doppelten Import derselben Mail
ALTER TABLE fibu_rechnung_inbox
  ADD COLUMN IF NOT EXISTS imap_uid        BIGINT,   -- IMAP UID der Nachricht
  ADD COLUMN IF NOT EXISTS imap_mailbox    TEXT,      -- z.B. INBOX oder Rechnungen
  ADD COLUMN IF NOT EXISTS imap_message_id TEXT;     -- E-Mail Message-ID Header

-- Eindeutigkeits-Constraint: gleiche Mail nicht zweimal importieren
CREATE UNIQUE INDEX IF NOT EXISTS idx_fibu_inbox_imap_uid
  ON fibu_rechnung_inbox(mandant_id, imap_mailbox, imap_uid)
  WHERE imap_uid IS NOT NULL;

-- 3. INSERT-Policy für manuelle Uploads durch eingeloggte User
--    (IMAP-Edge-Function nutzt Service-Role → braucht keine RLS-Policy)
CREATE POLICY "fibu: inbox manuell hochladen" ON fibu_rechnung_inbox
  FOR INSERT WITH CHECK (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- 4. IMAP-Konfiguration pro Mandant (für später)
ALTER TABLE fibu_mandanten
  ADD COLUMN IF NOT EXISTS imap_host      TEXT,
  ADD COLUMN IF NOT EXISTS imap_port      INTEGER DEFAULT 993,
  ADD COLUMN IF NOT EXISTS imap_user      TEXT,
  ADD COLUMN IF NOT EXISTS imap_password  TEXT,   -- verschlüsselt via Vault empfohlen
  ADD COLUMN IF NOT EXISTS imap_mailbox   TEXT DEFAULT 'INBOX',
  ADD COLUMN IF NOT EXISTS imap_aktiv     BOOLEAN NOT NULL DEFAULT false;

-- 5. Index source für Filterung
CREATE INDEX IF NOT EXISTS idx_fibu_inbox_source
  ON fibu_rechnung_inbox(mandant_id, source, received_at DESC);

-- Kommentar für spätere IMAP Edge Function
COMMENT ON COLUMN fibu_mandanten.imap_host IS
  'IMAP-Server für automatischen Rechnungsimport, z.B. imap.gmail.com oder mail.artis-gmbh.ch';
COMMENT ON COLUMN fibu_mandanten.imap_aktiv IS
  'Wenn true, wird die fibu-imap-sync Edge Function diesen Mandanten bei jedem Cron-Lauf verarbeiten';
