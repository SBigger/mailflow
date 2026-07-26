import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { lieferantenApi, kontenApi, kreditorenApi, mwstCodesApi, kiVorschlagApi, kontierungsregelnApi } from '../api';
import NeuerLieferantModal from '../components/NeuerLieferantModal';
import { findKontoVorschlag, istEigeneFirma } from '../utils/kontierung';
import { supabase } from '@/api/supabaseClient';
import * as pdfjsLib from 'pdfjs-dist';
// Worker aus public/ – funktioniert in Vite ohne ?url-Trick
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

const CHF = (n) => n == null ? '' : Number(n).toFixed(2);
const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%' };
const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };

function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(dateStr); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Swiss SPC QR-Rechnung Parser ─────────────────────────────────
// Format: https://www.paymentstandards.ch/dam/downloads/ig-qr-bill-de.pdf
// 30 Zeilen, Zeile 0 = "SPC", Zeile 1 = "0200", Zeile 2 = "1"
function parseSpc(text) {
  if (!text || !text.startsWith('SPC')) return null;
  const lines = text.split(/\r?\n/).map(l => l.trim());
  if (lines[0] !== 'SPC') return null;

  const addrType = lines[4] ?? 'S'; // S = Strukturiert, K = Kombiniert
  let plz = '', ort = '';
  if (addrType === 'S') {
    plz = lines[8] ?? '';
    ort = lines[9] ?? '';
  } else {
    // Kombiniert: Zeile 7 = "PLZ Ort"
    const combined = lines[7] ?? '';
    const m = combined.match(/^(\d{4,5})\s+(.+)/);
    if (m) { plz = m[1]; ort = m[2]; }
  }

  return {
    iban:        (lines[3] ?? '').replace(/\s+/g, ''),
    name:        lines[5] ?? '',
    strasse:     addrType === 'S'
                   ? [lines[6], lines[7]].filter(Boolean).join(' ').trim()
                   : (lines[6] ?? '').trim(),
    plz,
    ort,
    land:        (lines[10] ?? '').trim() || 'CH',
    betrag:      lines[18] ? parseFloat(lines[18]) || null : null,
    waehrung:    lines[19] ?? 'CHF',
    referenzTyp: lines[27] ?? '',
    referenz:    (lines[28] ?? '').replace(/\s+/g, ''),
    mitteilung:  lines[29] ?? '',
  };
}

// ── QR-Code aus PDF oder Bild lesen ──────────────────────────────
// pdfjsLib ist statisch oben importiert, GlobalWorkerOptions.workerSrc gesetzt.
async function scanQrInFile(file) {
  const jsQR = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (file.type === 'application/pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    // Von letzter Seite: Zahlschein ist immer am Ende
    for (let pageNum = pdf.numPages; pageNum >= 1; pageNum--) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 3.0 }); // 3x für QR-Auflösung
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, canvas.width, canvas.height);
      if (result?.data) return result.data;
    }
    return null;
  } else {
    // Bild (JPG/PNG/WEBP)
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        res();
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, canvas.width, canvas.height);
    return result?.data ?? null;
  }
}

/**
 * Brutto-Methode (Abacus-kompatibel): Eingabe = zu zahlender Betrag (inkl. MWST).
 * Netto und Vorsteuer werden rückgerechnet.
 */
function calcPosition(pos, mwstMap) {
  const satz   = mwstMap[pos.mwst_code] ?? 0;
  const brutto = parseFloat(pos.betrag_brutto) || 0;
  let netto, mwst;
  if (satz > 0) {
    // MWST aus Brutto herausrechnen (÷ 1.0X)
    netto = Math.round(brutto / (1 + satz / 100) * 100) / 100;
    mwst  = Math.round((brutto - netto) * 100) / 100;
  } else {
    netto = brutto;
    mwst  = 0;
  }
  return { ...pos, mwst_satz: satz, betrag_netto: netto, betrag_mwst: mwst };
}

const emptyPos = (defaultCode = 'M81') => ({
  _key: Math.random(), konto_nr: '', bezeichnung: '',
  mwst_code: defaultCode, betrag_brutto: '', betrag_netto: 0, betrag_mwst: 0, mwst_satz: 0,
});

export default function RechnungErfassen() {
  const { mandant, canWrite } = useMandant();
  const { belegId } = useParams();
  const [searchParams] = useSearchParams();
  const inboxId = searchParams.get('inboxId'); // aus Inbox-Navigation
  const navigate = useNavigate();

  const [lieferanten, setLieferanten] = useState([]);
  const [konten, setKonten]           = useState([]);
  const [mwstCodes, setMwstCodes]     = useState([]);
  const [regeln, setRegeln]           = useState([]);   // Kontierungsregeln
  const [saving, setSaving]           = useState(false);
  const [showExtra, setShowExtra]     = useState(false); // "Weitere Felder" einklappbar
  const [loadingBeleg, setLoadingBeleg] = useState(false); // bestehenden Beleg laden (Edit)
  const [editLocked, setEditLocked]   = useState(false);   // verbuchter Beleg nicht editierbar
  const [editLockReason, setEditLockReason] = useState(''); // Grund für die Sperre

  // QR-Scanner State
  const [scanFile, setScanFile]     = useState(null);          // hochgeladene Datei
  const [scanStatus, setScanStatus] = useState('idle');        // idle | scanning | found | notfound | error
  const [scanData, setScanData]     = useState(null);          // parsiertes SPC-Objekt
  const [scanMatch, setScanMatch]   = useState(null);          // gefundener Lieferant aus DB
  const [inboxItem, setInboxItem]   = useState(null);          // Inbox-Eintrag (wenn aus Inbox geöffnet)
  const [kiLoading, setKiLoading]   = useState(false);         // KI-Vorschlag lädt
  const [kiVorschlag, setKiVorschlag] = useState(null);        // {vorschlaege, lieferant_kategorie, quelle}
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);          // stabile Blob-URL für Vorschau
  const [quickLief, setQuickLief]   = useState(null);          // {name, iban} für Schnell-Anlage
  const [quickLiefSaving, setQuickLiefSaving] = useState(false);
  const [liefModal, setLiefModal]   = useState(null);          // { init } – Lieferant-Erfassungs-Dialog
  const fileRef = useRef();

  // Blob-URL erzeugen/freigeben wenn Datei wechselt
  useEffect(() => {
    if (!scanFile) { setPdfBlobUrl(null); return; }
    const url = URL.createObjectURL(scanFile);
    setPdfBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [scanFile]);

  const today = new Date().toISOString().slice(0, 10);
  const [head, setHead] = useState({
    lieferant_id: '', lieferant_beleg_nr: '',
    belegdatum: today, buchungsdatum: today, faelligkeit: '',
    zahlungsbedingung_tage: 30, waehrung: 'CHF',
    zahlungsreferenz: '', notiz: '',
    belegtyp: 'rechnung',
    belegreferenz: '', gruppe: '', belegtext: '',
  });
  const istGutschrift = head.belegtyp === 'gutschrift';
  const [positionen, setPositionen] = useState([emptyPos()]);

  // MWST-Code → Satz Map für Berechnungen
  const mwstMap = Object.fromEntries(mwstCodes.map(c => [c.code, c.satz ?? 0]));

  useEffect(() => {
    if (!mandant) return;
    kontierungsregelnApi.list(mandant.id).then(setRegeln).catch(() => {});
  }, [mandant?.id]);

  useEffect(() => {
    if (!mandant) return;
    Promise.all([
      lieferantenApi.list(mandant.id),
      kontenApi.list(mandant.id),
      mwstCodesApi.listAktiv(mandant.id),
    ]).then(([l, k, mc]) => {
      setLieferanten(l);
      setKonten(k.filter(k => k.konto_typ === 'aufwand'));
      setMwstCodes(mc);
    });
  }, [mandant?.id]);

  // Inbox-PDF laden wenn via ?inboxId geöffnet
  useEffect(() => {
    if (!inboxId || !mandant) return;
    (async () => {
      const { data: item } = await supabase
        .from('fibu_rechnung_inbox')
        .select('*')
        .eq('id', inboxId)
        .single();
      if (!item?.pdf_path) return;
      setInboxItem(item);

      // Signierte URL → Blob → File → Auto-Scan
      const { data: signedData } = await supabase.storage
        .from('fibu-inbox')
        .createSignedUrl(item.pdf_path, 300);
      if (!signedData?.signedUrl) return;

      const resp = await fetch(signedData.signedUrl);
      const blob = await resp.blob();
      const file = new File([blob], item.pdf_name || 'rechnung.pdf', { type: blob.type });
      setScanFile(file);
      setScanStatus('idle');
    })();
  }, [inboxId, mandant?.id]);

  // ── Bestehenden Beleg laden (Bearbeiten-Modus via :belegId) ──────
  // Vorher lud das Formular im Edit-Modus NICHTS und "Speichern" legte
  // einen DUPLIKAT-Beleg an + verbuchte erneut. Jetzt: Daten laden, und
  // gespeichert wird über fibu_kreditoren_bearbeiten (Update + sauberes
  // Neu-Verbuchen, kein zweiter Beleg).
  useEffect(() => {
    if (!belegId || !mandant) return;
    setLoadingBeleg(true);
    kreditorenApi.get(belegId).then(b => {
      if (!b) return;
      setHead(prev => ({
        ...prev,
        lieferant_id:           b.lieferant_id ?? '',
        lieferant_beleg_nr:     b.lieferant_beleg_nr ?? '',
        belegdatum:             b.belegdatum ?? prev.belegdatum,
        buchungsdatum:          b.buchungsdatum ?? b.belegdatum ?? prev.buchungsdatum,
        faelligkeit:            b.faelligkeit ?? '',
        zahlungsbedingung_tage: b.zahlungsbedingung_tage ?? 30,
        waehrung:               b.waehrung ?? 'CHF',
        zahlungsreferenz:       b.zahlungsreferenz ?? '',
        notiz:                  b.notiz ?? '',
        belegtyp:               b.belegtyp ?? 'rechnung',
        belegreferenz:          b.belegreferenz ?? '',
        gruppe:                 b.gruppe ?? '',
        belegtext:              b.belegtext ?? '',
      }));
      const pos = [...(b.positionen ?? [])].sort((a, c) => (a.position ?? 0) - (c.position ?? 0));
      if (pos.length) {
        setPositionen(pos.map(p => ({
          _key:          Math.random(),
          konto_nr:      p.konto_nr ?? '',
          bezeichnung:   p.bezeichnung ?? '',
          mwst_code:     p.mwst_code ?? 'M81',
          mwst_satz:     p.mwst_satz ?? 0,
          betrag_netto:  p.betrag_netto ?? 0,
          betrag_mwst:   p.betrag_mwst ?? 0,
          betrag_brutto: p.betrag_brutto != null ? String(p.betrag_brutto) : '',
        })));
      }
      // Editierbar nur solange offen, unbezahlt und MWST nicht abgerechnet
      let reason = '';
      if (b.status === 'storniert')             reason = 'Dieser Beleg ist storniert und kann nicht bearbeitet werden.';
      else if (b.status === 'ebanking')         reason = 'Beleg ist in einem aktiven Zahlungslauf (Zahlung läuft) – Bearbeiten nicht möglich.';
      else if ((b.betrag_bezahlt || 0) !== 0)   reason = 'Beleg ist bereits (teil)bezahlt oder verrechnet – bitte zuerst die Zahlung zurücknehmen.';
      else if (b.mwst_abgerechnet)              reason = 'Die MWST dieses Belegs ist bereits abgerechnet – keine Änderung möglich.';
      setEditLocked(!!reason);
      setEditLockReason(reason);
    }).finally(() => setLoadingBeleg(false));
  }, [belegId, mandant?.id]);

  const handleLieferantChange = (id) => {
    const l = lieferanten.find(x => x.id === id);
    setHead(prev => ({
      ...prev,
      lieferant_id: id,
      waehrung: l?.waehrung ?? prev.waehrung,
      zahlungsbedingung_tage: l?.zahlungsbedingung_tage ?? 30,
      faelligkeit: addDays(prev.belegdatum, l?.zahlungsbedingung_tage ?? 30),
    }));
    if (l?.standard_konto_nr && positionen.length === 1 && !positionen[0].konto_nr) {
      setPositionen([calcPosition(
        { ...positionen[0], konto_nr: l.standard_konto_nr, mwst_code: l.mwst_code ?? 'M81' },
        mwstMap
      )]);
    }
  };

  const handleBelegdatumChange = (val) => {
    setHead(prev => ({
      ...prev,
      belegdatum: val,
      // Buchungsdatum mitziehen wenn es noch dem Belegdatum entsprach
      buchungsdatum: prev.buchungsdatum === prev.belegdatum ? val : prev.buchungsdatum,
      faelligkeit: addDays(val, prev.zahlungsbedingung_tage),
    }));
  };

  // ── KI-Vorschlag abrufen ────────────────────────────────────────
  const handleKiVorschlag = useCallback(async () => {
    if (!mandant) return;
    setKiLoading(true);
    setKiVorschlag(null);
    try {
      const lieferant = lieferanten.find(l => l.id === head.lieferant_id);
      // Kontext aus QR-Daten + manuellen Feldern
      const kontextParts = [
        scanData?.mitteilung,
        scanData?.name,
        head.notiz,
        head.lieferant_beleg_nr,
      ].filter(Boolean);
      const result = await kiVorschlagApi.suggest({
        mandantId:     mandant.id,
        lieferantId:   head.lieferant_id || null,
        lieferantName: lieferant?.name ?? '',
        kontextText:   kontextParts.join('\n'),
        konten:        konten,
        mwstCodes:     mwstCodes,
        waehrung:      head.waehrung,
        betragBrutto:  scanData?.betrag ?? null,
      });
      setKiVorschlag(result);
    } catch (e) {
      console.error('KI-Vorschlag Fehler:', e);
      setKiVorschlag({ error: e.message });
    } finally {
      setKiLoading(false);
    }
  }, [mandant, head, konten, mwstCodes, scanData, lieferanten]);

  // KI-Vorschlag übernehmen
  const handleKiUebernehmen = (vorschlag) => {
    setPositionen(prev => prev.map((p, i) => i === 0
      ? calcPosition({ ...p, konto_nr: vorschlag.konto_nr, mwst_code: vorschlag.mwst_code, bezeichnung: vorschlag.bezeichnung || p.bezeichnung }, mwstMap)
      : p
    ));
    setKiVorschlag(null);
  };

  const updatePos = (idx, field, value) => {
    setPositionen(prev => {
      const next = [...prev];
      next[idx] = calcPosition({ ...next[idx], [field]: value }, mwstMap);
      return next;
    });
  };

  const totals = positionen.reduce(
    (s, p) => ({
      brutto: s.brutto + (parseFloat(p.betrag_brutto) || 0),  // Eingabefeld
      mwst:   s.mwst   + (p.betrag_mwst  || 0),               // berechnet
      netto:  s.netto  + (p.betrag_netto  || 0),               // berechnet
    }),
    { brutto: 0, mwst: 0, netto: 0 }
  );

  // ── QR-Scan Logik ───────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    if (!scanFile) return;
    setScanStatus('scanning');
    setScanData(null);
    setScanMatch(null);

    try {
      const rawQr = await scanQrInFile(scanFile);
      if (!rawQr) {
        setScanStatus('notfound');
        return;
      }

      const spc = parseSpc(rawQr);
      if (!spc) {
        setScanStatus('notfound');
        return;
      }

      setScanData(spc);
      setScanStatus('found');

      // IBAN gegen Lieferanten matchen
      const normalIban = spc.iban.replace(/\s+/g, '').toUpperCase();
      const matched = lieferanten.find(l => l.iban && l.iban.replace(/\s+/g, '').toUpperCase() === normalIban);
      setScanMatch(matched ?? null);

      // Eigene Firma (Rechnungsempfänger) erkennen → nicht als Lieferant
      const eigen = istEigeneFirma(spc.name, mandant);

      // Wenn kein Match → Schnell-Anlage vorbereiten (alle QR-Felder)
      if (!matched && spc.iban && !eigen) {
        setQuickLief({
          name:    spc.name ?? '',
          iban:    spc.iban,
          strasse: spc.strasse ?? '',
          plz:     spc.plz ?? '',
          ort:     spc.ort ?? '',
          land:    spc.land ?? 'CH',
        });
      }

      // Formular befüllen
      setHead(prev => {
        const l = matched ?? null;
        return {
          ...prev,
          lieferant_id: matched?.id ?? prev.lieferant_id,
          waehrung: spc.waehrung ?? prev.waehrung,
          zahlungsbedingung_tage: l?.zahlungsbedingung_tage ?? prev.zahlungsbedingung_tage,
          faelligkeit: addDays(prev.belegdatum, l?.zahlungsbedingung_tage ?? prev.zahlungsbedingung_tage),
          zahlungsreferenz:   spc.referenz ?? prev.zahlungsreferenz,
          // Mitteilung = Rechnungsreferenz des Lieferanten → Beleg-Nr. Lieferant
          lieferant_beleg_nr: spc.mitteilung ? spc.mitteilung.trim() : prev.lieferant_beleg_nr,
        };
      });

      // Betrag übernehmen wenn vorhanden (QR liefert immer Brutto → direkt setzen)
      if (spc.betrag && spc.betrag > 0) {
        // Konto: gelerntes Standardkonto des Lieferanten, sonst Kontovorschlag
        const vorschlag = matched?.standard_konto_nr
          ? null
          : findKontoVorschlag([scanFile?.name, spc.mitteilung, spc.name], regeln);
        const defaultCode = matched?.mwst_code ?? vorschlag?.mwst_code ?? 'M81';
        setPositionen([calcPosition({
          _key: Math.random(),
          konto_nr: matched?.standard_konto_nr ?? vorschlag?.konto_nr ?? '',
          bezeichnung: spc.mitteilung || '',
          mwst_code: defaultCode,
          betrag_brutto: CHF(spc.betrag),   // QR-Betrag IST der Brutto-Betrag
          betrag_netto: 0, betrag_mwst: 0, mwst_satz: 0,
        }, mwstMap)]);
      }
    } catch (e) {
      console.error('QR-Scan Fehler:', e);
      setScanStatus('error');
    }
  }, [scanFile, lieferanten, mwstMap, regeln, mandant]);

  // Auto-Scan sobald Inbox-PDF geladen ist UND Lieferanten verfügbar sind.
  // MUSS nach handleScan stehen – sonst Temporal-Dead-Zone-ReferenceError
  // beim Aufbau des Dependency-Arrays → Komponente crasht (weisse Seite).
  const autoScannedRef = useRef(false);
  useEffect(() => {
    if (!inboxId || !scanFile || lieferanten.length === 0 || autoScannedRef.current) return;
    if (scanStatus !== 'idle') return;
    autoScannedRef.current = true;
    handleScan();
  }, [inboxId, scanFile, lieferanten.length, scanStatus, handleScan]);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setScanFile(f);
    setScanStatus('idle');
    setScanData(null);
    setScanMatch(null);
    setQuickLief(null);
  };

  // Lieferant über den Erfassungs-Dialog anlegen (mit Adressfeldern)
  const handleSaveLief = async (form) => {
    if (!mandant) return;
    setQuickLiefSaving(true);
    try {
      const nr = await lieferantenApi.nextNr(mandant.id);
      const neu = await lieferantenApi.create(mandant.id, {
        nr,
        name:               form.name.trim(),
        uid:                form.uid.trim() || null,
        adresse:            form.adresse.trim() || null,
        plz:                form.plz.trim() || null,
        ort:                form.ort.trim() || null,
        land:               (form.land || 'CH').trim().toUpperCase() || 'CH',
        iban:               form.iban.replace(/\s+/g, '') || null,
        bank_name:          form.bank_name?.trim() || null,
        standard_konto_nr:  form.standard_konto_nr?.trim() || '6800',
        aktiv:              true,
      });
      setLieferanten(prev => [...prev, neu].sort((a, b) => a.name.localeCompare(b.name)));
      setScanMatch(neu);
      setHead(prev => ({
        ...prev,
        lieferant_id: neu.id,
        faelligkeit:  prev.faelligkeit || addDays(prev.belegdatum, 30),
      }));
      setQuickLief(null);
      setLiefModal(null);
    } catch (e) {
      alert('Fehler beim Anlegen: ' + e.message);
    } finally {
      setQuickLiefSaving(false);
    }
  };

  // ── Speichern ───────────────────────────────────────────────────
  const handleSave = async () => {
    if (!head.lieferant_id || !head.belegdatum || !head.faelligkeit) return;
    if (belegId && editLocked) return;   // verbuchter/bezahlter Beleg: kein Speichern
    setSaving(true);
    try {
      const pos = positionen.filter(p => parseFloat(p.betrag_brutto) > 0).map(p => ({
        konto_nr: p.konto_nr || '6800',
        bezeichnung: p.bezeichnung,
        mwst_code: p.mwst_code,
        mwst_satz: p.mwst_satz,
        betrag_netto: parseFloat(p.betrag_netto) || 0,
        betrag_mwst: p.betrag_mwst,
        betrag_brutto: p.betrag_brutto,
      }));
      // Gutschrift: Beleg-Beträge negativ (Positionen bleiben positiv –
      // die Verbuchungs-RPC dreht die Buchungsrichtung anhand belegtyp)
      const sign = istGutschrift ? -1 : 1;
      const betraege = {
        betrag_netto:  sign * totals.netto,
        betrag_mwst:   sign * totals.mwst,
        betrag_brutto: sign * totals.brutto,
      };

      // ── Bearbeiten: Update + sauberes Neu-Verbuchen (KEIN neuer Beleg) ──
      if (belegId) {
        await kreditorenApi.bearbeiten(belegId, {
          lieferant_beleg_nr:     head.lieferant_beleg_nr,
          belegdatum:             head.belegdatum,
          buchungsdatum:          head.buchungsdatum,
          faelligkeit:            head.faelligkeit,
          zahlungsbedingung_tage: head.zahlungsbedingung_tage,
          waehrung:               head.waehrung,
          zahlungsreferenz:       head.zahlungsreferenz,
          notiz:                  head.notiz,
          belegreferenz:          head.belegreferenz,
          gruppe:                 head.gruppe,
          belegtext:              head.belegtext,
          ...betraege,
        }, pos);
        navigate(`/fibu/${mandant.id}/kreditoren`);
        return;
      }

      // ── Neu erfassen ──
      const beleg = await kreditorenApi.create(mandant.id, {
        ...head,
        ...betraege,
      }, pos);

      // Inbox-Eintrag als verarbeitet markieren
      if (inboxId && beleg?.id) {
        await supabase
          .from('fibu_rechnung_inbox')
          .update({ status: 'verarbeitet', beleg_id: beleg.id })
          .eq('id', inboxId);
      }

      navigate(`/fibu/${mandant.id}/kreditoren`);
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const hdrTd  = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 10px', borderBottom: '1px solid #e4e9e4', textAlign: 'left', background: '#fff', whiteSpace: 'nowrap' };
  const cellTd = { padding: '6px 8px', borderBottom: '1px solid #f0f3f0', verticalAlign: 'middle' };

  // Nur Vorsteuer-Codes in Positionen-Dropdown
  const vorsteuerCodes = mwstCodes.filter(c => c.typ === 'vorsteuer' || c.typ === 'steuerbefreit');

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Formular */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, borderRight: '1px solid #e4e9e4' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>
              {belegId ? 'Beleg bearbeiten' : (istGutschrift ? 'Neue Lieferanten-Gutschrift' : 'Neue Kreditoren-Rechnung')}
            </span>
            {!belegId && (
              <div style={{ display: 'flex', gap: 2, background: '#eef2ee', borderRadius: 8, padding: 2 }}>
                {[['rechnung', 'Rechnung'], ['gutschrift', 'Gutschrift']].map(([v, l]) => (
                  <button key={v}
                    onClick={() => setHead(h => ({ ...h, belegtyp: v }))}
                    style={{
                      padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      fontSize: 11.5, fontWeight: 600,
                      background: head.belegtyp === v ? '#fff' : 'transparent',
                      color: head.belegtyp === v ? (v === 'gutschrift' ? '#9d174d' : '#3d6641') : '#6b826b',
                      boxShadow: head.belegtyp === v ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                    }}>{l}</button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => navigate(`/fibu/${mandant?.id}/kreditoren`)}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}
            >Abbrechen</button>
            <button
              onClick={handleSave}
              disabled={!canWrite || saving || !head.lieferant_id || !head.faelligkeit || (belegId && editLocked)}
              title={belegId && editLocked ? editLockReason : ''}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', opacity: (!canWrite || saving || !head.lieferant_id || !head.faelligkeit || (belegId && editLocked)) ? .5 : 1 }}
            >{saving ? 'Speichert…' : (belegId ? 'Änderungen speichern' : 'Speichern & Buchen')}</button>
          </div>
        </div>

        {/* ── Bearbeiten: Sperr-Hinweis (verbuchter/bezahlter Beleg) ── */}
        {belegId && editLocked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#fdf4f4', border: '1px solid #f0d8d8' }}>
            <span style={{ fontSize: 16 }}>🔒</span>
            <div style={{ fontSize: 12, color: '#8a2d2d' }}>
              <strong>Nur Ansicht:</strong> {editLockReason}
            </div>
          </div>
        )}
        {belegId && !editLocked && !loadingBeleg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#f0f7ff', border: '1px solid #c5d4ea' }}>
            <span style={{ fontSize: 16 }}>✏️</span>
            <div style={{ fontSize: 12, color: '#1e3a6e' }}>
              <strong>Beleg bearbeiten:</strong> Beim Speichern werden die bestehenden Buchungen ersetzt (neu verbucht) – es entsteht kein zweiter Beleg. Lieferant bleibt unverändert.
            </div>
          </div>
        )}

        {/* ── Inbox-Banner ── */}
        {inboxItem && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#f0f7ff', border: '1px solid #c5d4ea' }}>
            <span style={{ fontSize: 16 }}>📬</span>
            <div style={{ fontSize: 12, color: '#1e3a6e' }}>
              <strong>Aus Eingangspostfach:</strong>{' '}
              {inboxItem.sender_name || inboxItem.sender_email}
              {inboxItem.betreff ? ` — ${inboxItem.betreff}` : ''}
            </div>
          </div>
        )}

        {/* ── QR-Zahlschein Scanner ── */}
        <div style={{ background: '#fff', border: '1px solid #c5d4ea', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#e8f0fb', borderBottom: '1px solid #c5d4ea' }}>
            <svg style={{ width: 18, height: 18, flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="#2e4a7d" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/>
              <rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/>
              <rect x="18" y="18" width="3" height="3"/>
            </svg>
            <span style={{ fontWeight: 600, fontSize: 12.5, color: '#1e3a6e' }}>Swiss QR-Rechnung scanner</span>
            <span style={{ fontSize: 11, color: '#4a6a9e' }}>— PDF oder Bild mit QR-Zahlschein hochladen</span>
            <div style={{ flex: 1 }} />
            <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <button
              onClick={() => fileRef.current?.click()}
              style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #8ba8d4', background: '#fff', color: '#2e4a7d', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
            >📄 Datei wählen</button>
            {scanFile && (
              <button
                onClick={handleScan}
                disabled={scanStatus === 'scanning'}
                style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: '#2e4a7d', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: scanStatus === 'scanning' ? .6 : 1 }}
              >{scanStatus === 'scanning' ? '⏳ Scannt…' : '🔍 QR scannen'}</button>
            )}
          </div>

          {/* Status-Anzeige */}
          {scanFile && scanStatus !== 'idle' && (
            <div style={{ padding: '10px 14px' }}>
              {scanStatus === 'scanning' && (
                <div style={{ fontSize: 12, color: '#2e4a7d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Scannt PDF auf QR-Zahlschein…</span>
                </div>
              )}
              {scanStatus === 'notfound' && (
                <div style={{ fontSize: 12, color: '#854d0e', background: '#fef9c3', padding: '8px 12px', borderRadius: 7, border: '1px solid #fde68a' }}>
                  ⚠️ Kein Swiss QR-Zahlschein gefunden. Bitte Felder manuell ausfüllen.
                </div>
              )}
              {scanStatus === 'error' && (
                <div style={{ fontSize: 12, color: '#991b1b', background: '#fee2e2', padding: '8px 12px', borderRadius: 7, border: '1px solid #fca5a5' }}>
                  ❌ Scan-Fehler. Bitte PDF prüfen oder Felder manuell ausfüllen.
                </div>
              )}
              {scanStatus === 'found' && scanData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#166534', background: '#dcfce7', padding: '8px 12px', borderRadius: 7, border: '1px solid #86efac', flexWrap: 'wrap' }}>
                    <span>✅ QR-Zahlschein erkannt</span>
                    {scanMatch
                      ? <span style={{ marginLeft: 4, fontWeight: 600 }}>— Lieferant: <em>{scanMatch.name}</em></span>
                      : <>
                          <span style={{ marginLeft: 4, color: '#92400e' }}>— IBAN nicht in Stammdaten</span>
                          {quickLief && (
                            <div style={{ marginLeft: 'auto' }}>
                              <button
                                onClick={() => setLiefModal({ init: { ...quickLief } })}
                                style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >+ Lieferant anlegen («{quickLief.name || 'neu'}»)</button>
                            </div>
                          )}
                        </>
                    }
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 11.5 }}>
                    {[
                      ['Empfänger', scanData.name],
                      ['IBAN', scanData.iban],
                      ['Betrag', scanData.betrag ? `${scanData.waehrung} ${CHF(scanData.betrag)}` : '(kein Betrag)'],
                      ['Referenz', scanData.referenz || '—'],
                      ['Mitteilung', scanData.mitteilung || '—'],
                      ['Adresse', [scanData.strasse, [scanData.plz, scanData.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'],
                    ].map(([k, v]) => (
                      <div key={k} style={{ background: '#f7faf7', borderRadius: 6, padding: '6px 10px' }}>
                        <div style={{ fontWeight: 600, color: '#6b826b', textTransform: 'uppercase', fontSize: 9.5, letterSpacing: '.06em' }}>{k}</div>
                        <div style={{ color: '#1a1a2e', marginTop: 2, fontFamily: k === 'IBAN' || k === 'Referenz' ? 'monospace' : undefined, wordBreak: 'break-all' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Dateiname */}
          {scanFile && (
            <div style={{ padding: '6px 14px', fontSize: 11, color: '#6b826b', borderTop: '1px solid #e8f0fb', background: '#f4f8ff' }}>
              📎 {scanFile.name} ({(scanFile.size / 1024).toFixed(0)} KB)
            </div>
          )}
        </div>

        {/* ── Belegkopf ── */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: 16, flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#94a394', marginBottom: 12 }}>Belegkopf</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Lieferant *{belegId && <span style={{ fontWeight: 400, color: '#94a394', marginLeft: 4, fontSize: 10.5 }}>beim Bearbeiten nicht änderbar</span>}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...inp, flex: 1, background: belegId ? '#eef1ee' : inp.background, cursor: belegId ? 'not-allowed' : 'pointer' }}
                  value={head.lieferant_id}
                  disabled={!!belegId}
                  onChange={e => handleLieferantChange(e.target.value)}>
                  <option value="">— wählen —</option>
                  {lieferanten.filter(l => l.aktiv || l.id === head.lieferant_id).map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.nr})</option>
                  ))}
                </select>
                {!belegId && (
                  <button
                    type="button"
                    onClick={() => setLiefModal({ init: scanData
                      ? { name: scanData.name, strasse: scanData.strasse, plz: scanData.plz, ort: scanData.ort, land: scanData.land, iban: scanData.iban }
                      : {} })}
                    title="Neuen Lieferant erfassen"
                    style={{ flexShrink: 0, padding: '0 12px', borderRadius: 8, border: '1px solid #b8d4b8', background: '#f0f7f0', color: '#3d6641', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                  >+ Neu</button>
                )}
              </div>
            </div>
            <div>
              <label style={lbl}>Beleg-Nr. Lieferant</label>
              <input style={inp} value={head.lieferant_beleg_nr} onChange={e => setHead(p => ({ ...p, lieferant_beleg_nr: e.target.value }))} placeholder="Rechnungsnummer des Lieferanten" />
            </div>
            <div>
              <label style={lbl}>Belegdatum *</label>
              <input type="date" style={inp} value={head.belegdatum} onChange={e => handleBelegdatumChange(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>
                Buchungsdatum *
                <span style={{ fontWeight: 400, color: '#94a394', marginLeft: 4, fontSize: 10.5 }}>steuert Verbuchungsjahr</span>
              </label>
              <input type="date" style={{ ...inp, borderColor: head.buchungsdatum !== head.belegdatum ? '#7a5aaa' : undefined }}
                value={head.buchungsdatum}
                onChange={e => setHead(p => ({ ...p, buchungsdatum: e.target.value }))} />
              {head.buchungsdatum !== head.belegdatum && (
                <div style={{ fontSize: 10.5, color: '#7a5aaa', marginTop: 3 }}>
                  ※ Buchungsdatum weicht vom Belegdatum ab
                </div>
              )}
            </div>
            <div>
              <label style={lbl}>Fälligkeit *</label>
              <input type="date" style={{ ...inp, borderColor: head.faelligkeit ? '#7a9b7f' : '#e87070' }} value={head.faelligkeit} onChange={e => setHead(p => ({ ...p, faelligkeit: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Zahlungsbedingung (Tage)</label>
              <input type="number" style={inp} value={head.zahlungsbedingung_tage} onChange={e => setHead(p => ({ ...p, zahlungsbedingung_tage: parseInt(e.target.value) || 30 }))} />
            </div>
            <div>
              <label style={lbl}>Währung</label>
              <select style={inp} value={head.waehrung} onChange={e => setHead(p => ({ ...p, waehrung: e.target.value }))}>
                <option>CHF</option><option>EUR</option><option>USD</option><option>GBP</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Zahlungsreferenz / QR-Ref.</label>
              <input style={{ ...inp, fontFamily: 'monospace', fontSize: 11.5 }} value={head.zahlungsreferenz} onChange={e => setHead(p => ({ ...p, zahlungsreferenz: e.target.value }))} placeholder="Optionale Referenznummer" />
            </div>
          </div>

          {/* ── Weitere Felder Toggle ── */}
          <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setShowExtra(s => !s)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11.5, color: '#7a9b7f', fontWeight: 600, padding: '4px 0',
              }}
            >
              <span style={{
                display: 'inline-block', transition: 'transform .2s',
                transform: showExtra ? 'rotate(90deg)' : 'rotate(0deg)',
                fontSize: 10,
              }}>▶</span>
              {showExtra ? 'Weitere Felder ausblenden' : 'Weitere Felder (Notiz, Referenz, Gruppe…)'}
              {/* Dot-Indikator wenn Felder befüllt aber eingeklappt */}
              {!showExtra && (head.notiz || head.belegreferenz || head.gruppe || head.belegtext) && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7a9b7f', display: 'inline-block' }} title="Felder befüllt" />
              )}
            </button>
          </div>

          {showExtra && (
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, paddingTop: 4, borderTop: '1px dashed #e4e9e4', marginTop: 2 }}>
              <div>
                <label style={lbl}>Interne Notiz</label>
                <input style={inp} value={head.notiz} onChange={e => setHead(p => ({ ...p, notiz: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>
                  Belegreferenz
                  <span style={{ fontWeight: 400, color: '#94a394', marginLeft: 4, fontSize: 10.5 }}>Projekt, Vertrag, o.ä.</span>
                </label>
                <input style={inp} value={head.belegreferenz} onChange={e => setHead(p => ({ ...p, belegreferenz: e.target.value }))} placeholder="z.B. PRJ-2026-001" />
              </div>
              <div>
                <label style={lbl}>
                  Gruppe
                  <span style={{ fontWeight: 400, color: '#94a394', marginLeft: 4, fontSize: 10.5 }}>Freies Gruppierungsfeld</span>
                </label>
                <input style={inp} value={head.gruppe} onChange={e => setHead(p => ({ ...p, gruppe: e.target.value }))} placeholder="z.B. IT, Marketing, Infrastruktur" />
              </div>
              <div>
                <label style={lbl}>
                  Belegtext
                  <span style={{ fontWeight: 400, color: '#94a394', marginLeft: 4, fontSize: 10.5 }}>max. 12 Zeichen (Kurztext)</span>
                </label>
                <input style={inp} value={head.belegtext} maxLength={80}
                  onChange={e => setHead(p => ({ ...p, belegtext: e.target.value }))}
                  placeholder="z.B. Jan-Mär 26" />
                {head.belegtext && (
                  <div style={{ fontSize: 10, color: '#94a394', marginTop: 2 }}>
                    Anzeige: «{head.belegtext.slice(0, 12)}{head.belegtext.length > 12 ? '…' : ''}»
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Buchungspositionen ── */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #e4e9e4' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#94a394' }}>Buchungspositionen</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleKiVorschlag}
                disabled={kiLoading || !mandant}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 12px', borderRadius: 7, border: '1px solid #c5d4ea',
                  background: kiLoading ? '#e8f0fb' : '#f0f7ff',
                  color: '#2e4a7d', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  opacity: kiLoading ? .7 : 1,
                }}
              >
                {kiLoading
                  ? <><span style={{ fontSize: 13 }}>⏳</span> KI denkt…</>
                  : <><span style={{ fontSize: 13 }}>🤖</span> KI-Vorschlag</>
                }
              </button>
              <button
                onClick={() => setPositionen(p => [...p, emptyPos(vorsteuerCodes[0]?.code ?? 'M81')])}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: 'none', background: 'transparent', color: '#7a9b7f', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >+ Position hinzufügen</button>
            </div>
          </div>

          {/* ── KI-Vorschlag Panel ── */}
          {kiVorschlag && !kiVorschlag.error && (
            <div style={{ padding: '10px 14px', background: '#f0f7ff', borderBottom: '1px solid #c5d4ea' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13 }}>🤖</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1e3a6e' }}>
                  KI-Buchungsvorschlag
                  {kiVorschlag.quelle === 'historie' && <span style={{ marginLeft: 6, fontSize: 10.5, background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 4 }}>aus Buchungshistorie</span>}
                  {kiVorschlag.quelle === 'ki'       && <span style={{ marginLeft: 6, fontSize: 10.5, background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 4 }}>Claude AI</span>}
                </span>
                {kiVorschlag.lieferant_kategorie && (
                  <span style={{ fontSize: 11, color: '#4a6a9e', marginLeft: 4 }}>— {kiVorschlag.lieferant_kategorie}</span>
                )}
                <button onClick={() => setKiVorschlag(null)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#94a394', fontSize: 16 }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {kiVorschlag.vorschlaege?.map((v, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fff', borderRadius: 8, border: '1px solid #c5d4ea' }}>
                    {/* Confidence-Bar */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, gap: 2 }}>
                      <div style={{ width: 36, height: 6, borderRadius: 3, background: '#e8f0fb', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round(v.confidence * 100)}%`, background: v.confidence > .8 ? '#22c55e' : v.confidence > .6 ? '#f59e0b' : '#94a394', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 9.5, color: '#94a394' }}>{Math.round(v.confidence * 100)}%</span>
                    </div>
                    {/* Vorschlag-Details */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1a1a2e' }}>
                          {v.konto_nr} {v.konto_bezeichnung}
                        </span>
                        <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: '#e3eaf5', color: '#2e4a7d', fontWeight: 500 }}>{v.mwst_code} ({v.mwst_satz}%)</span>
                        {v.bezeichnung && <span style={{ fontSize: 11, color: '#6b826b', fontStyle: 'italic' }}>"{v.bezeichnung}"</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b826b', marginTop: 2 }}>{v.begruendung}</div>
                    </div>
                    {/* Übernehmen */}
                    <button
                      onClick={() => handleKiUebernehmen(v)}
                      style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 7, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                    >Übernehmen</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {kiVorschlag?.error && (
            <div style={{ padding: '8px 14px', background: '#fee2e2', borderBottom: '1px solid #fca5a5', fontSize: 12, color: '#991b1b' }}>
              ❌ KI-Fehler: {kiVorschlag.error} — Bitte Konto manuell wählen.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...hdrTd, width: 28 }}>#</th>
                <th style={{ ...hdrTd, width: 170 }}>Aufwandskonto *</th>
                <th style={hdrTd}>Bezeichnung</th>
                <th style={{ ...hdrTd, width: 120 }}>MWST-Code</th>
                <th style={{ ...hdrTd, width: 120, textAlign: 'right', color: '#1a1a2e' }}>
                  Brutto CHF *
                  <span style={{ fontWeight: 400, fontSize: 9.5, marginLeft: 4, color: '#94a394' }}>inkl. MWST</span>
                </th>
                <th style={{ ...hdrTd, width: 90, textAlign: 'right', color: '#2e4a7d' }}>MWST</th>
                <th style={{ ...hdrTd, width: 100, textAlign: 'right' }}>Netto</th>
                <th style={{ ...hdrTd, width: 28 }}></th>
              </tr></thead>
              <tbody>
                {positionen.map((p, i) => (
                  <tr key={p._key} style={{ background: i % 2 === 0 ? '#fff' : '#fafcfa' }}>
                    <td style={{ ...cellTd, color: '#94a394', fontSize: 11, textAlign: 'center' }}>{i + 1}</td>
                    <td style={cellTd}>
                      <select style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={p.konto_nr} onChange={e => updatePos(i, 'konto_nr', e.target.value)}>
                        <option value="">— Konto —</option>
                        {konten.map(k => <option key={k.id} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                      </select>
                    </td>
                    <td style={cellTd}>
                      <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={p.bezeichnung} onChange={e => updatePos(i, 'bezeichnung', e.target.value)} placeholder="Bezeichnung" />
                    </td>
                    <td style={cellTd}>
                      <select style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={p.mwst_code} onChange={e => updatePos(i, 'mwst_code', e.target.value)}>
                        {vorsteuerCodes.length > 0
                          ? vorsteuerCodes.map(c => (
                              <option key={c.code} value={c.code}>
                                {c.code} {c.satz > 0 ? `(${c.satz}%)` : '(befreit)'}
                              </option>
                            ))
                          : <>
                              <option value="M81">M81 (8.1%)</option>
                              <option value="M26">M26 (2.6%)</option>
                              <option value="M38">M38 (3.8%)</option>
                              <option value="I81">I81 (8.1% Inv.)</option>
                              <option value="M0">M0 (befreit)</option>
                            </>
                        }
                      </select>
                    </td>
                    {/* ← Eingabefeld: zu zahlender Betrag (Brutto) */}
                    <td style={cellTd}>
                      <input
                        type="number" step="0.05" min="0"
                        style={{ ...inp, padding: '4px 8px', fontSize: 13, textAlign: 'right', fontWeight: 600,
                          background: '#f0f7f0', borderColor: '#7a9b7f' }}
                        value={p.betrag_brutto}
                        onChange={e => updatePos(i, 'betrag_brutto', e.target.value)}
                        placeholder="0.00"
                      />
                    </td>
                    {/* → Berechnete Felder (read-only) */}
                    <td style={{ ...cellTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#2e4a7d', fontSize: 12 }}>
                      {p.betrag_mwst ? CHF(p.betrag_mwst) : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                    <td style={{ ...cellTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6b826b', fontSize: 12 }}>
                      {p.betrag_netto ? CHF(p.betrag_netto) : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                    <td style={cellTd}>
                      <button
                        onClick={() => setPositionen(prev => prev.filter((_, j) => j !== i))}
                        style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 24, padding: '12px 16px', borderTop: '1px solid #e4e9e4', background: '#fafcfa' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a394' }}>Netto</div>
              <div style={{ fontWeight: 500, fontSize: 12.5, color: '#6b826b', marginTop: 2 }}>{head.waehrung} {CHF(totals.netto)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#2e4a7d' }}>Vorsteuer</div>
              <div style={{ fontWeight: 600, fontSize: 12.5, color: '#2e4a7d', marginTop: 2 }}>{head.waehrung} {CHF(totals.mwst)}</div>
            </div>
            <div style={{ textAlign: 'right', paddingLeft: 12, borderLeft: '2px solid #e4e9e4' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#3d6641' }}>{istGutschrift ? 'Gutschrift-Betrag' : 'Zu zahlen (Brutto)'}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', marginTop: 2 }}>{head.waehrung} {CHF(totals.brutto)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Belegvorschau ── */}
      <div style={{ flexShrink: 0, width: 360, display: 'flex', flexDirection: 'column', background: '#f8f8f8' }}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#4a5a4a' }}>Belegvorschau</span>
          {scanFile && (
            <span style={{ fontSize: 11, color: '#94a394' }}>— {scanFile.name}</span>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {pdfBlobUrl && scanFile?.type === 'application/pdf' ? (
            <>
              <iframe
                src={pdfBlobUrl}
                title={scanFile.name}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              />
              {/* QR-Status Overlay unten */}
              {scanStatus === 'found' && (
                <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(22,101,52,0.92)', color: '#fff', borderRadius: 8, padding: '5px 14px', fontSize: 11.5, fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                  ✅ QR erkannt
                </div>
              )}
              {scanStatus === 'scanning' && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#2e4a7d' }}>
                  Scannt QR…
                </div>
              )}
            </>
          ) : pdfBlobUrl && scanFile?.type.startsWith('image/') ? (
            <div style={{ height: '100%', overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12 }}>
              <img src={pdfBlobUrl} alt="Beleg" style={{ maxWidth: '100%', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }} />
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#bbb' }}>
              <svg style={{ width: 48, height: 48, stroke: '#d4dcd4' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span style={{ fontSize: 12 }}>PDF oder Bild laden für QR-Scan</span>
            </div>
          )}
        </div>
      </div>

      {liefModal && (
        <NeuerLieferantModal
          init={liefModal.init}
          saving={quickLiefSaving}
          onSave={handleSaveLief}
          onClose={() => setLiefModal(null)}
        />
      )}
    </div>
  );
}
