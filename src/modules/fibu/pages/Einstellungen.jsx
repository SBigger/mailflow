import React, { useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { mandantenApi } from '../api';

function Toggle({ value, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!value)}
      style={{
        width: 44, height: 24, borderRadius: 12, flexShrink: 0,
        background: value ? '#7a9b7f' : '#d1d5db',
        position: 'relative', cursor: disabled ? 'default' : 'pointer',
        transition: 'background .15s', opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: value ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
      }} />
    </div>
  );
}

export default function Einstellungen() {
  const { mandant, canWrite } = useMandant();
  const [belegfreigabe, setBelegfreigabe] = useState(!!mandant?.belegfreigabe_aktiv);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const [firma, setFirma] = useState({
    name:    mandant?.name    ?? '',
    uid:     mandant?.uid     ?? '',
    adresse: mandant?.adresse ?? '',
    plz:     mandant?.plz     ?? '',
    ort:     mandant?.ort     ?? '',
    land:    mandant?.land    ?? 'CH',
  });
  const [firmaSaving, setFirmaSaving] = useState(false);

  const [fwBuchung,   setFwBuchung]   = useState(mandant?.fw_buchungskurs   ?? 'monat');
  const [fwBewertung, setFwBewertung] = useState(mandant?.fw_bewertungskurs ?? 'tag');
  const [fwSaving,    setFwSaving]    = useState(false);

  const saveFw = async (feld, wert) => {
    if (!canWrite || !mandant) return;
    if (feld === 'fw_buchungskurs')   setFwBuchung(wert);
    if (feld === 'fw_bewertungskurs') setFwBewertung(wert);
    setFwSaving(true); setMsg(null);
    try {
      await mandantenApi.update(mandant.id, { [feld]: wert });
      setMsg({ type: 'ok', text: 'Fremdwährungs-Einstellung gespeichert.' });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setFwSaving(false); }
  };

  const saveFirma = async () => {
    if (!canWrite || !mandant) return;
    setFirmaSaving(true); setMsg(null);
    try {
      await mandantenApi.update(mandant.id, {
        name:    firma.name.trim(),
        uid:     firma.uid.trim() || null,
        adresse: firma.adresse.trim() || null,
        plz:     firma.plz.trim() || null,
        ort:     firma.ort.trim() || null,
        land:    (firma.land || 'CH').trim().toUpperCase() || 'CH',
      });
      setMsg({ type: 'ok', text: 'Firmenangaben gespeichert.' });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setFirmaSaving(false); }
  };

  const setBelegfreigabeAktiv = async (aktiv) => {
    if (!canWrite || !mandant) return;
    setBelegfreigabe(aktiv);
    setSaving(true); setMsg(null);
    try {
      const { error } = await supabase.rpc('fibu_mandant_belegfreigabe_setzen', {
        p_mandant_id: mandant.id, p_aktiv: aktiv,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: aktiv
        ? 'Belegfreigabe aktiviert – neue Rechnungen müssen vor dem Zahlungslauf freigegeben werden.'
        : 'Belegfreigabe deaktiviert.' });
    } catch (e) {
      setBelegfreigabe(!aktiv);
      setMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  };

  const card = { background: '#fff', border: '1px solid #e4e9e4', borderRadius: 12, marginBottom: 16, overflow: 'hidden' };
  const cardHdr = { padding: '10px 16px', borderBottom: '1px solid #f0f3f0', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', background: '#fafcfa' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ padding: '14px 20px', background: '#fff', borderBottom: '1px solid #e4e9e4', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>⚙</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Einstellungen</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Mandant: {mandant?.name ?? '—'}</div>
        </div>
      </div>

      <div style={{ padding: 20, maxWidth: 720 }}>
        {msg && (
          <div style={{ marginBottom: 14, padding: '9px 13px', borderRadius: 8, fontSize: 12,
            background: msg.type === 'ok' ? '#f0f7f0' : '#fdf0f0',
            color: msg.type === 'ok' ? '#166534' : '#8a2d2d' }}>
            {msg.text}
          </div>
        )}

        {/* Firma */}
        <div style={card}>
          <div style={cardHdr}>Firma / Mandant</div>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: '#6b826b', marginBottom: 10, lineHeight: 1.5 }}>
              Die Firmenadresse erscheint als Auftraggeber im Zahlungslauf (pain.001) und hilft beim
              Scan, die eigene Firma als Rechnungsempfänger zu erkennen (≠ Lieferant).
            </div>
            {(() => {
              const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };
              const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box' };
              const set = (k, v) => setFirma(f => ({ ...f, [k]: v }));
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Firmenname</label>
                      <input style={inp} value={firma.name} disabled={!canWrite} onChange={e => set('name', e.target.value)} />
                    </div>
                    <div style={{ width: 150 }}>
                      <label style={lbl}>UID</label>
                      <input style={inp} value={firma.uid} disabled={!canWrite} onChange={e => set('uid', e.target.value)} placeholder="CHE-..." />
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Strasse / Nr.</label>
                    <input style={inp} value={firma.adresse} disabled={!canWrite} onChange={e => set('adresse', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ width: 90 }}>
                      <label style={lbl}>PLZ</label>
                      <input style={inp} value={firma.plz} disabled={!canWrite} onChange={e => set('plz', e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Ort</label>
                      <input style={inp} value={firma.ort} disabled={!canWrite} onChange={e => set('ort', e.target.value)} />
                    </div>
                    <div style={{ width: 64 }}>
                      <label style={lbl}>Land</label>
                      <input style={inp} value={firma.land} disabled={!canWrite} onChange={e => set('land', e.target.value.toUpperCase().slice(0, 2))} />
                    </div>
                  </div>
                  {canWrite && (
                    <div>
                      <button onClick={saveFirma} disabled={firmaSaving}
                        style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                        {firmaSaving ? 'Speichert…' : 'Firmenangaben speichern'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        <div style={card}>
          <div style={cardHdr}>Kreditoren</div>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <Toggle value={belegfreigabe} onChange={setBelegfreigabeAktiv} disabled={saving || !canWrite} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>Belegfreigabe (Visumskontrolle)</div>
              <div style={{ fontSize: 12, color: '#6b826b', marginTop: 3, lineHeight: 1.5 }}>
                Ist die Belegfreigabe aktiv, erhalten neu erfasste Kreditoren-Rechnungen den Status
                „ausstehend". Sie müssen in der OP-Liste freigegeben werden, bevor sie in einen
                Zahlungslauf übernommen werden können. Bestehende Rechnungen bleiben unverändert.
              </div>
            </div>
          </div>
        </div>

        {/* Fremdwährung */}
        <div style={card}>
          <div style={cardHdr}>Fremdwährung</div>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: '#6b826b', marginBottom: 12, lineHeight: 1.5 }}>
              Welcher offizielle ESTV-Kurs verwendet wird. Die einmal gewählte Methode für
              Buchungen muss pro Steuerperiode beibehalten werden (MWST-Vorgabe).
            </div>
            {(() => {
              const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };
              const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, outline: 'none', minWidth: 280 };
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={lbl}>Buchungskurs <span style={{ color: '#94a394', fontWeight: 400 }}>– Umrechnung von FW-Belegen ins CHF-Hauptbuch</span></label>
                    <select style={inp} value={fwBuchung} disabled={fwSaving || !canWrite}
                      onChange={e => saveFw('fw_buchungskurs', e.target.value)}>
                      <option value="monat">ESTV Monatsmittelkurs</option>
                      <option value="tag">ESTV Tageskurs</option>
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Bewertungskurs <span style={{ color: '#94a394', fontWeight: 400 }}>– FW-Kursbewertung per Bilanzstichtag</span></label>
                    <select style={inp} value={fwBewertung} disabled={fwSaving || !canWrite}
                      onChange={e => saveFw('fw_bewertungskurs', e.target.value)}>
                      <option value="tag">ESTV Tageskurs (Stichtag)</option>
                      <option value="monat">ESTV Monatsmittelkurs</option>
                    </select>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#94a394' }}>
          Weitere Einstellungen: MWST-Methode → MWST-Abrechnung · Buchungssperre → Manuelle Buchungen ·
          Wechselkurse → Stammdaten › Wechselkurse
        </div>
      </div>
    </div>
  );
}
