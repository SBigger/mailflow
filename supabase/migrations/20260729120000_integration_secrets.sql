-- ===========================================================================
-- Zugangsdaten fuer externe Dienste -- heute: peoplefone Configuration API.
--
-- Warum NICHT system_settings:
--   system_settings hat die Policy system_settings_admin_all (ALL fuer jeden
--   Benutzer mit role = 'admin'). Ein Configuration-API-Schluessel kann die
--   GESAMTE Telefonanlage umbauen -- der darf nicht im Browser jedes Admins
--   liegen und schon gar nicht ueber PostgREST abrufbar sein.
--
-- Darum hat diese Tabelle BEWUSST keine einzige Policy: RLS ist an, es gibt
-- keine Regel, also sieht weder anon noch authenticated jemals eine Zeile.
-- Nur der service_role (Edge Functions) umgeht RLS.
--
-- Geschrieben wird ausschliesslich ueber die Edge Function telefonie-zugang
-- (nur Admins). Ausgelesen wird NIE nach aussen -- die Oberflaeche bekommt
-- bloss "gesetzt ja/nein", die letzten vier Zeichen und den Zeitstempel.
-- ===========================================================================

create table if not exists public.integration_secrets (
  name        text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.integration_secrets enable row level security;

-- Keine Policies. Zusaetzlich die Tabellenrechte entziehen, damit auch ein
-- spaeter versehentlich angelegtes "for all using (true)" nichts oeffnet.
revoke all on public.integration_secrets from anon, authenticated;

comment on table public.integration_secrets is
  'Geheimnisse fuer externe Dienste. Nur service_role. Schreiben ueber Edge Function telefonie-zugang, Auslesen nie.';
