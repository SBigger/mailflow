-- =====================================================================
-- FiBu: Belegfreigabe (Visumskontrolle)
-- Optional pro Mandant aktivierbar. Ist sie aktiv, erhalten neu
-- erfasste Kreditoren-Rechnungen den Status 'ausstehend' und müssen
-- vor dem Zahlungslauf freigegeben werden.
-- =====================================================================

ALTER TABLE fibu_mandanten
  ADD COLUMN IF NOT EXISTS belegfreigabe_aktiv BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE fibu_kreditoren_belege
  ADD COLUMN IF NOT EXISTS freigabe_status TEXT NOT NULL DEFAULT 'freigegeben'
    CHECK (freigabe_status IN ('ausstehend', 'freigegeben')),
  ADD COLUMN IF NOT EXISTS freigegeben_am  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS freigegeben_von UUID REFERENCES auth.users(id);

-- ── Trigger: Freigabe-Status bei Neuerfassung setzen ─────────────────
CREATE OR REPLACE FUNCTION fibu_set_freigabe_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_aktiv BOOLEAN;
BEGIN
  -- Gutschriften (inkl. Storno) brauchen keine Freigabe
  IF NEW.belegtyp = 'gutschrift' THEN
    NEW.freigabe_status := 'freigegeben';
    RETURN NEW;
  END IF;
  SELECT belegfreigabe_aktiv INTO v_aktiv FROM fibu_mandanten WHERE id = NEW.mandant_id;
  NEW.freigabe_status := CASE WHEN COALESCE(v_aktiv, false)
                              THEN 'ausstehend' ELSE 'freigegeben' END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_beleg_freigabe ON fibu_kreditoren_belege;
CREATE TRIGGER trg_beleg_freigabe
  BEFORE INSERT ON fibu_kreditoren_belege
  FOR EACH ROW EXECUTE FUNCTION fibu_set_freigabe_status();

-- ── RPC: Beleg freigeben ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fibu_beleg_freigeben(p_beleg_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mandant UUID;
BEGIN
  SELECT mandant_id INTO v_mandant FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF v_mandant IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_mandant = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  UPDATE fibu_kreditoren_belege
  SET freigabe_status = 'freigegeben',
      freigegeben_am  = NOW(),
      freigegeben_von = auth.uid(),
      updated_at      = NOW()
  WHERE id = p_beleg_id;
END;
$$;

-- ── RPC: Belegfreigabe für Mandant ein-/ausschalten ──────────────────
CREATE OR REPLACE FUNCTION fibu_mandant_belegfreigabe_setzen(
  p_mandant_id UUID,
  p_aktiv      BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  UPDATE fibu_mandanten
  SET belegfreigabe_aktiv = COALESCE(p_aktiv, false), updated_at = NOW()
  WHERE id = p_mandant_id;
END;
$$;
