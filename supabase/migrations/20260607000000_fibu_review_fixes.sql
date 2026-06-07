-- =====================================================================
-- FiBu Kreditoren – Sammel-Fix aus Code-Review (2026-06-07)
-- Branch: claude/fibu-kredi-app-review-ngHRL
--
-- Behebt geldkritische Befunde im Kreditoren-Modul. Jede RPC wird als
-- spätere Redefinition (CREATE OR REPLACE) über die jeweils zuletzt
-- gültige Version gelegt. Reihenfolge der Abschnitte = Abhängigkeiten.
--
--   Schema   neue Spalten skonto_gebucht / skonto_betrag
--   S1       Storno verbucht-Guard (keine einseitige Phantom-Buchung)
--   S2       Zahlungslauf-Storno: OP-Saldo == Hauptbuch (Teilzahlung)
--   S3       FIFO-Verrechnung mit Zeilensperre (FOR UPDATE)
--   S4/Bug3  Skonto idempotent, verbucht-Guard, quelle='skonto',
--            Verbuchung erst bei Bank-Bestätigung statt beim Export
--   S5/S6    Bank-Match: einheitliche Rundungstoleranz + Lauf-Abschluss
--            über Positions-Rückmeldung
--   S7       Saldovortrag: Konto ohne konto_typ -> Fehler statt still falsch
--   Bug1     fibu_kreditoren_bearbeiten: Beleg ändern OHNE Doppel-Verbuchung
--   Bug2     fibu_op_liste_kreditoren: echte Offene-Posten per Stichtag
-- =====================================================================

-- ── Schema ───────────────────────────────────────────────────────────
-- Idempotenz-Flag für die Skonto-Buchung (verhindert Doppelbuchung)
ALTER TABLE fibu_kreditoren_belege
  ADD COLUMN IF NOT EXISTS skonto_gebucht BOOLEAN NOT NULL DEFAULT false;

-- geplanter Skonto-Abzug je Zahlungslauf-Position; wird erst bei der
-- Bank-Rückmeldung (camt) verbucht, nicht schon beim pain.001-Export.
ALTER TABLE fibu_zahlungslauf_positionen
  ADD COLUMN IF NOT EXISTS skonto_betrag NUMERIC(14,2) NOT NULL DEFAULT 0;


-- =====================================================================
-- S1 · Storno einer Lieferantenrechnung
-- Fix: Ist die Originalrechnung NICHT verbucht, existiert keine GL-
-- Buchung. Dann darf KEINE Storno-Gutschrift verbucht werden (sonst
-- entsteht eine einseitige Gegenbuchung). Beleg wird nur als storniert
-- markiert.
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_kreditoren_storno(
  p_beleg_id     UUID,
  p_storno_datum DATE
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r        fibu_kreditoren_belege;
  v_storno   UUID;
  v_nr       TEXT;
BEGIN
  SELECT * INTO v_r FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_r.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF v_r.belegtyp <> 'rechnung' THEN
    RAISE EXCEPTION 'Nur Rechnungen können storniert werden';
  END IF;
  IF v_r.status = 'storniert' OR v_r.storno_beleg_id IS NOT NULL THEN
    RAISE EXCEPTION 'Beleg % ist bereits storniert', v_r.beleg_nr;
  END IF;
  IF COALESCE(v_r.betrag_bezahlt, 0) <> 0 THEN
    RAISE EXCEPTION 'Rechnung % ist bereits (teil)bezahlt oder verrechnet und kann nicht storniert werden', v_r.beleg_nr;
  END IF;

  -- ── Nicht verbucht → es gibt keine GL-Buchung zum Gegenbuchen.
  -- Nur Status setzen, keine Storno-Gutschrift verbuchen. ──
  IF NOT COALESCE(v_r.verbucht, false) THEN
    UPDATE fibu_kreditoren_belege
    SET status = 'storniert', updated_at = NOW()
    WHERE id = p_beleg_id;
    RETURN NULL;
  END IF;

  -- eindeutige Beleg-Nr. für die Storno-Gutschrift
  v_nr := v_r.beleg_nr || '-S';
  IF EXISTS (SELECT 1 FROM fibu_kreditoren_belege
             WHERE mandant_id = v_r.mandant_id AND beleg_nr = v_nr) THEN
    v_nr := v_r.beleg_nr || '-S' || TO_CHAR(NOW(), 'SSSS');
  END IF;

  -- Storno-Gutschrift anlegen (gespiegelte, negative Beträge)
  INSERT INTO fibu_kreditoren_belege (
    mandant_id, beleg_nr, lieferant_id, lieferant_beleg_nr,
    belegdatum, valutadatum, faelligkeit, zahlungsbedingung_tage,
    waehrung, betrag_netto, betrag_mwst, betrag_brutto,
    belegtyp, status, notiz, gebucht_von
  ) VALUES (
    v_r.mandant_id, v_nr, v_r.lieferant_id, v_r.lieferant_beleg_nr,
    p_storno_datum, p_storno_datum, p_storno_datum, 0,
    v_r.waehrung, -v_r.betrag_netto, -v_r.betrag_mwst, -v_r.betrag_brutto,
    'gutschrift', 'storniert',
    'Storno zu ' || v_r.beleg_nr || COALESCE(' – ' || v_r.notiz, ''),
    auth.uid()
  ) RETURNING id INTO v_storno;

  -- Positionen 1:1 kopieren (positiv – die Verbuchung dreht die Richtung)
  INSERT INTO fibu_kreditoren_positionen (
    mandant_id, beleg_id, position, konto_nr, bezeichnung,
    mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
  )
  SELECT mandant_id, v_storno, position, konto_nr, bezeichnung,
         mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
  FROM fibu_kreditoren_positionen
  WHERE beleg_id = p_beleg_id;

  -- Storno-Gutschrift verbuchen (Gegenbuchung, datiert auf Storno-Datum)
  PERFORM fibu_kreditoren_verbuchen(v_storno);

  -- Original-Rechnung als storniert markieren
  UPDATE fibu_kreditoren_belege
  SET status = 'storniert', storno_beleg_id = v_storno, updated_at = NOW()
  WHERE id = p_beleg_id;

  RETURN v_storno;
END;
$$;


-- =====================================================================
-- S3 · FIFO-Verrechnung von Lieferanten-Gutschriften
-- Fix: Gutschrift- UND Rechnungszeilen werden mit FOR UPDATE gesperrt,
-- damit parallele Aufrufe (zweiter Verrechnungs-Klick, gleichzeitiger
-- Zahlungslauf/Bank-Match) nicht denselben Betrag doppelt verrechnen.
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_gutschrift_verrechnen(
  p_mandant_id    UUID,
  p_gutschrift_id UUID
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gs    RECORD;
  v_offen NUMERIC;     -- noch zu verrechnender Gutschrift-Betrag (positiv)
  v_rest  NUMERIC;
  v_x     NUMERIC;
  v_r     RECORD;
  v_total NUMERIC := 0;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  -- Gutschrift-Zeile sperren (verhindert parallele Doppelverrechnung)
  SELECT * INTO v_gs FROM fibu_kreditoren_belege
  WHERE id = p_gutschrift_id AND mandant_id = p_mandant_id AND belegtyp = 'gutschrift'
  FOR UPDATE;
  IF v_gs.id IS NULL THEN
    RAISE EXCEPTION 'Gutschrift nicht gefunden';
  END IF;

  -- offener Gutschrift-Betrag (Beträge sind bei Gutschriften negativ)
  v_offen := ABS(v_gs.betrag_brutto) - ABS(COALESCE(v_gs.betrag_bezahlt, 0));
  IF v_offen <= 0.005 THEN
    RAISE EXCEPTION 'Gutschrift ist bereits vollständig verrechnet';
  END IF;

  FOR v_r IN
    SELECT * FROM fibu_kreditoren_belege
    WHERE mandant_id = p_mandant_id
      AND lieferant_id = v_gs.lieferant_id
      AND belegtyp = 'rechnung'
      AND status IN ('offen', 'teilbezahlt')
    ORDER BY belegdatum, beleg_nr
    FOR UPDATE
  LOOP
    EXIT WHEN v_offen <= 0.005;
    v_rest := v_r.betrag_brutto - COALESCE(v_r.betrag_bezahlt, 0);
    CONTINUE WHEN v_rest <= 0.005;

    v_x := LEAST(v_rest, v_offen);

    -- Rechnung: betrag_bezahlt erhöhen
    UPDATE fibu_kreditoren_belege SET
      betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + v_x,
      status = CASE WHEN COALESCE(betrag_bezahlt, 0) + v_x >= betrag_brutto - 0.005
                    THEN 'bezahlt' ELSE 'teilbezahlt' END,
      updated_at = NOW()
    WHERE id = v_r.id;

    -- Gutschrift: betrag_bezahlt (negativ) Richtung betrag_brutto bewegen
    UPDATE fibu_kreditoren_belege SET
      betrag_bezahlt = COALESCE(betrag_bezahlt, 0) - v_x,
      status = CASE WHEN ABS(COALESCE(betrag_bezahlt, 0) - v_x) >= ABS(betrag_brutto) - 0.005
                    THEN 'bezahlt' ELSE 'teilbezahlt' END,
      updated_at = NOW()
    WHERE id = v_gs.id;

    INSERT INTO fibu_kreditoren_verrechnungen
      (mandant_id, gutschrift_beleg_id, rechnung_beleg_id, betrag, created_by)
    VALUES (p_mandant_id, v_gs.id, v_r.id, v_x, auth.uid());

    v_offen := v_offen - v_x;
    v_total := v_total + v_x;
  END LOOP;

  RETURN v_total;
END;
$$;


-- =====================================================================
-- S4 / Bug3 · Skonto-Buchung
-- Fix: (a) verbucht-Guard – Skonto nur auf bereits verbuchten Beleg.
--      (b) Idempotenz über skonto_gebucht – kein Doppel-Skonto.
--      (c) quelle='skonto' statt 'kreditoren', damit die Skonto-Buchung
--          beim Zahlungslauf-Storno eindeutig gegengebucht werden kann.
-- Aufruf erfolgt jetzt aus fibu_bank_match_kreditor (bei Bank-Bestätigung).
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_skonto_buchen(
  p_beleg_id      UUID,
  p_skonto_betrag NUMERIC,
  p_datum         DATE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_beleg    RECORD;
  v_methode  TEXT;
  v_saldo    BOOLEAN;
  v_pos      RECORD;
  v_vs       NUMERIC;       -- Vorsteuer-Anteil des Skontos
  v_netto    NUMERIC;       -- Netto-Anteil des Skontos
  v_nr       TEXT;
BEGIN
  SELECT * INTO v_beleg FROM fibu_kreditoren_belege WHERE id = p_beleg_id FOR UPDATE;
  IF v_beleg.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_beleg.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF p_skonto_betrag IS NULL OR p_skonto_betrag <= 0 THEN
    RETURN;
  END IF;
  -- (a) Skonto setzt eine bestehende GL-Buchung voraus
  IF NOT COALESCE(v_beleg.verbucht, false) THEN
    RAISE EXCEPTION 'Skonto kann nur auf einen verbuchten Beleg gebucht werden (%).', v_beleg.beleg_nr;
  END IF;
  -- (b) Idempotenz: bereits gebucht → nichts tun
  IF COALESCE(v_beleg.skonto_gebucht, false) THEN
    RETURN;
  END IF;

  SELECT mwst_methode INTO v_methode FROM fibu_mandanten WHERE id = v_beleg.mandant_id;
  v_saldo := (COALESCE(v_methode, 'effektiv') = 'saldosteuersatz');

  -- Hauptposition: liefert Aufwandskonto + Vorsteuer-Konto
  SELECT p.*, mc.konto_vorsteuer INTO v_pos
  FROM fibu_kreditoren_positionen p
  LEFT JOIN fibu_mwst_codes mc ON mc.mandant_id = p.mandant_id AND mc.code = p.mwst_code
  WHERE p.beleg_id = p_beleg_id
  ORDER BY p.position
  LIMIT 1;
  IF v_pos.konto_nr IS NULL THEN
    RAISE EXCEPTION 'Beleg % hat keine Positionen', v_beleg.beleg_nr;
  END IF;

  -- Vorsteuer-Anteil (nur effektive Methode, anteilig zum MWST-Satz des Belegs)
  IF NOT v_saldo
     AND COALESCE(v_beleg.betrag_mwst, 0) > 0
     AND COALESCE(v_beleg.betrag_brutto, 0) <> 0
     AND v_pos.konto_vorsteuer IS NOT NULL THEN
    v_vs := ROUND(p_skonto_betrag * ABS(v_beleg.betrag_mwst) / ABS(v_beleg.betrag_brutto), 2);
  ELSE
    v_vs := 0;
  END IF;
  v_netto := p_skonto_betrag - v_vs;

  -- ── Buchung 1: Kreditoren SOLL / Aufwand HABEN (Netto-Anteil) ──────
  v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
  INSERT INTO fibu_buchungen (
    mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
    konto_soll, konto_haben, betrag, text, quelle, quelle_id, created_by
  ) VALUES (
    v_beleg.mandant_id, v_nr, p_datum, v_beleg.beleg_nr,
    '2000', v_pos.konto_nr, v_netto,
    'Skonto ' || v_beleg.beleg_nr, 'skonto', p_beleg_id, auth.uid()
  );

  -- ── Buchung 2: Vorsteuer-Korrektur (nur effektiv, wenn MWST) ──────
  IF v_vs > 0 THEN
    v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
      text, quelle, quelle_id, created_by
    ) VALUES (
      v_beleg.mandant_id, v_nr, p_datum, v_beleg.beleg_nr,
      '2000', v_pos.konto_vorsteuer, v_vs,
      v_pos.mwst_code, -v_vs,
      'Skonto Vorsteuer-Korrektur ' || v_beleg.beleg_nr,
      'skonto', p_beleg_id, auth.uid()
    );
  END IF;

  -- ── Beleg: Skonto-Betrag als bezahlt gutschreiben + Flag setzen ───
  UPDATE fibu_kreditoren_belege SET
    betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + p_skonto_betrag,
    skonto_gebucht = true,
    status = CASE
      WHEN COALESCE(betrag_bezahlt, 0) + p_skonto_betrag >= betrag_brutto - 0.005
        THEN 'bezahlt' ELSE 'teilbezahlt' END,
    updated_at = NOW()
  WHERE id = p_beleg_id;
END;
$$;


-- =====================================================================
-- S5 / S6 / Bug3 · Bank-Match Kreditor (camt.053)
-- Fix S5: Status-Übergang mit Rundungstoleranz (- 0.005) wie Verrechnung/Skonto.
-- Fix S6: Lauf-Abschluss über Positions-Rückmeldung statt Beleg-Status,
--         damit Teilzahlungen den Lauf korrekt abschliessen.
-- Fix Bug3: Skonto der zugehörigen Position wird JETZT (bei Bank-
--         Bestätigung) verbucht – nicht mehr beim pain.001-Export.
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_bank_match_kreditor(
  p_tx_id       UUID,
  p_beleg_id    UUID,
  p_betrag      NUMERIC,
  p_datum       DATE,
  p_confidence  NUMERIC,
  p_methode     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lauf_id   UUID;
  v_mandant   UUID;
  v_belegnr   TEXT;
  v_bankkonto TEXT;
  v_bnr       TEXT;
  v_buchung   UUID;
  v_posid     UUID;
  v_skonto    NUMERIC;
BEGIN
  -- TX als gematcht markieren
  UPDATE fibu_bank_transaktionen SET
    status           = 'gematcht',
    matched_beleg_id = p_beleg_id,
    matched_typ      = 'kreditor',
    match_confidence = p_confidence,
    match_methode    = p_methode
  WHERE id = p_tx_id;

  -- Kreditoren-Beleg: bezahlt_am + status (mit Rundungstoleranz, S5)
  UPDATE fibu_kreditoren_belege SET
    betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + p_betrag,
    bezahlt_am     = p_datum,
    status = CASE
      WHEN COALESCE(betrag_bezahlt, 0) + p_betrag >= betrag_brutto - 0.005 THEN 'bezahlt'
      ELSE 'teilbezahlt'
    END
  WHERE id = p_beleg_id;

  -- ── GL-Buchung der Zahlung: Soll 2000 / Haben Bankkonto ──
  SELECT mandant_id, beleg_nr INTO v_mandant, v_belegnr
  FROM fibu_kreditoren_belege WHERE id = p_beleg_id;

  SELECT COALESCE(NULLIF(bi.konto_nr, ''), '1020') INTO v_bankkonto
  FROM fibu_bank_transaktionen bt
  LEFT JOIN fibu_bank_imports bi ON bi.id = bt.import_id
  WHERE bt.id = p_tx_id;
  v_bankkonto := COALESCE(v_bankkonto, '1020');

  IF v_mandant IS NOT NULL AND p_betrag <> 0 THEN
    v_bnr := fibu_next_buchungs_nr(v_mandant);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, text, quelle, quelle_id, created_by
    ) VALUES (
      v_mandant, v_bnr, p_datum, v_belegnr,
      '2000', v_bankkonto, p_betrag,
      'Zahlung ' || COALESCE(v_belegnr, ''), 'zahlungslauf', p_beleg_id, auth.uid()
    ) RETURNING id INTO v_buchung;
    UPDATE fibu_bank_transaktionen SET buchungs_id = v_buchung WHERE id = p_tx_id;
  END IF;

  -- ── Passende offene Zahlungslauf-Position rückmelden ──
  -- bevorzugt betragsgleiche Position, sonst älteste offene; Skonto mitlesen.
  WITH kandidat AS (
    SELECT zlp.id, zlp.skonto_betrag
    FROM fibu_zahlungslauf_positionen zlp
    JOIN fibu_zahlungslaeufe zl ON zl.id = zlp.zahlungslauf_id
    WHERE zlp.beleg_id = p_beleg_id
      AND COALESCE(zlp.status,'offen') <> 'storniert'
      AND NOT zlp.rueckgemeldet
    ORDER BY (ABS(zlp.betrag - p_betrag) < 0.05) DESC, zl.created_at ASC
    LIMIT 1
  )
  UPDATE fibu_zahlungslauf_positionen zlp
  SET rueckgemeldet = true, rueckgemeldet_am = NOW(), bank_tx_id = p_tx_id, status = 'ausgefuehrt'
  FROM kandidat
  WHERE zlp.id = kandidat.id
  RETURNING zlp.id, COALESCE(kandidat.skonto_betrag, 0) INTO v_posid, v_skonto;

  -- ── Skonto erst bei Bank-Bestätigung verbuchen (Bug3) ──
  IF v_posid IS NOT NULL AND COALESCE(v_skonto, 0) > 0 THEN
    PERFORM fibu_skonto_buchen(p_beleg_id, v_skonto, p_datum);
  END IF;

  -- ── Lauf-Abschluss: alle nicht-stornierten Positionen rückgemeldet? (S6) ──
  FOR v_lauf_id IN
    SELECT DISTINCT zlp.zahlungslauf_id
    FROM fibu_zahlungslauf_positionen zlp
    WHERE zlp.beleg_id = p_beleg_id
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM fibu_zahlungslauf_positionen zlp2
      WHERE zlp2.zahlungslauf_id = v_lauf_id
        AND COALESCE(zlp2.status,'offen') <> 'storniert'
        AND NOT zlp2.rueckgemeldet
    ) THEN
      UPDATE fibu_zahlungslaeufe
      SET status = 'verbucht', verbucht_am = NOW()
      WHERE id = v_lauf_id AND status NOT IN ('verbucht','storniert');
    END IF;
  END LOOP;
END $$;


-- =====================================================================
-- S2 · Zahlungslauf zurücknehmen (stornieren)
-- Fix: OP-Saldo und Hauptbuch laufen bei Teilzahlungen nicht mehr
-- auseinander. betrag_bezahlt wird exakt um die TATSÄCHLICH gegen-
-- gebuchte Summe (Zahlungs- + Skonto-Buchungen) reduziert; Status und
-- bezahlt_am werden aus dem Ergebnis abgeleitet (nicht bedingungslos
-- 'offen'). skonto_gebucht wird zurückgesetzt, damit eine spätere
-- erneute Zahlung den Skonto wieder buchen kann.
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_zahlungslauf_stornieren(
  p_lauf_id UUID,
  p_datum   DATE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       RECORD;
  b       RECORD;
  v_sum   NUMERIC;
  v_neu   NUMERIC;
BEGIN
  FOR r IN
    SELECT zlp.id AS pos_id, zlp.beleg_id, zlp.betrag,
           kb.status AS beleg_status, kb.mandant_id,
           kb.betrag_brutto, COALESCE(kb.betrag_bezahlt,0) AS bezahlt
    FROM fibu_zahlungslauf_positionen zlp
    JOIN fibu_kreditoren_belege kb ON kb.id = zlp.beleg_id
    WHERE zlp.zahlungslauf_id = p_lauf_id
      AND COALESCE(zlp.status,'offen') <> 'storniert'
  LOOP
    IF r.beleg_status IN ('bezahlt','teilbezahlt') THEN
      -- bereits via camt gebuchte Zahlung(en) + Skonto gegenbuchen
      -- (ein Beleg liegt dank Doppelzahlungsschutz in nur EINEM aktiven Lauf)
      v_sum := 0;
      FOR b IN
        SELECT * FROM fibu_buchungen
        WHERE quelle IN ('zahlungslauf','skonto')
          AND quelle_id = r.beleg_id AND NOT storniert
      LOOP
        INSERT INTO fibu_buchungen (
          mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
          konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
          text, quelle, quelle_id, storniert, storno_von, created_by
        ) VALUES (
          b.mandant_id, fibu_next_buchungs_nr(b.mandant_id), p_datum, b.beleg_ref,
          b.konto_haben, b.konto_soll, b.betrag, b.mwst_code, -COALESCE(b.mwst_betrag,0),
          'Storno ' || COALESCE(b.text, 'Zahlung'), b.quelle, r.beleg_id, true, b.id, auth.uid()
        );
        UPDATE fibu_buchungen SET storniert = true WHERE id = b.id;
        v_sum := v_sum + b.betrag;
      END LOOP;

      -- OP-Saldo exakt um die gegengebuchte Summe korrigieren
      v_neu := GREATEST(0, r.bezahlt - v_sum);
      UPDATE fibu_kreditoren_belege
        SET betrag_bezahlt = v_neu,
            skonto_gebucht = false,
            bezahlt_am = CASE WHEN v_neu <= 0.005 THEN NULL ELSE bezahlt_am END,
            status = CASE
              WHEN v_neu <= 0.005                       THEN 'offen'
              WHEN v_neu <  r.betrag_brutto - 0.005     THEN 'teilbezahlt'
              ELSE 'bezahlt' END,
            updated_at = NOW()
        WHERE id = r.beleg_id;

      -- zugehörige Bank-TX wieder entkoppeln
      UPDATE fibu_bank_transaktionen
        SET status = 'offen', matched_beleg_id = NULL, matched_typ = NULL,
            match_confidence = NULL, match_methode = NULL, buchungs_id = NULL
        WHERE matched_beleg_id = r.beleg_id AND matched_typ = 'kreditor';

    ELSIF r.beleg_status = 'ebanking' THEN
      UPDATE fibu_kreditoren_belege SET status = 'offen', updated_at = NOW()
        WHERE id = r.beleg_id;
    END IF;

    UPDATE fibu_zahlungslauf_positionen
      SET status = 'storniert', rueckgemeldet = true, rueckgemeldet_am = NOW()
      WHERE id = r.pos_id;
  END LOOP;

  UPDATE fibu_zahlungslaeufe SET status = 'storniert' WHERE id = p_lauf_id;
END $$;


-- =====================================================================
-- S7 · Saldovortrag speichern
-- Fix: Hat ein Konto keinen konto_typ (aktiv/passiv), ist die Buchungs-
-- richtung unbestimmt. Statt still in die Passiv-Logik zu fallen, wird
-- ein klarer Fehler geworfen.
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_saldovortrag_speichern(
  p_mandant_id UUID,
  p_jahr       INTEGER,
  p_salden     JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_datum    DATE := MAKE_DATE(p_jahr, 1, 1);
  v_old      UUID;
  v_zeilen   JSONB := '[]'::jsonb;
  s          JSONB;
  v_typ      TEXT;
  v_saldo    NUMERIC;
  v_konto    TEXT;
  v_fw_saldo NUMERIC;
  v_fw_waehr TEXT;
  v_fw_abs   NUMERIC;
  v_beleg    UUID;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  INSERT INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, aktiv)
  VALUES (p_mandant_id, '9100', 'Eröffnungsbilanz', 'abschluss', true)
  ON CONFLICT (mandant_id, konto_nr) DO NOTHING;

  FOR v_old IN
    SELECT id FROM fibu_buchung_belege
    WHERE mandant_id = p_mandant_id AND art = 'saldovortrag' AND buchungsdatum = v_datum
  LOOP
    DELETE FROM fibu_buchungen      WHERE quelle_id = v_old;
    DELETE FROM fibu_buchung_belege WHERE id = v_old;
  END LOOP;

  FOR s IN SELECT * FROM jsonb_array_elements(p_salden)
  LOOP
    v_konto    := s->>'konto_nr';
    v_saldo    := COALESCE(NULLIF(s->>'saldo', '')::NUMERIC, 0);
    v_fw_saldo := NULLIF(s->>'fw_saldo', '')::NUMERIC;
    v_fw_waehr := NULLIF(s->>'fw_waehrung', '');
    CONTINUE WHEN v_saldo = 0 AND COALESCE(v_fw_saldo, 0) = 0;

    v_fw_abs := CASE WHEN v_fw_saldo IS NULL THEN NULL ELSE ABS(v_fw_saldo) END;

    SELECT konto_typ INTO v_typ
    FROM fibu_konten WHERE mandant_id = p_mandant_id AND konto_nr = v_konto;

    -- Konto-Typ muss bekannt sein, sonst ist die Buchungsrichtung unklar
    IF v_typ IS NULL THEN
      RAISE EXCEPTION 'Konto % hat keinen Kontotyp (aktiv/passiv) – Saldovortrag-Richtung unbestimmt. Bitte Konto im Kontenplan korrekt typisieren.', v_konto;
    END IF;

    IF v_typ = 'aktiv' THEN
      IF v_saldo >= 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', v_konto, 'konto_haben', '9100', 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      ELSE
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', '9100', 'konto_haben', v_konto, 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      END IF;
    ELSE
      IF v_saldo >= 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', '9100', 'konto_haben', v_konto, 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      ELSE
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', v_konto, 'konto_haben', '9100', 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_zeilen) = 0 THEN
    RETURN NULL;
  END IF;

  v_beleg := fibu_manuelle_buchung_erstellen(
    p_mandant_id, v_datum, 'Saldovortrag ' || p_jahr,
    NULL, NULL, 'saldovortrag', v_zeilen);
  RETURN v_beleg;
END;
$$;


-- =====================================================================
-- Bug1 · Kreditoren-Beleg bearbeiten (OHNE Doppel-Verbuchung)
-- Atomar in EINER Transaktion: alte GL-Buchungen entfernen, Kopf- und
-- Positionsdaten ersetzen, neu verbuchen. Lieferant und Belegtyp bleiben
-- unveränderlich; bezahlte/MWST-abgerechnete/stornierte Belege sind
-- gesperrt. Die Periodensperre greift beim Löschen/Neuverbuchen.
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_kreditoren_bearbeiten(
  p_beleg_id    UUID,
  p_beleg       JSONB,
  p_positionen  JSONB   -- [{konto_nr,bezeichnung,mwst_code,mwst_satz,betrag_netto,betrag_mwst,betrag_brutto}]
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_beleg  fibu_kreditoren_belege;
  e        JSONB;
  v_i      INTEGER := 0;
BEGIN
  SELECT * INTO v_beleg FROM fibu_kreditoren_belege WHERE id = p_beleg_id FOR UPDATE;
  IF v_beleg.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_beleg.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF v_beleg.status = 'storniert' OR v_beleg.storno_beleg_id IS NOT NULL THEN
    RAISE EXCEPTION 'Stornierter Beleg kann nicht bearbeitet werden';
  END IF;
  IF v_beleg.status = 'ebanking' THEN
    RAISE EXCEPTION 'Beleg ist in einem aktiven Zahlungslauf – Bearbeiten nicht möglich';
  END IF;
  IF COALESCE(v_beleg.betrag_bezahlt, 0) <> 0 THEN
    RAISE EXCEPTION 'Beleg ist bereits (teil)bezahlt/verrechnet – bitte zuerst Zahlung/Verrechnung zurücknehmen';
  END IF;
  IF COALESCE(v_beleg.mwst_abgerechnet, false) THEN
    RAISE EXCEPTION 'MWST dieses Belegs ist bereits abgerechnet – keine Änderung möglich';
  END IF;

  -- 1) alte GL-Buchungen entfernen (Periodensperre-Trigger schützt gesperrte Perioden)
  DELETE FROM fibu_buchungen WHERE quelle = 'kreditoren' AND quelle_id = p_beleg_id;

  -- 2) Kopfdaten aktualisieren – Lieferant, Belegtyp, Mandant bleiben fix
  UPDATE fibu_kreditoren_belege SET
    lieferant_beleg_nr      = COALESCE(p_beleg->>'lieferant_beleg_nr', lieferant_beleg_nr),
    belegdatum              = COALESCE((p_beleg->>'belegdatum')::DATE, belegdatum),
    buchungsdatum           = COALESCE((p_beleg->>'buchungsdatum')::DATE, buchungsdatum),
    valutadatum             = COALESCE((p_beleg->>'valutadatum')::DATE, valutadatum),
    faelligkeit             = COALESCE((p_beleg->>'faelligkeit')::DATE, faelligkeit),
    zahlungsbedingung_tage  = COALESCE((p_beleg->>'zahlungsbedingung_tage')::INT, zahlungsbedingung_tage),
    waehrung                = COALESCE(p_beleg->>'waehrung', waehrung),
    zahlungsreferenz        = p_beleg->>'zahlungsreferenz',
    notiz                   = p_beleg->>'notiz',
    belegreferenz           = p_beleg->>'belegreferenz',
    gruppe                  = p_beleg->>'gruppe',
    belegtext               = p_beleg->>'belegtext',
    betrag_netto            = COALESCE((p_beleg->>'betrag_netto')::NUMERIC, betrag_netto),
    betrag_mwst             = COALESCE((p_beleg->>'betrag_mwst')::NUMERIC, betrag_mwst),
    betrag_brutto           = COALESCE((p_beleg->>'betrag_brutto')::NUMERIC, betrag_brutto),
    verbucht                = false,
    updated_at              = NOW()
  WHERE id = p_beleg_id;

  -- 3) Positionen ersetzen
  DELETE FROM fibu_kreditoren_positionen WHERE beleg_id = p_beleg_id;
  FOR e IN SELECT * FROM jsonb_array_elements(p_positionen)
  LOOP
    v_i := v_i + 1;
    INSERT INTO fibu_kreditoren_positionen (
      mandant_id, beleg_id, position, konto_nr, bezeichnung,
      mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
    ) VALUES (
      v_beleg.mandant_id, p_beleg_id, v_i,
      e->>'konto_nr', e->>'bezeichnung',
      e->>'mwst_code', COALESCE((e->>'mwst_satz')::NUMERIC, 0),
      COALESCE((e->>'betrag_netto')::NUMERIC, 0),
      COALESCE((e->>'betrag_mwst')::NUMERIC, 0),
      COALESCE((e->>'betrag_brutto')::NUMERIC, 0)
    );
  END LOOP;

  -- 4) neu verbuchen (frische, korrekte GL-Buchungen)
  PERFORM fibu_kreditoren_verbuchen(p_beleg_id);
END;
$$;


-- =====================================================================
-- Bug2 · Offene-Posten-Liste per Stichtag (echte Rekonstruktion)
-- Rekonstruiert den offenen Betrag PER STICHTAG aus den datierten
-- Zahlungs-Ereignissen (Bank-Zahlung + Skonto via fibu_buchungen,
-- Verrechnungen via fibu_kreditoren_verrechnungen) statt aus dem
-- aktuellen betrag_bezahlt. Ein heute bezahlter Beleg erscheint so in
-- einer rückwirkenden Auswertung (Stichtag in der Vergangenheit)
-- korrekt noch als offen.
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_op_liste_kreditoren(
  p_mandant_id UUID,
  p_stichtag   DATE
) RETURNS TABLE (
  id                    UUID,
  beleg_nr              TEXT,
  lieferant_id          UUID,
  lieferant_name        TEXT,
  lieferant_nr          TEXT,
  belegtyp              TEXT,
  belegdatum            DATE,
  faelligkeit           DATE,
  waehrung              TEXT,
  status                TEXT,
  freigabe_status       TEXT,
  betrag_brutto         NUMERIC,
  betrag_bezahlt        NUMERIC,   -- bezahlt PER STICHTAG (rekonstruiert)
  offen                 NUMERIC    -- offen   PER STICHTAG
) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH bel AS (
    SELECT b.*
    FROM fibu_kreditoren_belege b
    WHERE b.mandant_id = p_mandant_id
      AND b.belegdatum <= p_stichtag
      AND b.status <> 'storniert'
  ),
  -- datierte Zahlungs-/Skonto-Buchungen bis Stichtag (reduzieren den OP)
  zahlung AS (
    SELECT bu.quelle_id AS beleg_id, SUM(bu.betrag) AS betrag
    FROM fibu_buchungen bu
    WHERE bu.mandant_id = p_mandant_id
      AND bu.quelle IN ('zahlungslauf','skonto')
      AND NOT bu.storniert
      AND bu.buchungsdatum <= p_stichtag
    GROUP BY bu.quelle_id
  ),
  -- Verrechnungen bis Stichtag, getrennt nach Rechnung und Gutschrift
  verr_r AS (
    SELECT v.rechnung_beleg_id AS beleg_id, SUM(v.betrag) AS betrag
    FROM fibu_kreditoren_verrechnungen v
    WHERE v.mandant_id = p_mandant_id AND v.created_at::date <= p_stichtag
    GROUP BY v.rechnung_beleg_id
  ),
  verr_g AS (
    SELECT v.gutschrift_beleg_id AS beleg_id, SUM(v.betrag) AS betrag
    FROM fibu_kreditoren_verrechnungen v
    WHERE v.mandant_id = p_mandant_id AND v.created_at::date <= p_stichtag
    GROUP BY v.gutschrift_beleg_id
  )
  SELECT
    bel.id, bel.beleg_nr, bel.lieferant_id, l.name, l.nr,
    bel.belegtyp, bel.belegdatum, bel.faelligkeit, bel.waehrung,
    bel.status, bel.freigabe_status,
    bel.betrag_brutto,
    -- bezahlt per Stichtag
    CASE WHEN bel.belegtyp = 'gutschrift'
         THEN -COALESCE(verr_g.betrag, 0)
         ELSE COALESCE(zahlung.betrag, 0) + COALESCE(verr_r.betrag, 0)
    END AS betrag_bezahlt,
    -- offen per Stichtag (Brutto minus bezahlt; Vorzeichen folgt Brutto)
    bel.betrag_brutto - (
      CASE WHEN bel.belegtyp = 'gutschrift'
           THEN -COALESCE(verr_g.betrag, 0)
           ELSE COALESCE(zahlung.betrag, 0) + COALESCE(verr_r.betrag, 0)
      END
    ) AS offen
  FROM bel
  LEFT JOIN fibu_lieferanten l ON l.id = bel.lieferant_id
  LEFT JOIN zahlung ON zahlung.beleg_id = bel.id
  LEFT JOIN verr_r  ON verr_r.beleg_id  = bel.id
  LEFT JOIN verr_g  ON verr_g.beleg_id  = bel.id
  -- nur Belege, die per Stichtag noch einen offenen Betrag haben
  WHERE ABS(
    bel.betrag_brutto - (
      CASE WHEN bel.belegtyp = 'gutschrift'
           THEN -COALESCE(verr_g.betrag, 0)
           ELSE COALESCE(zahlung.betrag, 0) + COALESCE(verr_r.betrag, 0)
      END
    )
  ) > 0.005
  ORDER BY bel.faelligkeit;
$$;
