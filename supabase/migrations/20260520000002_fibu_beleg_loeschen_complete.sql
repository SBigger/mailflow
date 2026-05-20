-- Vollständiges Beleg-Löschen: räumt ALLE FK-Abhängigkeiten auf
-- bevor der Beleg + zugehörige Buchungen + Positionen entfernt werden.
--
-- Abhängigkeiten:
--   1. fibu_kreditoren_belege.storno_beleg_id   (Self-FK)
--   2. fibu_kreditoren_verrechnungen            (gutschrift_beleg_id / rechnung_beleg_id)
--   3. fibu_zahlungslauf_positionen.beleg_id    (Zahlungslauf-Items)
--   4. fibu_buchungen.storno_von                (Self-FK Storno-Gegenbuchungen)
--   5. fibu_bank_abstimmung.buchungs_id         (Match zur Bank)
--   6. fibu_rechnung_inbox.beleg_id             (ON DELETE SET NULL → automatisch)
--   7. fibu_kreditoren_positionen.beleg_id      (ON DELETE CASCADE → automatisch)

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

  -- ── 4. Bank-Abstimmungs-Matches auf zugehörige Buchungen aufheben ──
  -- (sonst blockt der FK von fibu_bank_abstimmung.buchungs_id den DELETE)
  UPDATE fibu_bank_abstimmung
    SET buchungs_id = NULL, abgestimmt = FALSE
  WHERE buchungs_id IN (
    SELECT id FROM fibu_buchungen WHERE quelle_id = p_beleg_id
  );

  -- ── 5. storno_von Self-FK in fibu_buchungen aufheben ──
  -- Storno-Buchungen verweisen via storno_von auf die Original-Buchung
  -- → vor dem DELETE entkoppeln, damit der FK nicht feuert.
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

  -- ── 7. Positionen löschen (technisch CASCADE, sicherheitshalber explizit) ──
  DELETE FROM fibu_kreditoren_positionen WHERE beleg_id = p_beleg_id;

  -- ── 8. Beleg selbst löschen ──
  DELETE FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fibu_delete_kreditoren_beleg(UUID) TO authenticated;
