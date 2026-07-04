-- =====================================================================
-- Zweistufiger Sollzeit-Plan:
--   1) le_sollzeit_template = zentraler, firmenweiter Plan (versioniert)
--   2) le_sollzeit_profile  = Mitarbeiter-Override darauf (Pensum-Skalierung
--      + optionale Wochentag-Overrides; NULL = vom Zentral-Plan erben)
--   3) le_holiday (bereits vorhanden, bisher ungenutzt) = Feiertage,
--      übersteuern IMMER auf 0h, unabhängig vom Mitarbeiter.
-- Idempotent.
-- =====================================================================

create table if not exists public.le_sollzeit_template (
  id              uuid primary key default gen_random_uuid(),
  valid_from      date not null,
  valid_to        date,
  hours_mo        numeric(4,2) not null default 0,
  hours_di        numeric(4,2) not null default 0,
  hours_mi        numeric(4,2) not null default 0,
  hours_do        numeric(4,2) not null default 0,
  hours_fr        numeric(4,2) not null default 0,
  hours_sa        numeric(4,2) not null default 0,
  hours_so        numeric(4,2) not null default 0,
  vacation_days   numeric(4,1) not null default 25,
  notes           text,
  created_at      timestamptz not null default now()
);

-- Mitarbeiter-Profile werden zu OVERRIDES: NULL an einem Wochentag heisst
-- "vom Zentral-Plan erben (skaliert mit pensum_pct)". Bestehende Zeilen mit
-- expliziten Werten verhalten sich unverändert (Override = derselbe Wert).
alter table public.le_sollzeit_profile alter column hours_mo drop not null;
alter table public.le_sollzeit_profile alter column hours_mo drop default;
alter table public.le_sollzeit_profile alter column hours_di drop not null;
alter table public.le_sollzeit_profile alter column hours_di drop default;
alter table public.le_sollzeit_profile alter column hours_mi drop not null;
alter table public.le_sollzeit_profile alter column hours_mi drop default;
alter table public.le_sollzeit_profile alter column hours_do drop not null;
alter table public.le_sollzeit_profile alter column hours_do drop default;
alter table public.le_sollzeit_profile alter column hours_fr drop not null;
alter table public.le_sollzeit_profile alter column hours_fr drop default;
alter table public.le_sollzeit_profile alter column hours_sa drop not null;
alter table public.le_sollzeit_profile alter column hours_sa drop default;
alter table public.le_sollzeit_profile alter column hours_so drop not null;
alter table public.le_sollzeit_profile alter column hours_so drop default;
alter table public.le_sollzeit_profile alter column vacation_days drop not null;
alter table public.le_sollzeit_profile alter column vacation_days drop default;

alter table public.le_sollzeit_template enable row level security;
drop policy if exists "le_sollzeit_template_read" on public.le_sollzeit_template;
create policy "le_sollzeit_template_read" on public.le_sollzeit_template
  for select to authenticated using (true);
drop policy if exists "le_sollzeit_template_write" on public.le_sollzeit_template;
create policy "le_sollzeit_template_write" on public.le_sollzeit_template
  for all to authenticated using (true) with check (true);
