-- ============================================================================
-- Fix · fibu_bilanz zählt nach Jahresabschluss doppelt
--
-- fibu_bilanz summiert die volle Buchungs-Historie bis zum Stichtag. Der
-- Jahresabschluss legt zusätzlich Eröffnungsbilanz-Buchungen an
-- (periode_art='eroeffnung', datiert 01.01. Folgejahr), die denselben Bilanz-
-- saldo NOCHMALS tragen -> jeder Aktiv-/Passivsaldo erscheint doppelt.
--
-- Korrektur: Die EB-Buchungen aus der Bilanz-Summe ausschliessen. Damit ist die
-- Bilanz = volle Historie der ECHTEN Buchungen (die den Saldo bereits vollständig
-- aufbauen) — korrekt und ohne Doppelzählung. periode_art IS DISTINCT FROM
-- 'eroeffnung' behandelt reguläre Buchungen (periode_art NULL/laufend) korrekt mit.
--
-- Technik: massgebliche DB-Definition via pg_get_functiondef holen, gezielt den
-- Storniert-Filter um den EB-Ausschluss ergänzen, neu ausführen (kein Neutippen).
-- ============================================================================

do $outer$
declare d text; d2 text;
begin
  d  := pg_get_functiondef('public.fibu_bilanz(uuid, date)'::regprocedure);
  d2 := replace(
          d,
          'AND NOT b.storniert',
          'AND NOT b.storniert AND b.periode_art IS DISTINCT FROM ''eroeffnung'''
        );
  if d2 = d then
    raise exception 'fibu_bilanz: Anker "AND NOT b.storniert" nicht gefunden – Abbruch';
  end if;
  execute d2;
end $outer$;
