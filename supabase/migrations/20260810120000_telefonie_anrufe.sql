-- ===========================================================================
-- Anrufverlauf -- dauerhaft, geraeteunabhaengig.
--
-- Bisher lebte der Verlauf nur im Arbeitsspeicher des Clients: nach dem
-- Schliessen war er weg, und Gespraeche, die am Handy oder am Tischtelefon
-- gefuehrt wurden, tauchten nie auf. Dabei meldet uns die Telefonanlage
-- JEDEN Anruf auf der Leitung -- wir haben die Meldung bisher angezeigt und
-- danach weggeworfen.
--
-- Quelle ist deshalb der Webhook (telefonie-peoplefone-webhook), nicht der
-- Client: nur so ist der Verlauf vollstaendig, egal womit telefoniert wurde.
--
-- Ein Anruf durchlaeuft mehrere Meldungen (ringing -> answered -> ended).
-- Darum eine Zeile je (Person, peoplefone-Anruf-ID), die fortgeschrieben
-- wird -- sonst stuende jeder Anruf drei Mal in der Liste.
-- ===========================================================================

create table if not exists public.telefonie_anrufe (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  call_id      text not null,                    -- peoplefone-Anruf-ID
  richtung     text not null check (richtung in ('in', 'out')),
  nummer       text,                             -- Gegenstelle
  name         text,                             -- Anzeigename der Anlage
  customer_id  uuid,                             -- erkannter Kunde, falls gefunden
  kunde        text,                             -- Firmenname zum Zeitpunkt des Anrufs
  begonnen_am  timestamptz not null default now(),
  beantwortet_am timestamptz,
  beendet_am   timestamptz,
  dauer_sek    integer,
  verpasst     boolean not null default false,
  gesehen      boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (user_id, call_id)
);

create index if not exists telefonie_anrufe_user_zeit_idx
  on public.telefonie_anrufe (user_id, begonnen_am desc);

alter table public.telefonie_anrufe enable row level security;

-- Jede Person sieht ausschliesslich ihre eigenen Anrufe. Rufnummern von
-- Kunden sind Personendaten -- ein gemeinsamer Verlauf waere hier falsch.
drop policy if exists telefonie_anrufe_eigene_lesen on public.telefonie_anrufe;
create policy telefonie_anrufe_eigene_lesen
  on public.telefonie_anrufe for select to authenticated
  using (user_id = auth.uid());

-- Aendern darf man nur das Gelesen-Kennzeichen an eigenen Zeilen; geschrieben
-- wird sonst ausschliesslich vom Webhook (service_role, umgeht RLS).
drop policy if exists telefonie_anrufe_eigene_aendern on public.telefonie_anrufe;
create policy telefonie_anrufe_eigene_aendern
  on public.telefonie_anrufe for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke insert, delete on public.telefonie_anrufe from anon, authenticated;

comment on table public.telefonie_anrufe is
  'Anrufverlauf pro Person, gespeist aus dem peoplefone-Webhook. Eine Zeile je Anruf, fortgeschrieben ueber ringing/answered/ended.';
