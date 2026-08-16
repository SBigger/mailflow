-- ===========================================================================
-- Belegsortierung natürliche Personen: Stand je Mandant und Steuerjahr
-- ===========================================================================
-- Gespeichert wird die ENTSCHEIDUNG, nicht die Datei: Zuordnung, Dateiname,
-- Inhalts-Hash und der erkannte Text. Der Hash ist der Schlüssel — zieht man
-- denselben Stapel erneut hinein, wird er am Inhalt wiedererkannt und muss
-- weder neu durch die OCR noch durch die KI.
--
-- Warum nicht die Dateien selbst: sie liegen beim Mandanten in der Ablage
-- oder im Scanpostfach. Eine dritte Kopie hier wäre eine dritte Wahrheit.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.belegsortierung (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  steuerjahr  integer NOT NULL CHECK (steuerjahr BETWEEN 2000 AND 2099),

  -- [{ hash, name, groesse, position, belegart, confidence, quelle,
  --    begruendung, vonHand, text }]
  belege      jsonb NOT NULL DEFAULT '[]'::jsonb,
  notizen     text,

  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT belegsortierung_kunde_jahr_unique UNIQUE (customer_id, steuerjahr)
);

CREATE INDEX IF NOT EXISTS belegsortierung_kunde_idx
  ON public.belegsortierung (customer_id, steuerjahr DESC);

ALTER TABLE public.belegsortierung ENABLE ROW LEVEL SECURITY;

-- Gleiches Muster wie steuerdaten: angemeldete Mitarbeitende arbeiten an allen
-- Mandaten. Anonyme Zugriffe haben hier nichts verloren.
DROP POLICY IF EXISTS belegsortierung_select ON public.belegsortierung;
DROP POLICY IF EXISTS belegsortierung_write  ON public.belegsortierung;

CREATE POLICY belegsortierung_select ON public.belegsortierung
  FOR SELECT TO authenticated USING (true);

CREATE POLICY belegsortierung_write ON public.belegsortierung
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- TEST:
--   SELECT customer_id, steuerjahr, jsonb_array_length(belege) AS anzahl
--   FROM public.belegsortierung ORDER BY updated_at DESC LIMIT 5;
