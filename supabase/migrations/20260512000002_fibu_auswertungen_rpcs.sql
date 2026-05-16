-- =====================================================================
-- FiBu: Auswertungs-RPCs – Kontoblatt & Bilanz/ER
-- =====================================================================

-- 1. Kontoblatt: Einzelkonto-Auszug mit laufendem Saldo
CREATE OR REPLACE FUNCTION fibu_kontoblatt(
  p_mandant_id UUID,
  p_konto_nr   TEXT,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  buchungs_nr    TEXT,
  buchungsdatum  DATE,
  gegenkonto     TEXT,
  gegenkonto_bez TEXT,
  beleg_ref      TEXT,
  quelle_id      UUID,
  buch_text      TEXT,
  mwst_code      TEXT,
  mwst_betrag    NUMERIC,
  soll           NUMERIC,
  haben          NUMERIC,
  saldo_lfd      NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_eroeffnung NUMERIC := 0;
BEGIN
  -- Eröffnungssaldo: alle Buchungen vor p_von auf diesem Konto
  SELECT COALESCE(SUM(
    CASE
      WHEN b.konto_soll  = p_konto_nr THEN  b.betrag
      WHEN b.konto_haben = p_konto_nr THEN -b.betrag
    END
  ), 0)
  INTO v_eroeffnung
  FROM fibu_buchungen b
  WHERE b.mandant_id = p_mandant_id
    AND (b.konto_soll = p_konto_nr OR b.konto_haben = p_konto_nr)
    AND b.buchungsdatum < p_von
    AND NOT b.storniert;

  RETURN QUERY
  WITH pos AS (
    SELECT
      b.buchungs_nr,
      b.buchungsdatum,
      CASE
        WHEN b.konto_soll  = p_konto_nr THEN b.konto_haben
        WHEN b.konto_haben = p_konto_nr THEN b.konto_soll
      END                                                   AS gegenkonto,
      CASE
        WHEN b.konto_soll  = p_konto_nr THEN kh.bezeichnung
        WHEN b.konto_haben = p_konto_nr THEN ks.bezeichnung
      END                                                   AS gegenkonto_bez,
      b.beleg_ref,
      b.quelle_id,
      b.text                                                AS buch_text,
      b.mwst_code,
      ROUND(COALESCE(b.mwst_betrag, 0), 2)                 AS mwst_betrag,
      CASE WHEN b.konto_soll  = p_konto_nr THEN ROUND(b.betrag,2) ELSE 0 END AS soll,
      CASE WHEN b.konto_haben = p_konto_nr THEN ROUND(b.betrag,2) ELSE 0 END AS haben
    FROM fibu_buchungen b
    LEFT JOIN fibu_konten ks ON ks.konto_nr = b.konto_soll  AND ks.mandant_id = b.mandant_id
    LEFT JOIN fibu_konten kh ON kh.konto_nr = b.konto_haben AND kh.mandant_id = b.mandant_id
    WHERE b.mandant_id = p_mandant_id
      AND (b.konto_soll = p_konto_nr OR b.konto_haben = p_konto_nr)
      AND b.buchungsdatum BETWEEN p_von AND p_bis
      AND NOT b.storniert
    ORDER BY b.buchungsdatum, b.buchungs_nr
  )
  SELECT
    pos.buchungs_nr,
    pos.buchungsdatum,
    pos.gegenkonto,
    pos.gegenkonto_bez,
    pos.beleg_ref,
    pos.quelle_id,
    pos.buch_text,
    pos.mwst_code,
    pos.mwst_betrag,
    pos.soll,
    pos.haben,
    v_eroeffnung + SUM(pos.soll - pos.haben)
      OVER (ORDER BY pos.buchungsdatum, pos.buchungs_nr
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_lfd
  FROM pos;
END;
$$;

-- 2. Eröffnungssaldo separat (für Anzeige vor der Tabelle)
CREATE OR REPLACE FUNCTION fibu_kontoblatt_eroeffnung(
  p_mandant_id UUID,
  p_konto_nr   TEXT,
  p_stichtag   DATE
)
RETURNS NUMERIC
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN konto_soll  = p_konto_nr THEN  betrag
      WHEN konto_haben = p_konto_nr THEN -betrag
    END
  ), 0)
  FROM fibu_buchungen
  WHERE mandant_id = p_mandant_id
    AND (konto_soll = p_konto_nr OR konto_haben = p_konto_nr)
    AND buchungsdatum < p_stichtag
    AND NOT storniert;
$$;

-- 3. Konten mit Bewegungen in einer Periode (Dropdown-Befüllung)
CREATE OR REPLACE FUNCTION fibu_konten_mit_bewegungen(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  konto_nr    TEXT,
  bezeichnung TEXT,
  konto_typ   TEXT,
  anzahl      BIGINT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,
    COUNT(DISTINCT b.buchungs_nr) AS anzahl
  FROM fibu_konten k
  JOIN fibu_buchungen b ON
    (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
    AND b.mandant_id = k.mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND NOT b.storniert
  WHERE k.mandant_id = p_mandant_id
  GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
  ORDER BY k.konto_nr;
$$;

-- 4. Bilanz: Kontosalden per Stichtag (Aktiven + Passiven)
CREATE OR REPLACE FUNCTION fibu_bilanz(
  p_mandant_id UUID,
  p_stichtag   DATE
)
RETURNS TABLE (
  konto_nr    TEXT,
  bezeichnung TEXT,
  konto_typ   TEXT,
  saldo       NUMERIC
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,
    ROUND(COALESCE(SUM(
      CASE
        WHEN b.konto_soll  = k.konto_nr THEN  b.betrag
        WHEN b.konto_haben = k.konto_nr THEN -b.betrag
        ELSE 0
      END
    ), 0), 2) AS saldo
  FROM fibu_konten k
  LEFT JOIN fibu_buchungen b ON
    (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
    AND b.mandant_id = k.mandant_id
    AND b.buchungsdatum <= p_stichtag
    AND NOT b.storniert
  WHERE k.mandant_id = p_mandant_id
    AND k.konto_typ IN ('aktiv', 'passiv')
    AND k.aktiv = true
  GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
  HAVING ROUND(COALESCE(SUM(
    CASE
      WHEN b.konto_soll  = k.konto_nr THEN  b.betrag
      WHEN b.konto_haben = k.konto_nr THEN -b.betrag
      ELSE 0
    END
  ), 0), 2) <> 0
  ORDER BY k.konto_nr;
$$;

-- 5. Erfolgsrechnung: Umsätze in einer Periode (Ertrag + Aufwand)
CREATE OR REPLACE FUNCTION fibu_erfolgsrechnung(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  konto_nr    TEXT,
  bezeichnung TEXT,
  konto_typ   TEXT,
  saldo       NUMERIC
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,
    ROUND(COALESCE(SUM(
      CASE
        WHEN b.konto_soll  = k.konto_nr THEN  b.betrag
        WHEN b.konto_haben = k.konto_nr THEN -b.betrag
        ELSE 0
      END
    ), 0), 2) AS saldo
  FROM fibu_konten k
  LEFT JOIN fibu_buchungen b ON
    (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
    AND b.mandant_id = k.mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND NOT b.storniert
  WHERE k.mandant_id = p_mandant_id
    AND k.konto_typ IN ('ertrag', 'aufwand')
    AND k.aktiv = true
  GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
  HAVING ROUND(COALESCE(SUM(
    CASE
      WHEN b.konto_soll  = k.konto_nr THEN  b.betrag
      WHEN b.konto_haben = k.konto_nr THEN -b.betrag
      ELSE 0
    END
  ), 0), 2) <> 0
  ORDER BY k.konto_nr;
$$;
