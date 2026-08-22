-- ============================================================================
-- complete_invite: auch den letzten Schritt der Einladung abdecken
--
-- Die Einladung hat drei Stationen:
--   1 = eingeladen, noch kein Passwort
--   2 = Passwort gesetzt          (SetPassword / ResetPassword)
--   3 = MFA eingerichtet          (MFASetup)
--
-- Station 2 lief schon ueber complete_invite(). Station 3 schrieb weiterhin
-- direkt vom Client auf profiles - und scheitert damit unter denselben
-- Bedingungen wie zuvor Station 2: fuer die Rolle 'extern' verbietet RLS den
-- Schreibzugriff. Ein eingeladener Kunde waere also durchs Passwortsetzen
-- gekommen und danach im MFA-Schritt haengen geblieben, wieder stumm, weil der
-- Rueckgabewert nicht geprueft wurde.
--
-- Die Funktion bekommt deshalb einen Zielschritt. Der Default 2 haelt die
-- bestehenden Aufrufe `rpc('complete_invite')` unveraendert am Laufen.
--
-- Weiterhin gilt: nur die eigene Zeile, nur diese eine Spalte, nur vorwaerts.
-- Wer schon weiter ist, wird nicht zurueckgestuft.
-- ============================================================================

-- Rueckgabetyp und Signatur aendern sich -> alte Fassung weg.
drop function if exists public.complete_invite();

create or replace function public.complete_invite(p_ziel smallint default 2)
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

  if p_ziel not in (2, 3) then
    raise exception 'Ungueltiger Zielschritt: %', p_ziel;
  end if;

  update public.profiles
     set "inviteState" = p_ziel
   where id = uid
     and coalesce("inviteState", 0) < p_ziel;

  select "inviteState" into neuer_stand
    from public.profiles
   where id = uid;

  return coalesce(neuer_stand, p_ziel);
end;
$$;

-- Postgres gibt neuen Funktionen automatisch EXECUTE an PUBLIC, und Supabase
-- vergibt zusaetzlich ein eigenes Recht an anon. Beides entziehen, dann gezielt
-- vergeben.
revoke execute on function public.complete_invite(smallint) from public, anon;
grant  execute on function public.complete_invite(smallint) to authenticated, service_role;

comment on function public.complete_invite(smallint) is
  'Setzt inviteState der EIGENEN Profilzeile vorwaerts auf 2 (Passwort gesetzt) '
  'oder 3 (MFA eingerichtet). Damit koennen auch Benutzer mit der Rolle extern '
  'ihre Einladung abschliessen, ohne Schreibrecht auf profiles zu erhalten.';
