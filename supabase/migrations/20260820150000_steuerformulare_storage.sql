-- ===========================================================================
-- Steuerformulare: Storage-Bucket für die leeren amtlichen Formular-PDFs
-- ===========================================================================
-- Bisher lagen die Rohlinge im Repo unter public/zh/ und public/sg/, TG und
-- ESTV wurden live von den Behördenservern geholt (Vercel-Rewrites /pdf-tg
-- und /pdf-estv). Beides heisst: ein neuer Formularjahrgang braucht einen
-- Deploy, und bei TG/ESTV hängt die Vorschau an einer fremden URL.
--
-- Neu liegen alle Rohlinge in diesem Bucket. Ein Formularwechsel ist damit
-- ein Datei-Austausch im Dashboard, kein Deploy.
--
-- Inhalt: ausschliesslich LEERE Formulare, wie sie beim Kanton zum Download
-- stehen. Keine Mandantendaten. Das ausgefüllte PDF entsteht im Browser
-- (pdf-lib) und wird nie hochgeladen.
--
-- Der Bucket ist trotzdem nicht öffentlich: gelesen wird über Signed URLs
-- durch angemeldete Mitarbeitende, wie bei den übrigen internen Buckets.
-- Hochgeladen wird von Hand im Dashboard (bzw. mit dem Service-Role-Key),
-- deshalb gibt es hier bewusst keine INSERT/UPDATE/DELETE-Policy.
-- ===========================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('steuerformulare', 'steuerformulare', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "steuerformulare lesen" ON storage.objects;

CREATE POLICY "steuerformulare lesen" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'steuerformulare');

-- TEST:
--   SELECT policyname FROM pg_policies
--   WHERE tablename = 'objects' AND policyname LIKE 'steuerformulare%';
--   SELECT id, public FROM storage.buckets WHERE id = 'steuerformulare';
