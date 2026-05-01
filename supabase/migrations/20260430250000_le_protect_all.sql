-- =====================================================================
-- Leistungserfassung · Datenschutz für alle Stammdaten
-- =====================================================================
-- Niemand darf jemals Stunden / Rapporte / Spesen / Rechnungen verlieren.
-- Daher Trigger BEFORE DELETE auf:
--   - le_project          (referenziert von le_time_entry, le_invoice, le_recurring_invoice)
--   - le_service_type     (referenziert von le_time_entry, le_invoice_line, le_rate_group_rate, …)
--   - le_rate_group       (referenziert von le_project, le_rate_group_rate)
--   - le_employee_group   (referenziert von le_employee)
--   - customers           (referenziert von le_project, le_invoice, le_payment, le_dunning, le_recurring_invoice, le_expense)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) le_project · darf nicht weg wenn Stunden/Rechnungen/Wiederkehrende dranhängen
-- ---------------------------------------------------------------------
create or replace function public.le_block_project_delete_if_referenced()
returns trigger language plpgsql as $$
declare
  c_entries int;
  c_invoices int;
  c_recurring int;
  c_expenses int;
begin
  select count(*) into c_entries   from public.le_time_entry        where project_id = old.id;
  select count(*) into c_invoices  from public.le_invoice           where project_id = old.id;
  select count(*) into c_recurring from public.le_recurring_invoice where project_id = old.id;
  select count(*) into c_expenses  from public.le_expense           where project_id = old.id;

  if (c_entries + c_invoices + c_recurring + c_expenses) > 0 then
    raise exception 'Projekt "%" kann nicht gelöscht werden: % Rapport(e), % Rechnung(en), % Wiederkehrende, % Spesen verknüpft. Bitte stattdessen archivieren (status=''archiviert'').',
      old.name, c_entries, c_invoices, c_recurring, c_expenses;
  end if;
  return old;
end $$;

drop trigger if exists trg_le_project_protect_delete on public.le_project;
create trigger trg_le_project_protect_delete
  before delete on public.le_project
  for each row execute function public.le_block_project_delete_if_referenced();

create or replace function public.le_project_can_delete(p_project_id uuid)
returns table (can_delete boolean, entry_count int, invoice_count int, recurring_count int, expense_count int)
language plpgsql stable security definer as $$
declare ce int; ci int; cr int; cx int;
begin
  select count(*) into ce from public.le_time_entry        where project_id = p_project_id;
  select count(*) into ci from public.le_invoice           where project_id = p_project_id;
  select count(*) into cr from public.le_recurring_invoice where project_id = p_project_id;
  select count(*) into cx from public.le_expense           where project_id = p_project_id;
  return query select (ce + ci + cr + cx) = 0, ce, ci, cr, cx;
end $$;

-- ---------------------------------------------------------------------
-- 2) le_service_type · darf nicht weg wenn Rapporte oder Rechnungspositionen dranhängen
-- ---------------------------------------------------------------------
create or replace function public.le_block_service_type_delete_if_referenced()
returns trigger language plpgsql as $$
declare
  c_entries int;
  c_lines int;
  c_rates int;
  c_history int;
begin
  select count(*) into c_entries from public.le_time_entry          where service_type_id = old.id;
  select count(*) into c_lines   from public.le_invoice_line        where service_type_id = old.id;
  select count(*) into c_rates   from public.le_rate_group_rate     where service_type_id = old.id;
  select count(*) into c_history from public.le_service_rate_history where service_type_id = old.id;

  if (c_entries + c_lines + c_rates + c_history) > 0 then
    raise exception 'Leistungsart "%" kann nicht gelöscht werden: % Rapport(e), % Rechnungsposition(en), % Gruppen-Sätze, % Satz-Historie verknüpft. Bitte stattdessen deaktivieren (active=false).',
      old.name, c_entries, c_lines, c_rates, c_history;
  end if;
  return old;
end $$;

drop trigger if exists trg_le_service_type_protect_delete on public.le_service_type;
create trigger trg_le_service_type_protect_delete
  before delete on public.le_service_type
  for each row execute function public.le_block_service_type_delete_if_referenced();

create or replace function public.le_service_type_can_delete(p_id uuid)
returns table (can_delete boolean, entry_count int, line_count int, rate_count int, history_count int)
language plpgsql stable security definer as $$
declare ce int; cl int; cr int; ch int;
begin
  select count(*) into ce from public.le_time_entry          where service_type_id = p_id;
  select count(*) into cl from public.le_invoice_line        where service_type_id = p_id;
  select count(*) into cr from public.le_rate_group_rate     where service_type_id = p_id;
  select count(*) into ch from public.le_service_rate_history where service_type_id = p_id;
  return query select (ce + cl + cr + ch) = 0, ce, cl, cr, ch;
end $$;

-- ---------------------------------------------------------------------
-- 3) le_rate_group · darf nicht weg wenn Projekte zugewiesen sind
-- ---------------------------------------------------------------------
create or replace function public.le_block_rate_group_delete_if_referenced()
returns trigger language plpgsql as $$
declare c_proj int;
begin
  select count(*) into c_proj from public.le_project where rate_group_id = old.id;
  if c_proj > 0 then
    raise exception 'Gruppenansatz "%" kann nicht gelöscht werden: % Projekt(e) nutzen ihn. Bitte stattdessen deaktivieren (active=false).', old.name, c_proj;
  end if;
  return old;
end $$;

drop trigger if exists trg_le_rate_group_protect_delete on public.le_rate_group;
create trigger trg_le_rate_group_protect_delete
  before delete on public.le_rate_group
  for each row execute function public.le_block_rate_group_delete_if_referenced();

-- ---------------------------------------------------------------------
-- 4) le_employee_group · darf nicht weg wenn Mitarbeiter zugewiesen sind
-- ---------------------------------------------------------------------
create or replace function public.le_block_employee_group_delete_if_referenced()
returns trigger language plpgsql as $$
declare c_emp int;
begin
  select count(*) into c_emp from public.le_employee where employee_group_id = old.id;
  if c_emp > 0 then
    raise exception 'Mitarbeitergruppe "%" kann nicht gelöscht werden: % Mitarbeiter sind zugewiesen.', old.name, c_emp;
  end if;
  return old;
end $$;

drop trigger if exists trg_le_employee_group_protect_delete on public.le_employee_group;
create trigger trg_le_employee_group_protect_delete
  before delete on public.le_employee_group
  for each row execute function public.le_block_employee_group_delete_if_referenced();

-- ---------------------------------------------------------------------
-- 5) customers · darf nicht weg wenn LE-Daten dranhängen
--    Bestehende ON DELETE-Behaviour:
--      - le_project.customer_id ON DELETE RESTRICT (durch frühere Migration)
--      - le_invoice.customer_id ON DELETE SET NULL
--      - le_payment.customer_id ON DELETE SET NULL
--      - le_dunning.customer_id ON DELETE SET NULL
--      - le_recurring_invoice.customer_id ON DELETE SET NULL
--    → ohne Trigger würden Rechnungen/Mahnungen/Zahlungen einfach den Kunden verlieren.
--    Wir blockieren das explizit, damit nichts „verwaist" werden kann.
-- ---------------------------------------------------------------------
create or replace function public.le_block_customer_delete_if_referenced()
returns trigger language plpgsql as $$
declare
  c_proj int;
  c_inv int;
  c_pay int;
  c_dun int;
  c_rec int;
  c_exp int;
begin
  select count(*) into c_proj from public.le_project           where customer_id = old.id;
  select count(*) into c_inv  from public.le_invoice           where customer_id = old.id;
  select count(*) into c_pay  from public.le_payment           where customer_id = old.id;
  select count(*) into c_dun  from public.le_dunning           where customer_id = old.id;
  select count(*) into c_rec  from public.le_recurring_invoice where customer_id = old.id;
  select count(*) into c_exp  from public.le_expense           where customer_id = old.id;

  if (c_proj + c_inv + c_pay + c_dun + c_rec + c_exp) > 0 then
    raise exception 'Kunde "%" kann nicht gelöscht werden: % Projekt(e), % Rechnung(en), % Zahlung(en), % Mahnung(en), % Wiederkehrende, % Spesen verknüpft. Bitte stattdessen den Kunden im CRM auf "inaktiv" setzen.',
      coalesce(old.company_name, old.id::text), c_proj, c_inv, c_pay, c_dun, c_rec, c_exp;
  end if;
  return old;
end $$;

drop trigger if exists trg_customers_protect_delete_le on public.customers;
create trigger trg_customers_protect_delete_le
  before delete on public.customers
  for each row execute function public.le_block_customer_delete_if_referenced();

create or replace function public.le_customer_can_delete(p_customer_id uuid)
returns table (
  can_delete boolean,
  project_count int, invoice_count int, payment_count int,
  dunning_count int, recurring_count int, expense_count int
)
language plpgsql stable security definer as $$
declare cp int; ci int; cy int; cd int; cr int; cx int;
begin
  select count(*) into cp from public.le_project           where customer_id = p_customer_id;
  select count(*) into ci from public.le_invoice           where customer_id = p_customer_id;
  select count(*) into cy from public.le_payment           where customer_id = p_customer_id;
  select count(*) into cd from public.le_dunning           where customer_id = p_customer_id;
  select count(*) into cr from public.le_recurring_invoice where customer_id = p_customer_id;
  select count(*) into cx from public.le_expense           where customer_id = p_customer_id;
  return query select (cp + ci + cy + cd + cr + cx) = 0, cp, ci, cy, cd, cr, cx;
end $$;
