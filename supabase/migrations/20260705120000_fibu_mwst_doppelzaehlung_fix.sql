-- ============================================================================
-- Fix · MWST-Doppelzählung in der MWST-Abrechnung
--
-- fibu_kreditoren_verbuchen / fibu_debitoren_verbuchen buchen pro Position ZWEI
-- Zeilen: (1) Aufwand/Ertrag (netto) und (2) die reine Steuerkonto-Bewegung
-- (Vorsteuer bzw. Umsatzsteuer). BEIDE Zeilen tragen bisher mwst_code + mwst_betrag.
-- fibu_mwst_summary summiert betrag + mwst_betrag ueber ALLE Zeilen mit mwst_code
-- -> Netto UND MWST werden verdoppelt (Steuerzeile mitgezaehlt).
--
-- Korrektur (Wurzel): Die reine Steuerkonto-Bewegungszeile ist KEIN steuerbarer
-- Umsatz und darf keinen mwst_code/mwst_betrag tragen. Der steuerbare Umsatz + die
-- MWST stehen vollstaendig auf der Aufwands-/Ertragszeile.
--
-- Umsetzung ohne Body-Neutippen (kein Transkriptionsrisiko): Wir holen die
-- MASSGEBLICHE aktuelle Definition via pg_get_functiondef, ersetzen NUR das
-- MWST-Werte-Paar auf der Steuerzeile und fuehren sie neu aus. Ein Guard bricht
-- ab, falls das Muster nicht (mehr) gefunden wird.
-- ============================================================================

do $outer$
declare d text; d2 text;
begin
  -- Kreditoren: Vorsteuer-Zeile -> mwst_code + mwst_betrag = NULL
  d  := pg_get_functiondef('public.fibu_kreditoren_verbuchen(uuid)'::regprocedure);
  d2 := replace(d, 'v_pos.mwst_code, v_mwst_sign * v_chf_mwst,', 'NULL, NULL,');
  if d2 = d then
    raise exception 'MWST-Fix Kreditoren: Vorsteuer-Zeilenmuster nicht gefunden – Abbruch (keine Aenderung)';
  end if;
  execute d2;

  -- Debitoren: Umsatzsteuer-Zeile -> mwst_code + mwst_betrag = NULL (betrag bleibt = MWST)
  d  := pg_get_functiondef('public.fibu_debitoren_verbuchen(uuid)'::regprocedure);
  d2 := replace(d, 'v_pos.betrag_mwst,v_pos.mwst_code,v_pos.betrag_mwst,', 'v_pos.betrag_mwst,NULL,NULL,');
  if d2 = d then
    raise exception 'MWST-Fix Debitoren: Umsatzsteuer-Zeilenmuster nicht gefunden – Abbruch (keine Aenderung)';
  end if;
  execute d2;
end $outer$;

-- Bestehende Steuer-Bewegungszeilen entdoppeln (sie waren faelschlich getaggt).
-- ACHTUNG PROD: aendert historische MWST-Abrechnungswerte -> vor Uebernahme auf
-- api-artis mit der Buchhaltung abstimmen (bereits eingereichte MWST-Perioden!).
update fibu_buchungen
set mwst_code = null, mwst_betrag = null
where quelle in ('kreditoren','debitoren')
  and mwst_code is not null
  and (text like 'Vorsteuer %' or text like 'Umsatzsteuer %');
