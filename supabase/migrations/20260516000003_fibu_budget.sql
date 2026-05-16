-- =====================================================================
-- FiBu P1: Budget – einfache Jahresbudget-Erfassung pro Konto
-- Erfassungshilfe: 2 Vorjahres-Ist-Werte werden nebeneinander gezeigt.
-- =====================================================================

CREATE TABLE IF NOT EXISTS fibu_budget (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  jahr        SMALLINT      NOT NULL,
  konto_nr    TEXT          NOT NULL,
  betrag      NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(mandant_id, jahr, konto_nr)
);
CREATE INDEX IF NOT EXISTS fibu_budget_mandant_jahr
  ON fibu_budget (mandant_id, jahr);

ALTER TABLE fibu_budget ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fibu: budget all" ON fibu_budget;
CREATE POLICY "fibu: budget all"
  ON fibu_budget
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- ── RPC: Budget-Übersicht (ER-Konten + 2 Vorjahre Ist + Budget) ──────
CREATE OR REPLACE FUNCTION fibu_budget_uebersicht(
  p_mandant_id UUID,
  p_jahr       INTEGER
)
RETURNS TABLE (
  konto_nr    TEXT,
  bezeichnung TEXT,
  konto_typ   TEXT,
  ist_vj2     NUMERIC,
  ist_vj1     NUMERIC,
  budget      NUMERIC
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH konten AS (
    SELECT k.konto_nr, k.bezeichnung, k.konto_typ
    FROM fibu_konten k
    WHERE k.mandant_id = p_mandant_id
      AND k.konto_typ IN ('ertrag', 'aufwand')
      AND k.aktiv
  ),
  bew AS (
    SELECT k.konto_nr,
           EXTRACT(YEAR FROM b.buchungsdatum)::INT AS jahr,
           k.konto_typ,
           SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END) AS soll,
           SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END) AS haben
    FROM konten k
    JOIN fibu_buchungen b
      ON (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
     AND b.mandant_id = p_mandant_id
     AND NOT b.storniert
     AND EXTRACT(YEAR FROM b.buchungsdatum) IN (p_jahr - 1, p_jahr - 2)
    GROUP BY k.konto_nr, EXTRACT(YEAR FROM b.buchungsdatum), k.konto_typ
  ),
  saldo AS (
    SELECT konto_nr, jahr,
           CASE WHEN konto_typ = 'ertrag' THEN haben - soll ELSE soll - haben END AS wert
    FROM bew
  )
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,
    COALESCE((SELECT wert FROM saldo s WHERE s.konto_nr = k.konto_nr AND s.jahr = p_jahr - 2), 0),
    COALESCE((SELECT wert FROM saldo s WHERE s.konto_nr = k.konto_nr AND s.jahr = p_jahr - 1), 0),
    COALESCE((SELECT bg.betrag FROM fibu_budget bg
               WHERE bg.mandant_id = p_mandant_id AND bg.jahr = p_jahr
                 AND bg.konto_nr = k.konto_nr), 0)
  FROM konten k
  ORDER BY k.konto_nr;
$$;

-- ── RPC: Budget speichern (Upsert je Konto) ──────────────────────────
-- p_zeilen: [{konto_nr, betrag}]
CREATE OR REPLACE FUNCTION fibu_budget_speichern(
  p_mandant_id UUID,
  p_jahr       INTEGER,
  p_zeilen     JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  z JSONB;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  FOR z IN SELECT * FROM jsonb_array_elements(p_zeilen)
  LOOP
    INSERT INTO fibu_budget (mandant_id, jahr, konto_nr, betrag, updated_at)
    VALUES (p_mandant_id, p_jahr, z->>'konto_nr',
            COALESCE(NULLIF(z->>'betrag', '')::NUMERIC, 0), NOW())
    ON CONFLICT (mandant_id, jahr, konto_nr)
    DO UPDATE SET betrag = EXCLUDED.betrag, updated_at = NOW();
  END LOOP;
END;
$$;
