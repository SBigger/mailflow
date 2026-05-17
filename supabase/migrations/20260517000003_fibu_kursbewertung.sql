-- =====================================================================
-- FiBu: Fremdwährungs-Kursbewertung per Stichtag (Jahresende)
-- Bewertet offene Fremdwährungs-Posten zum Stichtagskurs. Die
-- Bewertungsbuchung wird per Stichtag gebucht und am Folgetag wieder
-- storniert (Stichtagsbewertung – das Hauptbuch läuft unterjährig zum
-- Buchungskurs weiter, die Bewertung wirkt nur auf die Schlussbilanz).
-- =====================================================================

CREATE OR REPLACE FUNCTION fibu_kursbewertung_buchen(
  p_mandant_id UUID,
  p_stichtag   DATE,
  p_konto      TEXT,         -- Kursdifferenz-Konto
  p_betrag     NUMERIC       -- + = Kursverlust, − = Kursgewinn
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_soll   TEXT;
  v_haben  TEXT;
  v_abs    NUMERIC;
  v_beleg  UUID;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  v_abs := ROUND(ABS(p_betrag), 2);
  IF v_abs < 0.01 THEN
    RETURN NULL;   -- keine nennenswerte Differenz
  END IF;

  -- Kursverlust: Aufwand Soll / Kreditoren Haben · Kursgewinn umgekehrt
  IF p_betrag > 0 THEN
    v_soll := p_konto; v_haben := '2000';
  ELSE
    v_soll := '2000';  v_haben := p_konto;
  END IF;

  -- Bewertungsbuchung per Stichtag
  v_beleg := fibu_manuelle_buchung_erstellen(
    p_mandant_id, p_stichtag,
    'FW-Kursbewertung per ' || TO_CHAR(p_stichtag, 'DD.MM.YYYY'),
    NULL, NULL, 'normal',
    jsonb_build_array(jsonb_build_object(
      'konto_soll', v_soll, 'konto_haben', v_haben,
      'betrag', v_abs, 'text', 'FW-Kursbewertung')));

  -- Storno am Folgetag – Bewertung gilt nur zum Stichtag
  PERFORM fibu_manuelle_buchung_erstellen(
    p_mandant_id, p_stichtag + 1,
    'Storno FW-Kursbewertung per ' || TO_CHAR(p_stichtag, 'DD.MM.YYYY'),
    NULL, NULL, 'normal',
    jsonb_build_array(jsonb_build_object(
      'konto_soll', v_haben, 'konto_haben', v_soll,
      'betrag', v_abs, 'text', 'Storno FW-Kursbewertung')));

  RETURN v_beleg;
END;
$$;
