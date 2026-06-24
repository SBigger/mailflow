-- =====================================================================
-- FiBu: MWST-Codes → ESTV-Abrechnungsziffern (datengetriebene Abrechnung)
--   Jeder MWST-Code wird einem Feld (Ziffer) der offiziellen MWST-
--   Abrechnung (effektive Methode) zugewiesen. Die Abrechnung aggregiert
--   künftig über diese Zuweisung statt über hartkodierte Code-Namen.
--
--   Steuer-/Betrags-Ziffern (Stand ESTV ab 01.01.2024):
--     U81→302 (Normalsatz 8.1%)  U26→312 (red. 2.6%)  U38→342 (Beherbergung 3.8%)
--     U0 →221 (Export Art. 23 – steuerbefreit MIT Vorsteuerabzug)
--     U0A→230 (ausgenommen Art. 21 – OHNE Vorsteuerabzug)        [neu]
--     BZ →382 (Bezugsteuer / Leistungsbezug aus dem Ausland)     [neu]
--     M81/M26/M38→400 (VSt Material/Dienstleistung)  I81→405 (VSt Investitionen)
--     M0 → keine Ziffer
-- =====================================================================

-- ── 1. Spalte + typ 'bezugsteuer' zulassen ────────────────────────
ALTER TABLE fibu_mwst_codes ADD COLUMN IF NOT EXISTS abrechnung_ziffer TEXT;

ALTER TABLE fibu_mwst_codes DROP CONSTRAINT IF EXISTS fibu_mwst_codes_typ_check;
ALTER TABLE fibu_mwst_codes ADD CONSTRAINT fibu_mwst_codes_typ_check
  CHECK (typ IN ('vorsteuer','umsatzsteuer','steuerbefreit','bezugsteuer'));

-- ── 2. Bestehende Codes den Ziffern zuweisen ──────────────────────
UPDATE fibu_mwst_codes SET abrechnung_ziffer = CASE code
  WHEN 'U81' THEN '302' WHEN 'U26' THEN '312' WHEN 'U38' THEN '342'
  WHEN 'U0'  THEN '221'
  WHEN 'M81' THEN '400' WHEN 'M26' THEN '400' WHEN 'M38' THEN '400'
  WHEN 'I81' THEN '405'
  ELSE abrechnung_ziffer END
WHERE code IN ('U81','U26','U38','U0','M81','M26','M38','I81');

UPDATE fibu_mwst_codes
  SET bezeichnung = 'Steuerbefreite Umsätze (Export Art. 23 – mit Vorsteuerabzug)'
  WHERE code = 'U0';

-- ── 3. Neue Codes für bestehende Mandanten nachrüsten ─────────────
INSERT INTO fibu_mwst_codes
  (mandant_id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung, abrechnung_ziffer)
SELECT m.id, 'U0A', 'Von der Steuer ausgenommene Umsätze (Art. 21 – ohne Vorsteuerabzug)',
       0.0, 'steuerbefreit', NULL, NULL, 95, '230'
FROM fibu_mandanten m
WHERE EXISTS (SELECT 1 FROM fibu_mwst_codes WHERE mandant_id = m.id)
ON CONFLICT (mandant_id, code) DO NOTHING;

INSERT INTO fibu_mwst_codes
  (mandant_id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung, abrechnung_ziffer)
SELECT m.id, 'BZ', 'Bezugsteuer 8.1 % (Leistungsbezug aus dem Ausland)',
       8.1, 'bezugsteuer', '1170', '2200', 100, '382'
FROM fibu_mandanten m
WHERE EXISTS (SELECT 1 FROM fibu_mwst_codes WHERE mandant_id = m.id)
ON CONFLICT (mandant_id, code) DO NOTHING;

-- ── 4. Seed-Funktion aktualisieren (Ziffern + neue Codes) ─────────
CREATE OR REPLACE FUNCTION fibu_seed_mwst_codes(p_mandant_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fibu_mwst_codes
    (mandant_id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung, abrechnung_ziffer)
  VALUES
    -- Vorsteuer (Einkauf / Kreditoren) ──────────────────────────
    (p_mandant_id, 'M81', 'Vorsteuer 8.1 % (Normalsteuersatz)',           8.1, 'vorsteuer',     '1170', NULL,   10, '400'),
    (p_mandant_id, 'M26', 'Vorsteuer 2.6 % (Reduziertensatz)',            2.6, 'vorsteuer',     '1170', NULL,   20, '400'),
    (p_mandant_id, 'M38', 'Vorsteuer 3.8 % (Beherbergung)',               3.8, 'vorsteuer',     '1170', NULL,   30, '400'),
    (p_mandant_id, 'I81', 'Vorsteuer Investitionen 8.1 %',                8.1, 'vorsteuer',     '1171', NULL,   40, '405'),
    (p_mandant_id, 'M0',  'Kein MWST (steuerbefreit / nicht steuerpfl.)', 0.0, 'steuerbefreit', NULL,   NULL,   50, NULL),
    -- Umsatzsteuer (Verkauf / Debitoren) ─────────────────────────
    (p_mandant_id, 'U81', 'Umsatzsteuer 8.1 % (Normalsteuersatz)',        8.1, 'umsatzsteuer',  NULL,  '2200',  60, '302'),
    (p_mandant_id, 'U26', 'Umsatzsteuer 2.6 % (Reduziertensatz)',         2.6, 'umsatzsteuer',  NULL,  '2200',  70, '312'),
    (p_mandant_id, 'U38', 'Umsatzsteuer 3.8 % (Beherbergung)',            3.8, 'umsatzsteuer',  NULL,  '2200',  80, '342'),
    (p_mandant_id, 'U0',  'Steuerbefreite Umsätze (Export Art. 23 – mit Vorsteuerabzug)', 0.0, 'steuerbefreit', NULL, NULL, 90, '221'),
    (p_mandant_id, 'U0A', 'Von der Steuer ausgenommene Umsätze (Art. 21 – ohne Vorsteuerabzug)', 0.0, 'steuerbefreit', NULL, NULL, 95, '230'),
    -- Bezugsteuer (Leistungsbezug Ausland) ───────────────────────
    (p_mandant_id, 'BZ',  'Bezugsteuer 8.1 % (Leistungsbezug aus dem Ausland)', 8.1, 'bezugsteuer', '1170', '2200', 100, '382')
  ON CONFLICT (mandant_id, code) DO NOTHING;
END;
$$;

-- ── 5. fibu_mwst_summary gibt die Abrechnungsziffer mit zurück ────
DROP FUNCTION IF EXISTS fibu_mwst_summary(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION fibu_mwst_summary(
  p_mandant_id UUID,
  p_von        DATE,
  p_bis        DATE
)
RETURNS TABLE (
  mwst_code         TEXT,
  mwst_satz         NUMERIC,
  typ               TEXT,
  bezeichnung       TEXT,
  abrechnung_ziffer TEXT,
  anzahl_buchungen  BIGINT,
  sum_netto         NUMERIC,
  sum_mwst          NUMERIC,
  sum_brutto        NUMERIC
) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    b.mwst_code,
    mc.satz                                     AS mwst_satz,
    mc.typ                                      AS typ,
    mc.bezeichnung                              AS bezeichnung,
    mc.abrechnung_ziffer                        AS abrechnung_ziffer,
    COUNT(*)::BIGINT                            AS anzahl_buchungen,
    ROUND(SUM(b.betrag), 2)                     AS sum_netto,
    ROUND(SUM(COALESCE(b.mwst_betrag, 0)), 2)   AS sum_mwst,
    ROUND(SUM(b.betrag + COALESCE(b.mwst_betrag,0)), 2) AS sum_brutto
  FROM fibu_buchungen b
  LEFT JOIN fibu_mwst_codes mc
    ON mc.mandant_id = b.mandant_id AND mc.code = b.mwst_code
  WHERE b.mandant_id = p_mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND b.mwst_code IS NOT NULL
    AND NOT b.storniert
  GROUP BY b.mwst_code, mc.satz, mc.typ, mc.bezeichnung, mc.abrechnung_ziffer, mc.sortierung
  ORDER BY mc.sortierung NULLS LAST, b.mwst_code;
$$;
