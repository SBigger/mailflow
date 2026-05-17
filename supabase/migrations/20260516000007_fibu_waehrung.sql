-- =====================================================================
-- FiBu: Währung pro Konto + Wechselkurs-Tabelle (ESTV/BAZG)
-- =====================================================================

-- ── 1. Währung im Kontenplan ─────────────────────────────────────────
ALTER TABLE fibu_konten
  ADD COLUMN IF NOT EXISTS waehrung CHAR(3) NOT NULL DEFAULT 'CHF';

-- ── 2. Wechselkurse (Monatsmittel- / Tageskurse der ESTV/BAZG) ───────
CREATE TABLE IF NOT EXISTS fibu_wechselkurse (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  typ         TEXT          NOT NULL CHECK (typ IN ('monat', 'tag')),
  datum       DATE          NOT NULL,            -- Monat: 1. des Monats · Tag: der Tag
  waehrung    CHAR(3)       NOT NULL,
  einheit     INTEGER       NOT NULL DEFAULT 1,  -- z.B. 100 bei JPY
  kurs        NUMERIC(16,8) NOT NULL,            -- CHF je 1 Einheit Fremdwährung (normalisiert)
  kurs_raw    NUMERIC(16,8) NOT NULL,            -- Originalkurs (je `einheit` Einheiten)
  land        TEXT,
  quelle      TEXT          NOT NULL DEFAULT 'BAZG/ESTV',
  imported_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(typ, datum, waehrung)
);
CREATE INDEX IF NOT EXISTS fibu_wechselkurse_lookup
  ON fibu_wechselkurse (waehrung, typ, datum DESC);

-- Wechselkurse sind eidgenössische Referenzdaten → für alle lesbar.
-- Schreibzugriff nur via Edge Function (Service-Role umgeht RLS).
ALTER TABLE fibu_wechselkurse ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fibu: wechselkurse lesen" ON fibu_wechselkurse;
CREATE POLICY "fibu: wechselkurse lesen"
  ON fibu_wechselkurse FOR SELECT
  USING (true);
