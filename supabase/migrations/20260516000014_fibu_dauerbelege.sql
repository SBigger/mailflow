-- =====================================================================
-- FiBu: Wiederkehrende Kreditoren-Rechnungen (Dauerbelege)
-- Vorlage mit Intervall → erzeugt periodisch echte Kreditoren-Belege.
-- =====================================================================

CREATE TABLE IF NOT EXISTS fibu_kreditoren_dauerbelege (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id             UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  lieferant_id           UUID          NOT NULL REFERENCES fibu_lieferanten(id),
  bezeichnung            TEXT          NOT NULL,
  konto_nr               TEXT          NOT NULL,
  mwst_code              TEXT,
  betrag_brutto          NUMERIC(14,2) NOT NULL,
  waehrung               CHAR(3)       NOT NULL DEFAULT 'CHF',
  intervall              TEXT          NOT NULL
                            CHECK (intervall IN ('monatlich','quartal','halbjahr','jaehrlich')),
  zahlungsbedingung_tage SMALLINT      NOT NULL DEFAULT 30,
  naechstes_belegdatum   DATE          NOT NULL,
  letzte_erzeugung       DATE,
  aktiv                  BOOLEAN       NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fibu_dauerbelege_mandant
  ON fibu_kreditoren_dauerbelege (mandant_id, aktiv);

ALTER TABLE fibu_kreditoren_dauerbelege ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fibu: dauerbelege all" ON fibu_kreditoren_dauerbelege;
CREATE POLICY "fibu: dauerbelege all"
  ON fibu_kreditoren_dauerbelege
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- ── RPC: einen Beleg aus der Vorlage erzeugen, Datum vorrücken ───────
CREATE OR REPLACE FUNCTION fibu_dauerbeleg_erzeugen(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t        fibu_kreditoren_dauerbelege;
  v_satz     NUMERIC;
  v_netto    NUMERIC;
  v_mwst     NUMERIC;
  v_year     TEXT;
  v_last     TEXT;
  v_num      INTEGER;
  v_nr       TEXT;
  v_beleg_id UUID;
BEGIN
  SELECT * INTO v_t FROM fibu_kreditoren_dauerbelege WHERE id = p_id;
  IF v_t.id IS NULL THEN
    RAISE EXCEPTION 'Dauerbeleg nicht gefunden';
  END IF;
  IF NOT (v_t.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  SELECT satz INTO v_satz
  FROM fibu_mwst_codes WHERE mandant_id = v_t.mandant_id AND code = v_t.mwst_code;
  v_satz  := COALESCE(v_satz, 0);
  v_netto := ROUND(v_t.betrag_brutto / (1 + v_satz / 100), 2);
  v_mwst  := v_t.betrag_brutto - v_netto;

  -- Beleg-Nr.  DR-YYYY-NNNN
  v_year := TO_CHAR(v_t.naechstes_belegdatum, 'YYYY');
  SELECT beleg_nr INTO v_last
  FROM fibu_kreditoren_belege
  WHERE mandant_id = v_t.mandant_id AND beleg_nr LIKE 'DR-' || v_year || '-%'
  ORDER BY beleg_nr DESC LIMIT 1;
  v_num := COALESCE(NULLIF(SPLIT_PART(COALESCE(v_last, ''), '-', 3), '')::INTEGER, 0) + 1;
  v_nr  := 'DR-' || v_year || '-' || LPAD(v_num::TEXT, 4, '0');

  INSERT INTO fibu_kreditoren_belege (
    mandant_id, beleg_nr, lieferant_id, belegdatum, faelligkeit,
    zahlungsbedingung_tage, waehrung, betrag_netto, betrag_mwst, betrag_brutto,
    belegtyp, status, notiz, gebucht_von
  ) VALUES (
    v_t.mandant_id, v_nr, v_t.lieferant_id, v_t.naechstes_belegdatum,
    v_t.naechstes_belegdatum + v_t.zahlungsbedingung_tage,
    v_t.zahlungsbedingung_tage, v_t.waehrung, v_netto, v_mwst, v_t.betrag_brutto,
    'rechnung', 'offen', 'Wiederkehrend: ' || v_t.bezeichnung, auth.uid()
  ) RETURNING id INTO v_beleg_id;

  INSERT INTO fibu_kreditoren_positionen (
    mandant_id, beleg_id, position, konto_nr, bezeichnung,
    mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
  ) VALUES (
    v_t.mandant_id, v_beleg_id, 1, v_t.konto_nr, v_t.bezeichnung,
    v_t.mwst_code, v_satz, v_netto, v_mwst, v_t.betrag_brutto
  );

  PERFORM fibu_kreditoren_verbuchen(v_beleg_id);

  UPDATE fibu_kreditoren_dauerbelege SET
    naechstes_belegdatum = (naechstes_belegdatum + CASE intervall
      WHEN 'monatlich' THEN INTERVAL '1 month'
      WHEN 'quartal'   THEN INTERVAL '3 months'
      WHEN 'halbjahr'  THEN INTERVAL '6 months'
      ELSE INTERVAL '1 year' END)::DATE,
    letzte_erzeugung = v_t.naechstes_belegdatum,
    updated_at = NOW()
  WHERE id = p_id;

  RETURN v_beleg_id;
END;
$$;

-- ── RPC: alle fälligen Vorlagen bis zu einem Stichtag erzeugen ───────
CREATE OR REPLACE FUNCTION fibu_dauerbelege_faellige_erzeugen(
  p_mandant_id UUID,
  p_bis        DATE
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id    UUID;
  v_datum DATE;
  v_count INTEGER := 0;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  FOR v_id IN
    SELECT id FROM fibu_kreditoren_dauerbelege
    WHERE mandant_id = p_mandant_id AND aktiv AND naechstes_belegdatum <= p_bis
  LOOP
    LOOP
      SELECT naechstes_belegdatum INTO v_datum
      FROM fibu_kreditoren_dauerbelege WHERE id = v_id;
      EXIT WHEN v_datum > p_bis;
      PERFORM fibu_dauerbeleg_erzeugen(v_id);
      v_count := v_count + 1;
      EXIT WHEN v_count > 200;   -- Sicherung gegen Endlosschleife
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;
