/**
 * BankAbstimmung — Vollbild-Fenster (unabhängig von FiBuShell)
 * Route: /fibu/bank/:mandantId
 * Öffnen via: window.open(...)
 *
 * Layout: Header | [Banktransaktionen 45%] [Offene Posten 55%]
 * DnD: Bank-Kachel auf OP-Kachel ziehen → Match
 * Alternativ: Bank-Kachel klicken (markiert), dann OP klicken
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, closestCenter,
  useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { supabase } from '@/api/supabaseClient';
import { parseCamt053 } from '../utils/camtParser';
import { autoMatch, scoreMatch, confidenceInfo } from '../utils/matchingEngine';

// ── Farben ──────────────────────────────────────────────────────────
const C = {
  bg:       '#f0f4f0',
  panel:    '#ffffff',
  header:   '#2d4a30',
  green:    '#7a9b7f',
  greenLight:'#e8f0e8',
  red:      '#c0392b',
  redLight: '#fdecea',
  border:   '#d4dcd4',
  text:     '#1a1a2e',
  muted:    '#6b7a6b',
  eingang:  '#16a34a',
  ausgang:  '#dc2626',
  selected: '#1d4ed8',
  matched:  '#059669',
};

// ── Hilfsfunktionen ─────────────────────────────────────────────────
const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const abbr = (s, n = 32) => !s ? '' : s.length > n ? s.substring(0, n) + '…' : s;

function ConfBadge({ score }) {
  if (!score) return null;
  const info = confidenceInfo(score);
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
      color: info.color, background: info.bg, border: `1px solid ${info.color}33` }}>
      {info.dot} {Math.round(score * 100)}% {info.label}
    </span>
  );
}

function MethodBadge({ method }) {
  const labels = { QRR: 'QR-Ref', E2E: 'E2E-ID', AMOUNT_IBAN: 'Betrag+IBAN',
    AMOUNT_NAME: 'Betrag+Name', AMOUNT_ONLY: 'Betrag', FUZZY: 'Fuzzy', MANUAL: 'Manuell' };
  if (!method || method === 'none') return null;
  return (
    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 8,
      background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>
      {labels[method] ?? method}
    </span>
  );
}

// ── Bank-Transaktion Kachel ──────────────────────────────────────────
function TxCard({ tx, match, selected, onClick, dragging }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: tx.id });
  const isEin = tx.richtung === 'eingang';
  const isMatched = tx.status === 'gematcht' || !!match;
  const isIgnored = tx.status === 'ignoriert';

  const borderColor = isMatched ? C.matched
    : selected ? C.selected
    : isIgnored ? C.muted
    : C.border;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => !isMatched && onClick(tx.id)}
      style={{
        background: isDragging ? 'transparent' : isMatched ? '#f0fdf4' : selected ? '#eff6ff' : C.panel,
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 8,
        cursor: isMatched ? 'default' : 'grab',
        opacity: isDragging ? 0.3 : isIgnored ? 0.45 : 1,
        transition: 'all 0.15s',
        userSelect: 'none',
        boxShadow: selected ? '0 0 0 3px #bfdbfe' : '0 1px 3px #0001',
      }}
    >
      {/* Zeile 1: Datum + Betrag */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: C.muted }}>{fmtDate(tx.buchungsdatum)}</span>
        <span style={{ fontWeight: 700, fontSize: 14,
          color: isEin ? C.eingang : C.ausgang }}>
          {isEin ? '↑' : '↓'} CHF {fmt(tx.betrag)}
        </span>
      </div>

      {/* Zeile 2: Gegenpartei */}
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>
        {abbr(tx.gegenpartei_name ?? tx.verwendungszweck ?? '— Unbekannt —', 40)}
      </div>

      {/* Zeile 3: Referenz / Verwendungszweck */}
      {tx.referenz_nr && (
        <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace', marginBottom: 3 }}>
          QRR: {tx.referenz_nr.substring(0, 10)}…{tx.referenz_nr.substring(20)}
        </div>
      )}
      {!tx.referenz_nr && tx.verwendungszweck && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>
          {abbr(tx.verwendungszweck, 55)}
        </div>
      )}

      {/* Zeile 4: Badges */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
        {match && <ConfBadge score={match.score} />}
        {match && <MethodBadge method={match.method} />}
        {isMatched && !match && (
          <span style={{ fontSize: 10, fontWeight: 600, color: C.matched,
            background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: 10 }}>
            ✓ Gematcht
          </span>
        )}
        {isIgnored && (
          <span style={{ fontSize: 10, color: C.muted, background: '#f5f5f5',
            border: '1px solid #ddd', padding: '1px 6px', borderRadius: 10 }}>
            Ignoriert
          </span>
        )}
        {selected && !isMatched && (
          <span style={{ fontSize: 10, fontWeight: 600, color: C.selected,
            background: '#eff6ff', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: 10 }}>
            ◉ Ausgewählt — OP klicken
          </span>
        )}
      </div>
    </div>
  );
}

// ── Offener Posten Kachel ────────────────────────────────────────────
function OpCard({ op, match, selectedTxId, onDrop, onManualMatch, onRemoveMatch }) {
  const { setNodeRef, isOver } = useDroppable({ id: op.id });
  const isMatched = !!match;
  const isDebitor = op.typ === 'debitor';

  return (
    <div
      ref={setNodeRef}
      onClick={() => {
        if (isMatched) { onRemoveMatch(op.id); return; }
        if (selectedTxId) onManualMatch(selectedTxId, op.id);
      }}
      style={{
        background: isOver ? '#f0fdf4' : isMatched ? '#f0fdf4' : C.panel,
        border: `2px solid ${isOver ? C.matched : isMatched ? C.matched : selectedTxId ? C.selected : C.border}`,
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 8,
        cursor: isMatched ? 'pointer' : selectedTxId ? 'pointer' : 'default',
        transition: 'all 0.15s',
        boxShadow: isOver ? '0 0 0 3px #bbf7d0' : '0 1px 3px #0001',
      }}
    >
      {/* Zeile 1: Typ-Badge + Beleg-Nr + Betrag */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
            background: isDebitor ? '#dbeafe' : '#fef3c7',
            color: isDebitor ? '#1d4ed8' : '#92400e' }}>
            {isDebitor ? 'DEB' : 'KRED'}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{op.beleg_nr}</span>
        </div>
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>CHF {fmt(op.betrag_offen ?? op.betrag_brutto)}</span>
      </div>

      {/* Zeile 2: Name */}
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>
        {abbr(op.name, 40)}
      </div>

      {/* Zeile 3: Datum + Fälligkeit */}
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
        Beleg: {fmtDate(op.belegdatum)} · Fällig: {fmtDate(op.faelligkeit)}
        {op.faelligkeit && new Date(op.faelligkeit) < new Date() && !isMatched && (
          <span style={{ marginLeft: 6, color: C.ausgang, fontWeight: 600 }}>
            ({Math.round((Date.now() - new Date(op.faelligkeit)) / 86400000)} Tage überfällig)
          </span>
        )}
      </div>

      {/* Zeile 4: QRR + Match-Info */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {op.qr_referenz && (
          <span style={{ fontSize: 10, color: '#0369a1', background: '#e0f2fe',
            border: '1px solid #bae6fd', padding: '1px 6px', borderRadius: 8 }}>
            QRR
          </span>
        )}
        {match && <ConfBadge score={match.score} />}
        {match && <MethodBadge method={match.method} />}
        {isMatched && (
          <span style={{ fontSize: 10, color: '#dc2626', background: '#fff', cursor: 'pointer',
            border: '1px solid #fca5a5', padding: '1px 6px', borderRadius: 8 }}
            title="Match aufheben">✕</span>
        )}
        {selectedTxId && !isMatched && (
          <span style={{ fontSize: 10, color: C.selected, background: '#eff6ff',
            border: '1px solid #bfdbfe', padding: '1px 5px', borderRadius: 8 }}>
            + Hier matchen
          </span>
        )}
      </div>

      {/* Match-Info wenn vorhanden */}
      {match?.tx && (
        <div style={{ marginTop: 6, padding: '4px 8px', background: '#f0fdf4',
          borderRadius: 6, fontSize: 11, color: C.matched, borderLeft: '3px solid #22c55e' }}>
          ✓ {fmtDate(match.tx.buchungsdatum)} · {match.tx.gegenpartei_name ?? 'Bank'} · CHF {fmt(match.tx.betrag)}
        </div>
      )}
    </div>
  );
}

// ── Drag-Overlay (Ghost Card) ────────────────────────────────────────
function TxDragOverlay({ tx }) {
  if (!tx) return null;
  const isEin = tx.richtung === 'eingang';
  return (
    <div style={{ background: C.panel, border: `2px solid ${C.selected}`, borderRadius: 10,
      padding: '10px 12px', width: 280, boxShadow: '0 8px 24px #0003', opacity: 0.95 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: isEin ? C.eingang : C.ausgang }}>
        {isEin ? '↑' : '↓'} CHF {fmt(tx.betrag)}
      </div>
      <div style={{ fontSize: 12, color: C.text, marginTop: 2 }}>
        {abbr(tx.gegenpartei_name ?? tx.verwendungszweck ?? '—', 35)}
      </div>
      <div style={{ fontSize: 11, color: C.muted }}>{fmtDate(tx.buchungsdatum)}</div>
    </div>
  );
}

// ── Haupt-Komponente ─────────────────────────────────────────────────
export default function BankAbstimmung() {
  const { mandantId } = useParams();
  const fileRef = useRef();

  const [mandant,      setMandant]      = useState(null);
  const [transactions, setTransactions] = useState([]);   // DB + lokal
  const [openItems,    setOpenItems]    = useState([]);   // Kred. + Deb. OPs
  const [matches,      setMatches]      = useState({});   // { [txId]: { opId, score, method, tx, op } }
  const [selectedTx,   setSelectedTx]  = useState(null); // für Click-to-Match
  const [activeDrag,   setActiveDrag]  = useState(null); // für DnD Overlay
  const [txFilter,     setTxFilter]    = useState('offen');  // 'alle'|'offen'|'gematcht'
  const [opFilter,     setOpFilter]    = useState('alle');   // 'alle'|'debitoren'|'kreditoren'
  const [importing,    setImporting]   = useState(false);
  const [autoRunning,  setAutoRunning] = useState(false);
  const [toast,        setToast]       = useState(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // ── Daten laden ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mandantId) return;
    loadMandant();
    loadTransactions();
    loadOpenItems();
  }, [mandantId]);

  async function loadMandant() {
    const { data } = await supabase.from('fibu_mandanten').select('*').eq('id', mandantId).single();
    if (data) setMandant(data);
  }

  async function loadTransactions() {
    const { data } = await supabase
      .from('fibu_bank_transaktionen')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('buchungsdatum', { ascending: false });
    if (data) setTransactions(data);
  }

  async function loadOpenItems() {
    // Kreditoren OPs
    const { data: kred } = await supabase
      .from('fibu_kreditoren_belege')
      .select('id, beleg_nr, belegdatum, faelligkeit, betrag_brutto, betrag_bezahlt, lieferant:fibu_lieferanten(name, iban, qr_referenz)')
      .eq('mandant_id', mandantId)
      .in('status', ['offen', 'teilbezahlt']);

    const kredItems = (kred ?? []).map(b => ({
      id:            b.id,
      typ:           'kreditor',
      beleg_nr:      b.beleg_nr,
      belegdatum:    b.belegdatum,
      faelligkeit:   b.faelligkeit,
      name:          b.lieferant?.name ?? '—',
      iban:          b.lieferant?.iban ?? null,
      qr_referenz:   b.lieferant?.qr_referenz ?? null,
      betrag_brutto: b.betrag_brutto,
      betrag_offen:  Math.max(0, (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0)),
    }));

    // Debitoren OPs (Tabelle existiert ggf. noch nicht → graceful)
    let debItems = [];
    try {
      const { data: deb } = await supabase
        .from('fibu_debitoren_belege')
        .select('id, beleg_nr, belegdatum, faelligkeit, betrag_brutto, betrag_bezahlt, kunde_name, iban, qr_referenz')
        .eq('mandant_id', mandantId)
        .in('status', ['offen', 'teilbezahlt']);
      debItems = (deb ?? []).map(b => ({
        id:            b.id,
        typ:           'debitor',
        beleg_nr:      b.beleg_nr,
        belegdatum:    b.belegdatum,
        faelligkeit:   b.faelligkeit,
        name:          b.kunde_name ?? '—',
        iban:          b.iban ?? null,
        qr_referenz:   b.qr_referenz ?? null,
        betrag_brutto: b.betrag_brutto,
        betrag_offen:  Math.max(0, (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0)),
      }));
    } catch (_) { /* Debitoren-Modul noch nicht vorhanden */ }

    setOpenItems([...debItems, ...kredItems]);
  }

  // ── camt.053 Import ──────────────────────────────────────────────
  async function handleFileImport(e) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setImporting(true);
    let totalImported = 0;

    for (const file of files) {
      try {
        const xml = await file.text();
        const { transactions: parsed, kontoIban } = parseCamt053(xml);

        // App-seitiges Dedup: Fingerprints bereits importierter Transaktionen laden
        const minDate = parsed.reduce((m, t) => (!m || t.buchungsdatum < m) ? t.buchungsdatum : m, null);
        const { data: existing } = await supabase
          .from('fibu_bank_transaktionen')
          .select('buchungsdatum, betrag, richtung, referenz_nr, end_to_end_id')
          .eq('mandant_id', mandantId)
          .eq('konto_iban', kontoIban)
          .gte('buchungsdatum', minDate ?? '2000-01-01');

        const existingKeys = new Set((existing ?? []).map(t =>
          `${t.buchungsdatum}|${t.betrag}|${t.richtung}|${t.referenz_nr ?? ''}|${t.end_to_end_id ?? ''}`
        ));

        const newTx = parsed.filter(tx => {
          const key = `${tx.buchungsdatum}|${tx.betrag}|${tx.richtung}|${tx.referenz_nr ?? ''}|${tx.end_to_end_id ?? ''}`;
          return !existingKeys.has(key);
        });

        if (newTx.length === 0) {
          showToast(`${file.name}: Alle ${parsed.length} Transaktionen bereits vorhanden`, 'info');
          continue;
        }

        // Import-Record anlegen
        const { data: importRec } = await supabase
          .from('fibu_bank_imports')
          .insert({ mandant_id: mandantId, dateiname: file.name, konto_iban: kontoIban,
            anzahl_transaktionen: newTx.length })
          .select().single();

        // Neue Transaktionen einfügen (Dedup bereits app-seitig erledigt)
        const rows = newTx.map(tx => ({ ...tx, mandant_id: mandantId, import_id: importRec?.id }));
        const { data: inserted, error: insertErr } = await supabase
          .from('fibu_bank_transaktionen')
          .insert(rows)
          .select('id');

        if (insertErr) throw new Error(insertErr.message);
        totalImported += (inserted?.length ?? newTx.length);

      } catch (err) {
        showToast(`Fehler bei ${file.name}: ${err.message}`, 'error');
      }
    }

    await loadTransactions();
    if (totalImported > 0) showToast(`${totalImported} neue Transaktionen importiert`, 'success');
    setImporting(false);
    e.target.value = '';
  }

  // ── Auto-Match ───────────────────────────────────────────────────
  async function runAutoMatch() {
    setAutoRunning(true);
    const offen = transactions.filter(tx => tx.status === 'offen');
    const suggestions = autoMatch(offen, openItems);

    const newMatches = { ...matches };
    let count = 0;
    for (const s of suggestions) {
      if (!newMatches[s.tx_id]) {
        const tx = transactions.find(t => t.id === s.tx_id);
        const op = openItems.find(o => o.id === s.op_id);
        newMatches[s.tx_id] = { opId: s.op_id, score: s.score, method: s.method, tx, op };
        count++;
      }
    }
    setMatches(newMatches);
    setAutoRunning(false);
    showToast(`${count} Vorschläge gefunden`, 'success');
  }

  // ── Match erstellen ──────────────────────────────────────────────
  function createMatch(txId, opId) {
    const tx = transactions.find(t => t.id === txId);
    const op = openItems.find(o => o.id === opId);
    if (!tx || !op) return;
    const { score, method } = scoreMatch(tx, op);
    setMatches(prev => ({ ...prev, [txId]: { opId, score, method, tx, op } }));
    setSelectedTx(null);
  }

  function removeMatch(opId) {
    setMatches(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (next[k].opId === opId) delete next[k]; });
      return next;
    });
  }

  // ── Matches bestätigen & buchen ──────────────────────────────────
  async function confirmAllMatches() {
    const toConfirm = Object.entries(matches);
    if (!toConfirm.length) { showToast('Keine Matches vorhanden', 'info'); return; }

    let booked = 0;
    for (const [txId, m] of toConfirm) {
      try {
        if (m.op.typ === 'kreditor') {
          await supabase.rpc('fibu_bank_match_kreditor', {
            p_tx_id:      txId,
            p_beleg_id:   m.opId,
            p_betrag:     m.tx.betrag,
            p_datum:      m.tx.buchungsdatum,
            p_confidence: m.score,
            p_methode:    m.method,
          });
        } else {
          // Debitoren-Buchung (später implementieren)
          await supabase.from('fibu_bank_transaktionen').update({
            status: 'gematcht', matched_beleg_id: m.opId, matched_typ: m.op.typ,
            match_confidence: m.score, match_methode: m.method,
          }).eq('id', txId);
        }
        booked++;
      } catch (err) { showToast(`Buchungsfehler: ${err.message}`, 'error'); }
    }

    await Promise.all([loadTransactions(), loadOpenItems()]);
    setMatches({});
    showToast(`${booked} Matches bestätigt und verbucht`, 'success');
  }

  // ── DnD Handler ──────────────────────────────────────────────────
  function handleDragStart(ev) {
    const tx = transactions.find(t => t.id === ev.active.id);
    if (tx) setActiveDrag(tx);
  }

  function handleDragEnd(ev) {
    setActiveDrag(null);
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    // active = txId, over = opId
    const isTx = transactions.some(t => t.id === active.id);
    const isOp = openItems.some(o => o.id === over.id);
    if (isTx && isOp) createMatch(active.id, over.id);
  }

  // ── Toast ────────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Filter ──────────────────────────────────────────────────────
  const matchedTxIds = new Set(Object.keys(matches));
  const matchedOpIds = new Set(Object.values(matches).map(m => m.opId));

  const visibleTx = transactions.filter(tx => {
    const hasMatch = matchedTxIds.has(tx.id) || tx.status === 'gematcht';
    if (txFilter === 'offen')    return tx.status === 'offen' && !hasMatch;
    if (txFilter === 'gematcht') return hasMatch || tx.status === 'gematcht';
    return true;
  });

  const visibleOp = openItems.filter(op => {
    if (opFilter === 'debitoren')  return op.typ === 'debitor';
    if (opFilter === 'kreditoren') return op.typ === 'kreditor';
    return true;
  });

  // ── Stats ────────────────────────────────────────────────────────
  const txOffen    = transactions.filter(t => t.status === 'offen' && !matchedTxIds.has(t.id)).length;
  const txGematcht = matchedTxIds.size + transactions.filter(t => t.status === 'gematcht').length;
  const opOffen    = openItems.filter(o => !matchedOpIds.has(o.id)).length;
  const sumEin     = transactions.filter(t => t.richtung === 'eingang').reduce((s, t) => s + (t.betrag ?? 0), 0);
  const sumAus     = transactions.filter(t => t.richtung === 'ausgang').reduce((s, t) => s + (t.betrag ?? 0), 0);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh',
        background: C.bg, fontFamily: "'Inter', system-ui, sans-serif", color: C.text, overflow: 'hidden' }}>

        {/* ── Header ────────────────────────────────────────────── */}
        <header style={{ background: C.header, color: '#fff', padding: '0 20px',
          height: 56, display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
          boxShadow: '0 2px 8px #0004' }}>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>
            Artis FiBu
          </div>
          <div style={{ width: 1, height: 20, background: '#ffffff30' }} />
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            Bankabstimmung
            {mandant && <span style={{ fontWeight: 400, opacity: 0.75, marginLeft: 8 }}>— {mandant.name}</span>}
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 12, marginLeft: 16, fontSize: 12 }}>
            <span style={{ background: '#ffffff15', padding: '3px 10px', borderRadius: 20 }}>
              ↑ CHF {fmt(sumEin)}
            </span>
            <span style={{ background: '#ffffff15', padding: '3px 10px', borderRadius: 20 }}>
              ↓ CHF {fmt(sumAus)}
            </span>
            <span style={{ background: txGematcht > 0 ? '#22c55e40' : '#ffffff15', padding: '3px 10px', borderRadius: 20 }}>
              ✓ {txGematcht} Matches
            </span>
            <span style={{ background: '#ffffff15', padding: '3px 10px', borderRadius: 20 }}>
              {txOffen} offen
            </span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Aktionen */}
          <input ref={fileRef} type="file" accept=".xml" multiple style={{ display: 'none' }}
            onChange={handleFileImport} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #ffffff40',
              background: importing ? '#ffffff20' : '#ffffff25', color: '#fff',
              cursor: importing ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600 }}>
            {importing ? '⏳ Importiere…' : '📂 camt.053 importieren'}
          </button>

          <button onClick={runAutoMatch} disabled={autoRunning || transactions.length === 0}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #ffffff40',
              background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {autoRunning ? '⏳…' : '⚡ Auto-Match'}
          </button>

          {Object.keys(matches).length > 0 && (
            <button onClick={confirmAllMatches}
              style={{ padding: '6px 14px', borderRadius: 8, background: '#16a34a',
                color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                boxShadow: '0 0 0 2px #4ade80' }}>
              ✓ {Object.keys(matches).length} bestätigen & buchen
            </button>
          )}

          <button onClick={() => window.close()} title="Fenster schliessen"
            style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #ffffff30',
              background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
            ✕
          </button>
        </header>

        {/* ── Haupt-Inhalt: zwei Spalten ───────────────────────── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 0 }}>

          {/* ── Linke Spalte: Banktransaktionen 45% ──────────── */}
          <div style={{ width: '45%', display: 'flex', flexDirection: 'column',
            borderRight: `1px solid ${C.border}`, overflow: 'hidden' }}>

            {/* Sub-Header */}
            <div style={{ padding: '10px 14px 8px', background: '#e8f0e8',
              borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: C.header }}>
                  🏦 Banktransaktionen
                  <span style={{ fontWeight: 400, marginLeft: 6, color: C.muted, fontSize: 12 }}>
                    ({visibleTx.length} / {transactions.length})
                  </span>
                </span>
                <span style={{ fontSize: 11, color: C.muted }}>Kachel ziehen → auf OP legen</span>
              </div>
              {/* Filter-Tabs */}
              <div style={{ display: 'flex', gap: 4 }}>
                {[['offen','Offen'], ['gematcht','Gematcht'], ['alle','Alle']].map(([val, lbl]) => (
                  <button key={val} onClick={() => setTxFilter(val)}
                    style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, border: 'none',
                      cursor: 'pointer', fontWeight: txFilter === val ? 700 : 400,
                      background: txFilter === val ? C.header : '#d4dcd4',
                      color: txFilter === val ? '#fff' : C.text }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Transaktion-Liste */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {visibleTx.length === 0 && (
                <div style={{ textAlign: 'center', color: C.muted, padding: '40px 20px', fontSize: 13 }}>
                  {transactions.length === 0
                    ? <>Noch keine Transaktionen importiert.<br />camt.053 Datei oben importieren.</>
                    : 'Keine Transaktionen in diesem Filter.'}
                </div>
              )}
              {visibleTx.map(tx => (
                <TxCard key={tx.id} tx={tx}
                  match={matches[tx.id]}
                  selected={selectedTx === tx.id}
                  onClick={(id) => setSelectedTx(selectedTx === id ? null : id)}
                />
              ))}
            </div>
          </div>

          {/* ── Rechte Spalte: Offene Posten 55% ─────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Sub-Header */}
            <div style={{ padding: '10px 14px 8px', background: '#fef9e7',
              borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>
                  📄 Offene Posten
                  <span style={{ fontWeight: 400, marginLeft: 6, color: C.muted, fontSize: 12 }}>
                    ({visibleOp.filter(o => !matchedOpIds.has(o.id)).length} offen / {Object.keys(matches).length} zugeordnet)
                  </span>
                </span>
                {selectedTx && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.selected,
                    background: '#eff6ff', padding: '2px 8px', borderRadius: 10, border: '1px solid #bfdbfe' }}>
                    ◉ Transaktion ausgewählt — OP anklicken
                  </span>
                )}
              </div>
              {/* Filter-Tabs */}
              <div style={{ display: 'flex', gap: 4 }}>
                {[['alle','Alle'], ['kreditoren','Kreditoren'], ['debitoren','Debitoren']].map(([val, lbl]) => (
                  <button key={val} onClick={() => setOpFilter(val)}
                    style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, border: 'none',
                      cursor: 'pointer', fontWeight: opFilter === val ? 700 : 400,
                      background: opFilter === val ? '#92400e' : '#e8d5a3',
                      color: opFilter === val ? '#fff' : C.text }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* OP-Liste — 2-spaltig */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12,
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, alignContent: 'start' }}>

              {/* Gematchte OPs zuerst (oben) */}
              {visibleOp.filter(o => matchedOpIds.has(o.id)).map(op => (
                <div key={op.id} style={{ padding: '0 4px 0 0' }}>
                  <OpCard op={op}
                    match={Object.values(matches).find(m => m.opId === op.id)}
                    selectedTxId={selectedTx}
                    onDrop={createMatch}
                    onManualMatch={createMatch}
                    onRemoveMatch={removeMatch} />
                </div>
              ))}

              {/* Offene OPs */}
              {visibleOp.filter(o => !matchedOpIds.has(o.id)).map(op => (
                <div key={op.id} style={{ padding: '0 4px 0 0' }}>
                  <OpCard op={op}
                    match={null}
                    selectedTxId={selectedTx}
                    onDrop={createMatch}
                    onManualMatch={createMatch}
                    onRemoveMatch={removeMatch} />
                </div>
              ))}

              {visibleOp.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', color: C.muted,
                  padding: '40px 20px', fontSize: 13 }}>
                  Keine offenen Posten vorhanden.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── DnD Ghost ────────────────────────────────────────── */}
        <DragOverlay>
          {activeDrag && <TxDragOverlay tx={activeDrag} />}
        </DragOverlay>

        {/* ── Toast ────────────────────────────────────────────── */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            background: toast.type === 'error' ? '#dc2626' : toast.type === 'success' ? '#16a34a' : '#1d4ed8',
            color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            boxShadow: '0 4px 20px #0004', zIndex: 9999, pointerEvents: 'none' }}>
            {toast.msg}
          </div>
        )}
      </div>
    </DndContext>
  );
}
