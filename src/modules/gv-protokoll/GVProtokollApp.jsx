import React, { useState, useEffect, useRef } from 'react';
import './styles.css';
import {supabase} from "../../api/supabaseClient.js";

// ════════════════════════════════════════════════════════════════
//  KOnstanten & Initialisierungen
// ════════════════════════════════════════════════════════════════
const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444", "#84cc16", "#f97316", "#14b8a6"];
const DB_NAME = "gv-protokoll";
const DB_VER = 1;
const CHUNK_MS = 15000;
const PREVIEW_FIRST_MS = 75000;   // erste Live-Vorschau nach ~75 s (früh sehen, dass es läuft)
const PREVIEW_MS = 300000;        // danach alle 5 Min – Kosten bleiben ~2×, egal welches Intervall

const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

// Spaltenbreiten: Startwerte + Grenzen (Mittelspalte füllt den Rest)
const COL_W_DEFAULT = { left: 270, right: 340 };
const COL_W_LIMITS = { left: [190, 560], right: [240, 760] };
const clamp = (v, [min, max]) => Math.min(max, Math.max(min, v));

export default function GvProtokollApp() {
    // ════════════════════════════════════════════════════════════════
    //  States
    // ════════════════════════════════════════════════════════════════
    const [cfg, setCfg] = useState(() => LS.get("gv_cfg", { lang: "de", mic: "", systemAudio: false }));
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(() => LS.get("gv_customer", { id: "", name: "" }));
    const [persons, setPersons] = useState(() => LS.get("gv_persons", []));
    const [segments, setSegments] = useState(() => LS.get("gv_segments", []));
    const [speakerMap, setSpeakerMap] = useState(() => LS.get("gv_speakerMap", {}));
    const [segOverrides, setSegOverrides] = useState(() => LS.get("gv_segOverrides", {}));

    const [tasks, setTasks] = useState(() => { const ev = LS.get("gv_eval", null); return ev?.tasks || []; });
    const [decisions, setDecisions] = useState(() => { const ev = LS.get("gv_eval", null); return ev?.decisions || []; });
    const [summaryText, setSummaryText] = useState(() => { const ev = LS.get("gv_eval", null); return ev?.summaryText || ""; });
    const [traktanden, setTraktanden] = useState(() => { const ev = LS.get("gv_eval", null); return ev?.traktanden || []; });
    const [agenda, setAgenda] = useState(() => LS.get("gv_agenda", ""));

    // UI States
    const [timerText, setTimerText] = useState("00:00");
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [statusMsg, setStatusMsg] = useState("");
    const [recoveryItems, setRecoveryItems] = useState([]);
    const [recList, setRecList] = useState([]);
    const [showSettings, setShowSettings] = useState(false);
    const [mics, setMics] = useState([]);
    const [volWidth, setVolWidth] = useState("0%");
    const [inputName, setInputName] = useState("");
    const [savedProtocols, setSavedProtocols] = useState([]);
    const [currentProtocolId, setCurrentProtocolId] = useState(null);
    const [protocolTitle, setProtocolTitle] = useState("");

    // Spaltenbreiten (per Maus verschiebbar, pro Gerät gemerkt)
    const [colW, setColW] = useState(() => LS.get("gv_colW", COL_W_DEFAULT));
    const dragRef = useRef(null);

    // Refs
    const mediaRecRef = useRef(null);
    const streamRef = useRef(null);
    const timerIntRef = useRef(null);
    const liveTimerRef = useRef(null);
    const audioCtxRef = useRef(null);
    const analyserRef = useRef(null);
    const volRAFRef = useRef(null);
    const previewAudioRef = useRef(null);
    const lastAudioUrlRef = useRef(null);
    const previewTimerRef = useRef(null);

    // Live-Vorschau (2. Recorder, rotiert eigenständige Häppchen)
    const prevRecRef = useRef(null);        // Recorder B (Vorschau)
    const prevRotateRef = useRef(null);     // Rotations-Timer
    const prevSegmentsRef = useRef([]);     // bisher zusammengetragene Vorschau-Segmente
    const prevStoppingRef = useRef(false);  // beim Stopp letztes Häppchen nicht mehr transkribieren

    const curRecIdRef = useRef(null);
    const chunkSeqRef = useRef(0);
    const recMimeRef = useRef("");
    const pendingSavesRef = useRef([]);
    const recStartRef = useRef(0);
    const timeOffsetRef = useRef(0);
    const liveBusyRef = useRef(false);

    // ════════════════════════════════════════════════════════════════
    //  IndexedDB & Synchros
    // ════════════════════════════════════════════════════════════════
    const idb = () => {
        return new Promise((res, rej) => {
            const r = indexedDB.open(DB_NAME, DB_VER);
            r.onupgradeneeded = () => {
                const db = r.result;
                if (!db.objectStoreNames.contains("recordings")) db.createObjectStore("recordings", { keyPath: "id" });
                if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["recId", "seq"] });
            };
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
    };

    const dbPut = async (store, val) => {
        const db = await idb();
        return new Promise((res, rej) => {
            const t = db.transaction(store, "readwrite");
            t.objectStore(store).put(val);
            t.oncomplete = () => res();
            t.onerror = () => rej(t.error);
        });
    };

    const dbGetAll = async (store) => {
        const db = await idb();
        return new Promise((res, rej) => {
            const r = db.transaction(store, "readonly").objectStore(store).getAll();
            r.onsuccess = () => res(r.result || []);
            r.onerror = () => rej(r.error);
        });
    };

    const dbDel = async (store, key) => {
        const db = await idb();
        return new Promise((res, rej) => {
            const t = db.transaction(store, "readwrite");
            t.objectStore(store).delete(key);
            t.oncomplete = () => res();
            t.onerror = () => rej(t.error);
        });
    };

    useEffect(() => {
        LS.set("gv_persons", persons);
        LS.set("gv_speakerMap", speakerMap);
    }, [persons, speakerMap]);

    useEffect(() => {
        LS.set("gv_eval", { summaryText, traktanden, tasks, decisions });
    }, [summaryText, traktanden, tasks, decisions]);

    useEffect(() => {
        LS.set("gv_agenda", agenda);
        LS.set("gv_segOverrides", segOverrides);
    }, [agenda, segOverrides]);

    useEffect(() => {
        LS.set("gv_customer", selectedCustomer);
        loadProtocols(selectedCustomer);
    }, [selectedCustomer.id, selectedCustomer.name]);

    useEffect(() => {
        loadCustomers();
        refreshRecoveryBanner();
        refreshMics();
        loadRecList();
    }, []);

    // ── Spalten verschieben ──────────────────────────────────────────
    const startColDrag = (which) => (e) => {
        e.preventDefault();
        dragRef.current = { which, startX: e.clientX, startW: colW[which] };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    const resetCols = () => {
        setColW(COL_W_DEFAULT);
        LS.set("gv_colW", COL_W_DEFAULT);
    };

    useEffect(() => {
        const onMove = (e) => {
            const d = dragRef.current;
            if (!d) return;
            // linker Trenner wächst mit der Maus, rechter gegenläufig
            const delta = d.which === "left" ? e.clientX - d.startX : d.startX - e.clientX;
            setColW(w => ({ ...w, [d.which]: clamp(d.startW + delta, COL_W_LIMITS[d.which]) }));
        };
        const onUp = () => {
            if (!dragRef.current) return;
            dragRef.current = null;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            setColW(w => { LS.set("gv_colW", w); return w; });
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, []);

    const loadCustomers = async () => {
        try {
            const { data, error } = await supabase
                .from('customers')
                .select('id, company_name, anrede, nachname, vorname, person_type, aktiv')
                .neq('aktiv', false)
                .order('company_name', { ascending: true });

            if (error) throw error;

            if (data) {
                setCustomers(data);
            }
        } catch (err) {
            console.error("Fehler beim Laden der Kunden:", err);
        }
    };

    // ════════════════════════════════════════════════════════════════
    //  Protokoll-Ablage (Supabase, pro Kunde)
    // ════════════════════════════════════════════════════════════════
    const loadProtocols = async (cust) => {
        if (!cust?.id && !cust?.name) { setSavedProtocols([]); return; }
        try {
            let q = supabase
                .from('gv_protocols')
                .select('id, title, meeting_date, updated_at')
                .order('meeting_date', { ascending: false })
                .order('updated_at', { ascending: false });
            q = cust.id ? q.eq('customer_id', cust.id) : q.eq('customer_name', cust.name);
            const { data, error } = await q;
            if (error) throw error;
            setSavedProtocols(data || []);
        } catch (err) {
            console.error("Fehler beim Laden der Protokolle:", err);
        }
    };

    const saveProtocol = async () => {
        if (!selectedCustomer.id && !selectedCustomer.name) {
            setStatusMsg("❌ Bitte zuerst einen Kunden wählen.");
            return;
        }
        const defTitle = protocolTitle || `Protokoll ${new Date().toLocaleDateString("de-CH")}`;
        const title = window.prompt("Titel des Protokolls:", defTitle);
        if (title === null) return;

        const payload = {
            customer_id: selectedCustomer.id || null,
            customer_name: selectedCustomer.name,
            title: title.trim() || defTitle,
            data: { persons, segments, speakerMap, segOverrides, agenda, summaryText, traktanden, tasks, decisions },
            updated_at: new Date().toISOString(),
        };
        try {
            if (currentProtocolId) {
                const { error } = await supabase.from('gv_protocols').update(payload).eq('id', currentProtocolId);
                if (error) throw error;
            } else {
                const { data, error } = await supabase.from('gv_protocols').insert(payload).select('id').single();
                if (error) throw error;
                setCurrentProtocolId(data.id);
            }
            setProtocolTitle(payload.title);
            setStatusMsg(`💾 „${payload.title}" in der Ablage gespeichert.`);
            loadProtocols(selectedCustomer);
        } catch (err) {
            setStatusMsg("❌ Fehler beim Speichern: " + err.message);
        }
    };

    const openProtocol = async (id) => {
        try {
            const { data, error } = await supabase.from('gv_protocols').select('*').eq('id', id).single();
            if (error) throw error;
            const d = data.data || {};
            setPersons(d.persons || []);
            setSegments(d.segments || []);
            LS.set("gv_segments", d.segments || []);
            setSpeakerMap(d.speakerMap || {});
            setSegOverrides(d.segOverrides || {});
            setAgenda(d.agenda || "");
            setSummaryText(d.summaryText || "");
            setTraktanden(d.traktanden || []);
            setTasks(d.tasks || []);
            setDecisions(d.decisions || []);
            setCurrentProtocolId(data.id);
            setProtocolTitle(data.title);
            setStatusMsg(`📂 „${data.title}" geladen.`);
        } catch (err) {
            setStatusMsg("❌ Fehler beim Öffnen: " + err.message);
        }
    };

    const deleteProtocol = async (id, title) => {
        if (!window.confirm(`Protokoll „${title}" endgültig löschen?`)) return;
        try {
            const { error } = await supabase.from('gv_protocols').delete().eq('id', id);
            if (error) throw error;
            if (id === currentProtocolId) setCurrentProtocolId(null);
            loadProtocols(selectedCustomer);
            setStatusMsg("🗑️ Protokoll gelöscht.");
        } catch (err) {
            setStatusMsg("❌ Fehler beim Löschen: " + err.message);
        }
    };

    const newProtocol = () => {
        const hasContent = segments.length || persons.length || summaryText || agenda;
        if (hasContent && !window.confirm("Neues Protokoll beginnen? Nicht gespeicherte Änderungen gehen verloren.")) return;
        setPersons([]);
        setSegments([]);
        LS.set("gv_segments", []);
        setSpeakerMap({});
        setSegOverrides({});
        setAgenda("");
        setSummaryText("");
        setTraktanden([]);
        setTasks([]);
        setDecisions([]);
        setCurrentProtocolId(null);
        setProtocolTitle("");
        setTimerText("00:00");
        setStatusMsg("🆕 Neues Protokoll begonnen.");
    };

    const refreshRecoveryBanner = async () => {
        try {
            const recs = await dbGetAll("recordings");
            const pending = recs.filter(r => r.status !== "finalized");
            const items = [];
            for (const r of pending) {
                const chunks = (await dbGetAll("chunks")).filter(c => c.recId === r.id);
                items.push({ id: r.id, startedAt: r.startedAt, chunkCount: chunks.length, mimeType: r.mimeType });
            }
            setRecoveryItems(items);
        } catch {}
    };

    // ── Lokale Aufnahmen (IndexedDB) verwalten ───────────────────────
    const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB"
        : b >= 1024 ? Math.round(b / 1024) + " KB" : (b || 0) + " B";

    const loadRecList = async () => {
        try {
            const [recs, chunks] = [await dbGetAll("recordings"), await dbGetAll("chunks")];
            const sizeByRec = {};
            for (const c of chunks) sizeByRec[c.recId] = (sizeByRec[c.recId] || 0) + ((c.blob && c.blob.size) || 0);
            const list = recs
                .map(r => ({ id: r.id, startedAt: r.startedAt, status: r.status, bytes: sizeByRec[r.id] || 0 }))
                .sort((a, b) => b.startedAt - a.startedAt);
            setRecList(list);
        } catch {}
    };

    // Chunks aus IndexedDB zu EINER Datei zusammensetzen und herunterladen.
    // Bewusst nicht recMimeRef benutzen: der Ref ist nach einem Reload leer,
    // die gespeicherte Aufnahme kennt ihren mimeType aber noch.
    const downloadRecording = async (id) => {
        try {
            const rec = (await dbGetAll("recordings")).find(r => r.id === id);
            const chunks = (await dbGetAll("chunks")).filter(c => c.recId === id).sort((a, b) => a.seq - b.seq);
            if (!chunks.length) {
                setStatusMsg("⚠️ Zu dieser Aufnahme sind keine Audiodaten mehr vorhanden.");
                return;
            }
            const mime = rec?.mimeType || chunks[0].blob?.type || "audio/webm";
            const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
            const blob = new Blob(chunks.map(c => c.blob), { type: mime });
            const stamp = new Date(rec?.startedAt || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, "-");
            const url = URL.createObjectURL(blob);
            const el = document.createElement("a");
            el.href = url;
            el.download = `GV-Aufnahme_${stamp}.${ext}`;
            document.body.appendChild(el);
            el.click();
            el.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000); // grosse Dateien brauchen Zeit
            setStatusMsg(`⬇️ Aufnahme als Datei gespeichert (${fmtSize(blob.size)}).`);
        } catch (e) {
            setStatusMsg("❌ Download fehlgeschlagen: " + e.message);
        }
    };

    const deleteRecording = async (id) => {
        if (id === curRecIdRef.current && isRecording) {
            setStatusMsg("⚠️ Laufende Aufnahme kann nicht gelöscht werden – zuerst Stopp drücken.");
            return;
        }
        if (!window.confirm("Diese Aufnahme (Audio) endgültig von diesem Gerät löschen?")) return;
        try {
            const chunks = (await dbGetAll("chunks")).filter(c => c.recId === id);
            for (const c of chunks) await dbDel("chunks", [c.recId, c.seq]);
            await dbDel("recordings", id);
            await loadRecList();
            refreshRecoveryBanner();
            setStatusMsg("🗑️ Aufnahme gelöscht.");
        } catch (e) {
            setStatusMsg("❌ Löschen fehlgeschlagen: " + e.message);
        }
    };

    const deleteAllRecordings = async () => {
        if (!recList.length) return;
        if (!window.confirm(`Alle ${recList.length} lokalen Aufnahmen (Audio) endgültig löschen? Transkripte und gespeicherte Protokolle bleiben erhalten.`)) return;
        try {
            const skip = isRecording ? curRecIdRef.current : null;
            const chunks = await dbGetAll("chunks");
            for (const c of chunks) if (c.recId !== skip) await dbDel("chunks", [c.recId, c.seq]);
            const recs = await dbGetAll("recordings");
            for (const r of recs) if (r.id !== skip) await dbDel("recordings", r.id);
            await loadRecList();
            refreshRecoveryBanner();
            setStatusMsg("🗑️ Alle lokalen Aufnahmen gelöscht.");
        } catch (e) {
            setStatusMsg("❌ Löschen fehlgeschlagen: " + e.message);
        }
    };

    const refreshMics = async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        try {
            const devs = await navigator.mediaDevices.enumerateDevices();
            setMics(devs.filter(d => d.kind === "audioinput"));
        } catch {}
    };

    // ════════════════════════════════════════════════════════════════
    //  Recording Core Logic
    // ════════════════════════════════════════════════════════════════
    const startRec = async () => {
        try {
            let s;
            if (cfg.systemAudio) {
                s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
                s.getVideoTracks().forEach(t => t.stop());
            } else {
                const audioConstraints = { echoCancellation: true, noiseSuppression: true };
                if (cfg.mic) audioConstraints.deviceId = { exact: cfg.mic };
                s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            }
            streamRef.current = s;
        } catch (e) {
            setStatusMsg("Audio-Zugriff verweigert: " + e.message);
            return;
        }

        recStartRef.current = Date.now();
        timeOffsetRef.current = 0;

        let pickedMime = "audio/webm;codecs=opus";
        if (!MediaRecorder.isTypeSupported(pickedMime)) pickedMime = "audio/webm";
        if (!MediaRecorder.isTypeSupported(pickedMime)) pickedMime = "audio/mp4";
        recMimeRef.current = pickedMime;

        curRecIdRef.current = "rec_" + recStartRef.current;
        chunkSeqRef.current = 0;
        pendingSavesRef.current = [];

        await dbPut("recordings", { id: curRecIdRef.current, startedAt: recStartRef.current, status: "recording", mimeType: pickedMime });

        mediaRecRef.current = new MediaRecorder(streamRef.current, { mimeType: pickedMime });
        mediaRecRef.current.ondataavailable = e => {
            if (!e.data || !e.data.size) return;
            const seq = chunkSeqRef.current++;
            const p = dbPut("chunks", { recId: curRecIdRef.current, seq, blob: e.data });
            pendingSavesRef.current.push(p);
        };

        mediaRecRef.current.onstop = async () => {
            stopMeter();
            await Promise.allSettled(pendingSavesRef.current);
            await dbPut("recordings", { id: curRecIdRef.current, startedAt: recStartRef.current, status: "done", mimeType: recMimeRef.current });
            await finalizeRecording(curRecIdRef.current);
        };

        mediaRecRef.current.start(CHUNK_MS);
        setIsRecording(true);
        setIsPaused(false);

        timerIntRef.current = setInterval(() => {
            const elapsed = (Date.now() - recStartRef.current) / 1000 + timeOffsetRef.current;
            setTimerText(fmtTime(elapsed));
        }, 250);

        startMeter(streamRef.current);
        // Live-Vorschau (grob): erste nach ~75 s, danach alle 5 Min. Die saubere
        // Endfassung (ganze Datei) kommt beim Stopp und ersetzt die Vorschau.
        startPreview();
    };

    const pauseRec = () => {
        if (!mediaRecRef.current || mediaRecRef.current.state === "inactive") return;
        if (!isPaused) {
            mediaRecRef.current.pause();
            if (prevRecRef.current && prevRecRef.current.state === "recording") { try { prevRecRef.current.pause(); } catch {} }
            if (prevRotateRef.current) { clearTimeout(prevRotateRef.current); prevRotateRef.current = null; }
            clearInterval(timerIntRef.current);
            timeOffsetRef.current += (Date.now() - recStartRef.current) / 1000;
            setIsPaused(true);
            setStatusMsg(" Aufnahme pausiert.");
        } else {
            recStartRef.current = Date.now();
            mediaRecRef.current.resume();
            if (prevRecRef.current && prevRecRef.current.state === "paused") { try { prevRecRef.current.resume(); } catch {} }
            if (!prevStoppingRef.current) prevRotateRef.current = setTimeout(rotatePreview, PREVIEW_MS);
            timerIntRef.current = setInterval(() => {
                const elapsed = (Date.now() - recStartRef.current) / 1000 + timeOffsetRef.current;
                setTimerText(fmtTime(elapsed));
            }, 250);
            setIsPaused(false);
            setStatusMsg("🔴 Aufnahme läuft weiter...");
        }
    };

    const stopRec = () => {
        stopPreview();
        if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
        if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") mediaRecRef.current.stop();
        if (timerIntRef.current) clearInterval(timerIntRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        setIsRecording(false);
        setIsPaused(false);
    };

    // ── Live-Vorschau: eigenständige Häppchen über einen 2. Recorder ────
    // Jedes Häppchen ist eine vollständige, für sich transkribierbare Audiodatei.
    // Der durchgehende Recorder A liefert später die lückenlose Endfassung.
    const startPreviewSegment = () => {
        const stream = streamRef.current;
        if (!stream) return;
        try {
            const chunks = [];
            const baseSec = (Date.now() - recStartRef.current) / 1000 + timeOffsetRef.current; // Startzeit im Gesamtverlauf
            const rec = new MediaRecorder(stream, { mimeType: recMimeRef.current });
            rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
            rec.onstop = () => {
                if (prevStoppingRef.current || !chunks.length) return;
                const blob = new Blob(chunks, { type: recMimeRef.current });
                previewTranscribe(blob, baseSec); // nicht awaiten – läuft parallel weiter
            };
            rec.start();
            prevRecRef.current = rec;
        } catch { /* Vorschau ist optional */ }
    };

    const rotatePreview = () => {
        if (prevStoppingRef.current) return;
        if (prevRecRef.current && prevRecRef.current.state === "recording") {
            try { prevRecRef.current.stop(); } catch {} // → onstop transkribiert dieses Häppchen
        }
        startPreviewSegment();
        prevRotateRef.current = setTimeout(rotatePreview, PREVIEW_MS);
    };

    const startPreview = () => {
        prevStoppingRef.current = false;
        prevSegmentsRef.current = [];
        startPreviewSegment();
        prevRotateRef.current = setTimeout(rotatePreview, PREVIEW_FIRST_MS);
    };

    const stopPreview = () => {
        prevStoppingRef.current = true;
        if (prevRotateRef.current) { clearTimeout(prevRotateRef.current); prevRotateRef.current = null; }
        if (prevRecRef.current && prevRecRef.current.state !== "inactive") {
            try { prevRecRef.current.stop(); } catch {}
        }
    };

    // ════════════════════════════════════════════════════════════════
    //  Audio-Meter & Helpers
    // ════════════════════════════════════════════════════════════════
    const startMeter = (s) => {
        try {
            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            const src = audioCtxRef.current.createMediaStreamSource(s);
            analyserRef.current = audioCtxRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
            src.connect(analyserRef.current);
            const data = new Uint8Array(analyserRef.current.frequencyBinCount);
            const loop = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getByteFrequencyData(data);
                let sum = 0;
                data.forEach(v => sum += v);
                setVolWidth(Math.min(100, (sum / data.length) * 1.5) + "%");
                volRAFRef.current = requestAnimationFrame(loop);
            };
            volRAFRef.current = requestAnimationFrame(loop);
        } catch {}
    };

    const stopMeter = () => {
        if (volRAFRef.current) cancelAnimationFrame(volRAFRef.current);
        if (audioCtxRef.current) audioCtxRef.current.close().catch(()=>{});
        setVolWidth("0%");
    };

    const fmtTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
    };

    // ════════════════════════════════════════════════════════════════
    //  Transkription & AI Evaluation
    // ════════════════════════════════════════════════════════════════
    // Transkription über Suisse Notes (Schweizerdeutsch + Sprecher-Trennung).
    // Ablauf: Audio hochladen → Job-ID → alle 5 s pollen → Segmente mappen.
    //
    // Zwei Wege:
    //   • transcribe()        – saubere Endfassung beim Stopp (ganze Datei, ersetzt Vorschau)
    //   • previewTranscribe() – grobe Live-Vorschau während der Aufnahme (2. Recorder,
    //                           eigenständige Häppchen; erste nach ~75 s, dann alle 5 Min)

    // Rohe Suisse-Notes-Transkription eines Blobs (Upload + Pollen). Gibt das
    // transcript-Objekt zurück oder wirft.
    const suisseTranscribe = async (blob) => {
        const fd = new FormData();
        fd.append("file", blob, "aufnahme.webm");
        fd.append("language", "de"); // Schweizerdeutsch wird unter "de" automatisch erkannt

        const { data: up, error: upErr } = await supabase.functions.invoke('gv-stt', { body: fd });
        if (upErr) throw new Error(upErr.message);
        if (up?.error) throw new Error(typeof up.error === "string" ? up.error : JSON.stringify(up.error));
        const jobId = up?.id;
        if (!jobId) throw new Error("Keine Transkriptions-ID von Suisse Notes erhalten.");

        for (let i = 0; i < 240; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const { data: st, error: stErr } = await supabase.functions.invoke('gv-stt', { body: { id: jobId } });
            if (stErr) throw new Error(stErr.message);
            if (st?.status === "completed") return st.transcript || {};
            if (st?.status === "failed") throw new Error(st.error || "Transkription fehlgeschlagen.");
        }
        throw new Error("Zeitüberschreitung beim Transkribieren.");
    };

    // Suisse-Notes-Segmente → Modul-Format. baseSec verschiebt die Zeitachse
    // (für Vorschau-Häppchen, die mitten in der Aufnahme beginnen).
    const mapSegs = (tr, baseSec = 0, preview = false) => {
        const nameToKey = {};
        let spkIdx = 0;
        return (tr.segments || []).map(s => {
            const name = s.speaker || "Speaker 1";
            if (!(name in nameToKey)) nameToKey[name] = "speaker_" + (spkIdx++);
            return {
                speaker: nameToKey[name],
                text: (s.text || "").trim(),
                start: (s.start_ms || 0) / 1000 + baseSec,
                end: (s.end_ms || 0) / 1000 + baseSec,
                preview,
            };
        }).filter(s => s.text);
    };

    // Saubere Endfassung (ganze Datei) – beim Stopp / bei „Audio laden".
    const transcribe = async (blob) => {
        setStatusMsg("⏳ Saubere Endfassung wird erstellt (Upload zu Suisse Notes)…");
        try {
            const tr = await suisseTranscribe(blob);
            const segs = mapSegs(tr, 0, false);

            if (lastAudioUrlRef.current) URL.revokeObjectURL(lastAudioUrlRef.current);
            lastAudioUrlRef.current = URL.createObjectURL(blob);

            setSegments(segs);
            LS.set("gv_segments", segs);
            setStatusMsg(`✅ Transkription abgeschlossen (${segs.length} Abschnitte).`);
            return true;
        } catch (e) {
            setStatusMsg("❌ Fehler: " + e.message);
            return false;
        }
    };

    // Grobe Live-Vorschau eines Häppchens (während der Aufnahme). Ergebnisse
    // werden zeitlich einsortiert; die saubere Endfassung ersetzt sie beim Stopp.
    const previewTranscribe = async (blob, baseSec) => {
        try {
            const tr = await suisseTranscribe(blob);
            if (prevStoppingRef.current) return; // Aufnahme beendet → Endfassung übernimmt
            const mapped = mapSegs(tr, baseSec, true);
            const merged = [...prevSegmentsRef.current, ...mapped].sort((a, b) => a.start - b.start);
            prevSegmentsRef.current = merged;
            setSegments(merged);
            LS.set("gv_segments", merged);
            setStatusMsg("👀 Vorschau aktualisiert (grob) – saubere Fassung folgt beim Stopp.");
        } catch { /* Vorschau-Fehler still ignorieren, Endfassung bleibt massgeblich */ }
    };

    const finalizeRecording = async (recId) => {
        const chunks = (await dbGetAll("chunks")).filter(c => c.recId === recId).sort((a,b)=>a.seq-b.seq);
        if (!chunks.length) return;
        const blob = new Blob(chunks.map(c => c.blob), { type: recMimeRef.current || "audio/webm" });
        const success = await transcribe(blob);
        if (success) {
            await dbPut("recordings", { id: recId, startedAt: Date.now(), status: "finalized", mimeType: recMimeRef.current });
            refreshRecoveryBanner();
        }
    };

    const evaluateAI = async () => {
        if (!segments.length) return;
        setStatusMsg("✨ Claude analysiert das Protokoll...");

        const transcriptPlain = segments.map(s => `${speakerLabel(s.speaker)}: ${segOverrides[s.start] || s.text}`).join("\n");
        const sys = `Du bist Protokollführer einer Generalversammlung. Fülle das JSON-Schema sauber aus.`;
        const usr = `Kunde: ${selectedCustomer.name}\nTeilnehmer: ${persons.map(p=>p.name).join(", ")}\nTraktandenliste:\n${agenda}\n\nTranskript:\n${transcriptPlain}`;

        try {
            const { data, error } = await supabase.functions.invoke('gv-llm', {
                body: {usr, sys}
            })
            if (error) throw new Error(error.message)

            const obj = JSON.parse(data.content[0].text);

            setSummaryText(obj.zusammenfassung || "");
            setTraktanden(obj.traktanden || []);
            setTasks((obj.aufgaben || []).map(t => ({ text: t.text, who: t.verantwortlich, due: t.frist })));
            setDecisions((obj.beschluesse || []).map(b => ({ text: b.text })));
            setStatusMsg("✅ Auswertung abgeschlossen.");
        } catch (e) {
            setStatusMsg("❌ Fehler bei Auswertung: " + e.message);
        }
    };

    // ════════════════════════════════════════════════════════════════
    //  Label & Color Resolvers
    // ════════════════════════════════════════════════════════════════
    const speakerLabel = (spk) => {
        const pid = speakerMap[spk];
        return persons.find(p => p.id === pid)?.name || "Sprecher " + (parseInt(spk.replace(/\D/g, "")) + 1 || spk);
    };

    const speakerColor = (spk) => {
        const pid = speakerMap[spk];
        const p = persons.find(x => x.id === pid);
        if (p) return p.color;
        const n = parseInt(spk.replace(/\D/g, "")) || 0;
        return COLORS[n % COLORS.length];
    };

    const previewSpeaker = (spk) => {
        if (!lastAudioUrlRef.current) return;
        const a = previewAudioRef.current;
        const firstSeg = segments.find(s => s.speaker === spk);
        if (!firstSeg) return;
        a.src = lastAudioUrlRef.current;
        a.currentTime = firstSeg.start;
        a.play().catch(()=>{});
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        previewTimerRef.current = setTimeout(() => a.pause(), 5000);
    };

    const mergeSpeaker = (from, to) => {
        const updatedMap = { ...speakerMap };
        segments.forEach(s => {
            if (s.speaker === from) s.speaker = to;
        });
        delete updatedMap[from];
        setSpeakerMap(updatedMap);
        setSegments([...segments]);
    };

    const customerLabel = (c) => c.person_type === "privatperson" ? `${c.anrede || ""} ${c.vorname || ""} ${c.nachname || ""}`.trim() : c.company_name;

    const exportMarkdown = () => {
        let md = `# Protokoll: ${selectedCustomer.name || "GV"}\n\n## Zusammenfassung\n${summaryText}\n`;
        const blob = new Blob([md], { type: "text/markdown" });
        const el = document.createElement("a");
        el.href = URL.createObjectURL(blob);
        el.download = "Protokoll.md";
        el.click();
    };

    return (
        <div className="gv-body">
            <header>
                <h1>🏛️ GV-Protokoll</h1>
                <span className="sub">Aufnahme · Transkript · Beschlüsse</span>
                <div className="spacer"></div>
                <span className="timer">{timerText}</span>

                <button className="btn" onClick={newProtocol} disabled={isRecording} title="Neues Protokoll beginnen">🆕 Neu</button>

                <button className={`btn ${isRecording ? 'primary' : 'rec'}`} onClick={isRecording ? stopRec : startRec}>
                    <span>{isRecording ? "■" : "●"}</span> <span>{isRecording ? "Stopp" : "Aufnahme"}</span>
                </button>
                {isRecording && (
                    <button className="btn" onClick={pauseRec}>
                        <span>⏸</span> <span>{isPaused ? "Fortsetzen" : "Pause"}</span>
                    </button>
                )}

                <button className="btn" onClick={() => document.getElementById("fileLoader").click()}>📁 Audio laden</button>
                <input id="fileLoader" type="file" accept="audio/*" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) transcribe(e.target.files[0]); }} />

                <button className="btn primary" onClick={evaluateAI}>✨ Auswerten</button>
                <button className="btn" onClick={saveProtocol} title="In der Ablage des Kunden speichern">💾 Speichern</button>
                <button className="btn ghost" onClick={exportMarkdown} title="Exportieren">⬇️</button>
                <button className="btn ghost" onClick={() => { loadRecList(); setShowSettings(true); }}>⚙️</button>
            </header>

            <div className="vol"><div style={{ width: volWidth }}></div></div>
            {statusMsg && <div className="status">{statusMsg}</div>}

            <main style={{ gridTemplateColumns: `${colW.left}px 14px 1fr 14px ${colW.right}px` }}>
                {/* LINKS */}
                <section className="col">
                    <div className="col-hd">👥 Teilnehmer <span className="count">{persons.length}</span></div>
                    <div className="col-body">
                        <div className="customer-box">
                            <label className="cust-lbl">👤 Kunde</label>
                            {customers.length > 0 ? (
                                <select className="cust-input" value={selectedCustomer.id} onChange={e => {
                                    const c = customers.find(x => x.id === e.target.value);
                                    setSelectedCustomer(c ? { id: c.id, name: customerLabel(c) } : { id: "", name: e.target.value });
                                }}>
                                    <option value="">— Kunde wählen —</option>
                                    {customers.map(c => <option key={c.id} value={c.id}>{customerLabel(c)}</option>)}
                                </select>
                            ) : (
                                <input className="cust-input" placeholder="Kundenname..." value={selectedCustomer.name} onChange={e => setSelectedCustomer({ id: "", name: e.target.value })} />
                            )}

                            <div className="ablage-box">
                                <label className="cust-lbl">🗂️ Ablage <span className="ablage-count">{savedProtocols.length}</span></label>
                                {(selectedCustomer.id || selectedCustomer.name) ? (
                                    savedProtocols.length ? savedProtocols.map(p => (
                                        <div className={"prot-row" + (p.id === currentProtocolId ? " active" : "")} key={p.id}>
                                            <button className="prot-open" onClick={() => openProtocol(p.id)} title="Protokoll laden">
                                                <span className="prot-title">{p.title}</span>
                                                <span className="prot-date">{new Date(p.meeting_date).toLocaleDateString("de-CH")}</span>
                                            </button>
                                            <button className="x" onClick={() => deleteProtocol(p.id, p.title)} title="Löschen">✕</button>
                                        </div>
                                    )) : <div className="prot-empty">Noch keine Protokolle abgelegt.</div>
                                ) : <div className="prot-empty">Kunde wählen, um die Ablage zu sehen.</div>}
                            </div>
                        </div>

                        {persons.map(p => (
                            <div className="person" key={p.id}>
                                <span className="dot" style={{ background: p.color }}></span>
                                <span className="name" contentEditable suppressContentEditableWarning onBlur={e => {
                                    p.name = e.target.textContent; setPersons([...persons]);
                                }}>{p.name}</span>
                                <button className="x" onClick={() => setPersons(persons.filter(x => x.id !== p.id))}>✕</button>
                            </div>
                        ))}

                        <div className="add-row">
                            <input placeholder="Name..." value={inputName} onChange={e => setInputName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setPersons([...persons, { id: "p_" + Date.now(), name: inputName, color: COLORS[persons.length % COLORS.length] }]); setInputName(""); } }} />
                            <button className="btn primary" onClick={() => { setPersons([...persons, { id: "p_" + Date.now(), name: inputName, color: COLORS[persons.length % COLORS.length] }]); setInputName(""); }}>+</button>
                        </div>

                        <div className="agenda-box">
                            <label className="agenda-lbl">📋 Traktandenliste</label>
                            <textarea id="agenda" rows="5" value={agenda} onChange={e => setAgenda(e.target.value)} placeholder="1. Begrüssung..." />
                        </div>
                    </div>
                </section>

                <div
                    className="col-resizer"
                    onMouseDown={startColDrag("left")}
                    onDoubleClick={resetCols}
                    title="Ziehen zum Verschieben · Doppelklick = Standardbreite"
                />

                {/* MITTE */}
                <section className="col">
                    <div className="col-hd">🎙️ Transkript <span className="count">{segments.length}</span></div>
                    <div id="speakerPanel">
                        {[...new Set(segments.map(s => s.speaker))].map(spk => (
                            <div className="sp-row" key={spk} style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 14px' }}>
                                <span className="av sm" style={{ background: speakerColor(spk), padding: '2px 6px', borderRadius: '4px', color: '#fff', fontSize: '11px' }}>{speakerLabel(spk).slice(0,2)}</span>
                                <button className="sp-play" onClick={() => previewSpeaker(spk)}>▶</button>
                                <select className="sp-assign" value={speakerMap[spk] || ""} onChange={e => setSpeakerMap({ ...speakerMap, [spk]: e.target.value })}>
                                    <option value="">Zuordnen...</option>
                                    {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                                <select className="sp-merge" value="" onChange={e => mergeSpeaker(spk, e.target.value)}>
                                    <option value="">Zusammenführen mit...</option>
                                    {[...new Set(segments.map(s => s.speaker))].filter(x => x !== spk).map(x => <option key={x} value={x}>{speakerLabel(x)}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>
                    <audio ref={previewAudioRef} style={{ display: "none" }} />
                    <div className="col-body">
                        {segments.some(s => s.preview) && (
                            <div style={{ fontSize: "12px", color: "var(--muted)", margin: "0 4px 10px", padding: "6px 10px", background: "var(--grad-soft)", borderRadius: "8px" }}>
                                👀 Live-Vorschau (grob) – die saubere Fassung mit korrekter Sprecher-Trennung kommt beim Stopp.
                            </div>
                        )}
                        {segments.map((seg, i) => (
                            <div className="seg" key={i} style={seg.preview ? { opacity: 0.6 } : undefined}>
                                <div className="av" style={{ background: speakerColor(seg.speaker) }}>{speakerLabel(seg.speaker).slice(0,1)}</div>
                                <div className="bubble">
                                    <div className="who"><span>{speakerLabel(seg.speaker)}</span> <span className="ts">{fmtTime(seg.start)}</span>{seg.preview && <span className="ts" style={{ fontStyle: "italic" }}>· Vorschau</span>}</div>
                                    <div className="txt" contentEditable suppressContentEditableWarning onBlur={e => setSegOverrides({ ...segOverrides, [seg.start]: e.target.textContent })}>{seg.text}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <div
                    className="col-resizer"
                    onMouseDown={startColDrag("right")}
                    onDoubleClick={resetCols}
                    title="Ziehen zum Verschieben · Doppelklick = Standardbreite"
                />

                {/* RECHTS */}
                <section className="col">
                    <div className="col-hd">📋 Ergebnis</div>
                    <div className="col-body">
                        <div className="sub-hd">📝 Zusammenfassung</div>
                        <textarea className="cust-input" rows="4" value={summaryText} onChange={e => setSummaryText(e.target.value)} />

                        {traktanden.map((t, i) => (
                            <div className="trakt" key={i} style={{ marginTop: '10px' }}>
                                <div className="trakt-t" style={{ fontWeight: 'bold' }}>{t.titel}</div>
                                <div className="trakt-c" contentEditable suppressContentEditableWarning onBlur={e => { t.inhalt = e.target.textContent; setTraktanden([...traktanden]); }}>{t.inhalt}</div>
                            </div>
                        ))}

                        <div className="sub-hd" style={{ marginTop: "15px" }}>✔️ Aufgaben</div>
                        {tasks.map((t, i) => (
                            <div className="item task" key={i}>
                                <div contentEditable suppressContentEditableWarning onBlur={e => { t.text = e.target.textContent; setTasks([...tasks]); }}>{t.text}</div>
                                <small style={{ color: '#6b7691' }}>Verantwortlich: {t.who} {t.due && `| Frist: ${t.due}`}</small>
                            </div>
                        ))}
                    </div>
                </section>
            </main>

            {/* MODAL EINSTELLUNGEN */}
            {showSettings && (
                <div className="modal-bg show">
                    <div className="modal">
                        <h2>Einstellungen</h2>
                        <div className="fld" style={{ fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.5 }}>
                            🇨🇭 Transkription: <b>Suisse Notes</b> (Schweizerdeutsch, Sprecher-Trennung) ·
                            KI-Auswertung: <b>Claude</b>. Die API-Schlüssel liegen serverseitig – hier nichts einzugeben.
                        </div>

                        <div className="fld">
                            <div className="rec-hd">
                                <label style={{ margin: 0 }}>🎙️ Lokale Aufnahmen</label>
                                <span className="rec-total">{recList.length} · {fmtSize(recList.reduce((s, r) => s + r.bytes, 0))}</span>
                            </div>
                            <div className="rec-list">
                                {recList.length ? recList.map(r => (
                                    <div className="rec-row" key={r.id}>
                                        <div className="rec-info">
                                            <span className="rec-date">{new Date(r.startedAt).toLocaleString("de-CH")}</span>
                                            <span className="rec-meta">
                                                {fmtSize(r.bytes)}
                                                {r.status !== "finalized" && <span className="rec-badge"> unvollständig</span>}
                                                {r.id === curRecIdRef.current && isRecording && <span className="rec-badge live"> läuft</span>}
                                            </span>
                                        </div>
                                        <button className="x dl" title="Audio als Datei herunterladen" onClick={() => downloadRecording(r.id)}>⬇️</button>
                                        <button className="x" title="Audio dieser Aufnahme löschen" onClick={() => deleteRecording(r.id)}>🗑️</button>
                                    </div>
                                )) : <div className="prot-empty">Keine lokalen Aufnahmen.</div>}
                            </div>
                            {recList.length > 0 && (
                                <button className="rec-clear-all" onClick={deleteAllRecordings}>🗑️ Alle Aufnahmen löschen</button>
                            )}
                            <div className="rec-hint">Aufnahmen liegen nur lokal in diesem Browser (nicht in der Cloud). Nach der Auswertung kannst du sie hier löschen, um Speicher freizugeben – Transkripte und in der Ablage gespeicherte Protokolle bleiben erhalten.</div>
                        </div>

                        <div className="modal-actions">
                            <button className="btn primary" onClick={() => { LS.set("gv_cfg", cfg); setShowSettings(false); }}>Speichern</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}