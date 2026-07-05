import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, Receipt, FileText, Clock, PhoneCall, Phone } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { openApp } from './openApp';
import { scheduleNavPrefsSave } from './navPrefsSync';

// ── Hub-Widgets: Mini-Dashboard am rechten Hub-Rand ────────────────
// Vier Kacheln (Debitoren-OPs, Kreditoren-OPs, grösste angefangene
// Projekte, Rückrufe des Users), per Drag verschiebbar (Reihenfolge in
// localStorage `hub_widgets_order`, via nav_prefs synchronisiert).
// Aktivierbar pro Benutzer: Einstellungen → Darstellung → Navigation.

const CHF = (n) => (n ?? 0).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const rest = (b) => (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0);

export const WIDGET_ORDER_KEY = 'hub_widgets_order';
const DEFAULT_ORDER = ['debitoren', 'kreditoren', 'arbeiten', 'rueckrufe'];

export function getWidgetOrder() {
  try {
    const o = JSON.parse(localStorage.getItem(WIDGET_ORDER_KEY));
    if (Array.isArray(o) && o.length) {
      return [...o.filter(id => DEFAULT_ORDER.includes(id)), ...DEFAULT_ORDER.filter(id => !o.includes(id))];
    }
  } catch { /* Default */ }
  return DEFAULT_ORDER;
}

// ── Bausteine ──────────────────────────────────────────────────────
// Kleiner Mandanten-Filter im Widget-Kopf ('' = alle Mandanten)
function MandantSelect({ pal, mandanten, value, onChange }) {
  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: 10, color: pal.sub, background: 'transparent', border: 'none',
        outline: 'none', cursor: 'pointer', padding: 0, maxWidth: 150,
        fontFamily: 'inherit', appearance: 'auto',
      }}
    >
      <option value="">Alle Mandanten</option>
      {(mandanten ?? []).map(m => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  );
}

function Widget({ pal, icon: Icon, color, title, sub, subNode, onOpen, openLabel, dragHandleProps, children }) {
  return (
    <div style={{
      borderRadius: 16, background: pal.panelBg, border: `1px solid ${pal.panelBorder}`,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 12px 9px' }}>
        <span {...dragHandleProps} title="Verschieben" style={{ color: pal.sub, cursor: 'grab', display: 'flex', flexShrink: 0 }}>
          <GripVertical style={{ width: 13, height: 13 }} />
        </span>
        <span style={{
          width: 27, height: 27, borderRadius: 8, flexShrink: 0,
          background: `linear-gradient(135deg, ${color}, ${color}bb)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}>
          <Icon style={{ width: 13, height: 13 }} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: pal.tileInk }}>{title}</b>
          {subNode ?? (sub && <small style={{ display: 'block', fontSize: 10, color: pal.sub }}>{sub}</small>)}
        </span>
        {onOpen && (
          <button
            onClick={onOpen}
            style={{ fontSize: 10.5, fontWeight: 700, color: pal.accentText, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >{openLabel} →</button>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ pal, onClick, main, subLine, badge, badgeKind, amount, extra }) {
  const [hover, setHover] = useState(false);
  const badgeStyle = {
    red: { background: 'rgba(181,44,44,.14)', color: '#d06a6a' },
    amber: { background: 'rgba(180,83,9,.14)', color: '#cf9143' },
    green: { background: 'rgba(62,122,78,.16)', color: '#5fae72' },
  }[badgeKind ?? 'green'];
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 12px', fontSize: 12, textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
        background: hover && onClick ? pal.rowHover : 'transparent',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, color: pal.tileInk, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{main}</span>
        {subLine && <span className="num" style={{ display: 'block', fontSize: 10, color: pal.sub }}>{subLine}</span>}
      </span>
      {badge && (
        <span style={{ ...badgeStyle, fontSize: 9, fontWeight: 800, borderRadius: 8, padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {badge}
        </span>
      )}
      {amount != null && (
        <span style={{ fontWeight: 650, color: pal.tileInk, whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
          {amount}
        </span>
      )}
      {extra}
    </button>
  );
}

function Kpi({ pal, value, caption }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 12px 6px 41px' }}>
      <span style={{ fontSize: 19, fontWeight: 750, letterSpacing: '-.02em', color: pal.tileInk, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 10.5, color: pal.sub, fontVariantNumeric: 'tabular-nums' }}>{caption}</span>
    </div>
  );
}

function Status({ pal, q, emptyText }) {
  if (q.isLoading) return <div style={{ padding: '10px 14px 14px', fontSize: 11, color: pal.sub }}>Lädt…</div>;
  if (q.isError) return <div style={{ padding: '10px 14px 14px', fontSize: 11, color: '#d06a6a' }}>Daten nicht verfügbar</div>;
  return <div style={{ padding: '10px 14px 14px', fontSize: 11, color: pal.sub }}>{emptyText}</div>;
}

// ── Die vier Widgets ───────────────────────────────────────────────
function DebitorenWidget({ pal, navigate, dragHandleProps, mandanten }) {
  const [mandantId, setMandantId] = useState(() => localStorage.getItem('hub_mandant_deb') || '');
  const pickMandant = (id) => {
    setMandantId(id);
    try { localStorage.setItem('hub_mandant_deb', id); } catch { /* egal */ }
    scheduleNavPrefsSave();
  };
  const q = useQuery({
    queryKey: ['hub-widget', 'debitoren-op', mandantId],
    staleTime: 120_000,
    queryFn: async () => {
      let query = supabase
        .from('fibu_debitoren_belege')
        .select('id, mandant_id, betrag_brutto, betrag_bezahlt, faelligkeit, status, kunde:fibu_kunden(name), mandant:fibu_mandanten(name)')
        .in('status', ['offen', 'teilbezahlt'])
        .order('faelligkeit', { ascending: true })
        .limit(500);
      if (mandantId) query = query.eq('mandant_id', mandantId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
  const belege = q.data ?? [];
  const total = belege.reduce((s, b) => s + rest(b), 0);
  const heute = new Date().toISOString().slice(0, 10);
  const ueberfaellig = belege.filter(b => b.faelligkeit && b.faelligkeit < heute);
  const top = [...ueberfaellig, ...belege.filter(b => !ueberfaellig.includes(b))].slice(0, 4);
  const tage = (f) => f ? Math.round((Date.now() - new Date(f).getTime()) / 86400000) : 0;

  return (
    <Widget pal={pal} dragHandleProps={dragHandleProps} icon={FileText} color="#3e9b6e" title="Debitoren offen"
            subNode={<MandantSelect pal={pal} mandanten={mandanten} value={mandantId} onChange={pickMandant} />}
            openLabel="Debitoren"
            onOpen={() => openApp(mandantId
              ? { href: `/fibu/${mandantId}/debitoren/uebersicht`, label: 'Debitoren', name: 'HubWidgetDebitoren' }
              : { fibu: 'debitoren/uebersicht', label: 'Debitoren', name: 'HubWidgetDebitoren' }, { navigate })}>
      {belege.length > 0 && <Kpi pal={pal} value={`CHF ${CHF(total)}`} caption={`${belege.length} Rechn. · ${ueberfaellig.length} überfällig`} />}
      {top.length ? (
        <div style={{ borderTop: `1px solid ${pal.panelBorder}`, padding: '4px 0 6px' }}>
          {top.map(b => (
            <Row key={b.id} pal={pal}
                 onClick={() => openApp({ href: `/fibu/${b.mandant_id}/debitoren/uebersicht`, label: 'Debitoren', name: 'HubWidgetDebitoren' }, { navigate })}
                 main={b.kunde?.name ?? '—'}
                 subLine={`${b.mandant?.name ?? ''}${b.faelligkeit ? ' · fällig ' + new Date(b.faelligkeit).toLocaleDateString('de-CH') : ''}`}
                 badge={b.faelligkeit && b.faelligkeit < heute ? `${tage(b.faelligkeit)} Tg` : 'läuft'}
                 badgeKind={b.faelligkeit && b.faelligkeit < heute ? 'red' : 'green'}
                 amount={CHF(rest(b))} />
          ))}
        </div>
      ) : <Status pal={pal} q={q} emptyText="Keine offenen Debitoren 🎉" />}
    </Widget>
  );
}

function KreditorenWidget({ pal, navigate, dragHandleProps, mandanten }) {
  const [mandantId, setMandantId] = useState(() => localStorage.getItem('hub_mandant_kred') || '');
  const pickMandant = (id) => {
    setMandantId(id);
    try { localStorage.setItem('hub_mandant_kred', id); } catch { /* egal */ }
    scheduleNavPrefsSave();
  };
  const q = useQuery({
    queryKey: ['hub-widget', 'kreditoren-op', mandantId],
    staleTime: 120_000,
    queryFn: async () => {
      let query = supabase
        .from('fibu_kreditoren_belege')
        .select('id, mandant_id, betrag_brutto, betrag_bezahlt, faelligkeit, status, lieferant:fibu_lieferanten(name), mandant:fibu_mandanten(name)')
        .in('status', ['offen', 'ausstehend', 'ebanking', 'teilbezahlt'])
        .order('faelligkeit', { ascending: true })
        .limit(500);
      if (mandantId) query = query.eq('mandant_id', mandantId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
  const belege = q.data ?? [];
  const total = belege.reduce((s, b) => s + rest(b), 0);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const heute = new Date().toISOString().slice(0, 10);
  const faellig = belege.filter(b => b.faelligkeit && b.faelligkeit <= in7);
  const top = belege.slice(0, 4);

  return (
    <Widget pal={pal} dragHandleProps={dragHandleProps} icon={Receipt} color="#c9564f" title="Kreditoren offen"
            subNode={<MandantSelect pal={pal} mandanten={mandanten} value={mandantId} onChange={pickMandant} />}
            openLabel="OP-Liste"
            onOpen={() => openApp(mandantId
              ? { href: `/fibu/${mandantId}/kreditoren/opliste`, label: 'OP-Liste', name: 'HubWidgetKreditoren' }
              : { fibu: 'kreditoren/opliste', label: 'OP-Liste', name: 'HubWidgetKreditoren' }, { navigate })}>
      {belege.length > 0 && <Kpi pal={pal} value={`CHF ${CHF(total)}`} caption={`${belege.length} Belege · ${faellig.length} fällig ≤ 7 Tage`} />}
      {top.length ? (
        <div style={{ borderTop: `1px solid ${pal.panelBorder}`, padding: '4px 0 6px' }}>
          {top.map(b => (
            <Row key={b.id} pal={pal}
                 onClick={() => openApp({ href: `/fibu/${b.mandant_id}/kreditoren/uebersicht`, label: 'Kreditoren', name: 'HubWidgetKreditoren' }, { navigate })}
                 main={b.lieferant?.name ?? '—'}
                 subLine={`${b.mandant?.name ?? ''}${b.faelligkeit ? ' · fällig ' + new Date(b.faelligkeit).toLocaleDateString('de-CH') : ''}`}
                 badge={b.faelligkeit && b.faelligkeit < heute ? 'überfällig' : b.faelligkeit && b.faelligkeit <= in7 ? 'fällig' : 'läuft'}
                 badgeKind={b.faelligkeit && b.faelligkeit < heute ? 'red' : b.faelligkeit && b.faelligkeit <= in7 ? 'amber' : 'green'}
                 amount={CHF(rest(b))} />
          ))}
        </div>
      ) : <Status pal={pal} q={q} emptyText="Keine offenen Kreditoren 🎉" />}
    </Widget>
  );
}

function ArbeitenWidget({ pal, navigate, dragHandleProps }) {
  const q = useQuery({
    queryKey: ['hub-widget', 'arbeiten'],
    staleTime: 300_000,
    queryFn: async () => {
      // Unfakturierte Zeiteinträge einsammeln (paginiert, minimale Spalten)
      const PAGE = 1000;
      let entries = [];
      for (let i = 0; i < 5; i++) {
        const { data, error } = await supabase
          .from('le_time_entry')
          .select('project_id, hours_internal, rate_snapshot')
          .is('invoice_id', null)
          .not('project_id', 'is', null)
          .range(i * PAGE, (i + 1) * PAGE - 1);
        if (error) throw error;
        entries = entries.concat(data ?? []);
        if ((data ?? []).length < PAGE) break;
      }
      const { data: projects, error: pErr } = await supabase
        .from('le_project')
        .select('id, name, customer:customers(company_name)');
      if (pErr) throw pErr;

      const byProject = new Map();
      for (const e of entries) {
        const amount = (e.hours_internal ?? 0) * (e.rate_snapshot ?? 0);
        const cur = byProject.get(e.project_id) ?? { amount: 0, hours: 0 };
        cur.amount += amount;
        cur.hours += e.hours_internal ?? 0;
        byProject.set(e.project_id, cur);
      }
      const names = new Map((projects ?? []).map(p => [p.id, p]));
      const list = [...byProject.entries()]
        .map(([id, v]) => ({ id, ...v, project: names.get(id) }))
        .filter(x => x.project && x.amount > 0)
        .sort((a, b) => b.amount - a.amount);
      return { top: list.slice(0, 5), total: list.reduce((s, x) => s + x.amount, 0) };
    },
  });
  const top = q.data?.top ?? [];

  return (
    <Widget pal={pal} dragHandleProps={dragHandleProps} icon={Clock} color="#2e9aa8" title="Angefangene Arbeiten" sub="grösste Projekte · unfakturiert"
            openLabel="Leistungen" onOpen={() => openApp({ name: 'Leistungserfassung', label: 'Leistungserfassung' }, { navigate })}>
      {top.length ? (
        <>
          <div style={{ padding: '2px 0 6px' }}>
            {top.map(x => (
              <Row key={x.id} pal={pal}
                   onClick={() => openApp({ name: 'Leistungserfassung', label: 'Leistungserfassung' }, { navigate })}
                   main={`${x.project.name}${x.project.customer?.company_name ? ' · ' + x.project.customer.company_name : ''}`}
                   subLine={`${x.hours.toLocaleString('de-CH', { maximumFractionDigits: 1 })} h unfakturiert`}
                   amount={CHF(x.amount)} />
            ))}
          </div>
          <div className="num" style={{ borderTop: `1px solid ${pal.panelBorder}`, padding: '7px 12px', fontSize: 10, color: pal.sub }}>
            Total unfakturiert: CHF {CHF(q.data?.total)}
          </div>
        </>
      ) : <Status pal={pal} q={q} emptyText="Keine unfakturierten Arbeiten" />}
    </Widget>
  );
}

function RueckrufeWidget({ pal, navigate, profile, dragHandleProps }) {
  const q = useQuery({
    queryKey: ['hub-widget', 'rueckrufe', profile?.full_name ?? ''],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('call_notes_pending')
        .select('id, phone_number, artis_user_name, note_title, note_text, clicked_at')
        .is('linked_call_id', null)
        .order('clicked_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const alle = data ?? [];
      // Nur die eigenen; falls dem User nichts zugeordnet ist, leer lassen
      return profile?.full_name ? alle.filter(n => n.artis_user_name === profile.full_name) : alle;
    },
  });
  const notes = (q.data ?? []).slice(0, 4);

  return (
    <Widget pal={pal} dragHandleProps={dragHandleProps} icon={PhoneCall} color="#4fae6b" title="Meine Rückrufe" sub={profile?.full_name ? `für ${profile.full_name.split(' ')[0]}` : 'Telefon-Pendenzen'}
            openLabel="Telefon" onOpen={() => openApp({ name: 'TelefonDashboard', label: 'Telefon' }, { navigate })}>
      {notes.length ? (
        <div style={{ padding: '2px 0 6px' }}>
          {notes.map(n => (
            <Row key={n.id} pal={pal}
                 onClick={() => openApp({ name: 'TelefonDashboard', label: 'Telefon' }, { navigate })}
                 main={n.note_title || n.phone_number || 'Rückruf'}
                 subLine={`${n.phone_number ?? ''}${n.clicked_at ? ' · ' + new Date(n.clicked_at).toLocaleDateString('de-CH') : ''}`}
                 extra={n.phone_number ? (
                   <span
                     title={`${n.phone_number} anrufen`}
                     onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${n.phone_number}`; }}
                     style={{
                       width: 24, height: 24, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
                       display: 'flex', alignItems: 'center', justifyContent: 'center',
                       background: 'rgba(79,174,107,.15)', color: '#4fae6b',
                     }}
                   ><Phone style={{ width: 12, height: 12 }} /></span>
                 ) : null} />
          ))}
        </div>
      ) : <Status pal={pal} q={q} emptyText="Keine offenen Rückrufe 🎉" />}
    </Widget>
  );
}

const WIDGET_MAP = {
  debitoren: DebitorenWidget,
  kreditoren: KreditorenWidget,
  arbeiten: ArbeitenWidget,
  rueckrufe: RueckrufeWidget,
};

// ── Container mit Drag-Reorder ─────────────────────────────────────
export default function HubWidgets({ pal, navigate, profile }) {
  const [order, setOrder] = useState(getWidgetOrder);

  // Mandantenliste für die Filter in den OP-Widgets (RLS: nur eigene)
  const mandantenQ = useQuery({
    queryKey: ['hub-widget', 'mandanten'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('fibu_mandanten').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const next = Array.from(order);
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    setOrder(next);
    try {
      localStorage.setItem(WIDGET_ORDER_KEY, JSON.stringify(next));
    } catch { /* egal */ }
    scheduleNavPrefsSave();
  };

  return (
    <aside style={{ width: 308, flexShrink: 0, position: 'sticky', top: 18 }}>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '.15em', textTransform: 'uppercase',
        color: pal.label, padding: '0 4px 10px',
      }}>Überblick · heute</div>
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="hub-widgets">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}
                 style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {order.map((id, index) => {
                const W = WIDGET_MAP[id];
                if (!W) return null;
                return (
                  <Draggable key={id} draggableId={id} index={index}>
                    {(drag) => (
                      <div ref={drag.innerRef} {...drag.draggableProps} style={drag.draggableProps.style}>
                        <WidgetShell dragHandleProps={drag.dragHandleProps} pal={pal} navigate={navigate} profile={profile} mandanten={mandantenQ.data ?? []} id={id} />
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </aside>
  );
}

// Reicht die DragHandle-Props ans jeweilige Widget weiter
function WidgetShell({ id, dragHandleProps, ...rest }) {
  const W = WIDGET_MAP[id];
  return <W {...rest} dragHandleProps={dragHandleProps} />;
}
