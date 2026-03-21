-- Fahrzeugliste: Geschäftsfahrzeuge pro Mandant (Privatanteil-Berechnung)
CREATE TABLE IF NOT EXISTS public.fahrzeuge (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  UUID        REFERENCES auth.users(id),

  -- Mandant
  customer_id                 UUID        REFERENCES public.customers(id) ON DELETE CASCADE,

  -- Fahrzeug-Identifikation
  kennzeichen                 TEXT        NOT NULL DEFAULT '',   -- z.B. SG 123456
  marke                       TEXT        NOT NULL DEFAULT '',   -- z.B. VW Golf
  modell                      TEXT        NOT NULL DEFAULT '',   -- z.B. 8 Life
  fahrzeugart                 TEXT        NOT NULL DEFAULT '',   -- Personenwagen / Lieferwagen / etc.
  chassis_nummer              TEXT        NOT NULL DEFAULT '',   -- VIN für MWST-Identifikation

  anschaffungsjahr            INT,                               -- z.B. 2023

  -- Finanzdaten
  kaufpreis_exkl_mwst         NUMERIC(12,2),                    -- Kaufpreis exkl. MWST (Basis Privatanteil)

  -- Leasing
  leasing                     BOOLEAN     NOT NULL DEFAULT FALSE,
  leasing_barkaufpreis        NUMERIC(12,2),                    -- Barkaufpreis laut Leasingvertrag exkl. MWST
  leasing_laufzeit_bis        DATE,
  leasing_vertrag_url         TEXT,                              -- Datei-URL (Supabase Storage)

  -- Privatanteil-Nutzung
  monate_im_betrieb           INT         NOT NULL DEFAULT 12,  -- 1–12 (unterjährig)
  fahrer_name                 TEXT        NOT NULL DEFAULT '',
  fahrer_selbstbezahlt_monat  NUMERIC(8,2) NOT NULL DEFAULT 0,  -- Eigenanteil Mitarbeiter/Mt
  unentgeltliche_befoerderung BOOLEAN     NOT NULL DEFAULT FALSE, -- Lohnausweis Feld F
  fahrtenbuch                 BOOLEAN     NOT NULL DEFAULT FALSE,
  effektive_privatkilometer   NUMERIC(8,0),                     -- nur wenn Fahrtenbuch=true
  ausschliesslich_geschaeftlich BOOLEAN   NOT NULL DEFAULT FALSE, -- kein Privatanteil

  notizen                     TEXT        NOT NULL DEFAULT '',
  sort_order                  INT         NOT NULL DEFAULT 0
);

-- Automatisch updated_at setzen
CREATE OR REPLACE FUNCTION update_fahrzeuge_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
CREATE TRIGGER trg_fahrzeuge_updated_at
  BEFORE UPDATE ON public.fahrzeuge
  FOR EACH ROW EXECUTE FUNCTION update_fahrzeuge_updated_at();

-- RLS
ALTER TABLE public.fahrzeuge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fahrzeuge_auth"
  ON public.fahrzeuge FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_fahrzeuge_customer ON public.fahrzeuge(customer_id);
