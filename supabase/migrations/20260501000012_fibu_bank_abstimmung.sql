-- =====================================================================
-- Bank-Abstimmung: Importierte camt.053 Transaktionen
-- =====================================================================

CREATE TABLE IF NOT EXISTS fibu_bank_imports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  UUID NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  dateiname   TEXT,
  konto_iban  TEXT,
  konto_nr    TEXT,   -- z.B. 1020
  import_datum TIMESTAMPTZ DEFAULT NOW(),
  anzahl_transaktionen INT DEFAULT 0,
  erstellt_von UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS fibu_bank_transaktionen (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       UUID NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  import_id        UUID REFERENCES fibu_bank_imports(id) ON DELETE CASCADE,
  konto_iban       TEXT,
  buchungsdatum    DATE NOT NULL,
  valutadatum      DATE,
  betrag           NUMERIC(15,2) NOT NULL,  -- immer positiv
  waehrung         CHAR(3) DEFAULT 'CHF',
  richtung         TEXT NOT NULL CHECK (richtung IN ('eingang','ausgang')),
  gegenpartei_name TEXT,
  gegenpartei_iban TEXT,
  referenz_typ     TEXT,   -- QRR, SCOR, NON
  referenz_nr      TEXT,   -- 27-stellige QRR oder SCOR-Ref
  end_to_end_id    TEXT,
  verwendungszweck TEXT,
  zusatzinfo       TEXT,
  -- Abstimmung
  status           TEXT NOT NULL DEFAULT 'offen'
                     CHECK (status IN ('offen','vorschlag','gematcht','ignoriert','verbucht')),
  matched_beleg_id UUID,
  matched_typ      TEXT CHECK (matched_typ IN ('kreditor','debitor')),
  match_confidence NUMERIC(4,2),
  match_methode    TEXT,  -- QRR, E2E, AMOUNT_NAME, FUZZY, MANUAL
  -- Buchung nach Bestätigung
  buchungs_id      UUID REFERENCES fibu_buchungen(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bank_tx_mandant  ON fibu_bank_transaktionen(mandant_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_status   ON fibu_bank_transaktionen(mandant_id, status);
CREATE INDEX IF NOT EXISTS idx_bank_tx_referenz ON fibu_bank_transaktionen(referenz_nr)
  WHERE referenz_nr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_tx_datum    ON fibu_bank_transaktionen(buchungsdatum);

-- Dedup: Transaktionen MIT QRR (27-stellige Referenz) — eindeutig auf Referenz
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_dedup_qrr
  ON fibu_bank_transaktionen(mandant_id, konto_iban, buchungsdatum, betrag, richtung, referenz_nr)
  WHERE referenz_nr IS NOT NULL;

-- Dedup: Transaktionen OHNE QRR — eindeutig auf Basisfeldern + E2E-ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_dedup_e2e
  ON fibu_bank_transaktionen(mandant_id, konto_iban, buchungsdatum, betrag, richtung, end_to_end_id)
  WHERE referenz_nr IS NULL AND end_to_end_id IS NOT NULL;

-- Dedup: Transaktionen ohne Referenz — nur Basisfelder (für upsert onConflict)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_dedup_base
  ON fibu_bank_transaktionen(mandant_id, konto_iban, buchungsdatum, betrag, richtung)
  WHERE referenz_nr IS NULL AND end_to_end_id IS NULL;

-- RLS
ALTER TABLE fibu_bank_imports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_bank_transaktionen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_imports_access ON fibu_bank_imports;
CREATE POLICY bank_imports_access ON fibu_bank_imports
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

DROP POLICY IF EXISTS bank_tx_access ON fibu_bank_transaktionen;
CREATE POLICY bank_tx_access ON fibu_bank_transaktionen
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- RPC: Match bestätigen + Kreditoren-Beleg als bezahlt markieren
CREATE OR REPLACE FUNCTION fibu_bank_match_kreditor(
  p_tx_id       UUID,
  p_beleg_id    UUID,
  p_betrag      NUMERIC,
  p_datum       DATE,
  p_confidence  NUMERIC,
  p_methode     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- TX als gematcht markieren
  UPDATE fibu_bank_transaktionen SET
    status           = 'gematcht',
    matched_beleg_id = p_beleg_id,
    matched_typ      = 'kreditor',
    match_confidence = p_confidence,
    match_methode    = p_methode
  WHERE id = p_tx_id;

  -- Kreditoren-Beleg: bezahlt_am + status aktualisieren
  UPDATE fibu_kreditoren_belege SET
    betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + p_betrag,
    bezahlt_am     = p_datum,
    status = CASE
      WHEN COALESCE(betrag_bezahlt, 0) + p_betrag >= betrag_brutto THEN 'bezahlt'
      ELSE 'teilbezahlt'
    END
  WHERE id = p_beleg_id;
END;
$$;
