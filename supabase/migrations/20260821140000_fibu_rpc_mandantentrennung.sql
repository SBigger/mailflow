-- ============================================================================
-- Fibu-RPCs: Mandantentrennung wiederherstellen
--
-- Befund (extern gemeldet, am 21.08.2026 live nachgemessen und SCHARF belegt):
-- Die Auswertungs-RPCs laufen als SECURITY DEFINER und umgehen damit RLS,
-- pruefen aber selbst weder Benutzer noch Mandant. Zusammen mit dem
-- EXECUTE-Recht fuer anon liess sich das so abrufen:
--
--   POST /rest/v1/rpc/fibu_bilanz  (nur mit dem oeffentlichen anon-Key)
--   -> [{"konto_nr":"1020","bezeichnung":"Bank","saldo":-1235.00}, ...]
--
-- Ohne Login. Ebenso die offenen Kreditoren samt Lieferantennamen und
-- Betraegen. Und ein eingeloggter Kundenbenutzer ('extern') konnte auf
-- demselben Weg die Bilanz JEDES fremden Mandanten lesen - die
-- Mandantentrennung des Moduls war damit umgehbar.
--
-- Zwei Massnahmen:
--   1. anon verliert das Ausfuehrungsrecht auf saemtliche fibu_*-Funktionen.
--      Ausgenommen sind die Helfer, die IN den RLS-Policies aufgerufen werden:
--      fehlt dort das Recht, wirft eine Abfrage einen Fehler statt sauber leer
--      zu bleiben.
--   2. Die reinen Auswertungsfunktionen laufen neu als SECURITY INVOKER.
--      Damit greift wieder die RLS der fibu_*-Tabellen, die seit der
--      Foundation mandantenscharf ist (mandant_id = ANY(
--      fibu_mandant_ids_for_user())). Ein Fremder bekommt keine Zeile, ein
--      Berechtigter unveraendert alles. Das ist robuster als ein
--      handgeschriebener Wachposten je Funktion, weil die Regel an genau
--      einer Stelle steht.
--
-- Schreibende RPCs bleiben SECURITY DEFINER (sie brauchen Rechte auf
-- Zaehlertabellen ohne eigene Policies) - die mit noch fehlender
-- Mandantenpruefung sind ein eigener, nachgelagerter Schritt.
--
-- Idempotent.
-- ============================================================================

-- ── 1. anon aussperren ──────────────────────────────────────────────────────
do $$
declare
  f record;
  -- Diese Helfer wertet Postgres innerhalb der Policies aus. Sie muessen fuer
  -- jede Rolle ausfuehrbar bleiben, sonst scheitert die Policy-Pruefung mit
  -- einem Fehler, statt den Zugriff einfach zu verweigern.
  policy_helfer text[] := array[
    'fibu_mandant_ids_for_user',
    'fibu_user_is_admin_for',
    'fibu_can_write_for',
    'fibu_mandant_has_no_access',
    'fibu_user_has_any_access',
    'fibu_user_is_any_admin'
  ];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'fibu\_%'
       and not (p.proname = any (policy_helfer))
  loop
    -- "from anon" allein genuegt nicht: das Recht kommt bei bestehenden
    -- Funktionen ueber PUBLIC, und das ueberlebt den Entzug an anon.
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant  execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- ── 2. Auswertungen wieder unter RLS stellen ────────────────────────────────
-- Bewusst NICHT dabei: die Policy-Helfer von oben (Rekursionsgefahr) sowie
-- fibu_mwst_booking_sign und fibu_mwst_reporting_konto, die aus anderen
-- SECURITY-DEFINER-Funktionen heraus aufgerufen werden.
do $$
declare
  f record;
  lesefunktionen text[] := array[
    'fibu_bilanz',
    'fibu_erfolgsrechnung',
    'fibu_kontoblatt',
    'fibu_kontoblatt_eroeffnung',
    'fibu_konten_mit_bewegungen',
    'fibu_op_liste_kreditoren',
    'fibu_lieferant_buchungshistorie',
    'fibu_saldovortrag_lesen',
    'fibu_zahlungslauf_historie',
    'fibu_zahlungslauf_positionen_get',
    'fibu_budget_uebersicht',
    'fibu_jahresabschluss_salden',
    'fibu_mwst_by_konto',
    'fibu_mwst_detail',
    'fibu_mwst_summary',
    'fibu_mwst_periode_get'
  ];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (lesefunktionen)
       and p.prosecdef            -- nur was noch DEFINER ist
  loop
    execute format('alter function %s security invoker', f.sig);
    raise notice 'unter RLS gestellt: %', f.proname;
  end loop;
end $$;
