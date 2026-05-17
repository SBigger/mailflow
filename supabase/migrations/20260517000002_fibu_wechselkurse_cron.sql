-- =====================================================================
-- FiBu: Automatischer ESTV/BAZG-Wechselkurs-Import (täglicher Cron)
-- pg_cron ruft täglich die Edge Function fibu-wechselkurse-import auf.
-- Tageskurse erscheinen werktags ~13:00, Monatsmittelkurse am 25.;
-- ein täglicher Lauf deckt beides ab (Upsert ist idempotent).
-- Defensiv gekapselt – falls pg_cron/pg_net nicht verfügbar ist,
-- bleibt der manuelle Import auf der Wechselkurse-Seite bestehen.
-- =====================================================================

DO $do$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.schedule(
    'fibu-wechselkurse-taeglich',
    '0 13 * * *',                       -- täglich 13:00 UTC (~14–15 Uhr CH)
    $job$
      SELECT net.http_post(
        url     := 'https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1/fibu-wechselkurse-import',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object('typ', 'beide')
      );
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Wechselkurs-Cron konnte nicht eingerichtet werden: %', SQLERRM;
END
$do$;
