-- ============================================================
-- Abschlussdokumentation (Jahresabschluss)
-- Ein Abschluss-Datensatz pro Kunde und Geschäftsjahr.
-- abschluss_konten enthält die importierten Konten/Saldoliste.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ENUM für Status
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'abschluss_status') THEN
    CREATE TYPE public.abschluss_status AS ENUM (
      'in_arbeit',
      'abgeschlossen',
      'genehmigt'
    );
  END IF;
END$$;

-- ------------------------------------------------------------
-- 2. Haupttabelle: abschluss
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.abschluss (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID              NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  geschaeftsjahr  INT               NOT NULL,           -- z.B. 2024
  status          public.abschluss_status NOT NULL DEFAULT 'in_arbeit',
  notizen         TEXT              NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  created_by      UUID              REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  -- Pro Kunde darf jedes Geschäftsjahr nur einmal vorkommen
  CONSTRAINT abschluss_customer_jahr_unique UNIQUE (customer_id, geschaeftsjahr)
);

-- ------------------------------------------------------------
-- 3. Detailtabelle: abschluss_konten (Saldoliste / Rohbilanz)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.abschluss_konten (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  abschluss_id        UUID          NOT NULL
                        REFERENCES public.abschluss(id) ON DELETE CASCADE,
  kontonummer         TEXT          NOT NULL,           -- z.B. '1000'
  kontoname           TEXT          NOT NULL DEFAULT '',
  saldo_ist           NUMERIC(15,2) NOT NULL DEFAULT 0,
  saldo_vorjahr       NUMERIC(15,2),                   -- NULL wenn kein Vorjahreswert
  position_id         TEXT,                             -- automatisch gemappte Bilanzposition
  position_override   BOOLEAN       NOT NULL DEFAULT FALSE, -- manuell überschrieben?
  notiz               TEXT          NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 4. Indizes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_abschluss_customer
  ON public.abschluss(customer_id);

CREATE INDEX IF NOT EXISTS idx_abschluss_customer_jahr
  ON public.abschluss(customer_id, geschaeftsjahr);

CREATE INDEX IF NOT EXISTS idx_abschluss_status
  ON public.abschluss(status);

CREATE INDEX IF NOT EXISTS idx_abschluss_konten_abschluss
  ON public.abschluss_konten(abschluss_id);

CREATE INDEX IF NOT EXISTS idx_abschluss_konten_kontonummer
  ON public.abschluss_konten(abschluss_id, kontonummer);

-- ------------------------------------------------------------
-- 5. updated_at-Trigger auf abschluss
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Trigger nur anlegen wenn er noch nicht existiert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_abschluss_updated_at'
      AND tgrelid = 'public.abschluss'::regclass
  ) THEN
    CREATE TRIGGER trg_abschluss_updated_at
      BEFORE UPDATE ON public.abschluss
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END$$;

-- ------------------------------------------------------------
-- 6. Row Level Security
-- ------------------------------------------------------------
ALTER TABLE public.abschluss        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abschluss_konten ENABLE ROW LEVEL SECURITY;

-- abschluss: alle authentifizierten Nutzer dürfen lesen/schreiben
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'abschluss' AND policyname = 'abschluss_auth'
  ) THEN
    CREATE POLICY "abschluss_auth"
      ON public.abschluss FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END$$;

-- abschluss_konten: alle authentifizierten Nutzer dürfen lesen/schreiben
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'abschluss_konten' AND policyname = 'abschluss_konten_auth'
  ) THEN
    CREATE POLICY "abschluss_konten_auth"
      ON public.abschluss_konten FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END$$;
