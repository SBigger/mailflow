-- =====================================================================
-- FiBu: (1) Buchungssperre an MWST-Periode koppeln
--       (2) Fremdwährungs-Kreditoren korrekt verbuchen (CHF-Umrechnung)
-- =====================================================================

-- ── 1. MWST-Periode abschliessen → Buchungssperre nachführen ─────────
CREATE OR REPLACE FUNCTION fibu_mwst_periode_abschliessen(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE,
  p_status     TEXT,
  p_zahllast   NUMERIC DEFAULT NULL,
  p_notizen    TEXT    DEFAULT NULL
)
RETURNS SETOF fibu_mwst_abrechnungsperioden
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result fibu_mwst_abrechnungsperioden;
BEGIN
  IF p_status NOT IN ('offen', 'eingereicht', 'abgerechnet') THEN
    RAISE EXCEPTION 'Ungültiger Status: %', p_status;
  END IF;

  INSERT INTO fibu_mwst_abrechnungsperioden
    (mandant_id, periode_von, periode_bis, status, zahllast_chf, notizen, benutzer_id,
     eingereicht_am, abgerechnet_am)
  VALUES
    (p_mandant_id, p_von, p_bis, p_status, p_zahllast, p_notizen, auth.uid(),
     CASE WHEN p_status IN ('eingereicht','abgerechnet') THEN now() ELSE NULL END,
     CASE WHEN p_status = 'abgerechnet' THEN now() ELSE NULL END)
  ON CONFLICT (mandant_id, periode_von, periode_bis) DO UPDATE SET
    status         = EXCLUDED.status,
    zahllast_chf   = COALESCE(p_zahllast, fibu_mwst_abrechnungsperioden.zahllast_chf),
    notizen        = COALESCE(p_notizen,  fibu_mwst_abrechnungsperioden.notizen),
    benutzer_id    = auth.uid(),
    eingereicht_am = CASE
      WHEN EXCLUDED.status IN ('eingereicht','abgerechnet')
        THEN COALESCE(fibu_mwst_abrechnungsperioden.eingereicht_am, now())
      ELSE NULL END,
    abgerechnet_am = CASE
      WHEN EXCLUDED.status = 'abgerechnet'
        THEN COALESCE(fibu_mwst_abrechnungsperioden.abgerechnet_am, now())
      ELSE NULL END,
    updated_at     = now()
  RETURNING * INTO v_result;

  -- Buchungssperre an die MWST-Perioden koppeln:
  -- gesperrt_bis = Ende der spätesten eingereichten/abgerechneten Periode.
  UPDATE fibu_mandanten m
  SET gesperrt_bis = (
        SELECT MAX(periode_bis)
        FROM fibu_mwst_abrechnungsperioden
        WHERE mandant_id = p_mandant_id
          AND status IN ('eingereicht', 'abgerechnet')
      ),
      updated_at = now()
  WHERE m.id = p_mandant_id;

  RETURN NEXT v_result;
END;
$$;

-- ── 2. Fremdwährung auf Kreditoren-Belegen ───────────────────────────
ALTER TABLE fibu_kreditoren_belege
  ADD COLUMN IF NOT EXISTS kurs NUMERIC(16,8);   -- CHF je 1 Einheit Belegwährung

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
  v_kurs       NUMERIC;
  v_fw         TEXT;          -- Belegwährung (NULL bei CHF)
  v_fw_betrag  NUMERIC;       -- Aufwand/Brutto in Belegwährung
  v_fw_mwst    NUMERIC;       -- MWST in Belegwährung
  v_chf_betrag NUMERIC;       -- ins Hauptbuch (CHF)
  v_chf_mwst   NUMERIC;
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

  -- ── Wechselkurs bestimmen ──────────────────────────────────────────
  IF v_beleg.waehrung IS NULL OR v_beleg.waehrung = 'CHF' THEN
    v_kurs := 1;
    v_fw   := NULL;
  ELSE
    v_fw := v_beleg.waehrung;
    SELECT kurs INTO v_kurs
    FROM fibu_wechselkurse
    WHERE waehrung = v_beleg.waehrung AND typ = 'monat' AND datum <= v_beleg.belegdatum
    ORDER BY datum DESC LIMIT 1;
    IF v_kurs IS NULL THEN
      SELECT kurs INTO v_kurs
      FROM fibu_wechselkurse
      WHERE waehrung = v_beleg.waehrung
      ORDER BY datum DESC LIMIT 1;
    END IF;
    IF v_kurs IS NULL THEN
      RAISE EXCEPTION 'Kein Wechselkurs für % vorhanden – bitte unter Stammdaten › Wechselkurse importieren', v_beleg.waehrung;
    END IF;
  END IF;

  UPDATE fibu_kreditoren_belege SET kurs = v_kurs WHERE id = p_beleg_id;

  FOR v_pos IN
    SELECT p.*, mc.konto_vorsteuer
    FROM fibu_kreditoren_positionen p
    LEFT JOIN fibu_mwst_codes mc
      ON mc.mandant_id = p.mandant_id AND mc.code = p.mwst_code
    WHERE p.beleg_id = p_beleg_id
    ORDER BY p.position
  LOOP
    IF v_gutschrift THEN
      v_aufw_soll  := '2000';                 v_aufw_haben := v_pos.konto_nr;
      v_vst_soll   := '2000';                 v_vst_haben  := v_pos.konto_vorsteuer;
    ELSE
      v_aufw_soll  := v_pos.konto_nr;         v_aufw_haben := '2000';
      v_vst_soll   := v_pos.konto_vorsteuer;  v_vst_haben  := '2000';
    END IF;

    -- Beträge in Belegwährung
    v_fw_betrag := CASE WHEN v_saldo THEN v_pos.betrag_brutto ELSE v_pos.betrag_netto END;
    v_fw_mwst   := COALESCE(v_pos.betrag_mwst, 0);
    -- Umrechnung ins Hauptbuch (CHF)
    v_chf_betrag := ROUND(v_fw_betrag * v_kurs, 2);
    v_chf_mwst   := ROUND(v_fw_mwst   * v_kurs, 2);

    -- ── Buchung 1: Aufwand <-> Kreditoren ────────────────────────────
    v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
      text, quelle, quelle_id, created_by, fw_waehrung, fw_betrag
    ) VALUES (
      v_beleg.mandant_id, v_nr, v_beleg.belegdatum, v_beleg.beleg_nr,
      v_aufw_soll, v_aufw_haben,
      v_chf_betrag,
      CASE WHEN v_saldo THEN NULL ELSE v_pos.mwst_code END,
      CASE WHEN v_saldo THEN 0 ELSE v_mwst_sign * v_chf_mwst END,
      COALESCE(v_pos.bezeichnung, v_beleg.lieferant_name || ' / ' || v_beleg.beleg_nr)
        || CASE WHEN v_gutschrift THEN ' (Gutschrift)' ELSE '' END,
      'kreditoren', p_beleg_id, v_beleg.gebucht_von,
      v_fw, CASE WHEN v_fw IS NULL THEN NULL ELSE v_fw_betrag END
    );

    -- ── Buchung 2: Vorsteuer <-> Kreditoren (nur effektive Methode) ──
    IF NOT v_saldo AND v_fw_mwst > 0 AND v_pos.konto_vorsteuer IS NOT NULL THEN
      v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
        konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
        text, quelle, quelle_id, created_by, fw_waehrung, fw_betrag
      ) VALUES (
        v_beleg.mandant_id, v_nr, v_beleg.belegdatum, v_beleg.beleg_nr,
        v_vst_soll, v_vst_haben,
        v_chf_mwst,
        v_pos.mwst_code, v_mwst_sign * v_chf_mwst,
        'Vorsteuer ' || v_pos.mwst_code || ' / ' || v_beleg.beleg_nr
          || CASE WHEN v_gutschrift THEN ' (Gutschrift)' ELSE '' END,
        'kreditoren', p_beleg_id, v_beleg.gebucht_von,
        v_fw, CASE WHEN v_fw IS NULL THEN NULL ELSE v_fw_mwst END
      );
    END IF;
  END LOOP;

  UPDATE fibu_kreditoren_belege
  SET verbucht = true, updated_at = NOW()
  WHERE id = p_beleg_id;
END;
$$;
