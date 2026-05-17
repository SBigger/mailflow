-- =====================================================================
-- FiBu: MWST-Abrechnungsperioden – Sperrlogik
-- Abgeschlossene Perioden sperren Buchungsänderungen via Trigger.
-- =====================================================================

-- 1. Tabelle fibu_mwst_abrechnungsperioden
CREATE TABLE IF NOT EXISTS fibu_mwst_abrechnungsperioden (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     UUID         NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  periode_von    DATE         NOT NULL,
  periode_bis    DATE         NOT NULL,
  status         TEXT         NOT NULL DEFAULT 'offen'
                   CHECK (status IN ('offen', 'eingereicht', 'abgerechnet')),
  zahllast_chf   NUMERIC(15,2),
  eingereicht_am TIMESTAMPTZ,
  abgerechnet_am TIMESTAMPTZ,
  benutzer_id    UUID         REFERENCES auth.users(id),
  notizen        TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (mandant_id, periode_von, periode_bis)
);

ALTER TABLE fibu_mwst_abrechnungsperioden ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fibu: mwst_perioden all"
  ON fibu_mwst_abrechnungsperioden FOR ALL
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- updated_at Trigger
CREATE OR REPLACE FUNCTION _fibu_mwst_perioden_set_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_mwst_perioden_updated ON fibu_mwst_abrechnungsperioden;
CREATE TRIGGER trg_mwst_perioden_updated
  BEFORE UPDATE ON fibu_mwst_abrechnungsperioden
  FOR EACH ROW EXECUTE FUNCTION _fibu_mwst_perioden_set_updated();

-- 2. RPC: Periode-Status lesen (single row, kein Array)
CREATE OR REPLACE FUNCTION fibu_mwst_periode_get(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE
)
RETURNS SETOF fibu_mwst_abrechnungsperioden
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT * FROM fibu_mwst_abrechnungsperioden
  WHERE mandant_id = p_mandant_id
    AND periode_von = p_von
    AND periode_bis = p_bis
  LIMIT 1;
$$;

-- 3. RPC: Periode-Status setzen (upsert)
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

  RETURN NEXT v_result;
END;
$$;

-- 4. Trigger: Buchungsänderungen in gesperrten MWST-Perioden verbieten
CREATE OR REPLACE FUNCTION fibu_check_buchung_mwst_periode()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
  v_mid    UUID;
  v_datum  DATE;
BEGIN
  v_mid   := COALESCE(NEW.mandant_id, OLD.mandant_id);
  v_datum := COALESCE(NEW.buchungsdatum, OLD.buchungsdatum);

  SELECT status INTO v_status
  FROM fibu_mwst_abrechnungsperioden
  WHERE mandant_id = v_mid
    AND v_datum BETWEEN periode_von AND periode_bis
    AND status IN ('eingereicht', 'abgerechnet')
  LIMIT 1;

  IF v_status IS NOT NULL THEN
    RAISE EXCEPTION
      'MWST_PERIODE_GESPERRT: Buchungsdatum % liegt in einer gesperrten Periode (Status: %). Zuerst Periode zurücksetzen.',
      v_datum, v_status
    USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_buchungen_mwst_periode ON fibu_buchungen;
CREATE TRIGGER trg_buchungen_mwst_periode
  BEFORE INSERT OR UPDATE OF buchungsdatum, mwst_code, mwst_betrag, betrag,
                             konto_soll, konto_haben, storniert
  ON fibu_buchungen
  FOR EACH ROW EXECUTE FUNCTION fibu_check_buchung_mwst_periode();

-- 5. RPC: MWST-Code direkt ändern (via SECURITY DEFINER, Trigger prüft Sperre)
CREATE OR REPLACE FUNCTION fibu_buchung_mwst_code_aendern(
  p_mandant_id UUID,
  p_buchungs_nr TEXT,
  p_mwst_code   TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE fibu_buchungen
  SET mwst_code = p_mwst_code
  WHERE mandant_id = p_mandant_id
    AND buchungs_nr = p_buchungs_nr;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buchung % nicht gefunden', p_buchungs_nr;
  END IF;
END;
$$;

-- 6. fibu_mwst_detail erweitert: buchungs_nr als Editier-Key + quelle_id für Beleg-Link
-- DROP zuerst wegen geändertem Return-Type (quelle_id UUID neu hinzu)
DROP FUNCTION IF EXISTS fibu_mwst_detail(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION fibu_mwst_detail(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  buchungs_nr    TEXT,
  buchungsdatum  DATE,
  beleg_ref      TEXT,
  quelle_id      UUID,
  konto_soll     TEXT,
  konto_soll_bez TEXT,
  mwst_code      TEXT,
  mwst_satz      NUMERIC,
  betrag_netto   NUMERIC,
  mwst_betrag    NUMERIC,
  mwst_erwartet  NUMERIC,
  differenz      NUMERIC,
  text           TEXT,
  quelle         TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    b.buchungs_nr,
    b.buchungsdatum,
    b.beleg_ref,
    b.quelle_id,
    b.konto_soll,
    k.bezeichnung                                    AS konto_soll_bez,
    b.mwst_code,
    mc.satz                                          AS mwst_satz,
    ROUND(b.betrag, 2)                               AS betrag_netto,
    ROUND(COALESCE(b.mwst_betrag, 0), 2)             AS mwst_betrag,
    ROUND(b.betrag * COALESCE(mc.satz, 0) / 100, 2) AS mwst_erwartet,
    ROUND(COALESCE(b.mwst_betrag, 0) - b.betrag * COALESCE(mc.satz, 0) / 100, 2) AS differenz,
    b.text,
    b.quelle
  FROM fibu_buchungen b
  LEFT JOIN fibu_konten k
    ON k.mandant_id = b.mandant_id AND k.konto_nr = b.konto_soll
  LEFT JOIN fibu_mwst_codes mc
    ON mc.mandant_id = b.mandant_id AND mc.code = b.mwst_code
  WHERE b.mandant_id = p_mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND b.mwst_code IS NOT NULL
    AND NOT b.storniert
  ORDER BY b.buchungsdatum, b.buchungs_nr;
$$;
