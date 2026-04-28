import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Building2, MapPin, Banknote, FileText, FileDown } from 'lucide-react';
import { leCompany } from '@/lib/leApi';
import { generateInvoicePdf, triggerDownload } from '@/lib/leInvoicePdf';
import {
  Card,
  Input,
  Field,
  PanelLoader,
  PanelError,
  PanelHeader,
  artisBtn,
  artisPrimaryStyle,
} from './shared';

const EMPTY = {
  company_name: '',
  vat_no: '',
  uid: '',
  email: '',
  phone: '',
  website: '',
  bank_name: '',
  street: '',
  building_number: '',
  zip: '',
  city: '',
  country: 'CH',
  iban: '',
  qr_iban: '',
  vat_default_pct: 8.1,
  payment_terms_days: 30,
  logo_url: '',
  letter_intro: '',
  invoice_footer: '',
};

const Section = ({ icon: Icon, title, children }) => (
  <Card className="p-4">
    <div className="flex items-center gap-2 mb-3 pb-2 border-b" style={{ borderColor: '#eef1ee' }}>
      <Icon className="w-4 h-4 text-[#7a9b7f]" />
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
    {children}
  </Card>
);

// "mode" prop: 'full' (default) zeigt alle Sektionen; 'templates' zeigt nur Briefkopf/Footer/Logo
export default function FirmenSettingsPanel({ mode = 'full' } = {}) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['le', 'company'],
    queryFn: leCompany.get,
  });

  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (data) {
      setForm({
        ...EMPTY,
        ...Object.fromEntries(Object.entries(data).filter(([k]) => k in EMPTY)),
      });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (patch) => leCompany.update(data.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'company'] });
      toast.success('Firmen-Einstellungen gespeichert');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = (e) => {
    e?.preventDefault?.();
    if (!data) return toast.error('Keine Firmen-Einstellungen vorhanden');
    const payload = {
      ...form,
      vat_default_pct: form.vat_default_pct === '' ? null : Number(form.vat_default_pct),
      payment_terms_days: form.payment_terms_days === '' ? null : Number(form.payment_terms_days),
    };
    saveMut.mutate(payload);
  };

  if (isLoading) return <PanelLoader />;
  if (error) return <PanelError error={error} onRetry={refetch} />;

  return (
    <form onSubmit={handleSave}>
      <PanelHeader
        title={mode === 'templates' ? 'Rechnungs-Templates' : 'Firmen-Einstellungen'}
        subtitle={mode === 'templates'
          ? 'Logo, Briefkopf-Text, Fusszeile'
          : 'Stammdaten der eigenen Firma (Singleton)'}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!form.company_name) return toast.error('Bitte erst Firmen-Settings speichern.');
                const dummyInvoice = {
                  id: 'preview-test',
                  invoice_no: 'R-2026-TEST',
                  customer_id: '00000000-0000-0000-0000-000000000000',
                  customer: { company_name: 'Muster AG', street: 'Beispielstrasse', building_number: '12', zip: '8000', city: 'Zürich', country: 'CH' },
                  issue_date: new Date().toISOString().slice(0, 10),
                  due_date: new Date(Date.now() + 30*86400000).toISOString().slice(0, 10),
                  period_from: null, period_to: null,
                  subtotal: 1500, vat_pct: 8.1, vat_amount: 121.50, total: 1621.50,
                  discount_pct: 0, discount_amount: 0,
                  notes: 'Test-Rechnung – PDF/QR-Bill-Vorschau',
                  lines: [
                    { description: 'Buchhaltung Q1 2026', hours: 8, rate: 145, amount: 1160 },
                    { description: 'MWST-Abrechnung', hours: 2, rate: 170, amount: 340 },
                  ],
                };
                try {
                  const result = await generateInvoicePdf({ invoice: dummyInvoice, company: { ...form, id: data?.id } });
                  if (result.blob) triggerDownload(result.blob, 'Test-Rechnung.pdf');
                  toast.success('Test-PDF erzeugt' + (result.url ? ' und gespeichert' : ''));
                } catch (e) { toast.error('PDF-Fehler: ' + (e?.message ?? e)); console.error(e); }
              }}
              className={artisBtn.ghost}
              style={{ borderColor: '#d1dcd1', color: '#3d4a3d', background: '#fff' }}
            >
              <FileDown className="w-4 h-4" /> Test-PDF
            </button>
            <button
              type="submit"
              disabled={saveMut.isPending}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: saveMut.isPending ? 0.6 : 1 }}
            >
              <Save className="w-4 h-4" /> {saveMut.isPending ? 'Speichere…' : 'Speichern'}
            </button>
          </div>
        }
      />

      {!data && (
        <Card className="p-4 mb-4 text-sm" style={{ background: '#fff8e6', borderColor: '#f3d9a4', color: '#8a5a00' }}>
          Es wurde noch kein Firmen-Datensatz angelegt. Bitte zuerst über Migration oder SQL einen Eintrag in <code>le_company_settings</code> erzeugen.
        </Card>
      )}

      <div className="space-y-4">
        {mode === 'full' && (
          <>
            <Section icon={Building2} title="Firma">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Firmenname">
                  <Input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} />
                </Field>
                <Field label="UID (CHE-...)">
                  <Input value={form.uid} onChange={(e) => set('uid', e.target.value)} placeholder="CHE-123.456.789" />
                </Field>
                <Field label="MwSt-Nr.">
                  <Input value={form.vat_no} onChange={(e) => set('vat_no', e.target.value)} />
                </Field>
                <Field label="E-Mail">
                  <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
                </Field>
                <Field label="Telefon">
                  <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
                </Field>
                <Field label="Website">
                  <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
                </Field>
                <Field label="Bank (Name)">
                  <Input value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} />
                </Field>
              </div>
            </Section>

            <Section icon={MapPin} title="Adresse">
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-4">
                  <Field label="Strasse">
                    <Input value={form.street} onChange={(e) => set('street', e.target.value)} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="Hausnummer">
                    <Input value={form.building_number} onChange={(e) => set('building_number', e.target.value)} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="PLZ">
                    <Input value={form.zip} onChange={(e) => set('zip', e.target.value)} />
                  </Field>
                </div>
                <div className="col-span-3">
                  <Field label="Ort">
                    <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
                  </Field>
                </div>
                <div className="col-span-1">
                  <Field label="Land">
                    <Input value={form.country} onChange={(e) => set('country', e.target.value)} maxLength={2} />
                  </Field>
                </div>
              </div>
            </Section>

            <Section icon={Banknote} title="Bank & Zahlung">
              <div className="grid grid-cols-2 gap-3">
                <Field label="IBAN">
                  <Input value={form.iban} onChange={(e) => set('iban', e.target.value)} placeholder="CH..." />
                </Field>
                <Field label="QR-IBAN" hint="für QR-Rechnung">
                  <Input value={form.qr_iban} onChange={(e) => set('qr_iban', e.target.value)} placeholder="CH..." />
                </Field>
                <Field label="MwSt Standard %">
                  <Input type="number" min={0} step="0.1" value={form.vat_default_pct} onChange={(e) => set('vat_default_pct', e.target.value)} />
                </Field>
                <Field label="Zahlfrist Standard (Tage)">
                  <Input type="number" min={0} value={form.payment_terms_days} onChange={(e) => set('payment_terms_days', e.target.value)} />
                </Field>
              </div>
            </Section>
          </>
        )}

        <Section icon={FileText} title="Briefkopf & Fusszeile">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Logo-URL" hint="öffentlich erreichbarer Bild-Link">
                <Input value={form.logo_url} onChange={(e) => set('logo_url', e.target.value)} placeholder="https://…/logo.png" />
              </Field>
            </div>
            <div className="col-span-1">
              {form.logo_url ? (
                <div className="border rounded p-2 h-full flex items-center justify-center bg-white" style={{ borderColor: '#e4e7e4' }}>
                  <img src={form.logo_url} alt="Logo" className="max-h-16 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
              ) : (
                <div className="border border-dashed rounded p-2 h-full flex items-center justify-center text-xs text-zinc-400" style={{ borderColor: '#d9dfd9' }}>
                  Vorschau
                </div>
              )}
            </div>
          </div>
          <div className="mt-3">
            <Field label="Briefkopf-Einleitung" hint="oben auf Rechnung & Mahnung">
              <textarea
                value={form.letter_intro}
                onChange={(e) => set('letter_intro', e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm"
                style={{ borderColor: '#d9dfd9' }}
                rows={3}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Fusszeile" hint="z.B. Bankverbindung, Disclaimer">
              <textarea
                value={form.invoice_footer}
                onChange={(e) => set('invoice_footer', e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm"
                style={{ borderColor: '#d9dfd9' }}
                rows={3}
              />
            </Field>
          </div>
          {mode === 'templates' && (
            <div className="mt-4 rounded border p-3 text-xs" style={{ borderColor: '#e4e7e4', background: '#fafbfa' }}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">Vorschau</div>
              {form.logo_url && <img src={form.logo_url} alt="" className="max-h-10 mb-2" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
              {form.letter_intro && <div className="whitespace-pre-line text-zinc-700">{form.letter_intro}</div>}
              <div className="my-2 border-t" style={{ borderColor: '#e4e7e4' }} />
              <div className="text-zinc-400 italic">[Rechnungspositionen]</div>
              <div className="my-2 border-t" style={{ borderColor: '#e4e7e4' }} />
              {form.invoice_footer && <div className="whitespace-pre-line text-zinc-500 text-[11px]">{form.invoice_footer}</div>}
            </div>
          )}
        </Section>
      </div>
    </form>
  );
}
