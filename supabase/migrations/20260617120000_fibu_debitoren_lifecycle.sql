-- =====================================================================
-- FiBu: Debitoren / Fakturierung — Lebenszyklus (Phase 3)
-- Bringt die Debitoren-Seite spiegelbildlich auf Kreditoren-Niveau:
--   - Storno (Gegenbuchung statt Löschen, frei wählbares Storno-Datum)
--   - Mahnwesen (Mahnstufe + Mahnhistorie)
--   - Versand-Tracking (gesendet_am / gesendet_an)
-- Zahlungseingang wird wie bei Kreditoren rein über Status/betrag_bezahlt
-- erfasst (GL-seitig bucht die Bankabstimmung) – kein RPC nötig.
-- =====================================================================

-- ── 1. Zusatzfelder am Belegkopf ──────────────────────────────────
ALTER TABLE fibu_debitoren_belege ADD COLUMN IF NOT EXISTS mahnstufe         SMALLINT     NOT NULL DEFAULT 0;
ALTER TABLE fibu_debitoren_belege ADD COLUMN IF NOT EXISTS letzte_mahnung_am DATE;
ALTER TABLE fibu_debitoren_belege ADD COLUMN IF NOT EXISTS gesendet_am       TIMESTAMPTZ;
ALTER TABLE fibu_debitoren_belege ADD COLUMN IF NOT EXISTS gesendet_an       TEXT;

-- ── 2. Mahnhistorie (eine Zeile je versandte Mahnung) ─────────────
CREATE TABLE IF NOT EXISTS fibu_debitoren_mahnungen (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  beleg_id    UUID          NOT NULL REFERENCES fibu_debitoren_belege(id) ON DELETE CASCADE,
  stufe       SMALLINT      NOT NULL DEFAULT 1 CHECK (stufe BETWEEN 1 AND 3),
  mahndatum   DATE          NOT NULL DEFAULT CURRENT_DATE,
  faellig_am  DATE,                                 -- neue Zahlungsfrist der Mahnung
  gebuehr     NUMERIC(14,2) NOT NULL DEFAULT 0,     -- Mahngebühr (rein informativ, nicht verbucht)
  betrag_offen NUMERIC(14,2) NOT NULL DEFAULT 0,    -- offener Betrag zum Mahnzeitpunkt
  pdf_url     TEXT,
  gesendet_am TIMESTAMPTZ,
  gesendet_an TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by  UUID          REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_fibu_deb_mahnungen_beleg   ON fibu_debitoren_mahnungen (beleg_id);
CREATE INDEX IF NOT EXISTS idx_fibu_deb_mahnungen_mandant ON fibu_debitoren_mahnungen (mandant_id, mahndatum);

ALTER TABLE fibu_debitoren_mahnungen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fibu: deb_mahn select" ON fibu_debitoren_mahnungen;
DROP POLICY IF EXISTS "fibu: deb_mahn write"  ON fibu_debitoren_mahnungen;
CREATE POLICY "fibu: deb_mahn select" ON fibu_debitoren_mahnungen FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: deb_mahn write"  ON fibu_debitoren_mahnungen FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- ── 3. Storno einer Ausgangsrechnung ──────────────────────────────
-- Schweizer Praxis: gebuchte Belege werden NICHT gelöscht, sondern mit
-- einer Gegenbuchung (Storno-Gutschrift) ausgebucht. Storno-Datum frei.
-- Die Storno-Gutschrift spiegelt die Rechnung (belegtyp='gutschrift' dreht
-- in fibu_debitoren_verbuchen die Buchungsrichtung) → Hauptbuch netto null.
CREATE OR REPLACE FUNCTION fibu_debitoren_storno(
  p_beleg_id     UUID,
  p_storno_datum DATE
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r      fibu_debitoren_belege;
  v_storno UUID;
  v_nr     TEXT;
BEGIN
  SELECT * INTO v_r FROM fibu_debitoren_belege WHERE id = p_beleg_id;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_r.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF v_r.belegtyp <> 'rechnung' THEN
    RAISE EXCEPTION 'Nur Rechnungen können storniert werden';
  END IF;
  IF v_r.status = 'storniert' OR v_r.storno_beleg_id IS NOT NULL THEN
    RAISE EXCEPTION 'Beleg % ist bereits storniert', v_r.beleg_nr;
  END IF;
  IF COALESCE(v_r.betrag_bezahlt, 0) <> 0 THEN
    RAISE EXCEPTION 'Rechnung % ist bereits (teil)bezahlt und kann nicht storniert werden', v_r.beleg_nr;
  END IF;

  -- eindeutige Beleg-Nr. für die Storno-Gutschrift
  v_nr := v_r.beleg_nr || '-S';
  IF EXISTS (SELECT 1 FROM fibu_debitoren_belege
             WHERE mandant_id = v_r.mandant_id AND beleg_nr = v_nr) THEN
    v_nr := v_r.beleg_nr || '-S' || TO_CHAR(NOW(), 'SSSS');
  END IF;

  -- Storno-Gutschrift anlegen (gespiegelte, negative Beträge)
  INSERT INTO fibu_debitoren_belege (
    mandant_id, beleg_nr, kunde_id, titel,
    belegdatum, valutadatum, faelligkeit, zahlungsbedingung_tage,
    waehrung, betrag_netto, betrag_mwst, betrag_brutto,
    belegtyp, status, notiz, gebucht_von
  ) VALUES (
    v_r.mandant_id, v_nr, v_r.kunde_id,
    'Storno zu ' || v_r.beleg_nr,
    p_storno_datum, p_storno_datum, p_storno_datum, 0,
    v_r.waehrung, -v_r.betrag_netto, -v_r.betrag_mwst, -v_r.betrag_brutto,
    'gutschrift', 'storniert',
    'Storno zu ' || v_r.beleg_nr || COALESCE(' – ' || v_r.notiz, ''),
    auth.uid()
  ) RETURNING id INTO v_storno;

  -- Positionen 1:1 kopieren (positiv – die Verbuchung dreht die Richtung)
  INSERT INTO fibu_debitoren_positionen (
    mandant_id, beleg_id, position, artikel_id, bezeichnung, menge, einheit,
    einzelpreis, konto_nr, mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto, kostenstelle
  )
  SELECT mandant_id, v_storno, position, artikel_id, bezeichnung, menge, einheit,
         einzelpreis, konto_nr, mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto, kostenstelle
  FROM fibu_debitoren_positionen
  WHERE beleg_id = p_beleg_id;

  -- Storno-Gutschrift verbuchen (Gegenbuchung, datiert auf Storno-Datum)
  PERFORM fibu_debitoren_verbuchen(v_storno);

  -- Original-Rechnung als storniert markieren
  UPDATE fibu_debitoren_belege
  SET status = 'storniert', storno_beleg_id = v_storno, updated_at = NOW()
  WHERE id = p_beleg_id;

  RETURN v_storno;
END;
$$;
