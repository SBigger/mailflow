-- ══════════════════════════════════════════════════════════════════════
-- Migration: call_records
-- Zweck:     Telefon-Anrufprotokoll aus Microsoft Teams / Teams Phone
--            (Graph API /communications/callRecords)
-- Datum:     2026-04-23
-- Branch:    feat/teams-call-records
--
-- ADDITIV: keine bestehende Tabelle wird verändert.
-- Kann jederzeit via `drop table call_records cascade;` entfernt werden.
-- MS365-Mail-Integration (Tabelle mail_items / Funktionen sync-outlook-mails)
-- wird NICHT berührt.
-- ══════════════════════════════════════════════════════════════════════

create table if not exists call_records (
  id                uuid primary key default gen_random_uuid(),

  -- Eindeutige ID aus Microsoft Graph (Deduplikation)
  graph_call_id     text unique not null,

  -- Zuordnung (kann null sein, wenn keine Telefonnummer matched)
  customer_id       uuid references customers(id) on delete set null,

  -- Anruf-Metadaten
  direction         text,                             -- 'incoming' | 'outgoing' | 'unknown'
  call_type         text,                             -- 'peerToPeer' | 'group' | 'pstnCall' | 'unknown'

  -- Teilnehmer
  caller_number     text,                             -- E.164-normalisiert wenn möglich
  callee_number     text,
  caller_name       text,
  callee_name       text,

  -- Artis-Nutzer: welcher Mitarbeiter war am Anruf (display_name, tenantUser.id)
  artis_user_id     text,                             -- Graph user id (= AAD Object ID)
  artis_user_name   text,

  -- Zeiten
  start_time        timestamptz,
  end_time          timestamptz,
  duration_seconds  integer,

  -- Freitext-Notiz zum Gespräch (vom Artis-Mitarbeiter nachträglich gepflegt)
  notes             text,

  -- Rohdaten für Debug / Nachforschung
  raw               jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_call_records_customer_start
  on call_records (customer_id, start_time desc);

create index if not exists idx_call_records_start
  on call_records (start_time desc);

create index if not exists idx_call_records_artis_user
  on call_records (artis_user_id, start_time desc);

comment on table  call_records is 'Telefon-Anrufprotokoll aus MS Teams / Teams Phone (Graph callRecords). Additiv, separat von Mail-Integration.';
comment on column call_records.graph_call_id is 'ID aus Microsoft Graph callRecords — eindeutig, für Deduplikation';
comment on column call_records.direction     is 'incoming = Kunde→Artis, outgoing = Artis→Kunde';
comment on column call_records.call_type     is 'peerToPeer / group / pstnCall';
comment on column call_records.artis_user_id is 'Graph user id (Object-ID) des Artis-Mitarbeiters am Anruf';
comment on column call_records.raw           is 'Kompletter Graph-Response als jsonb (Audit/Debug)';

-- RLS: an bestehendes Muster anlehnen (alle eingeloggten Nutzer lesen)
alter table call_records enable row level security;

create policy call_records_select on call_records
  for select using (auth.role() = 'authenticated');

-- Schreiben: Service-Role (Edge Function) darf alles
create policy call_records_write on call_records
  for all using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

-- Authentifizierte Nutzer dürfen nur das Notizfeld bearbeiten (Update)
-- (kein Insert/Delete – das macht ausschliesslich die Edge Function)
create policy call_records_user_update on call_records
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- updated_at trigger
create or replace function call_records_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_call_records_updated_at on call_records;
create trigger trg_call_records_updated_at
  before update on call_records
  for each row execute function call_records_set_updated_at();
