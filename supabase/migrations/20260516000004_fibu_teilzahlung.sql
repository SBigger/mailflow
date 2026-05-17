-- =====================================================================
-- FiBu: Teilzahlungen im Zahlungslauf
-- Eine Zahlungslauf-Position kann einen Betrag < Restbetrag haben.
-- Die Rückmeldung erfolgt jetzt PRO POSITION (nicht pro Beleg-Status),
-- damit ein Lauf mit Teilzahlung trotzdem als "verbucht" abschliesst.
-- =====================================================================

ALTER TABLE fibu_zahlungslauf_positionen
  ADD COLUMN IF NOT EXISTS rueckgemeldet     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rueckgemeldet_am  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bank_tx_id        UUID        REFERENCES fibu_bank_transaktionen(id);

-- ── Bank-Match: Position markieren + Lauf-Status pflegen ─────────────
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

  -- Passende offene Zahlungslauf-Position rückmelden
  -- (bevorzugt betragsgleiche Position, sonst älteste offene)
  WITH kandidat AS (
    SELECT zlp.id
    FROM fibu_zahlungslauf_positionen zlp
    JOIN fibu_zahlungslaeufe zl ON zl.id = zlp.zahlungslauf_id
    WHERE zlp.beleg_id = p_beleg_id AND NOT zlp.rueckgemeldet
    ORDER BY (ABS(zlp.betrag - p_betrag) < 0.05) DESC, zl.created_at ASC
    LIMIT 1
  )
  UPDATE fibu_zahlungslauf_positionen zlp
  SET rueckgemeldet = true, rueckgemeldet_am = NOW(), bank_tx_id = p_tx_id
  FROM kandidat WHERE zlp.id = kandidat.id;

  -- Betroffene Läufe: verbucht sobald alle Positionen rückgemeldet sind
  FOR v_lauf_id IN
    SELECT DISTINCT zahlungslauf_id
    FROM fibu_zahlungslauf_positionen
    WHERE beleg_id = p_beleg_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM fibu_zahlungslauf_positionen
      WHERE zahlungslauf_id = v_lauf_id AND NOT rueckgemeldet
    ) THEN
      UPDATE fibu_zahlungslaeufe
      SET status = 'verbucht', verbucht_am = NOW()
      WHERE id = v_lauf_id AND status <> 'verbucht';
    END IF;
  END LOOP;
END;
$$;

-- ── Historie: Fortschritt anhand rückgemeldeter Positionen ───────────
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
    z.id, z.lauf_nr, z.valutadatum, z.zahlungskonto_nr,
    z.total_betrag, z.anzahl_zahlungen, z.status,
    z.exportiert_am, z.verbucht_am, z.created_at,
    (SELECT COUNT(*) FROM fibu_zahlungslauf_positionen zlp
       WHERE zlp.zahlungslauf_id = z.id AND zlp.rueckgemeldet)  AS anzahl_bezahlt,
    (z.pain001_xml IS NOT NULL)                                 AS hat_xml
  FROM fibu_zahlungslaeufe z
  WHERE z.mandant_id = p_mandant_id
  ORDER BY z.created_at DESC;
$$;
