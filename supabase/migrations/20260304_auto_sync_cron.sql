-- ============================================================
-- Auto-Sync: Automatischer Outlook-Sync alle 30 Minuten
-- Ausführen im Supabase SQL Editor (Dashboard > SQL Editor)
--
-- VORAUSSETZUNG: pg_cron Extension muss aktiviert sein
--   Dashboard > Database > Extensions > pg_cron aktivieren
-- ============================================================

-- pg_cron Extension aktivieren (falls noch nicht aktiv)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Bestehenden Job entfernen falls vorhanden
SELECT cron.unschedule('auto-sync-outlook') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-sync-outlook'
);

-- Neuen Job alle 30 Minuten anlegen
-- Ruft die auto-sync-all Edge Function auf
SELECT cron.schedule(
  'auto-sync-outlook',
  '*/30 * * * *',  -- Alle 30 Minuten
  $$
  SELECT
    net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/auto-sync-all',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- ============================================================
-- ALTERNATIVE: Einfachere Methode mit direktem HTTP-Call
-- Falls net.http_post nicht verfügbar ist, diese Version nutzen:
-- ============================================================
-- SELECT cron.schedule(
--   'auto-sync-outlook',
--   '*/30 * * * *',
--   'SELECT 1'  -- Placeholder - dann manuell via Vercel Cron oder externe Dienste
-- );

-- ============================================================
-- HINWEIS ZU KOSTEN:
-- - Supabase Free Tier: 500.000 Edge Function Aufrufe/Monat
-- - 30-Min Sync: 48 Aufrufe/Tag × 30 Tage = 1.440/Monat pro User
-- - Für 5 User: ~7.200/Monat → weit unter dem Gratis-Limit
-- - Keine zusätzlichen Kosten erwartet
-- ============================================================
