import { useEffect, useRef } from 'react';
import { loadHandle, loadHandleMeta } from './fileHandleDB';

// Wie lange muss der Tab versteckt gewesen sein damit Auto-Checkin
// beim Zurueckkommen ausgeloest wird (z.B. Excel schliessen -> Tab oeffnen)
const MIN_HIDDEN_MS = 10_000;   // 10 Sekunden

// Nach wie viel ms ohne weitere Dateiänderung wird automatisch eingecheckt
// (Polling-Pfad, Browser bleibt die ganze Zeit offen)
const STABLE_MS = 30_000;       // 30 Sekunden

// Poll-Intervall
const POLL_MS = 5_000;          // alle 5 Sekunden

/**
 * Ueberwacht ausgecheckte Dateien und checkt sie automatisch ein
 * wenn sie lokal geaendert werden (z.B. Speichern in Excel/Word).
 *
 * Funktioniert nur in Chrome/Edge (File System Access API).
 *
 * @param {Array}    myDocs        – Dokumente die vom aktuellen User ausgecheckt sind
 * @param {Function} onAutoCheckin – callback(doc, file) bei erkannter Aenderung
 */
export default function useFileWatcher(myDocs, onAutoCheckin) {
  const cbRef   = useRef(onAutoCheckin);
  const docsRef = useRef(myDocs);
  // Immer aktuelle Werte via Refs (kein stale closure)
  cbRef.current   = onAutoCheckin;
  docsRef.current = myDocs;

  useEffect(() => {
    // File System Access API nicht unterstuetzt (Firefox, Safari) -> kein Watcher
    if (!('showSaveFilePicker' in window)) return;

    // Pro-Dokument Zustand: { handle, origLM, seenLM, timer }
    const st         = {};
    // Verhindert Doppel-Checkins (Race Condition bei parallelen Polls)
    const inProgress = new Set();

    // Laedt Datei-Handle + Metadaten aus IndexedDB (gecacht pro Render-Zyklus)
    const getFile = async (doc) => {
      if (!st[doc.id]) st[doc.id] = {};
      const s = st[doc.id];

      if (!s.handle) {
        s.handle = await loadHandle(doc.id).catch(() => null);
        if (!s.handle) return null;
      }
      if (s.origLM === undefined) {
        const meta = await loadHandleMeta(doc.id).catch(() => null);
        s.origLM = meta?.originalLastModified ?? null;
      }
      try {
        // Berechtigung pruefen, aber NICHT im Hintergrund anfragen
        if ((await s.handle.queryPermission({ mode: 'read' })) !== 'granted') return null;
        return await s.handle.getFile();
      } catch { return null; }
    };

    // Loest den automatischen Checkin aus
    const triggerCheckin = async (doc, file) => {
      if (inProgress.has(doc.id)) return;
      inProgress.add(doc.id);
      clearTimeout(st[doc.id]?.timer);
      delete st[doc.id];
      try {
        await cbRef.current(doc, file);
      } catch (e) {
        console.error('[FileWatcher] Auto-Checkin Fehler:', e);
      } finally {
        inProgress.delete(doc.id);
      }
    };

    // Prueft ein einzelnes Dokument auf Aenderungen (Polling-Pfad)
    const checkDoc = async (doc) => {
      if (inProgress.has(doc.id)) return;
      const file = await getFile(doc);
      if (!file) return;

      const s  = st[doc.id];
      const lm = file.lastModified;

      // Erster Check: Baseline setzen, noch nichts tun
      if (s.seenLM === undefined) { s.seenLM = lm; return; }

      // Kein Original gespeichert oder unveraendert -> nichts tun
      if (s.origLM === null || lm === s.origLM) return;

      // Datei hat sich veraendert! Stabilitaets-Timer (neu-)starten.
      // Erst wenn 30s keine weiteren Aenderungen -> einchecken.
      if (s.seenLM !== lm) {
        s.seenLM = lm;
        clearTimeout(s.timer);
        s.timer = setTimeout(() => {
          // Nochmal Datei lesen um sichersten Stand zu haben
          getFile(doc).then(f => f && triggerCheckin(doc, f)).catch(() => {});
        }, STABLE_MS);
      }
    };

    // Polling starten
    const pollAll = () => docsRef.current.forEach(d => checkDoc(d).catch(() => {}));
    pollAll(); // sofort beim Start
    const iv = setInterval(pollAll, POLL_MS);

    // Visibility-Change: User kommt von Excel/Word zurueck -> sofort pruefen
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else {
        const dur = Date.now() - hiddenAt;
        hiddenAt = 0;
        // Kurzes Wechseln ignorieren (< 10s) – nur wenn wirklich in Excel gearbeitet
        if (dur < MIN_HIDDEN_MS) return;

        docsRef.current.forEach(async (doc) => {
          if (inProgress.has(doc.id)) return;
          try {
            const file = await getFile(doc);
            if (!file) return;
            const s = st[doc.id];
            if (!s || s.origLM === null || file.lastModified === s.origLM) return;
            // Datei wurde geaendert -> sofort einchecken (kein Stabilitaets-Wait)
            await triggerCheckin(doc, file);
          } catch { /* ignore */ }
        });
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      Object.values(st).forEach(s => clearTimeout(s.timer));
    };
  }, []); // einmalig – aktuelle Werte via Refs
}
