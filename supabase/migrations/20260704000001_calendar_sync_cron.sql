-- ══════════════════════════════════════════════════════════════════════
-- Migration: calendar sync cron + Serientermin-Reparatur
-- Zweck:     1) pg_cron-Job, der alle 15 Minuten die Edge Function
--               sync-outlook-calendar aufruft (synct ALLE verbundenen User).
--            2) Einmaliger Reset der calendar_delta_links, damit der
--               nächste Sync alle Events im Fenster neu einliest und
--               Serientermine ihren Betreff bekommen (Fix im Sync-Code).
-- Datum:     2026-07-04
--
-- ADDITIV: kann via  select cron.unschedule('sync-outlook-calendar-15min');
--          jederzeit entfernt werden.
-- Voraussetzung: Edge Function sync-outlook-calendar mit Serientermin-Fix
--                ist VOR dieser Migration deployt.
-- ══════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Alten Job (falls vorhanden) aufräumen, idempotent
do $$
begin
  perform cron.unschedule('sync-outlook-calendar-15min');
exception when others then
  null;
end $$;

-- Alle 15 Minuten
select cron.schedule(
  'sync-outlook-calendar-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1/sync-outlook-calendar',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'X-Cron-Secret',   (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Einmalige Reparatur: Delta-Link zurücksetzen → nächster Sync ist ein
-- Voll-Sync im Fenster (calendar_sync_days zurück + 1 Jahr voraus) und
-- überschreibt die "(Kein Titel)"-Serientermine mit dem echten Betreff.
-- (Termine ausserhalb des Fensters bleiben unangetastet.)
update profiles set calendar_delta_link = null where calendar_delta_link is not null;
