-- =====================================================================
-- FiBu: Skonto bei Kreditoren-Zahlungen
-- Wird im Zahlungslauf ein Beleg mit Skonto bezahlt, bucht diese RPC
-- den Skonto-Abzug: 2000 Kreditoren SOLL / Aufwandskonto HABEN, plus
-- (bei effektiver Methode) eine Vorsteuer-Korrektur. Der Skonto-Betrag
-- wird dem Beleg als bezahlt gutgeschrieben → mit der Restzahlung der
-- Bank ist der Beleg vollständig ausgeglichen.
-- =====================================================================

CREATE OR REPLACE FUNCTION fibu_skonto_buchen(
  p_beleg_id      UUID,
  p_skonto_betrag NUMERIC,
  p_datum         DATE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_beleg    RECORD;
  v_methode  TEXT;
  v_saldo    BOOLEAN;
  v_pos      RECORD;
  v_vs       NUMERIC;       -- Vorsteuer-Anteil des Skontos
  v_netto    NUMERIC;       -- Netto-Anteil des Skontos
  v_nr       TEXT;
BEGIN
  SELECT * INTO v_beleg FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF v_beleg.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_beleg.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF p_skonto_betrag IS NULL OR p_skonto_betrag <= 0 THEN
    RETURN;
  END IF;

  SELECT mwst_methode INTO v_methode FROM fibu_mandanten WHERE id = v_beleg.mandant_id;
  v_saldo := (COALESCE(v_methode, 'effektiv') = 'saldosteuersatz');

  -- Hauptposition: liefert Aufwandskonto + Vorsteuer-Konto
  SELECT p.*, mc.konto_vorsteuer INTO v_pos
  FROM fibu_kreditoren_positionen p
  LEFT JOIN fibu_mwst_codes mc ON mc.mandant_id = p.mandant_id AND mc.code = p.mwst_code
  WHERE p.beleg_id = p_beleg_id
  ORDER BY p.position
  LIMIT 1;
  IF v_pos.konto_nr IS NULL THEN
    RAISE EXCEPTION 'Beleg % hat keine Positionen', v_beleg.beleg_nr;
  END IF;

  -- Vorsteuer-Anteil (nur effektive Methode, anteilig zum MWST-Satz des Belegs)
  IF NOT v_saldo
     AND COALESCE(v_beleg.betrag_mwst, 0) > 0
     AND COALESCE(v_beleg.betrag_brutto, 0) <> 0
     AND v_pos.konto_vorsteuer IS NOT NULL THEN
    v_vs := ROUND(p_skonto_betrag * ABS(v_beleg.betrag_mwst) / ABS(v_beleg.betrag_brutto), 2);
  ELSE
    v_vs := 0;
  END IF;
  v_netto := p_skonto_betrag - v_vs;

  -- ── Buchung 1: Kreditoren SOLL / Aufwand HABEN (Netto-Anteil) ──────
  v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
  INSERT INTO fibu_buchungen (
    mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
    konto_soll, konto_haben, betrag, text, quelle, quelle_id, created_by
  ) VALUES (
    v_beleg.mandant_id, v_nr, p_datum, v_beleg.beleg_nr,
    '2000', v_pos.konto_nr, v_netto,
    'Skonto ' || v_beleg.beleg_nr, 'kreditoren', p_beleg_id, auth.uid()
  );

  -- ── Buchung 2: Vorsteuer-Korrektur (nur effektiv, wenn MWST) ──────
  IF v_vs > 0 THEN
    v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
      text, quelle, quelle_id, created_by
    ) VALUES (
      v_beleg.mandant_id, v_nr, p_datum, v_beleg.beleg_nr,
      '2000', v_pos.konto_vorsteuer, v_vs,
      v_pos.mwst_code, -v_vs,
      'Skonto Vorsteuer-Korrektur ' || v_beleg.beleg_nr,
      'kreditoren', p_beleg_id, auth.uid()
    );
  END IF;

  -- ── Beleg: Skonto-Betrag als bezahlt gutschreiben ─────────────────
  UPDATE fibu_kreditoren_belege SET
    betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + p_skonto_betrag,
    status = CASE
      WHEN COALESCE(betrag_bezahlt, 0) + p_skonto_betrag >= betrag_brutto - 0.005
        THEN 'bezahlt' ELSE 'teilbezahlt' END,
    updated_at = NOW()
  WHERE id = p_beleg_id;
END;
$$;
