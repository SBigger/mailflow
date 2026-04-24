-- ══════════════════════════════════════════════════════════════════════
-- Migration: call_notes_pending
-- Zweck:     Vorab-Notizen, die beim Klick auf eine Telefonnummer in
--            MailFlow erfasst werden – noch BEVOR der Graph-Sync den
--            tatsächlichen Anruf meldet. Der Sync-Job verknüpft sie am
--            Folgetag mit dem passenden call_records-Eintrag
--            (gleicher Mitarbeiter + gleiche Nummer + ±30 Min).
-- Datum:     2026-04-24
--
-- ADDITIV: separate Tabelle. call_records wird nicht verändert.
--          MS365-Mail-Integration bleibt unberührt.
-- ══════════════════════════════════════════════════════════════════════

create table if not exists call_notes_pending (
  id                uuid primary key default gen_random_uuid(),

  -- Kunde, den der Mitarbeiter beim Klick gerade offen hatte (kann null sein,
  -- wenn manuell über Freitext angelegt) – reines Soft-Link.
  customer_id       uuid references customers(id) on delete set null,

  -- Gewählte / notierte Telefonnummer in E.164-ähnlicher Form (+41…).
  phone_number      text not null,
  -- Letzte 9 Ziffern für Match mit call_records (gleicher Normalisierer
  -- wie in Edge Function).
  phone_suffix      text,

  -- MailFlow-Nutzer, der geklickt hat
  created_by        uuid references auth.users(id) on delete set null,
  artis_user_name   text,   -- Display Name aus profiles.full_name (für Match zu call_records.artis_user_name)
  artis_user_email  text,   -- Login-E-Mail (optional zweite Match-Strategie)

  -- Notiz-Inhalt
  note_title        text,
  note_text         text,

  -- Zeitpunkt des Klicks (ankert den ±30-Min-Match)
  clicked_at        timestamptz not null default now(),

  -- Gesetzt vom Sync-Job, sobald der passende Anruf gefunden wurde.
  linked_call_id    uuid references call_records(id) on delete set null,
  linked_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_call_notes_pending_unlinked
  on call_notes_pending (clicked_at desc)
  where linked_call_id is null;

create index if not exists idx_call_notes_pending_customer
  on call_notes_pending (customer_id, clicked_at desc);

create index if not exists idx_call_notes_pending_match
  on call_notes_pending (artis_user_name, phone_suffix, clicked_at)
  where linked_call_id is null;

comment on table call_notes_pending is
  'Vorab-Notizen beim Click-to-Call in MailFlow. Wird vom sync-teams-calls Job an den realen call_records-Eintrag angehängt (gleicher Mitarbeiter + gleiche Nummer ±30 Min).';

-- ── RLS ────────────────────────────────────────────────────────────
alter table call_notes_pending enable row level security;

-- Lesen: alle authentifizierten Nutzer
create policy call_notes_pending_select on call_notes_pending
  for select using (auth.role() = 'authenticated');

-- Einfügen: authentifizierte Nutzer dürfen für sich selbst einfügen
create policy call_notes_pending_insert on call_notes_pending
  for insert with check (auth.role() = 'authenticated');

-- Update: eigene Einträge bearbeiten (Titel/Text korrigieren bis zum Match)
create policy call_notes_pending_update on call_notes_pending
  for update using (auth.role() = 'authenticated' and (created_by = auth.uid() or auth.jwt() ->> 'role' = 'service_role'))
  with check (auth.role() = 'authenticated');

-- Delete: eigene Einträge löschen
create policy call_notes_pending_delete on call_notes_pending
  for delete using (auth.role() = 'authenticated' and (created_by = auth.uid() or auth.jwt() ->> 'role' = 'service_role'));

-- Service-Role (Edge Function) darf alles
create policy call_notes_pending_service on call_notes_pending
  for all using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

-- ── updated_at trigger ─────────────────────────────────────────────
create or replace function call_notes_pending_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_call_notes_pending_updated_at on call_notes_pending;
create trigger trg_call_notes_pending_updated_at
  before update on call_notes_pending
  for each row execute function call_notes_pending_set_updated_at();
