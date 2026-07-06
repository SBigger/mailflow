-- ===========================================================================
-- CHARTIS - Ungelesen-Status + "letzte Nachricht" (v1 des fertigen Team-Chats)
-- ===========================================================================
-- Bisher wurde chartis_threads.updated_at NUR bei UPDATE des Fadens gesetzt
-- (Trigger chartis_threads_updated_at), NICHT bei neuen Nachrichten. Dadurch:
--   * aktive Chats wandern nicht nach oben,
--   * es gibt keinen "letzte Nachricht"-Zeitstempel/Vorschau,
--   * chartis_read_state existiert, wird aber nirgends genutzt -> kein Ungelesen.
-- Diese Migration schliesst genau diese Luecke (auch Basis fuer die Handy-App:
-- Chat-Liste mit Vorschau + Ungelesen-Badge).
-- Idempotent - kann mehrfach ausgefuehrt werden.
-- ===========================================================================

BEGIN;

-- ── Denormalisierte "letzte Nachricht" am Faden ────────────────────────────
ALTER TABLE chartis_threads ADD COLUMN IF NOT EXISTS last_message_at      TIMESTAMPTZ;
ALTER TABLE chartis_threads ADD COLUMN IF NOT EXISTS last_message_preview TEXT;
ALTER TABLE chartis_threads ADD COLUMN IF NOT EXISTS last_message_by      UUID;

-- ── Trigger: neue Nachricht -> Faden hochzaehlen ───────────────────────────
-- Bild-Markdown (![alt](url)) wird in der Vorschau zu [Bild] gekuerzt.
CREATE OR REPLACE FUNCTION chartis_bump_thread()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE chartis_threads SET
    last_message_at      = NEW.created_at,
    last_message_preview = left(
      btrim(regexp_replace(coalesce(NEW.body_text, ''), '!\[[^\]]*\]\([^)]*\)', '[Bild]', 'g')),
      160),
    last_message_by      = NEW.created_by,
    updated_at           = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS chartis_messages_bump ON chartis_messages;
CREATE TRIGGER chartis_messages_bump
  AFTER INSERT ON chartis_messages
  FOR EACH ROW EXECUTE FUNCTION chartis_bump_thread();

-- ── Backfill: bestehende Faeden aus ihrer juengsten Nachricht befuellen ─────
UPDATE chartis_threads th SET
  last_message_at      = m.created_at,
  last_message_preview = left(
    btrim(regexp_replace(coalesce(m.body_text, ''), '!\[[^\]]*\]\([^)]*\)', '[Bild]', 'g')),
    160),
  last_message_by      = m.created_by
FROM (
  SELECT DISTINCT ON (thread_id) thread_id, created_at, body_text, created_by
  FROM chartis_messages
  ORDER BY thread_id, created_at DESC
) m
WHERE m.thread_id = th.id;

-- Faeden ohne Nachricht: created_at als Sortier-Anker, damit Ordnung stimmt
UPDATE chartis_threads SET last_message_at = created_at WHERE last_message_at IS NULL;

-- ── Als-gelesen markieren (ein Aufruf fuer Web + Handy-App) ─────────────────
CREATE OR REPLACE FUNCTION chartis_mark_thread_read(p_thread UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chartis_read_state (thread_id, user_id, last_read_at)
  VALUES (p_thread, auth.uid(), now())
  ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = now();
$$;
GRANT EXECUTE ON FUNCTION chartis_mark_thread_read(UUID) TO authenticated;

COMMIT;

-- ===========================================================================
-- TEST nach dem Einspielen:
--   SELECT id, thread_type, last_message_at, last_message_preview
--     FROM chartis_threads ORDER BY last_message_at DESC LIMIT 10;
--   SELECT chartis_mark_thread_read('<thread-uuid>');   -- als eingeloggter Staff
-- ===========================================================================
