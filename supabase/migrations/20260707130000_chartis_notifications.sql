-- ===========================================================================
-- CHARTIS - Benachrichtigungen (Popup/Push-Grundlage)
-- ===========================================================================
-- Pro Empfänger eine Zeile (privacy-safe: jeder abonniert via RLS nur seine
-- eigenen). Gefüllt durch DB-Trigger:
--   * neue INTERNE Nachricht in Direkt/Gruppe -> für alle Teilnehmer ausser Sender
--   * @-Erwähnung -> für den erwähnten User (deckt auch Objekt-Threads ab)
-- Frontend abonniert per Realtime (postgres_changes) und zeigt Popup+Ton+Toast.
-- Idempotent.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS chartis_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id  UUID REFERENCES chartis_threads(id) ON DELETE CASCADE,
  message_id UUID REFERENCES chartis_messages(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'message',   -- 'message' | 'mention'
  title      TEXT,
  preview    TEXT,
  sender_id  UUID,
  seen       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chartis_notifications_user_idx ON chartis_notifications (user_id, seen, created_at DESC);

ALTER TABLE chartis_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chartis_notifications_own     ON chartis_notifications;
DROP POLICY IF EXISTS chartis_notifications_own_upd ON chartis_notifications;
CREATE POLICY chartis_notifications_own     ON chartis_notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY chartis_notifications_own_upd ON chartis_notifications FOR UPDATE USING (user_id = auth.uid());
-- Insert nur via SECURITY-DEFINER-Trigger / Service-Role (keine User-Insert-Policy).

-- ── Trigger: neue interne Nachricht in Direkt/Gruppe ───────────────────────
CREATE OR REPLACE FUNCTION chartis_notify_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE th RECORD; prev TEXT;
BEGIN
  SELECT id, thread_type, subject INTO th FROM chartis_threads WHERE id = NEW.thread_id;
  IF th.thread_type NOT IN ('direkt','gruppe') THEN
    RETURN NEW;  -- Objekt-Threads: nur via Erwähnung benachrichtigen
  END IF;
  prev := left(btrim(regexp_replace(coalesce(NEW.body_text,''), '!\[[^\]]*\]\([^)]*\)', '[Bild]', 'g')), 140);
  INSERT INTO chartis_notifications (user_id, thread_id, message_id, kind, title, preview, sender_id)
  SELECT p.user_id, NEW.thread_id, NEW.id, 'message', th.subject, prev, NEW.created_by
  FROM chartis_participants p
  WHERE p.thread_id = NEW.thread_id AND p.user_id <> NEW.created_by;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chartis_messages_notify ON chartis_messages;
CREATE TRIGGER chartis_messages_notify AFTER INSERT ON chartis_messages
  FOR EACH ROW WHEN (NEW.kind = 'intern') EXECUTE FUNCTION chartis_notify_on_message();

-- ── Trigger: @-Erwähnung ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chartis_notify_on_mention()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev TEXT; subj TEXT; sndr UUID;
BEGIN
  SELECT left(btrim(coalesce(m.body_text,'')),140), t.subject, m.created_by
    INTO prev, subj, sndr
  FROM chartis_messages m JOIN chartis_threads t ON t.id = m.thread_id
  WHERE m.id = NEW.message_id;
  INSERT INTO chartis_notifications (user_id, thread_id, message_id, kind, title, preview, sender_id)
  VALUES (NEW.user_id, NEW.thread_id, NEW.message_id, 'mention', coalesce(subj,'Erwähnung'), prev, sndr);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chartis_mentions_notify ON chartis_mentions;
CREATE TRIGGER chartis_mentions_notify AFTER INSERT ON chartis_mentions
  FOR EACH ROW EXECUTE FUNCTION chartis_notify_on_mention();

-- ── Realtime ───────────────────────────────────────────────────────────────
ALTER TABLE chartis_notifications REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='chartis_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chartis_notifications;
  END IF;
END $$;

COMMIT;
