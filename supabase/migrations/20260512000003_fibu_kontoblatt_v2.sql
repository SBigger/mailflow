-- =====================================================================
-- FiBu: Kontoblatt v2 – ergänzt konto_vorsteuer für MWST-Sub-Zeile
-- Ermöglicht die Anzeige "1172 K+" als zweite Informationszeile
-- =====================================================================

CREATE OR REPLACE FUNCTION fibu_kontoblatt(
  p_mandant_id UUID,
  p_konto_nr   TEXT,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  buchungs_nr     TEXT,
  buchungsdatum   DATE,
  gegenkonto      TEXT,
  gegenkonto_bez  TEXT,
  beleg_ref       TEXT,
  quelle_id       UUID,
  buch_text       TEXT,
  mwst_code       TEXT,
  mwst_betrag     NUMERIC,
  konto_vorsteuer TEXT,   -- z.B. '1172' – für MWST-Sub-Zeile
  soll            NUMERIC,
  haben           NUMERIC,
  saldo_lfd       NUMERIC
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
      mc.konto_vorsteuer,                                   -- NEU: z.B. '1172'
      CASE WHEN b.konto_soll  = p_konto_nr THEN ROUND(b.betrag,2) ELSE 0 END AS soll,
      CASE WHEN b.konto_haben = p_konto_nr THEN ROUND(b.betrag,2) ELSE 0 END AS haben
    FROM fibu_buchungen b
    LEFT JOIN fibu_konten  ks ON ks.konto_nr = b.konto_soll  AND ks.mandant_id = b.mandant_id
    LEFT JOIN fibu_konten  kh ON kh.konto_nr = b.konto_haben AND kh.mandant_id = b.mandant_id
    LEFT JOIN fibu_mwst_codes mc
      ON mc.code = b.mwst_code AND mc.mandant_id = b.mandant_id
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
    pos.konto_vorsteuer,
    pos.soll,
    pos.haben,
    v_eroeffnung + SUM(pos.soll - pos.haben)
      OVER (ORDER BY pos.buchungsdatum, pos.buchungs_nr
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_lfd
  FROM pos;
END;
$$;
