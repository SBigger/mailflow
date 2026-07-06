-- ===========================================================================
-- TEAMS-CHATS in Chartis (delegiert, pro Mitarbeiter via /me/chats)
-- ===========================================================================
-- Getrennt von den Mails! Jeder Mitarbeiter synct seine EIGENEN Teams-Chats
-- über sein delegiertes MS-Token (profiles.microsoft_*). owner_id = Mitarbeiter,
-- dessen Token die Nachricht geholt hat. Anzeige in Chartis nur für den Owner.
-- Befüllung durch Edge Function `sync-teams-chats` (Service-Role, umgeht RLS).
-- Braucht Graph-Scope Chat.Read (delegiert) + Re-Consent der Mitarbeiter.
-- Idempotent.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS teams_chats (
  owner_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id              TEXT NOT NULL,                 -- Graph chat id
  topic                TEXT,                          -- Gruppenname (bei group/meeting)
  chat_type            TEXT,                          -- oneOnOne | group | meeting
  member_names         TEXT[],                        -- Anzeigenamen der Teilnehmer
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, chat_id)
);
CREATE INDEX IF NOT EXISTS teams_chats_owner_idx ON teams_chats (owner_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS teams_chat_messages (
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id     TEXT NOT NULL,
  msg_id      TEXT NOT NULL,                          -- Graph message id
  from_name   TEXT,
  from_aad_id TEXT,
  is_mine     BOOLEAN NOT NULL DEFAULT false,         -- vom Owner selbst gesendet
  body_html   TEXT,
  body_text   TEXT,
  created_at  TIMESTAMPTZ,
  PRIMARY KEY (owner_id, chat_id, msg_id)
);
CREATE INDEX IF NOT EXISTS teams_chat_messages_idx ON teams_chat_messages (owner_id, chat_id, created_at);

-- RLS: jeder sieht nur seine eigenen Teams-Chats. Schreiben nur Service-Role (Sync).
ALTER TABLE teams_chats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teams_chats_own         ON teams_chats;
DROP POLICY IF EXISTS teams_chat_messages_own ON teams_chat_messages;
CREATE POLICY teams_chats_own         ON teams_chats         FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY teams_chat_messages_own ON teams_chat_messages FOR SELECT USING (owner_id = auth.uid());

COMMIT;
