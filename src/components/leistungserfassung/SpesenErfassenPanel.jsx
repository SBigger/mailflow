// Leistungserfassung · Spesen erfassen
// Quick-Form oben (analog Tagesansicht) + Liste eigener Spesen mit Filter & Bulk-Einreichen.
// Datenmodell: le_expense. Beleg-Upload via Supabase Storage Bucket "expenses".

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Receipt, Car, UtensilsCrossed, BedDouble, Phone, Package, GraduationCap, Coffee,
  Plus, Upload, Send, Check, X as XIcon, Pencil, Trash2, CornerDownLeft, FileText,
  Briefcase, Building2, Landmark,
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import {
  leExpense, leProject, leEmployee, currentEmployee, customersForProjects,
} from '@/lib/leApi';
import {
  Chip, Card, IconBtn, Input, Select, Field, PanelLoader, PanelError, PanelHeader,
  fmt, artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// ---------------------------------------------------------------------------
// Konstanten · CH-Spesen-Defaults 2026
// ---------------------------------------------------------------------------

const KM_RATE = 0.70;
const VERPFLEGUNG_PAUSCHAL = 30;
const UEBERNACHTUNG_PAUSCHAL = 180;

// MWST-Default je Kategorie (Schweiz, ab 2024 wieder gültig)
const VAT_DEFAULT = {
  km: 0,
  oev: 0,
  verpflegung: 8.1,
  uebernachtung: 3.8,
  telefon: 8.1,
  material: 2.6,
  weiterbildung: 8.1,
  repraesentation: 8.1,
  behoerden: 0,
  sonstiges: 8.1,
};

const CATEGORIES = [
  { id: 'km',              label: 'Kilometergeld',     tone: 'blue',    icon: Car },
  { id: 'oev',             label: 'ÖV',                tone: 'blue',    icon: Briefcase },
  { id: 'verpflegung',     label: 'Verpflegung',       tone: 'orange',  icon: UtensilsCrossed },
  { id: 'uebernachtung',   label: 'Übernachtung',      tone: 'violet',  icon: BedDouble },
  { id: 'telefon',         label: 'Telefon',           tone: 'neutral', icon: Phone },
  { id: 'material',        label: 'Material',          tone: 'neutral', icon: Package },
  { id: 'weiterbildung',   label: 'Weiterbildung',     tone: 'green',   icon: GraduationCap },
  { id: 'repraesentation', label: 'Repräsentation',    tone: 'orange',  icon: Coffee },
  { id: 'behoerden',       label: 'Behörden / Gebühren', tone: 'neutral', icon: Landmark },
  { id: 'sonstiges',       label: 'Sonstiges',         tone: 'neutral', icon: Building2 },
];

const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

const STATUS_LIST = [
  { id: 'alle',         label: 'Alle',         tone: 'neutral' },
  { id: 'entwurf',      label: 'Entwurf',      tone: 'neutral' },
  { id: 'eingereicht',  label: 'Eingereicht',  tone: 'orange' },
  { id: 'genehmigt',    label: 'Genehmigt',    tone: 'green' },
  { id: 'abgelehnt',    label: 'Abgelehnt',    tone: 'red' },
  { id: 'abgerechnet',  label: 'Abgerechnet',  tone: 'blue' },
];

const STATUS_CHIP = {
  entwurf:     { tone: 'neutral', label: 'Entwurf' },
  eingereicht: { tone: 'orange',  label: 'Eingereicht' },
  genehmigt:   { tone: 'green',   label: 'Genehmigt' },
  abgelehnt:   { tone: 'red',     label: 'Abgelehnt' },
  abgerechnet: { tone: 'blue',    label: 'Abgerechnet' },
};

const PAYMENT_METHODS = [
  { id: 'privat',      label: 'Privat ausgelegt' },
  { id: 'firmenkarte', label: 'Firmenkarte' },
  { id: 'kasse',       label: 'Kasse' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const computeVatAmount = (gross, pct) => {
  const g = Number(gross || 0); const p = Number(pct || 0);
  if (!g || !p) return 0;
  return round2(g - (g / (1 + p / 100)));
};

const uploadReceipt = async (file, expenseId) => {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `expenses/${expenseId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('expenses').upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from('expenses').getPublicUrl(path);
  return pub.publicUrl;
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function SpesenErfassenPanel() {
  const qc = useQueryClient();
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null);
  const [employeeResolved, setEmployeeResolved] = useState(false);
  const [statusFilter, setStatusFilter] = useState('alle');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // expense object oder null

  // MA initial auflösen
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const emp = await currentEmployee();
        if (!cancelled) {
          if (emp?.id) setCurrentEmployeeId(emp.id);
          setEmployeeResolved(true);
        }
      } catch {
        if (!cancelled) setEmployeeResolved(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Queries -------------------------------------------------------------
  const projectsQ = useQuery({ queryKey: ['le', 'project'], queryFn: () => leProject.list() });
  const employeesQ = useQuery({ queryKey: ['le', 'employee'], queryFn: () => leEmployee.list() });
  const customersQ = useQuery({ queryKey: ['le', 'customers-for-projects'], queryFn: () => customersForProjects() });

  const expensesQ = useQuery({
    queryKey: ['le', 'expense', currentEmployeeId],
    queryFn: () => leExpense.list({ employeeId: currentEmployeeId }),
    enabled: !!currentEmployeeId,
  });

  const projects = projectsQ.data ?? [];
  const employees = employeesQ.data ?? [];
  const customers = customersQ.data ?? [];
  const expenses = expensesQ.data ?? [];

  // --- Mutations -----------------------------------------------------------
  const invalidate = () => qc.invalidateQueries({ queryKey: ['le', 'expense', currentEmployeeId] });

  const createMut = useMutation({
    mutationFn: (payload) => leExpense.create(payload),
    onSuccess: () => { toast.success('Spese erfasst'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }) => leExpense.update(id, patch),
    onSuccess: () => { toast.success('Gespeichert'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const removeMut = useMutation({
    mutationFn: (id) => leExpense.remove(id),
    onSuccess: () => { toast.success('Gelöscht'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const submitMut = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await leExpense.update(id, { status: 'eingereicht' });
      }
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} Spese${n === 1 ? '' : 'n'} eingereicht`);
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e) => toast.error('Fehler beim Einreichen: ' + (e?.message ?? e)),
  });

  // --- Status-Counts (vor Early-Returns) -----------------------------------
  const statusCounts = useMemo(() => {
    const c = { alle: expenses.length, entwurf: 0, eingereicht: 0, genehmigt: 0, abgelehnt: 0, abgerechnet: 0 };
    for (const e of expenses) {
      if (e.status && c[e.status] != null) c[e.status]++;
    }
    return c;
  }, [expenses]);

  const filtered = useMemo(() => {
    if (statusFilter === 'alle') return expenses;
    return expenses.filter((e) => e.status === statusFilter);
  }, [expenses, statusFilter]);

  // Summary auf gefilterter Menge
  const summary = useMemo(() => {
    let count = 0; let totalGross = 0; let rebillable = 0; let vat = 0;
    for (const e of filtered) {
      count++;
      totalGross += Number(e.amount_gross ?? 0);
      if (e.rebillable) rebillable += Number(e.amount_gross ?? 0);
      vat += Number(e.vat_amount ?? 0);
    }
    return { count, totalGross, rebillable, vat };
  }, [filtered]);

  // --- Loading / Error -----------------------------------------------------
  const anyError = projectsQ.error || expensesQ.error || employeesQ.error;
  if (!employeeResolved) return <PanelLoader />;
  if (anyError) return <PanelError error={anyError} onRetry={() => { projectsQ.refetch(); expensesQ.refetch(); employeesQ.refetch(); }} />;

  const loading = projectsQ.isLoading || (currentEmployeeId && expensesQ.isLoading);

  // --- Handlers ------------------------------------------------------------
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const draftIds = filtered.filter((e) => e.status === 'entwurf').map((e) => e.id);
    if (draftIds.every((id) => selectedIds.has(id)) && draftIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(draftIds));
    }
  };

  const handleSubmitSelected = () => {
    if (!selectedIds.size) return;
    submitMut.mutate([...selectedIds]);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Spese wirklich löschen?')) return;
    await removeMut.mutateAsync(id);
  };

  // --- Render --------------------------------------------------------------
  return (
    <div className="space-y-4">
      <PanelHeader
        title="Spesen erfassen"
        subtitle="Auslagen rasch erfassen, Beleg hochladen, einreichen."
        right={
          <>
            {!currentEmployeeId ? (
              <Select
                value=""
                onChange={(e) => setCurrentEmployeeId(e.target.value || null)}
                style={{ minWidth: 220 }}
              >
                <option value="">MA auswählen…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.short_code} – {emp.full_name}</option>
                ))}
              </Select>
            ) : (
              <Chip tone="green">
                {employees.find((e) => e.id === currentEmployeeId)?.short_code ?? 'MA'}
              </Chip>
            )}
          </>
        }
      />

      {/* Schnell-Erfassen */}
      {currentEmployeeId && (
        <QuickExpenseCard
          projects={projects}
          customers={customers}
          onCreate={async (payload, file) => {
            const created = await createMut.mutateAsync({
              ...payload,
              employee_id: currentEmployeeId,
              status: 'entwurf',
              currency: 'CHF',
            });
            if (file && created?.id) {
              try {
                const url = await uploadReceipt(file, created.id);
                await updateMut.mutateAsync({ id: created.id, patch: { receipt_url: url } });
              } catch (err) {
                toast.error('Beleg-Upload fehlgeschlagen: ' + (err?.message ?? err));
              }
            }
          }}
        />
      )}

      {/* Status-Tabs */}
      <Card>
        <div className="px-3 py-2 flex items-center gap-1.5 flex-wrap border-b" style={{ borderColor: '#e4e7e4' }}>
          {STATUS_LIST.map((s) => {
            const active = statusFilter === s.id;
            const count = statusCounts[s.id] ?? 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { setStatusFilter(s.id); setSelectedIds(new Set()); }}
                className="text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-1.5"
                style={{
                  borderColor: active ? '#7a9b7f' : '#e4e7e4',
                  background: active ? '#e6ede6' : '#fff',
                  color: active ? '#2d5a2d' : '#4a4a4a',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {s.label}
                <span
                  className="text-[10px] px-1.5 rounded"
                  style={{
                    background: active ? '#bfd3bf' : '#f1f1ef',
                    color: active ? '#2d5a2d' : '#666',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}

          {/* Bulk-Aktion */}
          <div className="ml-auto flex items-center gap-2">
            {selectedIds.size > 0 && (
              <span className="text-xs text-zinc-500">{selectedIds.size} selektiert</span>
            )}
            <button
              type="button"
              onClick={handleSubmitSelected}
              disabled={!selectedIds.size || submitMut.isPending}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: (!selectedIds.size || submitMut.isPending) ? 0.45 : 1 }}
              title="Ausgewählte Spesen einreichen"
            >
              <Send className="w-3.5 h-3.5" />
              Einreichen
            </button>
          </div>
        </div>

        {/* Tabelle */}
        {loading ? (
          <PanelLoader />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-0">
            <div className="lg:col-span-3 border-r" style={{ borderColor: '#eef1ee' }}>
              {filtered.length === 0 ? (
                <div className="p-6 text-sm text-zinc-400 text-center">
                  Keine Spesen in dieser Ansicht.
                </div>
              ) : (
                <ExpensesTable
                  expenses={filtered}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={toggleSelectAll}
                  onEdit={(exp) => setEditing(exp)}
                  onRemove={handleDelete}
                />
              )}
            </div>
            <div className="lg:col-span-1 p-4">
              <SummaryCard summary={summary} statusFilter={statusFilter} />
            </div>
          </div>
        )}
      </Card>

      {/* Edit-Modal */}
      {editing && (
        <EditExpenseModal
          expense={editing}
          projects={projects}
          customers={customers}
          onClose={() => setEditing(null)}
          onSave={async (patch, file) => {
            await updateMut.mutateAsync({ id: editing.id, patch });
            if (file) {
              try {
                const url = await uploadReceipt(file, editing.id);
                await updateMut.mutateAsync({ id: editing.id, patch: { receipt_url: url } });
              } catch (err) {
                toast.error('Beleg-Upload fehlgeschlagen: ' + (err?.message ?? err));
              }
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick-Erfassen-Card
// ---------------------------------------------------------------------------

function QuickExpenseCard({ projects, customers, onCreate }) {
  const firstFieldRef = useRef(null);
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(() => emptyForm());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  function emptyForm() {
    return {
      category: 'km',
      expense_date: todayIso(),
      description: '',
      amount_gross: '',
      vat_pct: String(VAT_DEFAULT.km),
      vat_touched: false,
      km_count: '',
      project_id: '',
      customer_id: '',
      rebillable: false,
      payment_method: 'privat',
      notes: '',
    };
  }

  // VAT-Auto-Vorschlag bei Kategoriewechsel
  useEffect(() => {
    if (form.vat_touched) return;
    const def = VAT_DEFAULT[form.category] ?? 0;
    setForm((prev) => ({ ...prev, vat_pct: String(def) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.category]);

  // KM-Anzahl × Rate → amount_gross
  useEffect(() => {
    if (form.category !== 'km') return;
    const km = Number(form.km_count || 0);
    if (km > 0) setForm((prev) => ({ ...prev, amount_gross: String(round2(km * KM_RATE)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.km_count, form.category]);

  // Pauschalen-Vorschlag bei Verpflegung/Übernachtung wenn leer
  useEffect(() => {
    if (form.category === 'verpflegung' && !form.amount_gross) {
      setForm((prev) => ({ ...prev, amount_gross: String(VERPFLEGUNG_PAUSCHAL) }));
    } else if (form.category === 'uebernachtung' && !form.amount_gross) {
      setForm((prev) => ({ ...prev, amount_gross: String(UEBERNACHTUNG_PAUSCHAL) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.category]);

  const project = projects.find((p) => p.id === form.project_id);
  const grossNum = Number(form.amount_gross || 0);
  const vatNum = Number(form.vat_pct || 0);
  const vatAmt = computeVatAmount(grossNum, vatNum);

  const isKm = form.category === 'km';
  const canSave = !!form.expense_date && grossNum > 0 && !!form.category;

  const save = async () => {
    if (!canSave) {
      toast.error('Datum, Kategorie und Betrag sind Pflicht.');
      return;
    }
    const payload = {
      expense_date: form.expense_date,
      category: form.category,
      description: form.description || null,
      amount_gross: round2(grossNum),
      vat_pct: vatNum || 0,
      vat_amount: vatAmt,
      km_count: isKm && form.km_count ? Number(form.km_count) : null,
      km_rate: isKm ? KM_RATE : null,
      project_id: form.project_id || null,
      customer_id: form.customer_id || project?.customer_id || null,
      rebillable: !!form.rebillable,
      payment_method: form.payment_method || 'privat',
      notes: form.notes || null,
    };
    setBusy(true);
    try {
      await onCreate(payload, file);
      setForm(emptyForm());
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => firstFieldRef.current?.focus(), 30);
    } catch {
      /* toast aus mutation */
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  };

  return (
    <Card style={{ borderColor: '#bfd3bf', background: '#f5faf5' }}>
      <div
        className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider flex items-center gap-2"
        style={{ borderColor: '#bfd3bf', color: '#2d5a2d', background: '#e6ede6' }}
      >
        <Receipt className="w-3.5 h-3.5" />
        Schnell-Erfassen
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Field label="Kategorie">
            <Select
              ref={firstFieldRef}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value, vat_touched: false })}
            >
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Datum">
            <Input
              type="date"
              value={form.expense_date}
              onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              onKeyDown={onKey}
            />
          </Field>

          {isKm ? (
            <>
              <Field label="km" hint={`× CHF ${KM_RATE.toFixed(2)} = Betrag`}>
                <Input
                  type="number" step="1" min="0"
                  value={form.km_count}
                  onChange={(e) => setForm({ ...form, km_count: e.target.value })}
                  onKeyDown={onKey}
                  placeholder="z.B. 42"
                />
              </Field>
              <Field label="Betrag CHF">
                <Input
                  type="number" step="0.05" min="0"
                  value={form.amount_gross}
                  onChange={(e) => setForm({ ...form, amount_gross: e.target.value })}
                  onKeyDown={onKey}
                />
              </Field>
            </>
          ) : (
            <Field label="Betrag CHF (brutto)">
              <Input
                type="number" step="0.05" min="0"
                value={form.amount_gross}
                onChange={(e) => setForm({ ...form, amount_gross: e.target.value })}
                onKeyDown={onKey}
                placeholder="z.B. 28.50"
              />
            </Field>
          )}

          <Field label="MWST %" hint={vatAmt > 0 ? `MWST CHF ${fmt.chf(vatAmt)}` : null}>
            <Input
              type="number" step="0.1" min="0"
              value={form.vat_pct}
              onChange={(e) => setForm({ ...form, vat_pct: e.target.value, vat_touched: true })}
              onKeyDown={onKey}
            />
          </Field>

          <Field label="Zahlung">
            <Select
              value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            >
              {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
          <div className="md:col-span-5">
            <Field label="Beschreibung">
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                onKeyDown={onKey}
                placeholder="Was, mit wem, wofür…"
              />
            </Field>
          </div>
          <div className="md:col-span-3">
            <Field label="Projekt (optional)">
              <Select
                value={form.project_id}
                onChange={(e) => {
                  const pid = e.target.value;
                  const p = projects.find((x) => x.id === pid);
                  setForm({
                    ...form,
                    project_id: pid,
                    customer_id: p?.customer_id ?? form.customer_id,
                  });
                }}
              >
                <option value="">— kein Projekt —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.customer?.company_name ? ` · ${p.customer.company_name}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Kunde (optional)">
              <Select
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                disabled={!!form.project_id}
              >
                <option value="">— kein Kunde —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="md:col-span-2 flex items-center gap-2 pb-1">
            <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.rebillable}
                onChange={(e) => setForm({ ...form, rebillable: e.target.checked })}
                className="rounded"
                style={{ accentColor: '#7a9b7f' }}
              />
              Weiterverrechenbar
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label
            className={`${artisBtn.ghost} cursor-pointer`}
            style={artisGhostStyle}
            title="Beleg auswählen"
          >
            <Upload className="w-3.5 h-3.5" />
            {file ? 'Beleg gewählt' : 'Beleg hochladen'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && (
            <span className="text-xs text-zinc-500 truncate max-w-xs">
              {file.name} <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="underline ml-1">entfernen</button>
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              Brutto <span className="tabular-nums font-medium text-zinc-700">CHF {fmt.chf(grossNum)}</span>
              {vatAmt > 0 && (
                <span className="ml-2">· MWST <span className="tabular-nums">CHF {fmt.chf(vatAmt)}</span></span>
              )}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={!canSave || busy}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: (!canSave || busy) ? 0.45 : 1 }}
              title="Speichern (Strg+Enter)"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
              {busy ? 'Speichere…' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tabelle
// ---------------------------------------------------------------------------

function CategoryChip({ category }) {
  const meta = CAT_BY_ID[category];
  if (!meta) return <Chip>{category}</Chip>;
  const Icon = meta.icon;
  return (
    <Chip tone={meta.tone}>
      <Icon className="w-3 h-3 mr-1" />
      {meta.label}
    </Chip>
  );
}

function ExpensesTable({ expenses, selectedIds, onToggleSelect, onToggleSelectAll, onEdit, onRemove }) {
  const draftIds = expenses.filter((e) => e.status === 'entwurf').map((e) => e.id);
  const allDraftsSelected = draftIds.length > 0 && draftIds.every((id) => selectedIds.has(id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
            <th className="px-3 py-2 w-8">
              <input
                type="checkbox"
                checked={allDraftsSelected}
                onChange={onToggleSelectAll}
                disabled={draftIds.length === 0}
                title="Alle Entwürfe auswählen"
                style={{ accentColor: '#7a9b7f' }}
              />
            </th>
            <th className="text-left font-semibold px-3 py-2 w-24">Datum</th>
            <th className="text-left font-semibold px-3 py-2">Kategorie</th>
            <th className="text-left font-semibold px-3 py-2">Beschreibung</th>
            <th className="text-left font-semibold px-3 py-2">Projekt</th>
            <th className="text-right font-semibold px-3 py-2 w-24">Brutto</th>
            <th className="text-right font-semibold px-3 py-2 w-16">MWST%</th>
            <th className="text-left font-semibold px-3 py-2 w-24">Status</th>
            <th className="text-center font-semibold px-3 py-2 w-12">Beleg</th>
            <th className="text-right font-semibold px-3 py-2 w-24">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => {
            const statusInfo = STATUS_CHIP[e.status] ?? STATUS_CHIP.entwurf;
            const selected = selectedIds.has(e.id);
            const selectable = e.status === 'entwurf';
            const deletable = e.status === 'entwurf';
            return (
              <tr
                key={e.id}
                className="border-b last:border-b-0 hover:bg-zinc-50/40 transition-colors"
                style={{ borderColor: '#eef1ee', background: selected ? '#f5faf5' : undefined }}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelect(e.id)}
                    disabled={!selectable}
                    title={selectable ? 'Auswählen' : 'Nur Entwürfe einreichbar'}
                    style={{ accentColor: '#7a9b7f' }}
                  />
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-600">{fmt.date(e.expense_date)}</td>
                <td className="px-3 py-2"><CategoryChip category={e.category} /></td>
                <td className="px-3 py-2 text-zinc-700">
                  {e.description || <span className="text-zinc-300">—</span>}
                  {e.km_count != null && (
                    <span className="ml-1 text-[10px] text-zinc-400">({e.km_count} km)</span>
                  )}
                  {e.rebillable && (
                    <Chip tone="blue" className="ml-1.5">weiterverrechenbar</Chip>
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-600 text-xs">
                  {e.project?.name ?? <span className="text-zinc-300">—</span>}
                  {e.customer?.company_name && (
                    <div className="text-[10px] text-zinc-400">{e.customer.company_name}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.chf(e.amount_gross)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                  {e.vat_pct != null ? Number(e.vat_pct).toFixed(1) : '—'}
                </td>
                <td className="px-3 py-2"><Chip tone={statusInfo.tone}>{statusInfo.label}</Chip></td>
                <td className="px-3 py-2 text-center">
                  {e.receipt_url ? (
                    <a
                      href={e.receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-6 h-6 rounded border text-zinc-600 hover:bg-zinc-50"
                      style={{ borderColor: '#bfd3bf', color: '#2d5a2d', background: '#e6ede6' }}
                      title="Beleg öffnen"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <span className="text-zinc-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <IconBtn onClick={() => onEdit(e)} title="Bearbeiten">
                      <Pencil className="w-3.5 h-3.5" />
                    </IconBtn>
                    {deletable && (
                      <IconBtn onClick={() => onRemove(e.id)} title="Löschen" danger>
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconBtn>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary-Card
// ---------------------------------------------------------------------------

function SummaryCard({ summary, statusFilter }) {
  const filterLabel = STATUS_LIST.find((s) => s.id === statusFilter)?.label ?? 'Alle';
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Summary · {filterLabel}
      </div>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">Anzahl</span>
          <span className="text-sm font-medium tabular-nums">{summary.count}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">Total Brutto</span>
          <span className="text-lg font-semibold tabular-nums" style={{ color: '#2d5a2d' }}>
            CHF {fmt.chf(summary.totalGross)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">Davon weiterverrechenbar</span>
          <span className="text-sm font-medium tabular-nums">CHF {fmt.chf(summary.rebillable)}</span>
        </div>
        <div className="flex items-baseline justify-between pt-2 border-t" style={{ borderColor: '#eef1ee' }}>
          <span className="text-xs text-zinc-500">Vorsteuer abziehbar</span>
          <span className="text-sm font-medium tabular-nums text-zinc-700">CHF {fmt.chf(summary.vat)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit-Modal
// ---------------------------------------------------------------------------

function EditExpenseModal({ expense, projects, customers, onClose, onSave }) {
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(() => ({
    category: expense.category ?? 'sonstiges',
    expense_date: expense.expense_date ?? todayIso(),
    description: expense.description ?? '',
    amount_gross: expense.amount_gross ?? '',
    vat_pct: expense.vat_pct ?? 0,
    km_count: expense.km_count ?? '',
    project_id: expense.project_id ?? '',
    customer_id: expense.customer_id ?? '',
    rebillable: !!expense.rebillable,
    payment_method: expense.payment_method ?? 'privat',
    notes: expense.notes ?? '',
  }));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const isKm = form.category === 'km';
  const grossNum = Number(form.amount_gross || 0);
  const vatNum = Number(form.vat_pct || 0);
  const vatAmt = computeVatAmount(grossNum, vatNum);
  const editable = expense.status === 'entwurf' || expense.status === 'abgelehnt';

  // KM-Auto-Berechnung
  useEffect(() => {
    if (!isKm) return;
    const km = Number(form.km_count || 0);
    if (km > 0) setForm((prev) => ({ ...prev, amount_gross: String(round2(km * KM_RATE)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.km_count, form.category]);

  const save = async () => {
    if (grossNum <= 0) { toast.error('Betrag fehlt.'); return; }
    setBusy(true);
    try {
      const project = projects.find((p) => p.id === form.project_id);
      await onSave({
        category: form.category,
        expense_date: form.expense_date,
        description: form.description || null,
        amount_gross: round2(grossNum),
        vat_pct: vatNum || 0,
        vat_amount: vatAmt,
        km_count: isKm && form.km_count ? Number(form.km_count) : null,
        km_rate: isKm ? KM_RATE : null,
        project_id: form.project_id || null,
        customer_id: form.customer_id || project?.customer_id || null,
        rebillable: !!form.rebillable,
        payment_method: form.payment_method || 'privat',
        notes: form.notes || null,
      }, file);
    } catch {
      /* mutation toast */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="rounded-lg border bg-white shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        style={{ borderColor: '#e4e7e4' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: '#e4e7e4' }}>
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Receipt className="w-4 h-4" /> Spese bearbeiten
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Status: <Chip tone={(STATUS_CHIP[expense.status] ?? STATUS_CHIP.entwurf).tone}>{(STATUS_CHIP[expense.status] ?? STATUS_CHIP.entwurf).label}</Chip>
            </div>
          </div>
          <IconBtn onClick={onClose} title="Schliessen"><XIcon className="w-4 h-4" /></IconBtn>
        </div>

        <div className="p-5 space-y-3">
          {!editable && (
            <div className="rounded border p-2 text-xs" style={{ borderColor: '#f3d9a4', background: '#fff8e6', color: '#8a5a00' }}>
              Diese Spese ist bereits eingereicht / verbucht. Änderungen sind ggf. eingeschränkt.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Kategorie">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Datum">
              <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            </Field>
            <Field label="Zahlung">
              <Select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>

            {isKm && (
              <Field label="km" hint={`× CHF ${KM_RATE.toFixed(2)}`}>
                <Input type="number" step="1" min="0" value={form.km_count} onChange={(e) => setForm({ ...form, km_count: e.target.value })} />
              </Field>
            )}
            <Field label="Betrag CHF (brutto)">
              <Input type="number" step="0.05" min="0" value={form.amount_gross} onChange={(e) => setForm({ ...form, amount_gross: e.target.value })} />
            </Field>
            <Field label="MWST %" hint={vatAmt > 0 ? `MWST CHF ${fmt.chf(vatAmt)}` : null}>
              <Input type="number" step="0.1" min="0" value={form.vat_pct} onChange={(e) => setForm({ ...form, vat_pct: e.target.value })} />
            </Field>
          </div>

          <Field label="Beschreibung">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Projekt">
              <Select
                value={form.project_id}
                onChange={(e) => {
                  const pid = e.target.value;
                  const p = projects.find((x) => x.id === pid);
                  setForm({ ...form, project_id: pid, customer_id: p?.customer_id ?? form.customer_id });
                }}
              >
                <option value="">— kein Projekt —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.customer?.company_name ? ` · ${p.customer.company_name}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kunde">
              <Select
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                disabled={!!form.project_id}
              >
                <option value="">— kein Kunde —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.rebillable}
              onChange={(e) => setForm({ ...form, rebillable: e.target.checked })}
              style={{ accentColor: '#7a9b7f' }}
            />
            Weiterverrechenbar an Kunde
          </label>

          <Field label="Notizen (intern)">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
            />
          </Field>

          <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: '#eef1ee' }}>
            <label className={`${artisBtn.ghost} cursor-pointer`} style={artisGhostStyle} title="Beleg ersetzen / hinzufügen">
              <Upload className="w-3.5 h-3.5" />
              {file ? 'Beleg gewählt' : (expense.receipt_url ? 'Beleg ersetzen' : 'Beleg hochladen')}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {expense.receipt_url && !file && (
              <a href={expense.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs underline text-zinc-600">
                aktueller Beleg ansehen
              </a>
            )}
            {file && <span className="text-xs text-zinc-500 truncate max-w-xs">{file.name}</span>}
          </div>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: '#e4e7e4' }}>
          <button type="button" onClick={onClose} className={artisBtn.ghost} style={artisGhostStyle}>
            Abbrechen
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className={artisBtn.primary}
            style={{ ...artisPrimaryStyle, opacity: busy ? 0.45 : 1 }}
          >
            <Check className="w-3.5 h-3.5" />
            {busy ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
