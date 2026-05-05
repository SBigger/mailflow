-- =====================================================================
-- FiBu: Korrektes MWST-Journal via fibu_buchungen
-- Wenn ein Kreditoren-Beleg gespeichert wird, erstellt diese Funktion
-- korrekte Doppelbuchungen inkl. Vorsteuer-Konto.
-- =====================================================================

-- 1. Verbucht-Flag auf Belegen
ALTER TABLE fibu_kreditoren_belege
  ADD COLUMN IF NOT EXISTS verbucht BOOLEAN NOT NULL DEFAULT false;

-- 2. Buchungs-Nummern-Generator (Jahr-Sequenz)
CREATE OR REPLACE FUNCTION fibu_next_buchungs_nr(p_mandant_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_year TEXT := TO_CHAR(NOW(), 'YYYY');
  v_last TEXT;
  v_num  INTEGER;
BEGIN
  SELECT buchungs_nr INTO v_last
  FROM fibu_buchungen
  WHERE mandant_id = p_mandant_id
    AND buchungs_nr LIKE 'BU-' || v_year || '-%'
  ORDER BY buchungs_nr DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  v_num := COALESCE(
    NULLIF(SPLIT_PART(COALESCE(v_last, ''), '-', 3), '')::INTEGER,
    0
  ) + 1;

  RETURN 'BU-' || v_year || '-' || LPAD(v_num::TEXT, 5, '0');
END;
$$;

-- 3. Kreditoren-Buchungs-RPC
-- Erstellt aus einem Kreditoren-Beleg korrekte doppelte Buchführung:
--   Soll:  Aufwandskonto  (Nettobetrag)
--   Soll:  Vorsteuer-Konto (MWST-Betrag, aus fibu_mwst_codes.konto_vorsteuer)
--   Haben: 2000 Kreditoren (Bruttobetrag)
--
-- Das ist die korrekte Methode für die effektive MWST-Abrechnung CH.
-- Bei der MWST-Abrechnung wird dann Konto 1170 Vorsteuer abgerechnet.
CREATE OR REPLACE FUNCTION fibu_kreditoren_verbuchen(p_beleg_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_beleg     RECORD;
  v_pos       RECORD;
  v_mwst_code RECORD;
  v_nr        TEXT;
  v_lieferant RECORD;
BEGIN
  -- Beleg laden
  SELECT b.*, l.name AS lieferant_name
  INTO v_beleg
  FROM fibu_kreditoren_belege b
  JOIN fibu_lieferanten l ON l.id = b.lieferant_id
  WHERE b.id = p_beleg_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beleg % nicht gefunden', p_beleg_id;
  END IF;

  IF v_beleg.verbucht THEN
    RAISE EXCEPTION 'Beleg % ist bereits verbucht', p_beleg_id;
  END IF;

  -- Alle Positionen verarbeiten
  FOR v_pos IN
    SELECT p.*, mc.konto_vorsteuer
    FROM fibu_kreditoren_positionen p
    LEFT JOIN fibu_mwst_codes mc
      ON mc.mandant_id = p.mandant_id AND mc.code = p.mwst_code
    WHERE p.beleg_id = p_beleg_id
    ORDER BY p.position
  LOOP
    -- ── Buchung 1: Aufwandskonto SOLL / Kreditoren HABEN ─────────────
    v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben,
      betrag,
      mwst_code, mwst_betrag,
      text,
      quelle, quelle_id, created_by
    ) VALUES (
      v_beleg.mandant_id,
      v_nr,
      v_beleg.belegdatum,
      v_beleg.beleg_nr,
      v_pos.konto_nr,                          -- z.B. 6800 Warenaufwand
      '2000',                                  -- Kreditoren Sammelkonto
      v_pos.betrag_netto,
      v_pos.mwst_code,
      v_pos.betrag_mwst,
      COALESCE(v_pos.bezeichnung, v_beleg.lieferant_name || ' / ' || v_beleg.beleg_nr),
      'kreditoren',
      p_beleg_id,
      v_beleg.gebucht_von
    );

    -- ── Buchung 2: Vorsteuer SOLL / Kreditoren HABEN (nur wenn MWST > 0) ─
    IF v_pos.betrag_mwst > 0 AND v_pos.konto_vorsteuer IS NOT NULL THEN
      v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
        konto_soll, konto_haben,
        betrag,
        mwst_code, mwst_betrag,
        text,
        quelle, quelle_id, created_by
      ) VALUES (
        v_beleg.mandant_id,
        v_nr,
        v_beleg.belegdatum,
        v_beleg.beleg_nr,
        v_pos.konto_vorsteuer,               -- z.B. 1170 Vorsteuer
        '2000',                              -- Kreditoren Sammelkonto
        v_pos.betrag_mwst,
        v_pos.mwst_code,
        v_pos.betrag_mwst,
        'Vorsteuer ' || v_pos.mwst_code || ' / ' || v_beleg.beleg_nr,
        'kreditoren',
        p_beleg_id,
        v_beleg.gebucht_von
      );
    END IF;
  END LOOP;

  -- Beleg als verbucht markieren
  UPDATE fibu_kreditoren_belege
  SET verbucht = true, updated_at = NOW()
  WHERE id = p_beleg_id;

END;
$$;

-- 4. RLS auf fibu_buchungen (falls noch nicht gesetzt)
ALTER TABLE fibu_buchungen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fibu: buchungen lesen" ON fibu_buchungen;
CREATE POLICY "fibu: buchungen lesen" ON fibu_buchungen
  FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- INSERT/UPDATE nur via SECURITY DEFINER Funktionen (fibu_kreditoren_verbuchen etc.)

-- 5. Index für MWST-Abrechnung nach Periode
CREATE INDEX IF NOT EXISTS idx_fibu_buchungen_mwst
  ON fibu_buchungen(mandant_id, mwst_code, buchungsdatum)
  WHERE mwst_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fibu_buchungen_konto
  ON fibu_buchungen(mandant_id, konto_soll, buchungsdatum);

-- 6. Hilfsfunktion: Buchungshistorie für einen Lieferanten (für KI-Vorschlag)
CREATE OR REPLACE FUNCTION fibu_lieferant_buchungshistorie(
  p_mandant_id   UUID,
  p_lieferant_id UUID,
  p_limit        INTEGER DEFAULT 10
)
RETURNS TABLE (
  konto_nr      TEXT,
  bezeichnung   TEXT,
  mwst_code     TEXT,
  mwst_satz     NUMERIC,
  betrag_netto  NUMERIC,
  anzahl        BIGINT,
  zuletzt       DATE
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    p.konto_nr,
    k.bezeichnung,
    p.mwst_code,
    p.mwst_satz,
    AVG(p.betrag_netto)::NUMERIC(14,2) AS betrag_netto,
    COUNT(*)::BIGINT AS anzahl,
    MAX(b.belegdatum) AS zuletzt
  FROM fibu_kreditoren_positionen p
  JOIN fibu_kreditoren_belege b ON b.id = p.beleg_id
  LEFT JOIN fibu_konten k ON k.mandant_id = b.mandant_id AND k.konto_nr = p.konto_nr
  WHERE b.mandant_id = p_mandant_id
    AND b.lieferant_id = p_lieferant_id
    AND b.status != 'storniert'
  GROUP BY p.konto_nr, k.bezeichnung, p.mwst_code, p.mwst_satz
  ORDER BY anzahl DESC, zuletzt DESC
  LIMIT p_limit;
$$;

-- Kommentar: MWST-Abrechnung Quartal
-- SELECT mwst_code, SUM(mwst_betrag) AS vorsteuer_total
-- FROM fibu_buchungen
-- WHERE mandant_id = '...'
--   AND buchungsdatum BETWEEN '2026-01-01' AND '2026-03-31'
--   AND mwst_code IS NOT NULL
--   AND quelle = 'kreditoren'
--   AND NOT storniert
-- GROUP BY mwst_code;
