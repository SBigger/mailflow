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
import { useParams, useNavigate } from 'react-router-dom';
import {
  DndContext, DragOverlay, closestCenter,
  useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { supabase } from '@/api/supabaseClient';
import { parseCamt053 } from '../utils/camtParser';
import { parseCsvBank } from '../utils/csvBankParser';
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
      {tx.gegenpartei_name && (
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>
          {abbr(tx.gegenpartei_name, 50)}
        </div>
      )}

      {/* Zeile 3: Verwendungszweck (immer anzeigen wenn vorhanden) */}
      {tx.verwendungszweck && tx.verwendungszweck !== tx.gegenpartei_name && (
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 2, lineHeight: 1.4 }}>
          {abbr(tx.verwendungszweck, 80)}
        </div>
      )}

      {/* Zeile 4: QR-Referenz */}
      {tx.referenz_nr && (
        <div style={{ fontSize: 10.5, color: '#0369a1', fontFamily: 'monospace', marginBottom: 2 }}>
          QRR: {tx.referenz_nr}
        </div>
      )}

      {/* Zeile 5: Zusatzinfo (CAMT: Avisierungstext etc.) */}
      {tx.zusatzinfo && tx.zusatzinfo !== tx.verwendungszweck && (
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 2, fontStyle: 'italic' }}>
          {abbr(tx.zusatzinfo, 80)}
        </div>
      )}

      {/* Zeile 6: IBAN + Waehrung falls nicht CHF */}
      {(tx.gegenpartei_iban || (tx.waehrung && tx.waehrung !== 'CHF')) && (
        <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace', marginBottom: 2 }}>
          {tx.gegenpartei_iban && abbr(tx.gegenpartei_iban, 30)}
          {tx.waehrung && tx.waehrung !== 'CHF' && <span style={{ marginLeft: 6, color: '#d97706', fontWeight: 600 }}>{tx.waehrung}</span>}
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
      {/* Zeile 1: Typ-Badge + Status + Beleg-Nr + Betrag */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
            background: isDebitor ? '#dbeafe' : '#fef3c7',
            color: isDebitor ? '#1d4ed8' : '#92400e' }}>
            {isDebitor ? 'DEB' : 'KRED'}
          </span>
          {op.status === 'bezahlt' && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
              background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}>
              ✓ bezahlt
            </span>
          )}
          {op.status === 'teilbezahlt' && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
              background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047' }}>
              ½ teilbezahlt
            </span>
          )}
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
  const navigate = useNavigate();
  const fileRef    = useRef();
  const csvFileRef = useRef();

  const [mandant,      setMandant]      = useState(null);
  const [transactions, setTransactions] = useState([]);   // DB + lokal
  const [openItems,    setOpenItems]    = useState([]);   // Kred. + Deb. OPs
  const [opLoadErr,    setOpLoadErr]   = useState(null); // Fehler beim Laden
  const [matches,      setMatches]      = useState({});   // { [txId]: { opId, score, method, tx, op } }
  const [selectedTx,   setSelectedTx]  = useState(null); // für Click-to-Match
  const [activeDrag,   setActiveDrag]  = useState(null); // für DnD Overlay
  const [txFilter,     setTxFilter]    = useState('offen');  // 'alle'|'offen'|'gematcht'
  const [opFilter,     setOpFilter]    = useState('alle');   // 'alle'|'debitoren'|'kreditoren'
  const [importing,    setImporting]   = useState(false);
  const [autoRunning,  setAutoRunning] = useState(false);
  const [toast,        setToast]       = useState(null);
  // CSV-Import Dialog
  const [csvDialog,    setCsvDialog]   = useState(false);  // Dialog offen?
  const [csvIban,      setCsvIban]     = useState('');     // IBAN für CSV
  // Kontierungsregeln
  const [kontierungsregeln, setKontierungsregeln] = useState([]);
  const [regelDialog,  setRegelDialog] = useState(null);  // { tx } — Neue Regel erstellen
  const [regelNeu,     setRegelNeu]    = useState({ stichwort: '', konto_nr: '', mwst_code: '' });
  const [konten,       setKonten]      = useState([]);
  const [zahlstellen,  setZahlstellen] = useState([]);
  const [direktBuch,   setDirektBuch]  = useState(null);  // { tx, regel } — direkt buchen Dialog
  // CAMT-Import Dialog: zeigt Bank+Sammelkonto vor Import
  const [camtDialog,   setCamtDialog]  = useState(null);  // null | { files, parsedGroups: [{kontoIban, txList}] }
  const [camtBankKonto,   setCamtBankKonto]   = useState('');
  const [camtSammelkonto, setCamtSammelkonto] = useState(() =>
    localStorage.getItem(`fibu-sammelkonto-${mandantId}`) ?? ''
  );
  const [camtCreateBuch, setCamtCreateBuch]   = useState(true);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // ── Daten laden ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mandantId) return;
    loadMandant();
    loadTransactions();
    loadOpenItems();
    loadKontierungsregeln();
    loadKonten();
    loadZahlstellen();
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
    // ── Kreditoren OPs — zwei separate Queries (kein Join, 100% zuverlässig) ──
    // Alle Status inkl. 'bezahlt', damit bezahlte Rechnungen abgeglichen werden können.
    const { data: kred, error: kredErr } = await supabase
      .from('fibu_kreditoren_belege')
      .select('id, beleg_nr, belegdatum, faelligkeit, betrag_brutto, betrag_bezahlt, status, lieferant_id')
      .eq('mandant_id', mandantId)
      .in('status', ['offen', 'teilbezahlt', 'bezahlt'])
      .order('faelligkeit', { ascending: true });

    if (kredErr) console.warn('BankAbstimmung: Kreditoren-Query Fehler', kredErr);

    // Lieferanten separat laden (keine FK-Join-Abhängigkeit)
    let liefMap = {};
    const liefIds = [...new Set((kred ?? []).map(b => b.lieferant_id).filter(Boolean))];
    if (liefIds.length > 0) {
      const { data: lief, error: liefErr } = await supabase
        .from('fibu_lieferanten')
        .select('id, name, iban, qr_referenz')
        .in('id', liefIds);
      if (liefErr) console.warn('BankAbstimmung: Lieferanten-Query Fehler', liefErr);
      (lief ?? []).forEach(l => { liefMap[l.id] = l; });
    }

    const kredItems = (kred ?? []).map(b => {
      const lief = liefMap[b.lieferant_id] ?? null;
      const offen = Math.max(0, (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0));
      return {
        id:            b.id,
        typ:           'kreditor',
        beleg_nr:      b.beleg_nr,
        belegdatum:    b.belegdatum,
        faelligkeit:   b.faelligkeit,
        status:        b.status,
        name:          lief?.name ?? '—',
        iban:          lief?.iban ?? null,
        qr_referenz:   lief?.qr_referenz ?? null,
        betrag_brutto: b.betrag_brutto,
        betrag_offen:  offen,
      };
    });

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

    // FiBu Buchungen (Hauptbuchungen — manuell erfasste Buchungen)
    let buchItems = [];
    const { data: belege, error: buchErr } = await supabase
      .from('fibu_buchung_belege')
      .select('id, beleg_nr, buchungsdatum, text, art')
      .eq('mandant_id', mandantId)
      .neq('art', 'saldovortrag')
      .order('buchungsdatum', { ascending: false })
      .limit(300);
    if (!buchErr) {
      buchItems = (belege ?? []).map(b => ({
        id:            b.id,
        typ:           'buchung',
        beleg_nr:      b.beleg_nr,
        belegdatum:    b.buchungsdatum,
        faelligkeit:   null,
        name:          b.text || b.beleg_nr,
        iban:          null,
        qr_referenz:   null,
        betrag_brutto: null,
        betrag_offen:  null,
      }));
    } else {
      console.warn('BankAbstimmung: Buchungen-Query Fehler', buchErr);
    }

    const all = [...debItems, ...kredItems, ...buchItems];
    console.log(`BankAbstimmung loadOpenItems: ${kredItems.length} Kred, ${debItems.length} Deb, ${buchItems.length} Buch, mandantId=${mandantId}`);
    setOpLoadErr(kredErr ? kredErr.message : null);
    setOpenItems(all);
  }

  async function loadKontierungsregeln() {
    const { data } = await supabase
      .from('fibu_kontierungsregeln')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('sortierung');
    setKontierungsregeln(data ?? []);
  }

  async function loadKonten() {
    const { data } = await supabase
      .from('fibu_konten')
      .select('konto_nr, bezeichnung, konto_typ')
      .eq('mandant_id', mandantId)
      .eq('aktiv', true)
      .order('konto_nr');
    setKonten(data ?? []);
  }

  async function loadZahlstellen() {
    const { data } = await supabase
      .from('fibu_zahlstellen')
      .select('id, bezeichnung, iban, konto_nr')
      .eq('mandant_id', mandantId)
      .eq('aktiv', true);
    setZahlstellen(data ?? []);
  }

  // ── Direkt buchen via Kontierungsregel ────────────────────────────
  async function handleDirektBuchen(tx, regel) {
    // Bankkonto ermitteln: 1. Konto mit Typ "aktiv" und Nr. ~102x, 2. Fallback "1020"
    const bankKonto = (
      konten.find(k => /^102\d$/.test(k.konto_nr))       // 4-stellig exakt: 1020, 1021…
      ?? konten.find(k => k.konto_nr.startsWith('102'))   // startsWith 102
      ?? konten.find(k => k.konto_nr.startsWith('10'))    // breiter: alle 10xx
    )?.konto_nr ?? '1020';

    const isEingang = tx.richtung === 'eingang';
    const buchText  = [tx.gegenpartei_name, tx.verwendungszweck].filter(Boolean).join(' · ').slice(0, 200) || `Bankabstimmung ${tx.buchungsdatum}`;
    const zeile = isEingang
      ? { konto_soll: bankKonto,        konto_haben: regel.konto_nr, betrag: tx.betrag, mwst_code: regel.mwst_code || null, text: buchText }
      : { konto_soll: regel.konto_nr,   konto_haben: bankKonto,      betrag: tx.betrag, mwst_code: regel.mwst_code || null, text: buchText };

    try {
      // ① Hauptbuch-Buchung erstellen
      const { error: buchErr } = await supabase.rpc('fibu_manuelle_buchung_erstellen', {
        p_mandant_id: mandantId,
        p_datum:      tx.buchungsdatum,
        p_text:       buchText,
        p_pdf_path:   null,
        p_pdf_name:   null,
        p_art:        'normal',
        p_zeilen:     [zeile],
      });
      if (buchErr) throw new Error(buchErr.message ?? JSON.stringify(buchErr));

      // ② Banktransaktion als gematcht markieren
      const { error: txErr } = await supabase
        .from('fibu_bank_transaktionen')
        .update({ status: 'gematcht', match_methode: 'REGEL', match_confidence: 1 })
        .eq('id', tx.id);
      if (txErr) console.warn('Transaktion-Status-Update Fehler:', txErr);

      showToast(`✓ Buchung ${isEingang ? 'Eingang' : 'Ausgang'} auf ${kontoLabel(regel.konto_nr)} erfasst`, 'success');
      setDirektBuch(null);
      setSelectedTx(null);
      await Promise.all([loadTransactions(), loadOpenItems()]);
    } catch (e) {
      console.error('handleDirektBuchen Fehler:', e);
      showToast('Buchungsfehler: ' + (e.message ?? String(e)), 'error');
    }
  }

  // ── Neue Kontierungsregel speichern ──────────────────────────────
  async function handleSaveRegel() {
    if (!regelNeu.stichwort || !regelNeu.konto_nr) return;
    const { error } = await supabase.from('fibu_kontierungsregeln').insert({
      mandant_id: mandantId,
      stichwort:  regelNeu.stichwort.trim(),
      konto_nr:   regelNeu.konto_nr,
      mwst_code:  regelNeu.mwst_code || null,
      sortierung: kontierungsregeln.length,
    });
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
    showToast(`Regel „${regelNeu.stichwort}" gespeichert`, 'success');
    setRegelDialog(null);
    setRegelNeu({ stichwort: '', konto_nr: '', mwst_code: '' });
    await loadKontierungsregeln();
  }

  // ── camt.053: Dateien lesen → Dialog öffnen ─────────────────────
  async function handleFileImport(e) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = '';

    // Alle CAMTs parsen — Iban aus erstem File für Zahlstellen-Match
    const parsedGroups = [];
    for (const file of files) {
      try {
        const xml = await file.text();
        const { transactions: txList, kontoIban } = parseCamt053(xml);
        parsedGroups.push({ file, txList, kontoIban });
      } catch (err) {
        showToast(`Parse-Fehler ${file.name}: ${err.message}`, 'error');
      }
    }
    if (!parsedGroups.length) return;

    // Bank-Konto aus Zahlstellen-Match vorbelegen
    const firstIban = parsedGroups[0].kontoIban;
    const zs = zahlstellen.find(z =>
      z.iban && z.iban.replace(/\s/g, '').toUpperCase() === (firstIban ?? '').replace(/\s/g, '').toUpperCase()
    );
    const autoBank = zs?.konto_nr
      ?? konten.find(k => /^102/.test(k.konto_nr))?.konto_nr
      ?? '';
    setCamtBankKonto(autoBank);

    // Sammelkonto aus localStorage (mandant-spezifisch)
    const savedSk = localStorage.getItem(`fibu-sammelkonto-${mandantId}`) ?? '';
    setCamtSammelkonto(savedSk);
    setCamtDialog({ parsedGroups });
  }

  // ── camt.053: Bestätigen & Importieren (nach Dialog) ─────────────
  async function handleCamtConfirm() {
    if (!camtDialog) return;
    setImporting(true);
    setCamtDialog(null);

    // Sammelkonto-Präferenz speichern
    if (camtSammelkonto) localStorage.setItem(`fibu-sammelkonto-${mandantId}`, camtSammelkonto);

    let totalImported = 0;
    let totalBuchungen = 0;

    for (const { file, txList: parsed, kontoIban } of camtDialog.parsedGroups) {
      try {
        // Dedup
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

        // Import-Record
        const { data: importRec } = await supabase
          .from('fibu_bank_imports')
          .insert({ mandant_id: mandantId, dateiname: file.name, konto_iban: kontoIban,
            anzahl_transaktionen: newTx.length })
          .select().single();

        // Transaktionen einfügen
        const rows = newTx.map(tx => ({ ...tx, mandant_id: mandantId, import_id: importRec?.id }));
        const { data: inserted, error: insertErr } = await supabase
          .from('fibu_bank_transaktionen').insert(rows).select('id');
        if (insertErr) throw new Error(insertErr.message);
        totalImported += (inserted?.length ?? newTx.length);

        // ── FiBu-Buchungen (Bank + Sammelkonto) ──────────────────
        if (camtCreateBuch && camtBankKonto && camtSammelkonto) {
          const buchPromises = newTx.map(tx => {
            const isEin = tx.richtung === 'eingang';
            const text  = [tx.gegenpartei_name, tx.verwendungszweck].filter(Boolean).join(' · ').slice(0, 200)
                          || `Bankbewegung ${tx.buchungsdatum}`;
            const zeile = isEin
              ? { konto_soll: camtBankKonto, konto_haben: camtSammelkonto, betrag: tx.betrag, mwst_code: null, text }
              : { konto_soll: camtSammelkonto, konto_haben: camtBankKonto, betrag: tx.betrag, mwst_code: null, text };
            return supabase.rpc('fibu_manuelle_buchung_erstellen', {
              p_mandant_id: mandantId,
              p_datum:      tx.buchungsdatum,
              p_text:       text,
              p_pdf_path:   null,
              p_pdf_name:   null,
              p_art:        'normal',
              p_zeilen:     [zeile],
            });
          });
          // In Batches von 10 um DB nicht zu überlasten
          for (let i = 0; i < buchPromises.length; i += 10) {
            const results = await Promise.all(buchPromises.slice(i, i + 10));
            totalBuchungen += results.filter(r => !r.error).length;
          }
        }

      } catch (err) {
        showToast(`Fehler bei ${file.name}: ${err.message}`, 'error');
      }
    }

    await Promise.all([loadTransactions(), loadOpenItems()]);
    const msg = totalBuchungen > 0
      ? `${totalImported} Transaktionen + ${totalBuchungen} FiBu-Buchungen importiert`
      : `${totalImported} neue Transaktionen importiert`;
    if (totalImported > 0) showToast(msg, 'success');
    setImporting(false);
  }

  // ── CSV-Import ───────────────────────────────────────────────────
  async function handleCsvImport(e) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const iban = csvIban.replace(/\s+/g, '').toUpperCase() || null;
    setImporting(true);
    let totalImported = 0;

    for (const file of files) {
      try {
        const text = await file.text();
        const { transactions: parsed, warnings } = parseCsvBank(text);

        if (warnings.length > 0) {
          showToast(`${file.name}: ${warnings[0]}`, 'info');
        }
        if (parsed.length === 0) {
          showToast(`${file.name}: Keine Transaktionen erkannt`, 'error');
          continue;
        }

        // IBAN auf alle Transaktionen setzen
        const withIban = parsed.map(tx => ({ ...tx, konto_iban: iban }));

        // App-seitiges Dedup basierend auf Datum + Betrag + Richtung + Verwendungszweck
        const minDate = withIban.reduce((m, t) => (!m || t.buchungsdatum < m) ? t.buchungsdatum : m, null);
        const { data: existing } = await supabase
          .from('fibu_bank_transaktionen')
          .select('buchungsdatum, betrag, richtung, verwendungszweck')
          .eq('mandant_id', mandantId)
          .gte('buchungsdatum', minDate ?? '2000-01-01');

        const existingKeys = new Set((existing ?? []).map(t =>
          `${t.buchungsdatum}|${t.betrag}|${t.richtung}|${(t.verwendungszweck ?? '').slice(0, 40)}`
        ));

        const newTx = withIban.filter(tx => {
          const key = `${tx.buchungsdatum}|${tx.betrag}|${tx.richtung}|${(tx.verwendungszweck ?? '').slice(0, 40)}`;
          return !existingKeys.has(key);
        });

        if (newTx.length === 0) {
          showToast(`${file.name}: Alle ${parsed.length} Transaktionen bereits vorhanden`, 'info');
          continue;
        }

        // Import-Record anlegen
        const { data: importRec } = await supabase
          .from('fibu_bank_imports')
          .insert({ mandant_id: mandantId, dateiname: file.name, konto_iban: iban,
            anzahl_transaktionen: newTx.length })
          .select().single();

        // Neue Transaktionen einfügen
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
    if (totalImported > 0) showToast(`${totalImported} neue Transaktionen aus CSV importiert`, 'success');
    setImporting(false);
    setCsvDialog(false);
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
        } else if (m.op.typ === 'buchung') {
          // FiBu-Buchung abgleichen
          await supabase.from('fibu_bank_transaktionen').update({
            status: 'gematcht', matched_beleg_id: m.opId, matched_typ: 'buchung',
            match_confidence: m.score ?? 1, match_methode: m.method ?? 'MANUAL',
          }).eq('id', txId);
        } else {
          // Debitoren-Buchung
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
    if (opFilter === 'buchungen')  return op.typ === 'buchung';
    return true;
  });

  // Kontierungsregeln die zur ausgewählten Transaktion passen
  const selectedTxData = selectedTx ? transactions.find(t => t.id === selectedTx) : null;
  const matchingRegeln = selectedTxData
    ? kontierungsregeln.filter(r => {
        const haystack = [selectedTxData.verwendungszweck, selectedTxData.gegenpartei_name]
          .filter(Boolean).join(' ').toLowerCase();
        return r.stichwort && haystack.includes(r.stichwort.toLowerCase());
      })
    : [];
  const kontoLabel = (nr) => { const k = konten.find(x => x.konto_nr === nr); return k ? `${nr} ${k.bezeichnung}` : nr; };

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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
        background: C.bg, fontFamily: "'Inter', system-ui, sans-serif", color: C.text, overflow: 'hidden' }}>

        {/* ── Header ────────────────────────────────────────────── */}
        <header style={{ background: C.header, color: '#fff', padding: '0 20px',
          height: 56, display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
          boxShadow: '0 2px 8px #0004' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#ffffff20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>🏦</div>
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
          <input ref={csvFileRef} type="file" accept=".csv,.txt" multiple style={{ display: 'none' }}
            onChange={handleCsvImport} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #ffffff40',
              background: importing ? '#ffffff20' : '#ffffff25', color: '#fff',
              cursor: importing ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600 }}>
            {importing ? '⏳ Importiere…' : '📂 CAMT importieren'}
          </button>
          <button onClick={() => setCsvDialog(true)} disabled={importing}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #ffffff40',
              background: '#ffffff25', color: '#fff',
              cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            📊 CSV importieren
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

          <button
            onClick={() => { if (window.opener) window.close(); else navigate(-1); }}
            title="Schliessen"
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
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[['alle','Alle'], ['kreditoren','Kreditoren'], ['debitoren','Debitoren'], ['buchungen','Buchungen']].map(([val, lbl]) => (
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

            {/* Kontierungsregeln-Vorschläge (wenn Transaktion ausgewählt) */}
            {selectedTxData && (
              <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}`,
                background: '#f0f9ff', padding: '8px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  ⚡ Kontierungsregeln
                </div>
                {matchingRegeln.length > 0 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {matchingRegeln.map(r => (
                      <button key={r.id}
                        onClick={() => setDirektBuch({ tx: selectedTxData, regel: r })}
                        style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 8,
                          border: '1px solid #bae6fd', background: '#e0f2fe', color: '#0c4a6e',
                          cursor: 'pointer', fontWeight: 500,
                          display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span>📐</span>
                        <strong>{r.stichwort}</strong>
                        <span style={{ opacity: 0.7 }}>→ {kontoLabel(r.konto_nr)}</span>
                        {r.mwst_code && <span style={{ background: '#dbeafe', padding: '1px 5px', borderRadius: 4, fontSize: 10 }}>{r.mwst_code}</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: '#0369a1', opacity: 0.7 }}>Keine passende Regel — </span>
                    <button
                      onClick={() => {
                        const txt = selectedTxData.verwendungszweck ?? selectedTxData.gegenpartei_name ?? '';
                        setRegelNeu({ stichwort: txt.slice(0, 40), konto_nr: '', mwst_code: '' });
                        setRegelDialog({ tx: selectedTxData });
                      }}
                      style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 8,
                        border: '1px solid #bae6fd', background: '#fff', color: '#0369a1',
                        cursor: 'pointer', fontWeight: 600 }}>
                      + Neue Regel erstellen
                    </button>
                  </div>
                )}
                {matchingRegeln.length > 0 && (
                  <button
                    onClick={() => {
                      const txt = selectedTxData.verwendungszweck ?? selectedTxData.gegenpartei_name ?? '';
                      setRegelNeu({ stichwort: txt.slice(0, 40), konto_nr: '', mwst_code: '' });
                      setRegelDialog({ tx: selectedTxData });
                    }}
                    style={{ fontSize: 10.5, color: '#0369a1', background: 'none', border: 'none',
                      cursor: 'pointer', marginTop: 4, padding: 0, textDecoration: 'underline' }}>
                    + Neue Regel erstellen
                  </button>
                )}
              </div>
            )}

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

              {opLoadErr && (
                <div style={{ gridColumn: '1/-1', margin: '12px 4px', padding: '10px 14px',
                  background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
                  ⚠ Kreditoren-Ladefehler: {opLoadErr}
                </div>
              )}
              {visibleOp.length === 0 && !opLoadErr && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', color: C.muted,
                  padding: '40px 20px', fontSize: 13 }}>
                  {openItems.length === 0
                    ? <>Keine offenen Posten in Kreditoren/Debitoren vorhanden.<br/>
                        <span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                          Rechnungen unter Kreditoren erfassen, damit sie hier erscheinen.
                        </span>
                      </>
                    : 'Keine Posten in diesem Filter.'
                  }
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

        {/* ── Direkt-Buchen Dialog (via Kontierungsregel) ──────── */}
        {direktBuch && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) setDirektBuch(null); }}>
            <div style={{ background: '#fff', borderRadius: 14, width: 460, boxShadow: '0 20px 60px #0004', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', background: C.header, color: '#fff', fontWeight: 700, fontSize: 14 }}>
                ⚡ Direkt buchen — Kontierungsregel
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: '#f0f9ff', borderRadius: 8, padding: '10px 14px', fontSize: 12.5 }}>
                  <div style={{ fontWeight: 600, color: '#0c4a6e', marginBottom: 4 }}>Banktransaktion</div>
                  <div>{fmtDate(direktBuch.tx.buchungsdatum)} · CHF {fmt(direktBuch.tx.betrag)} · {direktBuch.tx.richtung === 'eingang' ? '↑ Eingang' : '↓ Ausgang'}</div>
                  <div style={{ color: '#6b7a6b', marginTop: 2 }}>{direktBuch.tx.verwendungszweck || direktBuch.tx.gegenpartei_name || '—'}</div>
                </div>
                <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px', fontSize: 12.5 }}>
                  <div style={{ fontWeight: 600, color: '#166534', marginBottom: 4 }}>Kontierungsregel</div>
                  <div>Stichwort: <strong>{direktBuch.regel.stichwort}</strong></div>
                  <div>Konto: <strong>{kontoLabel(direktBuch.regel.konto_nr)}</strong></div>
                  {direktBuch.regel.mwst_code && <div>MWST: <strong>{direktBuch.regel.mwst_code}</strong></div>}
                </div>
                <div style={{ fontSize: 11.5, color: '#6b7a6b', background: '#f7f7f7', borderRadius: 7, padding: '8px 12px' }}>
                  Buchung: {direktBuch.tx.richtung === 'eingang'
                    ? <>Soll <strong>{konten.find(k => /^102/.test(k.konto_nr))?.konto_nr ?? '1020'}</strong> / Haben <strong>{kontoLabel(direktBuch.regel.konto_nr)}</strong></>
                    : <>Soll <strong>{kontoLabel(direktBuch.regel.konto_nr)}</strong> / Haben <strong>{konten.find(k => /^102/.test(k.konto_nr))?.konto_nr ?? '1020'}</strong></>
                  } · CHF {fmt(direktBuch.tx.betrag)}
                </div>
              </div>
              <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setDirektBuch(null)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer', fontSize: 12.5 }}>Abbrechen</button>
                <button onClick={() => handleDirektBuchen(direktBuch.tx, direktBuch.regel)}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: C.green, color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
                  ✓ Buchen & abschliessen
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CAMT-Import Dialog ───────────────────────────────── */}
        {camtDialog && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) setCamtDialog(null); }}>
            <div style={{ background: '#fff', borderRadius: 14, width: 480, boxShadow: '0 20px 60px #0004', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', background: C.header, color: '#fff', fontWeight: 700, fontSize: 14 }}>
                📂 CAMT-Import — Kontierung
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Dateien-Übersicht */}
                <div style={{ background: '#f4f8ff', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                  {camtDialog.parsedGroups.map(g => (
                    <div key={g.file.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>📄 {g.file.name}</span>
                      <span style={{ color: C.muted }}>{g.txList.length} Transaktionen · IBAN: {g.kontoIban?.slice(-8)}</span>
                    </div>
                  ))}
                </div>

                {/* Bank-Konto */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#3d6641', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Bank-Konto (Haben/Soll)
                  </label>
                  <select value={camtBankKonto} onChange={e => setCamtBankKonto(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #d4dcd4', fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value="">— Konto wählen —</option>
                    {konten.filter(k => ['aktiv','passiv'].includes(k.konto_typ)).map(k => (
                      <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Bankkonto aus den Zahlstellen — z.B. 1020 Postbank</div>
                </div>

                {/* Sammelkonto */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Sammelkonto (Gegenkonto)
                  </label>
                  <select value={camtSammelkonto} onChange={e => setCamtSammelkonto(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #bae6fd', fontSize: 13, outline: 'none', background: '#f0f9ff' }}>
                    <option value="">— Konto wählen —</option>
                    {konten.map(k => (
                      <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Transitorisches Konto, z.B. 1090 oder 1099 Durchlaufkonto</div>
                </div>

                {/* FiBu-Buchungen Toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  padding: '10px 12px', borderRadius: 8,
                  background: camtCreateBuch ? '#f0fdf4' : '#f7f7f7',
                  border: `1px solid ${camtCreateBuch ? '#bbf7d0' : '#e4e9e4'}` }}>
                  <input type="checkbox" checked={camtCreateBuch} onChange={e => setCamtCreateBuch(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#16a34a', cursor: 'pointer' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: camtCreateBuch ? '#166534' : '#4a5a4a' }}>
                      FiBu-Buchungen automatisch erstellen
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      Eingang: Soll {camtBankKonto||'Bank'} / Haben {camtSammelkonto||'Sammelkonto'} · Ausgang: umgekehrt
                    </div>
                  </div>
                </label>

                {camtCreateBuch && (!camtBankKonto || !camtSammelkonto) && (
                  <div style={{ fontSize: 11.5, color: '#92400e', background: '#fef9c3', padding: '7px 12px', borderRadius: 7, border: '1px solid #fde68a' }}>
                    ⚠ Bitte Bank-Konto und Sammelkonto auswählen um Buchungen zu erstellen.
                  </div>
                )}
              </div>
              <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setCamtDialog(null)}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer', fontSize: 12.5 }}>
                  Abbrechen
                </button>
                <button
                  onClick={handleCamtConfirm}
                  disabled={camtCreateBuch && (!camtBankKonto || !camtSammelkonto)}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none',
                    background: (camtCreateBuch && (!camtBankKonto || !camtSammelkonto)) ? '#c5cdc5' : C.green,
                    color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
                  {camtCreateBuch ? '✓ Importieren & Buchen' : '📥 Nur importieren'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Neue Regel erstellen Dialog ───────────────────────── */}
        {regelDialog && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) setRegelDialog(null); }}>
            <div style={{ background: '#fff', borderRadius: 14, width: 440, boxShadow: '0 20px 60px #0004', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', background: '#0369a1', color: '#fff', fontWeight: 700, fontSize: 14 }}>
                📐 Neue Kontierungsregel erstellen
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 11.5, color: '#6b7a6b' }}>
                  Wenn ein Buchungstext dieses Stichwort enthält, wird das Konto automatisch vorgeschlagen.
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4a5a4a', display: 'block', marginBottom: 4 }}>Stichwort *</label>
                  <input value={regelNeu.stichwort} onChange={e => setRegelNeu(r => ({ ...r, stichwort: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, border: '1px solid #d4dcd4', fontSize: 13, outline: 'none' }}
                    placeholder="z.B. Swisscom, Miete, Versicherung…" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4a5a4a', display: 'block', marginBottom: 4 }}>Konto *</label>
                  <select value={regelNeu.konto_nr} onChange={e => setRegelNeu(r => ({ ...r, konto_nr: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #d4dcd4', fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value="">— Konto wählen —</option>
                    {konten.filter(k => ['aufwand','ertrag'].includes(k.konto_typ)).map(k => (
                      <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setRegelDialog(null)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer', fontSize: 12.5 }}>Abbrechen</button>
                <button onClick={handleSaveRegel} disabled={!regelNeu.stichwort || !regelNeu.konto_nr}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none',
                    background: regelNeu.stichwort && regelNeu.konto_nr ? '#0369a1' : '#c5cdc5',
                    color: '#fff', cursor: regelNeu.stichwort && regelNeu.konto_nr ? 'pointer' : 'not-allowed', fontSize: 12.5, fontWeight: 700 }}>
                  Regel speichern
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CSV-Import Dialog ─────────────────────────────────── */}
        {csvDialog && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
            onClick={e => { if (e.target === e.currentTarget) setCsvDialog(false); }}
          >
            <div style={{
              background: '#fff', borderRadius: 14, width: 440,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden',
            }}>
              {/* Dialog-Header */}
              <div style={{ padding: '16px 20px', background: C.header, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>📊</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>CSV-Kontoauszug importieren</div>
                  <div style={{ fontSize: 11.5, opacity: 0.8, marginTop: 1 }}>PostFinance, UBS, Raiffeisen, ZKB und weitere</div>
                </div>
                <button onClick={() => setCsvDialog(false)} style={{ border: 'none', background: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', opacity: 0.8 }}>✕</button>
              </div>

              {/* Dialog-Body */}
              <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: '#4a5a4a', display: 'block', marginBottom: 5 }}>
                    Bank-IBAN (Kontonummer)
                    <span style={{ fontWeight: 400, color: '#9aa0a0', marginLeft: 4 }}>— optional, für Zuordnung</span>
                  </label>
                  <input
                    value={csvIban}
                    onChange={e => setCsvIban(e.target.value)}
                    placeholder="CH56 0483 5012 3456 7800 9"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 8, border: '1px solid #d4dcd4', fontSize: 13, fontFamily: 'monospace', outline: 'none', background: '#f7faf7' }}
                  />
                </div>

                <div style={{ padding: '12px 14px', background: '#f7faf7', borderRadius: 8, border: '1px solid #e4e9e4', fontSize: 12, color: '#6b7a6b', lineHeight: 1.7 }}>
                  <strong style={{ color: '#2d4a30' }}>Unterstützte Formate:</strong><br />
                  • <strong>PostFinance / ZKB / Raiffeisen:</strong> Buchungsdatum; Buchungstext; Betrag<br />
                  • <strong>UBS / Credit Suisse:</strong> Valutadatum; Buchungsdatum; Text; Belastung; Gutschrift<br />
                  • <strong>Generisch:</strong> Spalte 0=Datum, 1=Text, 2=Betrag (pos/neg)<br />
                  <span style={{ color: '#9aa0a0', fontSize: 11 }}>Separator: Semikolon oder Komma — wird automatisch erkannt</span>
                </div>

                <button
                  onClick={() => csvFileRef.current?.click()}
                  disabled={importing}
                  style={{
                    padding: '11px 18px', borderRadius: 9, border: 'none',
                    background: C.header, color: '#fff', fontSize: 13, fontWeight: 700,
                    cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.7 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <span style={{ fontSize: 16 }}>📂</span>
                  {importing ? 'Importiere…' : 'CSV-Datei wählen & importieren'}
                </button>
                <div style={{ fontSize: 11, color: '#9aa0a0', textAlign: 'center' }}>
                  Mehrere Dateien gleichzeitig auswählbar. Duplikate werden automatisch erkannt.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
}
