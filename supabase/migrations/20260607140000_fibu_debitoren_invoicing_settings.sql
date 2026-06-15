-- =====================================================================
-- FiBu: Debitoren-Fakturierung — Stammdaten/Settings (QR-Cluster)
--   - fibu_zahlstellen.qr_iban   (QR-IBAN zusätzlich zur IBAN)
--   - fibu_mandanten: Rechnungs-Settings (Logo, Absender, Fusszeile,
--     Vorlage-Auswahl, Standard-Zahlstelle für Ausgangsrechnungen)
--   - Storage-Bucket 'fibu-logos' (public) für Mandanten-Logos
-- =====================================================================

-- QR-IBAN auf Firmenzahlstelle (für Ausgangsrechnungen / QR-Rechnung)
ALTER TABLE fibu_zahlstellen ADD COLUMN IF NOT EXISTS qr_iban TEXT;

-- Rechnungs-Stammdaten pro Mandant
ALTER TABLE fibu_mandanten ADD COLUMN IF NOT EXISTS rechnung_logo_url       TEXT;
ALTER TABLE fibu_mandanten ADD COLUMN IF NOT EXISTS rechnung_absender       TEXT;   -- Briefkopf/Absenderzeile
ALTER TABLE fibu_mandanten ADD COLUMN IF NOT EXISTS rechnung_fusszeile      TEXT;   -- Footer-Text
ALTER TABLE fibu_mandanten ADD COLUMN IF NOT EXISTS rechnung_zahlstelle_id  UUID REFERENCES fibu_zahlstellen(id);
ALTER TABLE fibu_mandanten ADD COLUMN IF NOT EXISTS rechnung_vorlage        TEXT NOT NULL DEFAULT 'klassisch';

-- Vorlage-Auswahl absichern (klassisch | modern | kompakt)
DO $$ BEGIN
  ALTER TABLE fibu_mandanten DROP CONSTRAINT IF EXISTS fibu_mandanten_rechnung_vorlage_check;
  ALTER TABLE fibu_mandanten ADD CONSTRAINT fibu_mandanten_rechnung_vorlage_check
    CHECK (rechnung_vorlage IN ('klassisch','modern','kompakt'));
END $$;

-- Logo-Bucket (public, damit das PDF das Logo laden kann)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('fibu-logos', 'fibu-logos', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "fibu-logos read"   ON storage.objects;
DROP POLICY IF EXISTS "fibu-logos write"  ON storage.objects;
DROP POLICY IF EXISTS "fibu-logos update" ON storage.objects;
DROP POLICY IF EXISTS "fibu-logos delete" ON storage.objects;
CREATE POLICY "fibu-logos read"   ON storage.objects FOR SELECT                 USING (bucket_id = 'fibu-logos');
CREATE POLICY "fibu-logos write"  ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'fibu-logos');
CREATE POLICY "fibu-logos update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'fibu-logos');
CREATE POLICY "fibu-logos delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'fibu-logos');
