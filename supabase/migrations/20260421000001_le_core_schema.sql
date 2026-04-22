-- =====================================================================
-- Leistungserfassung · Core Schema (Schritt 2)
-- =====================================================================
-- REVIEW-DATEI · noch NICHT auf Supabase ausgeführt.
-- Tabellen-Prefix: le_*  (keine bestehenden Tabellen berührt)
-- Bestehende Tabellen referenziert (nur lesend via FK):
--   - customers(id)   – optionale Verknüpfung Projekt → Kunde
--   - profiles(id)    – optionale Verknüpfung Mitarbeiter → App-User
--
-- Erster Rollout: nur die 6 Kern-Tabellen für das Rapportieren.
-- Rechnungen/Akonto/Mahnwesen/etc. kommen in einer späteren Migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Mitarbeiter (separat von profiles – nicht jeder MA hat App-Login)
-- ---------------------------------------------------------------------
create table if not exists public.le_employee (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete set null,  -- optional: Verknüpfung zum App-User
  short_code   text not null,                                            -- z.B. "S.B.", "M.E." für Rapport-Spalten
  full_name    text not null,
  email        text,
  role         text,                                                     -- frei: "Treuhänder", "Revisor", "Admin" …
  pensum_pct   numeric(5,2) default 100.00,                              -- 100.00 = 100%
  entry_date   date,                                                     -- Eintritt
  exit_date    date,                                                     -- Austritt (null = aktiv)
  cost_rate    numeric(10,2),                                            -- interner Kostensatz CHF/h
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (short_code)
);

-- ---------------------------------------------------------------------
-- 2) Leistungsarten (Abschlussarb., Buchhaltung, Steuern, Beratung, …)
-- ---------------------------------------------------------------------
create table if not exists public.le_service_type (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,                                            -- "ABS", "BUCH", "STEU", …
  name         text not null,                                            -- "Abschlussarbeiten"
  billable     boolean not null default true,                            -- false = intern (Weiterbildung etc.)
  sort_order   int not null default 100,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (code)
);

-- Satz-Historie (pro Leistungsart – Default-Satz, gültig ab Datum)
-- Rate-Groups können diesen Satz übersteuern.
create table if not exists public.le_service_rate_history (
  id              uuid primary key default gen_random_uuid(),
  service_type_id uuid not null references public.le_service_type(id) on delete cascade,
  valid_from      date not null,
  rate            numeric(10,2) not null,                                -- CHF/h
  note            text,
  created_at      timestamptz not null default now(),
  unique (service_type_id, valid_from)
);

-- ---------------------------------------------------------------------
-- 3) Gruppenansätze (z.B. "Standard", "Premium", "KMU-Pauschal")
--    → pro Leistungsart eigener Satz
-- ---------------------------------------------------------------------
create table if not exists public.le_rate_group (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                                            -- "Standard 2026"
  description  text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (name)
);

create table if not exists public.le_rate_group_rate (
  id              uuid primary key default gen_random_uuid(),
  rate_group_id   uuid not null references public.le_rate_group(id) on delete cascade,
  service_type_id uuid not null references public.le_service_type(id) on delete restrict,
  rate            numeric(10,2) not null,                                -- CHF/h, übersteuert Default-Satz
  valid_from      date not null default current_date,
  created_at      timestamptz not null default now(),
  unique (rate_group_id, service_type_id, valid_from)
);

-- ---------------------------------------------------------------------
-- 4) Projekte
--    Namenskonvention: "{Kundenname}, BWL"  (bzw. ", Steuern 2024" etc.)
-- ---------------------------------------------------------------------
create type le_project_billing_mode as enum ('effektiv', 'pauschal');
create type le_project_status as enum ('offen', 'archiviert');

create table if not exists public.le_project (
  id             uuid primary key default gen_random_uuid(),
  project_no     text not null,                                          -- z.B. "P-2026-014"
  name           text not null,                                          -- "Huber AG, BWL"
  customer_id    uuid references public.customers(id) on delete set null,
  responsible_employee_id uuid references public.le_employee(id) on delete set null,
  rate_group_id  uuid references public.le_rate_group(id) on delete set null,
  billing_mode   le_project_billing_mode not null default 'effektiv',
  pauschal_amount numeric(12,2),                                         -- nur relevant wenn pauschal
  pauschal_cycle text,                                                   -- "monatlich", "quartal", "jahr", …
  budget_hours   numeric(10,2),                                          -- optional Budget in Std.
  budget_amount  numeric(12,2),                                          -- optional Budget in CHF
  status         le_project_status not null default 'offen',
  started_at     date,
  closed_at      date,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_no)
);

create index if not exists idx_le_project_customer on public.le_project(customer_id);
create index if not exists idx_le_project_status   on public.le_project(status);

-- ---------------------------------------------------------------------
-- 5) Zeiteinträge (Rapporte)
--    - hours_internal: was der MA wirklich geleistet hat
--    - rate_snapshot:  eingefrorener Satz zum Zeitpunkt der Erfassung
--    - hours_external wird erst bei der Fakturierung gesetzt (per Rechnung)
-- ---------------------------------------------------------------------
create type le_time_entry_status as enum ('erfasst', 'freigegeben', 'verrechnet', 'storniert');

create table if not exists public.le_time_entry (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.le_project(id) on delete restrict,
  employee_id      uuid not null references public.le_employee(id) on delete restrict,
  service_type_id  uuid not null references public.le_service_type(id) on delete restrict,
  entry_date       date not null,
  time_from        time,                                                 -- optional
  time_to          time,                                                 -- optional
  hours_internal   numeric(5,2) not null check (hours_internal >= 0),
  rate_snapshot    numeric(10,2) not null,                               -- CHF/h zum Erfassungszeitpunkt
  description      text,
  status           le_time_entry_status not null default 'erfasst',
  invoice_id       uuid,                                                 -- FK in späterer Migration (le_invoice)
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_le_time_entry_project  on public.le_time_entry(project_id);
create index if not exists idx_le_time_entry_employee on public.le_time_entry(employee_id);
create index if not exists idx_le_time_entry_date     on public.le_time_entry(entry_date);
create index if not exists idx_le_time_entry_status   on public.le_time_entry(status);

-- ---------------------------------------------------------------------
-- 6) updated_at Trigger (einheitlich für alle Tabellen)
-- ---------------------------------------------------------------------
create or replace function public.le_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'le_employee','le_service_type','le_rate_group',
    'le_project','le_time_entry'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
                    for each row execute function public.le_set_updated_at();', t);
  end loop;
end $$;

-- =====================================================================
-- RLS · Row Level Security
-- =====================================================================
-- Policy-Strategie für den ersten Rollout:
--   - Alle authenticated User dürfen SELECT/INSERT/UPDATE.
--   - Delete nur für Admins (über profiles.role).
--   - Einträge gehören organisatorisch "allen" – keine mandantenfähige
--     Trennung, weil Artis ein Einzel-Mandant ist.
--   - FEINER werden wir: employee kann nur seine eigenen time_entries
--     anlegen/ändern (matched über profile_id).
-- =====================================================================

alter table public.le_employee             enable row level security;
alter table public.le_service_type         enable row level security;
alter table public.le_service_rate_history enable row level security;
alter table public.le_rate_group           enable row level security;
alter table public.le_rate_group_rate      enable row level security;
alter table public.le_project              enable row level security;
alter table public.le_time_entry           enable row level security;

-- Helper: ist der aktuelle User Admin?
create or replace function public.le_is_admin()
returns boolean language sql stable as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- Generische Read-Policies: jeder authenticated User darf lesen
do $$
declare t text;
begin
  foreach t in array array[
    'le_employee','le_service_type','le_service_rate_history',
    'le_rate_group','le_rate_group_rate','le_project','le_time_entry'
  ] loop
    execute format('drop policy if exists "%1$s_read" on public.%1$s;', t);
    execute format('create policy "%1$s_read" on public.%1$s
                    for select to authenticated using (true);', t);
  end loop;
end $$;

-- Stammdaten (employee, service_type, rate_group, projects): nur Admin schreibt
do $$
declare t text;
begin
  foreach t in array array[
    'le_employee','le_service_type','le_service_rate_history',
    'le_rate_group','le_rate_group_rate','le_project'
  ] loop
    execute format('drop policy if exists "%1$s_write" on public.%1$s;', t);
    execute format('create policy "%1$s_write" on public.%1$s
                    for all to authenticated
                    using (public.le_is_admin())
                    with check (public.le_is_admin());', t);
  end loop;
end $$;

-- Time-Entries: jeder darf lesen; nur eigene anlegen/ändern; Admin darf alles
drop policy if exists "le_time_entry_insert_own" on public.le_time_entry;
create policy "le_time_entry_insert_own" on public.le_time_entry
  for insert to authenticated
  with check (
    public.le_is_admin()
    or exists (
      select 1 from public.le_employee e
      where e.id = employee_id and e.profile_id = auth.uid()
    )
  );

drop policy if exists "le_time_entry_update_own" on public.le_time_entry;
create policy "le_time_entry_update_own" on public.le_time_entry
  for update to authenticated
  using (
    public.le_is_admin()
    or exists (
      select 1 from public.le_employee e
      where e.id = employee_id and e.profile_id = auth.uid()
    )
  );

drop policy if exists "le_time_entry_delete_admin" on public.le_time_entry;
create policy "le_time_entry_delete_admin" on public.le_time_entry
  for delete to authenticated
  using (public.le_is_admin());

-- =====================================================================
-- ENDE · kein Seed-Data in dieser Migration.
-- Seeds (Standard-Leistungsarten, Default-Gruppenansatz) kommen separat.
-- =====================================================================
