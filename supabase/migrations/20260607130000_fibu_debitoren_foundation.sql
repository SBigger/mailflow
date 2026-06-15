-- =====================================================================
-- FiBu: Debitoren / Fakturierung — Fundament (Phase 1)
-- Spiegelbildlich zur erprobten Kreditoren-Seite.
--   - fibu_kunden       (Kundenstamm)
--   - fibu_artikel      (Produktstamm: Dienstleistung + Material)
--   - fibu_debitoren_belege / _positionen
--   - fibu_next_debitoren_nr()  -> 'DR-YYYY-NNNN'
--   - fibu_debitoren_verbuchen() -> Soll 1100 Debitoren / Haben Ertrag + 2200 USt
-- RLS via fibu_mandant_ids_for_user() (wie überall im Fibu-Modul).
-- =====================================================================

-- ── 1. Kundenstamm ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fibu_kunden (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id             UUID        NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  nr                     TEXT        NOT NULL,
  name                   TEXT        NOT NULL,
  uid                    TEXT,
  adresse                TEXT,
  plz                    TEXT,
  ort                    TEXT,
  land                   CHAR(2)     NOT NULL DEFAULT 'CH',
  email                  TEXT,                              -- für Rechnungsversand / eBill
  iban                   TEXT,                              -- optional (z.B. für Rückzahlungen)
  zahlungsbedingung_tage SMALLINT    NOT NULL DEFAULT 30,
  standard_konto_nr      TEXT,                              -- Standard-Ertragskonto
  mwst_code              TEXT        NOT NULL DEFAULT 'V81',
  notiz                  TEXT,
  aktiv                  BOOLEAN     NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mandant_id, nr)
);

-- ── 2. Produktstamm (Dienstleistung + Material) ───────────────────
CREATE TABLE IF NOT EXISTS fibu_artikel (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  nr             TEXT          NOT NULL,
  typ            TEXT          NOT NULL DEFAULT 'dienstleistung'
                   CHECK (typ IN ('dienstleistung','material')),
  name           TEXT          NOT NULL,
  beschreibung   TEXT,
  einheit        TEXT          NOT NULL DEFAULT 'Stk',       -- z.B. Std, Stk, Pauschal
  verkaufspreis  NUMERIC(14,2) NOT NULL DEFAULT 0,
  waehrung       CHAR(3)       NOT NULL DEFAULT 'CHF',
  mwst_code      TEXT          NOT NULL DEFAULT 'V81',
  ertragskonto   TEXT,                                       -- z.B. 3400 (DL) / 3200 (Handel)
  aktiv          BOOLEAN       NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(mandant_id, nr)
);

-- ── 3. Debitoren-Belegköpfe (Ausgangsrechnungen) ──────────────────
CREATE TABLE IF NOT EXISTS fibu_debitoren_belege (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id             UUID         NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  beleg_nr               TEXT         NOT NULL,              -- DR-2026-0001
  kunde_id               UUID         NOT NULL REFERENCES fibu_kunden(id),
  belegtyp               TEXT         NOT NULL DEFAULT 'rechnung'
                           CHECK (belegtyp IN ('rechnung','gutschrift')),
  titel                  TEXT,                               -- Rechnungsbetreff
  belegdatum             DATE         NOT NULL,
  valutadatum            DATE,
  faelligkeit            DATE         NOT NULL,
  zahlungsbedingung_tage SMALLINT,
  waehrung               CHAR(3)      NOT NULL DEFAULT 'CHF',
  betrag_netto           NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_mwst            NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_brutto          NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_bezahlt         NUMERIC(14,2) NOT NULL DEFAULT 0,
  bezahlt_am             DATE,
  zahlungsreferenz       TEXT,                               -- QR-Referenz (27-stellig)
  status                 TEXT         NOT NULL DEFAULT 'entwurf'
                           CHECK (status IN ('entwurf','offen','teilbezahlt','bezahlt','storniert')),
  notiz                  TEXT,
  pdf_url                TEXT,                               -- QR-Rechnung PDF in Storage
  verbucht               BOOLEAN      NOT NULL DEFAULT false,
  storno_beleg_id        UUID         REFERENCES fibu_debitoren_belege(id),
  gebucht_am             TIMESTAMPTZ,
  gebucht_von            UUID         REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(mandant_id, beleg_nr)
);

-- ── 4. Debitoren-Positionen ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fibu_debitoren_positionen (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  beleg_id       UUID          NOT NULL REFERENCES fibu_debitoren_belege(id) ON DELETE CASCADE,
  position       SMALLINT      NOT NULL DEFAULT 1,
  artikel_id     UUID          REFERENCES fibu_artikel(id),
  bezeichnung    TEXT,
  menge          NUMERIC(14,3) NOT NULL DEFAULT 1,
  einheit        TEXT,
  einzelpreis    NUMERIC(14,2) NOT NULL DEFAULT 0,
  konto_nr       TEXT          NOT NULL,                     -- Ertragskonto (3xxx)
  mwst_code      TEXT          NOT NULL DEFAULT 'V81',
  mwst_satz      NUMERIC(5,2)  NOT NULL DEFAULT 8.1,
  betrag_netto   NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_mwst    NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_brutto  NUMERIC(14,2) NOT NULL DEFAULT 0,
  kostenstelle   TEXT
);

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fibu_kunden_mandant       ON fibu_kunden (mandant_id, aktiv);
CREATE INDEX IF NOT EXISTS idx_fibu_artikel_mandant      ON fibu_artikel (mandant_id, typ, aktiv);
CREATE INDEX IF NOT EXISTS idx_fibu_deb_belege_status    ON fibu_debitoren_belege (mandant_id, status);
CREATE INDEX IF NOT EXISTS idx_fibu_deb_belege_faellig   ON fibu_debitoren_belege (mandant_id, faelligkeit);
CREATE INDEX IF NOT EXISTS idx_fibu_deb_belege_kunde     ON fibu_debitoren_belege (mandant_id, kunde_id);
CREATE INDEX IF NOT EXISTS idx_fibu_deb_positionen_beleg ON fibu_debitoren_positionen (beleg_id);

-- ── updated_at Trigger (Funktion fibu_set_updated_at existiert) ───
DROP TRIGGER IF EXISTS fibu_kunden_updated_at ON fibu_kunden;
CREATE TRIGGER fibu_kunden_updated_at  BEFORE UPDATE ON fibu_kunden  FOR EACH ROW EXECUTE FUNCTION fibu_set_updated_at();
DROP TRIGGER IF EXISTS fibu_artikel_updated_at ON fibu_artikel;
CREATE TRIGGER fibu_artikel_updated_at BEFORE UPDATE ON fibu_artikel FOR EACH ROW EXECUTE FUNCTION fibu_set_updated_at();
DROP TRIGGER IF EXISTS fibu_deb_belege_updated_at ON fibu_debitoren_belege;
CREATE TRIGGER fibu_deb_belege_updated_at BEFORE UPDATE ON fibu_debitoren_belege FOR EACH ROW EXECUTE FUNCTION fibu_set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE fibu_kunden                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_artikel               ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_debitoren_belege      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_debitoren_positionen  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fibu: kunden select" ON fibu_kunden FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: kunden write"  ON fibu_kunden FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: artikel select" ON fibu_artikel FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: artikel write"  ON fibu_artikel FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: deb_belege select" ON fibu_debitoren_belege FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: deb_belege write"  ON fibu_debitoren_belege FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: deb_pos select" ON fibu_debitoren_positionen FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: deb_pos write"  ON fibu_debitoren_positionen FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- ── Nummernkreis: DR-YYYY-NNNN ────────────────────────────────────
CREATE OR REPLACE FUNCTION fibu_next_debitoren_nr(p_mandant_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_year TEXT := TO_CHAR(NOW(), 'YYYY');
  v_last TEXT;
  v_num  INTEGER;
BEGIN
  SELECT beleg_nr INTO v_last
  FROM fibu_debitoren_belege
  WHERE mandant_id = p_mandant_id
    AND beleg_nr LIKE 'DR-' || v_year || '-%'
  ORDER BY beleg_nr DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  v_num := COALESCE(NULLIF(SPLIT_PART(COALESCE(v_last, ''), '-', 3), '')::INTEGER, 0) + 1;
  RETURN 'DR-' || v_year || '-' || LPAD(v_num::TEXT, 4, '0');
END;
$$;

-- ── Debitoren-Buchungs-RPC (effektive MWST-Methode) ──────────────
--   Rechnung:   Soll 1100 Debitoren / Haben Ertragskonto (netto)
--               Soll 1100 Debitoren / Haben 2200 USt      (mwst)
--   Gutschrift: Soll/Haben getauscht (Gegenbuchung)
CREATE OR REPLACE FUNCTION fibu_debitoren_verbuchen(p_beleg_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_beleg   fibu_debitoren_belege%ROWTYPE;
  v_pos     RECORD;
  v_nr      TEXT;
  v_kunde   TEXT;
  v_ust     TEXT;
  v_gut     BOOLEAN;
BEGIN
  SELECT * INTO v_beleg FROM fibu_debitoren_belege WHERE id = p_beleg_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Debitoren-Beleg % nicht gefunden', p_beleg_id; END IF;
  IF v_beleg.verbucht THEN RETURN; END IF;            -- idempotent

  v_gut := (v_beleg.belegtyp = 'gutschrift');
  SELECT name INTO v_kunde FROM fibu_kunden WHERE id = v_beleg.kunde_id;

  FOR v_pos IN
    SELECT * FROM fibu_debitoren_positionen WHERE beleg_id = p_beleg_id ORDER BY position
  LOOP
    -- Ertrag (Netto)
    v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
    INSERT INTO fibu_buchungen
      (mandant_id, buchungs_nr, buchungsdatum, beleg_ref, konto_soll, konto_haben,
       betrag, mwst_code, mwst_betrag, text, quelle, quelle_id, created_by)
    VALUES (
      v_beleg.mandant_id, v_nr, v_beleg.belegdatum, v_beleg.beleg_nr,
      CASE WHEN v_gut THEN v_pos.konto_nr ELSE '1100' END,
      CASE WHEN v_gut THEN '1100' ELSE v_pos.konto_nr END,
      v_pos.betrag_netto, v_pos.mwst_code, v_pos.betrag_mwst,
      COALESCE(v_kunde,'') || ' / ' || v_beleg.beleg_nr, 'debitoren', p_beleg_id, v_beleg.gebucht_von
    );

    -- Umsatzsteuer (falls > 0)
    IF v_pos.betrag_mwst > 0 THEN
      SELECT konto_umsatz INTO v_ust FROM fibu_mwst_codes
        WHERE mandant_id = v_beleg.mandant_id AND code = v_pos.mwst_code;
      v_ust := COALESCE(v_ust, '2200');
      v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
      INSERT INTO fibu_buchungen
        (mandant_id, buchungs_nr, buchungsdatum, beleg_ref, konto_soll, konto_haben,
         betrag, mwst_code, mwst_betrag, text, quelle, quelle_id, created_by)
      VALUES (
        v_beleg.mandant_id, v_nr, v_beleg.belegdatum, v_beleg.beleg_nr,
        CASE WHEN v_gut THEN v_ust ELSE '1100' END,
        CASE WHEN v_gut THEN '1100' ELSE v_ust END,
        v_pos.betrag_mwst, v_pos.mwst_code, v_pos.betrag_mwst,
        'Umsatzsteuer ' || v_pos.mwst_code || ' / ' || v_beleg.beleg_nr, 'debitoren', p_beleg_id, v_beleg.gebucht_von
      );
    END IF;
  END LOOP;

  UPDATE fibu_debitoren_belege
    SET verbucht = true, gebucht_am = NOW()
    WHERE id = p_beleg_id;
END;
$$;
