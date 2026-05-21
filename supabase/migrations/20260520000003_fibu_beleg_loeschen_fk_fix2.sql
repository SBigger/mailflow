-- Fix: korrekter Tabellenname fibu_bank_transaktionen (nicht fibu_bank_abstimmung)
-- + matched_beleg_id entkoppeln. Vollständiges, robustes Beleg-Löschen.

CREATE OR REPLACE FUNCTION fibu_delete_kreditoren_beleg(p_beleg_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_beleg fibu_kreditoren_belege%ROWTYPE;
BEGIN
  SELECT * INTO v_beleg FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;

  IF NOT (fibu_user_is_admin_for(v_beleg.mandant_id) OR EXISTS (
    SELECT 1 FROM fibu_user_mandant_access
    WHERE mandant_id = v_beleg.mandant_id
      AND user_id = auth.uid()
      AND role IN ('admin','buchhalter')
  )) THEN
    RAISE EXCEPTION 'Keine Berechtigung';
  END IF;

  IF v_beleg.status IN ('bezahlt','teilbezahlt','ebanking') THEN
    RAISE EXCEPTION 'Beleg kann nicht gelöscht werden – Zahlung bereits verbucht oder in Disposition (Status: %)', v_beleg.status;
  END IF;
  IF COALESCE(v_beleg.betrag_bezahlt, 0) <> 0 THEN
    RAISE EXCEPTION 'Beleg kann nicht gelöscht werden – Zahlung bereits verbucht (CHF %)', v_beleg.betrag_bezahlt;
  END IF;
  IF v_beleg.mwst_abgerechnet THEN
    RAISE EXCEPTION 'Beleg kann nicht gelöscht werden – in MWST-Abrechnung % enthalten', v_beleg.mwst_abrechnung_ref;
  END IF;

  -- ── 1. Storno-Referenz aufheben: andere Belege, die auf diesen zeigen ──
  UPDATE fibu_kreditoren_belege
    SET storno_beleg_id = NULL
  WHERE storno_beleg_id = p_beleg_id;

  -- ── 2. Verrechnungen entfernen (Gutschrift- und Rechnungs-Seite) ──
  DELETE FROM fibu_kreditoren_verrechnungen
   WHERE gutschrift_beleg_id = p_beleg_id
      OR rechnung_beleg_id    = p_beleg_id;

  -- ── 3. Zahlungslauf-Positionen entfernen ──
  DELETE FROM fibu_zahlungslauf_positionen
   WHERE beleg_id = p_beleg_id;

  -- ── 4. Bank-Transaktions-Matches entkoppeln ──
  -- a) direkter Match auf den Beleg
  UPDATE fibu_bank_transaktionen
    SET matched_beleg_id = NULL,
        status = CASE WHEN status IN ('gematcht','vorschlag','verbucht') THEN 'offen' ELSE status END
  WHERE matched_beleg_id = p_beleg_id;
  -- b) Match via Buchung, die zu diesem Beleg gehört (FK buchungs_id)
  UPDATE fibu_bank_transaktionen
    SET buchungs_id = NULL,
        status = CASE WHEN status = 'verbucht' THEN 'offen' ELSE status END
  WHERE buchungs_id IN (
    SELECT id FROM fibu_buchungen WHERE quelle_id = p_beleg_id
  );

  -- ── 5. storno_von Self-FK in fibu_buchungen aufheben ──
  UPDATE fibu_buchungen
    SET storno_von = NULL
  WHERE storno_von IN (
    SELECT id FROM fibu_buchungen WHERE quelle_id = p_beleg_id
  );
  UPDATE fibu_buchungen
    SET storno_von = NULL
  WHERE quelle_id = p_beleg_id;

  -- ── 6. Buchungen löschen ──
  DELETE FROM fibu_buchungen WHERE quelle_id = p_beleg_id;

  -- ── 7. Positionen löschen ──
  DELETE FROM fibu_kreditoren_positionen WHERE beleg_id = p_beleg_id;

  -- ── 8. Beleg selbst löschen ──
  DELETE FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fibu_delete_kreditoren_beleg(UUID) TO authenticated;
