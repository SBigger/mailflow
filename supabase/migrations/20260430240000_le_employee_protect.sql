-- =====================================================================
-- Leistungserfassung · Mitarbeiter-Schutz
-- =====================================================================
-- Mitarbeiter mit Rapporten/Spesen/Abwesenheiten dürfen NICHT gelöscht werden.
-- Wir blockieren das per Trigger BEFORE DELETE mit klarer Fehlermeldung.
-- Inaktivieren / Archivieren bleibt jederzeit möglich (active=false / exit_date).
-- =====================================================================

create or replace function public.le_block_employee_delete_if_referenced()
returns trigger language plpgsql as $$
declare
  cnt_entries int;
  cnt_expenses int;
  cnt_absences int;
begin
  select count(*) into cnt_entries  from public.le_time_entry where employee_id = old.id;
  select count(*) into cnt_expenses from public.le_expense    where employee_id = old.id;
  select count(*) into cnt_absences from public.le_absence    where employee_id = old.id;

  if (cnt_entries + cnt_expenses + cnt_absences) > 0 then
    raise exception 'Mitarbeiter "%" kann nicht gelöscht werden: % Rapport(e), % Spesen, % Abwesenheit(en) sind verknüpft. Bitte stattdessen inaktivieren oder archivieren (active=false).',
      old.full_name, cnt_entries, cnt_expenses, cnt_absences
      using errcode = '23P01';  -- "exclusion_violation" – wir nutzen dies als generischen "blocked"-Code
  end if;

  return old;
end $$;

drop trigger if exists trg_le_employee_protect_delete on public.le_employee;
create trigger trg_le_employee_protect_delete
  before delete on public.le_employee
  for each row execute function public.le_block_employee_delete_if_referenced();

-- =====================================================================
-- Hilfs-View: kann ein MA gelöscht werden? (für UI-Vorab-Check)
-- =====================================================================
create or replace function public.le_employee_can_delete(p_employee_id uuid)
returns table (
  can_delete boolean,
  entry_count int,
  expense_count int,
  absence_count int
) language plpgsql stable security definer as $$
declare
  c_e int;
  c_x int;
  c_a int;
begin
  select count(*) into c_e from public.le_time_entry where employee_id = p_employee_id;
  select count(*) into c_x from public.le_expense    where employee_id = p_employee_id;
  select count(*) into c_a from public.le_absence    where employee_id = p_employee_id;
  return query select (c_e + c_x + c_a) = 0, c_e, c_x, c_a;
end $$;

-- =====================================================================
-- Hint: archived_at column als optionaler Archiv-Marker
-- =====================================================================
alter table public.le_employee
  add column if not exists archived_at timestamptz;

-- Index für schnelle "aktiv"-Filter
create index if not exists idx_le_employee_active_archived
  on public.le_employee(active, archived_at);
