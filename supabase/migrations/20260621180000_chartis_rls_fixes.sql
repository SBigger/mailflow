-- ===========================================================================
-- CHARTIS RLS-Fixes (aus Review wa6irx3t3) — idempotent
-- ===========================================================================
-- Behebt 4 bestätigte Funde:
--  (1) Nicht-Admins sehen keine anderen profiles -> Direkt/Gruppe nicht startbar
--      -> sichere SECURITY-DEFINER-Liste chartis_list_staff() (nur unkritische Felder)
--  (2) chartis_threads_select filtert die INSERT...RETURNING-Zeile eines frischen
--      Direkt/Gruppen-Fadens -> Anlegen schlägt fehl  -> Ersteller darf sehen
--  (3) chartis_participants: firmweiter Privacy-Leak + jeder Staff kann sich in
--      fremde private Threads eintragen -> auf Sichtbarkeit/Teilnahme scopen
--  (4) chartis_threads UPDATE nur staff-gegatet -> auf Sichtbarkeit scopen
-- ===========================================================================

-- (1) Sichere Mitarbeiter-Liste: umgeht profiles-RLS, gibt NUR unkritische Felder
CREATE OR REPLACE FUNCTION public.chartis_list_staff()
RETURNS TABLE (id uuid, full_name text, email text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, full_name, email, role FROM public.profiles
  WHERE public.chartis_is_staff()
$$;
GRANT EXECUTE ON FUNCTION public.chartis_list_staff() TO authenticated;

-- (2) Ersteller sieht seinen frischen Faden (fixt INSERT...RETURNING; deckt auch
--     chartis_messages_select/insert ab, da dort ueber dieselbe Funktion gegatet)
CREATE OR REPLACE FUNCTION public.chartis_can_see_thread(t UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chartis_threads th WHERE th.id = t AND (
      (th.thread_type = 'objekt' AND chartis_is_staff())
      OR th.created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM chartis_participants p WHERE p.thread_id = t AND p.user_id = auth.uid())
    )
  );
$$;

-- (4) Thread-UPDATE auf Sichtbarkeit scopen (statt nur Staff) + WITH CHECK
DROP POLICY IF EXISTS chartis_threads_update ON chartis_threads;
CREATE POLICY chartis_threads_update ON chartis_threads FOR UPDATE
  USING (chartis_can_see_thread(id)) WITH CHECK (chartis_can_see_thread(id));

-- (3) Teilnehmer: privat lesen; schreiben/löschen nur Ersteller oder Teilnehmer
DROP POLICY IF EXISTS chartis_participants_select ON chartis_participants;
DROP POLICY IF EXISTS chartis_participants_insert ON chartis_participants;
DROP POLICY IF EXISTS chartis_participants_delete ON chartis_participants;
CREATE POLICY chartis_participants_select ON chartis_participants FOR SELECT
  USING (chartis_can_see_thread(thread_id));
CREATE POLICY chartis_participants_insert ON chartis_participants FOR INSERT
  WITH CHECK (chartis_is_staff() AND (
    EXISTS (SELECT 1 FROM chartis_threads th WHERE th.id = thread_id AND th.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM chartis_participants p WHERE p.thread_id = thread_id AND p.user_id = auth.uid())
  ));
CREATE POLICY chartis_participants_delete ON chartis_participants FOR DELETE
  USING (chartis_is_staff() AND (
    EXISTS (SELECT 1 FROM chartis_threads th WHERE th.id = thread_id AND th.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM chartis_participants p WHERE p.thread_id = thread_id AND p.user_id = auth.uid())
  ));
