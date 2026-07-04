-- Erweitert customers um UID-Nummer und Rechtsform (Zefix-Integration)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS uid_nr      TEXT,
  ADD COLUMN IF NOT EXISTS rechtsform  TEXT,
  ADD COLUMN IF NOT EXISTS zefix_ehraid BIGINT,
  ADD COLUMN IF NOT EXISTS zefix_last_sync TIMESTAMPTZ;

COMMENT ON COLUMN customers.uid_nr         IS 'Unternehmens-Identifikationsnummer (CHE-xxx.xxx.xxx)';
COMMENT ON COLUMN customers.rechtsform     IS 'Rechtsform laut Handelsregister (z.B. AG, GmbH, Einzelunternehmen)';
COMMENT ON COLUMN customers.zefix_ehraid   IS 'Interne EHRA-ID aus Zefix fuer Aenderungsabgleich';
COMMENT ON COLUMN customers.zefix_last_sync IS 'Letzter Zefix-Abgleich-Zeitpunkt';
