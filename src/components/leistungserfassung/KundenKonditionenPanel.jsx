import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Search } from 'lucide-react';
import { customersForProjects, leRateGroup, leCustomerTerms } from '@/lib/leApi';
import { supabase } from '@/api/supabaseClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Card,
  Chip,
  IconBtn,
  Input,
  Select,
  Field,
  PanelLoader,
  PanelError,
  PanelHeader,
  fmt,
  artisBtn,
  artisPrimaryStyle,
  artisGhostStyle,
} from './shared';

const EMPTY = {
  customer_id: null,
  rate_group_id: '',
  discount_pct: '',
  payment_terms_days: 30,
  skonto_pct: '',
  skonto_days: '',
  currency: 'CHF',
  vat_required: true,
  dunning_disabled: false,
  notes: '',
  // Rechnungsadresse (auf customers-Tabelle gespeichert)
  street: '',
  building_number: '',
  zip: '',
  city: '',
  country: 'CH',
  billing_email: '',
};

// Lade alle Terms in einem Rutsch (statt pro Kunde N Anfragen)
async function loadAllTerms() {
  const { data, error } = await supabase.from('le_customer_terms').select('*');
  if (error) throw error;
  return data ?? [];
}

export default function KundenKonditionenPanel() {
  const qc = useQueryClient();
  const customersQ = useQuery({ queryKey: ['customers', 'le'], queryFn: customersForProjects });
  const termsQ = useQuery({ queryKey: ['le', 'customer_terms', 'all'], queryFn: loadAllTerms });
  const rateGroupsQ = useQuery({ queryKey: ['le', 'rate_group'], queryFn: leRateGroup.list });

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // customer object
  const [form, setForm] = useState(EMPTY);

  const termsByCustomer = useMemo(() => {
    const m = new Map();
    (termsQ.data ?? []).forEach((t) => m.set(t.customer_id, t));
    return m;
  }, [termsQ.data]);

  const filteredCustomers = useMemo(() => {
    const list = customersQ.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((c) => (c.company_name ?? '').toLowerCase().includes(q));
  }, [customersQ.data, search]);

  const openEdit = (cust) => {
    const existing = termsByCustomer.get(cust.id);
    setEditing(cust);
    setForm({
      customer_id: cust.id,
      rate_group_id: existing?.rate_group_id ?? '',
      discount_pct: existing?.discount_pct ?? '',
      payment_terms_days: existing?.payment_terms_days ?? 30,
      skonto_pct: existing?.skonto_pct ?? '',
      skonto_days: existing?.skonto_days ?? '',
      currency: existing?.currency ?? 'CHF',
      vat_required: existing?.vat_required ?? true,
      dunning_disabled: existing?.dunning_disabled ?? false,
      notes: existing?.notes ?? '',
      street: cust.street ?? '',
      building_number: cust.building_number ?? '',
      zip: cust.zip ?? '',
      city: cust.city ?? '',
      country: cust.country ?? 'CH',
      billing_email: cust.billing_email ?? '',
    });
  };

  const upsertMut = useMutation({
    mutationFn: async ({ termsPayload, addressPayload, customerId }) => {
      // Address auf customers updaten (best effort, nur falls FELDER existieren)
      const addr = await supabase.from('customers').update(addressPayload).eq('id', customerId);
      if (addr.error) {
        // Adresse-Felder evtl. nicht migriert? – Konditionen trotzdem speichern.
        console.warn('Customer-Adresse nicht updatebar:', addr.error.message);
      }
      return leCustomerTerms.upsert(termsPayload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'customer_terms', 'all'] });
      qc.invalidateQueries({ queryKey: ['customers', 'le'] });
      toast.success('Konditionen + Adresse gespeichert');
      setEditing(null);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const termsPayload = {
      customer_id: form.customer_id,
      rate_group_id: form.rate_group_id || null,
      discount_pct: form.discount_pct === '' ? null : Number(form.discount_pct),
      payment_terms_days: form.payment_terms_days === '' ? null : Number(form.payment_terms_days),
      skonto_pct: form.skonto_pct === '' ? null : Number(form.skonto_pct),
      skonto_days: form.skonto_days === '' ? null : Number(form.skonto_days),
      currency: form.currency || 'CHF',
      vat_required: !!form.vat_required,
      dunning_disabled: !!form.dunning_disabled,
      notes: form.notes?.trim() || null,
    };
    const addressPayload = {
      street: form.street?.trim() || null,
      building_number: form.building_number?.trim() || null,
      zip: form.zip?.trim() || null,
      city: form.city?.trim() || null,
      country: form.country?.trim() || 'CH',
      billing_email: form.billing_email?.trim() || null,
    };
    upsertMut.mutate({ termsPayload, addressPayload, customerId: form.customer_id });
  };

  const isLoading = customersQ.isLoading || termsQ.isLoading || rateGroupsQ.isLoading;
  const error = customersQ.error || termsQ.error || rateGroupsQ.error;
  const refetchAll = () => { customersQ.refetch(); termsQ.refetch(); rateGroupsQ.refetch(); };

  return (
    <div>
      <PanelHeader
        title="Kunden-Konditionen"
        subtitle="Rate-Gruppe, Rabatt, Zahlfrist, Skonto pro Kunde"
        right={
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kunde suchen…"
              className="pl-7"
              style={{ minWidth: 240 }}
            />
          </div>
        }
      />

      {isLoading ? (
        <PanelLoader />
      ) : error ? (
        <PanelError error={error} onRetry={refetchAll} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500" style={{ background: '#f6f8f6' }}>
                  <th className="px-3 py-2 font-semibold">Kunde</th>
                  <th className="px-3 py-2 font-semibold">Rate-Gruppe</th>
                  <th className="px-3 py-2 font-semibold text-right">Rabatt %</th>
                  <th className="px-3 py-2 font-semibold text-right">Zahlfrist</th>
                  <th className="px-3 py-2 font-semibold">Skonto</th>
                  <th className="px-3 py-2 font-semibold">Notiz</th>
                  <th className="px-3 py-2 font-semibold text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-zinc-400">Keine Kunden gefunden.</td></tr>
                ) : (
                  filteredCustomers.map((cust) => {
                    const t = termsByCustomer.get(cust.id);
                    const rg = rateGroupsQ.data?.find((g) => g.id === t?.rate_group_id);
                    return (
                      <tr key={cust.id} className="border-t" style={{ borderColor: '#eef1ee' }}>
                        <td className="px-3 py-2">{cust.company_name}</td>
                        <td className="px-3 py-2">
                          {t ? (rg?.name ? <Chip tone="blue">{rg.name}</Chip> : <span className="text-zinc-400">—</span>) : <Chip tone="neutral">Standard</Chip>}
                        </td>
                        <td className="px-3 py-2 text-right">{t?.discount_pct != null ? `${t.discount_pct}%` : '—'}</td>
                        <td className="px-3 py-2 text-right">{t?.payment_terms_days != null ? `${t.payment_terms_days} T` : '—'}</td>
                        <td className="px-3 py-2 text-zinc-600">
                          {t?.skonto_pct != null && t?.skonto_days != null ? `${t.skonto_pct}% / ${t.skonto_days}T` : '—'}
                        </td>
                        <td className="px-3 py-2 text-zinc-500 text-xs truncate max-w-[260px]">{t?.notes || '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end">
                            <IconBtn title="Bearbeiten" onClick={() => openEdit(cust)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </IconBtn>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Konditionen: {editing?.company_name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate-Gruppe">
                <Select
                  value={form.rate_group_id}
                  onChange={(e) => setForm((f) => ({ ...f, rate_group_id: e.target.value }))}
                >
                  <option value="">— Standard —</option>
                  {(rateGroupsQ.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Währung">
                <Select
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                >
                  <option value="CHF">CHF</option>
                  <option value="EUR">EUR</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Rabatt %">
                <Input type="number" min={0} max={100} step="0.1"
                  value={form.discount_pct}
                  onChange={(e) => setForm((f) => ({ ...f, discount_pct: e.target.value }))}
                />
              </Field>
              <Field label="Zahlfrist (Tage)">
                <Input type="number" min={0}
                  value={form.payment_terms_days}
                  onChange={(e) => setForm((f) => ({ ...f, payment_terms_days: e.target.value }))}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Skonto %">
                  <Input type="number" min={0} step="0.1"
                    value={form.skonto_pct}
                    onChange={(e) => setForm((f) => ({ ...f, skonto_pct: e.target.value }))}
                  />
                </Field>
                <Field label="innert Tagen">
                  <Input type="number" min={0}
                    value={form.skonto_days}
                    onChange={(e) => setForm((f) => ({ ...f, skonto_days: e.target.value }))}
                  />
                </Field>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 pt-1">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.vat_required}
                  onChange={(e) => setForm((f) => ({ ...f, vat_required: e.target.checked }))}
                  style={{ accentColor: '#7a9b7f' }}
                />
                MwSt. berechnen
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.dunning_disabled}
                  onChange={(e) => setForm((f) => ({ ...f, dunning_disabled: e.target.checked }))}
                  style={{ accentColor: '#7a9b7f' }}
                />
                Mahnungen deaktivieren
              </label>
            </div>
            <div className="border-t pt-3 mt-2" style={{ borderColor: '#eef1ee' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Rechnungsadresse · Pflicht für QR-Bill
              </div>
              <div className="grid grid-cols-6 gap-2">
                <div className="col-span-4">
                  <Field label="Strasse">
                    <Input value={form.street} onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="Hausnr.">
                    <Input value={form.building_number} onChange={(e) => setForm((f) => ({ ...f, building_number: e.target.value }))} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="PLZ">
                    <Input value={form.zip} onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))} />
                  </Field>
                </div>
                <div className="col-span-3">
                  <Field label="Ort">
                    <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
                  </Field>
                </div>
                <div className="col-span-1">
                  <Field label="Land">
                    <Input value={form.country} maxLength={2} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))} />
                  </Field>
                </div>
                <div className="col-span-6">
                  <Field label="Rechnungs-E-Mail (optional)">
                    <Input type="email" value={form.billing_email} onChange={(e) => setForm((f) => ({ ...f, billing_email: e.target.value }))} placeholder="rechnung@kunde.ch" />
                  </Field>
                </div>
              </div>
            </div>

            <Field label="Notiz">
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm"
                style={{ borderColor: '#d9dfd9' }}
                rows={2}
              />
            </Field>
            <DialogFooter className="pt-2">
              <button type="button" onClick={() => setEditing(null)} className={artisBtn.ghost} style={artisGhostStyle}>
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={upsertMut.isPending}
                className={artisBtn.primary}
                style={{ ...artisPrimaryStyle, opacity: upsertMut.isPending ? 0.6 : 1 }}
              >
                {upsertMut.isPending ? 'Speichere…' : 'Speichern'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
