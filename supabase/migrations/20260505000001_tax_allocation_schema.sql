-- ══════════════════════════════════════════════════════════════════════
-- Migration: tax_allocation_schema (Steuerausscheidung)
-- Zweck:     Interkantonale + innerkantonale Steuerausscheidung pro
--            Kunde × Steuerjahr. DBSt nur in einem Kanton, Staats-/
--            Gemeindesteuer pro Kanton/Gemeinde mit Quote, Faktoren
--            (eigen + zum Satz / Progressionsvorbehalt), Veranlagung
--            und Rechnungslauf. Steuerfuss-Stammdaten separat.
-- Datum:     2026-05-05
-- Prefix:    tax_  (für spätere Standalone-Extraktion)
-- ADDITIV:   keine bestehende Tabelle wird verändert.
-- ══════════════════════════════════════════════════════════════════════

-- ── Periode: 1 pro Kunde × Steuerjahr ─────────────────────────────────
create table if not exists tax_allocation_period (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid references customers(id) on delete cascade not null,
  steuerjahr      integer not null,
  person_type     text not null default 'jp' check (person_type in ('jp','np')),
  dbst_kanton     text,                          -- 2-Letter ISO-Code, z.B. 'SG'
  gesamtgewinn    numeric(14,2),                 -- bei jp: Reingewinn / bei np: Einkommen
  gesamtkapital   numeric(14,2),                 -- bei jp: Eigenkapital / bei np: Vermögen
  praezipuum_pct  numeric(5,2) default 0,        -- Vorab-Anteil Hauptsitz (typ. 10–20%)
  status          text not null default 'entwurf' check (status in ('entwurf','definitiv')),
  notiz           text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (customer_id, steuerjahr)
);

create index if not exists idx_tax_period_customer on tax_allocation_period (customer_id);
create index if not exists idx_tax_period_jahr     on tax_allocation_period (steuerjahr);

-- ── Unit: ein Kanton ODER eine Gemeinde innerhalb eines Kantons ───────
create table if not exists tax_allocation_unit (
  id                          uuid primary key default gen_random_uuid(),
  period_id                   uuid references tax_allocation_period(id) on delete cascade not null,
  ebene                       text not null check (ebene in ('kanton','gemeinde')),
  kanton                      text not null,
  gemeinde                    text,                       -- null wenn ebene='kanton'
  anknuepfung                 text check (anknuepfung in ('sitz','betriebsstaette','liegenschaft','wohnsitz')),

  -- Schlüssel-Inputs (für quotenmässige Ausscheidung)
  schluessel_umsatz           numeric(14,2),
  schluessel_lohnsumme        numeric(14,2),
  schluessel_anlagewerte      numeric(14,2),
  schluessel_mobiliar         numeric(14,2),

  -- Quote (Prozent-Anteil dieser Unit am Gesamtfaktor)
  quote_berechnet_pct         numeric(7,4),               -- automatisch berechnet
  quote_manuell_pct           numeric(7,4),               -- Override (null = berechnet wirkt)

  -- Steuerfaktoren: eigen (Steuerbasis) + zum Satz (Progressionsvorbehalt)
  steuerbarer_gewinn_eigen    numeric(14,2),
  steuerbarer_gewinn_zum_satz numeric(14,2),
  steuerbares_kapital_eigen   numeric(14,2),
  steuerbares_kapital_zum_satz numeric(14,2),

  -- Veranlagungsstatus
  veranlagung_datum           date,
  veranlagung_status          text default 'offen' check (veranlagung_status in ('offen','provisorisch','definitiv')),
  veranlagung_pdf_url         text,
  veranlagung_faktoren        jsonb,                      -- was Steueramt definitiv festgesetzt hat

  sort_order                  integer default 0,
  notiz                       text,
  created_by                  uuid references profiles(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_tax_unit_period on tax_allocation_unit (period_id);
create index if not exists idx_tax_unit_kanton on tax_allocation_unit (kanton);

-- ── Rechnungen pro Unit (Akonto / Definitiv / Schluss / Zinsen) ───────
create table if not exists tax_allocation_invoice (
  id              uuid primary key default gen_random_uuid(),
  unit_id         uuid references tax_allocation_unit(id) on delete cascade not null,
  rechnungstyp    text not null check (rechnungstyp in ('provisorisch','definitiv','schluss','zins','akonto')),
  rechnungsdatum  date,
  faelligkeit     date,
  betrag_soll     numeric(14,2),
  betrag_haben    numeric(14,2),                  -- bezahlter Betrag
  bezahlt_datum   date,
  pdf_url         text,
  notiz           text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_tax_invoice_unit on tax_allocation_invoice (unit_id);

-- ── Steuerfuss-Stammdaten (Kanton/Gemeinde/Jahr) mit Override ─────────
create table if not exists tax_steuerfuss (
  id               uuid primary key default gen_random_uuid(),
  kanton           text not null,
  gemeinde         text,                          -- null = reiner Kantons-Steuerfuss
  jahr             integer not null,
  steuerfuss_pct   numeric(7,3) not null,         -- z.B. 115.000 für 115%
  tarif_referenz   text,                          -- Quelle/URL/Kommentar
  override_user_id uuid references profiles(id) on delete set null,
  override_note    text,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (kanton, gemeinde, jahr)
);

create index if not exists idx_tax_steuerfuss_kg_jahr on tax_steuerfuss (kanton, gemeinde, jahr);

-- ── updated_at-Trigger ────────────────────────────────────────────────
create or replace function tax_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tax_period_updated  on tax_allocation_period;
drop trigger if exists trg_tax_unit_updated    on tax_allocation_unit;
drop trigger if exists trg_tax_invoice_updated on tax_allocation_invoice;
drop trigger if exists trg_tax_fuss_updated    on tax_steuerfuss;

create trigger trg_tax_period_updated  before update on tax_allocation_period  for each row execute function tax_set_updated_at();
create trigger trg_tax_unit_updated    before update on tax_allocation_unit    for each row execute function tax_set_updated_at();
create trigger trg_tax_invoice_updated before update on tax_allocation_invoice for each row execute function tax_set_updated_at();
create trigger trg_tax_fuss_updated    before update on tax_steuerfuss         for each row execute function tax_set_updated_at();

-- ── RLS: alle authentifizierten Mitarbeiter sehen alles ───────────────
alter table tax_allocation_period   enable row level security;
alter table tax_allocation_unit     enable row level security;
alter table tax_allocation_invoice  enable row level security;
alter table tax_steuerfuss          enable row level security;

drop policy if exists "tax_period_all"  on tax_allocation_period;
drop policy if exists "tax_unit_all"    on tax_allocation_unit;
drop policy if exists "tax_invoice_all" on tax_allocation_invoice;
drop policy if exists "tax_fuss_all"    on tax_steuerfuss;

create policy "tax_period_all"  on tax_allocation_period  for all to authenticated using (true) with check (true);
create policy "tax_unit_all"    on tax_allocation_unit    for all to authenticated using (true) with check (true);
create policy "tax_invoice_all" on tax_allocation_invoice for all to authenticated using (true) with check (true);
create policy "tax_fuss_all"    on tax_steuerfuss         for all to authenticated using (true) with check (true);
