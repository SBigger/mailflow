-- =====================================================================
-- Leistungserfassung · Ansatz-Findung pro Projekt
-- =====================================================================
-- Bisher: Ansatz nur über Leistungsart × Rate-Group.
-- Neu: pro Projekt konfigurierbar:
--   service_type   → bisherige Logik (Default)
--   employee       → Stundenansatz vom Mitarbeiter selbst
--   employee_group → Stundenansatz aus Mitarbeitergruppe (Junior/Treuhänder/Partner)
--   special        → Festsatz auf dem Projekt
-- =====================================================================

-- 1) Mitarbeitergruppen (für rate_mode='employee_group')
create table if not exists public.le_employee_group (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,                       -- z.B. "Junior", "Treuhänder", "Partner"
  description   text,
  billable_rate numeric(10,2),                              -- CHF/h
  cost_rate     numeric(10,2),                              -- interner Kostensatz CHF/h
  sort_order    int not null default 100,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_le_employee_group_updated on public.le_employee_group;
create trigger trg_le_employee_group_updated before update on public.le_employee_group
  for each row execute function public.le_set_updated_at();

alter table public.le_employee_group enable row level security;

drop policy if exists "le_employee_group_read" on public.le_employee_group;
create policy "le_employee_group_read" on public.le_employee_group
  for select to authenticated using (true);

drop policy if exists "le_employee_group_write" on public.le_employee_group;
create policy "le_employee_group_write" on public.le_employee_group
  for all to authenticated using (true) with check (true);

-- Default-Gruppen
insert into public.le_employee_group (name, billable_rate, cost_rate, sort_order, description) values
  ('Junior',     145.00,  60.00, 10, 'Sachbearbeiter / Lernende'),
  ('Treuhänder', 220.00, 100.00, 20, 'Treuhänder mit Berufserfahrung'),
  ('Senior',     260.00, 130.00, 30, 'Senior Treuhänder / Spezialist'),
  ('Partner',    300.00, 150.00, 40, 'Partner / Geschäftsführung')
on conflict (name) do nothing;

-- 2) le_employee · billable_rate + employee_group_id
alter table public.le_employee
  add column if not exists billable_rate numeric(10,2),                                   -- individueller Stundenansatz
  add column if not exists employee_group_id uuid references public.le_employee_group(id) on delete set null;

create index if not exists idx_le_employee_group on public.le_employee(employee_group_id);

-- 3) le_project · rate_mode + special_rate
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_rate_mode') then
    create type le_rate_mode as enum ('service_type', 'employee', 'employee_group', 'special');
  end if;
end $$;

alter table public.le_project
  add column if not exists rate_mode le_rate_mode not null default 'service_type',
  add column if not exists special_rate numeric(10,2);                                    -- nur relevant bei rate_mode='special'

-- =====================================================================
-- Hilfs-Funktion: Resolver in SQL (für Reports / Backend-Verwendung)
-- =====================================================================
create or replace function public.le_resolve_rate(
  p_project_id    uuid,
  p_employee_id   uuid,
  p_service_type_id uuid,
  p_date          date default current_date
) returns numeric language plpgsql stable as $$
declare
  proj record;
  emp record;
  grp record;
  rate numeric;
begin
  select rate_mode, special_rate, rate_group_id into proj
    from public.le_project where id = p_project_id;

  if proj is null then return 0; end if;

  if proj.rate_mode = 'special' then
    return coalesce(proj.special_rate, 0);
  end if;

  if proj.rate_mode = 'employee' then
    select billable_rate into rate from public.le_employee where id = p_employee_id;
    return coalesce(rate, 0);
  end if;

  if proj.rate_mode = 'employee_group' then
    select g.billable_rate into rate
      from public.le_employee e
      join public.le_employee_group g on g.id = e.employee_group_id
      where e.id = p_employee_id;
    return coalesce(rate, 0);
  end if;

  -- Default: service_type via rate_group oder service_rate_history
  if proj.rate_group_id is not null then
    select rgr.rate into rate
      from public.le_rate_group_rate rgr
      where rgr.rate_group_id = proj.rate_group_id
        and rgr.service_type_id = p_service_type_id
        and rgr.valid_from <= p_date
      order by rgr.valid_from desc
      limit 1;
    if rate is not null then return rate; end if;
  end if;

  select srh.rate into rate
    from public.le_service_rate_history srh
    where srh.service_type_id = p_service_type_id
      and srh.valid_from <= p_date
    order by srh.valid_from desc
    limit 1;
  return coalesce(rate, 0);
end $$;
