-- ===========================================================================
-- Belegsortierung: Storage-Bucket für die Originaldateien
-- ===========================================================================
-- Gespeichert wird je Mandant und Inhalts-Hash genau EINE Kopie der Datei
-- (Pfad: <customer_id>/<sha256>.<endung>). Damit hat die Vorschau nach einem
-- Neuladen wieder ein PDF — vorher lebte die Datei nur in der Browsersitzung.
--
-- Der Bucket selbst wurde am 16.08.2026 über das Dashboard angelegt (das
-- INSERT hier ist deshalb idempotent). Die Policies folgen dem Muster der
-- übrigen internen Buckets: angemeldete Mitarbeitende, kein anonymer Zugriff.
-- ===========================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('belegsortierung', 'belegsortierung', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "belegsortierung lesen"     ON storage.objects;
DROP POLICY IF EXISTS "belegsortierung schreiben" ON storage.objects;
DROP POLICY IF EXISTS "belegsortierung aendern"   ON storage.objects;
DROP POLICY IF EXISTS "belegsortierung loeschen"  ON storage.objects;

CREATE POLICY "belegsortierung lesen" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'belegsortierung');

CREATE POLICY "belegsortierung schreiben" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'belegsortierung');

CREATE POLICY "belegsortierung aendern" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'belegsortierung');

CREATE POLICY "belegsortierung loeschen" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'belegsortierung');

-- TEST:
--   SELECT policyname FROM pg_policies
--   WHERE tablename = 'objects' AND policyname LIKE 'belegsortierung%';
