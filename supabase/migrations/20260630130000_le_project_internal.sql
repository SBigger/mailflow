-- =====================================================================
-- Interne Projekte + Regel: interne Leistungsarten (le_service_type.billable
-- = false) dürfen nur auf internen Projekten (le_project.is_internal = true)
-- erfasst werden. DB-Trigger erzwingt das für ALLE Erfassungswege.
-- Idempotent.
-- =====================================================================

alter table public.le_project
  add column if not exists is_internal boolean not null default false;

create or replace function public.le_check_internal_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_billable boolean;
  v_internal boolean;
begin
  select billable into v_billable from public.le_service_type where id = new.service_type_id;
  select is_internal into v_internal from public.le_project where id = new.project_id;
  if v_billable = false and coalesce(v_internal, false) = false then
    raise exception 'Interne Leistungsart darf nur auf internen Projekten erfasst werden.';
  end if;
  return new;
end $$;

drop trigger if exists trg_le_internal_service on public.le_time_entry;
create trigger trg_le_internal_service
  before insert or update on public.le_time_entry
  for each row execute function public.le_check_internal_service();
