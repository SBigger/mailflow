-- ============================================================================
-- Welle 3b · Rollen-Guard fuer Fibu-Buchungs-RPCs
-- Die Schreib-RPCs laufen als SECURITY DEFINER und umgehen damit RLS. Sie pruefen
-- den Mandantszugriff (fibu_mandant_ids_for_user), aber NICHT die Rolle -> ein
-- 'readonly'-User mit Mandantszugriff kann per direktem RPC-Aufruf buchen.
--
-- Fix: bei den bekannten SCHREIB-RPCs direkt nach dem bestehenden Mandantscheck
-- einen Rollen-Guard (fibu_can_write_for) einhaengen. Nur Namensliste -> Lese-
-- Funktionen bleiben unberuehrt. Idempotent (ueberspringt bereits geschuetzte).
-- Umsetzung ohne Body-Neutippen: pg_get_functiondef holen, gezielt nach dem
-- Mandantscheck injizieren, neu ausfuehren.
-- ============================================================================

do $outer$
declare
  fn record;
  def text; newdef text; cnt int := 0;
begin
  for fn in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'fibu_kreditoren_storno','fibu_gutschrift_verrechnen','fibu_skonto_buchen',
        'fibu_kreditoren_bearbeiten','fibu_saldovortrag_speichern',
        'fibu_bank_match_kreditor','fibu_zahlungslauf_stornieren',
        'fibu_jahresabschluss_durchfuehren','fibu_kreditoren_verbuchen',
        'fibu_debitoren_verbuchen'
      )
      and p.prosrc not like '%fibu_can_write_for%'   -- idempotent
  loop
    def := pg_get_functiondef(fn.oid);
    newdef := regexp_replace(
      def,
      '(IF NOT \(([A-Za-z_0-9.]+) = ANY\(fibu_mandant_ids_for_user\(\)\)\) THEN[[:space:]]+RAISE EXCEPTION ''Kein Zugriff auf diesen Mandanten'';[[:space:]]+END IF;)',
      '\1 IF NOT public.fibu_can_write_for(\2) THEN RAISE EXCEPTION ''Ihre Rolle darf in diesem Mandanten nicht buchen (nur Admin/Buchhalter).''; END IF;',
      'g'
    );
    if newdef <> def then
      execute newdef;
      cnt := cnt + 1;
      raise notice 'Rollen-Guard ergaenzt: %', fn.sig;
    else
      raise notice 'KEIN Mandantscheck-Muster gefunden (separat pruefen): %', fn.sig;
    end if;
  end loop;
  raise notice 'Fibu-RPCs mit Rollen-Guard: %', cnt;
end $outer$;
