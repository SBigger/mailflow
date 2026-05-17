-- =====================================================================
-- FiBu: MWST Saldosteuersatz-Methode
-- Bei der Saldosteuersatz-Methode (SSS) wird die Steuer pauschal auf
-- dem Bruttoumsatz berechnet – KEIN Vorsteuerabzug. Kreditoren-Belege
-- werden darum brutto auf das Aufwandskonto gebucht (ohne Vorsteuer).
-- =====================================================================

ALTER TABLE fibu_mandanten
  ADD COLUMN IF NOT EXISTS mwst_methode TEXT NOT NULL DEFAULT 'effektiv'
    CHECK (mwst_methode IN ('effektiv', 'saldosteuersatz')),
  ADD COLUMN IF NOT EXISTS saldosteuersatz_prozent NUMERIC(5,2);

-- RPC: MWST-Methode des Mandanten setzen
CREATE OR REPLACE FUNCTION fibu_mandant_mwst_methode_setzen(
  p_mandant_id UUID,
  p_methode    TEXT,
  p_sss        NUMERIC
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF p_methode NOT IN ('effektiv', 'saldosteuersatz') THEN
    RAISE EXCEPTION 'Ungültige MWST-Methode: %', p_methode;
  END IF;
  UPDATE fibu_mandanten
  SET mwst_methode = p_methode,
      saldosteuersatz_prozent = CASE WHEN p_methode = 'saldosteuersatz' THEN p_sss ELSE saldosteuersatz_prozent END,
      updated_at = NOW()
  WHERE id = p_mandant_id;
END;
$$;

-- ── Verbuchungs-RPC: Saldosteuersatz berücksichtigen ─────────────────
CREATE OR REPLACE FUNCTION fibu_kreditoren_verbuchen(p_beleg_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_beleg      RECORD;
  v_pos        RECORD;
  v_nr         TEXT;
  v_gutschrift BOOLEAN;
  v_methode    TEXT;
  v_saldo      BOOLEAN;
  v_aufw_soll  TEXT;
  v_aufw_haben TEXT;
  v_vst_soll   TEXT;
  v_vst_haben  TEXT;
  v_mwst_sign  NUMERIC;
  v_betrag     NUMERIC;
BEGIN
  SELECT b.*, l.name AS lieferant_name
  INTO v_beleg
  FROM fibu_kreditoren_belege b
  JOIN fibu_lieferanten l ON l.id = b.lieferant_id
  WHERE b.id = p_beleg_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beleg % nicht gefunden', p_beleg_id;
  END IF;
  IF v_beleg.verbucht THEN
    RAISE EXCEPTION 'Beleg % ist bereits verbucht', p_beleg_id;
  END IF;

  SELECT mwst_methode INTO v_methode FROM fibu_mandanten WHERE id = v_beleg.mandant_id;
  v_saldo      := (COALESCE(v_methode, 'effektiv') = 'saldosteuersatz');
  v_gutschrift := (v_beleg.belegtyp = 'gutschrift');
  v_mwst_sign  := CASE WHEN v_gutschrift THEN -1 ELSE 1 END;

  FOR v_pos IN
    SELECT p.*, mc.konto_vorsteuer
    FROM fibu_kreditoren_positionen p
    LEFT JOIN fibu_mwst_codes mc
      ON mc.mandant_id = p.mandant_id AND mc.code = p.mwst_code
    WHERE p.beleg_id = p_beleg_id
    ORDER BY p.position
  LOOP
    IF v_gutschrift THEN
      v_aufw_soll  := '2000';            v_aufw_haben := v_pos.konto_nr;
      v_vst_soll   := '2000';            v_vst_haben  := v_pos.konto_vorsteuer;
    ELSE
      v_aufw_soll  := v_pos.konto_nr;    v_aufw_haben := '2000';
      v_vst_soll   := v_pos.konto_vorsteuer; v_vst_haben := '2000';
    END IF;

    -- Saldosteuersatz: brutto aufs Aufwandskonto, kein Vorsteuerabzug
    v_betrag := CASE WHEN v_saldo THEN v_pos.betrag_brutto ELSE v_pos.betrag_netto END;

    -- ── Buchung 1: Aufwand <-> Kreditoren ────────────────────────────
    v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
      text, quelle, quelle_id, created_by
    ) VALUES (
      v_beleg.mandant_id, v_nr, v_beleg.belegdatum, v_beleg.beleg_nr,
      v_aufw_soll, v_aufw_haben,
      v_betrag,
      CASE WHEN v_saldo THEN NULL ELSE v_pos.mwst_code END,
      CASE WHEN v_saldo THEN 0 ELSE v_mwst_sign * v_pos.betrag_mwst END,
      COALESCE(v_pos.bezeichnung, v_beleg.lieferant_name || ' / ' || v_beleg.beleg_nr)
        || CASE WHEN v_gutschrift THEN ' (Gutschrift)' ELSE '' END,
      'kreditoren', p_beleg_id, v_beleg.gebucht_von
    );

    -- ── Buchung 2: Vorsteuer <-> Kreditoren (nur effektive Methode) ──
    IF NOT v_saldo AND v_pos.betrag_mwst > 0 AND v_pos.konto_vorsteuer IS NOT NULL THEN
      v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
        konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
        text, quelle, quelle_id, created_by
      ) VALUES (
        v_beleg.mandant_id, v_nr, v_beleg.belegdatum, v_beleg.beleg_nr,
        v_vst_soll, v_vst_haben,
        v_pos.betrag_mwst,
        v_pos.mwst_code, v_mwst_sign * v_pos.betrag_mwst,
        'Vorsteuer ' || v_pos.mwst_code || ' / ' || v_beleg.beleg_nr
          || CASE WHEN v_gutschrift THEN ' (Gutschrift)' ELSE '' END,
        'kreditoren', p_beleg_id, v_beleg.gebucht_von
      );
    END IF;
  END LOOP;

  UPDATE fibu_kreditoren_belege
  SET verbucht = true, updated_at = NOW()
  WHERE id = p_beleg_id;
END;
$$;
