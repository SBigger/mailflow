-- ─────────────────────────────────────────────────────────────────
-- MWST-Code-Fix:
--   • Umsatzsteuer-Codes V→U prefix (U81, U38, U26, U0)
--   • Vorsteuer M26 + M38 nachrüsten für bestehende Mandanten
--   • Beide Seed-Funktionen aktualisieren
-- ─────────────────────────────────────────────────────────────────

-- ── 1. Bestehende Umsatzsteuer-Codes umbenennen V→U ───────────────
UPDATE fibu_mwst_codes SET code = 'U81', bezeichnung = 'Umsatzsteuer 8.1 % (Normalsteuersatz)' WHERE code = 'V81';
UPDATE fibu_mwst_codes SET code = 'U38', bezeichnung = 'Umsatzsteuer 3.8 % (Beherbergung)'     WHERE code = 'V38';
UPDATE fibu_mwst_codes SET code = 'U26', bezeichnung = 'Umsatzsteuer 2.6 % (Reduziertensatz)'  WHERE code = 'V26';
UPDATE fibu_mwst_codes SET code = 'U0',  bezeichnung = 'Steuerbefreite Umsätze (Export etc.)'  WHERE code = 'V0';

-- ── 2. Kontenplan-Referenzen V→U aktualisieren ────────────────────
UPDATE fibu_konten SET mwst_code = 'U81' WHERE mwst_code = 'V81';
UPDATE fibu_konten SET mwst_code = 'U38' WHERE mwst_code = 'V38';
UPDATE fibu_konten SET mwst_code = 'U26' WHERE mwst_code = 'V26';
UPDATE fibu_konten SET mwst_code = 'U0'  WHERE mwst_code = 'V0';

-- ── 3. Vorsteuer M26 + M38 für alle Mandanten nachrüsten ──────────
-- (falls der Mandant bereits geseedet wurde, bevor M26/M38 in der Funktion standen)
INSERT INTO fibu_mwst_codes
  (mandant_id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung)
SELECT m.id, 'M26', 'Vorsteuer 2.6 % (Reduziertensatz)', 2.6, 'vorsteuer', '1170', NULL, 20
FROM fibu_mandanten m
WHERE EXISTS (SELECT 1 FROM fibu_mwst_codes WHERE mandant_id = m.id)
ON CONFLICT (mandant_id, code) DO NOTHING;

INSERT INTO fibu_mwst_codes
  (mandant_id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung)
SELECT m.id, 'M38', 'Vorsteuer 3.8 % (Beherbergung)', 3.8, 'vorsteuer', '1170', NULL, 30
FROM fibu_mandanten m
WHERE EXISTS (SELECT 1 FROM fibu_mwst_codes WHERE mandant_id = m.id)
ON CONFLICT (mandant_id, code) DO NOTHING;

-- ── 4. Seed-Funktion MWST-Codes (U-Prefix für Umsatzsteuer) ──────
CREATE OR REPLACE FUNCTION fibu_seed_mwst_codes(p_mandant_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fibu_mwst_codes
    (mandant_id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung)
  VALUES
    -- Vorsteuer (Einkauf / Kreditoren) ──────────────────────────
    (p_mandant_id, 'M81', 'Vorsteuer 8.1 % (Normalsteuersatz)',           8.1, 'vorsteuer',     '1170', NULL,   10),
    (p_mandant_id, 'M26', 'Vorsteuer 2.6 % (Reduziertensatz)',            2.6, 'vorsteuer',     '1170', NULL,   20),
    (p_mandant_id, 'M38', 'Vorsteuer 3.8 % (Beherbergung)',               3.8, 'vorsteuer',     '1170', NULL,   30),
    (p_mandant_id, 'I81', 'Vorsteuer Investitionen 8.1 %',                8.1, 'vorsteuer',     '1171', NULL,   40),
    (p_mandant_id, 'M0',  'Kein MWST (steuerbefreit / nicht steuerpfl.)', 0.0, 'steuerbefreit', NULL,   NULL,   50),
    -- Umsatzsteuer (Verkauf / Debitoren) ─────────────────────────
    (p_mandant_id, 'U81', 'Umsatzsteuer 8.1 % (Normalsteuersatz)',        8.1, 'umsatzsteuer',  NULL,  '2200',  60),
    (p_mandant_id, 'U26', 'Umsatzsteuer 2.6 % (Reduziertensatz)',         2.6, 'umsatzsteuer',  NULL,  '2200',  70),
    (p_mandant_id, 'U38', 'Umsatzsteuer 3.8 % (Beherbergung)',            3.8, 'umsatzsteuer',  NULL,  '2200',  80),
    (p_mandant_id, 'U0',  'Steuerbefreite Umsätze (Export, etc.)',        0.0, 'steuerbefreit', NULL,   NULL,   90)
  ON CONFLICT (mandant_id, code) DO NOTHING;
END;
$$;

-- ── 5. Kontenplan-Seed (U-Prefix für Ertragskonten) ──────────────
CREATE OR REPLACE FUNCTION fibu_seed_kontenplan_ch_kmu(p_mandant_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, mwst_code, aktiv) VALUES

    -- ═══ KLASSE 1: AKTIVEN ════════════════════════════════════════
    -- Umlaufvermögen – Flüssige Mittel
    (p_mandant_id, '1000', 'Kasse',                               'aktiv', NULL,  true),
    (p_mandant_id, '1020', 'Bank',                                'aktiv', NULL,  true),
    (p_mandant_id, '1025', 'Fremdwährungskonto',                  'aktiv', NULL,  false),
    (p_mandant_id, '1060', 'Wertschriften (kurzfristig)',         'aktiv', NULL,  false),
    -- Forderungen
    (p_mandant_id, '1100', 'Debitoren',                           'aktiv', NULL,  true),
    (p_mandant_id, '1109', 'Delkredere',                          'aktiv', NULL,  true),
    (p_mandant_id, '1140', 'Übrige kurzfristige Forderungen',     'aktiv', NULL,  true),
    -- MWST / Steuern
    (p_mandant_id, '1170', 'Vorsteuer MWST (Materialien/DL)',     'aktiv', NULL,  true),
    (p_mandant_id, '1171', 'Vorsteuer MWST (Investitionen)',      'aktiv', NULL,  true),
    (p_mandant_id, '1176', 'Verrechnungssteuer',                  'aktiv', NULL,  false),
    -- Vorräte
    (p_mandant_id, '1200', 'Handelswaren',                        'aktiv', NULL,  true),
    (p_mandant_id, '1210', 'Rohstoffe und Hilfsstoffe',           'aktiv', NULL,  false),
    (p_mandant_id, '1260', 'Fertige Erzeugnisse',                 'aktiv', NULL,  false),
    -- Rechnungsabgrenzung
    (p_mandant_id, '1300', 'Aktive Rechnungsabgrenzung',          'aktiv', NULL,  true),
    -- Anlagevermögen – Sachanlagen
    (p_mandant_id, '1500', 'Maschinen und Geräte',                'aktiv', 'I81', true),
    (p_mandant_id, '1509', 'WB Maschinen und Geräte',             'aktiv', NULL,  true),
    (p_mandant_id, '1520', 'Fahrzeuge',                           'aktiv', 'I81', true),
    (p_mandant_id, '1529', 'WB Fahrzeuge',                        'aktiv', NULL,  true),
    (p_mandant_id, '1530', 'Mobiliar und Einrichtungen',          'aktiv', 'I81', true),
    (p_mandant_id, '1539', 'WB Mobiliar und Einrichtungen',       'aktiv', NULL,  true),
    (p_mandant_id, '1540', 'Büromaschinen / IT-Ausrüstung',       'aktiv', 'I81', true),
    (p_mandant_id, '1549', 'WB Büromaschinen / IT-Ausrüstung',   'aktiv', NULL,  true),
    (p_mandant_id, '1570', 'Immaterielle Anlagen (Software etc.)', 'aktiv', 'I81', false),
    (p_mandant_id, '1579', 'WB Immaterielle Anlagen',             'aktiv', NULL,  false),
    (p_mandant_id, '1600', 'Immobilien (Grundstücke, Gebäude)',   'aktiv', 'I81', false),
    (p_mandant_id, '1609', 'WB Immobilien',                       'aktiv', NULL,  false),
    -- Finanzanlagen
    (p_mandant_id, '1400', 'Finanzanlagen (langfristig)',         'aktiv', NULL,  false),

    -- ═══ KLASSE 2: PASSIVEN ═══════════════════════════════════════
    (p_mandant_id, '2000', 'Kreditoren',                          'passiv', NULL, true),
    (p_mandant_id, '2100', 'Bankverbindlichkeiten (kurzfristig)', 'passiv', NULL, true),
    (p_mandant_id, '2200', 'Geschuldete MWST',                    'passiv', NULL, true),
    (p_mandant_id, '2206', 'MWST-Abrechnungskonto',               'passiv', NULL, true),
    (p_mandant_id, '2270', 'Sozialversicherungsverbindlichkeiten', 'passiv', NULL, true),
    (p_mandant_id, '2280', 'Direkte Steuerverbindlichkeiten',     'passiv', NULL, true),
    (p_mandant_id, '2300', 'Passive Rechnungsabgrenzung',         'passiv', NULL, true),
    (p_mandant_id, '2320', 'Rückstellungen',                      'passiv', NULL, false),
    (p_mandant_id, '2400', 'Langfristige Bankschulden',           'passiv', NULL, false),
    (p_mandant_id, '2420', 'Hypotheken',                          'passiv', NULL, false),
    (p_mandant_id, '2450', 'Darlehen (langfristig)',              'passiv', NULL, false),
    (p_mandant_id, '2800', 'Aktienkapital / Stammkapital',        'passiv', NULL, true),
    (p_mandant_id, '2850', 'Gesetzliche Kapitalreserven',         'passiv', NULL, false),
    (p_mandant_id, '2860', 'Freiwillige Gewinnreserven',          'passiv', NULL, false),
    (p_mandant_id, '2900', 'Gewinnvortrag / Verlustvortrag',      'passiv', NULL, true),
    (p_mandant_id, '2979', 'Jahresgewinn / Jahresverlust',        'passiv', NULL, true),

    -- ═══ KLASSE 3: BETRIEBSERTRAG ═════════════════════════════════
    (p_mandant_id, '3000', 'Umsatzerlöse Produkte',               'ertrag', 'U81', true),
    (p_mandant_id, '3200', 'Umsatzerlöse Handel',                 'ertrag', 'U81', true),
    (p_mandant_id, '3400', 'Umsatzerlöse Dienstleistungen',       'ertrag', 'U81', true),
    (p_mandant_id, '3600', 'Sonstige Betriebserträge',            'ertrag', 'U81', true),
    (p_mandant_id, '3700', 'Eigenleistungen und Eigenverbrauch',  'ertrag', NULL,  false),
    (p_mandant_id, '3800', 'Ertragsminderungen (Rabatte, Retouren)', 'ertrag', 'U81', true),

    -- ═══ KLASSE 4: MATERIAL- / WARENAUFWAND ══════════════════════
    (p_mandant_id, '4000', 'Materialaufwand (Produktion)',        'aufwand', 'M81', true),
    (p_mandant_id, '4200', 'Warenaufwand (Handel)',               'aufwand', 'M81', true),
    (p_mandant_id, '4400', 'Bezogene Dienstleistungen',           'aufwand', 'M81', true),
    (p_mandant_id, '4500', 'Energieaufwand (Produktion)',         'aufwand', 'M81', false),
    (p_mandant_id, '4900', 'Bestandesänderungen',                 'aufwand', NULL,  false),

    -- ═══ KLASSE 5: PERSONALAUFWAND ════════════════════════════════
    (p_mandant_id, '5000', 'Löhne und Gehälter',                  'aufwand', 'M0', true),
    (p_mandant_id, '5700', 'AHV / IV / EO / ALV (Arbeitgeberanteil)', 'aufwand', 'M0', true),
    (p_mandant_id, '5710', 'Pensionskasse BVG (Arbeitgeberanteil)', 'aufwand', 'M0', true),
    (p_mandant_id, '5730', 'UVG / KTG',                           'aufwand', 'M0', true),
    (p_mandant_id, '5740', 'Kinderzulagen',                       'aufwand', 'M0', false),
    (p_mandant_id, '5800', 'Übriger Personalaufwand',             'aufwand', 'M81', true),
    (p_mandant_id, '5820', 'Personalspesen (pauschal)',           'aufwand', 'M81', false),
    (p_mandant_id, '5900', 'Temporäre Arbeitskräfte / Freelancer','aufwand', 'M81', false),

    -- ═══ KLASSE 6: ÜBRIGER BETRIEBLICHER AUFWAND ═════════════════
    (p_mandant_id, '6000', 'Miete / Raumaufwand',                 'aufwand', 'M81', true),
    (p_mandant_id, '6020', 'Nebenkosten (Heizung, Strom)',        'aufwand', 'M81', true),
    (p_mandant_id, '6040', 'Reinigung und Pflege',                'aufwand', 'M81', false),
    (p_mandant_id, '6100', 'Unterhalt, Reparaturen, Ersatz',      'aufwand', 'M81', true),
    (p_mandant_id, '6200', 'Fahrzeug- und Transportaufwand',      'aufwand', 'M81', true),
    (p_mandant_id, '6220', 'Treibstoff',                          'aufwand', 'M81', false),
    (p_mandant_id, '6260', 'Reise- und Spesenaufwand',            'aufwand', 'M81', true),
    (p_mandant_id, '6261', 'Geschäftsessen (50 % Abzug)',         'aufwand', 'M26', true),
    (p_mandant_id, '6300', 'Sachversicherungen',                  'aufwand', 'M0',  true),
    (p_mandant_id, '6320', 'Haftpflicht- und Betriebsversicherungen','aufwand', 'M0', false),
    (p_mandant_id, '6400', 'Energie und Entsorgung (Büro)',       'aufwand', 'M81', false),
    (p_mandant_id, '6500', 'Büromaterial und Drucksachen',        'aufwand', 'M81', true),
    (p_mandant_id, '6510', 'Telefon und Internet',                'aufwand', 'M81', true),
    (p_mandant_id, '6520', 'EDV / IT-Aufwand (Software, Lizenzen)','aufwand', 'M81', true),
    (p_mandant_id, '6530', 'Beratung, Treuhand, Rechtsberatung',  'aufwand', 'M81', true),
    (p_mandant_id, '6540', 'Buchführung und Revision',            'aufwand', 'M81', true),
    (p_mandant_id, '6560', 'Gebühren, Abgaben, Handelsregister',  'aufwand', 'M0',  true),
    (p_mandant_id, '6570', 'Aus- und Weiterbildung',              'aufwand', 'M81', true),
    (p_mandant_id, '6580', 'Bücher und Zeitschriften',            'aufwand', 'M26', false),
    (p_mandant_id, '6600', 'Werbe- und Marketingaufwand',         'aufwand', 'M81', true),
    (p_mandant_id, '6640', 'Messen, Ausstellungen, Events',       'aufwand', 'M81', false),
    (p_mandant_id, '6700', 'Sonstiger Betriebsaufwand',           'aufwand', 'M81', true),
    (p_mandant_id, '6800', 'Abschreibungen auf Anlagevermögen',   'aufwand', NULL,  true),
    (p_mandant_id, '6850', 'Wertberichtigungen Umlaufvermögen',   'aufwand', NULL,  false),
    (p_mandant_id, '6900', 'Zinsaufwand',                         'aufwand', 'M0',  true),
    (p_mandant_id, '6910', 'Bankspesen und Kommissionen',         'aufwand', 'M0',  true),
    (p_mandant_id, '6940', 'Kursdifferenzen (Verlust)',           'aufwand', NULL,  false),
    (p_mandant_id, '6960', 'Finanzertrag (Zinsen, Dividenden)',   'ertrag',  NULL,  true),

    -- ═══ KLASSE 7: NEBENBETRIEB / LIEGENSCHAFTEN ══════════════════
    (p_mandant_id, '7000', 'Ertrag Nebenbetrieb',                 'ertrag',  'U81', false),
    (p_mandant_id, '7010', 'Aufwand Nebenbetrieb',                'aufwand', 'M81', false),
    (p_mandant_id, '7500', 'Liegenschaftsertrag',                 'ertrag',  'U81', false),
    (p_mandant_id, '7510', 'Liegenschaftsaufwand',                'aufwand', 'M81', false),

    -- ═══ KLASSE 8: BETRIEBSFREMDES / AUSSERORDENTLICHES ══════════
    (p_mandant_id, '8000', 'Betriebsfremder Aufwand',             'aufwand', NULL,  false),
    (p_mandant_id, '8100', 'Betriebsfremder Ertrag',              'ertrag',  NULL,  false),
    (p_mandant_id, '8500', 'Ausserordentlicher Aufwand',          'aufwand', NULL,  false),
    (p_mandant_id, '8510', 'Ausserordentlicher Ertrag',           'ertrag',  NULL,  false),
    (p_mandant_id, '8900', 'Direkte Steuern (Ertragssteuer)',     'aufwand', NULL,  true),

    -- ═══ KLASSE 9: ABSCHLUSSKONTEN ════════════════════════════════
    (p_mandant_id, '9200', 'Jahresgewinn / Jahresverlust',        'abschluss', NULL, true)

  ON CONFLICT (mandant_id, konto_nr) DO NOTHING;
END;
$$;
