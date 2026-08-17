-- ===========================================================================
-- Besprechungen automatisch aufräumen.
--
-- Sascha: "abgeschlossene Gespräche müssen irgendwann gelöscht werden".
--
-- Das ist zur Hälfte Ordnung und zur Hälfte SICHERHEIT:
--
--   Solange eine Besprechung "offen" steht, bleibt ihr Gästelink gültig --
--   auch Wochen später. Termineinladungen werden weitergeleitet, Links landen
--   in fremden Postfächern. Wer einen alten Link hat, könnte also erneut
--   anklopfen. Von Hand schliesst das erfahrungsgemäss niemand zuverlässig,
--   deshalb macht es hier die Datenbank.
--
-- Zwei Schritte, bewusst getrennt:
--   1) Vergessene Räume schliessen  -> Gästelink wird unbrauchbar
--   2) Geschlossenes nach 30 Tagen löschen -> Datenbestand bleibt schlank
--
-- Warum das Team nicht ausgesperrt wird: Die Aktion "token" in meeting-api
-- prüft den Status NICHT. Angemeldete Mitarbeitende kommen also auch in einen
-- geschlossenen Raum -- geschlossen zu sein betrifft ausschliesslich Gäste.
-- ===========================================================================

create or replace function public.meetings_aufraeumen()
returns table (geschlossen integer, geloescht integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  n_zu  integer;
  n_weg integer;
begin
  -- 1) Was seit 12 Stunden offen steht, war ein Gespräch von heute Morgen und
  --    ist vorbei. Die Bedingung auf starts_at schützt GEPLANTE Termine: Ein
  --    Termin für nächste Woche wird heute angelegt, darf aber natürlich nicht
  --    vor seinem Beginn geschlossen werden.
  update public.meetings
     set status = 'beendet', ended_at = now(), updated_at = now()
   where status in ('offen', 'laufend')
     and created_at < now() - interval '12 hours'
     and (starts_at is null or starts_at < now() - interval '12 hours');
  get diagnostics n_zu = row_count;

  -- 2) Endgültig löschen. meeting_guests hängt mit "on delete cascade" daran,
  --    verschwindet also mit. 30 Tage, damit man im Streitfall noch nachsehen
  --    kann, wer wann anklopfte -- länger braucht es nicht, der Inhalt des
  --    Gesprächs steht ohnehin nirgends.
  --    coalesce: ganz alte Zeilen aus der Zeit vor ended_at haben dort NULL.
  delete from public.meetings
   where status in ('beendet', 'abgesagt')
     and coalesce(ended_at, updated_at) < now() - interval '30 days';
  get diagnostics n_weg = row_count;

  return query select n_zu, n_weg;
end;
$$;

-- Aufräumen ist Sache des Servers, nicht des Browsers.
revoke all on function public.meetings_aufraeumen() from public, anon, authenticated;

-- Täglich um 03:17 -- abseits der vollen Stunde, damit es nicht mit den
-- anderen Cron-Aufgaben zusammenfällt.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'meetings-aufraeumen',
      '17 3 * * *',
      $cron$select public.meetings_aufraeumen()$cron$
    );
  end if;
end;
$$;
