-- =====================================================================
-- FiBu: Debitoren-MWST-Default-Fix
--   Die V→U-Umbenennung der Umsatzsteuer-Codes (20260518000003) wurde im
--   Debitoren-Fundament (20260607130000) nicht nachgezogen: die Spalten-
--   Defaults zeigten weiter auf 'V81' – einen Code, den es nicht mehr gibt.
--   Folge: neue Kunden/Artikel/Positionen erbten 'V81' → beim Buchen 0 % MWST,
--   und der Umsatz fiel in der MWST-Abrechnung mangels Code-Join komplett raus.
--
--   Dieser Fix:
--     1. Spalten-Defaults auf 'U81' umstellen.
--     2. Bereits angelegte V-Codes in Stammdaten (Kunden/Artikel) auf U mappen.
--     3. V-Codes in Positionen NUR von Entwürfen (status='entwurf') mappen.
--   NICHT angefasst: verbuchte Belege + fibu_buchungen (rückwirkende
--   Buchungsänderung → bewusst manuell via Storno/Korrektur).
-- =====================================================================

-- 1. Spalten-Defaults korrigieren
ALTER TABLE fibu_kunden                ALTER COLUMN mwst_code SET DEFAULT 'U81';
ALTER TABLE fibu_artikel               ALTER COLUMN mwst_code SET DEFAULT 'U81';
ALTER TABLE fibu_debitoren_positionen  ALTER COLUMN mwst_code SET DEFAULT 'U81';

-- 2. Stammdaten: V→U mappen (nur Code, keine Beträge betroffen)
UPDATE fibu_kunden  SET mwst_code = CASE mwst_code
  WHEN 'V81' THEN 'U81' WHEN 'V38' THEN 'U38'
  WHEN 'V26' THEN 'U26' WHEN 'V0'  THEN 'U0' END
WHERE mwst_code IN ('V81','V38','V26','V0');

UPDATE fibu_artikel SET mwst_code = CASE mwst_code
  WHEN 'V81' THEN 'U81' WHEN 'V38' THEN 'U38'
  WHEN 'V26' THEN 'U26' WHEN 'V0'  THEN 'U0' END
WHERE mwst_code IN ('V81','V38','V26','V0');

-- 3. Entwurfs-Positionen: Code mappen UND Beträge neu berechnen
--    (Entwürfe sind noch nicht verbucht – Neuberechnung ist sicher.
--     Beim erneuten Öffnen/Speichern rechnet das Frontend ohnehin neu.)
UPDATE fibu_debitoren_positionen p
SET mwst_code = m.neu,
    mwst_satz = m.satz,
    betrag_mwst   = ROUND(p.betrag_netto * m.satz / 100, 2),
    betrag_brutto = p.betrag_netto + ROUND(p.betrag_netto * m.satz / 100, 2)
FROM (VALUES
  ('V81','U81',8.1), ('V38','U38',3.8), ('V26','U26',2.6), ('V0','U0',0.0)
) AS m(alt, neu, satz)
WHERE p.mwst_code = m.alt
  AND EXISTS (
    SELECT 1 FROM fibu_debitoren_belege b
    WHERE b.id = p.beleg_id AND b.status = 'entwurf' AND b.verbucht = false
  );

-- 3b. Belegkopf-Summen der betroffenen Entwürfe an die neuen Positionen angleichen
UPDATE fibu_debitoren_belege b
SET betrag_netto  = t.netto,
    betrag_mwst   = t.mwst,
    betrag_brutto = t.brutto
FROM (
  SELECT beleg_id,
         ROUND(SUM(betrag_netto), 2)  AS netto,
         ROUND(SUM(betrag_mwst), 2)   AS mwst,
         ROUND(SUM(betrag_brutto), 2) AS brutto
  FROM fibu_debitoren_positionen
  GROUP BY beleg_id
) t
WHERE b.id = t.beleg_id
  AND b.status = 'entwurf' AND b.verbucht = false;
