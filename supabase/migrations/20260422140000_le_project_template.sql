-- =====================================================================
-- Leistungserfassung · Projekt-Vorlagen
-- =====================================================================
create table if not exists public.le_project_template (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  description     text,
  name_suffix     text,                                          -- z.B. ", BWL"
  billing_mode    le_project_billing_mode not null default 'effektiv',
  pauschal_amount numeric(12,2),
  pauschal_cycle  text,
  rate_group_id   uuid references public.le_rate_group(id) on delete set null,
  budget_hours    numeric(10,2),
  budget_amount   numeric(12,2),
  default_notes   text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_le_project_template_updated on public.le_project_template;
create trigger trg_le_project_template_updated before update on public.le_project_template
  for each row execute function public.le_set_updated_at();

alter table public.le_project_template enable row level security;

drop policy if exists "le_project_template_read" on public.le_project_template;
create policy "le_project_template_read" on public.le_project_template
  for select to authenticated using (true);

drop policy if exists "le_project_template_write" on public.le_project_template;
create policy "le_project_template_write" on public.le_project_template
  for all to authenticated using (true) with check (true);

-- Default-Vorlagen
insert into public.le_project_template (name, name_suffix, billing_mode, default_notes) values
  ('BWL-Standard',     ', BWL',      'effektiv',  'Laufende Buchführung, Quartals-Reporting'),
  ('Steuern-Standard', ', Steuern',  'effektiv',  'Steuererklärung Privatperson / Juristische Person'),
  ('Revision-Mandat',  ', Revision', 'pauschal',  'Eingeschränkte Revision'),
  ('Lohn-Mandat',      ', Lohn',     'pauschal',  'Monatliche Lohnverarbeitung')
on conflict (name) do nothing;
