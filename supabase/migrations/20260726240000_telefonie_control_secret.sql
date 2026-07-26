-- Security-Paket, Teil 1 (2026-07-26): Fernsteuer-Befehle signieren.
--
-- Problem (beide Reviews, Prio 1): der Realtime-Kanal "telefonie-calls" ist
-- oeffentlich und das Repo ist es auch -- anon-Key, Kanalname und Profil-ID
-- sind damit bekannt. Bisher genuegte das, um fremde Telefone fernzusteuern:
-- "answer" heisst Gespraech annehmen, also potenziell MITHOEREN.
--
-- Loesung: jeder Mitarbeitende bekommt ein eigenes Geheimnis. Wer einen Befehl
-- schickt (Web-Panel oder Anruf-Karte), signiert ihn damit; der lokale
-- Fernsteuerungs-Helfer fuehrt nur noch gueltig signierte, frische Befehle aus.
-- Ein Mitlesen des Kanals bringt einem Angreifer damit nichts mehr -- er kann
-- keine gueltige Signatur erzeugen.
--
-- Sichtbarkeit: profiles-RLS erlaubt jedem nur das EIGENE Profil (Policy
-- "own_profile"), Admins zusaetzlich alles. Das Geheimnis autorisiert
-- ausschliesslich die Steuerung des eigenen Telefons -- ein Admin, der es
-- sehen kann, koennte ohnehin die Zuordnung aendern.
alter table public.profiles
  add column if not exists telefonie_control_secret text;

comment on column public.profiles.telefonie_control_secret is
  'Persoenliches Geheimnis zum Signieren von Telefonie-Fernsteuerbefehlen (HMAC-SHA256). Muss mit der lokalen Konfiguration von Anruf-Karte und Fernsteuerungs-Helfer uebereinstimmen.';

-- Fehlende Geheimnisse erzeugen (nur fuer Profile mit Telefonie-Zuordnung).
update public.profiles
   set telefonie_control_secret = encode(gen_random_bytes(32), 'hex')
 where telefonie_control_secret is null
   and peoplefone_user_id is not null;
