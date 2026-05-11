-- ── Anlagebuchhaltung (ANBU/FIBU) ──────────────────────────────────────────
-- Jahresabschluss pro Mandant + Geschäftsjahr (analog abschluss_konten)
create table if not exists anbu_jahresabschluss (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  geschaeftsjahr integer not null,
  einstellungen jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, geschaeftsjahr)
);

-- Kategorien pro Mandant (flexibel erweiterbar, mit Default-Abschreibungswerten)
create table if not exists anbu_kategorie (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  reihenfolge integer not null default 0,
  default_anbu_nutzungsdauer_j integer,   -- z.B. 10 (Jahre, linear)
  default_fibu_abschreibung_pct numeric,  -- z.B. 25 (Prozent vom Buchwert, degressiv)
  notiz text,
  created_at timestamptz not null default now(),
  unique (customer_id, name)
);

-- Einzelne Anlagen / Aktivierungen
create table if not exists anbu_anlage (
  id uuid primary key default gen_random_uuid(),
  abschluss_id uuid not null references anbu_jahresabschluss(id) on delete cascade,
  -- Identifikation
  inv_nr text,
  beschreibung text not null,
  lieferant text,
  typ text not null default 'Kauf',
  menge numeric not null default 1,
  aktiviert boolean not null default true,
  -- Beschaffung
  beschaffung_monat integer,
  beschaffung_jahr integer,
  beschaffungskosten_netto numeric not null default 0,
  -- Zuordnung
  fibu_konto text,
  kategorie_id uuid references anbu_kategorie(id) on delete set null,
  sub_kategorie text,
  notiz text,
  -- ANBU (linear)
  anbu_nutzungsdauer_j integer,
  anbu_buchwert_anfang numeric not null default 0,
  anbu_abschreibung_gj numeric not null default 0,
  anbu_korrektur numeric not null default 0,
  -- Buchwert Ende = anfang - abschreibung - korrektur (berechnet im Frontend, persistiert für Performance)
  anbu_buchwert_ende numeric not null default 0,
  -- FIBU (degressiv)
  fibu_abschreibung_pct numeric,
  fibu_buchwert_anfang numeric not null default 0,
  fibu_abschreibung_gj numeric not null default 0,
  fibu_korrektur numeric not null default 0,
  fibu_buchwert_ende numeric not null default 0,
  -- Sortierung innerhalb Kategorie
  sortierung integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_anbu_anlage_abschluss on anbu_anlage(abschluss_id);
create index if not exists idx_anbu_anlage_kategorie on anbu_anlage(kategorie_id);
create index if not exists idx_anbu_anlage_fibu_konto on anbu_anlage(fibu_konto);
create index if not exists idx_anbu_jahresabschluss_cust on anbu_jahresabschluss(customer_id, geschaeftsjahr);
create index if not exists idx_anbu_kategorie_cust on anbu_kategorie(customer_id, reihenfolge);

-- Trigger: updated_at auto-update
create or replace function tg_anbu_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
drop trigger if exists trg_anbu_jahresabschluss_touch on anbu_jahresabschluss;
create trigger trg_anbu_jahresabschluss_touch before update on anbu_jahresabschluss
  for each row execute function tg_anbu_touch_updated_at();
drop trigger if exists trg_anbu_anlage_touch on anbu_anlage;
create trigger trg_anbu_anlage_touch before update on anbu_anlage
  for each row execute function tg_anbu_touch_updated_at();

-- RLS: authentifizierte User dürfen ihre Tenant-Daten lesen/schreiben
alter table anbu_jahresabschluss enable row level security;
alter table anbu_kategorie       enable row level security;
alter table anbu_anlage          enable row level security;

drop policy if exists "anbu_jahresabschluss_all" on anbu_jahresabschluss;
create policy "anbu_jahresabschluss_all" on anbu_jahresabschluss
  for all to authenticated using (true) with check (true);

drop policy if exists "anbu_kategorie_all" on anbu_kategorie;
create policy "anbu_kategorie_all" on anbu_kategorie
  for all to authenticated using (true) with check (true);

drop policy if exists "anbu_anlage_all" on anbu_anlage;
create policy "anbu_anlage_all" on anbu_anlage
  for all to authenticated using (true) with check (true);
