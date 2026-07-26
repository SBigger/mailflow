-- Loest public.telefonie_subscription (Singular, EINE Zeile mit nur der
-- neuesten ID) ab. Review-Befund 2026-07-26: schlug das Loeschen der
-- Vorgaenger-Subscription fehl (peoplefone antwortet oft 419 "Too Many
-- Attempts"), war deren ID beim naechsten Lauf vergessen -- die Subscription
-- blieb dauerhaft verwaist und stellte weiter zu (Mehrfach-Zustellung).
-- Neu: EINE Zeile PRO jemals erzeugter Subscription; geloescht gilt erst,
-- wenn peoplefone es bestaetigt hat (cleaned_up_at gesetzt). Jeder
-- Keepalive-Lauf raeumt ALLE noch unbestaetigten alten IDs auf.
create table if not exists public.telefonie_subscriptions (
  subscription_id text primary key,
  provider text not null default 'peoplefone',
  created_at timestamptz not null default now(),
  cleaned_up_at timestamptz
);

alter table public.telefonie_subscriptions enable row level security;
-- Nur die Edge Function (service_role) liest/schreibt hier -- keine
-- App-Policies fuer normale Benutzer noetig.

-- Letzte bekannte ID aus der alten Ein-Zeilen-Tabelle uebernehmen, damit
-- der erste Lauf des neuen Keepalive sie mit aufraeumt.
insert into public.telefonie_subscriptions (subscription_id, provider)
select subscription_id, provider from public.telefonie_subscription
where subscription_id is not null
on conflict (subscription_id) do nothing;

-- Die alte Tabelle public.telefonie_subscription (Singular) NICHT hier
-- droppen: zwischen db-Aenderung und Function-Deploy laeuft ggf. noch die
-- alte Keepalive-Version, die sie braucht. Manuell entfernen, sobald die
-- neue Function live ist:  drop table if exists public.telefonie_subscription;
