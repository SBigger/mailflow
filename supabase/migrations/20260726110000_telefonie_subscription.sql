-- Verfolgt die aktuell bekannte peoplefone Call-Management-Subscription-ID,
-- damit telefonie-peoplefone-keepalive beim periodischen Neu-Registrieren
-- die jeweils VORHERIGE Subscription gezielt loeschen kann (peoplefones
-- eigene Zusage "gleiche callbackUrl -> gleiche ID, kein Effekt" hat sich
-- am 2026-07-26 live als nicht verlaesslich erwiesen -- ohne dieses
-- Aufraeumen wuerden sich Subscriptions unbegrenzt anhaeufen).
-- Bereits live angelegt am 2026-07-26; diese Migration dokumentiert nur den
-- Stand im Repo (idempotent, falls nochmal frisch aufgesetzt wird).
create table if not exists public.telefonie_subscription (
  provider text primary key,
  subscription_id text,
  updated_at timestamptz not null default now()
);

alter table public.telefonie_subscription enable row level security;

-- Nur die Edge Function (service_role) liest/schreibt hier -- keine
-- App-Policies fuer normale Benutzer noetig.
