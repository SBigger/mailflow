-- ══════════════════════════════════════════════════════════════════════
-- pg_cron-Job: telefonie-peoplefone-keepalive alle 5 Minuten aufrufen
--
-- Am 2026-07-26 live auf smartis.me's Supabase-Projekt (uawgpxcihixqxqxxbjak)
-- angelegt (via Management-API, Job war dort zuletzt als ID 14 sichtbar) --
-- diese Datei dokumentiert den Job im Repo, damit er bei einem frischen
-- Aufsetzen reproduzierbar ist (Review-Befund 2026-07-26: Cron war nirgends
-- im Repo festgehalten).
--
-- BEWUSST KEINE Migration: supabase db push wuerde sie auf jeder Umgebung
-- ausfuehren; der Job gehoert aber nur auf Umgebungen, deren peoplefone-
-- Secrets gesetzt sind. Bei Bedarf manuell im SQL-Editor ausfuehren.
--
-- Voraussetzungen: Extensions pg_cron + pg_net aktiv (Dashboard -> Database
-- -> Extensions), Function telefonie-peoplefone-keepalive deployt.
-- <ANON_KEY> ersetzen (Dashboard -> Settings -> API) -- die Function ist mit
-- JWT-Pruefung deployt, der anon-Key genuegt ihr als gueltiges JWT.
--
-- cron.schedule ist per Jobname idempotent: erneutes Ausfuehren mit gleichem
-- Namen ersetzt den bestehenden Job, es entsteht kein Duplikat.
-- Kontrolle:  select jobid, jobname, schedule, active from cron.job;
-- Abschalten: select cron.unschedule('telefonie-peoplefone-keepalive');
-- ══════════════════════════════════════════════════════════════════════
-- ⚠️ */15 statt urspruenglich */5 (umgestellt 2026-07-26): peoplefone
-- drosselt Subscription-Aenderungen desselben Owners hart (DELETE -> 419,
-- ohne Retry-After) -- unsere eigenen 5-Minuten-POSTs frassen das Budget
-- auf, KEIN einziges Aufraeumen kam durch, und die Waisen stellen
-- nachweislich ALLE parallel zu (60+ Webhook-Zustellungen pro Minute fuer
-- EINEN Anruf, Logs 26.07. 15:59). keepAlive-Pings schickt peoplefone
-- entgegen der eigenen Spec gar nicht (0 in 5h Logs) -- Gesundheit ist
-- also nicht beobachtbar, blindes Erneuern bleibt noetig, aber seltener.
-- Trade-off: stirbt eine Subscription leise, maximal 15 Min Luecke.
select cron.schedule(
  'telefonie-peoplefone-keepalive',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url     := 'https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1/telefonie-peoplefone-keepalive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $job$
);
