-- =====================================================================
-- FiBu: Zahlungslauf-Lebenszyklus
--   A) Verbuchung beim Bankabgleich (camt) -> GL-Buchung Soll 2000 / Haben Bank
--   B) Zahlungslauf zurücknehmen (stornieren) -> Belege wieder offen
--   C) Rückmeldung pro Position (ausgeführt / storniert)
--   D) Doppelzahlungsschutz (ein Beleg nur in EINEM aktiven Lauf)
-- =====================================================================

-- ── Schema: Lauf-Status um 'storniert' (+ 'teilverbucht') erweitern ──
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'fibu_zahlungslaeufe' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP EXECUTE 'ALTER TABLE fibu_zahlungslaeufe DROP CONSTRAINT ' || quote_ident(c); END LOOP;
END $$;
ALTER TABLE fibu_zahlungslaeufe ADD CONSTRAINT fibu_zahlungslaeufe_status_check
  CHECK (status IN ('entwurf','freigegeben','exportiert','teilverbucht','verbucht','storniert'));

-- ── Schema: Position-Status (offen | ausgefuehrt | storniert) ──
ALTER TABLE fibu_zahlungslauf_positionen
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'offen';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'fibu_zahlungslauf_positionen' AND conname = 'fibu_zlp_status_check'
  ) THEN
    ALTER TABLE fibu_zahlungslauf_positionen
      ADD CONSTRAINT fibu_zlp_status_check CHECK (status IN ('offen','ausgefuehrt','storniert'));
  END IF;
END $$;

-- ── D) Doppelzahlungsschutz: ein Beleg nur in EINEM aktiven Lauf ──
-- Aktiv = Lauf nicht storniert UND Position nicht storniert.
CREATE OR REPLACE FUNCTION fibu_zlp_no_double() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM fibu_zahlungslauf_positionen zlp
    JOIN fibu_zahlungslaeufe z ON z.id = zlp.zahlungslauf_id
    WHERE zlp.beleg_id = NEW.beleg_id
      AND zlp.id <> NEW.id
      AND COALESCE(zlp.status,'offen') <> 'storniert'
      AND z.status <> 'storniert'
  ) THEN
    RAISE EXCEPTION 'Beleg % ist bereits in einem aktiven Zahlungslauf', NEW.beleg_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fibu_zlp_no_double ON fibu_zahlungslauf_positionen;
CREATE TRIGGER trg_fibu_zlp_no_double
  BEFORE INSERT ON fibu_zahlungslauf_positionen
  FOR EACH ROW EXECUTE FUNCTION fibu_zlp_no_double();

-- ── A) Bankabgleich erzeugt jetzt die Zahlungs-Hauptbuchung ──
-- Soll 2000 Kreditoren / Haben <Bankkonto>; Betrag = effektiver camt-Betrag.
CREATE OR REPLACE FUNCTION fibu_bank_match_kreditor(
  p_tx_id       UUID,
  p_beleg_id    UUID,
  p_betrag      NUMERIC,
  p_datum       DATE,
  p_confidence  NUMERIC,
  p_methode     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lauf_id   UUID;
  v_mandant   UUID;
  v_belegnr   TEXT;
  v_bankkonto TEXT;
  v_bnr       TEXT;
  v_buchung   UUID;
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

  -- ── GL-Buchung der Zahlung: Soll 2000 / Haben Bankkonto ──
  SELECT mandant_id, beleg_nr INTO v_mandant, v_belegnr
  FROM fibu_kreditoren_belege WHERE id = p_beleg_id;

  SELECT COALESCE(NULLIF(bi.konto_nr, ''), '1020') INTO v_bankkonto
  FROM fibu_bank_transaktionen bt
  LEFT JOIN fibu_bank_imports bi ON bi.id = bt.import_id
  WHERE bt.id = p_tx_id;
  v_bankkonto := COALESCE(v_bankkonto, '1020');

  IF v_mandant IS NOT NULL AND p_betrag <> 0 THEN
    v_bnr := fibu_next_buchungs_nr(v_mandant);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, text, quelle, quelle_id, created_by
    ) VALUES (
      v_mandant, v_bnr, p_datum, v_belegnr,
      '2000', v_bankkonto, p_betrag,
      'Zahlung ' || COALESCE(v_belegnr, ''), 'zahlungslauf', p_beleg_id, auth.uid()
    ) RETURNING id INTO v_buchung;
    UPDATE fibu_bank_transaktionen SET buchungs_id = v_buchung WHERE id = p_tx_id;
  END IF;

  -- ── Rückmeldeschleife: betroffene Zahlungsläufe auf 'verbucht' ──
  FOR v_lauf_id IN
    SELECT DISTINCT zlp.zahlungslauf_id
    FROM fibu_zahlungslauf_positionen zlp
    WHERE zlp.beleg_id = p_beleg_id
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM fibu_zahlungslauf_positionen zlp2
      JOIN fibu_kreditoren_belege kb ON kb.id = zlp2.beleg_id
      WHERE zlp2.zahlungslauf_id = v_lauf_id
        AND COALESCE(zlp2.status,'offen') <> 'storniert'
        AND kb.status <> 'bezahlt'
    ) THEN
      UPDATE fibu_zahlungslaeufe
      SET status = 'verbucht', verbucht_am = NOW()
      WHERE id = v_lauf_id AND status NOT IN ('verbucht','storniert');
    END IF;
  END LOOP;
END $$;

-- ── C) Rückmeldung pro Position (ausgeführt / storniert) ──
CREATE OR REPLACE FUNCTION fibu_zahlungslauf_rueckmelden(
  p_lauf_id    UUID,
  p_positionen JSONB   -- [{ "position_id": "...", "status": "ausgefuehrt" | "storniert" }]
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e        JSONB;
  v_posid  UUID;
  v_status TEXT;
  v_beleg  UUID;
BEGIN
  FOR e IN SELECT * FROM jsonb_array_elements(p_positionen)
  LOOP
    v_posid  := (e->>'position_id')::UUID;
    v_status := e->>'status';
    IF v_status NOT IN ('ausgefuehrt','storniert') THEN CONTINUE; END IF;

    UPDATE fibu_zahlungslauf_positionen
      SET status = v_status, rueckgemeldet = true, rueckgemeldet_am = NOW()
      WHERE id = v_posid AND zahlungslauf_id = p_lauf_id
      RETURNING beleg_id INTO v_beleg;

    -- Storniert: Beleg (falls noch ebanking) wieder offen -> erneut zahlbar
    IF v_status = 'storniert' AND v_beleg IS NOT NULL THEN
      UPDATE fibu_kreditoren_belege
        SET status = 'offen', updated_at = NOW()
        WHERE id = v_beleg AND status = 'ebanking';
    END IF;
  END LOOP;

  -- Alle Positionen storniert -> ganzer Lauf storniert
  IF NOT EXISTS (
    SELECT 1 FROM fibu_zahlungslauf_positionen
    WHERE zahlungslauf_id = p_lauf_id AND COALESCE(status,'offen') <> 'storniert'
  ) THEN
    UPDATE fibu_zahlungslaeufe SET status = 'storniert' WHERE id = p_lauf_id;
  END IF;
END $$;

-- ── B) Ganzen Zahlungslauf zurücknehmen ──
CREATE OR REPLACE FUNCTION fibu_zahlungslauf_stornieren(
  p_lauf_id UUID,
  p_datum   DATE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  b RECORD;
BEGIN
  FOR r IN
    SELECT zlp.id AS pos_id, zlp.beleg_id, zlp.betrag,
           kb.status AS beleg_status, kb.mandant_id
    FROM fibu_zahlungslauf_positionen zlp
    JOIN fibu_kreditoren_belege kb ON kb.id = zlp.beleg_id
    WHERE zlp.zahlungslauf_id = p_lauf_id
      AND COALESCE(zlp.status,'offen') <> 'storniert'
  LOOP
    IF r.beleg_status IN ('bezahlt','teilbezahlt') THEN
      -- bereits via camt gebuchte Zahlung gegenbuchen (Konten getauscht)
      FOR b IN
        SELECT * FROM fibu_buchungen
        WHERE quelle = 'zahlungslauf' AND quelle_id = r.beleg_id AND NOT storniert
      LOOP
        INSERT INTO fibu_buchungen (
          mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
          konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
          text, quelle, quelle_id, storniert, storno_von, created_by
        ) VALUES (
          b.mandant_id, fibu_next_buchungs_nr(b.mandant_id), p_datum, b.beleg_ref,
          b.konto_haben, b.konto_soll, b.betrag, b.mwst_code, b.mwst_betrag,
          'Storno ' || COALESCE(b.text, 'Zahlung'), 'zahlungslauf', r.beleg_id, true, b.id, auth.uid()
        );
        UPDATE fibu_buchungen SET storniert = true WHERE id = b.id;
      END LOOP;

      UPDATE fibu_kreditoren_belege
        SET betrag_bezahlt = GREATEST(0, COALESCE(betrag_bezahlt,0) - r.betrag),
            bezahlt_am = NULL, status = 'offen', updated_at = NOW()
        WHERE id = r.beleg_id;

      -- zugehörige Bank-TX wieder entkoppeln
      UPDATE fibu_bank_transaktionen
        SET status = 'offen', matched_beleg_id = NULL, matched_typ = NULL,
            match_confidence = NULL, match_methode = NULL, buchungs_id = NULL
        WHERE matched_beleg_id = r.beleg_id AND matched_typ = 'kreditor';

    ELSIF r.beleg_status = 'ebanking' THEN
      UPDATE fibu_kreditoren_belege SET status = 'offen', updated_at = NOW()
        WHERE id = r.beleg_id;
    END IF;

    UPDATE fibu_zahlungslauf_positionen
      SET status = 'storniert', rueckgemeldet = true, rueckgemeldet_am = NOW()
      WHERE id = r.pos_id;
  END LOOP;

  UPDATE fibu_zahlungslaeufe SET status = 'storniert' WHERE id = p_lauf_id;
END $$;

-- ── Historie-RPC: Position-Status mitliefern (für Rückmelde-UI) ──
CREATE OR REPLACE FUNCTION fibu_zahlungslauf_positionen_get(
  p_lauf_id UUID
) RETURNS TABLE (
  id UUID, beleg_id UUID, beleg_nr TEXT, lieferant_name TEXT,
  iban TEXT, betrag NUMERIC, status TEXT, beleg_status TEXT, rueckgemeldet BOOLEAN
) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT zlp.id, zlp.beleg_id, kb.beleg_nr, l.name,
         zlp.iban, zlp.betrag, COALESCE(zlp.status,'offen'), kb.status, zlp.rueckgemeldet
  FROM fibu_zahlungslauf_positionen zlp
  JOIN fibu_kreditoren_belege kb ON kb.id = zlp.beleg_id
  LEFT JOIN fibu_lieferanten l   ON l.id = zlp.lieferant_id
  WHERE zlp.zahlungslauf_id = p_lauf_id
  ORDER BY kb.beleg_nr;
$$;
