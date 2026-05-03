-- ══════════════════════════════════════════════════════════════════════
-- Migration: calendar_events
-- Zweck:     Microsoft Outlook Kalender-Sync für Projektverwaltung
-- Datum:     2026-05-03
--
-- ADDITIV: keine bestehende Tabelle wird verändert.
-- MS365-Mail-Integration (mail_items / sync-outlook-mails) wird NICHT berührt.
-- ══════════════════════════════════════════════════════════════════════

-- Neue Spalten in profiles für separates Calendar-Token-Management
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS calendar_access_token  TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS calendar_token_expiry  BIGINT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS calendar_delta_link    TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS calendar_sync_days     INT DEFAULT 30;

-- ──────────────────────────────────────────────────────────────────────
-- Haupt-Tabelle: calendar_events
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Microsoft Graph Event-ID (Deduplikation)
  outlook_id          TEXT        NOT NULL,

  -- Inhalt
  subject             TEXT,
  body_preview        TEXT,

  -- Zeitraum (UTC)
  start_time          TIMESTAMPTZ,
  end_time            TIMESTAMPTZ,
  is_all_day          BOOLEAN     DEFAULT FALSE,

  -- Ort / Online-Meeting
  location            TEXT,
  online_meeting_url  TEXT,

  -- Organisator
  organizer_name      TEXT,
  organizer_email     TEXT,

  -- Status des eingeladenen Nutzers
  -- none | accepted | declined | tentativelyAccepted | notResponded
  response_status     TEXT        DEFAULT 'none',
  is_cancelled        BOOLEAN     DEFAULT FALSE,

  -- Metadaten
  importance          TEXT        DEFAULT 'normal',   -- low | normal | high
  categories          TEXT[]      DEFAULT '{}',

  -- Optionale Kunden-Verknüpfung (manuell)
  customer_id         UUID        REFERENCES customers(id) ON DELETE SET NULL,
  notes               TEXT,

  -- User-Isolation
  created_by          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Ein Event kann pro Nutzer nur einmal vorkommen
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_outlook_user
  ON calendar_events (outlook_id, created_by);

CREATE INDEX IF NOT EXISTS idx_calendar_events_start
  ON calendar_events (created_by, start_time);

CREATE INDEX IF NOT EXISTS idx_calendar_events_customer
  ON calendar_events (customer_id, start_time);

-- ──────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own calendar events"
  ON calendar_events
  FOR ALL
  USING (created_by = auth.uid());
