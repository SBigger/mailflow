-- Erweiterte Leasing-Felder für Fahrzeugliste
ALTER TABLE public.fahrzeuge
  ADD COLUMN IF NOT EXISTS leasing_startdatum       DATE,
  ADD COLUMN IF NOT EXISTS leasing_anzahl_raten     INT,           -- Auto aus Laufzeit, überschreibbar
  ADD COLUMN IF NOT EXISTS leasing_erste_rate       NUMERIC(10,2), -- Sonderzahlung / Anzahlung
  ADD COLUMN IF NOT EXISTS leasing_monatliche_rate  NUMERIC(10,2), -- Monatliche Rate (CHF)
  ADD COLUMN IF NOT EXISTS leasing_restwert         NUMERIC(10,2), -- Restwert / Ballonrate (fakultativ)
  ADD COLUMN IF NOT EXISTS leasing_dokument_id      UUID REFERENCES public.dokumente(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fahrzeuge_leasing_dok ON public.fahrzeuge(leasing_dokument_id)
  WHERE leasing_dokument_id IS NOT NULL;
