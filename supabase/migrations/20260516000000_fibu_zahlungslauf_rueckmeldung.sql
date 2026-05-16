-- =====================================================================
-- FiBu: Zahlungslauf-Rückmeldeschleife
-- Wenn eine Banktransaktion auf einen Kreditoren-Beleg gematcht wird,
-- der Teil eines Zahlungslaufs war, und alle Positionen dieses Laufs
-- bezahlt sind → Zahlungslauf-Status automatisch auf 'verbucht' setzen.
-- =====================================================================

CREATE OR REPLACE FUNCTION fibu_bank_match_kreditor(
  p_tx_id       UUID,
  p_beleg_id    UUID,
  p_betrag      NUMERIC,
  p_datum       DATE,
  p_confidence  NUMERIC,
  p_methode     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lauf_id UUID;
BEGIN
  -- TX als gematcht markieren
  UPDATE fibu_bank_transaktionen SET
    status           = 'gematcht',
    matched_beleg_id = p_beleg_id,
    matched_typ      = 'kreditor',
    match_confidence = p_confidence,
    match_methode    = p_methode
  WHERE id = p_tx_id;

  -- Kreditoren-Beleg: bezahlt_am + status aktualisieren
  UPDATE fibu_kreditoren_belege SET
    betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + p_betrag,
    bezahlt_am     = p_datum,
    status = CASE
      WHEN COALESCE(betrag_bezahlt, 0) + p_betrag >= betrag_brutto THEN 'bezahlt'
      ELSE 'teilbezahlt'
    END
  WHERE id = p_beleg_id;

  -- ── Rückmeldeschleife: betroffene Zahlungsläufe prüfen ──────────────
  FOR v_lauf_id IN
    SELECT DISTINCT zlp.zahlungslauf_id
    FROM fibu_zahlungslauf_positionen zlp
    WHERE zlp.beleg_id = p_beleg_id
  LOOP
    -- Lauf gilt als verbucht, wenn ALLE zugehörigen Belege bezahlt sind
    IF NOT EXISTS (
      SELECT 1
      FROM fibu_zahlungslauf_positionen zlp2
      JOIN fibu_kreditoren_belege kb ON kb.id = zlp2.beleg_id
      WHERE zlp2.zahlungslauf_id = v_lauf_id
        AND kb.status <> 'bezahlt'
    ) THEN
      UPDATE fibu_zahlungslaeufe
      SET status      = 'verbucht',
          verbucht_am = NOW()
      WHERE id = v_lauf_id
        AND status <> 'verbucht';
    END IF;
  END LOOP;
END;
$$;

-- =====================================================================
-- RPC: Zahlungslauf mit Rückmelde-Fortschritt (für die Historie-Ansicht)
-- Gibt je Lauf zurück, wie viele der enthaltenen Belege schon bezahlt sind.
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_zahlungslauf_historie(
  p_mandant_id UUID
)
RETURNS TABLE (
  id                UUID,
  lauf_nr           TEXT,
  valutadatum       DATE,
  zahlungskonto_nr  TEXT,
  total_betrag      NUMERIC,
  anzahl_zahlungen  SMALLINT,
  status            TEXT,
  exportiert_am     TIMESTAMPTZ,
  verbucht_am       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ,
  anzahl_bezahlt    BIGINT,
  hat_xml           BOOLEAN
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    z.id,
    z.lauf_nr,
    z.valutadatum,
    z.zahlungskonto_nr,
    z.total_betrag,
    z.anzahl_zahlungen,
    z.status,
    z.exportiert_am,
    z.verbucht_am,
    z.created_at,
    (
      SELECT COUNT(*)
      FROM fibu_zahlungslauf_positionen zlp
      JOIN fibu_kreditoren_belege kb ON kb.id = zlp.beleg_id
      WHERE zlp.zahlungslauf_id = z.id
        AND kb.status = 'bezahlt'
    )                                       AS anzahl_bezahlt,
    (z.pain001_xml IS NOT NULL)             AS hat_xml
  FROM fibu_zahlungslaeufe z
  WHERE z.mandant_id = p_mandant_id
  ORDER BY z.created_at DESC;
$$;
