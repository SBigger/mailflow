-- =====================================================================
-- MWST-Abrechnung: Mandant-Einstellungen + Hilfs-RPCs
-- =====================================================================

-- 1. MWST-Methode + Saldosteuersatz auf Mandant
ALTER TABLE fibu_mandanten
  ADD COLUMN IF NOT EXISTS mwst_methode TEXT NOT NULL DEFAULT 'effektiv'
    CHECK (mwst_methode IN ('effektiv', 'saldosteuersatz', 'pauschalsteuersatz')),
  ADD COLUMN IF NOT EXISTS saldosteuersatz_prozent NUMERIC(5,2),  -- z.B. 6.50
  ADD COLUMN IF NOT EXISTS abrechnungsperiode TEXT NOT NULL DEFAULT 'quartal'
    CHECK (abrechnungsperiode IN ('quartal', 'semester'));

-- 2. RPC: MWST-Zusammenfassung nach Code für eine Periode
CREATE OR REPLACE FUNCTION fibu_mwst_summary(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  mwst_code      TEXT,
  mwst_satz      NUMERIC,
  typ            TEXT,
  bezeichnung    TEXT,
  anzahl_buchungen BIGINT,
  sum_netto      NUMERIC,
  sum_mwst       NUMERIC,
  sum_brutto     NUMERIC
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    b.mwst_code,
    mc.satz                                     AS mwst_satz,
    mc.typ                                      AS typ,
    mc.bezeichnung                              AS bezeichnung,
    COUNT(*)::BIGINT                            AS anzahl_buchungen,
    ROUND(SUM(b.betrag), 2)                     AS sum_netto,
    ROUND(SUM(COALESCE(b.mwst_betrag, 0)), 2)   AS sum_mwst,
    ROUND(SUM(b.betrag + COALESCE(b.mwst_betrag,0)), 2) AS sum_brutto
  FROM fibu_buchungen b
  LEFT JOIN fibu_mwst_codes mc
    ON mc.mandant_id = b.mandant_id AND mc.code = b.mwst_code
  WHERE b.mandant_id = p_mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND b.mwst_code IS NOT NULL
    AND NOT b.storniert
  GROUP BY b.mwst_code, mc.satz, mc.typ, mc.bezeichnung, mc.sortierung
  ORDER BY mc.sortierung NULLS LAST, b.mwst_code;
$$;

-- 3. RPC: MWST-Zusammenfassung nach Konto + Code
CREATE OR REPLACE FUNCTION fibu_mwst_by_konto(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  konto_nr       TEXT,
  konto_bez      TEXT,
  mwst_code      TEXT,
  mwst_satz      NUMERIC,
  anzahl         BIGINT,
  sum_netto      NUMERIC,
  sum_mwst       NUMERIC
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    b.konto_soll                                AS konto_nr,
    k.bezeichnung                               AS konto_bez,
    b.mwst_code,
    mc.satz                                     AS mwst_satz,
    COUNT(*)::BIGINT                            AS anzahl,
    ROUND(SUM(b.betrag), 2)                     AS sum_netto,
    ROUND(SUM(COALESCE(b.mwst_betrag, 0)), 2)   AS sum_mwst
  FROM fibu_buchungen b
  LEFT JOIN fibu_konten k
    ON k.mandant_id = b.mandant_id AND k.konto_nr = b.konto_soll
  LEFT JOIN fibu_mwst_codes mc
    ON mc.mandant_id = b.mandant_id AND mc.code = b.mwst_code
  WHERE b.mandant_id = p_mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND b.mwst_code IS NOT NULL
    AND NOT b.storniert
  GROUP BY b.konto_soll, k.bezeichnung, b.mwst_code, mc.satz
  ORDER BY b.konto_soll, b.mwst_code;
$$;

-- 4. RPC: Detaillierte MWST-Buchungen
CREATE OR REPLACE FUNCTION fibu_mwst_detail(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  buchungs_nr    TEXT,
  buchungsdatum  DATE,
  beleg_ref      TEXT,
  konto_soll     TEXT,
  konto_soll_bez TEXT,
  mwst_code      TEXT,
  mwst_satz      NUMERIC,
  betrag_netto   NUMERIC,
  mwst_betrag    NUMERIC,
  mwst_erwartet  NUMERIC,
  differenz      NUMERIC,
  text           TEXT,
  quelle         TEXT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    b.buchungs_nr,
    b.buchungsdatum,
    b.beleg_ref,
    b.konto_soll,
    k.bezeichnung                                AS konto_soll_bez,
    b.mwst_code,
    mc.satz                                      AS mwst_satz,
    ROUND(b.betrag, 2)                           AS betrag_netto,
    ROUND(COALESCE(b.mwst_betrag, 0), 2)         AS mwst_betrag,
    -- Verprobung: erwarteter MWST-Betrag
    ROUND(b.betrag * COALESCE(mc.satz, 0) / 100, 2) AS mwst_erwartet,
    -- Differenz (Rundungstoleranz ±0.05 gilt als OK)
    ROUND(COALESCE(b.mwst_betrag, 0) - b.betrag * COALESCE(mc.satz, 0) / 100, 2) AS differenz,
    b.text,
    b.quelle
  FROM fibu_buchungen b
  LEFT JOIN fibu_konten k
    ON k.mandant_id = b.mandant_id AND k.konto_nr = b.konto_soll
  LEFT JOIN fibu_mwst_codes mc
    ON mc.mandant_id = b.mandant_id AND mc.code = b.mwst_code
  WHERE b.mandant_id = p_mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND b.mwst_code IS NOT NULL
    AND NOT b.storniert
  ORDER BY b.buchungsdatum, b.buchungs_nr;
$$;
