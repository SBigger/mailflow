-- =====================================================================
-- Mandant anlegen als atomare SECURITY DEFINER Funktion
-- Umgeht RLS komplett, prüft aber auth.uid() manuell.
-- Erstellt Mandant + Access-Zeile + Kontenplan + MWST-Codes in einer TX.
-- =====================================================================

CREATE OR REPLACE FUNCTION fibu_create_mandant(
  p_name    TEXT,
  p_uid     TEXT    DEFAULT NULL,
  p_mwst_nr TEXT    DEFAULT NULL,
  p_ort     TEXT    DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_mandant_id UUID;
  v_user_id    UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'fibu_create_mandant: Nicht authentifiziert (auth.uid() ist NULL)';
  END IF;

  -- 1. Mandant anlegen
  INSERT INTO fibu_mandanten (name, uid, mwst_nr, ort)
  VALUES (
    p_name,
    NULLIF(TRIM(p_uid), ''),
    NULLIF(TRIM(p_mwst_nr), ''),
    NULLIF(TRIM(p_ort), '')
  )
  RETURNING id INTO v_mandant_id;

  -- 2. User als Admin eintragen
  INSERT INTO fibu_user_mandant_access (mandant_id, user_id, role)
  VALUES (v_mandant_id, v_user_id, 'admin');

  -- 3. Kontenplan seeden (~85 Konten)
  PERFORM fibu_seed_kontenplan_ch_kmu(v_mandant_id);

  -- 4. MWST-Codes seeden
  PERFORM fibu_seed_mwst_codes(v_mandant_id);

  RETURN v_mandant_id;
END;
$$;
