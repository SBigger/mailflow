-- =====================================================================
-- FiBu: Wiederkehrende manuelle Buchungen (Buchungsserien)
-- Ein Gesamtbetrag wird auf N Perioden verteilt (z.B. 12 Monate) und
-- periodisch als manuelle Buchung erzeugt – für Abgrenzungen, AfA usw.
-- Die Summe aller Teilbuchungen ergibt exakt den Gesamtbetrag.
-- =====================================================================

CREATE TABLE IF NOT EXISTS fibu_buchung_serien (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  bezeichnung      TEXT          NOT NULL,
  konto_soll       TEXT          NOT NULL,
  konto_haben      TEXT          NOT NULL,
  betrag_total     NUMERIC(14,2) NOT NULL,
  anzahl_perioden  SMALLINT      NOT NULL DEFAULT 12 CHECK (anzahl_perioden BETWEEN 1 AND 120),
  intervall        TEXT          NOT NULL DEFAULT 'monatlich'
                      CHECK (intervall IN ('monatlich','quartal','jaehrlich')),
  naechstes_datum  DATE          NOT NULL,
  erzeugt_anzahl   SMALLINT      NOT NULL DEFAULT 0,
  letzte_erzeugung DATE,
  aktiv            BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fibu_buchung_serien_mandant
  ON fibu_buchung_serien (mandant_id, aktiv);

ALTER TABLE fibu_buchung_serien ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fibu: buchung_serien all" ON fibu_buchung_serien;
CREATE POLICY "fibu: buchung_serien all"
  ON fibu_buchung_serien
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- ── RPC: nächste Teilbuchung der Serie erzeugen ──────────────────────
CREATE OR REPLACE FUNCTION fibu_buchung_serie_erzeugen(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s        fibu_buchung_serien;
  v_periode  INTEGER;
  v_pro      NUMERIC;
  v_betrag   NUMERIC;
  v_text     TEXT;
  v_beleg_id UUID;
BEGIN
  SELECT * INTO v_s FROM fibu_buchung_serien WHERE id = p_id;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Buchungsserie nicht gefunden';
  END IF;
  IF NOT (v_s.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF v_s.erzeugt_anzahl >= v_s.anzahl_perioden THEN
    RAISE EXCEPTION 'Serie „%" ist vollständig erzeugt', v_s.bezeichnung;
  END IF;

  v_periode := v_s.erzeugt_anzahl + 1;
  v_pro     := ROUND(v_s.betrag_total / v_s.anzahl_perioden, 2);
  -- letzte Periode nimmt den Rundungsrest → Summe = Gesamtbetrag
  IF v_periode < v_s.anzahl_perioden THEN
    v_betrag := v_pro;
  ELSE
    v_betrag := v_s.betrag_total - v_pro * (v_s.anzahl_perioden - 1);
  END IF;
  v_text := v_s.bezeichnung || ' (' || v_periode || '/' || v_s.anzahl_perioden || ')';

  v_beleg_id := fibu_manuelle_buchung_erstellen(
    v_s.mandant_id, v_s.naechstes_datum, v_text, NULL, NULL, 'normal',
    jsonb_build_array(jsonb_build_object(
      'konto_soll', v_s.konto_soll, 'konto_haben', v_s.konto_haben,
      'betrag', v_betrag, 'text', v_text)));

  UPDATE fibu_buchung_serien SET
    erzeugt_anzahl   = v_periode,
    letzte_erzeugung = v_s.naechstes_datum,
    naechstes_datum  = (v_s.naechstes_datum + CASE intervall
        WHEN 'monatlich' THEN INTERVAL '1 month'
        WHEN 'quartal'   THEN INTERVAL '3 months'
        ELSE INTERVAL '1 year' END)::DATE,
    aktiv            = (v_periode < v_s.anzahl_perioden),
    updated_at       = NOW()
  WHERE id = p_id;

  RETURN v_beleg_id;
END;
$$;

-- ── RPC: alle fälligen Serien bis Stichtag erzeugen ──────────────────
CREATE OR REPLACE FUNCTION fibu_buchung_serien_faellige_erzeugen(
  p_mandant_id UUID,
  p_bis        DATE
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id    UUID;
  v_s     fibu_buchung_serien;
  v_count INTEGER := 0;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  FOR v_id IN
    SELECT id FROM fibu_buchung_serien
    WHERE mandant_id = p_mandant_id AND aktiv AND naechstes_datum <= p_bis
  LOOP
    LOOP
      SELECT * INTO v_s FROM fibu_buchung_serien WHERE id = v_id;
      EXIT WHEN NOT v_s.aktiv OR v_s.naechstes_datum > p_bis
                OR v_s.erzeugt_anzahl >= v_s.anzahl_perioden;
      PERFORM fibu_buchung_serie_erzeugen(v_id);
      v_count := v_count + 1;
      EXIT WHEN v_count > 500;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;
