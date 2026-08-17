-- Zeitpunkt des Schliessens festhalten.
--
-- Warum eine eigene Spalte neben ends_at: ends_at ist die GEPLANTE Endzeit
-- eines Termins, ended_at der Moment, in dem die Besprechung tatsächlich
-- geschlossen wurde. Nur Letzteres taugt als Grundlage fürs Aufräumen
-- ("alles löschen, was seit 30 Tagen beendet ist") -- geplante Termine, die
-- nie stattfanden, hätten sonst dasselbe Alter wie durchgeführte.
alter table public.meetings
  add column if not exists ended_at timestamptz;

-- Beendete Besprechungen schnell finden (Aufräum-Abfragen).
create index if not exists idx_meetings_ended
  on public.meetings(ended_at)
  where ended_at is not null;
