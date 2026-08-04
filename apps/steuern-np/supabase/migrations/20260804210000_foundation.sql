-- =====================================================================
-- Steuern nP — Foundation
-- Migration: 20260804210000
--
-- EIGENSTÄNDIGES Supabase-Projekt. Keine Verbindung zur MailFlow-Datenbank:
-- Steuerdaten unterliegen dem Steuergeheimnis und liegen deshalb physisch
-- getrennt, mit eigener Auth und eigenen Policies.
--
-- Konzept: docs/recherche-und-architektur.md
--
-- Zwei Invarianten werden hier hart erzwungen:
--   1. Kein Positionswert ohne Herkunft (Beleg oder menschliche Bestätigung).
--   2. einreichungen ist append-only — eine Korrektur ist eine neue Zeile,
--      niemals ein UPDATE.
-- =====================================================================

-- ── 1. Mandantenstamm ─────────────────────────────────────────────
-- Ein Mandant ist hier das Treuhandmandat, unter dem eine oder mehrere
-- steuerpflichtige Personen betreut werden.
CREATE TABLE mandanten (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  uid          TEXT,                       -- CHE-xxx.xxx.xxx des Treuhandmandats
  -- TH-ID aus dem kantonalen Treuhänder-Register (ZH vergibt eine je Vertreter).
  -- Ohne sie ist keine elektronische Einreichung möglich.
  th_id_zh     TEXT,
  aktiv        BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. User → Mandant ─────────────────────────────────────────────
CREATE TABLE user_mandant_access (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mandant_id   UUID        NOT NULL REFERENCES mandanten(id) ON DELETE CASCADE,
  -- admin darf freigeben und einreichen, bearbeiter nur erfassen
  role         TEXT        NOT NULL CHECK (role IN ('admin', 'bearbeiter', 'readonly')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mandant_id)
);

-- ── 3. Steuerpflichtige natürliche Person ─────────────────────────
CREATE TABLE np_personen (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id     UUID        NOT NULL REFERENCES mandanten(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  vorname        TEXT,
  -- Die AHV-Nummer wird NICHT im Klartext geführt. Der Hash dient dem
  -- Abgleich beim Beleg-Ingest; der Klartext wird erst beim XML-Export
  -- aus einer separat zu schaffenden, verschlüsselten Ablage gezogen.
  ahv_nr_hash    TEXT,
  geburtsdatum   DATE,
  zivilstand     TEXT        CHECK (zivilstand IN
                   ('ledig','verheiratet','eingetragen','getrennt','geschieden','verwitwet')),
  konfession     TEXT,
  kanton         CHAR(2)     NOT NULL CHECK (kanton IN ('ZH','SG','TG')),
  gemeinde       TEXT,
  strasse        TEXT,
  plz            TEXT,
  ort            TEXT,
  aktiv          BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN np_personen.kanton IS
  'Vorerst ZH/SG/TG. Weitere Kantone erst nach geklärtem Einreichungskanal.';

-- ── 4. Steuererklärung = Person × Periode ─────────────────────────
CREATE TABLE deklarationen (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id        UUID        NOT NULL REFERENCES mandanten(id) ON DELETE CASCADE,
  person_id         UUID        NOT NULL REFERENCES np_personen(id) ON DELETE CASCADE,
  periode           SMALLINT    NOT NULL CHECK (periode BETWEEN 2020 AND 2100),
  kanton            CHAR(2)     NOT NULL CHECK (kanton IN ('ZH','SG','TG')),
  status            TEXT        NOT NULL DEFAULT 'entwurf'
                      CHECK (status IN ('entwurf','review','freigegeben','eingereicht','quittiert','storniert')),
  ech_version       TEXT        NOT NULL DEFAULT '4.0.0',
  -- Ohne Vollmacht darf nicht eingereicht werden. In ZH entweder als
  -- unterzeichnete Generalvollmacht beim Steueramt oder über den
  -- weitergegebenen Zugangscode für die laufende Periode.
  vollmacht_status  TEXT        NOT NULL DEFAULT 'offen'
                      CHECK (vollmacht_status IN ('offen','erteilt','abgelaufen')),
  vollmacht_bis     DATE,
  bemerkung         TEXT,
  created_by        UUID        REFERENCES auth.users(id),
  freigegeben_von   UUID        REFERENCES auth.users(id),
  freigegeben_am    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_id, periode)
);

-- ── 5. Beleg im Dossier ───────────────────────────────────────────
CREATE TABLE belege (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       UUID        NOT NULL REFERENCES mandanten(id) ON DELETE CASCADE,
  deklaration_id   UUID        NOT NULL REFERENCES deklarationen(id) ON DELETE CASCADE,
  storage_path     TEXT,
  dateiname        TEXT,
  -- SHA-256 über den Dateiinhalt: Grundlage der Duplikatserkennung
  datei_hash       TEXT,
  quelle           TEXT        NOT NULL DEFAULT 'upload'
                     CHECK (quelle IN ('upload','portal','mail','scan','manuell')),
  belegart         TEXT,       -- siehe src/lib/belegarten.js
  parse_methode    TEXT        CHECK (parse_methode IN
                     ('ech0196','ech0270','ech0275','pdf_text','ocr','manuell')),
  relevanz         TEXT        NOT NULL DEFAULT 'unklar'
                     CHECK (relevanz IN ('relevant','nicht_relevant','unklar')),
  relevanz_grund   TEXT,       -- 'duplikat', 'falsche_periode', 'werbung', …
  confidence       NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  periode_beleg    SMALLINT,   -- im Beleg erkannte Periode, für die Plausi
  roh_text         TEXT,       -- OCR-/PDF-Volltext für Suche und Plausi-Checks
  roh_xml          TEXT,       -- bei eCH-0196/0275 das strukturierte Original
  bestaetigt_von   UUID        REFERENCES auth.users(id),
  bestaetigt_am    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN belege.relevanz IS
  'Aussortierte Belege werden nie gelöscht und im UI sichtbar gehalten — ein '
  'zu Unrecht aussortierter Beleg ist der teuerste Fehler im System.';

-- ── 6. Extrahierte Position ───────────────────────────────────────
CREATE TABLE positionen (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       UUID        NOT NULL REFERENCES mandanten(id) ON DELETE CASCADE,
  deklaration_id   UUID        NOT NULL REFERENCES deklarationen(id) ON DELETE CASCADE,
  beleg_id         UUID        REFERENCES belege(id) ON DELETE SET NULL,
  -- Zielelement im eCH-0119-XML, z.B. 'listOfSecurities.totalTaxValue'.
  -- VORLÄUFIG: die XSD konnte noch nicht eingesehen werden (Backlog V1).
  ech_pfad         TEXT        NOT NULL,
  bezeichnung      TEXT,
  wert_num         NUMERIC(14,2),
  wert_text        TEXT,
  waehrung         CHAR(3)     NOT NULL DEFAULT 'CHF',
  confidence       NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  herkunft         TEXT        NOT NULL DEFAULT 'ki'
                     CHECK (herkunft IN ('ech0196','ech0270','ech0275','ki','manuell','vorjahr')),
  bestaetigt_von   UUID        REFERENCES auth.users(id),
  bestaetigt_am    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- INVARIANTE 1: kein Zahlenwert ohne Herkunft.
  CONSTRAINT positionen_herkunft_notwendig CHECK (
    wert_num IS NULL OR beleg_id IS NOT NULL OR bestaetigt_von IS NOT NULL
  )
);

-- ── 7. Einreichung (append-only) ──────────────────────────────────
CREATE TABLE einreichungen (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id       UUID        NOT NULL REFERENCES mandanten(id) ON DELETE CASCADE,
  deklaration_id   UUID        NOT NULL REFERENCES deklarationen(id) ON DELETE RESTRICT,
  kanton           CHAR(2)     NOT NULL,
  kanal            TEXT        NOT NULL
                     CHECK (kanal IN ('th_register_zh','etax_sg','efisc_tg','manuell','test')),
  paket_hash       TEXT        NOT NULL,   -- SHA-256 über taxDeclaration.xml + attachments
  paket_path       TEXT,                   -- unveränderliches Archiv des Pakets
  uebermittelt_von UUID        REFERENCES auth.users(id),
  uebermittelt_am  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quittung_ref     TEXT,
  quittung_raw     TEXT,
  ersetzt_id       UUID        REFERENCES einreichungen(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE einreichungen IS
  'Append-only. Eine Korrektur ist eine neue Zeile mit ersetzt_id auf den '
  'Vorgänger — niemals ein UPDATE. Es gibt bewusst keine UPDATE-/DELETE-Policy.';

-- ── 8. Audit-Trail ────────────────────────────────────────────────
-- Bei geteilten Kantons-Zugängen (SG erlaubt einen Firmenaccount auf bis zu
-- fünf Geräten) ist das die einzige Stelle, an der nachvollziehbar bleibt,
-- welcher Mensch was freigegeben hat.
CREATE TABLE audit_log (
  id               BIGSERIAL   PRIMARY KEY,
  mandant_id       UUID        REFERENCES mandanten(id) ON DELETE CASCADE,
  deklaration_id   UUID        REFERENCES deklarationen(id) ON DELETE CASCADE,
  user_id          UUID        REFERENCES auth.users(id),
  aktion           TEXT        NOT NULL,
  entitaet         TEXT,
  entitaet_id      UUID,
  alt              JSONB,
  neu              JSONB,
  ts               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. Kantonale Parameter pro Steuerperiode ──────────────────────
-- Pauschalen, Maxima und Schwellenwerte gehören weder in den Code noch in
-- den LLM-Prompt, sondern hierhin: versioniert pro Kanton und Jahr.
CREATE TABLE parameter (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kanton       CHAR(2)     NOT NULL,       -- 'CH' für Bundesrecht
  periode      SMALLINT    NOT NULL,
  schluessel   TEXT        NOT NULL,       -- z.B. 'saeule3a_max_mit_pk'
  wert_num     NUMERIC(14,2),
  wert_text    TEXT,
  quelle       TEXT,                       -- Beleg für den Wert (Wegleitung o.ä.)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kanton, periode, schluessel)
);

-- ── Indizes ───────────────────────────────────────────────────────
CREATE INDEX ON np_personen         (mandant_id);
CREATE INDEX ON deklarationen       (mandant_id);
CREATE INDEX ON deklarationen       (person_id, periode);
CREATE INDEX ON belege              (deklaration_id);
CREATE INDEX ON belege              (deklaration_id, relevanz);
CREATE INDEX ON belege              (datei_hash);
CREATE INDEX ON positionen          (deklaration_id);
CREATE INDEX ON positionen          (beleg_id);
CREATE INDEX ON einreichungen       (deklaration_id);
CREATE INDEX ON audit_log           (deklaration_id, ts DESC);
CREATE INDEX ON user_mandant_access (user_id);

-- ── updated_at Trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER mandanten_updated_at     BEFORE UPDATE ON mandanten
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER np_personen_updated_at   BEFORE UPDATE ON np_personen
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deklarationen_updated_at BEFORE UPDATE ON deklarationen
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER belege_updated_at        BEFORE UPDATE ON belege
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER positionen_updated_at    BEFORE UPDATE ON positionen
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Einreichung sperren, solange Voraussetzungen fehlen ───────────
-- Der Agent bereitet vor, ein Mensch gibt frei. Diese Regel steht in der
-- Datenbank, nicht nur im UI — sonst hält sie beim ersten Skript nicht.
CREATE OR REPLACE FUNCTION pruefe_einreichung()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  dek   RECORD;
  offen INT;
BEGIN
  SELECT * INTO dek FROM deklarationen WHERE id = NEW.deklaration_id;

  IF dek.vollmacht_status <> 'erteilt' THEN
    RAISE EXCEPTION 'Einreichung ohne erteilte Vollmacht nicht zulässig (Deklaration %)',
      NEW.deklaration_id;
  END IF;

  IF dek.freigegeben_von IS NULL THEN
    RAISE EXCEPTION 'Einreichung ohne menschliche Freigabe nicht zulässig (Deklaration %)',
      NEW.deklaration_id;
  END IF;

  SELECT COUNT(*) INTO offen
  FROM positionen
  WHERE deklaration_id = NEW.deklaration_id
    AND wert_num IS NOT NULL
    AND bestaetigt_von IS NULL
    AND COALESCE(confidence, 0) < 0.85;

  IF offen > 0 THEN
    RAISE EXCEPTION '% unbestätigte Position(en) unter Schwellwert — Einreichung gesperrt', offen;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER einreichungen_pruefen
  BEFORE INSERT ON einreichungen
  FOR EACH ROW EXECUTE FUNCTION pruefe_einreichung();

-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE mandanten           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mandant_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE np_personen         ENABLE ROW LEVEL SECURITY;
ALTER TABLE deklarationen       ENABLE ROW LEVEL SECURITY;
ALTER TABLE belege              ENABLE ROW LEVEL SECURITY;
ALTER TABLE positionen          ENABLE ROW LEVEL SECURITY;
ALTER TABLE einreichungen       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE parameter           ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION mandant_ids_for_user()
RETURNS UUID[] LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(ARRAY_AGG(mandant_id), '{}')
  FROM user_mandant_access
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION darf_einreichen(p_mandant UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_mandant_access
    WHERE user_id = auth.uid() AND mandant_id = p_mandant AND role = 'admin'
  );
$$;

-- Mandanten und Zugriffszeilen
CREATE POLICY mandanten_read ON mandanten
  FOR SELECT TO authenticated USING (id = ANY(mandant_ids_for_user()));

CREATE POLICY access_read_own ON user_mandant_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Fachtabellen: lesen und schreiben für alle mit Mandantenzugang
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['np_personen','deklarationen','belege','positionen'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (mandant_id = ANY(mandant_ids_for_user())) '
      'WITH CHECK (mandant_id = ANY(mandant_ids_for_user()))',
      t || '_rw', t);
  END LOOP;
END $$;

-- Einreichungen: lesen alle mit Zugang, schreiben nur Admins.
-- Bewusst KEINE UPDATE-/DELETE-Policy — Invariante 2.
CREATE POLICY einreichungen_read ON einreichungen
  FOR SELECT TO authenticated
  USING (mandant_id = ANY(mandant_ids_for_user()));

CREATE POLICY einreichungen_insert ON einreichungen
  FOR INSERT TO authenticated
  WITH CHECK (
    mandant_id = ANY(mandant_ids_for_user())
    AND darf_einreichen(mandant_id)
  );

-- Audit-Log: lesen und anfügen, nie ändern
CREATE POLICY audit_read ON audit_log
  FOR SELECT TO authenticated
  USING (mandant_id = ANY(mandant_ids_for_user()));

CREATE POLICY audit_insert ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (mandant_id = ANY(mandant_ids_for_user()));

-- Parameter sind kantonales Allgemeinwissen: lesbar für alle, Pflege via service_role
CREATE POLICY parameter_read ON parameter
  FOR SELECT TO authenticated USING (true);
