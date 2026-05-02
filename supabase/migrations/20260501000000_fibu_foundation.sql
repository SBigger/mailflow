-- =====================================================================
-- FiBu Foundation: Kreditorenbuchhaltung + Mandantenfähigkeit
-- Migration: 20260501000000
-- =====================================================================

-- ── 1. Mandantenstamm ─────────────────────────────────────────────
CREATE TABLE fibu_mandanten (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT        NOT NULL,
  uid                      TEXT,                       -- CHE-xxx.xxx.xxx
  mwst_nr                  TEXT,
  mwst_pflichtig           BOOLEAN     NOT NULL DEFAULT true,
  geschaeftsjahr_beginn    SMALLINT    NOT NULL DEFAULT 1 CHECK (geschaeftsjahr_beginn BETWEEN 1 AND 12),
  waehrung                 CHAR(3)     NOT NULL DEFAULT 'CHF',
  kontenrahmen             TEXT        NOT NULL DEFAULT 'CH_KMU',
  adresse                  TEXT,
  plz                      TEXT,
  ort                      TEXT,
  land                     CHAR(2)     NOT NULL DEFAULT 'CH',
  aktiv                    BOOLEAN     NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. User → Mandant Zugang ──────────────────────────────────────
CREATE TABLE fibu_user_mandant_access (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mandant_id   UUID        NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL CHECK (role IN ('admin', 'buchhalter', 'readonly')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, mandant_id)
);

-- ── 3. Kontenplan ─────────────────────────────────────────────────
CREATE TABLE fibu_konten (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   UUID    NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  konto_nr     TEXT    NOT NULL,
  bezeichnung  TEXT    NOT NULL,
  konto_typ    TEXT    NOT NULL CHECK (konto_typ IN ('aktiv','passiv','ertrag','aufwand','abschluss')),
  mwst_code    TEXT,
  aktiv        BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(mandant_id, konto_nr)
);

-- ── 4. Lieferantenstamm ───────────────────────────────────────────
CREATE TABLE fibu_lieferanten (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id                UUID        NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  nr                        TEXT        NOT NULL,
  name                      TEXT        NOT NULL,
  uid                       TEXT,
  adresse                   TEXT,
  plz                       TEXT,
  ort                       TEXT,
  land                      CHAR(2)     NOT NULL DEFAULT 'CH',
  iban                      TEXT,
  bank_name                 TEXT,
  zahlungsbedingung_tage    SMALLINT    NOT NULL DEFAULT 30,
  skonto_prozent            NUMERIC(5,2),
  skonto_tage               SMALLINT,
  standard_konto_nr         TEXT,
  mwst_code                 TEXT        NOT NULL DEFAULT 'VS81',
  notiz                     TEXT,
  aktiv                     BOOLEAN     NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mandant_id, nr)
);

-- ── 5. Kreditoren-Belegköpfe ──────────────────────────────────────
CREATE TABLE fibu_kreditoren_belege (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id            UUID         NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  beleg_nr              TEXT         NOT NULL,               -- interne Nr., z.B. RE-2024-0142
  lieferant_id          UUID         NOT NULL REFERENCES fibu_lieferanten(id),
  lieferant_beleg_nr    TEXT,                                -- Nr. des Lieferanten
  belegdatum            DATE         NOT NULL,
  valutadatum           DATE,
  faelligkeit           DATE         NOT NULL,
  zahlungsbedingung_tage SMALLINT,
  waehrung              CHAR(3)      NOT NULL DEFAULT 'CHF',
  betrag_netto          NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_mwst           NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_brutto         NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_bezahlt        NUMERIC(14,2) NOT NULL DEFAULT 0,
  bezahlt_am            DATE,
  zahlungsreferenz      TEXT,                                -- QR-Referenznummer
  status                TEXT         NOT NULL DEFAULT 'offen'
                          CHECK (status IN ('offen','teilbezahlt','bezahlt','storniert')),
  notiz                 TEXT,
  scan_url              TEXT,                                -- PDF in Supabase Storage
  scan_ocr_text         TEXT,
  gebucht_am            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  gebucht_von           UUID         REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(mandant_id, beleg_nr)
);

-- ── 6. Kreditoren-Positionen (Buchungszeilen) ─────────────────────
CREATE TABLE fibu_kreditoren_positionen (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  beleg_id       UUID          NOT NULL REFERENCES fibu_kreditoren_belege(id) ON DELETE CASCADE,
  position       SMALLINT      NOT NULL DEFAULT 1,
  konto_nr       TEXT          NOT NULL,
  bezeichnung    TEXT,
  mwst_code      TEXT          NOT NULL DEFAULT 'VS81',
  mwst_satz      NUMERIC(5,2)  NOT NULL DEFAULT 8.1,
  betrag_netto   NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_mwst    NUMERIC(14,2) NOT NULL DEFAULT 0,
  betrag_brutto  NUMERIC(14,2) NOT NULL DEFAULT 0,
  kostenstelle   TEXT
);

-- ── 7. Hauptbuch-Buchungen ────────────────────────────────────────
CREATE TABLE fibu_buchungen (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  buchungs_nr    TEXT          NOT NULL,
  buchungsdatum  DATE          NOT NULL,
  beleg_ref      TEXT,                                       -- z.B. "KR/RE-2024-0142"
  konto_soll     TEXT          NOT NULL,
  konto_haben    TEXT          NOT NULL,
  betrag         NUMERIC(14,2) NOT NULL,
  mwst_code      TEXT,
  mwst_betrag    NUMERIC(14,2),
  text           TEXT,
  quelle         TEXT          CHECK (quelle IN ('kreditoren','debitoren','manuell','zahlungslauf','abschluss')),
  quelle_id      UUID,
  storniert      BOOLEAN       NOT NULL DEFAULT false,
  storno_von     UUID          REFERENCES fibu_buchungen(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by     UUID          REFERENCES auth.users(id),
  UNIQUE(mandant_id, buchungs_nr)
);

-- ── 8. Zahlungsläufe ──────────────────────────────────────────────
CREATE TABLE fibu_zahlungslaeufe (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id           UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  lauf_nr              TEXT          NOT NULL,
  valutadatum          DATE          NOT NULL,
  zahlungskonto_nr     TEXT          NOT NULL,
  zahlungskonto_iban   TEXT,
  total_betrag         NUMERIC(14,2) NOT NULL DEFAULT 0,
  anzahl_zahlungen     SMALLINT      NOT NULL DEFAULT 0,
  status               TEXT          NOT NULL DEFAULT 'entwurf'
                          CHECK (status IN ('entwurf','freigegeben','exportiert','verbucht')),
  pain001_xml          TEXT,
  exportiert_am        TIMESTAMPTZ,
  verbucht_am          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by           UUID          REFERENCES auth.users(id),
  UNIQUE(mandant_id, lauf_nr)
);

-- ── 9. Zahlungslauf-Positionen ────────────────────────────────────
CREATE TABLE fibu_zahlungslauf_positionen (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       UUID          NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  zahlungslauf_id  UUID          NOT NULL REFERENCES fibu_zahlungslaeufe(id) ON DELETE CASCADE,
  beleg_id         UUID          NOT NULL REFERENCES fibu_kreditoren_belege(id),
  lieferant_id     UUID          NOT NULL REFERENCES fibu_lieferanten(id),
  iban             TEXT          NOT NULL,
  betrag           NUMERIC(14,2) NOT NULL,
  zahlungsreferenz TEXT,
  zahlungsmitteilung TEXT
);

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX ON fibu_kreditoren_belege (mandant_id, status);
CREATE INDEX ON fibu_kreditoren_belege (mandant_id, faelligkeit);
CREATE INDEX ON fibu_kreditoren_belege (mandant_id, lieferant_id);
CREATE INDEX ON fibu_kreditoren_positionen (beleg_id);
CREATE INDEX ON fibu_buchungen (mandant_id, buchungsdatum);
CREATE INDEX ON fibu_buchungen (mandant_id, konto_soll);
CREATE INDEX ON fibu_buchungen (mandant_id, konto_haben);
CREATE INDEX ON fibu_user_mandant_access (user_id);

-- ── updated_at Trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fibu_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER fibu_mandanten_updated_at    BEFORE UPDATE ON fibu_mandanten    FOR EACH ROW EXECUTE FUNCTION fibu_set_updated_at();
CREATE TRIGGER fibu_lieferanten_updated_at  BEFORE UPDATE ON fibu_lieferanten  FOR EACH ROW EXECUTE FUNCTION fibu_set_updated_at();
CREATE TRIGGER fibu_belege_updated_at       BEFORE UPDATE ON fibu_kreditoren_belege FOR EACH ROW EXECUTE FUNCTION fibu_set_updated_at();

-- ── RLS aktivieren ────────────────────────────────────────────────
ALTER TABLE fibu_mandanten              ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_user_mandant_access    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_konten                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_lieferanten            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_kreditoren_belege      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_kreditoren_positionen  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_buchungen              ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_zahlungslaeufe         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibu_zahlungslauf_positionen ENABLE ROW LEVEL SECURITY;

-- ── Helper: alle zugänglichen Mandant-IDs des aktuellen Users ─────
CREATE OR REPLACE FUNCTION fibu_mandant_ids_for_user()
RETURNS UUID[] LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(ARRAY_AGG(mandant_id), '{}')
  FROM fibu_user_mandant_access
  WHERE user_id = auth.uid();
$$;

-- ── RLS Policies: fibu_mandanten ──────────────────────────────────
CREATE POLICY "fibu: select own mandanten" ON fibu_mandanten
  FOR SELECT USING (id = ANY(fibu_mandant_ids_for_user()));

CREATE POLICY "fibu: insert mandanten (admin)" ON fibu_mandanten
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM fibu_user_mandant_access
            WHERE user_id = auth.uid() AND role = 'admin')
    OR NOT EXISTS (SELECT 1 FROM fibu_user_mandant_access WHERE user_id = auth.uid())
  );

CREATE POLICY "fibu: update own mandanten (admin)" ON fibu_mandanten
  FOR UPDATE USING (
    id = ANY(fibu_mandant_ids_for_user()) AND
    EXISTS (SELECT 1 FROM fibu_user_mandant_access
            WHERE user_id = auth.uid() AND mandant_id = fibu_mandanten.id AND role = 'admin')
  );

-- ── RLS Policies: fibu_user_mandant_access ────────────────────────
CREATE POLICY "fibu: users see own access rows" ON fibu_user_mandant_access
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "fibu: admins manage access" ON fibu_user_mandant_access
  FOR ALL USING (
    mandant_id = ANY(fibu_mandant_ids_for_user()) AND
    EXISTS (SELECT 1 FROM fibu_user_mandant_access a2
            WHERE a2.user_id = auth.uid() AND a2.mandant_id = fibu_user_mandant_access.mandant_id AND a2.role = 'admin')
  );

-- ── Macro: content-Tabellen Policy (mandant_id IN accessible) ─────
-- fibu_konten
CREATE POLICY "fibu: konten select"  ON fibu_konten  FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: konten write"   ON fibu_konten  FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- fibu_lieferanten
CREATE POLICY "fibu: lieferanten select" ON fibu_lieferanten FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: lieferanten write"  ON fibu_lieferanten FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- fibu_kreditoren_belege
CREATE POLICY "fibu: belege select" ON fibu_kreditoren_belege FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: belege write"  ON fibu_kreditoren_belege FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- fibu_kreditoren_positionen
CREATE POLICY "fibu: positionen select" ON fibu_kreditoren_positionen FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: positionen write"  ON fibu_kreditoren_positionen FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- fibu_buchungen
CREATE POLICY "fibu: buchungen select" ON fibu_buchungen FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: buchungen write"  ON fibu_buchungen FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- fibu_zahlungslaeufe
CREATE POLICY "fibu: zlauf select" ON fibu_zahlungslaeufe FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: zlauf write"  ON fibu_zahlungslaeufe FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- fibu_zahlungslauf_positionen
CREATE POLICY "fibu: zlaufpos select" ON fibu_zahlungslauf_positionen FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
CREATE POLICY "fibu: zlaufpos write"  ON fibu_zahlungslauf_positionen FOR ALL    USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- ── Funktion: Swiss KMU Kontenplan für neuen Mandanten ────────────
CREATE OR REPLACE FUNCTION fibu_seed_kontenplan_ch_kmu(p_mandant_id UUID)
RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, mwst_code) VALUES
  -- Umlaufvermögen
  (p_mandant_id,'1000','Kasse','aktiv',NULL),
  (p_mandant_id,'1020','Bank','aktiv',NULL),
  (p_mandant_id,'1030','PostFinance','aktiv',NULL),
  (p_mandant_id,'1100','Debitoren aus Lieferungen & Leistungen','aktiv',NULL),
  (p_mandant_id,'1109','Delkredere','aktiv',NULL),
  (p_mandant_id,'1170','Vorsteuer (Eingangssteuern)','aktiv',NULL),
  (p_mandant_id,'1176','Verrechnungssteuer','aktiv',NULL),
  (p_mandant_id,'1200','Vorräte','aktiv',NULL),
  (p_mandant_id,'1300','Aktive Rechnungsabgrenzung','aktiv',NULL),
  -- Anlagevermögen
  (p_mandant_id,'1500','Maschinen, Einrichtungen','aktiv',NULL),
  (p_mandant_id,'1510','Fahrzeuge','aktiv',NULL),
  (p_mandant_id,'1520','Büromaschinen, EDV','aktiv',NULL),
  (p_mandant_id,'1800','Beteiligungen','aktiv',NULL),
  -- Kurzfristiges Fremdkapital
  (p_mandant_id,'2000','Kreditoren aus Lieferungen & Leistungen','passiv',NULL),
  (p_mandant_id,'2200','Mehrwertsteuer (Umsatzsteuern)','passiv',NULL),
  (p_mandant_id,'2206','Abrechnungskonto MWST','passiv',NULL),
  (p_mandant_id,'2210','Direkte Steuern (Rückstellung)','passiv',NULL),
  (p_mandant_id,'2300','Kurzfristige Bankverbindlichkeiten','passiv',NULL),
  (p_mandant_id,'2400','Passive Rechnungsabgrenzung','passiv',NULL),
  -- Langfristiges Fremdkapital
  (p_mandant_id,'2500','Langfristige Bankdarlehen','passiv',NULL),
  -- Eigenkapital
  (p_mandant_id,'2800','Aktienkapital / Stammkapital','passiv',NULL),
  (p_mandant_id,'2900','Gesetzliche Kapitalreserve','passiv',NULL),
  (p_mandant_id,'2910','Gesetzliche Gewinnreserve','passiv',NULL),
  (p_mandant_id,'2950','Freiwillige Gewinnreserven','passiv',NULL),
  (p_mandant_id,'2960','Gewinnvortrag / Verlustvortrag','passiv',NULL),
  (p_mandant_id,'2979','Jahresgewinn / Jahresverlust','passiv',NULL),
  -- Betriebsertrag
  (p_mandant_id,'3000','Dienstleistungsertrag','ertrag','UR81'),
  (p_mandant_id,'3400','Erlösminderungen','ertrag',NULL),
  -- Materialaufwand
  (p_mandant_id,'4200','Materialaufwand','aufwand','VS81'),
  -- Personalaufwand
  (p_mandant_id,'5000','Lohnaufwand','aufwand',NULL),
  (p_mandant_id,'5700','Sozialversicherungsaufwand (AHV/IV/EO/ALV)','aufwand',NULL),
  (p_mandant_id,'5720','Pensionskassenaufwand (BVG)','aufwand',NULL),
  (p_mandant_id,'5730','UVG / UVGZ Aufwand','aufwand',NULL),
  (p_mandant_id,'5800','Übriger Personalaufwand','aufwand',NULL),
  -- Sonstiger Betriebsaufwand
  (p_mandant_id,'6000','Raumaufwand','aufwand','VS81'),
  (p_mandant_id,'6100','Unterhalt, Reparaturen','aufwand','VS81'),
  (p_mandant_id,'6200','Fahrzeug- und Transportaufwand','aufwand','VS81'),
  (p_mandant_id,'6210','Energieaufwand','aufwand','VS81'),
  (p_mandant_id,'6300','Versicherungsaufwand','aufwand',NULL),
  (p_mandant_id,'6400','Verwaltungsaufwand','aufwand','VS81'),
  (p_mandant_id,'6500','IT-Infrastruktur','aufwand','VS81'),
  (p_mandant_id,'6510','Büromaschinen, Mobiliar','aufwand','VS81'),
  (p_mandant_id,'6600','Büromaterial','aufwand','VS26'),
  (p_mandant_id,'6640','Reisekosten','aufwand',NULL),
  (p_mandant_id,'6700','Werbeaufwand','aufwand','VS81'),
  (p_mandant_id,'6800','Beratungsaufwand','aufwand','VS81'),
  (p_mandant_id,'6900','Abschreibungen','aufwand',NULL),
  -- Finanzertrag / -aufwand
  (p_mandant_id,'7000','Finanzertrag','ertrag',NULL),
  (p_mandant_id,'7100','Finanzaufwand','aufwand',NULL),
  -- Betriebsfremdes / Ausserordentliches
  (p_mandant_id,'8000','Betriebsfremder Ertrag','ertrag',NULL),
  (p_mandant_id,'8100','Betriebsfremder Aufwand','aufwand',NULL),
  (p_mandant_id,'8900','Direkte Steuern','aufwand',NULL),
  -- Abschlusskonten
  (p_mandant_id,'9000','Eröffnungsbilanz','abschluss',NULL),
  (p_mandant_id,'9100','Schlussbilanz','abschluss',NULL),
  (p_mandant_id,'9200','Erfolgsrechnung','abschluss',NULL);
$$;
