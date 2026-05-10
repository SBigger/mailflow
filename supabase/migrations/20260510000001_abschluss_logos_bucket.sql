-- Storage bucket für Abschluss-Logos (pro Mandant)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'abschluss-logos',
  'abschluss-logos',
  true,
  2097152,  -- 2 MB max
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: Authentifizierte User dürfen hochladen/lesen/löschen
CREATE POLICY "abschluss_logos_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'abschluss-logos');

CREATE POLICY "abschluss_logos_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'abschluss-logos');

CREATE POLICY "abschluss_logos_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'abschluss-logos');

CREATE POLICY "abschluss_logos_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'abschluss-logos');
