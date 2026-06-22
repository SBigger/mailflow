-- ===========================================================================
-- CHARTIS v2 - Direkt-/Gruppenchats zwischen Mitarbeitern + Erwaehnungen
-- ===========================================================================
-- Erweitert die Faeden um einen Typ: 'objekt' (an Datensatz, bisheriges
-- Verhalten), 'direkt' (1:1 Mitarbeiter) und 'gruppe' (mehrere). Direkt/Gruppe
-- haengen NICHT an einem Datensatz -> module/record_id werden nullable.
-- Sichtbarkeit: Objekt-Faeden = Staff; Direkt/Gruppe = nur Teilnehmer (privat!).
-- ===========================================================================

ALTER TABLE chartis_threads ADD COLUMN IF NOT EXISTS thread_type TEXT NOT NULL DEFAULT 'objekt';
ALTER TABLE chartis_threads ALTER COLUMN module    DROP NOT NULL;
ALTER TABLE chartis_threads ALTER COLUMN record_id DROP NOT NULL;

-- Teilnehmer eines Direkt-/Gruppenchats
CREATE TABLE IF NOT EXISTS chartis_participants (
  thread_id UUID NOT NULL REFERENCES chartis_threads(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id),
  role      TEXT NOT NULL DEFAULT 'member',
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS chartis_participants_user_idx ON chartis_participants (user_id);

-- @-Erwaehnungen (fuer die zentrale Inbox "Erwaehnt")
CREATE TABLE IF NOT EXISTS chartis_mentions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES chartis_messages(id) ON DELETE CASCADE,
  thread_id  UUID NOT NULL REFERENCES chartis_threads(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id),
  seen       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chartis_mentions_user_idx ON chartis_mentions (user_id, seen, created_at);

ALTER TABLE chartis_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chartis_mentions     ENABLE ROW LEVEL SECURITY;

-- Sichtbarkeits-Helfer (SECURITY DEFINER -> umgeht RLS, keine Rekursion)
CREATE OR REPLACE FUNCTION chartis_can_see_thread(t UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chartis_threads th WHERE th.id = t AND (
      (th.thread_type = 'objekt' AND chartis_is_staff())
      OR EXISTS (SELECT 1 FROM chartis_participants p WHERE p.thread_id = t AND p.user_id = auth.uid())
    )
  );
$$;

-- Faeden: Objekt=Staff, Direkt/Gruppe=Teilnehmer
DROP POLICY IF EXISTS chartis_threads_staff   ON chartis_threads;
DROP POLICY IF EXISTS chartis_threads_select  ON chartis_threads;
DROP POLICY IF EXISTS chartis_threads_insert  ON chartis_threads;
DROP POLICY IF EXISTS chartis_threads_update  ON chartis_threads;
CREATE POLICY chartis_threads_select ON chartis_threads FOR SELECT USING (chartis_can_see_thread(id));
CREATE POLICY chartis_threads_insert ON chartis_threads FOR INSERT WITH CHECK (chartis_is_staff());
CREATE POLICY chartis_threads_update ON chartis_threads FOR UPDATE USING (chartis_is_staff());

-- Nachrichten: sichtbar/schreibbar, wenn der Faden sichtbar ist
DROP POLICY IF EXISTS chartis_messages_staff  ON chartis_messages;
DROP POLICY IF EXISTS chartis_messages_select ON chartis_messages;
DROP POLICY IF EXISTS chartis_messages_insert ON chartis_messages;
CREATE POLICY chartis_messages_select ON chartis_messages FOR SELECT USING (chartis_can_see_thread(thread_id));
CREATE POLICY chartis_messages_insert ON chartis_messages FOR INSERT WITH CHECK (chartis_can_see_thread(thread_id));

-- Teilnehmer: sichtbar fuer Beteiligte/Staff; anlegen darf Staff
CREATE POLICY chartis_participants_select ON chartis_participants FOR SELECT USING (chartis_is_staff() OR user_id = auth.uid());
CREATE POLICY chartis_participants_insert ON chartis_participants FOR INSERT WITH CHECK (chartis_is_staff());
CREATE POLICY chartis_participants_delete ON chartis_participants FOR DELETE USING (chartis_is_staff());

-- Erwaehnungen: jeder sieht/aendert nur seine eigenen; anlegen darf Staff
CREATE POLICY chartis_mentions_select ON chartis_mentions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY chartis_mentions_update ON chartis_mentions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY chartis_mentions_insert ON chartis_mentions FOR INSERT WITH CHECK (chartis_is_staff());

-- ===========================================================================
-- TEST:
--   SELECT thread_type, count(*) FROM chartis_threads GROUP BY 1;
--   \d chartis_participants
-- ===========================================================================
