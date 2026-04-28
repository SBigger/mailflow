import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  RefreshCw, Calendar, CalendarDays, Pause, Play, Plus, Pencil, Trash2,
  FileText, Receipt, AlertCircle, X,
} from 'lucide-react';
import {
  leRecurring, computeNextRecurringDate, leProject, customersForProjects,
  leInvoice, leInvoiceLine, leCompany,
} from '@/lib/leApi';
import {
  Chip, Card, IconBtn, Input, Select, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from '@/components/leistungserfassung/shared';

// ---------- helpers ----------
const todayIso = () => new Date().toISOString().slice(0, 10);

const CYCLE_OPTIONS = [
  { value: 'monthly',   label: 'Monatlich',     tone: 'blue'    },
  { value: 'quarterly', label: 'Quartalsweise', tone: 'violet'  },
  { value: 'semi',      label: 'Halbjährlich',  tone: 'orange'  },
  { value: 'yearly',    label: 'Jährlich',      tone: 'green'   },
  { value: 'custom',    label: 'Benutzerdef.',  tone: 'neutral' },
];

const cycleMeta = (cycle) =>
  CYCLE_OPTIONS.find((c) => c.value === cycle) ?? CYCLE_OPTIONS[CYCLE_OPTIONS.length - 1];

function CycleChip({ cycle, intervalMonths }) {
  const meta = cycleMeta(cycle);
  const label = cycle === 'custom' ? `Alle ${intervalMonths || 1} Mte.` : meta.label;
  return <Chip tone={meta.tone}>{label}</Chip>;
}

const lineTotal = (l) => Math.round(Number(l.hours || 0) * Number(l.rate || 0) * 100) / 100;
const sumLines = (lines) =>
  (lines || []).reduce((s, l) => s + lineTotal(l), 0);

const daysOverdue = (iso) => {
  if (!iso) return 0;
  const today = new Date(todayIso() + 'T00:00:00');
  const d = new Date(iso + 'T00:00:00');
  return Math.max(0, Math.floor((today - d) / (1000 * 60 * 60 * 24)));
};

const isEnded = (r) => !!(r.end_date && r.end_date < todayIso());

const EMPTY_LINE = { description: '', hours: '1', rate: '', vat_pct: '8.1' };

const EMPTY_RECURRING = {
  title: '',
  customer_id: '',
  project_id: '',
  cycle: 'monthly',
  interval_months: 1,
  start_date: todayIso(),
  end_date: '',
  next_date: todayIso(),
  payment_terms_days: 30,
  reference_prefix: '',
  template_lines: [{ ...EMPTY_LINE }],
  notes: '',
  active: true,
  paused: false,
};

// ---------- main panel ----------
export default function WiederkehrendePanel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('verwalten'); // 'verwalten' | 'faellig'
  const [statusFilter, setStatusFilter] = useState('alle'); // alle | aktiv | pausiert | beendet
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [generating, setGenerating] = useState(false);

  const recurringQ = useQuery({
    queryKey: ['le', 'recurring', 'list'],
    queryFn: () => leRecurring.list(),
  });
  const dueQ = useQuery({
    queryKey: ['le', 'recurring', 'due'],
    queryFn: () => leRecurring.due(),
    enabled: tab === 'faellig',
  });
  const customersQ = useQuery({
    queryKey: ['le', 'customers'],
    queryFn: customersForProjects,
  });
  const projectsQ = useQuery({
    queryKey: ['le', 'project', 'offen'],
    queryFn: () => leProject.list({ status: 'offen' }),
  });

  const createM = useMutation({
    mutationFn: (payload) => leRecurring.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'recurring'] });
      toast.success('Vorlage angelegt');
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const updateM = useMutation({
    mutationFn: ({ id, patch }) => leRecurring.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'recurring'] });
      toast.success('Vorlage gespeichert');
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const removeM = useMutation({
    mutationFn: (id) => leRecurring.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'recurring'] });
      toast.success('Vorlage gelöscht');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const pauseM = useMutation({
    mutationFn: (id) => leRecurring.pause(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['le', 'recurring'] }),
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const resumeM = useMutation({
    mutationFn: (id) => leRecurring.resume(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['le', 'recurring'] }),
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  // ---------- list filtering ----------
  const filteredList = useMemo(() => {
    const list = recurringQ.data ?? [];
    return list.filter((r) => {
      if (statusFilter === 'alle') return true;
      if (statusFilter === 'beendet') return isEnded(r);
      if (statusFilter === 'pausiert') return r.paused && !isEnded(r);
      if (statusFilter === 'aktiv') return r.active && !r.paused && !isEnded(r);
      return true;
    });
  }, [recurringQ.data, statusFilter]);

  // ---------- due selection ----------
  const dueList = dueQ.data ?? [];
  const dueTotal = useMemo(
    () => dueList.reduce((s, r) => s + sumLines(r.template_lines), 0),
    [dueList],
  );
  const allDueSelected = dueList.length > 0 && dueList.every((r) => selected.has(r.id));
  const toggleAllDue = () => {
    setSelected((prev) => {
      if (allDueSelected) return new Set();
      return new Set(dueList.map((r) => r.id));
    });
  };
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ---------- generate drafts ----------
  const generateDrafts = async () => {
    if (selected.size === 0) return;
    const items = dueList.filter((r) => selected.has(r.id));
    setGenerating(true);
    let created = 0;
    let failed = 0;
    try {
      const company = await leCompany.get().catch(() => null);

      for (const r of items) {
        try {
          const lines = r.template_lines || [];
          const subtotal = lines.reduce(
            (s, l) => s + Number(l.hours || 0) * Number(l.rate || 0),
            0,
          );
          const vatPct = Number(
            lines[0]?.vat_pct ?? company?.vat_default_pct ?? 8.1,
          );
          const vatAmount = Math.round(subtotal * vatPct) / 100;
          const total = Math.round((subtotal + vatAmount) * 100) / 100;

          const issueDate = r.next_date;
          const due = new Date(issueDate + 'T00:00:00');
          due.setDate(due.getDate() + Number(r.payment_terms_days || 30));

          const inv = await leInvoice.create({
            project_id: r.project_id,
            customer_id: r.customer_id,
            status: 'entwurf',
            issue_date: issueDate,
            due_date: due.toISOString().slice(0, 10),
            subtotal: Math.round(subtotal * 100) / 100,
            vat_pct: vatPct,
            vat_amount: vatAmount,
            total,
            notes: `Auto-generiert aus Wiederkehrende: ${r.title}`,
          });

          const invLines = lines.map((l, i) => ({
            invoice_id: inv.id,
            description: l.description,
            hours: l.hours !== '' && l.hours != null ? Number(l.hours) : null,
            rate: l.rate !== '' && l.rate != null ? Number(l.rate) : null,
            amount: lineTotal(l),
            sort_order: (i + 1) * 10,
          }));
          if (invLines.length) await leInvoiceLine.bulkCreate(invLines);

          const nextDate = computeNextRecurringDate(
            r.next_date,
            r.cycle,
            r.interval_months,
          );
          await leRecurring.update(r.id, {
            last_run_at: r.next_date,
            last_invoice_id: inv.id,
            next_date: nextDate,
          });
          created += 1;
        } catch (err) {
          failed += 1;
          console.error('Recurring draft failed', r.id, err);
        }
      }
    } finally {
      setGenerating(false);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['le', 'recurring'] });
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
    }
    if (failed === 0) {
      toast.success(`${created} Entwurf${created === 1 ? '' : 'sentwürfe'} erstellt`);
    } else {
      toast.warning(`${created} Entwürfe erstellt, ${failed} fehlgeschlagen`);
    }
  };

  if (recurringQ.isLoading) return <PanelLoader />;
  if (recurringQ.error)
    return <PanelError error={recurringQ.error} onRetry={() => recurringQ.refetch()} />;

  return (
    <div>
      <PanelHeader
        title="Wiederkehrende Rechnungen"
        subtitle="Vorlagen für regelmässige Fakturierung (BWL-Pauschalen, MWST-Abrechnungen, etc.)"
        right={
          <>
            <div
              className="inline-flex rounded border overflow-hidden"
              style={{ borderColor: '#d1dcd1' }}
            >
              {[
                { k: 'verwalten', lbl: 'Verwalten', icon: RefreshCw },
                { k: 'faellig',   lbl: 'Fällig generieren', icon: CalendarDays },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.k}
                    onClick={() => setTab(t.k)}
                    className="px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
                    style={{
                      background: tab === t.k ? '#7a9b7f' : '#fff',
                      color: tab === t.k ? '#fff' : '#3d4a3d',
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.lbl}
                  </button>
                );
              })}
            </div>
            {tab === 'verwalten' && (
              <button
                className={artisBtn.primary}
                style={artisPrimaryStyle}
                onClick={() => { setEditing(null); setDialogOpen(true); }}
              >
                <Plus className="w-4 h-4" /> Neue Vorlage
              </button>
            )}
          </>
        }
      />

      {tab === 'verwalten' && (
        <VerwaltenTab
          list={filteredList}
          allCount={(recurringQ.data ?? []).length}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          onEdit={(r) => { setEditing(r); setDialogOpen(true); }}
          onPause={(r) => pauseM.mutate(r.id)}
          onResume={(r) => resumeM.mutate(r.id)}
          onDelete={(r) => {
            if (confirm(`Vorlage "${r.title}" wirklich löschen?`)) removeM.mutate(r.id);
          }}
        />
      )}

      {tab === 'faellig' && (
        <FaelligTab
          loading={dueQ.isLoading}
          error={dueQ.error}
          retry={() => dueQ.refetch()}
          list={dueList}
          total={dueTotal}
          selected={selected}
          allSelected={allDueSelected}
          onToggleAll={toggleAllDue}
          onToggleOne={toggleOne}
          onGenerate={generateDrafts}
          generating={generating}
        />
      )}

      {dialogOpen && (
        <RecurringDialog
          editing={editing}
          customers={customersQ.data ?? []}
          projects={projectsQ.data ?? []}
          onClose={() => setDialogOpen(false)}
          onSave={(payload) => {
            if (editing) updateM.mutate({ id: editing.id, patch: payload });
            else createM.mutate(payload);
          }}
          saving={createM.isPending || updateM.isPending}
        />
      )}
    </div>
  );
}

// ---------- Verwalten Tab ----------
function VerwaltenTab({
  list, allCount, statusFilter, setStatusFilter,
  onEdit, onPause, onResume, onDelete,
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div
          className="inline-flex rounded border overflow-hidden"
          style={{ borderColor: '#d1dcd1' }}
        >
          {[
            { k: 'alle',     lbl: 'Alle' },
            { k: 'aktiv',    lbl: 'Aktiv' },
            { k: 'pausiert', lbl: 'Pausiert' },
            { k: 'beendet',  lbl: 'Beendet' },
          ].map((f) => (
            <button
              key={f.k}
              onClick={() => setStatusFilter(f.k)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: statusFilter === f.k ? '#7a9b7f' : '#fff',
                color: statusFilter === f.k ? '#fff' : '#3d4a3d',
              }}
            >
              {f.lbl}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-zinc-500">
          {list.length} von {allCount} Vorlage{allCount === 1 ? '' : 'n'}
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-[11px] uppercase tracking-wider text-zinc-500 border-b"
                style={{ borderColor: '#e4e7e4' }}
              >
                <th className="px-3 py-2 font-semibold">Titel</th>
                <th className="px-3 py-2 font-semibold">Kunde</th>
                <th className="px-3 py-2 font-semibold">Projekt</th>
                <th className="px-3 py-2 font-semibold">Zyklus</th>
                <th className="px-3 py-2 font-semibold">Nächstes</th>
                <th className="px-3 py-2 font-semibold">Letzte Ausführung</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-zinc-400 text-xs">
                    Keine Vorlagen in dieser Ansicht.
                  </td>
                </tr>
              )}
              {list.map((r) => {
                const ended = isEnded(r);
                return (
                  <tr
                    key={r.id}
                    className="border-b last:border-0 hover:bg-zinc-50/60"
                    style={{ borderColor: '#eef0ee' }}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.title}</div>
                      {r.template_lines?.length ? (
                        <div className="text-[11px] text-zinc-500">
                          {r.template_lines.length} Position{r.template_lines.length === 1 ? '' : 'en'} ·
                          CHF {fmt.chf(sumLines(r.template_lines))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {r.customer?.company_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-600 text-xs">
                      {r.project?.name ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <CycleChip cycle={r.cycle} intervalMonths={r.interval_months} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmt.date(r.next_date)}</td>
                    <td className="px-3 py-2 text-zinc-600 text-xs">
                      {r.last_run_at ? fmt.date(r.last_run_at) : '—'}
                      {r.last_invoice?.invoice_no && (
                        <span className="ml-1 text-zinc-400">· {r.last_invoice.invoice_no}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {ended
                        ? <Chip tone="neutral">Beendet</Chip>
                        : !r.active
                          ? <Chip tone="neutral">Inaktiv</Chip>
                          : r.paused
                            ? <Chip tone="orange">Pausiert</Chip>
                            : <Chip tone="green">Aktiv</Chip>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn title="Bearbeiten" onClick={() => onEdit(r)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </IconBtn>
                        {r.paused ? (
                          <IconBtn title="Fortsetzen" onClick={() => onResume(r)}>
                            <Play className="w-3.5 h-3.5" />
                          </IconBtn>
                        ) : (
                          <IconBtn title="Pausieren" onClick={() => onPause(r)}>
                            <Pause className="w-3.5 h-3.5" />
                          </IconBtn>
                        )}
                        <IconBtn danger title="Löschen" onClick={() => onDelete(r)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ---------- Fällig Tab ----------
function FaelligTab({
  loading, error, retry, list, total,
  selected, allSelected, onToggleAll, onToggleOne,
  onGenerate, generating,
}) {
  if (loading) return <PanelLoader />;
  if (error) return <PanelError error={error} onRetry={retry} />;

  const selectedTotal = list
    .filter((r) => selected.has(r.id))
    .reduce((s, r) => s + sumLines(r.template_lines), 0);

  return (
    <>
      <Card className="mb-3">
        <div className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
          <CalendarDays className="w-4 h-4 text-zinc-500" />
          <span className="font-semibold">{list.length}</span>
          <span className="text-zinc-600">
            Vorlage{list.length === 1 ? '' : 'n'} fällig
          </span>
          <span className="text-zinc-300">·</span>
          <span className="text-zinc-600">Total</span>
          <span className="font-semibold tabular-nums">CHF {fmt.chf(total)}</span>
          {list.length === 0 && (
            <span className="ml-auto text-xs text-zinc-400 inline-flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Keine Vorlagen sind aktuell fällig.
            </span>
          )}
        </div>
      </Card>

      {list.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[11px] uppercase tracking-wider text-zinc-500 border-b"
                  style={{ borderColor: '#e4e7e4' }}
                >
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={onToggleAll}
                    />
                  </th>
                  <th className="px-3 py-2 font-semibold">Titel</th>
                  <th className="px-3 py-2 font-semibold">Kunde</th>
                  <th className="px-3 py-2 font-semibold">Nächstes Datum</th>
                  <th className="px-3 py-2 font-semibold">Tage überfällig</th>
                  <th className="px-3 py-2 font-semibold text-right">Total CHF</th>
                  <th className="px-3 py-2 font-semibold">Letzte Generierung</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const isSel = selected.has(r.id);
                  const ov = daysOverdue(r.next_date);
                  const sub = sumLines(r.template_lines);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onToggleOne(r.id)}
                      className="border-b last:border-0 hover:bg-zinc-50/60 cursor-pointer"
                      style={{
                        borderColor: '#eef0ee',
                        background: isSel ? '#f4f8f4' : undefined,
                      }}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => onToggleOne(r.id)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.title}</div>
                        <div className="text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
                          <CycleChip cycle={r.cycle} intervalMonths={r.interval_months} />
                          {r.template_lines?.length || 0} Pos.
                        </div>
                      </td>
                      <td className="px-3 py-2 text-zinc-700">
                        {r.customer?.company_name ?? '—'}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmt.date(r.next_date)}</td>
                      <td className="px-3 py-2">
                        {ov > 0
                          ? <Chip tone={ov > 30 ? 'red' : 'orange'}>{ov} Tag{ov === 1 ? '' : 'e'}</Chip>
                          : <Chip tone="green">heute</Chip>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(sub)}</td>
                      <td className="px-3 py-2 text-zinc-600 text-xs">
                        {r.last_run_at ? fmt.date(r.last_run_at) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selected.size > 0 && (
        <div
          className="sticky bottom-3 mt-4 flex items-center justify-between gap-3 rounded-lg border shadow-md px-4 py-3 bg-white"
          style={{ borderColor: '#d1dcd1' }}
        >
          <div className="text-sm">
            <span className="font-semibold">{selected.size}</span>
            <span className="text-zinc-600"> ausgewählt · </span>
            <span className="tabular-nums font-semibold">CHF {fmt.chf(selectedTotal)}</span>
            <span className="text-zinc-500"> (netto)</span>
          </div>
          <button
            className={artisBtn.primary}
            style={{ ...artisPrimaryStyle, opacity: generating ? 0.6 : 1 }}
            onClick={onGenerate}
            disabled={generating}
          >
            <FileText className="w-4 h-4" />
            {generating
              ? 'Generiere…'
              : `Entwürfe generieren (${selected.size})`}
          </button>
        </div>
      )}
    </>
  );
}

// ---------- Dialog ----------
function RecurringDialog({ editing, customers, projects, onClose, onSave, saving }) {
  const [form, setForm] = useState(() => {
    if (editing) {
      return {
        title: editing.title ?? '',
        customer_id: editing.customer_id ?? '',
        project_id: editing.project_id ?? '',
        cycle: editing.cycle ?? 'monthly',
        interval_months: editing.interval_months ?? 1,
        start_date: editing.start_date ?? todayIso(),
        end_date: editing.end_date ?? '',
        next_date: editing.next_date ?? todayIso(),
        payment_terms_days: editing.payment_terms_days ?? 30,
        reference_prefix: editing.reference_prefix ?? '',
        template_lines: editing.template_lines?.length
          ? editing.template_lines.map((l) => ({
              description: l.description ?? '',
              hours: l.hours ?? '',
              rate: l.rate ?? '',
              vat_pct: l.vat_pct ?? '8.1',
            }))
          : [{ ...EMPTY_LINE }],
        notes: editing.notes ?? '',
        active: editing.active ?? true,
        paused: editing.paused ?? false,
      };
    }
    return { ...EMPTY_RECURRING, template_lines: [{ ...EMPTY_LINE }] };
  });

  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onCustomerChange = (id) => {
    setForm((f) => {
      const next = { ...f, customer_id: id };
      // Reset project if it doesn't belong to this customer
      if (f.project_id) {
        const proj = projects.find((p) => String(p.id) === String(f.project_id));
        if (!proj || String(proj.customer_id ?? '') !== String(id)) {
          next.project_id = '';
        }
      }
      return next;
    });
  };

  const onStartChange = (v) => {
    setForm((f) => {
      const next = { ...f, start_date: v };
      // wenn next_date noch leer/auf Default war, mitziehen
      if (!editing && (!f.next_date || f.next_date === f.start_date)) {
        next.next_date = v;
      }
      return next;
    });
  };

  const filteredProjects = useMemo(() => {
    if (!form.customer_id) return projects;
    return projects.filter(
      (p) => String(p.customer_id ?? '') === String(form.customer_id),
    );
  }, [projects, form.customer_id]);

  const updateLine = (idx, key, value) => {
    setForm((f) => {
      const lines = [...(f.template_lines || [])];
      lines[idx] = { ...lines[idx], [key]: value };
      return { ...f, template_lines: lines };
    });
  };
  const addLine = () => {
    setForm((f) => ({
      ...f,
      template_lines: [...(f.template_lines || []), { ...EMPTY_LINE }],
    }));
  };
  const removeLine = (idx) => {
    setForm((f) => {
      const lines = (f.template_lines || []).filter((_, i) => i !== idx);
      return {
        ...f,
        template_lines: lines.length ? lines : [{ ...EMPTY_LINE }],
      };
    });
  };

  const subtotal = sumLines(form.template_lines);

  const submit = (e) => {
    e.preventDefault();
    if (!form.title?.trim()) { toast.error('Titel ist Pflicht'); return; }
    if (!form.customer_id) { toast.error('Kunde ist Pflicht'); return; }
    if (!form.next_date) { toast.error('Nächstes Datum ist Pflicht'); return; }

    const payload = {
      title: form.title.trim(),
      customer_id: form.customer_id,
      project_id: form.project_id || null,
      cycle: form.cycle,
      interval_months: form.cycle === 'custom'
        ? Math.max(1, Number(form.interval_months) || 1)
        : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      next_date: form.next_date,
      payment_terms_days: Number(form.payment_terms_days) || 30,
      reference_prefix: form.reference_prefix?.trim() || null,
      template_lines: (form.template_lines || []).map((l) => ({
        description: (l.description ?? '').trim(),
        hours: l.hours !== '' && l.hours != null ? Number(l.hours) : null,
        rate: l.rate !== '' && l.rate != null ? Number(l.rate) : null,
        vat_pct: l.vat_pct !== '' && l.vat_pct != null ? Number(l.vat_pct) : null,
      })),
      notes: form.notes?.trim() || null,
      active: !!form.active,
      paused: !!form.paused,
    };
    onSave(payload);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(30,40,30,0.35)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-10"
        style={{ border: '1px solid #e4e7e4' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: '#eef0ee' }}
        >
          <h3 className="text-base font-semibold inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-zinc-500" />
            {editing ? 'Vorlage bearbeiten' : 'Neue wiederkehrende Vorlage'}
          </h3>
          <IconBtn title="Schliessen" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconBtn>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <Field label="Titel">
            <Input
              value={form.title}
              onChange={(e) => patch('title', e.target.value)}
              placeholder="z.B. BWL Monatspauschale Huber AG"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kunde">
              <Select
                value={form.customer_id ?? ''}
                onChange={(e) => onCustomerChange(e.target.value)}
              >
                <option value="">— Kunde wählen —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Projekt (optional)">
              <Select
                value={form.project_id ?? ''}
                onChange={(e) => patch('project_id', e.target.value)}
                disabled={!form.customer_id}
              >
                <option value="">— ohne Projektzuordnung —</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_no ? `${p.project_no} · ` : ''}{p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Zyklus">
              <Select
                value={form.cycle}
                onChange={(e) => patch('cycle', e.target.value)}
              >
                {CYCLE_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </Field>
            {form.cycle === 'custom' && (
              <Field label="Intervall (Monate)">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.interval_months}
                  onChange={(e) => patch('interval_months', e.target.value)}
                />
              </Field>
            )}
            <Field label="Zahlungsfrist (Tage)">
              <Input
                type="number"
                min="0"
                step="1"
                value={form.payment_terms_days}
                onChange={(e) => patch('payment_terms_days', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Start-Datum">
              <Input
                type="date"
                value={form.start_date ?? ''}
                onChange={(e) => onStartChange(e.target.value)}
              />
            </Field>
            <Field label="End-Datum (optional)">
              <Input
                type="date"
                value={form.end_date ?? ''}
                onChange={(e) => patch('end_date', e.target.value)}
              />
            </Field>
            <Field label="Nächstes Datum" hint="wird nach jeder Generierung automatisch fortgeschrieben">
              <Input
                type="date"
                value={form.next_date ?? ''}
                onChange={(e) => patch('next_date', e.target.value)}
              />
            </Field>
          </div>

          <Field label="Referenz-Präfix (optional)" hint={'z.B. „BWL-2026" – wird auf Rechnungs-Notiz angehängt'}>
            <Input
              value={form.reference_prefix ?? ''}
              onChange={(e) => patch('reference_prefix', e.target.value)}
              placeholder="optional"
            />
          </Field>

          {/* Template-Lines Editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold inline-flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5" />
                Positionen (Template)
              </span>
              <button
                type="button"
                onClick={addLine}
                className={artisBtn.ghost}
                style={artisGhostStyle}
              >
                <Plus className="w-3.5 h-3.5" />
                Position
              </button>
            </div>
            <div
              className="rounded border overflow-hidden"
              style={{ borderColor: '#e4e7e4' }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-[11px] uppercase tracking-wider text-zinc-500 border-b bg-zinc-50/60"
                    style={{ borderColor: '#e4e7e4' }}
                  >
                    <th className="px-2 py-1.5 font-semibold">Beschreibung</th>
                    <th className="px-2 py-1.5 font-semibold w-24">Stunden</th>
                    <th className="px-2 py-1.5 font-semibold w-28">Satz CHF</th>
                    <th className="px-2 py-1.5 font-semibold w-20">MWST %</th>
                    <th className="px-2 py-1.5 font-semibold w-28 text-right">Betrag</th>
                    <th className="px-2 py-1.5 w-9"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.template_lines.map((l, idx) => (
                    <tr
                      key={idx}
                      className="border-b last:border-0"
                      style={{ borderColor: '#eef0ee' }}
                    >
                      <td className="px-2 py-1.5">
                        <Input
                          value={l.description ?? ''}
                          onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          placeholder="z.B. Buchhaltung Monat …"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          step="0.25"
                          min="0"
                          value={l.hours ?? ''}
                          onChange={(e) => updateLine(idx, 'hours', e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.rate ?? ''}
                          onChange={(e) => updateLine(idx, 'rate', e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          value={l.vat_pct ?? ''}
                          onChange={(e) => updateLine(idx, 'vat_pct', e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">
                        {fmt.chf(lineTotal(l))}
                      </td>
                      <td className="px-2 py-1.5">
                        <IconBtn
                          danger
                          title="Position entfernen"
                          onClick={() => removeLine(idx)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </IconBtn>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50/60">
                    <td colSpan={4} className="px-2 py-1.5 text-right text-xs text-zinc-500 uppercase tracking-wider">
                      Zwischensumme (netto)
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                      CHF {fmt.chf(subtotal)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <Field label="Notizen">
            <textarea
              value={form.notes ?? ''}
              onChange={(e) => patch('notes', e.target.value)}
              rows={2}
              className="w-full border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
              placeholder="Interne Bemerkungen zur Vorlage…"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-4 pt-2 text-sm">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!form.active}
                onChange={(e) => patch('active', e.target.checked)}
              />
              Aktiv
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!form.paused}
                onChange={(e) => patch('paused', e.target.checked)}
              />
              Pausiert
            </label>
          </div>

          <div
            className="flex items-center justify-end gap-2 pt-2 border-t"
            style={{ borderColor: '#eef0ee' }}
          >
            <button
              type="button"
              className={artisBtn.ghost}
              style={artisGhostStyle}
              onClick={onClose}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saving}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Speichere…' : (editing ? 'Speichern' : 'Anlegen')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
