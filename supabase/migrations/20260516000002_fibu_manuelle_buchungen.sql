-- =====================================================================
-- FiBu P1: Buchungssperre + Manuelle Buchungen + Saldovorträge
--
-- - Buchungssperre: gesperrt_bis pro Mandant, Trigger blockt jede
--   Buchung (Insert/Update/Delete) in der gesperrten Periode.
-- - Manuelle Buchungen: fibu_buchung_belege (Beleg-Kopf mit PDF),
--   1..n Buchungssätze in fibu_buchungen (quelle='manuell').
-- - Korrektur = Storno-Beleg (Gegenbuchung, Original auf 0) + Neubeleg.
-- - Saldovorträge: Eröffnungssalden gegen Konto 9100.
-- =====================================================================

-- ── 1. Buchungssperre ────────────────────────────────────────────────
ALTER TABLE fibu_mandanten
  ADD COLUMN IF NOT EXISTS gesperrt_bis DATE;

CREATE OR REPLACE FUNCTION fibu_check_buchungssperre()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_sperre  DATE;
  v_mandant UUID;
  v_datum   DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_mandant := OLD.mandant_id; v_datum := OLD.buchungsdatum;
  ELSE
    v_mandant := NEW.mandant_id; v_datum := NEW.buchungsdatum;
  END IF;

  SELECT gesperrt_bis INTO v_sperre FROM fibu_mandanten WHERE id = v_mandant;
  IF v_sperre IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_datum <= v_sperre THEN
    RAISE EXCEPTION 'Buchungssperre aktiv: Das Datum % liegt in der gesperrten Periode (gesperrt bis %).', v_datum, v_sperre
      USING ERRCODE = 'check_violation';
  END IF;
  -- Beim Verschieben einer Buchung aus der Sperre heraus: altes Datum prüfen
  IF TG_OP = 'UPDATE' AND OLD.buchungsdatum <= v_sperre THEN
    RAISE EXCEPTION 'Buchungssperre aktiv: Die Buchung vom % ist gesperrt.', OLD.buchungsdatum
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_buchungen_sperre ON fibu_buchungen;
CREATE TRIGGER trg_buchungen_sperre
  BEFORE INSERT OR UPDATE OR DELETE ON fibu_buchungen
  FOR EACH ROW EXECUTE FUNCTION fibu_check_buchungssperre();

-- RPC: Buchungssperre setzen / aufheben (p_datum NULL = keine Sperre)
CREATE OR REPLACE FUNCTION fibu_buchungssperre_setzen(p_mandant_id UUID, p_datum DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  UPDATE fibu_mandanten SET gesperrt_bis = p_datum WHERE id = p_mandant_id;
END;
$$;

-- ── 2. Beleg-Kopf für manuelle Buchungen ─────────────────────────────
CREATE TABLE IF NOT EXISTS fibu_buchung_belege (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        UUID         NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  beleg_nr          TEXT         NOT NULL,            -- MB-2026-0001
  buchungsdatum     DATE         NOT NULL,
  text              TEXT,
  art               TEXT         NOT NULL DEFAULT 'normal'
                       CHECK (art IN ('normal', 'storno', 'saldovortrag')),
  pdf_path          TEXT,
  pdf_name          TEXT,
  storniert         BOOLEAN      NOT NULL DEFAULT false,
  storno_beleg_id   UUID         REFERENCES fibu_buchung_belege(id),
  original_beleg_id UUID         REFERENCES fibu_buchung_belege(id),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by        UUID         REFERENCES auth.users(id),
  UNIQUE(mandant_id, beleg_nr)
);
CREATE INDEX IF NOT EXISTS fibu_buchung_belege_mandant
  ON fibu_buchung_belege (mandant_id, buchungsdatum DESC);

ALTER TABLE fibu_buchung_belege ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fibu: buchung_belege all" ON fibu_buchung_belege;
CREATE POLICY "fibu: buchung_belege all"
  ON fibu_buchung_belege
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- ── 3. Storage-Bucket für Beleg-PDFs ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fibu-belege', 'fibu-belege', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "fibu belege storage lesen"     ON storage.objects;
DROP POLICY IF EXISTS "fibu belege storage schreiben" ON storage.objects;
DROP POLICY IF EXISTS "fibu belege storage loeschen"  ON storage.objects;

CREATE POLICY "fibu belege storage lesen" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'fibu-belege'
    AND (storage.foldername(name))[1] = ANY(
      SELECT id::TEXT FROM fibu_mandanten WHERE id = ANY(fibu_mandant_ids_for_user())));

CREATE POLICY "fibu belege storage schreiben" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'fibu-belege'
    AND (storage.foldername(name))[1] = ANY(
      SELECT id::TEXT FROM fibu_mandanten WHERE id = ANY(fibu_mandant_ids_for_user())));

CREATE POLICY "fibu belege storage loeschen" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'fibu-belege'
    AND (storage.foldername(name))[1] = ANY(
      SELECT id::TEXT FROM fibu_mandanten WHERE id = ANY(fibu_mandant_ids_for_user())));

-- ── 4. Konto 9100 Eröffnungsbilanz (für alle Mandanten sicherstellen) ─
INSERT INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, aktiv)
SELECT id, '9100', 'Eröffnungsbilanz', 'abschluss', true FROM fibu_mandanten
ON CONFLICT (mandant_id, konto_nr) DO NOTHING;

-- ── 5. RPC: manuelle Buchung erstellen ───────────────────────────────
-- p_zeilen: [{konto_soll, konto_haben, betrag, mwst_code?, mwst_betrag?, text?}]
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
       betrag, mwst_code, mwst_betrag, text, quelle, quelle_id, created_by)
    VALUES (
      p_mandant_id, fibu_next_buchungs_nr(p_mandant_id), p_datum, v_beleg_nr,
      z->>'konto_soll', z->>'konto_haben',
      (z->>'betrag')::NUMERIC,
      NULLIF(z->>'mwst_code', ''),
      NULLIF(z->>'mwst_betrag', '')::NUMERIC,
      COALESCE(NULLIF(z->>'text', ''), p_text),
      v_quelle, v_beleg_id, auth.uid()
    );
  END LOOP;

  RETURN v_beleg_id;
END;
$$;

-- ── 6. RPC: manuelle Buchung stornieren (Gegenbuchung) ───────────────
CREATE OR REPLACE FUNCTION fibu_manuelle_buchung_stornieren(
  p_beleg_id     UUID,
  p_storno_datum DATE
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orig     fibu_buchung_belege;
  v_storno   UUID;
  v_zeilen   JSONB;
BEGIN
  SELECT * INTO v_orig FROM fibu_buchung_belege WHERE id = p_beleg_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF v_orig.storniert THEN
    RAISE EXCEPTION 'Beleg % ist bereits storniert', v_orig.beleg_nr;
  END IF;

  -- Gegenbuchungen: Soll/Haben vertauscht → Originalwirkung auf 0
  SELECT jsonb_agg(jsonb_build_object(
           'konto_soll',  b.konto_haben,
           'konto_haben', b.konto_soll,
           'betrag',      b.betrag,
           'mwst_code',   b.mwst_code,
           'mwst_betrag', b.mwst_betrag,
           'text',        'Storno: ' || COALESCE(b.text, '')))
  INTO v_zeilen
  FROM fibu_buchungen b
  WHERE b.quelle_id = p_beleg_id AND NOT b.storniert;

  v_storno := fibu_manuelle_buchung_erstellen(
    v_orig.mandant_id, p_storno_datum,
    'Storno zu ' || v_orig.beleg_nr || COALESCE(' – ' || v_orig.text, ''),
    NULL, NULL, 'storno', COALESCE(v_zeilen, '[]'::jsonb));

  UPDATE fibu_buchung_belege SET original_beleg_id = p_beleg_id WHERE id = v_storno;
  UPDATE fibu_buchung_belege
    SET storniert = true, storno_beleg_id = v_storno
    WHERE id = p_beleg_id;

  RETURN v_storno;
END;
$$;

-- ── 7. RPC: manuelle Buchung korrigieren (Storno + Neubeleg) ─────────
CREATE OR REPLACE FUNCTION fibu_manuelle_buchung_korrigieren(
  p_beleg_id  UUID,
  p_datum     DATE,
  p_text      TEXT,
  p_pdf_path  TEXT,
  p_pdf_name  TEXT,
  p_zeilen    JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mandant UUID;
  v_neu     UUID;
BEGIN
  SELECT mandant_id INTO v_mandant FROM fibu_buchung_belege WHERE id = p_beleg_id;
  IF v_mandant IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;

  PERFORM fibu_manuelle_buchung_stornieren(p_beleg_id, p_datum);

  v_neu := fibu_manuelle_buchung_erstellen(
    v_mandant, p_datum, p_text, p_pdf_path, p_pdf_name, 'normal', p_zeilen);
  UPDATE fibu_buchung_belege SET original_beleg_id = p_beleg_id WHERE id = v_neu;

  RETURN v_neu;
END;
$$;

-- ── 8. RPC: Saldovorträge speichern ──────────────────────────────────
-- p_salden: [{konto_nr, saldo}]  – saldo = natürlicher Saldo
--   (Aktivkonto: Sollsaldo positiv · Passivkonto: Habensaldo positiv)
CREATE OR REPLACE FUNCTION fibu_saldovortrag_speichern(
  p_mandant_id UUID,
  p_jahr       INTEGER,
  p_salden     JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_datum   DATE := MAKE_DATE(p_jahr, 1, 1);
  v_old     UUID;
  v_zeilen  JSONB := '[]'::jsonb;
  s         JSONB;
  v_typ     TEXT;
  v_saldo   NUMERIC;
  v_konto   TEXT;
  v_beleg   UUID;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  INSERT INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, aktiv)
  VALUES (p_mandant_id, '9100', 'Eröffnungsbilanz', 'abschluss', true)
  ON CONFLICT (mandant_id, konto_nr) DO NOTHING;

  -- bestehenden Saldovortrag dieses Jahres entfernen
  FOR v_old IN
    SELECT id FROM fibu_buchung_belege
    WHERE mandant_id = p_mandant_id AND art = 'saldovortrag' AND buchungsdatum = v_datum
  LOOP
    DELETE FROM fibu_buchungen      WHERE quelle_id = v_old;
    DELETE FROM fibu_buchung_belege WHERE id = v_old;
  END LOOP;

  FOR s IN SELECT * FROM jsonb_array_elements(p_salden)
  LOOP
    v_konto := s->>'konto_nr';
    v_saldo := COALESCE(NULLIF(s->>'saldo', '')::NUMERIC, 0);
    CONTINUE WHEN v_saldo = 0;

    SELECT konto_typ INTO v_typ
    FROM fibu_konten WHERE mandant_id = p_mandant_id AND konto_nr = v_konto;

    IF v_typ = 'aktiv' THEN
      IF v_saldo > 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', v_konto, 'konto_haben', '9100', 'betrag', v_saldo, 'text', 'Saldovortrag');
      ELSE
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', '9100', 'konto_haben', v_konto, 'betrag', -v_saldo, 'text', 'Saldovortrag');
      END IF;
    ELSE  -- passiv / abschluss: Habensaldo
      IF v_saldo > 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', '9100', 'konto_haben', v_konto, 'betrag', v_saldo, 'text', 'Saldovortrag');
      ELSE
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', v_konto, 'konto_haben', '9100', 'betrag', -v_saldo, 'text', 'Saldovortrag');
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

-- ── 9. RPC: bestehende Saldovorträge eines Jahres lesen ──────────────
CREATE OR REPLACE FUNCTION fibu_saldovortrag_lesen(
  p_mandant_id UUID,
  p_jahr       INTEGER
)
RETURNS TABLE (konto_nr TEXT, saldo NUMERIC)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    k.konto_nr,
    CASE WHEN k.konto_typ = 'aktiv'
         THEN SUM(CASE WHEN b.konto_soll = k.konto_nr THEN b.betrag ELSE -b.betrag END)
         ELSE SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE -b.betrag END)
    END AS saldo
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
