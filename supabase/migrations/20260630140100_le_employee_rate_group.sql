-- =====================================================================
-- Rolle/Tarifgruppe je Mitarbeiter (Stufe 1 der Gruppenansatz-Kaskade).
-- + le_resolve_rate mit Modus 'auto' (Kaskade). Idempotent.
-- Setzt voraus, dass 20260630140000 (Enum-Wert 'auto') bereits lief.
-- =====================================================================

alter table public.le_employee
  add column if not exists rate_group_id uuid references public.le_rate_group(id) on delete set null;

create or replace function public.le_resolve_rate(
  p_project_id      uuid,
  p_employee_id     uuid,
  p_service_type_id uuid,
  p_date            date default current_date
) returns numeric language plpgsql stable as $$
declare
  proj record;
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

  -- 'auto' = Kaskade: 1) Tarifgruppe/Rolle des MA x Leistungsart
  if proj.rate_mode = 'auto' then
    select rgr.rate into rate
      from public.le_employee e
      join public.le_rate_group_rate rgr on rgr.rate_group_id = e.rate_group_id
      where e.id = p_employee_id
        and rgr.service_type_id = p_service_type_id
        and rgr.valid_from <= p_date
      order by rgr.valid_from desc
      limit 1;
    if rate is not null then return rate; end if;
    -- 2) sonst Mitarbeitergruppe
    select g.billable_rate into rate
      from public.le_employee e
      join public.le_employee_group g on g.id = e.employee_group_id
      where e.id = p_employee_id;
    if rate is not null then return rate; end if;
    -- 3) sonst MA-Stundensatz
    select billable_rate into rate from public.le_employee where id = p_employee_id;
    return coalesce(rate, 0);
  end if;

  -- Default: service_type via Projekt-Tarifgruppe oder service_rate_history
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
