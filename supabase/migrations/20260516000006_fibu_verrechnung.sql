-- =====================================================================
-- FiBu: Verrechnung von Lieferanten-Gutschriften
-- Eine offene Gutschrift wird gegen die offenen Rechnungen desselben
-- Lieferanten aufgerechnet (FIFO nach Belegdatum).
--
-- Buchhalterisch GL-neutral: Rechnung UND Gutschrift sind bereits auf
-- Konto 2000 gebucht. Die Verrechnung gleicht nur die Offenen Posten
-- aus (betrag_bezahlt / status), es entsteht keine neue Hauptbuchung.
-- Der Zahlungslauf zahlt danach automatisch nur noch die Differenz.
-- =====================================================================

CREATE TABLE IF NOT EXISTS fibu_kreditoren_verrechnungen (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id           UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  gutschrift_beleg_id  UUID          NOT NULL REFERENCES fibu_kreditoren_belege(id),
  rechnung_beleg_id    UUID          NOT NULL REFERENCES fibu_kreditoren_belege(id),
  betrag               NUMERIC(14,2) NOT NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by           UUID          REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS fibu_verrechnung_mandant
  ON fibu_kreditoren_verrechnungen (mandant_id, created_at DESC);

ALTER TABLE fibu_kreditoren_verrechnungen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fibu: verrechnungen all" ON fibu_kreditoren_verrechnungen;
CREATE POLICY "fibu: verrechnungen all"
  ON fibu_kreditoren_verrechnungen
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- ── RPC: Gutschrift gegen offene Rechnungen verrechnen (FIFO) ────────
CREATE OR REPLACE FUNCTION fibu_gutschrift_verrechnen(
  p_mandant_id    UUID,
  p_gutschrift_id UUID
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gs    RECORD;
  v_offen NUMERIC;     -- noch zu verrechnender Gutschrift-Betrag (positiv)
  v_rest  NUMERIC;
  v_x     NUMERIC;
  v_r     RECORD;
  v_total NUMERIC := 0;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  SELECT * INTO v_gs FROM fibu_kreditoren_belege
  WHERE id = p_gutschrift_id AND mandant_id = p_mandant_id AND belegtyp = 'gutschrift';
  IF v_gs.id IS NULL THEN
    RAISE EXCEPTION 'Gutschrift nicht gefunden';
  END IF;

  -- offener Gutschrift-Betrag (Beträge sind bei Gutschriften negativ)
  v_offen := ABS(v_gs.betrag_brutto) - ABS(COALESCE(v_gs.betrag_bezahlt, 0));
  IF v_offen <= 0.005 THEN
    RAISE EXCEPTION 'Gutschrift ist bereits vollständig verrechnet';
  END IF;

  FOR v_r IN
    SELECT * FROM fibu_kreditoren_belege
    WHERE mandant_id = p_mandant_id
      AND lieferant_id = v_gs.lieferant_id
      AND belegtyp = 'rechnung'
      AND status IN ('offen', 'teilbezahlt')
    ORDER BY belegdatum, beleg_nr
  LOOP
    EXIT WHEN v_offen <= 0.005;
    v_rest := v_r.betrag_brutto - COALESCE(v_r.betrag_bezahlt, 0);
    CONTINUE WHEN v_rest <= 0.005;

    v_x := LEAST(v_rest, v_offen);

    -- Rechnung: betrag_bezahlt erhöhen
    UPDATE fibu_kreditoren_belege SET
      betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + v_x,
      status = CASE WHEN COALESCE(betrag_bezahlt, 0) + v_x >= betrag_brutto - 0.005
                    THEN 'bezahlt' ELSE 'teilbezahlt' END,
      updated_at = NOW()
    WHERE id = v_r.id;

    -- Gutschrift: betrag_bezahlt (negativ) Richtung betrag_brutto bewegen
    UPDATE fibu_kreditoren_belege SET
      betrag_bezahlt = COALESCE(betrag_bezahlt, 0) - v_x,
      status = CASE WHEN ABS(COALESCE(betrag_bezahlt, 0) - v_x) >= ABS(betrag_brutto) - 0.005
                    THEN 'bezahlt' ELSE 'teilbezahlt' END,
      updated_at = NOW()
    WHERE id = v_gs.id;

    INSERT INTO fibu_kreditoren_verrechnungen
      (mandant_id, gutschrift_beleg_id, rechnung_beleg_id, betrag, created_by)
    VALUES (p_mandant_id, v_gs.id, v_r.id, v_x, auth.uid());

    v_offen := v_offen - v_x;
    v_total := v_total + v_x;
  END LOOP;

  RETURN v_total;
END;
$$;
