-- ===========================================================================
-- Abschlussdokumentation: Versionierung
-- ===========================================================================
-- Bisher genau 1 Abschluss pro (Kunde, Geschäftsjahr). Jetzt mehrere Versionen:
-- jede Version hat eigene abschluss_konten (Salden + Notizen), eigenen Status
-- und kann gesperrt (schreibgeschützt) werden. abschluss_konten haengt schon
-- per FK (ON DELETE CASCADE) an abschluss -> Loeschen einer Version entfernt
-- deren Konten automatisch. Das vorhandene Textfeld "notizen" dient als
-- Versions-Kommentar.
-- ===========================================================================

BEGIN;

ALTER TABLE public.abschluss
  ADD COLUMN IF NOT EXISTS version  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS gesperrt boolean NOT NULL DEFAULT false;

-- Eindeutigkeit von (Kunde, Jahr) auf (Kunde, Jahr, Version) umstellen
ALTER TABLE public.abschluss DROP CONSTRAINT IF EXISTS abschluss_customer_jahr_unique;
ALTER TABLE public.abschluss
  ADD CONSTRAINT abschluss_customer_jahr_version_unique
  UNIQUE (customer_id, geschaeftsjahr, version);

COMMIT;

-- TEST:
--   SELECT customer_id, geschaeftsjahr, version, status, gesperrt FROM public.abschluss ORDER BY 1,2,3;
