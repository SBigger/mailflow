import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = (name) =>
  readFile(path.join(root, 'supabase', 'migrations', name), 'utf8');

const leMigrations = [
  '20260421000001_le_core_schema.sql',
  '20260421000002_le_seed_defaults.sql',
  '20260421000003_le_invoice_schema.sql',
  '20260422120000_le_full_extensions.sql',
  '20260422140000_le_project_template.sql',
  '20260430230000_le_rate_modes.sql',
  '20260502120000_le_status_kulant.sql',
  '20260502130000_le_vat_rates.sql',
  '20260617140000_le_atomic_invoice_no.sql',
  '20260617150000_le_invoice_line_akonto_ref.sql',
  '20260630120000_le_project_billing_email.sql',
  '20260630130000_le_project_internal.sql',
  '20260630140000_le_rate_mode_employee_rate_group.sql',
  '20260630140100_le_employee_rate_group.sql',
  '20260704160000_le_service_type_ertragskonto.sql',
  '20260704210000_le_time_entry_hours_external.sql',
  '20260704220000_le_sollzeit_template_holiday.sql',
  '20260705140000_le_next_credit_no.sql',
  '20260726180000_le_security_hardening.sql',
  '20260726181000_le_billing_transactions.sql',
];

const bootstrapSql = `
  create role authenticated;
  create role service_role;
  create role anon;

  create schema auth;
  create table auth.test_session (
    id boolean primary key default true,
    user_id uuid,
    jwt_role text not null default 'authenticated'
  );
  insert into auth.test_session (id) values (true);
  create function auth.uid() returns uuid language sql stable as
    'select user_id from auth.test_session where id = true';
  create function auth.role() returns text language sql stable as
    'select jwt_role from auth.test_session where id = true';

  create table public.profiles (
    id uuid primary key,
    role text not null,
    is_admin boolean not null default false
  );
  create table public.customers (
    id uuid primary key default gen_random_uuid(),
    company_name text,
    street text,
    building_number text,
    zip text,
    city text,
    country char(2) default 'CH',
    billing_email text
  );

  create function public.app_role() returns text
    language sql stable security definer set search_path = public as
    'select role from profiles where id = auth.uid()';
  create function public.is_admin() returns boolean
    language sql stable security definer set search_path = public as
    'select coalesce((select role = ''admin'' from profiles where id = auth.uid()), false)';
  create function public.can_approve() returns boolean
    language sql stable security definer set search_path = public as
    'select coalesce((select role in (''admin'',''mandatsleiter'') from profiles where id = auth.uid()), false)';
  create function public.can_manage_stammdaten() returns boolean
    language sql stable security definer set search_path = public as
    'select coalesce((select role in (''admin'',''mandatsleiter'') from profiles where id = auth.uid()), false)';
  create function public.can_write() returns boolean
    language sql stable security definer set search_path = public as
    'select coalesce((select role in (''admin'',''mandatsleiter'',''sachbearbeiter'') from profiles where id = auth.uid()), false)';

  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null default '',
    file_size_limit bigint,
    allowed_mime_types text[],
    public boolean not null default false
  );
  insert into storage.buckets (id, public) values ('invoices', true), ('expenses', false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null,
    name text not null
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[]
    language sql immutable as
    'select string_to_array(name, ''/'')';
`;

async function createDatabase() {
  const db = new PGlite();
  await db.exec(bootstrapSql);
  for (const name of leMigrations) {
    const sql = await migration(name);
    try {
      await db.exec(sql);
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  await db.exec(`
    grant usage on schema auth, storage to authenticated;
    grant select on auth.test_session to authenticated;
    grant select on public.le_time_entry, public.le_expense, public.le_absence,
      public.le_employee,
      public.le_invoice, public.le_invoice_line, public.le_invoice_akonto_link,
      public.le_payment, public.le_camt_import, public.le_dunning,
      public.le_number_sequence to authenticated;
    grant select on storage.objects to authenticated;
  `);
  return db;
}

async function one(db, sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0];
}

test('LE migrations apply on PostgreSQL and billing lifecycle stays atomic', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const managerId = '10000000-0000-0000-0000-000000000001';
  const employeeId = '20000000-0000-0000-0000-000000000001';
  const customerId = '30000000-0000-0000-0000-000000000001';
  const projectId = '40000000-0000-0000-0000-000000000001';

  await db.query(
    `insert into profiles (id, role, is_admin) values ($1, 'mandatsleiter', false)`,
    [managerId],
  );
  await db.query(`update auth.test_session set user_id = $1 where id = true`, [managerId]);
  await db.query(
    `insert into customers (id, company_name, billing_email)
     values ($1, 'Test AG', 'rechnung@test.invalid')`,
    [customerId],
  );
  await db.query(
    `insert into le_employee (id, profile_id, short_code, full_name, active)
     values ($1, $2, 'TM', 'Test Manager', true)`,
    [employeeId, managerId],
  );
  await db.query(
    `insert into le_project (
       id, project_no, name, customer_id, billing_mode, status, rate_mode
     ) values ($1, 'P-TEST', 'Testprojekt', $2, 'effektiv', 'offen', 'service_type')`,
    [projectId, customerId],
  );
  await db.query(
    `insert into le_customer_terms (
       customer_id, discount_pct, payment_terms_days, currency, vat_required, vat_mode
     ) values ($1, 10, 14, 'CHF', true, 'inland')`,
    [customerId],
  );

  const service = await one(
    db,
    `select id from le_service_type where code = 'BUCH'`,
  );
  const entryA = '50000000-0000-0000-0000-000000000001';
  const entryB = '50000000-0000-0000-0000-000000000002';
  await db.query(
    `insert into le_time_entry (
       id, project_id, employee_id, service_type_id, entry_date,
       hours_internal, rate_snapshot, description, status, created_by
     ) values
       ($1,$3,$4,$5,'2026-07-01',2,145,'Buchhaltung Juni','freigegeben',$6),
       ($2,$3,$4,$5,'2026-07-02',1,145,'Abschluss Juni','freigegeben',$6)`,
    [entryA, entryB, projectId, employeeId, service.id, managerId],
  );

  const created = await db.query(
    `select * from le_create_invoice_drafts(
       array[$1,$2]::uuid[], array[$3]::uuid[],
       '2026-07-01', '2026-07-31', false, true, false
     )`,
    [entryA, entryB, projectId],
  );
  assert.equal(created.rows.length, 1);
  const invoiceId = created.rows[0].id;
  assert.equal(Number(created.rows[0].subtotal), 391.5);
  assert.equal(Number(created.rows[0].vat_amount), 31.71);
  assert.equal(Number(created.rows[0].total), 423.21);

  const linked = await db.query(
    `select status, invoice_id from le_time_entry where id in ($1,$2) order by id`,
    [entryA, entryB],
  );
  assert.deepEqual(linked.rows.map((row) => row.status), ['verrechnet', 'verrechnet']);
  assert.ok(linked.rows.every((row) => row.invoice_id === invoiceId));

  const invoiceSequence = await one(
    db,
    `select id from le_number_sequence where kind = 'invoice'`,
  );
  await one(
    db,
    `select * from le_update_number_sequence_settings($1, 'INV-{YY}-{NNNN}', 5, false)`,
    [invoiceSequence.id],
  );
  const finalized1 = await one(db, `select * from le_finalize_invoice($1)`, [invoiceId]);
  const finalized2 = await one(db, `select * from le_finalize_invoice($1)`, [invoiceId]);
  assert.equal(finalized1.invoice_no, finalized2.invoice_no);
  assert.match(finalized1.invoice_no, /^INV-\d{2}-00001$/);
  assert.equal(finalized1.status, 'definitiv');
  assert.equal(new Date(finalized1.due_date).toISOString().slice(0, 10), '2026-08-09');
  assert.equal(finalized1.qr_reference.length, 27);

  await assert.rejects(
    db.query(`update le_time_entry set hours_internal = 99 where id = $1`, [entryA]),
    /unveraenderbar|abgerechnete Rapporte/i,
  );
  await assert.rejects(
    db.query(`update le_invoice set status = 'bezahlt' where id = $1`, [invoiceId]),
    /nur durch Zahlung|Bezahlt\/Storniert/i,
  );

  const paymentId = '60000000-0000-0000-0000-000000000001';
  await db.query(
    `insert into le_payment (id, invoice_id, customer_id, amount, paid_at)
     values ($1,$2,$3,423.21,'2026-07-27')`,
    [paymentId, invoiceId, customerId],
  );
  const paid = await one(db, `select status, paid_amount from le_invoice where id = $1`, [invoiceId]);
  assert.equal(paid.status, 'bezahlt');
  assert.equal(Number(paid.paid_amount), 423.21);

  await db.query(`delete from le_payment where id = $1`, [paymentId]);
  const reopened = await one(db, `select status, paid_amount from le_invoice where id = $1`, [invoiceId]);
  assert.equal(reopened.status, 'definitiv');
  assert.equal(Number(reopened.paid_amount), 0);
  await assert.rejects(
    db.query(`delete from le_invoice where id = $1`, [invoiceId]),
    /fachlichen Loesch|Storno-Workflow/i,
  );
});

test('full credit is atomic, preserves VAT snapshots and releases reports', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const managerId = '11000000-0000-0000-0000-000000000001';
  const employeeId = '21000000-0000-0000-0000-000000000001';
  const customerId = '31000000-0000-0000-0000-000000000001';
  const projectId = '41000000-0000-0000-0000-000000000001';
  await db.query(
    `insert into profiles (id, role) values ($1, 'admin')`,
    [managerId],
  );
  await db.query(`update auth.test_session set user_id = $1 where id = true`, [managerId]);
  await db.query(
    `insert into customers (id, company_name) values ($1, 'Credit AG')`,
    [customerId],
  );
  await db.query(
    `insert into le_employee (id, profile_id, short_code, full_name)
     values ($1,$2,'CA','Credit Admin')`,
    [employeeId, managerId],
  );
  await db.query(
    `insert into le_project (id, project_no, name, customer_id, rate_mode)
     values ($1,'P-CREDIT','Credit Project',$2,'service_type')`,
    [projectId, customerId],
  );
  const service = await one(db, `select id from le_service_type where code = 'BUCH'`);
  const entryId = '51000000-0000-0000-0000-000000000001';
  await db.query(
    `insert into le_time_entry (
       id, project_id, employee_id, service_type_id, entry_date,
       hours_internal, rate_snapshot, description, status
     ) values ($1,$2,$3,$4,'2026-07-01',2,145,'Credit Test','freigegeben')`,
    [entryId, projectId, employeeId, service.id],
  );
  const created = await one(
    db,
    `select * from le_create_invoice_drafts(
       array[$1]::uuid[], array[$2]::uuid[], null, null, true, true, false
     )`,
    [entryId, projectId],
  );
  await db.query(
    `update le_invoice set status = 'versendet', sent_at = now() where id = $1`,
    [created.id],
  );
  const credit = await one(
    db,
    `select * from le_create_credit($1, 'Vollstorno', null)`,
    [created.id],
  );
  assert.equal(credit.invoice_type, 'gutschrift');
  assert.equal(Number(credit.total), -Number(created.total));

  const original = await one(db, `select status from le_invoice where id = $1`, [created.id]);
  const released = await one(
    db,
    `select status, invoice_id from le_time_entry where id = $1`,
    [entryId],
  );
  assert.equal(original.status, 'storniert');
  assert.equal(released.status, 'erfasst');
  assert.equal(released.invoice_id, null);

  const vatSnapshot = await one(
    db,
    `select vat_code, vat_pct from le_invoice_line where invoice_id = $1`,
    [credit.id],
  );
  assert.equal(vatSnapshot.vat_code, 'STD');
  assert.equal(Number(vatSnapshot.vat_pct), 8.1);
});

test('employee workflow guards reject self-approval and protected billing fields', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const workerProfileId = '12000000-0000-0000-0000-000000000001';
  const workerEmployeeId = '22000000-0000-0000-0000-000000000001';
  const customerId = '32000000-0000-0000-0000-000000000001';
  const projectId = '42000000-0000-0000-0000-000000000001';
  const entryId = '52000000-0000-0000-0000-000000000001';

  await db.query(
    `insert into profiles (id, role) values ($1, 'sachbearbeiter')`,
    [workerProfileId],
  );
  await db.query(
    `insert into customers (id, company_name) values ($1, 'Worker AG')`,
    [customerId],
  );
  await db.query(
    `insert into le_employee (id, profile_id, short_code, full_name)
     values ($1,$2,'WK','Worker')`,
    [workerEmployeeId, workerProfileId],
  );
  await db.query(
    `insert into le_project (id, project_no, name, customer_id, rate_mode)
     values ($1,'P-WORKER','Worker Project',$2,'service_type')`,
    [projectId, customerId],
  );
  await db.query(
    `update auth.test_session set user_id = $1 where id = true`,
    [workerProfileId],
  );
  const service = await one(db, `select id from le_service_type where code = 'BUCH'`);

  await db.query(
    `insert into le_time_entry (
       id, project_id, employee_id, service_type_id, entry_date,
       hours_internal, rate_snapshot, description, status
     ) values ($1,$2,$3,$4,'2026-07-20',1,999,'Eigener Rapport','erfasst')`,
    [entryId, projectId, workerEmployeeId, service.id],
  );
  const entry = await one(
    db,
    `select rate_snapshot, invoice_id, hours_external from le_time_entry where id = $1`,
    [entryId],
  );
  assert.equal(Number(entry.rate_snapshot), 145);
  assert.equal(entry.invoice_id, null);
  assert.equal(entry.hours_external, null);

  await assert.rejects(
    db.query(
      `update le_time_entry
          set status = 'verrechnet', invoice_id = gen_random_uuid()
        where id = $1`,
      [entryId],
    ),
    /Geschuetzte Rapportfelder|Abrechnungsstatus/i,
  );

  await assert.rejects(
    db.query(
      `insert into le_expense (
         employee_id, expense_date, category, description, amount_gross, status
       ) values ($1,'2026-07-20','material','Test',10,'genehmigt')`,
      [workerEmployeeId],
    ),
    /Entwurf oder eingereicht/i,
  );

  await assert.rejects(
    db.query(
      `insert into le_absence (
         employee_id, category, date_from, date_to, status
       ) values ($1,'ferien','2026-08-03','2026-08-03','genehmigt')`,
      [workerEmployeeId],
    ),
    /als Antrag/i,
  );
});

test('RLS hides other employees and all billing data from ordinary employees', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const managerProfileId = '15000000-0000-0000-0000-000000000001';
  const workerProfileId = '15000000-0000-0000-0000-000000000002';
  const otherProfileId = '15000000-0000-0000-0000-000000000003';
  const managerEmployeeId = '25000000-0000-0000-0000-000000000001';
  const workerEmployeeId = '25000000-0000-0000-0000-000000000002';
  const otherEmployeeId = '25000000-0000-0000-0000-000000000003';
  const customerId = '35000000-0000-0000-0000-000000000001';
  const projectId = '45000000-0000-0000-0000-000000000001';

  await db.query(
    `insert into profiles (id, role) values
       ($1,'admin'), ($2,'sachbearbeiter'), ($3,'sachbearbeiter')`,
    [managerProfileId, workerProfileId, otherProfileId],
  );
  await db.query(
    `insert into le_employee (id, profile_id, short_code, full_name) values
       ($1,$4,'AD','Admin'),
       ($2,$5,'WA','Worker A'),
       ($3,$6,'WB','Worker B')`,
    [
      managerEmployeeId, workerEmployeeId, otherEmployeeId,
      managerProfileId, workerProfileId, otherProfileId,
    ],
  );
  await db.query(`update auth.test_session set user_id = $1 where id = true`, [managerProfileId]);
  await db.query(
    `insert into customers (id, company_name) values ($1, 'RLS AG')`,
    [customerId],
  );
  await db.query(
    `insert into le_project (id, project_no, name, customer_id, rate_mode)
     values ($1,'P-RLS','RLS Project',$2,'service_type')`,
    [projectId, customerId],
  );
  const service = await one(db, `select id from le_service_type where code = 'BUCH'`);
  await db.query(
    `insert into le_time_entry (
       project_id, employee_id, service_type_id, entry_date,
       hours_internal, rate_snapshot, description, status
     ) values
       ($1,$2,$4,'2026-07-21',1,145,'Eigener Eintrag','erfasst'),
       ($1,$3,$4,'2026-07-21',1,145,'Fremder Eintrag','erfasst')`,
    [projectId, workerEmployeeId, otherEmployeeId, service.id],
  );
  const expenses = await db.query(
    `insert into le_expense (
       employee_id, expense_date, category, description, amount_gross, status
     ) values
       ($1,'2026-07-21','material','Eigene Spese',10,'entwurf'),
       ($2,'2026-07-21','material','Fremde Spese',20,'entwurf')
     returning id, employee_id`,
    [workerEmployeeId, otherEmployeeId],
  );
  await db.query(
    `insert into storage.objects (bucket_id, name) values
       ('expenses', $1), ('expenses', $2),
       ('absences', $3), ('absences', $4),
       ('invoices', 'invoices/test.pdf')`,
    [
      `expenses/${expenses.rows[0].id}/own.pdf`,
      `expenses/${expenses.rows[1].id}/other.pdf`,
      `employees/${workerEmployeeId}/own.pdf`,
      `employees/${otherEmployeeId}/other.pdf`,
    ],
  );
  await db.query(
    `insert into le_invoice (
       project_id, customer_id, status, invoice_type, subtotal, vat_amount, total
     ) values ($1,$2,'entwurf','normal',100,8.1,108.1)`,
    [projectId, customerId],
  );

  await db.query(`update auth.test_session set user_id = $1 where id = true`, [workerProfileId]);
  await db.exec('set role authenticated');
  try {
    const entries = await db.query(`select description from le_time_entry order by description`);
    assert.deepEqual(entries.rows.map((row) => row.description), ['Eigener Eintrag']);
    const visibleExpenses = await db.query(`select description from le_expense order by description`);
    assert.deepEqual(visibleExpenses.rows.map((row) => row.description), ['Eigene Spese']);
    assert.equal(Number((await one(db, `select count(*) as count from le_invoice`)).count), 0);
    const storageRows = await db.query(`select name from storage.objects order by name`);
    assert.deepEqual(storageRows.rows.map((row) => row.name), [
      `employees/${workerEmployeeId}/own.pdf`,
      `expenses/${expenses.rows[0].id}/own.pdf`,
    ]);

    const sequence = await one(db, `select id from le_number_sequence where kind = 'invoice'`);
    await assert.rejects(
      db.query(
        `select * from le_update_number_sequence_settings($1, 'BAD-{NNNN}', 4, true)`,
        [sequence.id],
      ),
      /Keine Berechtigung/i,
    );
    await assert.rejects(
      db.query(
        `select * from le_create_akonto_invoice($1,$2,100,8.1,null,null,null)`,
        [projectId, customerId],
      ),
      /Keine Berechtigung/i,
    );
  } finally {
    await db.exec('reset role');
  }
});

test('expense and recurring draft generators commit header, lines and source together', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const managerId = '13000000-0000-0000-0000-000000000001';
  const employeeId = '23000000-0000-0000-0000-000000000001';
  const customerId = '33000000-0000-0000-0000-000000000001';
  const projectId = '43000000-0000-0000-0000-000000000001';
  const expenseId = '53000000-0000-0000-0000-000000000001';
  const recurringId = '63000000-0000-0000-0000-000000000001';

  await db.query(`insert into profiles (id, role) values ($1, 'admin')`, [managerId]);
  await db.query(`update auth.test_session set user_id = $1 where id = true`, [managerId]);
  await db.query(
    `insert into customers (id, company_name) values ($1, 'Generator AG')`,
    [customerId],
  );
  await db.query(
    `insert into le_employee (id, profile_id, short_code, full_name)
     values ($1,$2,'GA','Generator Admin')`,
    [employeeId, managerId],
  );
  await db.query(
    `insert into le_project (id, project_no, name, customer_id, rate_mode)
     values ($1,'P-GEN','Generator Project',$2,'service_type')`,
    [projectId, customerId],
  );
  await db.query(
    `insert into le_expense (
       id, employee_id, expense_date, category, description, amount_gross,
       project_id, customer_id, rebillable, status
     ) values ($1,$2,'2026-07-10','material','Porto',20,$3,$4,true,'genehmigt')`,
    [expenseId, employeeId, projectId, customerId],
  );

  const expenseInvoice = await one(
    db,
    `select * from le_create_expense_invoices(array[$1]::uuid[])`,
    [expenseId],
  );
  assert.equal(Number(expenseInvoice.subtotal), 20);
  const billedExpense = await one(
    db,
    `select status, invoiced_invoice_id from le_expense where id = $1`,
    [expenseId],
  );
  assert.equal(billedExpense.status, 'abgerechnet');
  assert.equal(billedExpense.invoiced_invoice_id, expenseInvoice.id);

  await db.query(
    `insert into le_recurring_invoice (
       id, project_id, customer_id, title, cycle, next_date, start_date,
       template_lines, payment_terms_days
     ) values (
       $1,$2,$3,'Monatspauschale','monthly','2026-07-01','2026-01-01',
       '[{"description":"Pauschale","hours":1,"rate":100,"vat_pct":8.1}]'::jsonb, 10
     )`,
    [recurringId, projectId, customerId],
  );
  const recurringInvoice = await one(
    db,
    `select * from le_generate_recurring_drafts(array[$1]::uuid[])`,
    [recurringId],
  );
  assert.equal(Number(recurringInvoice.subtotal), 100);
  assert.equal(Number(recurringInvoice.total), 108.1);
  const recurring = await one(
    db,
    `select next_date, last_invoice_id from le_recurring_invoice where id = $1`,
    [recurringId],
  );
  assert.equal(new Date(recurring.next_date).toISOString().slice(0, 10), '2026-08-01');
  assert.equal(recurring.last_invoice_id, recurringInvoice.id);
});

test('akonto application and removal update links, lines and totals atomically', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const managerId = '14000000-0000-0000-0000-000000000001';
  const customerId = '34000000-0000-0000-0000-000000000001';
  const projectId = '44000000-0000-0000-0000-000000000001';
  await db.query(`insert into profiles (id, role) values ($1, 'admin')`, [managerId]);
  await db.query(`update auth.test_session set user_id = $1 where id = true`, [managerId]);
  await db.query(
    `insert into customers (id, company_name) values ($1, 'Akonto AG')`,
    [customerId],
  );
  await db.query(
    `insert into le_customer_terms (
       customer_id, currency, skonto_pct, skonto_days, vat_required, vat_mode
     ) values ($1, 'EUR', 2, 10, true, 'inland')`,
    [customerId],
  );
  await db.query(
    `insert into le_project (id, project_no, name, customer_id, rate_mode)
     values ($1,'P-AKONTO','Akonto Project',$2,'service_type')`,
    [projectId, customerId],
  );

  const akonto = await one(
    db,
    `select * from le_create_akonto_invoice(
       $1, $2, 50, 8.1, '2026-07-01', '2026-07-31', 'Akonto Juli'
     )`,
    [projectId, customerId],
  );
  const finalizedAkonto = await one(db, `select * from le_finalize_invoice($1)`, [akonto.id]);
  assert.equal(finalizedAkonto.currency, 'EUR');
  assert.equal(Number(finalizedAkonto.skonto_pct), 2);
  assert.equal(finalizedAkonto.skonto_days, 10);

  const target = await one(
    db,
    `insert into le_invoice (project_id, customer_id, status, invoice_type, created_by)
     values ($1,$2,'entwurf','normal',$3) returning *`,
    [projectId, customerId, managerId],
  );
  const saved = await one(
    db,
    `select * from le_save_invoice_draft(
       $1,
       '{"discount_pct":0,"discount_amount":0,"vat_pct":8.1}'::jsonb,
       '[{"description":"Honorar","hours":1,"rate":200,"amount":200,"sort_order":10,"vat_code":"STD","vat_pct":8.1}]'::jsonb
     )`,
    [target.id],
  );
  assert.equal(Number(saved.total), 216.2);

  const applied = await one(
    db,
    `select * from le_apply_akonto_links($1, array[$2]::uuid[])`,
    [target.id, finalizedAkonto.id],
  );
  assert.equal(Number(applied.subtotal), 150);
  assert.equal(Number(applied.vat_amount), 12.15);
  assert.equal(Number(applied.total), 162.15);
  assert.equal(
    Number((await one(
      db,
      `select count(*) as count from le_invoice_akonto_link
        where schluss_invoice_id = $1 and akonto_invoice_id = $2`,
      [target.id, finalizedAkonto.id],
    )).count),
    1,
  );

  await assert.rejects(
    db.query(
      `select * from le_apply_akonto_links($1, array[$2]::uuid[])`,
      [target.id, finalizedAkonto.id],
    ),
    /duplicate key|unique constraint/i,
  );

  const removed = await one(
    db,
    `select * from le_remove_akonto_link($1, $2)`,
    [target.id, finalizedAkonto.id],
  );
  assert.equal(Number(removed.subtotal), 200);
  assert.equal(Number(removed.total), 216.2);
  assert.equal(
    Number((await one(
      db,
      `select count(*) as count from le_invoice_akonto_link
        where schluss_invoice_id = $1 and akonto_invoice_id = $2`,
      [target.id, finalizedAkonto.id],
    )).count),
    0,
  );
});

test('dunning drafts, number reservation and escalation are atomic', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const managerId = '16000000-0000-0000-0000-000000000001';
  const customerId = '36000000-0000-0000-0000-000000000001';
  const projectId = '46000000-0000-0000-0000-000000000001';
  await db.query(`insert into profiles (id, role) values ($1, 'admin')`, [managerId]);
  await db.query(`update auth.test_session set user_id = $1 where id = true`, [managerId]);
  await db.query(
    `insert into customers (id, company_name) values ($1, 'Mahnung AG')`,
    [customerId],
  );
  await db.query(
    `insert into le_project (id, project_no, name, customer_id, rate_mode)
     values ($1,'P-MAHN','Mahn Project',$2,'service_type')`,
    [projectId, customerId],
  );
  const invoice = await one(
    db,
    `insert into le_invoice (
       invoice_no, project_id, customer_id, status, invoice_type,
       issue_date, due_date, subtotal, vat_amount, total, paid_amount
     ) values (
       'TEST-M-1',$1,$2,'versendet','normal',
       current_date - 60,current_date - 30,100,8.1,108.1,8.1
     ) returning *`,
    [projectId, customerId],
  );

  const draft = await one(
    db,
    `select * from le_create_dunning_drafts(array[$1]::uuid[])`,
    [invoice.id],
  );
  assert.equal(draft.level, 1);
  assert.equal(Number(draft.outstanding_amount), 100);
  assert.equal(Number(draft.fee), 20);
  assert.equal(draft.status, 'entwurf');

  await assert.rejects(
    db.query(`select * from le_create_dunning_drafts(array[$1]::uuid[])`, [invoice.id]),
    /bereits ein Mahnentwurf/i,
  );

  const reserved1 = await one(db, `select * from le_reserve_dunning_no($1)`, [draft.id]);
  const reserved2 = await one(db, `select * from le_reserve_dunning_no($1)`, [draft.id]);
  assert.equal(reserved1.dunning_no, reserved2.dunning_no);
  assert.equal(reserved1.status, 'entwurf');

  const sent = await one(db, `select * from le_finalize_dunning($1)`, [draft.id]);
  assert.equal(sent.dunning_no, reserved1.dunning_no);
  assert.equal(sent.status, 'versendet');
  await assert.rejects(
    db.query(`update le_dunning set status = 'bezahlt' where id = $1`, [draft.id]),
    /Zuerst muss die Zahlung/i,
  );

  const escalated = await one(db, `select * from le_escalate_dunning($1)`, [draft.id]);
  assert.equal(escalated.level, 2);
  assert.equal(escalated.status, 'entwurf');
  assert.equal(Number(escalated.fee), 30);
  const previous = await one(db, `select status from le_dunning where id = $1`, [draft.id]);
  assert.equal(previous.status, 'eskaliert');
});
