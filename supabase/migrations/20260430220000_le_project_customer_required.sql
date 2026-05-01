-- =====================================================================
-- Leistungserfassung · Projekt MUSS Kunde haben
-- =====================================================================
-- Jedes le_project ist zwingend einem customer aus dem CRM zugeordnet.
-- =====================================================================

-- Sicherheits-Check: gibt es Projekte ohne customer_id?
do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.le_project where customer_id is null;
  if cnt > 0 then
    raise notice 'WARNUNG: % Projekt(e) ohne customer_id – diese müssen zugewiesen oder gelöscht werden', cnt;
    raise exception 'Migration abgebrochen: % Projekt(e) ohne Kunde. Bitte erst alle Projekte einem Kunden zuweisen.', cnt;
  end if;
end $$;

-- ON DELETE: bei Löschung des Customers darf das Projekt NICHT verschwinden.
-- Statt SET NULL → RESTRICT. Falls jemand einen Kunden löschen will, muss er
-- vorher die Projekte umzuhängen oder löschen.
alter table public.le_project
  drop constraint if exists le_project_customer_id_fkey;

alter table public.le_project
  add constraint le_project_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete restrict;

-- NOT NULL erzwingen
alter table public.le_project
  alter column customer_id set not null;
