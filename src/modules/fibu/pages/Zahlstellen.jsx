import React, { useEffect, useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { zahlstellenApi, kontenApi } from '../api';
import { isValidIban, isQrIban, normIban } from '../utils/pain001';

const fmtIban = (s) => normIban(s).replace(/(.{4})/g, '$1 ').trim();

const WAEHRUNGEN = ['CHF', 'EUR', 'USD', 'GBP', 'JPY', 'AUD', 'CAD', 'SEK', 'NOK', 'DKK', 'CNY'];

const emptyForm = () => ({
  bezeichnung: '', bank_name: '', iban: '', qr_iban: '', bic: '',
  konto_nr: '', waehrung: 'CHF', ist_standard: false, aktiv: true, sortierung: 0,
});

export default function Zahlstellen() {
  const { mandant, canWrite } = useMandant();
  const [rows, setRows]       = useState([]);
  const [konten, setKonten]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | 'new' | row-Objekt
  const [form, setForm]       = useState(emptyForm());
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);

  const load = async () => {
    if (!mandant) return;
    setLoading(true);
    try {
      setRows(await zahlstellenApi.list(mandant.id));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id]);
  useEffect(() => {
    if (!mandant) return;
    kontenApi.list(mandant.id).then(setKonten).catch(() => {});
  }, [mandant?.id]);

  // Liquiditätskonten (Kasse/Bank 1000–1099) als Belastungskonto-Auswahl
  const bankKonten = konten.filter(k => /^10\d\d$/.test(k.konto_nr || ''));

  const openNew  = () => { setForm(emptyForm()); setEditing('new'); setErr(null); };
  const openEdit = (r) => {
    setForm({
      bezeichnung: r.bezeichnung ?? '', bank_name: r.bank_name ?? '',
      iban: r.iban ?? '', qr_iban: r.qr_iban ?? '', bic: r.bic ?? '', konto_nr: r.konto_nr ?? '',
      waehrung: r.waehrung ?? 'CHF',
      ist_standard: !!r.ist_standard, aktiv: !!r.aktiv, sortierung: r.sortierung ?? 0,
    });
    setEditing(r); setErr(null);
  };
  const close = () => { setEditing(null); setErr(null); };

  const ibanOk = isValidIban(form.iban);
  const canSave = form.bezeichnung.trim() && ibanOk;

  const handleSave = async () => {
    if (!canSave || !mandant) return;
    setSaving(true); setErr(null);
    try {
      const payload = {
        bezeichnung: form.bezeichnung.trim(),
        bank_name:   form.bank_name.trim() || null,
        iban:        normIban(form.iban),
        qr_iban:     normIban(form.qr_iban) || null,
        bic:         form.bic.trim().toUpperCase() || null,
        konto_nr:    form.konto_nr.trim() || null,
        waehrung:    form.waehrung || 'CHF',
        aktiv:       form.aktiv,
        sortierung:  parseInt(form.sortierung, 10) || 0,
      };
      let savedId;
      if (editing === 'new') {
        const created = await zahlstellenApi.create(mandant.id, { ...payload, ist_standard: false });
        savedId = created.id;
      } else {
        await zahlstellenApi.update(editing.id, payload);
        savedId = editing.id;
      }
      // Standard-Flag separat über RPC (setzt andere zurück)
      if (form.ist_standard) {
        await zahlstellenApi.setStandard(savedId);
      }
      await load();
      close();
    } catch (e) {
      setErr(e.message);
    } finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`Zahlstelle „${r.bezeichnung}" wirklich löschen?`)) return;
    try {
      await zahlstellenApi.remove(r.id);
      await load();
    } catch (e) { alert('Fehler: ' + e.message); }
  };

  const makeStandard = async (r) => {
    try {
      await zahlstellenApi.setStandard(r.id);
      await load();
    } catch (e) { alert('Fehler: ' + e.message); }
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td  = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '7px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%', boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4, display: 'block' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, flexShrink: 0 }}>🏦</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Firmenzahlstellen</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Eigene Bankkonten als Belastungskonto für Zahlungsläufe</div>
        </div>
        <div style={{ flex: 1 }} />
        {canWrite && (
          <button onClick={openNew} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Neue Zahlstelle
          </button>
        )}
      </div>

      {/* Tabelle */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>
            Noch keine Zahlstelle erfasst.<br />
            <span style={{ fontSize: 12 }}>Lege das Geschäftskonto an, von dem Zahlungen ausgeführt werden.</span>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={hdr}>Bezeichnung</th>
              <th style={hdr}>Bank</th>
              <th style={hdr}>IBAN</th>
              <th style={hdr}>BIC</th>
              <th style={hdr}>Fibu-Konto</th>
              <th style={hdr}>Währung</th>
              <th style={hdr}>Standard</th>
              <th style={hdr}>Status</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Aktionen</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const qr = isQrIban(r.iban);
                return (
                  <tr key={r.id} style={{ opacity: r.aktiv ? 1 : 0.55 }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.bezeichnung}</td>
                    <td style={td}>{r.bank_name || '—'}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>
                      {fmtIban(r.iban)}
                      {qr && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#dbeafe', color: '#1e40af' }}>QR-IBAN</span>}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5, color: '#6b826b' }}>{r.bic || '—'}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{r.konto_nr || '—'}</td>
                    <td style={td}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        background: (r.waehrung && r.waehrung !== 'CHF') ? '#fff7ed' : '#eef2ee',
                        color: (r.waehrung && r.waehrung !== 'CHF') ? '#9a3412' : '#3d6641' }}>
                        {r.waehrung || 'CHF'}
                      </span>
                    </td>
                    <td style={td}>
                      {r.ist_standard
                        ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#166534' }}>★ Standard</span>
                        : (canWrite && r.aktiv
                            ? <button onClick={() => makeStandard(r)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer', color: '#6b826b' }}>als Standard</button>
                            : <span style={{ color: '#c5cdc5' }}>—</span>)
                      }
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: r.aktiv ? '#dcfce7' : '#e4e9e4', color: r.aktiv ? '#166534' : '#6b826b' }}>
                        {r.aktiv ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canWrite && (
                        <>
                          <button onClick={() => openEdit(r)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d4dcd4', background: '#fff', fontSize: 11.5, cursor: 'pointer', color: '#3d6641', marginRight: 6 }}>Bearbeiten</button>
                          <button onClick={() => handleDelete(r)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e0c0c0', background: '#fff', fontSize: 11.5, cursor: 'pointer', color: '#8a2d2d' }}>Löschen</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal: Neu / Bearbeiten ── */}
      {editing && (
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '92vw', boxShadow: '0 16px 48px rgba(0,0,0,.25)', overflow: 'hidden' }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14 }}>
              {editing === 'new' ? 'Neue Firmenzahlstelle' : 'Zahlstelle bearbeiten'}
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={lbl}>Bezeichnung *</label>
                <input style={inp} value={form.bezeichnung} autoFocus
                  onChange={e => setForm(f => ({ ...f, bezeichnung: e.target.value }))}
                  placeholder="z.B. UBS Geschäftskonto" />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Bank</label>
                  <input style={inp} value={form.bank_name}
                    onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
                    placeholder="z.B. UBS Switzerland AG" />
                </div>
                <div style={{ width: 100 }}>
                  <label style={lbl}>Währung</label>
                  <select style={inp} value={form.waehrung}
                    onChange={e => setForm(f => ({ ...f, waehrung: e.target.value }))}>
                    {[...new Set([form.waehrung, ...WAEHRUNGEN])].map(w => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Fibu-Konto (Belastungskonto)</label>
                <select style={{ ...inp, fontFamily: 'monospace' }} value={form.konto_nr}
                  onChange={e => setForm(f => ({ ...f, konto_nr: e.target.value }))}>
                  <option value="">— kein Konto —</option>
                  {form.konto_nr && !bankKonten.some(k => k.konto_nr === form.konto_nr) && (
                    <option value={form.konto_nr}>{form.konto_nr}</option>
                  )}
                  {bankKonten.map(k => (
                    <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>
                  ))}
                </select>
                {!form.konto_nr
                  ? <div style={{ fontSize: 10.5, color: '#9a6a00', marginTop: 3 }}>Ohne Fibu-Konto kann die Zahlung beim Bankabgleich nicht verbucht werden.</div>
                  : <div style={{ fontSize: 10.5, color: '#6b826b', marginTop: 3 }}>Gegenkonto (Haben) bei der Zahlungs-Verbuchung.</div>}
              </div>
              <div>
                <label style={lbl}>IBAN *</label>
                <input
                  style={{ ...inp, fontFamily: 'monospace', borderColor: form.iban && !ibanOk ? '#e0b8b8' : '#d4dcd4' }}
                  value={form.iban}
                  onChange={e => setForm(f => ({ ...f, iban: e.target.value }))}
                  placeholder="CH00 0000 0000 0000 0000 0" />
                {form.iban && !ibanOk && <div style={{ fontSize: 10.5, color: '#8a2d2d', marginTop: 3 }}>IBAN ungültig (Prüfziffer stimmt nicht)</div>}
                {ibanOk && isQrIban(form.iban) && <div style={{ fontSize: 10.5, color: '#1e40af', marginTop: 3 }}>QR-IBAN erkannt</div>}
              </div>
              <div>
                <label style={lbl}>QR-IBAN (für QR-Rechnung an Kunden)</label>
                <input
                  style={{ ...inp, fontFamily: 'monospace' }}
                  value={form.qr_iban}
                  onChange={e => setForm(f => ({ ...f, qr_iban: e.target.value }))}
                  placeholder="CH44 3199 9123 0008 8901 2" />
                {form.qr_iban && !isQrIban(form.qr_iban)
                  ? <div style={{ fontSize: 10.5, color: '#9a6a00', marginTop: 3 }}>Keine QR-IBAN (IID 30000–31999). Für QR-Referenz-Rechnungen QR-IBAN der Bank verwenden.</div>
                  : form.qr_iban && <div style={{ fontSize: 10.5, color: '#1e40af', marginTop: 3 }}>✓ QR-IBAN — wird als Empfänger-Konto auf der Ausgangsrechnung gedruckt</div>}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>BIC <span style={{ color: '#94a394', fontWeight: 400 }}>(optional)</span></label>
                  <input style={{ ...inp, fontFamily: 'monospace' }} value={form.bic}
                    onChange={e => setForm(f => ({ ...f, bic: e.target.value }))}
                    placeholder="z.B. UBSWCHZH80A" />
                </div>
                <div style={{ width: 90 }}>
                  <label style={lbl}>Sortierung</label>
                  <input type="number" style={inp} value={form.sortierung}
                    onChange={e => setForm(f => ({ ...f, sortierung: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 18, paddingTop: 2 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.ist_standard}
                    onChange={e => setForm(f => ({ ...f, ist_standard: e.target.checked }))} />
                  Als Standard-Zahlstelle
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.aktiv}
                    onChange={e => setForm(f => ({ ...f, aktiv: e.target.checked }))} />
                  Aktiv
                </label>
              </div>
              {err && <div style={{ fontSize: 12, color: '#8a2d2d', background: '#fdf0f0', border: '1px solid #e0b8b8', borderRadius: 7, padding: '7px 10px' }}>{err}</div>}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={close} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
              <button
                onClick={handleSave}
                disabled={!canSave || saving}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: canSave ? '#7a9b7f' : '#c5cdc5', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}
              >{saving ? 'Speichert…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
