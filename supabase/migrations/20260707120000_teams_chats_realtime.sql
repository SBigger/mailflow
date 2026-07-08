-- ===========================================================================
-- TEAMS-CHATS: Realtime statt Polling
-- ===========================================================================
-- teams_chat_messages/teams_chats in die supabase_realtime-Publication
-- aufnehmen, damit das Frontend per postgres_changes live aktualisiert
-- (statt refetchInterval-Polling). REPLICA IDENTITY FULL, damit UPDATE/DELETE
-- die alten Werte mitliefern. Idempotent.
-- ===========================================================================

BEGIN;

ALTER TABLE teams_chat_messages REPLICA IDENTITY FULL;
ALTER TABLE teams_chats         REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'teams_chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE teams_chat_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'teams_chats') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE teams_chats;
  END IF;
END $$;

COMMIT;
