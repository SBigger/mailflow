import React, { useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';

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

        <div style={{ fontSize: 11, color: '#94a394' }}>
          Weitere Einstellungen: MWST-Methode → MWST-Abrechnung · Buchungssperre → Manuelle Buchungen
        </div>
      </div>
    </div>
  );
}
