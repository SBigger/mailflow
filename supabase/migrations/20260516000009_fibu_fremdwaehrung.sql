-- =====================================================================
-- FiBu: Fremdwährungs-Unterstützung
-- - Zahlstellen können in USD/EUR/... geführt werden
-- - Buchungen tragen optional einen FW-Betrag (Hauptbuch bleibt CHF)
-- - Saldovorträge von FW-Konten: FW-Saldo + CHF-Saldo
-- =====================================================================

-- ── 1. Währung der Firmenzahlstellen ─────────────────────────────────
ALTER TABLE fibu_zahlstellen
  ADD COLUMN IF NOT EXISTS waehrung CHAR(3) NOT NULL DEFAULT 'CHF';

-- ── 2. FW-Begleitbetrag auf Buchungen (Leitwährung bleibt CHF) ───────
ALTER TABLE fibu_buchungen
  ADD COLUMN IF NOT EXISTS fw_waehrung CHAR(3),
  ADD COLUMN IF NOT EXISTS fw_betrag   NUMERIC(14,2);

-- ── 3. manuelle Buchung: FW-Felder je Zeile übernehmen ───────────────
CREATE OR REPLACE FUNCTION fibu_manuelle_buchung_erstellen(
  p_mandant_id UUID,
  p_datum      DATE,
  p_text       TEXT,
  p_pdf_path   TEXT,
  p_pdf_name   TEXT,
  p_art        TEXT,
  p_zeilen     JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_beleg_id UUID;
  v_beleg_nr TEXT;
  v_year     TEXT := TO_CHAR(p_datum, 'YYYY');
  v_last     TEXT;
  v_num      INTEGER;
  v_quelle   TEXT;
  z          JSONB;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  v_quelle := CASE WHEN p_art = 'saldovortrag' THEN 'abschluss' ELSE 'manuell' END;

  SELECT beleg_nr INTO v_last
  FROM fibu_buchung_belege
  WHERE mandant_id = p_mandant_id AND beleg_nr LIKE 'MB-' || v_year || '-%'
  ORDER BY beleg_nr DESC LIMIT 1;
  v_num := COALESCE(NULLIF(SPLIT_PART(COALESCE(v_last, ''), '-', 3), '')::INTEGER, 0) + 1;
  v_beleg_nr := 'MB-' || v_year || '-' || LPAD(v_num::TEXT, 4, '0');

  INSERT INTO fibu_buchung_belege
    (mandant_id, beleg_nr, buchungsdatum, text, art, pdf_path, pdf_name, created_by)
  VALUES
    (p_mandant_id, v_beleg_nr, p_datum, p_text, COALESCE(p_art, 'normal'),
     p_pdf_path, p_pdf_name, auth.uid())
  RETURNING id INTO v_beleg_id;

  FOR z IN SELECT * FROM jsonb_array_elements(p_zeilen)
  LOOP
    INSERT INTO fibu_buchungen
      (mandant_id, buchungs_nr, buchungsdatum, beleg_ref, konto_soll, konto_haben,
       betrag, mwst_code, mwst_betrag, text, quelle, quelle_id, created_by,
       fw_waehrung, fw_betrag)
    VALUES (
      p_mandant_id, fibu_next_buchungs_nr(p_mandant_id), p_datum, v_beleg_nr,
      z->>'konto_soll', z->>'konto_haben',
      (z->>'betrag')::NUMERIC,
      NULLIF(z->>'mwst_code', ''),
      NULLIF(z->>'mwst_betrag', '')::NUMERIC,
      COALESCE(NULLIF(z->>'text', ''), p_text),
      v_quelle, v_beleg_id, auth.uid(),
      NULLIF(z->>'fw_waehrung', ''),
      NULLIF(z->>'fw_betrag', '')::NUMERIC
    );
  END LOOP;

  RETURN v_beleg_id;
END;
$$;

-- ── 4. Saldovortrag speichern: FW-Saldo je Konto mitführen ───────────
-- p_salden: [{konto_nr, saldo, fw_saldo?, fw_waehrung?}]
--   saldo     = natürlicher CHF-Saldo (wird gebucht)
--   fw_saldo  = natürlicher Fremdwährungs-Saldo (informativ, für FW-Konten)
CREATE OR REPLACE FUNCTION fibu_saldovortrag_speichern(
  p_mandant_id UUID,
  p_jahr       INTEGER,
  p_salden     JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_datum    DATE := MAKE_DATE(p_jahr, 1, 1);
  v_old      UUID;
  v_zeilen   JSONB := '[]'::jsonb;
  s          JSONB;
  v_typ      TEXT;
  v_saldo    NUMERIC;
  v_konto    TEXT;
  v_fw_saldo NUMERIC;
  v_fw_waehr TEXT;
  v_fw_abs   NUMERIC;
  v_beleg    UUID;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  INSERT INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, aktiv)
  VALUES (p_mandant_id, '9100', 'Eröffnungsbilanz', 'abschluss', true)
  ON CONFLICT (mandant_id, konto_nr) DO NOTHING;

  FOR v_old IN
    SELECT id FROM fibu_buchung_belege
    WHERE mandant_id = p_mandant_id AND art = 'saldovortrag' AND buchungsdatum = v_datum
  LOOP
    DELETE FROM fibu_buchungen      WHERE quelle_id = v_old;
    DELETE FROM fibu_buchung_belege WHERE id = v_old;
  END LOOP;

  FOR s IN SELECT * FROM jsonb_array_elements(p_salden)
  LOOP
    v_konto    := s->>'konto_nr';
    v_saldo    := COALESCE(NULLIF(s->>'saldo', '')::NUMERIC, 0);
    v_fw_saldo := NULLIF(s->>'fw_saldo', '')::NUMERIC;
    v_fw_waehr := NULLIF(s->>'fw_waehrung', '');
    CONTINUE WHEN v_saldo = 0 AND COALESCE(v_fw_saldo, 0) = 0;

    v_fw_abs := CASE WHEN v_fw_saldo IS NULL THEN NULL ELSE ABS(v_fw_saldo) END;

    SELECT konto_typ INTO v_typ
    FROM fibu_konten WHERE mandant_id = p_mandant_id AND konto_nr = v_konto;

    IF v_typ = 'aktiv' THEN
      IF v_saldo >= 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', v_konto, 'konto_haben', '9100', 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      ELSE
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', '9100', 'konto_haben', v_konto, 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      END IF;
    ELSE
      IF v_saldo >= 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', '9100', 'konto_haben', v_konto, 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      ELSE
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', v_konto, 'konto_haben', '9100', 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_zeilen) = 0 THEN
    RETURN NULL;
  END IF;

  v_beleg := fibu_manuelle_buchung_erstellen(
    p_mandant_id, v_datum, 'Saldovortrag ' || p_jahr,
    NULL, NULL, 'saldovortrag', v_zeilen);
  RETURN v_beleg;
END;
$$;

-- ── 5. Saldovortrag lesen: CHF- und FW-Saldo ─────────────────────────
DROP FUNCTION IF EXISTS fibu_saldovortrag_lesen(UUID, INTEGER);
CREATE OR REPLACE FUNCTION fibu_saldovortrag_lesen(
  p_mandant_id UUID,
  p_jahr       INTEGER
)
RETURNS TABLE (konto_nr TEXT, saldo NUMERIC, fw_saldo NUMERIC, fw_waehrung TEXT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    k.konto_nr,
    CASE WHEN k.konto_typ = 'aktiv'
         THEN SUM(CASE WHEN b.konto_soll = k.konto_nr THEN b.betrag ELSE -b.betrag END)
         ELSE SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE -b.betrag END)
    END AS saldo,
    CASE WHEN k.konto_typ = 'aktiv'
         THEN SUM(CASE WHEN b.konto_soll = k.konto_nr THEN COALESCE(b.fw_betrag,0) ELSE -COALESCE(b.fw_betrag,0) END)
         ELSE SUM(CASE WHEN b.konto_haben = k.konto_nr THEN COALESCE(b.fw_betrag,0) ELSE -COALESCE(b.fw_betrag,0) END)
    END AS fw_saldo,
    MAX(b.fw_waehrung) AS fw_waehrung
  FROM fibu_buchung_belege bel
  JOIN fibu_buchungen b ON b.quelle_id = bel.id
  JOIN fibu_konten     k ON k.mandant_id = bel.mandant_id
                        AND k.konto_nr IN (b.konto_soll, b.konto_haben)
                        AND k.konto_nr <> '9100'
  WHERE bel.mandant_id = p_mandant_id
    AND bel.art = 'saldovortrag'
    AND bel.buchungsdatum = MAKE_DATE(p_jahr, 1, 1)
  GROUP BY k.konto_nr, k.konto_typ;
$$;
