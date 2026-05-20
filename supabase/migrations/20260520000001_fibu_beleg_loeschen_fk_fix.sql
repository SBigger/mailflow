-- Fix: FK-Constraint fibu_kreditoren_belege_storno_beleg_id_fkey
-- Storno-Referenzen (storno_beleg_id) auf den zu löschenden Beleg werden
-- vor dem DELETE auf NULL gesetzt, damit der Self-FK nicht feuert.
-- Gleichzeitig: auch den eigenen storno_beleg_id-Zeiger löschen (aufräumen).
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

  -- FK-Constraint aufheben: andere Belege, die auf diesen zeigen, entkoppeln
  UPDATE fibu_kreditoren_belege
    SET storno_beleg_id = NULL
  WHERE storno_beleg_id = p_beleg_id;

  -- Buchungen via quelle_id löschen (korrekte Spalte)
  DELETE FROM fibu_buchungen WHERE quelle_id = p_beleg_id;
  DELETE FROM fibu_kreditoren_positionen WHERE beleg_id = p_beleg_id;
  DELETE FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
END;
$$;
