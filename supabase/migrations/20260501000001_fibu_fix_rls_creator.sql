-- Fix: Erlaubt dem Ersteller eines neuen Mandanten, sich selbst als Admin einzutragen.
-- Voraussetzung: kein bestehender Zugangs-Eintrag für diesen Mandanten (= brandneuer Mandant).
CREATE POLICY "fibu: creator inserts first access row" ON fibu_user_mandant_access
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    NOT EXISTS (
      SELECT 1 FROM fibu_user_mandant_access a2 WHERE a2.mandant_id = fibu_user_mandant_access.mandant_id
    )
  );
