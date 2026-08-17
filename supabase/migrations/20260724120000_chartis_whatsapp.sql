-- ===========================================================================
-- CHARTIS - WhatsApp-Kanal (Business Cloud API via 360dialog, EU-hosted)
-- ===========================================================================
-- Dritter externer Kanal neben E-Mail (Postmark) und Teams (Graph). Eine
-- gemeinsame Firmennummer -> EIN service-weiter 360dialog-API-Key als Secret,
-- KEIN pro-Nutzer-OAuth (anders als chartis-teams-send).
--
-- Routing eingehender Nachrichten:
--   WhatsApp liefert nur die Absender-wa_id (Telefon in E.164 ohne '+'), kein
--   Faden-Token wie bei E-Mail. Wir binden eine wa_id an einen Faden
--   (chartis_thread_whatsapp) und routen Inbound ueber diese Bindung. Gibt es
--   keine Bindung, wird die Nachricht nach chartis_unrouted geparkt (kein
--   stiller Verlust) und kann dort einem Faden zugeordnet werden.
--
-- Dedup nutzt die bestehende chartis_inbound_dedup (provider='whatsapp',
-- external_message_id = WhatsApp wamid). Idempotent.
-- ===========================================================================

-- ── Enum erweitern ─────────────────────────────────────────────────────────
-- ADD VALUE bewusst VOR dem BEGIN-Block: neue Enum-Werte duerfen in derselben
-- Transaktion nicht VERWENDET werden. Hier werden sie nur hinzugefuegt (die
-- Nutzung passiert erst spaeter zur Laufzeit), daher unkritisch. IF NOT EXISTS
-- macht die Migration wiederholbar.
ALTER TYPE chartis_kind ADD VALUE IF NOT EXISTS 'whatsapp_in';
ALTER TYPE chartis_kind ADD VALUE IF NOT EXISTS 'whatsapp_out';

BEGIN;

-- ── wa_id-Bindung: welcher WhatsApp-Kontakt gehoert zu welchem Faden ────────
-- Analog zu chartis_thread_externals (dort per E-Mail). Ein Faden hat genau
-- eine WhatsApp-Gegenstelle -> PK = thread_id. Der Index auf wa_id dient dem
-- Inbound-Routing (wa_id -> Faden).
CREATE TABLE IF NOT EXISTS chartis_thread_whatsapp (
  thread_id  UUID PRIMARY KEY REFERENCES chartis_threads(id) ON DELETE CASCADE,
  wa_id      TEXT NOT NULL,                    -- Telefon in E.164 OHNE '+', z.B. '41791234567'
  phone      TEXT,                             -- Anzeigeformat (optional, z.B. '+41 79 123 45 67')
  name       TEXT,                             -- Profilname aus WhatsApp (optional)
  added_by   UUID REFERENCES auth.users(id),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Routing-Index: eine wa_id KANN (bei Themenwechsel) an mehreren Faeden haengen;
-- Inbound routet dann auf den zuletzt aktualisierten. Siehe chartis-whatsapp-inbound.
CREATE INDEX IF NOT EXISTS chartis_thread_whatsapp_waid_idx ON chartis_thread_whatsapp (wa_id);

ALTER TABLE chartis_thread_whatsapp ENABLE ROW LEVEL SECURITY;

-- Sichtbar fuer alle, die den Faden sehen duerfen; schreiben nur Staff
-- (identisch zur Policy-Logik von chartis_thread_externals).
DROP POLICY IF EXISTS chartis_whatsapp_select ON chartis_thread_whatsapp;
DROP POLICY IF EXISTS chartis_whatsapp_insert ON chartis_thread_whatsapp;
DROP POLICY IF EXISTS chartis_whatsapp_delete ON chartis_thread_whatsapp;
CREATE POLICY chartis_whatsapp_select ON chartis_thread_whatsapp FOR SELECT
  USING (chartis_can_see_thread(thread_id));
CREATE POLICY chartis_whatsapp_insert ON chartis_thread_whatsapp FOR INSERT
  WITH CHECK (chartis_is_staff() AND chartis_can_see_thread(thread_id));
CREATE POLICY chartis_whatsapp_delete ON chartis_thread_whatsapp FOR DELETE
  USING (chartis_is_staff() AND chartis_can_see_thread(thread_id));

COMMIT;

-- ===========================================================================
-- TEST nach dem Einspielen:
--   SELECT unnest(enum_range(NULL::chartis_kind));        -- enthaelt whatsapp_in/out
--   \d chartis_thread_whatsapp
--   -- Bindung setzen (als Staff), damit Inbound von dieser Nummer routet:
--   INSERT INTO chartis_thread_whatsapp(thread_id, wa_id, name)
--     VALUES ('<thread-uuid>', '41791234567', 'Max Kunde');
-- ===========================================================================
