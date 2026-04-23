-- ══════════════════════════════════════════════════════════════════════
-- Migration: call_records daily sync cron
-- Zweck:     Täglicher pg_cron-Job, der die Edge Function
--            sync-teams-calls aufruft (06:00 UTC = 07/08:00 CH).
-- Datum:     2026-04-23
--
-- ADDITIV: kann via  select cron.unschedule('sync-teams-calls-daily');
--          jederzeit entfernt werden.
-- ══════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Alten Job (falls vorhanden) aufräumen, idempotent
do $$
begin
  perform cron.unschedule('sync-teams-calls-daily');
exception when others then
  -- Job existiert noch nicht – ignorieren
  null;
end $$;

-- Täglich 06:00 UTC  (= 07:00 Winter / 08:00 Sommer CH)
select cron.schedule(
  'sync-teams-calls-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1/sync-teams-calls',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'X-Cron-Secret',   (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
