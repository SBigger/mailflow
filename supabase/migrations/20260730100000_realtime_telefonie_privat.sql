-- ===========================================================================
-- Private Telefonie-Kanaele -- ein eigenes Thema pro Person.
--
-- Ausgangslage (Befund OFF-01, security/befunde.json): der Kanal
-- "telefonie-calls" ist ein OEFFENTLICHER Broadcast-Kanal. Wer den anon-
-- Schluessel der Web-App hat -- und der steckt in jeder ausgelieferten Seite --
-- konnte mithoeren: eingehende Rufnummern, Kundenname, offene Pendenzen,
-- Dokumentnamen. Fuer alle Mitarbeitenden, nicht nur fuer sich selbst.
--
-- Zwei Entscheide dahinter:
--
--  1. PRIVAT statt oeffentlich. Private Kanaele verlangen eine echte
--     Benutzer-Anmeldung; der anon-Schluessel allein reicht nicht mehr.
--
--  2. PRO PERSON statt gemeinsam. Ein privater Gemeinschaftskanal wuerde
--     zwar Fremde aussperren, aber jeder Angemeldete saehe weiter die Anrufe
--     aller Kolleginnen. Mit dem Thema "telefonie-user:<benutzer-id>" kann
--     jede Person strukturell nur ihre eigenen Anrufe sehen -- das ist
--     stabiler als jede Filterung in der Oberflaeche, die man vergessen kann.
--
-- Nebenwirkung, die uns gelegen kommt: auch Steuerbefehle (annehmen, auflegen,
-- verbinden) laufen nur noch im eigenen Thema. Fremde Telefone zu steuern ist
-- damit nicht mehr eine Frage der Signatur, sondern schlicht unmoeglich.
-- Die HMAC-Signatur bleibt trotzdem -- zwei Schloesser sind besser als eines.
--
-- Diese Migration ist fuer sich ALLEIN wirkungslos und damit gefahrlos: sie
-- erlaubt zusaetzlich etwas, verbietet nichts. Der alte oeffentliche Kanal
-- laeuft unveraendert weiter, bis alle Clients umgestellt sind.
-- ===========================================================================

-- realtime.messages hat RLS bereits aktiv (von Supabase). Ohne passende Policy
-- kommt niemand an private Themen heran -- genau deshalb braucht es diese hier.

drop policy if exists "telefonie_eigenes_thema_lesen" on realtime.messages;
create policy "telefonie_eigenes_thema_lesen"
  on realtime.messages for select to authenticated
  using ( realtime.topic() = 'telefonie-user:' || auth.uid()::text );

drop policy if exists "telefonie_eigenes_thema_senden" on realtime.messages;
create policy "telefonie_eigenes_thema_senden"
  on realtime.messages for insert to authenticated
  with check ( realtime.topic() = 'telefonie-user:' || auth.uid()::text );
