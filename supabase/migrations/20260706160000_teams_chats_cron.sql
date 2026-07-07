-- ══════════════════════════════════════════════════════════════════════
-- Migration: Teams-Chat-Sync Cron
-- Zweck:  pg_cron-Job, der alle 15 Minuten die Edge Function
--         sync-teams-chats aufruft (synct ALLE verbundenen Mitarbeiter).
-- Datum:  2026-07-06
--
-- ADDITIV: entfernbar via  select cron.unschedule('sync-teams-chats-15min');
-- Voraussetzung: Edge Function sync-teams-chats ist deployt + Graph-Scope
--                Chat.Read (delegiert) freigegeben, sonst liefert der Sync
--                nur leere Ergebnisse (harmlos).
-- WICHTIG für Produktiv: die URL unten auf das produktive Projekt anpassen
--                        (hier: smartis.me-Test uawgpxcihixqxqxxbjak).
-- ══════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('sync-teams-chats-15min');
exception when others then
  null;
end $$;

select cron.schedule(
  'sync-teams-chats-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1/sync-teams-chats',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
