-- ===========================================================================
-- Besprechungen (Video) – Phase 2, Schritt 1: Gästezugang mit Warteraum
--
-- Entwurfsentscheide, damit später niemand rätselt:
--
-- 1) EIN Raumlink für alle Gäste, KEINE persönlichen Tokens.
--    Grund: Ein Outlook-Termin hat einen Text für alle Eingeladenen –
--    persönliche Links passen dort nicht hinein. Die Sicherheit trägt
--    stattdessen der Warteraum: Wer den Link hat, darf ANKLOPFEN, mehr nicht.
--    Hereingelassen wird nur, wen der Berater sieht und bestätigt.
--    Der Raumname ist zufällig (~40 Bit), also nicht erratbar.
--
-- 2) Gäste sprechen NIE direkt mit der Datenbank. Sie kennen weder den
--    öffentlichen Schlüssel noch eine Tabelle – alles läuft über die Edge
--    Function meeting-api (service_role). Deshalb hat `anon` hier keinerlei
--    Rechte, und es gibt bewusst KEINE anon-Policy.
--
-- 3) Der Zutritt wird nicht "zugerufen", sondern in meeting_guests vermerkt.
--    Ein über den Realtime-Kanal verschicktes Zutrittstoken könnte jeder
--    mitlesen, der den Kanal kennt; so muss der Gast sein Token bei der
--    Function abholen und die prüft vorher, ob er wirklich zugelassen wurde.
-- ===========================================================================

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  -- Raumname = zugleich LiveKit-Raum und Teil des Gastlinks. Einmalig und
  -- nie wiederverwendet, sonst fiele ein Nachzügler mit altem Link in die
  -- nächste Besprechung.
  room_name text not null unique,
  title text not null default 'Besprechung',
  customer_id uuid references public.customers(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  -- Warteraum ist bewusst nicht abschaltbar vorgesehen (Spalte existiert nur,
  -- damit ein späterer, bewusster Entscheid keine Migration braucht).
  lobby_enabled boolean not null default true,
  status text not null default 'offen'
    check (status in ('offen', 'laufend', 'beendet', 'abgesagt')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meetings_room on public.meetings(room_name);
create index if not exists idx_meetings_customer on public.meetings(customer_id, created_at desc);

-- Ein Anklopfen = eine Zeile. Auch abgewiesene bleiben stehen: Wer wann
-- hereinwollte, ist bei Mandantengesprächen eine sinnvolle Spur.
create table if not exists public.meeting_guests (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  display_name text not null,
  requested_at timestamptz not null default now(),
  admitted_at timestamptz,
  admitted_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  -- Gegen wiederholtes Abholen desselben Zutritts: einmal ausgestellt,
  -- vermerkt die Function das hier.
  token_issued_at timestamptz
);

create index if not exists idx_meeting_guests_meeting on public.meeting_guests(meeting_id, requested_at desc);
create index if not exists idx_meeting_guests_offen
  on public.meeting_guests(meeting_id)
  where admitted_at is null and rejected_at is null;

alter table public.meetings enable row level security;
alter table public.meeting_guests enable row level security;

-- Mitarbeitende (angemeldet) dürfen Besprechungen sehen und anlegen.
drop policy if exists meetings_staff on public.meetings;
create policy meetings_staff on public.meetings
  for all to authenticated using (true) with check (true);

-- Anklopfende sieht das Team; geschrieben wird ausschliesslich von der
-- Edge Function (service_role umgeht RLS).
drop policy if exists meeting_guests_staff_read on public.meeting_guests;
create policy meeting_guests_staff_read on public.meeting_guests
  for select to authenticated using (true);

drop policy if exists meeting_guests_staff_update on public.meeting_guests;
create policy meeting_guests_staff_update on public.meeting_guests
  for update to authenticated using (true) with check (true);

-- Gäste (anon) haben hier NICHTS zu suchen – sie gehen immer über meeting-api.
revoke all on public.meetings from anon;
revoke all on public.meeting_guests from anon;
