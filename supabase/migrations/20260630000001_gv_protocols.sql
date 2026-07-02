-- 20260630000001_gv_protocols.sql
-- GV-Protokoll / Aktennotiz: zentrale Ablage der Protokolle pro Kunde.
-- Speichert das komplette Protokoll (Transkript + Auswertung + Teilnehmer + Kunde)
-- als JSONB, damit es wieder geladen und als Word re-exportiert werden kann.

create table if not exists public.gv_protocols (
  id            uuid primary key default gen_random_uuid(),
  customer_id   text,                          -- Kunden-ID aus customers (oder leer bei Freitext)
  customer_name text,                           -- Anzeigename fuer die Gruppierung
  title         text not null default 'Protokoll',
  meeting_date  date not null default current_date,
  data          jsonb not null default '{}'::jsonb,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists gv_protocols_customer_idx on public.gv_protocols (customer_name);
create index if not exists gv_protocols_created_idx  on public.gv_protocols (created_at desc);

alter table public.gv_protocols enable row level security;

-- Team-geteilt: alle eingeloggten Mitarbeiter duerfen lesen/schreiben (wie le_invoice).
drop policy if exists gv_protocols_read  on public.gv_protocols;
drop policy if exists gv_protocols_write on public.gv_protocols;
create policy "gv_protocols_read"  on public.gv_protocols for select to authenticated using (true);
create policy "gv_protocols_write" on public.gv_protocols for all    to authenticated using (true) with check (true);
