-- ============================================================================
-- Welle 3b Teil 2 · Mandant+Rollen-Guard fuer Fibu-Schreib-RPCs OHNE Mandantscheck
-- Diese 5 RPCs (SECURITY DEFINER, umgehen RLS) hatten weder Mandants- noch
-- Rollencheck -> ein User konnte per direktem RPC-Aufruf mandantenuebergreifend
-- buchen. Jeweils ein Mandant+Rollen-Guard am passenden Punkt eingehaengt.
--
-- Umsetzung ohne Body-Neutippen: pg_get_functiondef holen, gezielt injizieren,
-- neu ausfuehren. Jeder Schritt bricht fail-loud ab, falls der Anker fehlt.
-- Idempotent (ueberspringt bereits geschuetzte Funktionen).
-- ============================================================================

-- 1) jahresabschluss (p_mandant_id direkt) -> Guard direkt nach BEGIN
do $o$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.fibu_jahresabschluss_durchfuehren(uuid, integer)'::regprocedure);
  if position('fibu_can_write_for' in d) = 0 then
    d2 := regexp_replace(d, 'BEGIN',
      'BEGIN' || chr(10) ||
      '  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN RAISE EXCEPTION ''Kein Zugriff auf diesen Mandanten''; END IF;' || chr(10) ||
      '  IF NOT public.fibu_can_write_for(p_mandant_id) THEN RAISE EXCEPTION ''Ihre Rolle darf keinen Jahresabschluss durchfuehren (nur Admin/Buchhalter).''; END IF;',
      '');
    if d2 = d then raise exception 'jahresabschluss: BEGIN nicht gefunden'; end if;
    execute d2;
  end if;
end $o$;

-- 2) kreditoren_verbuchen (p_beleg_id) -> Guard nach dem "ist bereits verbucht"-Check
do $o$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.fibu_kreditoren_verbuchen(uuid)'::regprocedure);
  if position('fibu_can_write_for' in d) = 0 then
    d2 := regexp_replace(d,
      '(RAISE EXCEPTION ''Beleg % ist bereits verbucht'', p_beleg_id;[[:space:]]+END IF;)',
      '\1 IF NOT (v_beleg.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN RAISE EXCEPTION ''Kein Zugriff auf diesen Mandanten''; END IF; IF NOT public.fibu_can_write_for(v_beleg.mandant_id) THEN RAISE EXCEPTION ''Ihre Rolle darf in diesem Mandanten nicht buchen (nur Admin/Buchhalter).''; END IF;',
      '');
    if d2 = d then raise exception 'kreditoren_verbuchen: Anker nicht gefunden'; end if;
    execute d2;
  end if;
end $o$;

-- 3) debitoren_verbuchen (p_beleg_id) -> Guard nach "IF v_beleg.verbucht THEN RETURN; END IF;"
do $o$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.fibu_debitoren_verbuchen(uuid)'::regprocedure);
  if position('fibu_can_write_for' in d) = 0 then
    d2 := regexp_replace(d,
      '(IF v_beleg.verbucht THEN[[:space:]]*RETURN;[[:space:]]*END IF;)',
      '\1 IF NOT (v_beleg.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN RAISE EXCEPTION ''Kein Zugriff auf diesen Mandanten''; END IF; IF NOT public.fibu_can_write_for(v_beleg.mandant_id) THEN RAISE EXCEPTION ''Ihre Rolle darf in diesem Mandanten nicht buchen (nur Admin/Buchhalter).''; END IF;',
      '');
    if d2 = d then raise exception 'debitoren_verbuchen: Anker nicht gefunden'; end if;
    execute d2;
  end if;
end $o$;

-- 4) bank_match_kreditor (kein Fetch; Mandant aus p_beleg_id) -> Guard direkt nach BEGIN
do $o$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.fibu_bank_match_kreditor(uuid,uuid,numeric,date,numeric,text)'::regprocedure);
  if position('fibu_can_write_for' in d) = 0 then
    d2 := regexp_replace(d, 'BEGIN',
      'BEGIN' || chr(10) ||
      '  IF NOT EXISTS (SELECT 1 FROM fibu_kreditoren_belege b WHERE b.id = p_beleg_id AND b.mandant_id = ANY(fibu_mandant_ids_for_user()) AND public.fibu_can_write_for(b.mandant_id)) THEN RAISE EXCEPTION ''Kein Zugriff / keine Buchungsberechtigung fuer diesen Mandanten''; END IF;',
      '');
    if d2 = d then raise exception 'bank_match: BEGIN nicht gefunden'; end if;
    execute d2;
  end if;
end $o$;

-- 5) zahlungslauf_stornieren (erster Parameter = Lauf-ID via $1) -> Guard nach BEGIN
do $o$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.fibu_zahlungslauf_stornieren(uuid,date)'::regprocedure);
  if position('fibu_can_write_for' in d) = 0 then
    d2 := regexp_replace(d, 'BEGIN',
      'BEGIN' || chr(10) ||
      '  IF NOT EXISTS (SELECT 1 FROM fibu_zahlungslaeufe zl WHERE zl.id = $1 AND zl.mandant_id = ANY(fibu_mandant_ids_for_user()) AND public.fibu_can_write_for(zl.mandant_id)) THEN RAISE EXCEPTION ''Kein Zugriff / keine Buchungsberechtigung fuer diesen Mandanten''; END IF;',
      '');
    if d2 = d then raise exception 'zahlungslauf_stornieren: BEGIN nicht gefunden'; end if;
    execute d2;
  end if;
end $o$;
