-- Sicherheitsfix: share_links war über die permissive Policy "allow_all_share_links"
-- (USING(true) WITH CHECK(true), OHNE "TO authenticated") in Kombination mit
-- GRANT ALL ... TO anon für JEDEN mit dem öffentlichen anon-Key voll les- und
-- schreibbar — inklusive Spalte "token" UND "password" im Klartext.
--
-- Der öffentliche Kunden-Zugriff auf geteilte Dokumente läuft AUSSCHLIESSLICH über
-- die Edge Function "share-link" (nutzt SERVICE_ROLE_KEY, umgeht RLS ohnehin) — anon
-- braucht also KEINEN direkten Tabellenzugriff. Das eingeloggte Frontend
-- (Dokumente.jsx / DokumenteV2.jsx) greift als "authenticated" zu und bleibt
-- funktionsfähig.

-- 1) Alte, für PUBLIC (inkl. anon) offene Policy entfernen
DROP POLICY IF EXISTS "allow_all_share_links" ON public.share_links;

-- 2) Neue Policy: nur eingeloggte Nutzer
CREATE POLICY "share_links_authenticated_all" ON public.share_links
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3) anon-Grants entziehen (authenticated + service_role behalten ihre Rechte)
REVOKE ALL ON TABLE public.share_links FROM anon;
