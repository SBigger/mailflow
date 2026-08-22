-- ============================================================================
-- Neue Profile sind nicht automatisch Mitarbeitende
--
-- Befund (extern gemeldet, am 21.08.2026 nachgeprueft): Die oeffentliche
-- Registrierung war im Testbackend offen (disable_signup = false). Zusammen
-- mit dem Spaltendefault `profiles.role = 'sachbearbeiter'` haette sich damit
-- jeder selbst einen Zugang anlegen koennen, der sofort als Mitarbeiter gilt -
-- denn is_staff() zaehlt 'sachbearbeiter' zur Positivliste. Der oder die
-- Betreffende haette danach saemtliche Dokumente, Kunden und Aufgaben gesehen.
-- Die Registrierung selbst ist inzwischen geschlossen.
--
-- Diese Migration zieht die zweite Linie ein: Wer auf irgendeinem Weg eine
-- Profilzeile bekommt, ohne dass jemand bewusst eine Rolle vergibt, landet auf
-- 'extern' und sieht damit nichts ausser den Fibu-Mandanten, die ihm
-- ausdruecklich freigegeben wurden.
--
-- Auf die regulaeren Wege hat das keinen Einfluss: inviteUser und
-- fibuInviteUser setzen die Rolle unmittelbar nach dem Anlegen selbst
-- (mit service_role, wie der Trigger profiles_guard_role_change es verlangt).
--
-- Bestehende Zeilen bleiben unveraendert. Idempotent.
-- ============================================================================

alter table public.profiles alter column role set default 'extern';

comment on column public.profiles.role is
  'Zugriffsrolle. Default bewusst extern: ein Profil, dem niemand aktiv eine '
  'Rolle zuweist, darf kein Mitarbeiterzugriff sein. Mitarbeiterrollen werden '
  'ueber die Edge Functions inviteUser/makeAdmin vergeben.';
