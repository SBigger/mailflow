// Leistungserfassung · Supabase API-Layer
// Alle Aufrufe gegen le_*-Tabellen laufen hier durch, damit Seiten einheitlich sind.
// Bei fehlender Migration werfen die Calls – UI zeigt Fehler-Hinweis.

import { supabase } from '@/api/supabaseClient';

// ---------- Employee ----------
export const leEmployee = {
  list: async () => {
    const { data, error } = await supabase
      .from('le_employee')
      .select('*')
      .order('active', { ascending: false })
      .order('full_name');
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_employee').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_employee').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_employee').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---------- Service Type ----------
export const leServiceType = {
  list: async () => {
    const { data, error } = await supabase
      .from('le_service_type')
      .select('*')
      .order('sort_order')
      .order('name');
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_service_type').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_service_type').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_service_type').delete().eq('id', id);
    if (error) throw error;
  },
};

export const leServiceRateHistory = {
  listForType: async (serviceTypeId) => {
    const { data, error } = await supabase
      .from('le_service_rate_history')
      .select('*')
      .eq('service_type_id', serviceTypeId)
      .order('valid_from', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  listAll: async () => {
    const { data, error } = await supabase
      .from('le_service_rate_history')
      .select('*')
      .order('valid_from', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_service_rate_history').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_service_rate_history').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---------- Rate Group ----------
export const leRateGroup = {
  list: async () => {
    const { data, error } = await supabase
      .from('le_rate_group')
      .select('*, le_rate_group_rate(*)')
      .order('active', { ascending: false })
      .order('name');
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_rate_group').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_rate_group').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_rate_group').delete().eq('id', id);
    if (error) throw error;
  },
};

export const leRateGroupRate = {
  listAll: async () => {
    const { data, error } = await supabase
      .from('le_rate_group_rate')
      .select('*')
      .order('valid_from', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  upsert: async (payload) => {
    const { data, error } = await supabase
      .from('le_rate_group_rate')
      .upsert(payload, { onConflict: 'rate_group_id,service_type_id,valid_from' })
      .select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_rate_group_rate').delete().eq('id', id);
    if (error) throw error;
  },
};

export function resolveRateFor({ serviceTypeId, rateGroupId, date, rateGroupRates = [], serviceRateHistory = [] }) {
  if (!serviceTypeId) return 0;
  const d = date || new Date().toISOString().slice(0, 10);
  if (rateGroupId) {
    const match = rateGroupRates
      .filter(r => r.service_type_id === serviceTypeId && r.rate_group_id === rateGroupId && r.valid_from <= d)
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
    if (match) return Number(match.rate);
  }
  const histMatch = serviceRateHistory
    .filter(r => r.service_type_id === serviceTypeId && r.valid_from <= d)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
  return histMatch ? Number(histMatch.rate) : 0;
}

// ---------- Project ----------
export const leProject = {
  list: async ({ status = 'offen' } = {}) => {
    let q = supabase
      .from('le_project')
      .select('*, customer:customers(id, company_name, street, building_number, zip, city, country, billing_email), responsible:le_employee(id, short_code, full_name), rate_group:le_rate_group(id, name)')
      .order('name');
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_project').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_project').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  archive: async (id) => leProject.update(id, { status: 'archiviert', closed_at: new Date().toISOString().slice(0, 10) }),
  reopen: async (id) => leProject.update(id, { status: 'offen', closed_at: null }),
};

// ---------- Time Entry ----------
export const leTimeEntry = {
  listForDate: async (dateIso, { employeeId } = {}) => {
    let q = supabase
      .from('le_time_entry')
      .select('*, project:le_project(id, name, billing_mode), service_type:le_service_type(id, name, billable), employee:le_employee(id, short_code)')
      .eq('entry_date', dateIso)
      .order('time_from', { ascending: true, nullsFirst: false });
    if (employeeId) q = q.eq('employee_id', employeeId);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  listForRange: async (fromIso, toIso, { employeeId, projectId, status } = {}) => {
    let q = supabase
      .from('le_time_entry')
      .select('*, project:le_project(id, name, billing_mode, customer_id), service_type:le_service_type(id, name, billable), employee:le_employee(id, short_code, full_name)')
      .gte('entry_date', fromIso)
      .lte('entry_date', toIso)
      .order('entry_date', { ascending: true });
    if (employeeId) q = q.eq('employee_id', employeeId);
    if (projectId) q = q.eq('project_id', projectId);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_time_entry').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_time_entry').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_time_entry').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---------- Invoice ----------
export const leInvoice = {
  list: async ({ status } = {}) => {
    let q = supabase
      .from('le_invoice')
      .select('*, customer:customers(id, company_name, street, building_number, zip, city, country, billing_email), project:le_project(id, name), lines:le_invoice_line(*)')
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  get: async (id) => {
    const { data, error } = await supabase
      .from('le_invoice')
      .select('*, customer:customers(id, company_name, street, building_number, zip, city, country, billing_email), project:le_project(id, name, billing_mode), lines:le_invoice_line(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_invoice').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_invoice').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_invoice').delete().eq('id', id);
    if (error) throw error;
  },
  nextInvoiceNo: async () => {
    const { data, error } = await supabase.rpc('le_next_invoice_no');
    if (error) throw error;
    return data;
  },
  finalize: async (id) => {
    const no = await leInvoice.nextInvoiceNo();
    // QR-Referenz setzen (Mod-10 über customer-Id + Rechnungsnr-Stellen)
    const inv = await leInvoice.get(id);
    const numericPart = String(inv.customer_id || '').replace(/\D/g, '').slice(0, 8).padStart(8, '0')
      + String(no).replace(/\D/g, '').slice(0, 18).padStart(18, '0');
    const base = numericPart.slice(0, 26);
    // Mod-10
    const table = [0,9,4,6,8,2,7,1,3,5];
    let carry = 0;
    for (const ch of base.replace(/\D/g, '')) carry = table[(carry + parseInt(ch, 10)) % 10];
    const qrRef = base + ((10 - carry) % 10);
    return leInvoice.update(id, {
      invoice_no: no,
      qr_reference: qrRef,
      status: 'definitiv',
      issue_date: new Date().toISOString().slice(0, 10),
    });
  },
};

export const leInvoiceLine = {
  create: async (payload) => {
    const { data, error } = await supabase.from('le_invoice_line').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_invoice_line').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_invoice_line').delete().eq('id', id);
    if (error) throw error;
  },
  bulkCreate: async (rows) => {
    if (!rows?.length) return [];
    const { data, error } = await supabase.from('le_invoice_line').insert(rows).select();
    if (error) throw error;
    return data ?? [];
  },
};

// ---------- Invoice-Akonto-Link + Spezial-Workflows ----------
export const leInvoiceAkontoLink = {
  listForSchluss: async (schlussId) => {
    const { data, error } = await supabase
      .from('le_invoice_akonto_link')
      .select('*, akonto:le_invoice!akonto_invoice_id(id, invoice_no, total, issue_date, status)')
      .eq('schluss_invoice_id', schlussId);
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_invoice_akonto_link').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_invoice_akonto_link').delete().eq('id', id);
    if (error) throw error;
  },
};

// Akonti pro Kunde, die noch nicht in einer Schluss verrechnet sind
export async function leOpenAkonti(customerId) {
  // Akonti des Kunden im Status definitiv/versendet/bezahlt
  const { data: akonti, error } = await supabase
    .from('le_invoice')
    .select('id, invoice_no, total, issue_date, status, customer_id')
    .eq('customer_id', customerId)
    .eq('invoice_type', 'akonto')
    .in('status', ['definitiv', 'versendet', 'bezahlt'])
    .order('issue_date');
  if (error) throw error;

  // Bereits verlinkte Akonto-IDs
  const ids = (akonti ?? []).map(a => a.id);
  if (ids.length === 0) return [];
  const { data: links, error: linkErr } = await supabase
    .from('le_invoice_akonto_link')
    .select('akonto_invoice_id')
    .in('akonto_invoice_id', ids);
  if (linkErr) throw linkErr;
  const linkedSet = new Set((links ?? []).map(l => l.akonto_invoice_id));
  return (akonti ?? []).filter(a => !linkedSet.has(a.id));
}

// Akonto-Rechnung aus Projekt erstellen (Entwurf)
export async function createAkontoInvoice({ projectId, customerId, amountNet, vatPct = 8.1, periodFrom, periodTo, description }) {
  const subtotal = Number(amountNet);
  const vatAmount = Math.round(subtotal * vatPct) / 100;
  const total = subtotal + vatAmount;

  const { data: inv, error: invErr } = await supabase.from('le_invoice').insert({
    project_id: projectId ?? null,
    customer_id: customerId ?? null,
    status: 'entwurf',
    invoice_type: 'akonto',
    period_from: periodFrom ?? null,
    period_to: periodTo ?? null,
    subtotal, vat_pct: vatPct, vat_amount: vatAmount, total,
    notes: 'Akonto-Rechnung – wird in Schlussrechnung verrechnet.',
  }).select().single();
  if (invErr) throw invErr;

  await supabase.from('le_invoice_line').insert({
    invoice_id: inv.id,
    description: description || 'Akonto auf Honorar',
    hours: 0, rate: 0, amount: subtotal,
    sort_order: 10,
  });
  return inv;
}

// Gutschrift aus existierender Rechnung erstellen (negative Beträge, eigene Nummer)
export async function createCreditFromInvoice(originalInvoiceId, { reason } = {}) {
  const orig = await leInvoice.get(originalInvoiceId);
  // Neue Gutschriftsnummer aus le_number_sequence (kind='credit')
  const { data: seq } = await supabase.from('le_number_sequence').select('*').eq('kind', 'credit').single();
  let creditNo = null;
  if (seq) {
    const y = new Date().getFullYear();
    const resetYearly = !!seq.reset_yearly;
    const lastYear = seq.last_year ?? y;
    const newCounter = (resetYearly && lastYear !== y) ? 1 : (seq.current_value + 1);
    const padded = String(newCounter).padStart(seq.padding_length || 4, '0');
    creditNo = String(seq.format)
      .replace('{YYYY}', String(y))
      .replace('{YY}', String(y).slice(-2))
      .replace('{MM}', String(new Date().getMonth() + 1).padStart(2, '0'))
      .replace('{NNNN}', padded);
    await supabase.from('le_number_sequence').update({
      current_value: newCounter,
      last_year: y,
    }).eq('id', seq.id);
  }

  const { data: credit, error: credErr } = await supabase.from('le_invoice').insert({
    invoice_no: creditNo,
    project_id: orig.project_id,
    customer_id: orig.customer_id,
    parent_invoice_id: orig.id,
    invoice_type: 'gutschrift',
    status: 'definitiv',
    issue_date: new Date().toISOString().slice(0, 10),
    period_from: orig.period_from,
    period_to: orig.period_to,
    subtotal: -Number(orig.subtotal || 0),
    vat_pct: orig.vat_pct,
    vat_amount: -Number(orig.vat_amount || 0),
    discount_pct: orig.discount_pct,
    discount_amount: orig.discount_amount,
    total: -Number(orig.total || 0),
    notes: reason ? `Gutschrift zu Rechnung ${orig.invoice_no}: ${reason}` : `Gutschrift zu Rechnung ${orig.invoice_no}`,
  }).select().single();
  if (credErr) throw credErr;

  // Lines kopieren mit negativen Beträgen
  if (orig.lines?.length) {
    const negLines = orig.lines.map((l, i) => ({
      invoice_id: credit.id,
      service_type_id: l.service_type_id,
      description: l.description,
      hours: -Number(l.hours || 0),
      rate: l.rate,
      amount: -Number(l.amount || 0),
      sort_order: (i + 1) * 10,
    }));
    const { error: linesErr } = await supabase.from('le_invoice_line').insert(negLines);
    if (linesErr) throw linesErr;
  }

  // Original auf 'storniert' setzen
  await supabase.from('le_invoice').update({ status: 'storniert' }).eq('id', orig.id);
  return credit;
}

// ---------- Payment ----------
export const lePayment = {
  list: async ({ from, to, customerId } = {}) => {
    let q = supabase
      .from('le_payment')
      .select('*, invoice:le_invoice(id, invoice_no, total, status), customer:customers(id, company_name, street, building_number, zip, city, country, billing_email)')
      .order('paid_at', { ascending: false });
    if (from) q = q.gte('paid_at', from);
    if (to) q = q.lte('paid_at', to);
    if (customerId) q = q.eq('customer_id', customerId);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_payment').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_payment').delete().eq('id', id);
    if (error) throw error;
  },
};

export const leCamtImport = {
  list: async () => {
    const { data, error } = await supabase.from('le_camt_import').select('*').order('imported_at', { ascending: false }).limit(20);
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_camt_import').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
};

// ---------- Dunning (Mahnung) ----------
export const leDunning = {
  list: async ({ status } = {}) => {
    let q = supabase
      .from('le_dunning')
      .select('*, invoice:le_invoice(id, invoice_no, total, due_date, customer_id, project_id), customer:customers(id, company_name, street, building_number, zip, city, country, billing_email)')
      .order('dunning_date', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_dunning').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_dunning').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_dunning').delete().eq('id', id);
    if (error) throw error;
  },
  nextNo: async () => {
    const { data, error } = await supabase.rpc('le_next_dunning_no');
    if (error) throw error;
    return data;
  },
  finalize: async (id) => {
    const no = await leDunning.nextNo();
    return leDunning.update(id, { dunning_no: no, status: 'versendet', sent_at: new Date().toISOString() });
  },
};

// Hilfsfunktion: überfällige Rechnungen (für Mahn-Vorschläge)
export async function leOverdueInvoices() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('le_invoice')
    .select('*, customer:customers(id, company_name, street, building_number, zip, city, country, billing_email), project:le_project(id, name), dunnings:le_dunning(id, level, status)')
    .in('status', ['versendet'])
    .lt('due_date', today);
  if (error) throw error;
  return data ?? [];
}

// ---------- Expense (Spesen) ----------
export const leExpense = {
  list: async ({ employeeId, status, from, to } = {}) => {
    let q = supabase
      .from('le_expense')
      .select('*, employee:le_employee(id, short_code, full_name), project:le_project(id, name), customer:customers(id, company_name, street, building_number, zip, city, country, billing_email)')
      .order('expense_date', { ascending: false });
    if (employeeId) q = q.eq('employee_id', employeeId);
    if (status) q = q.eq('status', status);
    if (from) q = q.gte('expense_date', from);
    if (to) q = q.lte('expense_date', to);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_expense').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_expense').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_expense').delete().eq('id', id);
    if (error) throw error;
  },
  approve: async (id) => leExpense.update(id, { status: 'genehmigt', approved_at: new Date().toISOString() }),
  reject: async (id) => leExpense.update(id, { status: 'abgelehnt' }),
};

// ---------- Absence (Abwesenheit) ----------
export const leAbsence = {
  list: async ({ employeeId, status, from, to } = {}) => {
    let q = supabase
      .from('le_absence')
      .select('*, employee:le_employee(id, short_code, full_name)')
      .order('date_from', { ascending: false });
    if (employeeId) q = q.eq('employee_id', employeeId);
    if (status) q = q.eq('status', status);
    if (from) q = q.gte('date_from', from);
    if (to) q = q.lte('date_to', to);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_absence').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_absence').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_absence').delete().eq('id', id);
    if (error) throw error;
  },
  approve: async (id) => leAbsence.update(id, { status: 'genehmigt', approved_at: new Date().toISOString() }),
  reject: async (id) => leAbsence.update(id, { status: 'abgelehnt' }),
};

// ---------- Sollzeit-Profile ----------
export const leSollzeitProfile = {
  listForEmployee: async (employeeId) => {
    const { data, error } = await supabase
      .from('le_sollzeit_profile').select('*').eq('employee_id', employeeId)
      .order('valid_from', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_sollzeit_profile').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_sollzeit_profile').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---------- Recurring Invoices ----------
export const leRecurring = {
  list: async () => {
    const { data, error } = await supabase
      .from('le_recurring_invoice')
      .select('*, customer:customers(id, company_name, street, building_number, zip, city, country, billing_email), project:le_project(id, name), last_invoice:le_invoice!last_invoice_id(id, invoice_no)')
      .order('next_date');
    if (error) throw error;
    return data ?? [];
  },
  due: async (asOfIso) => {
    const today = asOfIso || new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('le_recurring_invoice')
      .select('*, customer:customers(id, company_name, street, building_number, zip, city, country, billing_email), project:le_project(id, name)')
      .eq('paused', false)
      .eq('active', true)
      .lte('next_date', today)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order('next_date');
    if (error) throw error;
    return data ?? [];
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('le_recurring_invoice').insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_recurring_invoice').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('le_recurring_invoice').delete().eq('id', id);
    if (error) throw error;
  },
  pause: async (id) => leRecurring.update(id, { paused: true }),
  resume: async (id) => leRecurring.update(id, { paused: false }),
};

// Berechnet das nächste Datum nach Generierung
export function computeNextRecurringDate(currentNextDate, cycle, intervalMonths = 1) {
  const d = new Date(currentNextDate + 'T00:00:00');
  let months = 1;
  switch (cycle) {
    case 'monthly': months = 1; break;
    case 'quarterly': months = 3; break;
    case 'semi': months = 6; break;
    case 'yearly': months = 12; break;
    case 'custom': months = Math.max(1, intervalMonths || 1); break;
    default: months = 1;
  }
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ---------- Company Settings ----------
export const leCompany = {
  get: async () => {
    const { data, error } = await supabase
      .from('le_company_settings')
      .select('*')
      .eq('is_active', true)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_company_settings').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
};

// ---------- Customer Terms ----------
export const leCustomerTerms = {
  get: async (customerId) => {
    const { data, error } = await supabase.from('le_customer_terms').select('*').eq('customer_id', customerId).maybeSingle();
    if (error) throw error;
    return data;
  },
  upsert: async (payload) => {
    const { data, error } = await supabase
      .from('le_customer_terms')
      .upsert(payload, { onConflict: 'customer_id' }).select().single();
    if (error) throw error;
    return data;
  },
};

// ---------- Number Sequences ----------
export const leNumberSequence = {
  list: async () => {
    const { data, error } = await supabase.from('le_number_sequence').select('*').order('kind');
    if (error) throw error;
    return data ?? [];
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('le_number_sequence').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
};

// MS365-Tagesvorschläge: Kalender + gesendete Mails (read-only)
export async function leMs365Day(dateIso) {
  const { data, error } = await supabase.functions.invoke('le-ms365-day', {
    body: { date: dateIso },
  });
  if (error) throw error;
  return data || { calendar: [], sent: [] };
}

// Mail-Versand via Microsoft Graph (separate Edge Function – teilt sich
// keinen Code mit der bestehenden MS365-Sync-Integration).
export async function sendInvoiceViaMs365({ to, subject, html, attachmentUrl, attachmentFilename }) {
  const { data, error } = await supabase.functions.invoke('le-send-via-ms365', {
    body: { to, subject, html, attachmentUrl, attachmentFilename },
  });
  if (error) throw error;
  return data;
}

// Aggregiert offene Einträge pro Projekt für Faktura-Vorschlag
export async function fakturaVorschlagData({ fromIso, toIso } = {}) {
  let q = supabase
    .from('le_time_entry')
    .select('id, entry_date, hours_internal, rate_snapshot, project_id, service_type_id, description, employee_id, status, project:le_project(id, name, billing_mode, customer_id, customer:customers(id, company_name, street, building_number, zip, city, country, billing_email)), service_type:le_service_type(id, name, billable), employee:le_employee(id, short_code, full_name)')
    .in('status', ['erfasst', 'freigegeben'])
    .is('invoice_id', null)
    .order('entry_date');
  if (fromIso) q = q.gte('entry_date', fromIso);
  if (toIso) q = q.lte('entry_date', toIso);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Rechnungsentwürfe aus ausgewählten Projekten bauen (eine Invoice pro Projekt)
export async function createInvoiceDraftsFromEntries({ entries, projectIds, periodFrom, periodTo }) {
  const created = [];
  const byProject = new Map();
  for (const e of entries) {
    if (!projectIds.includes(e.project_id)) continue;
    if (!byProject.has(e.project_id)) byProject.set(e.project_id, []);
    byProject.get(e.project_id).push(e);
  }

  for (const [projectId, projEntries] of byProject) {
    const proj = projEntries[0].project;
    const billable = projEntries.filter(e => e.service_type?.billable !== false);
    if (billable.length === 0) continue;

    // Subtotal
    const subtotal = billable.reduce((s, e) => s + Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0), 0);
    const vatPct = 8.1;
    const vatAmount = Math.round(subtotal * vatPct) / 100;
    const total = subtotal + vatAmount;

    const { data: inv, error: invErr } = await supabase.from('le_invoice').insert({
      project_id: projectId,
      customer_id: proj?.customer_id ?? null,
      status: 'entwurf',
      period_from: periodFrom ?? null,
      period_to: periodTo ?? null,
      subtotal,
      vat_pct: vatPct,
      vat_amount: vatAmount,
      total,
    }).select().single();
    if (invErr) throw invErr;

    // Aggregiere je service_type eine Linie
    const groupedByType = new Map();
    for (const e of billable) {
      const key = e.service_type_id ?? 'none';
      if (!groupedByType.has(key)) groupedByType.set(key, { serviceType: e.service_type, hours: 0, amount: 0, rateSum: 0, count: 0 });
      const g = groupedByType.get(key);
      const h = Number(e.hours_internal || 0);
      const r = Number(e.rate_snapshot || 0);
      g.hours += h;
      g.amount += h * r;
      g.rateSum += r;
      g.count += 1;
    }

    let idx = 10;
    const linesPayload = [];
    for (const [, g] of groupedByType) {
      const avgRate = g.hours > 0 ? g.amount / g.hours : (g.count ? g.rateSum / g.count : 0);
      linesPayload.push({
        invoice_id: inv.id,
        service_type_id: g.serviceType?.id ?? null,
        description: g.serviceType?.name ?? 'Leistung',
        hours: Math.round(g.hours * 100) / 100,
        rate: Math.round(avgRate * 100) / 100,
        amount: Math.round(g.amount * 100) / 100,
        sort_order: idx,
      });
      idx += 10;
    }
    if (linesPayload.length) {
      const { error: lineErr } = await supabase.from('le_invoice_line').insert(linesPayload);
      if (lineErr) throw lineErr;
    }

    // Time-Entries verknüpfen + auf 'verrechnet' setzen (Entwurfs-Status reicht)
    const ids = projEntries.map(e => e.id);
    const { error: upErr } = await supabase
      .from('le_time_entry')
      .update({ invoice_id: inv.id, status: 'verrechnet' })
      .in('id', ids);
    if (upErr) throw upErr;

    created.push(inv);
  }
  return created;
}

// ---------- Hilfen ----------
export async function currentEmployee() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('le_employee')
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function customersForProjects() {
  const { data, error } = await supabase
    .from('customers')
    .select('id, company_name')
    .order('company_name');
  if (error) throw error;
  return data ?? [];
}

export function isMissingTableError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('relation') || err?.code === '42p01';
}
