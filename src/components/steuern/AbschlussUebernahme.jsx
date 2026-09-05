// Kurzmaske «Aus Abschluss übernehmen» für das Tool /Steuern.
//
// Liest die Saldenliste des Smartis-Abschlusses (abschluss / abschluss_konten),
// leitet daraus die Steuer-Kennzahlen ab (src/lib/steuern/kennzahlen.js) und
// befüllt die Formularfelder des gewählten Kantons (src/lib/steuern/formular.js).
// Der einzige manuelle Input ist die Gewinnverwendung. Dieselbe Logik nutzt der
// MCP-Server – Web und Claude liefern damit identische Zahlen.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Sparkles, ChevronDown, ChevronUp, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { berechneKennzahlen, verlustvortragAusErklaerungen, EK_KLASSEN_LABEL } from '@/lib/steuern/kennzahlen.js';
import { felderFuerKanton, zusammenfuehren, KANTONE_MIT_AUTOFILL } from '@/lib/steuern/formular.js';
import { ZH_GEMEINDEN } from '@/forms/zh_gemeinden.js';

const C = {
  panelBg: '#ffffff', panelBdr: '#ccd8cc', heading: '#1a3a1a', sub: '#4a6a4a', accent: '#5b8a5b',
  accentBg: '#eef5ee', muted: '#9ca3af', inputBg: '#f8faf8', warnBg: '#fef3c7', warnFg: '#92400e', okFg: '#15803d',
};

const chf = (n) => (n == null || n === '' || isNaN(n) ? '–' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Betrag({ label, value, onChange, hint, action }) {
  const [focus, setFocus] = useState(false);
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>{label}</span>
        {action}
      </div>
      <input
        type={focus ? 'number' : 'text'}
        step="0.01"
        value={focus ? (value ?? '') : (value === '' || value == null ? '' : chf(value))}
        onChange={(e) => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder="0.00"
        style={{
          backgroundColor: C.inputBg, border: `1px solid ${focus ? C.accent : C.panelBdr}`, borderRadius: 6,
          padding: '5px 10px', fontSize: 12, color: C.heading, width: '100%', outline: 'none', height: 32,
          textAlign: 'right', fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box',
        }}
      />
      {hint && <div className="text-[10px] mt-1" style={{ color: C.sub }}>{hint}</div>}
    </label>
  );
}

function Kachel({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: tone === 'accent' ? C.accentBg : C.inputBg, border: `1px solid ${C.panelBdr}` }}>
      <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>{label}</div>
      <div className="text-sm font-semibold" style={{ color: value < 0 ? '#b91c1c' : C.heading, fontVariantNumeric: 'tabular-nums' }}>{chf(value)}</div>
      {sub && <div className="text-[10px]" style={{ color: C.sub }}>{sub}</div>}
    </div>
  );
}

// Register-Nr. des Jahres aus dem Tab Steuer-Zugänge des Kunden (Feld nummer)
function registerNrAusZugaengen(kunde, jahr) {
  const z = (kunde.steuer_zugaenge || []).find((e) => String(e.jahr) === String(jahr)) || (kunde.steuer_zugaenge || []).find((e) => String(e.jahr) === String(jahr + 1));
  return (z?.nummer || '').trim();
}

function gemeindeZh(ort) {
  if (!ort) return '';
  const o = ort.toLowerCase();
  return Object.keys(ZH_GEMEINDEN).find((n) => n.toLowerCase() === o) || Object.keys(ZH_GEMEINDEN).find((n) => n.toLowerCase().startsWith(o)) || '';
}

export default function AbschlussUebernahme({ kunde, kanton, steuerjahr, felder, onUebernehmen, onClose }) {
  const unterstuetzt = KANTONE_MIT_AUTOFILL.includes(kanton);

  const { data: abschluesse = [], isLoading: ladeAbschluesse } = useQuery({
    queryKey: ['abschluss_fuer_steuern', kunde.id, steuerjahr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('abschluss')
        .select('id, geschaeftsjahr, status, updated_at, abschluss_konten(count)')
        .eq('customer_id', kunde.id)
        .eq('geschaeftsjahr', steuerjahr)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []).map((a) => ({ ...a, konten: a.abschluss_konten?.[0]?.count ?? 0 }));
    },
  });

  const [abschlussId, setAbschlussId] = useState(null);
  useEffect(() => {
    if (!abschlussId && abschluesse.length) setAbschlussId((abschluesse.find((a) => a.konten > 0) || abschluesse[0]).id);
  }, [abschluesse, abschlussId]);

  const { data: konten = [], isLoading: ladeKonten } = useQuery({
    queryKey: ['abschluss_konten_fuer_steuern', abschlussId],
    enabled: !!abschlussId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('abschluss_konten')
        .select('kontonummer, kontoname, saldo_ist, saldo_vorjahr, position_id')
        .eq('abschluss_id', abschlussId)
        .order('kontonummer')
        .range(0, 4999);
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: fruehere = [] } = useQuery({
    queryKey: ['steuerdaten_fruehere', kunde.id, kanton, steuerjahr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('steuerdaten')
        .select('steuerjahr, felder')
        .eq('customer_id', kunde.id)
        .eq('kanton', kanton)
        .gte('steuerjahr', steuerjahr - 7)
        .lt('steuerjahr', steuerjahr)
        .order('steuerjahr', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Gewinnverwendung – vorbelegt aus bereits erfassten Feldern des Formulars,
  // sonst aus dem strukturierten Beschluss im GV-Protokoll (Modul gv-protokoll).
  const [gv, setGv] = useState(() => ({
    dividende: felder.gv_dividende ?? felder.bilanz_dividende ?? '',
    tantiemen: felder.gv_tantiemen ?? felder.bilanz_tantiemen ?? '',
    zuweisung_gesetzl_gewinnreserve: felder.gv_gesetzl_gewinnres ?? felder.bilanz_gesetzl_gewinnres ?? '',
    zuweisung_freiwillige_reserve: felder.gv_freiw_gewinnres ?? felder.bilanz_freiw_gewinnres ?? '',
  }));
  const [gvQuelle, setGvQuelle] = useState(null);

  const { data: gvProtokoll } = useQuery({
    queryKey: ['gv_protokoll_gewinnverwendung', kunde.id, steuerjahr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gv_protocols')
        .select('id, title, meeting_date, data')
        .eq('customer_id', kunde.id)
        .order('meeting_date', { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      const treffer = (data || []).find((p) => {
        const g = p.data?.gewinnverwendung;
        return g && String(g.geschaeftsjahr) === String(steuerjahr) && [g.dividende, g.tantiemen, g.zuweisung_gesetzl_gewinnreserve, g.zuweisung_freiwillige_reserve].some((v) => v !== '' && v != null);
      });
      return treffer ? { id: treffer.id, title: treffer.title, meeting_date: treffer.meeting_date, gv: treffer.data.gewinnverwendung } : null;
    },
  });
  useEffect(() => {
    if (!gvProtokoll) return;
    const leer = Object.values(gv).every((v) => v === '' || v == null);
    if (!leer) return;
    const n = (v) => (v === '' || v == null ? '' : Number(v));
    setGv({
      dividende: n(gvProtokoll.gv.dividende), tantiemen: n(gvProtokoll.gv.tantiemen),
      zuweisung_gesetzl_gewinnreserve: n(gvProtokoll.gv.zuweisung_gesetzl_gewinnreserve),
      zuweisung_freiwillige_reserve: n(gvProtokoll.gv.zuweisung_freiwillige_reserve),
    });
    setGvQuelle(`GV-Protokoll «${gvProtokoll.title}» vom ${new Date(gvProtokoll.meeting_date).toLocaleDateString('de-CH')}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gvProtokoll]);
  const [verlustManuell, setVerlustManuell] = useState(null);
  const [ueberschreiben, setUeberschreiben] = useState(false);
  const [zeigeKonten, setZeigeKonten] = useState(false);

  const kennzahlen = useMemo(() => (konten.length ? berechneKennzahlen(konten, steuerjahr, gv) : null), [konten, steuerjahr, gv]);
  const vvAuto = useMemo(() => verlustvortragAusErklaerungen(fruehere), [fruehere]);
  const vv = verlustManuell != null && verlustManuell !== ''
    ? { betrag: Number(verlustManuell), quelle: 'manuell' }
    : vvAuto;

  const vorschlag = useMemo(() => {
    if (!kennzahlen || !unterstuetzt) return null;
    const st = {
      firma_name: kunde.company_name || '', strasse: kunde.strasse, plz: kunde.plz, ort: kunde.ort, kanton: kunde.kanton,
      uid: kunde.uid_nr, register_nr: felder.register_nr || registerNrAusZugaengen(kunde, steuerjahr), gj_von: `${steuerjahr}-01-01`, gj_bis: `${steuerjahr}-12-31`,
      vertreter_artis: felder.vertreter_artis ?? true, gemeinde_zh: kanton === 'ZH' ? (felder.gemeinde || gemeindeZh(kunde.ort)) : null,
    };
    return felderFuerKanton(kanton, kennzahlen, st, vv);
  }, [kennzahlen, unterstuetzt, kunde, felder, steuerjahr, kanton, vv]);

  const merge = useMemo(() => (vorschlag ? zusammenfuehren(felder, vorschlag, ueberschreiben) : null), [vorschlag, felder, ueberschreiben]);

  const abschluss = abschluesse.find((a) => a.id === abschlussId);
  const laden = ladeAbschluesse || ladeKonten;

  function fuenfProzent() {
    if (!kennzahlen) return;
    setGv((g) => ({ ...g, zuweisung_gesetzl_gewinnreserve: kennzahlen.gesetzliche_reserve.empfohlene_zuweisung }));
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: C.panelBg, border: `1px solid ${C.panelBdr}`, width: 760, maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: C.accentBg }}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: C.accent }} />
            <span className="text-sm font-semibold" style={{ color: C.heading }}>Aus Abschluss übernehmen – {kanton} {steuerjahr}</span>
          </div>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: C.muted }} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!unterstuetzt && (
            <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: C.warnBg, color: C.warnFg }}>
              Für dieses Formular gibt es noch keine automatische Übernahme. Unterstützt: {KANTONE_MIT_AUTOFILL.join(', ')}.
            </div>
          )}

          {/* Quelle */}
          <div className="flex items-center gap-3 text-xs" style={{ color: C.sub }}>
            <span className="font-semibold">Quelle:</span>
            {laden && <span>Abschluss wird geladen …</span>}
            {!laden && abschluesse.length === 0 && (
              <span style={{ color: C.warnFg }}>Kein Abschluss {steuerjahr} für {kunde.company_name} in der Abschlussdokumentation. Zuerst die Saldenliste dort importieren.</span>
            )}
            {!laden && abschluesse.length === 1 && abschluss && (
              <span>Abschluss {abschluss.geschaeftsjahr} · {abschluss.konten} Konten · {abschluss.status}</span>
            )}
            {!laden && abschluesse.length > 1 && (
              <select value={abschlussId || ''} onChange={(e) => setAbschlussId(e.target.value)}
                style={{ backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`, borderRadius: 6, padding: '3px 8px', fontSize: 12, color: C.heading }}>
                {abschluesse.map((a) => <option key={a.id} value={a.id}>Abschluss {a.geschaeftsjahr} · {a.konten} Konten · {new Date(a.updated_at).toLocaleDateString('de-CH')}</option>)}
              </select>
            )}
            {abschluss && abschluss.konten === 0 && <span style={{ color: C.warnFg }}>Dieser Abschluss hat noch keine Konten.</span>}
          </div>

          {kennzahlen && (
            <>
              {/* Kennzahlen aus der Jahresrechnung */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.accent }}>Aus der Jahresrechnung</h3>
                <div className="grid grid-cols-4 gap-2">
                  <Kachel label="Reingewinn / Verlust" value={kennzahlen.jahresergebnis} sub={`Quelle: ${kennzahlen.jahresergebnis_herkunft}`} tone="accent" />
                  <Kachel label="Gewinnvortrag" value={kennzahlen.gewinnvortrag} sub="vor Gewinnverwendung" />
                  <Kachel label="Bilanzgewinn" value={kennzahlen.bilanzgewinn} sub="zur Verfügung der GV" />
                  <Kachel label="Aktienkapital" value={kennzahlen.aktienkapital} />
                  <Kachel label="Gesetzl. Kapitalreserve" value={kennzahlen.gesetzl_kapitalreserve + kennzahlen.kapitaleinlagereserve} sub={kennzahlen.kapitaleinlagereserve ? `davon KER ${chf(kennzahlen.kapitaleinlagereserve)}` : null} />
                  <Kachel label="Gesetzl. Gewinnreserve" value={kennzahlen.gesetzl_gewinnreserve} />
                  <Kachel label="Freiwillige / übrige" value={kennzahlen.freiwillige_reserve + kennzahlen.uebrige_reserve} />
                  <Kachel label="Bilanzsumme" value={kennzahlen.bilanzsumme} />
                </div>
                <button onClick={() => setZeigeKonten((v) => !v)} className="mt-2 flex items-center gap-1 text-[11px]" style={{ color: C.sub }}>
                  {zeigeKonten ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Zuordnung der {kennzahlen.ek_konten.length} Eigenkapital-Konten
                </button>
                {zeigeKonten && (
                  <table className="w-full text-[11px] mt-2" style={{ borderCollapse: 'collapse' }}>
                    <tbody>
                      {kennzahlen.ek_konten.map((e) => (
                        <tr key={e.kontonummer} style={{ borderTop: `1px solid ${C.panelBdr}` }}>
                          <td className="py-1 pr-2 font-mono" style={{ color: C.heading }}>{e.kontonummer}</td>
                          <td className="py-1 pr-2" style={{ color: C.heading }}>{e.kontoname}</td>
                          <td className="py-1 pr-2" style={{ color: e.klasse === 'unbekannt' ? C.warnFg : C.sub }}>{EK_KLASSEN_LABEL[e.klasse]} <span style={{ color: C.muted }}>({e.quelle})</span></td>
                          <td className="py-1 text-right" style={{ color: C.heading, fontVariantNumeric: 'tabular-nums' }}>{chf(e.ist)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Gewinnverwendung */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.accent }}>Gewinnverwendung gemäss GV-Antrag</h3>
                {gvQuelle && <div className="text-[11px] mb-2" style={{ color: C.okFg }}>Übernommen aus {gvQuelle}</div>}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Betrag label="Dividende (brutto)" value={gv.dividende} onChange={(v) => setGv((g) => ({ ...g, dividende: v }))}
                    hint={kennzahlen.aktienkapital > 0 && gv.dividende ? `${Math.round((gv.dividende / kennzahlen.aktienkapital) * 10000) / 100} % des Kapitals` : null} />
                  <Betrag label="Tantiemen" value={gv.tantiemen} onChange={(v) => setGv((g) => ({ ...g, tantiemen: v }))} />
                  <Betrag label="Zuweisung gesetzliche Gewinnreserve" value={gv.zuweisung_gesetzl_gewinnreserve}
                    onChange={(v) => setGv((g) => ({ ...g, zuweisung_gesetzl_gewinnreserve: v }))}
                    hint={kennzahlen.gesetzliche_reserve.hinweis}
                    action={kennzahlen.gesetzliche_reserve.empfohlene_zuweisung > 0 && (
                      <button onClick={fuenfProzent} className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: C.accentBg, color: C.accent }}>
                        5 % einsetzen ({chf(kennzahlen.gesetzliche_reserve.empfohlene_zuweisung)})
                      </button>
                    )} />
                  <Betrag label="Zuweisung freiwillige Gewinnreserve" value={gv.zuweisung_freiwillige_reserve} onChange={(v) => setGv((g) => ({ ...g, zuweisung_freiwillige_reserve: v }))} />
                  <Betrag label="Verrechenbare Vorjahresverluste" value={verlustManuell != null ? verlustManuell : (vvAuto?.betrag ?? '')}
                    onChange={(v) => setVerlustManuell(v)}
                    hint={verlustManuell != null && verlustManuell !== '' ? 'manuell' : vvAuto ? vvAuto.quelle : 'Keine früheren Erklärungen mit Verlust gefunden'} />
                  <div className="rounded-lg px-3 py-2" style={{ backgroundColor: C.accentBg, border: `1px solid ${C.panelBdr}` }}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>Vortrag auf neue Rechnung</div>
                    <div className="text-sm font-semibold" style={{ color: kennzahlen.gewinnverwendung.vortrag_neu < 0 ? '#b91c1c' : C.heading, fontVariantNumeric: 'tabular-nums' }}>{chf(kennzahlen.gewinnverwendung.vortrag_neu)}</div>
                    <div className="text-[10px]" style={{ color: C.sub }}>Eigenkapital nach Verwendung {chf(kennzahlen.ek_nach_verwendung.total)}</div>
                  </div>
                </div>
              </div>

              {/* Warnungen */}
              {kennzahlen.warnungen.length > 0 && (
                <div className="rounded-lg p-3 text-xs space-y-1" style={{ backgroundColor: C.warnBg, color: C.warnFg }}>
                  {kennzahlen.warnungen.map((w, i) => <div key={i} className="flex gap-2"><AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />{w}</div>)}
                </div>
              )}

              {/* Ergebnis der Übernahme */}
              {merge && (
                <div className="rounded-lg p-3 text-xs" style={{ border: `1px solid ${C.panelBdr}` }}>
                  <div className="flex items-center justify-between">
                    <span style={{ color: C.heading }}>
                      <strong>{merge.neu.length}</strong> Felder werden neu gesetzt
                      {merge.geaendert.length > 0 && <>, <strong>{merge.geaendert.length}</strong> überschrieben</>}
                      {merge.konflikte.length > 0 && <>, <strong style={{ color: C.warnFg }}>{merge.konflikte.length}</strong> bereits erfasst und abweichend</>}
                    </span>
                    {merge.konflikte.length + merge.geaendert.length > 0 && (
                      <label className="flex items-center gap-2 cursor-pointer" style={{ color: C.sub }}>
                        <input type="checkbox" checked={ueberschreiben} onChange={(e) => setUeberschreiben(e.target.checked)} style={{ accentColor: C.accent }} />
                        Bestehende Werte überschreiben
                      </label>
                    )}
                  </div>
                  {merge.konflikte.length > 0 && (
                    <ul className="mt-2 space-y-0.5" style={{ color: C.sub }}>
                      {merge.konflikte.slice(0, 8).map((k) => <li key={k.feld}><span className="font-mono">{k.feld}</span>: erfasst {String(k.bestehend)} · Abschluss {String(k.vorschlag)}</li>)}
                      {merge.konflikte.length > 8 && <li>… und {merge.konflikte.length - 8} weitere</li>}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderTop: `1px solid ${C.panelBdr}` }}>
          <span className="text-[11px]" style={{ color: C.muted }}>Nur Felder aus der Jahresrechnung. Aufrechnungen, Abzüge und Ausscheidung bleiben manuell.</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: `1px solid ${C.panelBdr}`, color: C.sub }}>Abbrechen</button>
            <button
              disabled={!merge || (merge.neu.length + merge.geaendert.length === 0)}
              onClick={() => { onUebernehmen(merge.felder, { abschluss_id: abschlussId, kennzahlen }); onClose(); }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ backgroundColor: C.accent, opacity: !merge || (merge.neu.length + merge.geaendert.length === 0) ? 0.5 : 1 }}
            >
              <Check className="w-3.5 h-3.5" /> Übernehmen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
