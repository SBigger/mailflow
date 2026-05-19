-- ─────────────────────────────────────────────────────────────────
-- Status 'ebanking' für fibu_kreditoren_belege
-- Bedeutung: pain.001 exportiert, wartet auf CAMT-Bestätigung
-- ─────────────────────────────────────────────────────────────────

-- CHECK-Constraint erweitern (inkl. 'ausstehend' das bereits im Frontend genutzt wird)
ALTER TABLE fibu_kreditoren_belege
  DROP CONSTRAINT IF EXISTS fibu_kreditoren_belege_status_check;

ALTER TABLE fibu_kreditoren_belege
  ADD CONSTRAINT fibu_kreditoren_belege_status_check
  CHECK (status IN ('offen','ausstehend','teilbezahlt','bezahlt','ebanking','storniert'));

-- fibu_bank_match_kreditor: auch ebanking-Belege können als bezahlt markiert werden
-- (Die Funktion schreibt status direkt – keine Änderung nötig, CHECK lässt es jetzt durch)
