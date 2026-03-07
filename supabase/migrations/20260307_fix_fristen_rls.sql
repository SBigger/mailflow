-- ============================================================
-- FIX: "permission denied for table users" beim Fristenlauf
-- Ursache: auth.users ist für 'authenticated' nicht direkt
--          abfragbar → auth.email() verwenden stattdessen
-- Ausführen im Supabase Dashboard → SQL Editor
-- ============================================================

DROP POLICY IF EXISTS "fristen_user_access" ON fristen;

CREATE POLICY "fristen_user_access"
  ON fristen FOR ALL
  USING (
    auth.uid()::text = created_by::text
    OR assignee = auth.email()
    OR created_by IS NULL          -- erlaubt Batch-Insert ohne created_by
  )
  WITH CHECK (
    auth.uid() IS NOT NULL         -- jeder eingeloggte User darf schreiben
  );
