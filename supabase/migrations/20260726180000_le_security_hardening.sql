-- ============================================================================
-- Leistungserfassung: Rollen, RLS und unveraenderbare Abrechnungsdaten
-- ============================================================================
-- Sachbearbeiter duerfen eigene, noch nicht abgerechnete Rapporte/Spesen/
-- Abwesenheiten bearbeiten. Abrechnung, Freigaben und Stammdaten sind
-- Mandatsleitern/Admins vorbehalten.

-- Vor den Mutations-Triggern anlegen, damit es zwischen den beiden
-- Hardening-Migrationen kein Fenster mit noch unbekannten NEW-Feldern gibt.
alter table public.le_invoice
  add column if not exists currency char(3) not null default 'CHF',
  add column if not exists skonto_pct numeric(5,2) not null default 0,
  add column if not exists skonto_days int;

create or replace function public.le_can_manage_billing()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_approve();
$$;

create or replace function public.le_owns_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.le_employee e
     where e.id = p_employee_id
       and e.profile_id = auth.uid()
  );
$$;

grant execute on function public.le_can_manage_billing(), public.le_owns_employee(uuid)
  to authenticated, service_role;

update storage.buckets
   set public = false
 where id in ('invoices', 'expenses');

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'absences', 'absences', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/heic','image/webp']::text[]
)
on conflict (id) do update set public = false;

-- --------------------------------------------------------------------------
-- Stammdaten
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'le_employee', 'le_service_type', 'le_service_rate_history',
    'le_rate_group', 'le_rate_group_rate', 'le_project',
    'le_project_template',
    'le_employee_group', 'le_vat_rate', 'le_sollzeit_profile',
    'le_sollzeit_template', 'le_holiday', 'le_recurring_invoice',
    'le_company_settings', 'le_number_sequence', 'le_customer_terms'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_manage_stammdaten()) with check (public.can_manage_stammdaten())',
      t || '_write', t
    );
  end loop;
end
$$;

-- Storage: Rechnungs-PDFs nur Abrechnungsrollen; Spesenbelege zusaetzlich
-- fuer den Besitzer des zugehoerigen Speseneintrags.
drop policy if exists "le_invoices_storage_read" on storage.objects;
drop policy if exists "invoices_read" on storage.objects;
drop policy if exists "le_invoices_storage_write" on storage.objects;
drop policy if exists "invoices_insert" on storage.objects;
drop policy if exists "invoices_update" on storage.objects;
drop policy if exists "invoices_delete" on storage.objects;
create policy "invoices_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices' and public.le_can_manage_billing());
create policy "invoices_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoices' and public.le_can_manage_billing());
create policy "invoices_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'invoices' and public.le_can_manage_billing())
  with check (bucket_id = 'invoices' and public.le_can_manage_billing());
create policy "invoices_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'invoices' and public.le_can_manage_billing());

drop policy if exists "le_expenses_storage_read" on storage.objects;
drop policy if exists "expenses_read" on storage.objects;
drop policy if exists "le_expenses_storage_write" on storage.objects;
drop policy if exists "expenses_insert" on storage.objects;
drop policy if exists "expenses_update" on storage.objects;
drop policy if exists "expenses_delete" on storage.objects;
create policy "expenses_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expenses'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_expense e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.employee_id)
      )
    )
  );
create policy "expenses_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expenses'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_expense e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.employee_id)
      )
    )
  );
create policy "expenses_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'expenses'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_expense e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.employee_id)
      )
    )
  )
  with check (
    bucket_id = 'expenses'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_expense e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.employee_id)
      )
    )
  );
create policy "expenses_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'expenses'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_expense e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.employee_id)
      )
    )
  );

drop policy if exists "absences_read" on storage.objects;
drop policy if exists "absences_insert" on storage.objects;
drop policy if exists "absences_update" on storage.objects;
drop policy if exists "absences_delete" on storage.objects;
create policy "absences_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'absences'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_employee e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.id)
      )
    )
  );
create policy "absences_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'absences'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_employee e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.id)
      )
    )
  );
create policy "absences_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'absences'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_employee e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.id)
      )
    )
  )
  with check (
    bucket_id = 'absences'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_employee e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.id)
      )
    )
  );
create policy "absences_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'absences'
    and (
      public.le_can_manage_billing()
      or exists (
        select 1
          from public.le_employee e
         where e.id::text = (storage.foldername(name))[2]
           and public.le_owns_employee(e.id)
      )
    )
  );

-- --------------------------------------------------------------------------
-- Rechnungen und Nebenbuecher
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'le_invoice', 'le_invoice_line', 'le_invoice_akonto_link',
    'le_payment', 'le_camt_import', 'le_dunning'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.le_can_manage_billing()) with check (public.le_can_manage_billing())',
      t || '_write', t
    );
  end loop;
end
$$;

-- Zaehler sind ausschliesslich via SECURITY-DEFINER-RPC erreichbar.
drop policy if exists le_number_sequence_write on public.le_number_sequence;
drop policy if exists "le_number_sequence_write" on public.le_number_sequence;
revoke insert, update, delete on public.le_number_sequence from authenticated;
revoke all on public.le_invoice_counter from authenticated;

-- --------------------------------------------------------------------------
-- Rapporte: eigene offene Eintraege oder Abrechnungsrolle
-- --------------------------------------------------------------------------
drop policy if exists le_time_entry_insert_own on public.le_time_entry;
drop policy if exists "le_time_entry_insert_own" on public.le_time_entry;
drop policy if exists le_time_entry_update_own on public.le_time_entry;
drop policy if exists "le_time_entry_update_own" on public.le_time_entry;
drop policy if exists le_time_entry_delete_admin on public.le_time_entry;
drop policy if exists "le_time_entry_delete_admin" on public.le_time_entry;
drop policy if exists le_time_entry_delete_own on public.le_time_entry;
drop policy if exists "le_time_entry_delete_own" on public.le_time_entry;
drop policy if exists le_time_entry_write on public.le_time_entry;
drop policy if exists "le_time_entry_write" on public.le_time_entry;
drop policy if exists le_time_entry_read on public.le_time_entry;
drop policy if exists "le_time_entry_read" on public.le_time_entry;

create policy le_time_entry_read on public.le_time_entry
  for select to authenticated
  using (public.le_can_manage_billing() or public.le_owns_employee(employee_id));

create policy le_time_entry_insert_own on public.le_time_entry
  for insert to authenticated
  with check (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  );

create policy le_time_entry_update_own on public.le_time_entry
  for update to authenticated
  using (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  )
  with check (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  );

create policy le_time_entry_delete_own on public.le_time_entry
  for delete to authenticated
  using (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  );

create or replace function public.le_guard_time_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_billing boolean := public.le_can_manage_billing()
    or coalesce(auth.role(), '') = 'service_role';
  release_allowed boolean :=
    coalesce(current_setting('app.le_billing_release', true), '') = 'on'
    and is_billing;
begin
  if tg_op = 'DELETE' then
    if old.status in ('verrechnet', 'kulant_abgerechnet') then
      raise exception 'Bereits abgerechnete Rapporte koennen nicht geloescht werden';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status in ('verrechnet', 'kulant_abgerechnet') then
    if not release_allowed then
      raise exception 'Bereits abgerechnete Rapporte sind unveraenderbar; zuerst Rechnung stornieren';
    end if;
    if new.invoice_id is not null
       or new.status not in ('erfasst', 'kulant')
       or new.project_id is distinct from old.project_id
       or new.employee_id is distinct from old.employee_id
       or new.service_type_id is distinct from old.service_type_id
       or new.entry_date is distinct from old.entry_date
       or new.hours_internal is distinct from old.hours_internal
       or new.hours_external is distinct from old.hours_external
       or new.rate_snapshot is distinct from old.rate_snapshot
       or new.description is distinct from old.description then
      raise exception 'Beim Storno duerfen nur Rechnungslink und Abrechnungsstatus geloest werden';
    end if;
    return new;
  end if;

  if not is_billing then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.invoice_id := null;
      new.hours_external := null;
      if new.status in ('verrechnet', 'kulant_abgerechnet') then
        raise exception 'Abrechnungsstatus darf nur durch die Fakturierung gesetzt werden';
      end if;
    else
      if new.employee_id is distinct from old.employee_id
         or new.created_by is distinct from old.created_by
         or new.invoice_id is distinct from old.invoice_id
         or new.hours_external is distinct from old.hours_external
         or new.status in ('verrechnet', 'kulant_abgerechnet') then
        raise exception 'Geschuetzte Rapportfelder duerfen nicht geaendert werden';
      end if;
    end if;

    new.rate_snapshot := public.le_resolve_rate(
      new.project_id, new.employee_id, new.service_type_id, new.entry_date
    );
  end if;

  return new;
end
$$;

drop trigger if exists trg_le_time_entry_lock_billed on public.le_time_entry;
drop trigger if exists trg_le_time_entry_guard on public.le_time_entry;
create trigger trg_le_time_entry_guard
  before insert or update or delete on public.le_time_entry
  for each row execute function public.le_guard_time_entry();

-- --------------------------------------------------------------------------
-- Spesen: eigene Entwuerfe/Einreichungen; Freigabe nur durch Vorgesetzte
-- --------------------------------------------------------------------------
drop policy if exists le_expense_write on public.le_expense;
drop policy if exists "le_expense_write" on public.le_expense;
drop policy if exists le_expense_read on public.le_expense;
drop policy if exists "le_expense_read" on public.le_expense;
drop policy if exists le_expense_insert_own on public.le_expense;
drop policy if exists "le_expense_insert_own" on public.le_expense;
drop policy if exists le_expense_update_own on public.le_expense;
drop policy if exists "le_expense_update_own" on public.le_expense;
drop policy if exists le_expense_delete_own on public.le_expense;
drop policy if exists "le_expense_delete_own" on public.le_expense;

create policy le_expense_read on public.le_expense
  for select to authenticated
  using (public.le_can_manage_billing() or public.le_owns_employee(employee_id));

create policy le_expense_insert_own on public.le_expense
  for insert to authenticated
  with check (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  );

create policy le_expense_update_own on public.le_expense
  for update to authenticated
  using (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  )
  with check (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  );

create policy le_expense_delete_own on public.le_expense
  for delete to authenticated
  using (
    public.can_write()
    and (
      public.le_can_manage_billing()
      or (public.le_owns_employee(employee_id) and status in ('entwurf', 'abgelehnt'))
    )
  );

create or replace function public.le_guard_expense_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_billing boolean := public.le_can_manage_billing()
    or coalesce(auth.role(), '') = 'service_role';
begin
  if tg_op = 'INSERT' and not is_billing then
    if new.status not in ('entwurf', 'eingereicht')
       or new.approved_by is not null
       or new.approved_at is not null
       or new.invoiced_invoice_id is not null then
      raise exception 'Spesen duerfen nur als Entwurf oder eingereicht erfasst werden';
    end if;
  elsif tg_op = 'UPDATE' and not is_billing then
    if new.employee_id is distinct from old.employee_id
       or old.status not in ('entwurf', 'abgelehnt')
       or new.status not in ('entwurf', 'eingereicht')
       or new.approved_by is not null
       or new.approved_at is not null
       or new.invoiced_invoice_id is not null then
      raise exception 'Eingereichte/genehmigte Spesen koennen nur durch die Freigabe geaendert werden';
    end if;
  end if;

  if is_billing and tg_op = 'UPDATE'
     and new.status = 'genehmigt' and old.status is distinct from 'genehmigt' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists trg_le_expense_workflow_guard on public.le_expense;
create trigger trg_le_expense_workflow_guard
  before insert or update on public.le_expense
  for each row execute function public.le_guard_expense_workflow();

-- --------------------------------------------------------------------------
-- Abwesenheiten: eigene Antraege; Genehmigung nur durch Vorgesetzte
-- --------------------------------------------------------------------------
drop policy if exists le_absence_write on public.le_absence;
drop policy if exists "le_absence_write" on public.le_absence;
drop policy if exists le_absence_read on public.le_absence;
drop policy if exists "le_absence_read" on public.le_absence;
drop policy if exists le_absence_insert_own on public.le_absence;
drop policy if exists "le_absence_insert_own" on public.le_absence;
drop policy if exists le_absence_update_own on public.le_absence;
drop policy if exists "le_absence_update_own" on public.le_absence;
drop policy if exists le_absence_delete_manager on public.le_absence;
drop policy if exists "le_absence_delete_manager" on public.le_absence;

create policy le_absence_read on public.le_absence
  for select to authenticated
  using (public.le_can_manage_billing() or public.le_owns_employee(employee_id));

create policy le_absence_insert_own on public.le_absence
  for insert to authenticated
  with check (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  );

create policy le_absence_update_own on public.le_absence
  for update to authenticated
  using (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  )
  with check (
    public.can_write()
    and (public.le_can_manage_billing() or public.le_owns_employee(employee_id))
  );

create policy le_absence_delete_manager on public.le_absence
  for delete to authenticated using (public.le_can_manage_billing());

create or replace function public.le_guard_absence_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_billing boolean := public.le_can_manage_billing()
    or coalesce(auth.role(), '') = 'service_role';
begin
  if tg_op = 'INSERT' and not is_billing then
    if new.status <> 'beantragt'
       or new.approved_by is not null
       or new.approved_at is not null then
      raise exception 'Abwesenheiten muessen als Antrag erfasst werden';
    end if;
  elsif tg_op = 'UPDATE' and not is_billing then
    if new.employee_id is distinct from old.employee_id
       or old.status <> 'beantragt'
       or new.status not in ('beantragt', 'storniert')
       or new.approved_by is not null
       or new.approved_at is not null then
      raise exception 'Nur offene eigene Antraege koennen geaendert oder storniert werden';
    end if;
  end if;

  if is_billing and tg_op = 'UPDATE'
     and new.status = 'genehmigt' and old.status is distinct from 'genehmigt' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists trg_le_absence_workflow_guard on public.le_absence;
create trigger trg_le_absence_workflow_guard
  before insert or update on public.le_absence
  for each row execute function public.le_guard_absence_workflow();

-- --------------------------------------------------------------------------
-- Definitive Rechnungen und deren Positionen sind inhaltlich unveraenderbar.
-- Status/PDF/Versand/Zahlung bleiben erlaubt; Finanzwerte nur in RPCs.
-- --------------------------------------------------------------------------
create or replace function public.le_guard_invoice_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.le_billing_write', true), '') <> 'on' then
    if old.status = 'entwurf' and new.status <> 'entwurf' then
      raise exception 'Entwuerfe muessen ueber den Finalisierungs-Workflow abgeschlossen werden';
    end if;
    if new.status in ('bezahlt', 'storniert')
       and new.status is distinct from old.status then
      raise exception 'Bezahlt/Storniert darf nur durch Zahlung oder Storno gesetzt werden';
    end if;
    if old.status = 'storniert' and new.status is distinct from old.status then
      raise exception 'Eine stornierte Rechnung kann nicht reaktiviert werden';
    end if;
  end if;

  if old.status <> 'entwurf'
     and coalesce(current_setting('app.le_billing_write', true), '') <> 'on'
     and (
       new.invoice_no is distinct from old.invoice_no
       or new.customer_id is distinct from old.customer_id
       or new.project_id is distinct from old.project_id
       or new.invoice_type is distinct from old.invoice_type
       or new.parent_invoice_id is distinct from old.parent_invoice_id
       or new.period_from is distinct from old.period_from
       or new.period_to is distinct from old.period_to
       or new.issue_date is distinct from old.issue_date
       or new.due_date is distinct from old.due_date
       or new.subtotal is distinct from old.subtotal
       or new.discount_pct is distinct from old.discount_pct
       or new.discount_amount is distinct from old.discount_amount
       or new.skonto_pct is distinct from old.skonto_pct
       or new.skonto_days is distinct from old.skonto_days
       or new.vat_pct is distinct from old.vat_pct
       or new.vat_amount is distinct from old.vat_amount
       or new.total is distinct from old.total
       or new.currency is distinct from old.currency
       or new.paid_amount is distinct from old.paid_amount
       or new.paid_at is distinct from old.paid_at
       or new.qr_reference is distinct from old.qr_reference
       or new.notes is distinct from old.notes
     ) then
    raise exception 'Definitive Rechnungsinhalte sind unveraenderbar';
  end if;
  return new;
end
$$;

drop trigger if exists trg_le_invoice_mutation_guard on public.le_invoice;
create trigger trg_le_invoice_mutation_guard
  before update on public.le_invoice
  for each row execute function public.le_guard_invoice_mutation();

create or replace function public.le_guard_invoice_line_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_invoice uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  target_status public.le_invoice_status;
begin
  select status into target_status
    from public.le_invoice
   where id = target_invoice;
  if target_status <> 'entwurf'
     and coalesce(current_setting('app.le_billing_write', true), '') <> 'on' then
    raise exception 'Positionen definitiver Rechnungen sind unveraenderbar';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_le_invoice_line_mutation_guard on public.le_invoice_line;
create trigger trg_le_invoice_line_mutation_guard
  before insert or update or delete on public.le_invoice_line
  for each row execute function public.le_guard_invoice_line_mutation();

create or replace function public.le_guard_dunning_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'entwurf' then
      raise exception 'Versendete Mahnungen sind unveraenderbar';
    end if;
    return old;
  end if;
  if old.dunning_no is not null
     and new.dunning_no is distinct from old.dunning_no then
    raise exception 'Eine vergebene Mahnnummer ist unveraenderbar';
  end if;
  if old.status = 'entwurf'
     and new.status = 'versendet'
     and new.dunning_no is null then
    raise exception 'Mahnung muss vor dem Versand eine Nummer erhalten';
  end if;
  if new.status = 'bezahlt'
     and old.status is distinct from 'bezahlt'
     and not exists (
       select 1 from public.le_invoice
        where id = new.invoice_id and status = 'bezahlt'
     ) then
    raise exception 'Zuerst muss die Zahlung auf der Rechnung erfasst werden';
  end if;
  if old.status <> 'entwurf'
     and (
       new.invoice_id is distinct from old.invoice_id
       or new.customer_id is distinct from old.customer_id
       or new.level is distinct from old.level
       or new.dunning_date is distinct from old.dunning_date
       or new.new_due_date is distinct from old.new_due_date
       or new.fee is distinct from old.fee
       or new.interest_rate_pct is distinct from old.interest_rate_pct
       or new.interest_from is distinct from old.interest_from
       or new.interest_amount is distinct from old.interest_amount
       or new.outstanding_amount is distinct from old.outstanding_amount
       or new.total_amount is distinct from old.total_amount
       or new.is_betreibungsandrohung is distinct from old.is_betreibungsandrohung
     ) then
    raise exception 'Versendete Mahnungen sind inhaltlich unveraenderbar';
  end if;
  return new;
end
$$;

drop trigger if exists trg_le_dunning_mutation_guard on public.le_dunning;
create trigger trg_le_dunning_mutation_guard
  before update or delete on public.le_dunning
  for each row execute function public.le_guard_dunning_mutation();

-- Plausibilitaetsregeln und eindeutige externe Referenzen.
alter table public.le_time_entry
  drop constraint if exists le_time_entry_hours_external_nonnegative;
alter table public.le_time_entry
  add constraint le_time_entry_hours_external_nonnegative
  check (hours_external is null or hours_external >= 0);

alter table public.le_payment
  drop constraint if exists le_payment_amount_nonzero;
alter table public.le_payment
  add constraint le_payment_amount_nonzero check (amount <> 0);

create unique index if not exists le_invoice_invoice_no_uidx
  on public.le_invoice(invoice_no) where invoice_no is not null;
create unique index if not exists le_payment_bank_ref_uidx
  on public.le_payment(bank_ref) where bank_ref is not null and btrim(bank_ref) <> '';
create unique index if not exists le_dunning_dunning_no_uidx
  on public.le_dunning(dunning_no) where dunning_no is not null;

revoke all on function public.le_guard_time_entry() from public;
revoke all on function public.le_guard_expense_workflow() from public;
revoke all on function public.le_guard_absence_workflow() from public;
revoke all on function public.le_guard_dunning_mutation() from public;
