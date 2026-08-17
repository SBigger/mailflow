import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Save,
  Building2,
  MapPin,
  Banknote,
  FileText,
  FileDown,
  Landmark,
  LockKeyhole,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { leCompany, leFibu } from '@/lib/leApi';
import { generateInvoicePdf, triggerDownload } from '@/lib/leInvoicePdf';
import {
  Card,
  Input,
  Select,
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
  const bindingQ = useQuery({
    queryKey: ['le', 'fibu-binding'],
    queryFn: leFibu.getBinding,
    enabled: mode === 'full',
  });
  const candidatesQ = useQuery({
    queryKey: ['le', 'fibu-binding-candidates'],
    queryFn: leFibu.listBindingCandidates,
    enabled: mode === 'full',
  });

  const [form, setForm] = useState(EMPTY);
  const [selectedMandant, setSelectedMandant] = useState('');
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionMandant, setCorrectionMandant] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

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
  const bindMut = useMutation({
    mutationFn: (mandantId) => leFibu.bindMandant(mandantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'fibu-binding'] });
      qc.invalidateQueries({ queryKey: ['le', 'fibu-revenue-accounts'] });
      toast.success('Fibu-Mandant dauerhaft gebunden');
      setSelectedMandant('');
    },
    onError: (e) => toast.error('Bindung nicht möglich: ' + (e?.message ?? e), { duration: 8000 }),
  });
  const rebindMut = useMutation({
    mutationFn: ({ mandantId, reason }) => leFibu.rebindMandant(mandantId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'fibu-binding'] });
      qc.invalidateQueries({ queryKey: ['le', 'fibu-revenue-accounts'] });
      toast.success('Fibu-Mandant protokolliert korrigiert');
      setShowCorrection(false);
      setCorrectionMandant('');
      setCorrectionReason('');
    },
    onError: (e) => toast.error('Korrektur nicht möglich: ' + (e?.message ?? e), { duration: 8000 }),
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

  const bindMandant = () => {
    const candidate = (candidatesQ.data ?? []).find((m) => m.mandant_id === selectedMandant);
    if (!candidate) return toast.error('Bitte einen Fibu-Mandanten wählen');
    const confirmed = window.confirm(
      `Fibu-Mandant „${candidate.mandant_name}“ dauerhaft mit der Leistungserfassung verbinden?\n\n` +
      'Du wirst als fachlicher Eigentümer gespeichert. Ab dann werden definitive Rechnungen live gebucht. ' +
      'Ein normaler Benutzer kann diese Auswahl nicht mehr ändern.'
    );
    if (confirmed) bindMut.mutate(candidate.mandant_id);
  };

  const correctMandant = () => {
    const reason = correctionReason.trim();
    const candidate = (candidatesQ.data ?? []).find((m) => m.mandant_id === correctionMandant);
    if (!candidate) return toast.error('Bitte den neuen Fibu-Mandanten wählen');
    if (reason.length < 10) return toast.error('Bitte eine nachvollziehbare Begründung eingeben');
    const confirmed = window.confirm(
      `Gesperrte Mandantenbindung wirklich auf „${candidate.mandant_name}“ korrigieren?\n\n` +
      `Begründung: ${reason}\n\nBestehende Buchungen bleiben unverändert beim bisherigen Mandanten.`
    );
    if (confirmed) rebindMut.mutate({ mandantId: candidate.mandant_id, reason });
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

            <Section icon={Landmark} title="Fibu-Liveverbuchung">
              {bindingQ.isLoading ? (
                <div className="text-sm text-zinc-500">Mandantenbindung wird geladen…</div>
              ) : bindingQ.error ? (
                <div className="rounded border p-3 text-sm" style={{ borderColor: '#f0b8b8', background: '#fff7f7', color: '#8d3030' }}>
                  Fibu-Status konnte nicht geladen werden: {bindingQ.error?.message ?? String(bindingQ.error)}
                </div>
              ) : !bindingQ.data ? (
                <div className="space-y-3">
                  <div className="flex gap-3 rounded border p-3" style={{ borderColor: '#ead9a8', background: '#fffaf0' }}>
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#9a6b16' }} />
                    <div className="text-sm" style={{ color: '#6f5018' }}>
                      <div className="font-semibold">Noch nicht verbunden</div>
                      <div className="mt-1 text-xs leading-relaxed">
                        Nach der Erstbindung werden definitive Rechnungen atomar als Debitorenbeleg und im Hauptbuch verbucht.
                        Ohne gültige Konten wird die Finalisierung abgebrochen.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                    <Field label="Fibu-Mandant" hint="Nur Mandanten, in denen du Admin oder Buchhalter bist.">
                      <Select
                        value={selectedMandant}
                        onChange={(e) => setSelectedMandant(e.target.value)}
                        disabled={bindMut.isPending || candidatesQ.isLoading}
                      >
                        <option value="">Bitte wählen…</option>
                        {(candidatesQ.data ?? []).map((m) => (
                          <option key={m.mandant_id} value={m.mandant_id}>
                            {m.mandant_name}{m.uid ? ` · ${m.uid}` : ''} · {m.currency} · {m.vat_method} · {m.fibu_role}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <button
                      type="button"
                      onClick={bindMandant}
                      disabled={!selectedMandant || bindMut.isPending}
                      className={artisBtn.primary}
                      style={{ ...artisPrimaryStyle, opacity: !selectedMandant || bindMut.isPending ? 0.55 : 1 }}
                    >
                      <LockKeyhole className="w-4 h-4" />
                      {bindMut.isPending ? 'Verbinde…' : 'Dauerhaft verbinden'}
                    </button>
                  </div>
                  {!candidatesQ.isLoading && (candidatesQ.data ?? []).length === 0 && (
                    <div className="text-xs text-zinc-500">
                      Kein zulässiger Mandant gefunden. Du brauchst dort die Fibu-Rolle Admin oder Buchhalter.
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div
                    className="flex items-start justify-between gap-4 rounded border p-3"
                    style={{
                      borderColor: bindingQ.data.posting_ready ? '#b9d7be' : '#f0b8b8',
                      background: bindingQ.data.posting_ready ? '#f4faf5' : '#fff7f7',
                    }}
                  >
                    <div className="flex gap-3">
                      {bindingQ.data.posting_ready
                        ? <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#4f8058' }} />
                        : <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#a23c3c' }} />}
                      <div>
                        <div className="font-semibold text-sm">{bindingQ.data.mandant_name}</div>
                        <div className="mt-1 text-xs text-zinc-600">
                          Debitoren {bindingQ.data.debitoren_konto_nr} · Standard-Ertrag {bindingQ.data.default_ertragskonto_nr}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          Gebunden am {new Date(bindingQ.data.bound_at).toLocaleString('de-CH')}
                          {bindingQ.data.can_rebind ? ' · Du bist der fachliche Eigentümer' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                      style={{
                        color: bindingQ.data.posting_ready ? '#386342' : '#8d3030',
                        background: bindingQ.data.posting_ready ? '#e4f2e6' : '#fde8e8',
                      }}>
                      <LockKeyhole className="w-3.5 h-3.5" />
                      {bindingQ.data.posting_ready ? 'gesperrt & bereit' : 'gesperrt · Fehler'}
                    </div>
                  </div>

                  {(bindingQ.data.issues ?? []).length > 0 && (
                    <ul className="rounded border p-3 pl-7 text-xs list-disc space-y-1"
                      style={{ borderColor: '#f0b8b8', background: '#fff7f7', color: '#8d3030' }}>
                      {bindingQ.data.issues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  )}

                  {bindingQ.data.can_rebind && (
                    <div className="border-t pt-3" style={{ borderColor: '#eef1ee' }}>
                      {!showCorrection ? (
                        <button
                          type="button"
                          onClick={() => setShowCorrection(true)}
                          className={artisBtn.ghost}
                          style={{ borderColor: '#dbc6a0', color: '#775a25', background: '#fffaf2' }}
                        >
                          Eigentümer-Korrektur öffnen
                        </button>
                      ) : (
                        <div className="rounded border p-3 space-y-3" style={{ borderColor: '#dbc6a0', background: '#fffaf2' }}>
                          <div className="text-xs leading-relaxed" style={{ color: '#6f5018' }}>
                            Nur für eine echte Fehlkonfiguration. Bereits verbuchte Rechnungen werden nicht verschoben;
                            jede Korrektur wird mit Benutzer, Zeitpunkt, altem/neuem Mandanten und Begründung protokolliert.
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Neuer Mandant">
                              <Select value={correctionMandant} onChange={(e) => setCorrectionMandant(e.target.value)}>
                                <option value="">Bitte wählen…</option>
                                {(candidatesQ.data ?? [])
                                  .filter((m) => m.mandant_id !== bindingQ.data.mandant_id)
                                  .map((m) => (
                                    <option key={m.mandant_id} value={m.mandant_id}>
                                      {m.mandant_name}{m.uid ? ` · ${m.uid}` : ''} · {m.currency} · {m.vat_method}
                                    </option>
                                  ))}
                              </Select>
                            </Field>
                            <Field label="Begründung" hint="Mindestens 10 Zeichen; wird dauerhaft protokolliert.">
                              <Input
                                value={correctionReason}
                                onChange={(e) => setCorrectionReason(e.target.value)}
                                placeholder="Warum ist die Korrektur nötig?"
                              />
                            </Field>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setShowCorrection(false);
                                setCorrectionMandant('');
                                setCorrectionReason('');
                              }}
                              className={artisBtn.ghost}
                              style={{ borderColor: '#d1dcd1', color: '#3d4a3d', background: '#fff' }}
                            >
                              Abbrechen
                            </button>
                            <button
                              type="button"
                              onClick={correctMandant}
                              disabled={rebindMut.isPending}
                              className={artisBtn.primary}
                              style={{ background: '#8a672c', opacity: rebindMut.isPending ? 0.55 : 1 }}
                            >
                              {rebindMut.isPending ? 'Korrigiere…' : 'Protokolliert korrigieren'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
