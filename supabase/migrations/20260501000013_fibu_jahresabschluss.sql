-- =====================================================================
-- FiBu: Jahresabschluss (Year-End Closing)
-- Migration: 20260501000013
--
-- Implements Swiss KMU double-entry year-end accounting:
--   Step A: Close Erfolgskonten (ertrag/aufwand) → Jahresergebnis
--   Step B: Transfer net Gewinn/Verlust → Gewinnvortrag / Verlustvortrag
--   Step C: Create Eröffnungsbuchungen for the new fiscal year
--   Step D: Mark Abschluss as done, advance geschaeftsjahr
-- =====================================================================


-- ══════════════════════════════════════════════════════════════════════
-- 1. SCHEMA EXTENSIONS
-- ══════════════════════════════════════════════════════════════════════

-- 1a. Laufendes Geschäftsjahr auf dem Mandanten
--     (z.B. 2025 bedeutet: wir buchen gerade im Jahr 2025)
ALTER TABLE fibu_mandanten
  ADD COLUMN IF NOT EXISTS geschaeftsjahr INT NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INT;

-- 1b. Periode-Art auf Buchungen:
--     'normal'     = reguläre Buchung (default)
--     'eroeffnung' = Eröffnungsbuchung (01.01. neues Jahr)  — nicht in GV/Bilanz
--     'abschluss'  = Abschluss-Gegenbuchung (31.12. altes Jahr)
ALTER TABLE fibu_buchungen
  ADD COLUMN IF NOT EXISTS periode_art TEXT NOT NULL DEFAULT 'normal'
    CHECK (periode_art IN ('normal', 'eroeffnung', 'abschluss'));

-- Index für häufige Abfragen nach periode_art
CREATE INDEX IF NOT EXISTS idx_fibu_buchungen_periode_art
  ON fibu_buchungen (mandant_id, periode_art)
  WHERE periode_art != 'normal';


-- ══════════════════════════════════════════════════════════════════════
-- 2. TABELLE fibu_jahresabschluss
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fibu_jahresabschluss (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id            UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  jahr                  INT           NOT NULL,
  status                TEXT          NOT NULL DEFAULT 'offen'
                          CHECK (status IN ('offen', 'abgeschlossen')),

  -- Berechnetes Ergebnis (befüllt nach Abschluss)
  gewinn_verlust        NUMERIC(15,2),

  -- Abschluss-Konten (Defaults nach Schweizer KMU-Kontenrahmen)
  konto_jahresergebnis  TEXT          NOT NULL DEFAULT '9999',   -- Schlussbilanzkonto
  konto_gewinnvortrag   TEXT          NOT NULL DEFAULT '2970',   -- Gewinnvortrag
  konto_verlustvortrag  TEXT          NOT NULL DEFAULT '2979',   -- Verlustvortrag
  konto_eroeffnung      TEXT          NOT NULL DEFAULT '9900',   -- Eröffnungsbilanzkonto

  -- Audit
  abgeschlossen_am      TIMESTAMPTZ,
  abgeschlossen_von     UUID          REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (mandant_id, jahr)
);

-- Trigger: updated_at automatisch setzen
CREATE TRIGGER fibu_jahresabschluss_updated_at
  BEFORE UPDATE ON fibu_jahresabschluss
  FOR EACH ROW EXECUTE FUNCTION fibu_set_updated_at();

-- Index
CREATE INDEX IF NOT EXISTS idx_fibu_jahresabschluss_mandant_jahr
  ON fibu_jahresabschluss (mandant_id, jahr);

-- RLS aktivieren
ALTER TABLE fibu_jahresabschluss ENABLE ROW LEVEL SECURITY;

-- RLS-Policies: Zugang nur für berechtigte User (gleiche Logik wie andere FiBu-Tabellen)
CREATE POLICY fibu_jahresabschluss_select ON fibu_jahresabschluss
  FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

CREATE POLICY fibu_jahresabschluss_insert ON fibu_jahresabschluss
  FOR INSERT WITH CHECK (mandant_id = ANY(fibu_mandant_ids_for_user()));

CREATE POLICY fibu_jahresabschluss_update ON fibu_jahresabschluss
  FOR UPDATE USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

CREATE POLICY fibu_jahresabschluss_delete ON fibu_jahresabschluss
  FOR DELETE USING (mandant_id = ANY(fibu_mandant_ids_for_user()));


-- ══════════════════════════════════════════════════════════════════════
-- 3. RPC: fibu_jahresabschluss_salden
--
-- Gibt die aggregierten Salden aller aktiven Konten für ein Jahr zurück.
-- Verwendung: Vorschau vor dem Abschluss, Reporting, Kontrollansicht.
--
-- Logik:
--   saldo = soll - haben  für Aktiv- und Aufwandkonten (Sollnatur)
--   saldo = haben - soll  für Passiv- und Ertragskonten (Habennatur)
--
-- Eröffnungsbuchungen (periode_art='eroeffnung') werden NICHT
-- berücksichtigt — sie spiegeln nur den Vortrag, nicht das laufende GJ.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fibu_jahresabschluss_salden(
  p_mandant_id  UUID,
  p_jahr        INT
)
RETURNS TABLE (
  konto_nr          TEXT,
  bezeichnung       TEXT,
  konto_typ         TEXT,
  saldo_soll        NUMERIC,
  saldo_haben       NUMERIC,
  saldo             NUMERIC,   -- positiv = Saldo in Kontonatur; negativ = Gegensaldo
  anzahl_buchungen  BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,

    -- Rohe Seiten-Summen
    COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0) AS saldo_soll,
    COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0) AS saldo_haben,

    -- Saldo in Kontonatur
    CASE k.konto_typ
      WHEN 'aktiv'   THEN
        COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
      WHEN 'aufwand' THEN
        COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
      WHEN 'passiv'  THEN
        COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
      WHEN 'ertrag'  THEN
        COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
      ELSE  -- 'abschluss' und unbekannte Typen: Sollnatur
        COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
    END                                                                              AS saldo,

    COUNT(b.id)::BIGINT                                                              AS anzahl_buchungen

  FROM fibu_konten k
  LEFT JOIN fibu_buchungen b
    ON  b.mandant_id   = k.mandant_id
    AND (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
    AND EXTRACT(YEAR FROM b.buchungsdatum)::INT = p_jahr
    AND NOT b.storniert
    AND b.periode_art != 'eroeffnung'   -- Eröffnungsbuchungen ignorieren

  WHERE k.mandant_id = p_mandant_id
    AND k.aktiv = true

  GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
  ORDER BY k.konto_nr;
$$;


-- ══════════════════════════════════════════════════════════════════════
-- 4. RPC: fibu_jahresabschluss_durchfuehren
--
-- Führt den vollständigen Jahresabschluss durch (TRANSAKTIONAL):
--
--   Schritt A: Erfolgskonto-Abschluss (Ertrag/Aufwand → Jahresergebnis)
--   Schritt B: Jahresergebnis → Gewinnvortrag oder Verlustvortrag
--   Schritt C: Eröffnungsbuchungen für neues GJ (Aktiv/Passiv-Konten)
--   Schritt D: Status-Update + geschaeftsjahr vorrücken
--
-- Returns JSONB mit Zusammenfassung der erstellten Buchungen.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fibu_jahresabschluss_durchfuehren(
  p_mandant_id  UUID,
  p_jahr        INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- Jahresabschluss-Record
  v_ja                RECORD;

  -- Abschluss-Konten (aus fibu_jahresabschluss)
  v_kto_jahresergebnis  TEXT;
  v_kto_gewinnvortrag   TEXT;
  v_kto_verlustvortrag  TEXT;
  v_kto_eroeffnung      TEXT;

  -- Iteration
  v_konto             RECORD;

  -- Buchungsnummer + gemeinsame Felder
  v_nr                TEXT;
  v_datum_abschluss   DATE;   -- 31.12.p_jahr
  v_datum_eroeffnung  DATE;   -- 01.01.(p_jahr+1)

  -- Salden-Aggregation
  v_saldo_soll        NUMERIC;
  v_saldo_haben       NUMERIC;
  v_saldo             NUMERIC;

  -- Gesamt-Gewinn / -Verlust (Habennatur: positiv = Gewinn)
  v_gewinn            NUMERIC := 0;

  -- Zähler für Rückgabe
  v_cnt_abschluss     INT := 0;
  v_cnt_eb            INT := 0;
BEGIN
  -- ── Vorab-Validierung ─────────────────────────────────────────────

  -- Bereits abgeschlossen?
  IF EXISTS (
    SELECT 1 FROM fibu_jahresabschluss
    WHERE mandant_id = p_mandant_id
      AND jahr = p_jahr
      AND status = 'abgeschlossen'
  ) THEN
    RAISE EXCEPTION
      'Jahresabschluss % für Mandant % ist bereits abgeschlossen.',
      p_jahr, p_mandant_id;
  END IF;

  -- ── Jahresabschluss-Record laden oder anlegen ─────────────────────
  INSERT INTO fibu_jahresabschluss (mandant_id, jahr)
  VALUES (p_mandant_id, p_jahr)
  ON CONFLICT (mandant_id, jahr) DO NOTHING;

  SELECT * INTO v_ja
  FROM fibu_jahresabschluss
  WHERE mandant_id = p_mandant_id AND jahr = p_jahr;

  -- Abschluss-Konten lokal zwischenspeichern
  v_kto_jahresergebnis := v_ja.konto_jahresergebnis;
  v_kto_gewinnvortrag  := v_ja.konto_gewinnvortrag;
  v_kto_verlustvortrag := v_ja.konto_verlustvortrag;
  v_kto_eroeffnung     := v_ja.konto_eroeffnung;

  -- Buchungsdaten
  v_datum_abschluss  := make_date(p_jahr,     12, 31);
  v_datum_eroeffnung := make_date(p_jahr + 1,  1,  1);

  -- ══════════════════════════════════════════════════════════════════
  -- SCHRITT A: Erfolgskonten schliessen (Ertrag + Aufwand)
  --
  -- Ertragskonten (Habennatur):
  --   Buchung: Soll = Ertragskonto, Haben = Jahresergebnis
  --   Begründung: Ertragssaldo liegt auf der Habenseite → zum Ausgleich
  --               muss das Konto auf der Sollseite belastet werden.
  --
  -- Aufwandkonten (Sollnatur):
  --   Buchung: Soll = Jahresergebnis, Haben = Aufwandskonto
  --   Begründung: Aufwandssaldo liegt auf der Sollseite → Ausgleich
  --               über Haben-Buchung auf das Konto.
  -- ══════════════════════════════════════════════════════════════════

  FOR v_konto IN
    SELECT
      k.konto_nr,
      k.bezeichnung,
      k.konto_typ,
      -- Saldo in Kontonatur berechnen (ohne Eröffnungsbuchungen)
      CASE k.konto_typ
        WHEN 'ertrag' THEN
          COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        WHEN 'aufwand' THEN
          COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        ELSE 0
      END AS saldo
    FROM fibu_konten k
    LEFT JOIN fibu_buchungen b
      ON  b.mandant_id   = k.mandant_id
      AND (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
      AND EXTRACT(YEAR FROM b.buchungsdatum)::INT = p_jahr
      AND NOT b.storniert
      AND b.periode_art != 'eroeffnung'
    WHERE k.mandant_id = p_mandant_id
      AND k.aktiv      = true
      AND k.konto_typ IN ('ertrag', 'aufwand')
    GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
    HAVING
      -- Nur Konten mit echtem Saldo (≠ 0) verarbeiten
      CASE k.konto_typ
        WHEN 'ertrag' THEN
          COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        WHEN 'aufwand' THEN
          COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        ELSE 0
      END > 0
    ORDER BY k.konto_nr
  LOOP
    v_nr := fibu_next_buchungs_nr(p_mandant_id);

    IF v_konto.konto_typ = 'ertrag' THEN
      -- Ertragskonto SOLL / Jahresergebnis HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,            konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_abschluss,
        v_konto.konto_nr,      v_kto_jahresergebnis,
        v_konto.saldo,
        'Jahresabschluss Ertrag: ' || v_konto.bezeichnung,
        'abschluss', 'abschluss', auth.uid()
      );
      -- Gewinn akkumulieren (Ertrag erhöht Gewinn)
      v_gewinn := v_gewinn + v_konto.saldo;

    ELSE
      -- Aufwandskonto: Jahresergebnis SOLL / Aufwandskonto HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,              konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_abschluss,
        v_kto_jahresergebnis,    v_konto.konto_nr,
        v_konto.saldo,
        'Jahresabschluss Aufwand: ' || v_konto.bezeichnung,
        'abschluss', 'abschluss', auth.uid()
      );
      -- Gewinn mindern (Aufwand reduziert Gewinn)
      v_gewinn := v_gewinn - v_konto.saldo;

    END IF;

    v_cnt_abschluss := v_cnt_abschluss + 1;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════
  -- SCHRITT B: Jahresergebnis → Gewinnvortrag / Verlustvortrag
  --
  -- v_gewinn > 0: Gewinn  → Jahresergebnis SOLL / Gewinnvortrag HABEN
  -- v_gewinn < 0: Verlust → Verlustvortrag SOLL / Jahresergebnis HABEN
  -- v_gewinn = 0: kein Eintrag nötig (Nullergebnis)
  -- ══════════════════════════════════════════════════════════════════

  IF v_gewinn > 0 THEN
    v_nr := fibu_next_buchungs_nr(p_mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum,
      konto_soll,              konto_haben,
      betrag,
      text,
      quelle, periode_art, created_by
    ) VALUES (
      p_mandant_id, v_nr, v_datum_abschluss,
      v_kto_jahresergebnis,    v_kto_gewinnvortrag,
      v_gewinn,
      'Jahresgewinn ' || p_jahr::TEXT,
      'abschluss', 'abschluss', auth.uid()
    );
    v_cnt_abschluss := v_cnt_abschluss + 1;

  ELSIF v_gewinn < 0 THEN
    v_nr := fibu_next_buchungs_nr(p_mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum,
      konto_soll,              konto_haben,
      betrag,
      text,
      quelle, periode_art, created_by
    ) VALUES (
      p_mandant_id, v_nr, v_datum_abschluss,
      v_kto_verlustvortrag,    v_kto_jahresergebnis,
      ABS(v_gewinn),
      'Jahresverlust ' || p_jahr::TEXT,
      'abschluss', 'abschluss', auth.uid()
    );
    v_cnt_abschluss := v_cnt_abschluss + 1;
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- SCHRITT C: Eröffnungsbuchungen für das neue Geschäftsjahr
  --
  -- Bilanzkonten (Aktiv/Passiv) übertragen ihren Saldo — NACH den
  -- Abschlussbuchungen — als Eröffnungssaldo ins neue Jahr.
  -- Dabei gilt das Eröffnungsbilanzkonto (9900) als Gegenkonto.
  --
  -- Aktivkonto (Sollnatur, Saldo positiv = Sollsaldo):
  --   Soll = Aktivkonto, Haben = Eröffnungsbilanzkonto
  --
  -- Passivkonto (Habennatur, Saldo positiv = Habensaldo):
  --   Soll = Eröffnungsbilanzkonto, Haben = Passivkonto
  --
  -- Wichtig: Der Saldo der Bilanzkonten NACH Schritt A/B muss hier
  -- berücksichtigt werden. Für Aktiv/Passiv-Konten ändert sich durch
  -- Schritt A nichts (Erfolgskonten wurden dort gebucht). Gewinn/Verlust
  -- haben sich jedoch auf dem Vortragskonto (2970/2979) niederschlagen,
  -- deshalb werden diese separat als EB-Buchungen erfasst.
  -- ══════════════════════════════════════════════════════════════════

  FOR v_konto IN
    SELECT
      k.konto_nr,
      k.bezeichnung,
      k.konto_typ,
      -- Saldo inkl. aller Buchungen des Jahres (auch Abschlussbuchungen aus Schritt A/B)
      -- Die periode_art-Filter müssen hier fehlen, da die Abschlussbuchungen relevant sind.
      -- Eröffnungsbuchungen weiterhin ausschliessen (gehören zum Vorjahr).
      CASE k.konto_typ
        WHEN 'aktiv'  THEN
          COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        WHEN 'passiv' THEN
          COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        ELSE 0
      END AS saldo
    FROM fibu_konten k
    LEFT JOIN fibu_buchungen b
      ON  b.mandant_id   = k.mandant_id
      AND (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
      AND EXTRACT(YEAR FROM b.buchungsdatum)::INT = p_jahr
      AND NOT b.storniert
      AND b.periode_art != 'eroeffnung'   -- Vorjahres-EB ausschliessen
    WHERE k.mandant_id = p_mandant_id
      AND k.aktiv      = true
      AND k.konto_typ IN ('aktiv', 'passiv')
    GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
    HAVING
      CASE k.konto_typ
        WHEN 'aktiv'  THEN
          COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        WHEN 'passiv' THEN
          COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        ELSE 0
      END > 0
    ORDER BY k.konto_nr
  LOOP
    v_nr := fibu_next_buchungs_nr(p_mandant_id);

    IF v_konto.konto_typ = 'aktiv' THEN
      -- Aktivkonto SOLL / Eröffnungsbilanzkonto HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,       konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_eroeffnung,
        v_konto.konto_nr, v_kto_eroeffnung,
        v_konto.saldo,
        'Eröffnungssaldo: ' || v_konto.bezeichnung,
        'abschluss', 'eroeffnung', auth.uid()
      );
    ELSE
      -- Eröffnungsbilanzkonto SOLL / Passivkonto HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,        konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_eroeffnung,
        v_kto_eroeffnung,  v_konto.konto_nr,
        v_konto.saldo,
        'Eröffnungssaldo: ' || v_konto.bezeichnung,
        'abschluss', 'eroeffnung', auth.uid()
      );
    END IF;

    v_cnt_eb := v_cnt_eb + 1;
  END LOOP;

  -- Gewinn-/Verlustvortrag als EB-Buchung ins neue Jahr übertragen
  -- (Schritt B hat das Konto auf dem Abschlussdatum belastet; hier
  --  wird der gleiche Betrag als Eröffnung auf 01.01. ins neue Jahr gebucht)
  IF v_gewinn != 0 THEN
    v_nr := fibu_next_buchungs_nr(p_mandant_id);

    IF v_gewinn > 0 THEN
      -- Gewinnvortrag als Passivkonto (Habennatur): EB-Konto SOLL / Gewinnvortrag HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,        konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_eroeffnung,
        v_kto_eroeffnung,    v_kto_gewinnvortrag,
        v_gewinn,
        'Eröffnungssaldo Gewinnvortrag ' || p_jahr::TEXT,
        'abschluss', 'eroeffnung', auth.uid()
      );
    ELSE
      -- Verlustvortrag als Aktivkonto (Sollnatur): Verlustvortrag SOLL / EB-Konto HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,            konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_eroeffnung,
        v_kto_verlustvortrag,  v_kto_eroeffnung,
        ABS(v_gewinn),
        'Eröffnungssaldo Verlustvortrag ' || p_jahr::TEXT,
        'abschluss', 'eroeffnung', auth.uid()
      );
    END IF;

    v_cnt_eb := v_cnt_eb + 1;
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- SCHRITT D: Status setzen und Geschäftsjahr vorrücken
  -- ══════════════════════════════════════════════════════════════════

  UPDATE fibu_jahresabschluss
  SET
    status           = 'abgeschlossen',
    gewinn_verlust   = v_gewinn,
    abgeschlossen_am = NOW(),
    abgeschlossen_von = auth.uid()
  WHERE mandant_id = p_mandant_id AND jahr = p_jahr;

  -- Mandant: Geschäftsjahr auf das nächste Jahr vorrücken
  UPDATE fibu_mandanten
  SET geschaeftsjahr = p_jahr + 1
  WHERE id = p_mandant_id;

  -- ── Ergebnis-JSON zurückgeben ──────────────────────────────────────
  RETURN jsonb_build_object(
    'jahr',                    p_jahr,
    'neues_jahr',              p_jahr + 1,
    'gewinn_verlust',          v_gewinn,
    'anzahl_abschluss_buchungen', v_cnt_abschluss,
    'anzahl_eb_buchungen',     v_cnt_eb
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Alle Änderungen werden durch den umschliessenden Transaktions-
    -- rollback automatisch rückgängig gemacht (Supabase/PostgREST RPC
    -- läuft in einer einzelnen Transaktion).
    RAISE;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════
-- 5. KOMMENTARE (pg_description)
-- ══════════════════════════════════════════════════════════════════════

COMMENT ON TABLE  fibu_jahresabschluss IS
  'Jahresabschluss-Datensatz pro Mandant und Jahr. Enthält Status, Abschluss-Konten und berechnetes Jahresergebnis.';

COMMENT ON COLUMN fibu_jahresabschluss.konto_jahresergebnis IS
  'Schlussbilanzkonto / Gewinn-Verlust-Konto. Standard CH-KMU: 9999.';
COMMENT ON COLUMN fibu_jahresabschluss.konto_gewinnvortrag IS
  'Passivkonto für Gewinnvortrag. Standard CH-KMU: 2970.';
COMMENT ON COLUMN fibu_jahresabschluss.konto_verlustvortrag IS
  'Aktivkonto für Verlustvortrag. Standard CH-KMU: 2979.';
COMMENT ON COLUMN fibu_jahresabschluss.konto_eroeffnung IS
  'Eröffnungsbilanzkonto (technisches Gegenkonto für EB-Buchungen). Standard CH-KMU: 9900.';
COMMENT ON COLUMN fibu_jahresabschluss.gewinn_verlust IS
  'Nettoergebnis nach Abschluss: positiv = Gewinn, negativ = Verlust.';

COMMENT ON COLUMN fibu_buchungen.periode_art IS
  'normal = reguläre Buchung; eroeffnung = Eröffnungsbuchung 01.01.; abschluss = Abschlussbuchung 31.12.';

COMMENT ON COLUMN fibu_mandanten.geschaeftsjahr IS
  'Aktuell laufendes Geschäftsjahr. Wird nach Jahresabschluss automatisch auf Jahr+1 gesetzt.';

COMMENT ON FUNCTION fibu_jahresabschluss_salden(UUID, INT) IS
  'Gibt aggregierte Konten-Salden für ein Geschäftsjahr zurück (ohne Eröffnungsbuchungen). Verwendung für Abschluss-Vorschau und Reporting.';

COMMENT ON FUNCTION fibu_jahresabschluss_durchfuehren(UUID, INT) IS
  'Führt vollständigen Jahresabschluss durch: Erfolgskonten schliessen, Gewinn/Verlust buchen, Eröffnungsbuchungen erstellen, Geschäftsjahr vorrücken. Transaktional – bei Fehler vollständiger Rollback.';
