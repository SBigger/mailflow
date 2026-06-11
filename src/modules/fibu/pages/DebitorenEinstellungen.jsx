/**
 * Debitoren-Einstellungen (Rechnungs-Stammdaten pro Mandant):
 * Logo, Absender/Briefkopf, Fusszeile, Rechnungs-Vorlage (3 Layouts),
 * Standard-Zahlstelle (QR-IBAN) für Ausgangsrechnungen.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { mandantenApi, zahlstellenApi } from '../api';
import { isQrIban, buildQrReference } from '../utils/pain001';
import { generateDebitorenPdf } from '../utils/debitorenInvoicePdf';
import { supabase } from '@/api/supabaseClient';

const card = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 12, padding: 20 };
const inp  = { width: '100%', padding: '8px 10px', border: '1px solid #d4dcd4', borderRadius: 8, fontSize: 12.5, background: '#f7faf7', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl  = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4 };

const VORLAGEN = [
  { id: 'klassisch', name: 'Klassisch', desc: 'Logo oben links, klare Tabelle, QR-Zahlteil unten' },
  { id: 'modern',    name: 'Modern',    desc: 'Farbiger Briefkopf, grosszügig, QR-Zahlteil unten' },
  { id: 'kompakt',   name: 'Kompakt',   desc: 'Platzsparend, kleine Schrift, QR-Zahlteil unten' },
];

export default function DebitorenEinstellungen() {
  const { mandant } = useMandant();
  const [m, setM] = useState(null);
  const [zahlstellen, setZahlstellen] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    if (!mandant?.id) return;
    mandantenApi.get(mandant.id).then(setM).catch(console.error);
    zahlstellenApi.list(mandant.id).then(setZahlstellen).catch(console.error);
  }, [mandant?.id]);
  useEffect(load, [load]);

  const set = (patch) => setM(x => ({ ...x, ...patch }));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await mandantenApi.update(mandant.id, {
        rechnung_logo_url:      m.rechnung_logo_url || null,
        rechnung_absender:      m.rechnung_absender || null,
        rechnung_fusszeile:     m.rechnung_fusszeile || null,
        rechnung_vorlage:       m.rechnung_vorlage || 'klassisch',
        rechnung_zahlstelle_id: m.rechnung_zahlstelle_id || null,
      });
      setMsg({ ok: true, text: 'Gespeichert.' });
    } catch (e) { setMsg({ ok: false, text: 'Fehler: ' + e.message }); }
    finally { setSaving(false); }
  };

  const onLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setMsg(null);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${mandant.id}/logo_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('fibu-logos').upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('fibu-logos').getPublicUrl(path);
      set({ rechnung_logo_url: data.publicUrl });
      setMsg({ ok: true, text: 'Logo hochgeladen – nicht vergessen zu speichern.' });
    } catch (err) { setMsg({ ok: false, text: 'Upload fehlgeschlagen: ' + err.message }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const [previewBusy, setPreviewBusy] = useState(null);
  const previewVorlage = async (vorlageId) => {
    setPreviewBusy(vorlageId); setMsg(null);
    try {
      const zs = zahlstellen.find(z => z.id === m.rechnung_zahlstelle_id) || zahlstellen[0]
        || { qr_iban: 'CH4431999123000889012' };
      const beleg = {
        id: 'preview', beleg_nr: 'MUSTER', titel: 'Beratung & Material (Vorschau)',
        belegdatum: new Date().toISOString().slice(0, 10),
        faelligkeit: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
        waehrung: 'CHF', betrag_netto: 1405, betrag_mwst: 113.81, betrag_brutto: 1518.81,
        zahlungsreferenz: buildQrReference('1001', 'MUSTER2026'),
      };
      const positionen = [
        { bezeichnung: 'Beratung Buchhaltung', menge: 8, einheit: 'Std', einzelpreis: 140, betrag_brutto: 1210.72 },
        { bezeichnung: 'Ordner & Register (Set)', menge: 10, einheit: 'Stk', einzelpreis: 28.5, betrag_brutto: 308.09 },
      ];
      const kunde = { name: 'Muster Kunde AG', nr: 'K-1001', adresse: 'Beispielweg 12', plz: '8000', ort: 'Zürich', land: 'CH' };
      const mandant = {
        ...m,
        name: m.name || 'Muster Treuhand AG',
        adresse: m.adresse || 'Musterstrasse 1', plz: m.plz || '8000', ort: m.ort || 'Zürich',
        rechnung_vorlage: vorlageId,
      };
      const { blob } = await generateDebitorenPdf({ beleg, positionen, kunde, mandant, zahlstelle: zs, upload: false });
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) { setMsg({ ok: false, text: 'Vorschau fehlgeschlagen: ' + e.message }); }
    finally { setPreviewBusy(null); }
  };

  if (!m) return <div style={{ flex: 1, padding: 24, color: '#94a394' }}>Lädt…</div>;

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#f2f5f2' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #d4dcd4' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Rechnungs-Einstellungen</div>
          <div style={{ fontSize: 11.5, color: '#7a9a7f' }}>Debitoren · Stammdaten fürs Rechnungsformular</div>
        </div>
        <button onClick={save} disabled={saving} style={{ marginLeft: 'auto', padding: '8px 18px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>

      <div style={{ padding: 24, maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {msg && <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12.5, background: msg.ok ? '#e8f5e8' : '#fde7e7', color: msg.ok ? '#3d6641' : '#8a2d2d' }}>{msg.text}</div>}

        {/* Logo */}
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#2d4a30' }}>Logo</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ width: 140, height: 70, border: '1px dashed #bfcfbf', borderRadius: 8, background: '#f7faf7', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {m.rechnung_logo_url
                ? <img src={m.rechnung_logo_url} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                : <span style={{ fontSize: 11, color: '#94a394' }}>kein Logo</span>}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" style={{ display: 'none' }} onChange={onLogo} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #bfcfbf', background: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                {uploading ? 'Lädt hoch…' : 'Logo hochladen'}
              </button>
              {m.rechnung_logo_url && <button onClick={() => set({ rechnung_logo_url: '' })} style={{ marginLeft: 8, padding: '7px 12px', borderRadius: 7, border: '1px solid #e0c0c0', background: '#fff', color: '#8a2d2d', fontSize: 12, cursor: 'pointer' }}>Entfernen</button>}
              <div style={{ fontSize: 10.5, color: '#94a394', marginTop: 6 }}>PNG, JPG oder SVG. Erscheint im Rechnungs-PDF.</div>
            </div>
          </div>
        </div>

        {/* Briefkopf / Fusszeile */}
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#2d4a30' }}>Briefkopf &amp; Fusszeile</div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Absender / Briefkopf</label>
            <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={m.rechnung_absender || ''} placeholder={`${m.name || 'Firma'}\n${m.adresse || ''}\n${m.plz || ''} ${m.ort || ''}`} onChange={e => set({ rechnung_absender: e.target.value })} />
          </div>
          <div>
            <label style={lbl}>Fusszeile</label>
            <textarea style={{ ...inp, minHeight: 50, resize: 'vertical' }} value={m.rechnung_fusszeile || ''} placeholder="z.B. Zahlbar innert 30 Tagen · UID CHE-… · www.firma.ch" onChange={e => set({ rechnung_fusszeile: e.target.value })} />
          </div>
        </div>

        {/* Standard-Zahlstelle (QR-IBAN) */}
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#2d4a30' }}>Empfänger-Konto (QR-Rechnung)</div>
          <label style={lbl}>Standard-Zahlstelle für Ausgangsrechnungen</label>
          <select style={inp} value={m.rechnung_zahlstelle_id || ''} onChange={e => set({ rechnung_zahlstelle_id: e.target.value })}>
            <option value="">— wählen —</option>
            {zahlstellen.map(z => (
              <option key={z.id} value={z.id}>{z.bezeichnung} · {(z.qr_iban || z.iban || '').replace(/(.{4})/g, '$1 ').trim()}{z.qr_iban ? ' (QR-IBAN)' : ''}</option>
            ))}
          </select>
          {(() => {
            const z = zahlstellen.find(x => x.id === m.rechnung_zahlstelle_id);
            if (!z) return <div style={{ fontSize: 10.5, color: '#9a6a00', marginTop: 6 }}>Ohne Zahlstelle kein QR-Zahlteil. Zahlstelle inkl. QR-IBAN unter Stammdaten → Firmenzahlstellen erfassen.</div>;
            if (!z.qr_iban && !isQrIban(z.iban)) return <div style={{ fontSize: 10.5, color: '#9a6a00', marginTop: 6 }}>Diese Zahlstelle hat keine QR-IBAN → QR-Referenz-Rechnung nicht möglich (nur IBAN-Rechnung).</div>;
            return <div style={{ fontSize: 10.5, color: '#1e40af', marginTop: 6 }}>✓ QR-IBAN vorhanden – QR-Rechnung mit Referenz möglich.</div>;
          })()}
        </div>

        {/* Vorlage */}
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#2d4a30' }}>Rechnungs-Vorlage (PDF-Layout)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {VORLAGEN.map(v => {
              const active = (m.rechnung_vorlage || 'klassisch') === v.id;
              return (
                <div key={v.id} onClick={() => set({ rechnung_vorlage: v.id })}
                  style={{ textAlign: 'left', padding: 14, borderRadius: 10, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column',
                    border: active ? '2px solid #3d6641' : '1px solid #d4dcd4',
                    background: active ? '#f0f7f0' : '#fff' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, color: active ? '#3d6641' : '#1a1a2e' }}>{active ? '● ' : '○ '}{v.name}</div>
                  <div style={{ fontSize: 11, color: '#6b826b', marginTop: 4, lineHeight: 1.4, flex: 1 }}>{v.desc}</div>
                  <button
                    onClick={(e) => { e.stopPropagation(); previewVorlage(v.id); }}
                    disabled={previewBusy === v.id}
                    style={{ marginTop: 10, padding: '5px 10px', borderRadius: 7, border: '1px solid #bfcfbf', background: '#fff', color: '#3d6641', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}
                  >{previewBusy === v.id ? 'erzeugt…' : '👁 Vorschau'}</button>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: '#94a394', marginTop: 10 }}>„👁 Vorschau" erzeugt ein Muster-PDF der jeweiligen Vorlage (mit deinem Logo/Briefkopf). Die gewählte Vorlage wird für neue Rechnungen verwendet.</div>
        </div>
      </div>
    </div>
  );
}
