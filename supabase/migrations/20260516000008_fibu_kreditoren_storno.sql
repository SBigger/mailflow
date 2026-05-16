-- =====================================================================
-- FiBu: Storno einer Lieferantenrechnung
-- Schweizer Praxis: gebuchte Belege werden NICHT gelöscht, sondern mit
-- einer Gegenbuchung (Storno-Gutschrift) ausgebucht. Das Storno-Datum
-- ist frei wählbar (z.B. in der laufenden, offenen Periode).
--
-- Die Storno-Gutschrift spiegelt die Rechnung (umgekehrte Buchungs-
-- richtung über belegtyp='gutschrift') → Hauptbuch netto null.
-- Rechnung und Storno-Gutschrift werden auf Status 'storniert' gesetzt.
-- =====================================================================

ALTER TABLE fibu_kreditoren_belege
  ADD COLUMN IF NOT EXISTS storno_beleg_id UUID REFERENCES fibu_kreditoren_belege(id);

CREATE OR REPLACE FUNCTION fibu_kreditoren_storno(
  p_beleg_id     UUID,
  p_storno_datum DATE
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r        fibu_kreditoren_belege;
  v_storno   UUID;
  v_nr       TEXT;
BEGIN
  SELECT * INTO v_r FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_r.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF v_r.belegtyp <> 'rechnung' THEN
    RAISE EXCEPTION 'Nur Rechnungen können storniert werden';
  END IF;
  IF v_r.status = 'storniert' OR v_r.storno_beleg_id IS NOT NULL THEN
    RAISE EXCEPTION 'Beleg % ist bereits storniert', v_r.beleg_nr;
  END IF;
  IF COALESCE(v_r.betrag_bezahlt, 0) <> 0 THEN
    RAISE EXCEPTION 'Rechnung % ist bereits (teil)bezahlt oder verrechnet und kann nicht storniert werden', v_r.beleg_nr;
  END IF;

  -- eindeutige Beleg-Nr. für die Storno-Gutschrift
  v_nr := v_r.beleg_nr || '-S';
  IF EXISTS (SELECT 1 FROM fibu_kreditoren_belege
             WHERE mandant_id = v_r.mandant_id AND beleg_nr = v_nr) THEN
    v_nr := v_r.beleg_nr || '-S' || TO_CHAR(NOW(), 'SSSS');
  END IF;

  -- Storno-Gutschrift anlegen (gespiegelte, negative Beträge)
  INSERT INTO fibu_kreditoren_belege (
    mandant_id, beleg_nr, lieferant_id, lieferant_beleg_nr,
    belegdatum, valutadatum, faelligkeit, zahlungsbedingung_tage,
    waehrung, betrag_netto, betrag_mwst, betrag_brutto,
    belegtyp, status, notiz, gebucht_von
  ) VALUES (
    v_r.mandant_id, v_nr, v_r.lieferant_id, v_r.lieferant_beleg_nr,
    p_storno_datum, p_storno_datum, p_storno_datum, 0,
    v_r.waehrung, -v_r.betrag_netto, -v_r.betrag_mwst, -v_r.betrag_brutto,
    'gutschrift', 'storniert',
    'Storno zu ' || v_r.beleg_nr || COALESCE(' – ' || v_r.notiz, ''),
    auth.uid()
  ) RETURNING id INTO v_storno;

  -- Positionen 1:1 kopieren (positiv – die Verbuchung dreht die Richtung)
  INSERT INTO fibu_kreditoren_positionen (
    mandant_id, beleg_id, position, konto_nr, bezeichnung,
    mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
  )
  SELECT mandant_id, v_storno, position, konto_nr, bezeichnung,
         mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
  FROM fibu_kreditoren_positionen
  WHERE beleg_id = p_beleg_id;

  -- Storno-Gutschrift verbuchen (Gegenbuchung, datiert auf Storno-Datum)
  PERFORM fibu_kreditoren_verbuchen(v_storno);

  -- Original-Rechnung als storniert markieren
  UPDATE fibu_kreditoren_belege
  SET status = 'storniert', storno_beleg_id = v_storno, updated_at = NOW()
  WHERE id = p_beleg_id;

  RETURN v_storno;
END;
$$;
