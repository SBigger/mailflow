-- ============================================================
--  agent_tokens: Kurzlebige Tokens fuer artis-open:// URI
--  Zweck: JWT sicher aus dem Browser an den lokalen Agent
--         weitergeben, OHNE ihn im URI zu exponieren.
--  Laeuft ab: 5 Minuten nach Erstellung (einmalig verwendbar)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID        NOT NULL REFERENCES dokumente(id) ON DELETE CASCADE,
  item_id     TEXT        NOT NULL,
  filename    TEXT        NOT NULL,
  jwt         TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  used_at     TIMESTAMPTZ
);

ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_insert_own" ON agent_tokens
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "auth_select_own" ON agent_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
