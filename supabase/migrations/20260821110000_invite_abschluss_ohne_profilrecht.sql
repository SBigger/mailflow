-- ============================================================================
-- Einladung abschliessen, ohne dem Benutzer Schreibrecht auf profiles zu geben
--
-- Problem (gemeldet von Roger, 21.08.2026):
-- SetPassword.jsx und ResetPassword.jsx setzen nach dem Passwortsetzen
-- profiles."inviteState" = 2 direkt vom Client mit dem eigenen JWT.
-- Fuer die Rolle 'extern' scheitert dieser Update an RLS. Der Benutzer bleibt
-- damit auf inviteState 1 haengen und wird beim Login wortlos wieder
-- hinausgeworfen - die Einladung laesst sich nie abschliessen.
--
-- Loesung: eine eng geschnittene SECURITY-DEFINER-Funktion. Sie fasst
-- ausschliesslich die eigene Zeile an (auth.uid()) und ausschliesslich die
-- Spalte "inviteState", und nur in eine Richtung (1 -> 2). profiles bleibt
-- fuer Externe weiterhin schreibgeschuetzt.
--
-- Idempotent: mehrfaches Ausfuehren aendert nichts mehr.
-- ============================================================================

create or replace function public.complete_invite()
  returns smallint
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  neuer_stand smallint;
begin
  if uid is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- Nur vorwaerts: ein bereits abgeschlossener Account (2) bleibt 2,
  -- ein zurueckgesetzter Stand laesst sich damit nicht herbeifuehren.
  update public.profiles
     set "inviteState" = 2
   where id = uid
     and coalesce("inviteState", 0) < 2;

  select "inviteState" into neuer_stand
    from public.profiles
   where id = uid;

  return coalesce(neuer_stand, 2);
end;
$$;

-- Postgres vergibt EXECUTE auf neue Funktionen automatisch an PUBLIC
-- (also inkl. anon). Erst entziehen, dann gezielt vergeben.
--
-- ACHTUNG: "from public" allein genuegt in Supabase NICHT. Das Projekt hat
-- ALTER DEFAULT PRIVILEGES fuer das Schema public, die anon zusaetzlich ein
-- EIGENES EXECUTE-Recht geben - das ueberlebt den Entzug von PUBLIC. Live
-- nachgemessen am 21.08.2026: nach dem Anlegen stand has_function_privilege
-- fuer anon weiterhin auf true. Deshalb anon explizit mitnennen.
revoke execute on function public.complete_invite() from public, anon;
grant execute on function public.complete_invite() to authenticated, service_role;

comment on function public.complete_invite() is
  'Setzt inviteState der EIGENEN Profilzeile von 1 auf 2. Wird von SetPassword '
  'und ResetPassword aufgerufen, damit auch Externe ihre Einladung abschliessen '
  'koennen, ohne Schreibrecht auf profiles zu erhalten.';
