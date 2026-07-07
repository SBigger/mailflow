-- ===========================================================================
-- CHARTIS - Nachricht bearbeiten/löschen (soft) + Emoji-Reaktionen
-- ===========================================================================
-- Quick-Wins fuer den "perfekten" internen Team-Chat:
--   * edited_at / deleted_at auf chartis_messages (Soft-Delete, "bearbeitet")
--   * UPDATE-Policy: Autor darf NUR seine eigene Nachricht aendern (Faden sichtbar)
--   * chartis_reactions: Emoji-Reaktionen pro Nachricht/User, live via Realtime
-- Idempotent. Beruehrt die produktive MS365-Integration NICHT.
-- ===========================================================================

BEGIN;

-- ── Edit/Delete-Metadaten ──────────────────────────────────────────────────
ALTER TABLE chartis_messages ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ;
ALTER TABLE chartis_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Autor darf eigene Nachricht bearbeiten/soft-loeschen (nur in sichtbarem Faden).
-- WITH CHECK verhindert Uebernahme fremder Nachrichten / Verschieben in fremde Faeden.
DROP POLICY IF EXISTS chartis_messages_update ON chartis_messages;
CREATE POLICY chartis_messages_update ON chartis_messages FOR UPDATE
  USING (created_by = auth.uid() AND chartis_can_see_thread(thread_id))
  WITH CHECK (created_by = auth.uid() AND chartis_can_see_thread(thread_id));

-- ── Emoji-Reaktionen ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chartis_reactions (
  message_id UUID NOT NULL REFERENCES chartis_messages(id) ON DELETE CASCADE,
  thread_id  UUID NOT NULL REFERENCES chartis_threads(id) ON DELETE CASCADE, -- denormalisiert fuer RLS
  user_id    UUID NOT NULL REFERENCES auth.users(id),
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS chartis_reactions_thread_idx ON chartis_reactions (thread_id);
CREATE INDEX IF NOT EXISTS chartis_reactions_msg_idx    ON chartis_reactions (message_id);

ALTER TABLE chartis_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chartis_reactions_select ON chartis_reactions;
DROP POLICY IF EXISTS chartis_reactions_insert ON chartis_reactions;
DROP POLICY IF EXISTS chartis_reactions_delete ON chartis_reactions;
CREATE POLICY chartis_reactions_select ON chartis_reactions FOR SELECT
  USING (chartis_can_see_thread(thread_id));
CREATE POLICY chartis_reactions_insert ON chartis_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND chartis_can_see_thread(thread_id));
CREATE POLICY chartis_reactions_delete ON chartis_reactions FOR DELETE
  USING (user_id = auth.uid());

-- ── Realtime: Reaktionen live (Publication + volle Replica-Identity) ────────
ALTER TABLE chartis_reactions REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chartis_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chartis_reactions;
  END IF;
END $$;

COMMIT;

-- ===========================================================================
-- TEST:
--   \d chartis_messages   -- edited_at, deleted_at vorhanden
--   INSERT INTO chartis_reactions(message_id, thread_id, user_id, emoji)
--     VALUES ('<msg>','<thread>', auth.uid(), '👍');
-- ===========================================================================
