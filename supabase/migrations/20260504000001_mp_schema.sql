-- ══════════════════════════════════════════════════════════════════════
-- Migration: mp_schema (Monatsplanung)
-- Zweck:     Kunden-spezifische Monatsplanung mit frei benennbaren
--            Zeilen (Titeln) und monatlichen Einträgen.
--            Prefix mp_ für spätere Standalone-Extraktion.
-- Datum:     2026-05-04
-- ADDITIV: keine bestehende Tabelle wird verändert.
-- ══════════════════════════════════════════════════════════════════════

-- ── Pläne: ein Kunde kann mehrere benannte Pläne haben ────────────────
create table if not exists mp_plans (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references customers(id) on delete cascade not null,
  name         text not null,                -- z.B. "Verwaltungsratstätigkeit"
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_mp_plans_customer on mp_plans (customer_id);

-- ── Einträge: Titel × Monat × Jahr pro Plan ───────────────────────────
create table if not exists mp_entries (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid references mp_plans(id) on delete cascade not null,
  title        text not null,               -- Zeilenbeschriftung, z.B. "Jahresabschluss"
  year         integer not null,
  month        integer not null check (month between 1 and 12),
  detail_text  text,
  datum        date,                        -- optionales Datum, nicht immer genutzt
  done         boolean not null default false,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_mp_entries_plan_year on mp_entries (plan_id, year);

-- ── RLS ───────────────────────────────────────────────────────────────
alter table mp_plans   enable row level security;
alter table mp_entries enable row level security;

-- Alle authentifizierten Nutzer können lesen und schreiben
create policy "mp_plans_all"   on mp_plans   for all to authenticated using (true) with check (true);
create policy "mp_entries_all" on mp_entries for all to authenticated using (true) with check (true);
