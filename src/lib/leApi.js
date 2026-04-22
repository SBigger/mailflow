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
      .select('*, customer:customers(id, company_name), responsible:le_employee(id, short_code, full_name), rate_group:le_rate_group(id, name)')
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
      .select('*, customer:customers(id, company_name), project:le_project(id, name), lines:le_invoice_line(*)')
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  get: async (id) => {
    const { data, error } = await supabase
      .from('le_invoice')
      .select('*, customer:customers(id, company_name), project:le_project(id, name, billing_mode), lines:le_invoice_line(*)')
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
    return leInvoice.update(id, {
      invoice_no: no,
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

// Aggregiert offene Einträge pro Projekt für Faktura-Vorschlag
export async function fakturaVorschlagData({ fromIso, toIso } = {}) {
  let q = supabase
    .from('le_time_entry')
    .select('id, entry_date, hours_internal, rate_snapshot, project_id, service_type_id, description, employee_id, status, project:le_project(id, name, billing_mode, customer_id, customer:customers(id, company_name)), service_type:le_service_type(id, name, billable), employee:le_employee(id, short_code, full_name)')
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
