import React, { useState, useEffect, useRef } from 'react';

// ════════════════════════════════════════════════════════════════
//  Constants & Initial States
// ════════════════════════════════════════════════════════════════
const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444", "#84cc16", "#f97316", "#14b8a6"];
const PROXY_BASE = "https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1";
const PROXY_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A";
const PROXY_ON = true;
const SUPA_REST = "https://uawgpxcihixqxqxxbjak.supabase.co/rest/v1";
const DB_NAME = "gv-protokoll";
const DB_VER = 1;
const CHUNK_MS = 15000;

const EVAL_SCHEMA = {
    type: "object",
    properties: {
        zusammenfassung: { type: "string" },
        traktanden: {
            type: "array", items: {
                type: "object",
                properties: { titel: { type: "string" }, inhalt: { type: "string" } },
                required: ["titel", "inhalt"], additionalProperties: false
            }
        },
        aufgaben: {
            type: "array", items: {
                type: "object",
                properties: { text: { type: "string" }, verantwortlich: { type: "string" }, frist: { type: "string" } },
                required: ["text", "verantwortlich", "frist"], additionalProperties: false
            }
        },
        beschluesse: {
            type: "array", items: {
                type: "object",
                properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false
            }
        }
    },
    required: ["zusammenfassung", "traktanden", "aufgaben", "beschluesse"], additionalProperties: false
};

// LocalStorage Helper
const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

export default function GvProtokoll() {
    // ════════════════════════════════════════════════════════════════
    //  State Definitions
    // ════════════════════════════════════════════════════════════════
    const [cfg, setCfg] = useState(() => LS.get("gv_cfg", { eleven: "", lang: "deu", claudeKey: "", claudeModel: "claude-opus-4-8", mic: "", liveInterval: 120 }));
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(() => LS.get("gv_customer", { id: "", name: "" }));
    const [persons, setPersons] = useState(() => LS.get("gv_persons", []));
    const [segments, setSegments] = useState(() => LS.get("gv_segments", []));
    const [speakerMap, setSpeakerMap] = useState(() => LS.get("gv_speakerMap", {}));
    const [tasks, setTasks] = useState([]);
    const [decisions, setDecisions] = useState([]);
    const [summaryText, setSummaryText] = useState("");
    const [traktanden, setTraktanden] = useState([]);
    const [agenda, setAgenda] = useState(() => LS.get("gv_agenda", ""));

    // UI states
    const [timerText, setTimerText] = useState("00:00");
    const [isRecording, setIsRecording] = useState(false);
    const [statusMsg, setStatusMsg] = useState("");
    const [recoveryItems, setRecoveryItems] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [mics, setMics] = useState([]);
    const [volWidth, setVolWidth] = useState("0%");

    // Settings Modal form states
    const [formEleven, setFormEleven] = useState(cfg.eleven);
    const [formLang, setFormLang] = useState(cfg.lang);
    const [formLive, setFormLive] = useState(cfg.liveInterval);
    const [formMic, setFormMic] = useState(cfg.mic);
    const [formClaudeKey, setFormClaudeKey] = useState(cfg.claudeKey);
    const [formClaudeModel, setFormClaudeModel] = useState(cfg.claudeModel);
    const [inputPersonName, setInputPersonName] = useState("");

    // Refs for tracking mutable background operations
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

    const curRecIdRef = useRef(null);
    const chunkSeqRef = useRef(0);
    const recMimeRef = useRef("");
    const pendingSavesRef = useRef([]);
    const recStartRef = useRef(0);
    const liveBusyRef = useRef(false);

    // ════════════════════════════════════════════════════════════════
    //  IndexedDB Core
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

    const dbChunksFor = async (recId) => {
        const all = await dbGetAll("chunks");
        return all.filter(c => c.recId === recId).sort((a, b) => a.seq - b.seq);
    };

    const dbDeleteRecording = async (recId) => {
        const all = await dbGetAll("chunks");
        for (const c of all) if (c.recId === recId) await dbDel("chunks", [recId, c.seq]);
        await dbDel("recordings", recId);
        refreshRecoveryBanner();
    };

    // ════════════════════════════════════════════════════════════════
    //  Effects & Loaders
    // ════════════════════════════════════════════════════════════════
    useEffect(() => {
        LS.set("gv_persons", persons);
        LS.set("gv_speakerMap", speakerMap);
    }, [persons, speakerMap]);

    useEffect(() => {
        LS.set("gv_agenda", agenda);
    }, [agenda]);

    useEffect(() => {
        LS.set("gv_customer", selectedCustomer);
    }, [selectedCustomer]);

    useEffect(() => {
        loadCustomers();
        refreshRecoveryBanner();
        refreshMics();
        loadFileConfig();

        if (navigator.mediaDevices) {
            navigator.mediaDevices.addEventListener("devicechange", refreshMics);
        }
        return () => {
            if (navigator.mediaDevices) navigator.mediaDevices.removeEventListener("devicechange", refreshMics);
            if (timerIntRef.current) clearInterval(timerIntRef.current);
            if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
            if (volRAFRef.current) cancelAnimationFrame(volRAFRef.current);
        };
    }, []);

    const mailflowToken = () => {
        try {
            const raw = localStorage.getItem("sb-uawgpxcihixqxqxxbjak-auth-token");
            if (!raw) return null;
            const j = JSON.parse(raw);
            return j.access_token || (j.currentSession && j.currentSession.access_token) || null;
        } catch (e) { return null; }
    };

    const loadCustomers = async () => {
        const tok = mailflowToken();
        if (!tok) return;
        try {
            const r = await fetch(SUPA_REST + "/customers?select=id,company_name,anrede,nachname,vorname,person_type,aktiv&order=company_name.asc",
                { headers: { apikey: PROXY_KEY, Authorization: "Bearer " + tok } });
            if (!r.ok) return;
            const data = await r.json();
            setCustomers(data.filter(c => c.aktiv !== false));
        } catch (e) { }
    };

    const loadFileConfig = async () => {
        try {
            const r = await fetch("./config.local.json", { cache: "no-store" });
            if (r.ok) {
                const j = await r.json();
                let ch = false;
                const map = {
                    eleven: (j.eleven !== undefined ? j.eleven : j.elevenlabs),
                    claudeKey: (j.claudeKey !== undefined ? j.claudeKey : j.claude),
                    claudeModel: j.claudeModel, lang: j.lang, mic: j.mic, liveInterval: j.liveInterval
                };
                const updatedCfg = { ...cfg };
                for (const k in map) {
                    if (map[k] !== undefined && map[k] !== "" && cfg[k] !== map[k]) {
                        updatedCfg[k] = map[k];
                        ch = true;
                    }
                }
                if (ch) {
                    setCfg(updatedCfg);
                    LS.set("gv_cfg", updatedCfg);
                }
            }
        } catch (e) { }
    };

    const refreshRecoveryBanner = async () => {
        try {
            const recs = await dbGetAll("recordings");
            const pending = recs.filter(r => r.status !== "finalized").sort((a, b) => b.startedAt - a.startedAt);
            const items = [];
            for (const r of pending) {
                const rows = await dbChunksFor(r.id);
                items.push({ id: r.id, startedAt: r.startedAt, chunkCount: rows.length, mimeType: r.mimeType });
            }
            setRecoveryItems(items);
        } catch (e) { }
    };

    const refreshMics = async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        try {
            const devs = await navigator.mediaDevices.enumerateDevices();
            setMics(devs.filter(d => d.kind === "audioinput"));
        } catch (e) { }
    };

    const requestMicAccess = async () => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            s.getTracks().forEach(t => t.stop());
            refreshMics();
        } catch (e) {
            setStatusMsg("Mikrofon-Zugriff verweigert: " + e.message);
        }
    };

    // ════════════════════════════════════════════════════════════════
    //  Helper Functions
    // ════════════════════════════════════════════════════════════════
    const fmtTime = (s) => {
        s = Math.floor(s || 0);
        const m = String(Math.floor(s / 60)).padStart(2, "0");
        return m + ":" + String(s % 60).padStart(2, "0");
    };

    const customerLabel = (c) => c.person_type === "privatperson" ? [c.anrede, c.nachname, c.vorname].filter(Boolean).join(" ").trim() : (c.company_name || "(ohne Name)");

    const speakerLabel = (spk) => {
        const pid = speakerMap[spk];
        const p = pid && persons.find(x => x.id === pid);
        return p ? p.name : ("Sprecher " + (parseInt(String(spk).replace(/\D/g, "")) + 1 || spk));
    };

    const speakerColor = (spk) => {
        const pid = speakerMap[spk];
        const p = pid && persons.find(x => x.id === pid);
        if (p) return p.color;
        const n = parseInt(String(spk).replace(/\D/g, "")) || 0;
        return COLORS[n % COLORS.length];
    };

    const rawSpkLabel = (spk) => "Sprecher " + (parseInt(String(spk).replace(/\D/g, "")) + 1 || spk);

    const distinctSpeakers = () => {
        const seen = new Set(), out = [];
        segments.forEach(s => { if (!seen.has(s.speaker)) { seen.add(s.speaker); out.push(s.speaker); } });
        return out;
    };

    const setLastAudio = (blob) => {
        if (lastAudioUrlRef.current) {
            try { URL.revokeObjectURL(lastAudioUrlRef.current); } catch (e) { }
        }
        if (blob) {
            try { lastAudioUrlRef.current = URL.createObjectURL(blob); } catch (e) { lastAudioUrlRef.current = null; }
        } else {
            lastAudioUrlRef.current = null;
        }
    };

    // ════════════════════════════════════════════════════════════════
    //  Recording Logic
    // ════════════════════════════════════════════════════════════════
    const startRec = async () => {
        if (!cfg.eleven && !PROXY_ON) {
            openSettingsModal();
            setStatusMsg("Bitte zuerst den ElevenLabs API-Key eintragen.");
            return;
        }
        try {
            const audio = { echoCancellation: true, noiseSuppression: true };
            if (cfg.mic) audio.deviceId = { exact: cfg.mic };
            const s = await navigator.mediaDevices.getUserMedia({ audio });
            streamRef.current = s;
            refreshMics();
        } catch (e) {
            setStatusMsg("Mikrofon-Zugriff verweigert/Gerät nicht verfügbar: " + e.message);
            return;
        }

        try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }

        recStartRef.current = Date.now();
        let pickedMime = "";
        for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
            if (MediaRecorder.isTypeSupported(m)) { pickedMime = m; break; }
        }
        recMimeRef.current = pickedMime;
        curRecIdRef.current = "rec_" + recStartRef.current;
        chunkSeqRef.current = 0;
        pendingSavesRef.current = [];

        try {
            await dbPut("recordings", { id: curRecIdRef.current, startedAt: recStartRef.current, status: "recording", mimeType: pickedMime });
        } catch (e) {
            setStatusMsg("⚠ Lokale Sicherung nicht möglich (" + e.message + ") – Aufnahme NICHT crash-sicher!");
        }

        mediaRecRef.current = new MediaRecorder(streamRef.current, { mimeType: pickedMime });
        mediaRecRef.current.ondataavailable = e => {
            if (!e.data || !e.data.size) return;
            const seq = chunkSeqRef.current++;
            const p = dbPut("chunks", { recId: curRecIdRef.current, seq, blob: e.data })
                .then(() => setStatusMsg(`🔴 Aufnahme läuft – 💾 ~${fmtTime(chunkSeqRef.current * (CHUNK_MS / 1000))} crash-sicher gespeichert.`))
                .catch(err => setStatusMsg("⚠ Chunk-Sicherung fehlgeschlagen: " + err.message));
            pendingSavesRef.current.push(p);
        };

        mediaRecRef.current.onstop = async () => {
            stopMeter();
            await Promise.allSettled(pendingSavesRef.current);
            try { await dbPut("recordings", { id: curRecIdRef.current, startedAt: recStartRef.current, status: "done", mimeType: recMimeRef.current }); } catch (e) { }
            await finalizeRecording(curRecIdRef.current);
        };

        mediaRecRef.current.start(CHUNK_MS);
        setIsRecording(true);
        timerIntRef.current = setInterval(() => setTimerText(fmtTime((Date.now() - recStartRef.current) / 1000)), 250);
        startMeter(streamRef.current);
        setStatusMsg("🔴 Aufnahme läuft – wird laufend lokal gesichert (crash-sicher).");

        if (cfg.liveInterval > 0) {
            if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
            liveTimerRef.current = setTimeout(liveTick, 45000);
        }
    };

    const liveTick = async () => {
        if (mediaRecRef.current?.state !== "recording") return;
        await liveTranscribe();
        if (cfg.liveInterval > 0) liveTimerRef.current = setTimeout(liveTick, cfg.liveInterval * 1000);
    };

    const liveTranscribe = async () => {
        if (liveBusyRef.current || !curRecIdRef.current) return;
        let rows;
        try { rows = await dbChunksFor(curRecIdRef.current); } catch (e) { return; }
        if (!rows.length) return;
        liveBusyRef.current = true;
        const blob = new Blob(rows.map(c => c.blob), { type: recMimeRef.current || "audio/webm" });
        try { await transcribe(blob, true); } catch (e) { }
        liveBusyRef.current = false;
    };

    const stopRec = () => {
        if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
        if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") mediaRecRef.current.stop();
        if (timerIntRef.current) clearInterval(timerIntRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        setIsRecording(false);
    };

    const startMeter = (s) => {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtxRef.current.createMediaStreamSource(s);
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 512;
        src.connect(analyserRef.current);
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);

        const loop = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteTimeDomainData(data);
            let sum = 0;
            for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
            const rms = Math.sqrt(sum / data.length);
            setVolWidth(Math.min(100, rms * 260) + "%");
            volRAFRef.current = requestAnimationFrame(loop);
        };
        volRAFRef.current = requestAnimationFrame(loop);
    };

    const stopMeter = () => {
        if (volRAFRef.current) cancelAnimationFrame(volRAFRef.current);
        if (audioCtxRef.current) audioCtxRef.current.close().catch(() => { });
        setVolWidth("0%");
    };

    const finalizeRecording = async (recId) => {
        const recs = await dbGetAll("recordings");
        const meta = recs.find(r => r.id === recId) || {};
        const rows = await dbChunksFor(recId);
        if (!rows.length) { setStatusMsg("Keine gesicherten Audiodaten gefunden."); return; }
        const blob = new Blob(rows.map(c => c.blob), { type: meta.mimeType || recMimeRef.current || "audio/webm" });
        setStatusMsg(`⏳ Gesicherte Aufnahme (${rows.length} Segmente) wird transkribiert …`);
        const ok = await transcribe(blob);
        if (ok) {
            try { await dbPut("recordings", { id: recId, startedAt: meta.startedAt || recStartRef.current, status: "finalized", mimeType: meta.mimeType || recMimeRef.current }); } catch (e) { }
        }
        refreshRecoveryBanner();
    };

    const downloadRecording = async (recId) => {
        const recs = await dbGetAll("recordings");
        const meta = recs.find(r => r.id === recId) || {};
        const rows = await dbChunksFor(recId);
        const blob = new Blob(rows.map(c => c.blob), { type: meta.mimeType || "audio/webm" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "GV-Aufnahme_" + new Date(meta.startedAt || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".webm";
        a.click();
    };

    // ════════════════════════════════════════════════════════════════
    //  Transcription & AI Evaluation
    // ════════════════════════════════════════════════════════════════
    const transcribe = async (blob, isLive = false) => {
        if (!cfg.eleven && !PROXY_ON) { openSettingsModal(); return false; }
        setStatusMsg(isLive ? "🟢 Zwischenstand wird transkribiert …" : "⏳ Transkribiere mit ElevenLabs (scribe_v2) … das kann je nach Länge etwas dauern.");
        const fd = new FormData();
        fd.append("file", blob, "aufnahme.webm");
        fd.append("model_id", "scribe_v2");
        fd.append("diarize", "true");
        fd.append("timestamps_granularity", "word");
        fd.append("tag_audio_events", "false");
        if (cfg.lang) fd.append("language_code", cfg.lang);

        try {
            const useProxy = PROXY_ON && !cfg.eleven;
            const res = useProxy
                ? await fetch(PROXY_BASE + "/gv-stt", { method: "POST", headers: { "Authorization": "Bearer " + PROXY_KEY, "apikey": PROXY_KEY }, body: fd })
                : await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": cfg.eleven }, body: fd });

            if (!res.ok) { const t = await res.text(); throw new Error("HTTP " + res.status + " " + t.slice(0, 300)); }
            const data = await res.json();
            const loadedSegments = wordsToSegments(data);
            setLastAudio(blob);
            setSegments(loadedSegments);
            LS.set("gv_segments", loadedSegments);

            if (isLive) {
                setStatusMsg(`🟢 Live-Transkript aktualisiert – ${loadedSegments.length} Abschnitte. Aufnahme läuft …`);
            } else {
                setStatusMsg(`✅ Transkript fertig – ${loadedSegments.length} Abschnitte erkannt.`);
                setTimeout(() => setStatusMsg(""), 9000);
            }
            return true;
        } catch (e) {
            if (isLive) setStatusMsg("⚠ Zwischen-Transkript momentan nicht möglich: " + e.message + " (Aufnahme läuft weiter)");
            else setStatusMsg("❌ Transkription fehlgeschlagen: " + e.message + " – Audio bleibt gesichert.");
            return false;
        }
    };

    const wordsToSegments = (data) => {
        const words = data.words || [];
        if (!words.length && data.text) { return [{ speaker: "speaker_0", text: data.text, start: 0, end: 0 }]; }
        const segs = [];
        let cur = null;
        for (const w of words) {
            if (w.type === "spacing") { if (cur) cur.text += (w.text || " "); continue; }
            const spk = w.speaker_id || "speaker_0";
            if (!cur || cur.speaker !== spk) {
                if (cur) cur.text = cur.text.trim().replace(/\s+/g, " ");
                cur = { speaker: spk, text: "", start: w.start || 0, end: w.end || 0 };
                segs.push(cur);
            }
            cur.text += (w.text || "") + " ";
            cur.end = w.end || cur.end;
        }
        segs.forEach(s => s.text = s.text.trim().replace(/\s+/g, " "));
        return segs.filter(s => s.text);
    };

    const previewSpeaker = (spk) => {
        if (!lastAudioUrlRef.current) return;
        const a = previewAudioRef.current;
        const seg = segments.find(s => s.speaker === spk);
        const start = (seg && seg.start) || 0;
        const go = () => { try { a.currentTime = start; } catch (e) { } a.play().catch(() => { }); };
        if (a.dataset.src === lastAudioUrlRef.current && a.readyState >= 1) { go(); }
        else { a.src = lastAudioUrlRef.current; a.dataset.src = lastAudioUrlRef.current; a.onloadedmetadata = () => { a.onloadedmetadata = null; go(); }; }
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        previewTimerRef.current = setTimeout(() => { try { a.pause(); } catch (e) { } }, 6000);
    };

    const mergeSpeaker = (from, to) => {
        if (!from || !to || from === to) return;
        const updated = segments.map(s => s.speaker === from ? { ...s, speaker: to } : s);
        const updatedMap = { ...speakerMap };
        delete updatedMap[from];
        setSpeakerMap(updatedMap);
        setSegments(updated);
        LS.set("gv_segments", updated);
    };

    const evaluateAI = async () => {
        if (!segments.length) { setStatusMsg("Noch kein Transkript zum Auswerten."); return; }
        if (!cfg.claudeKey && !PROXY_ON) { openSettingsModal(); setStatusMsg("Bitte Claude API-Key für die Auswertung eintragen."); return; }
        setStatusMsg("✨ Claude wertet aus (Traktanden, Zusammenfassung, Aufgaben, Beschlüsse) …");
        const transcriptPlain = segments.map(s => `${speakerLabel(s.speaker)}: ${s.text}`).join("\n");
        const sys = `Du bist Protokollführer einer Generalversammlung (Schweiz). Analysiere das Transkript und fülle das JSON-Schema aus. Schweizer Hochdeutsch, sachlich.
- zusammenfassung: 2-4 Sätze Gesamtüberblick.
- traktanden: Gliedere den besprochenen Inhalt in Abschnitte, jeder mit prägnantem TITEL und kurzer Zusammenfassung (inhalt). WENN unten eine Traktandenliste steht, verwende GENAU deren Titel und Reihenfolge (ein Eintrag pro Traktandum; nicht besprochene Punkte: inhalt=""). WENN keine Liste gegeben ist, leite selbst sinnvolle thematische Titel aus dem Gespräch ab.
- aufgaben: konkrete To-dos mit verantwortlicher Person (Name oder leer) und Frist (Datum/Termin oder leer).
- beschluesse: gefasste Beschlüsse, inkl. Abstimmungsergebnis falls genannt.
Leere Listen als [] zurückgeben.`;
        const usr = `Kunde/Mandant: ${selectedCustomer.name || "—"}\nTeilnehmer: ${persons.map(p => p.name).join(", ") || "unbekannt"}\n\nTRAKTANDENLISTE:\n${agenda || "(keine angegeben – bitte selbst sinnvoll gliedern)"}\n\nTRANSKRIPT:\n${transcriptPlain}`;

        try {
            const useProxyC = PROXY_ON && !cfg.claudeKey;
            const res = await fetch(useProxyC ? PROXY_BASE + "/gv-llm" : "https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: useProxyC
                    ? { "content-type": "application/json", "Authorization": "Bearer " + PROXY_KEY, "apikey": PROXY_KEY }
                    : { "content-type": "application/json", "x-api-key": cfg.claudeKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
                body: JSON.stringify({
                    model: cfg.claudeModel || "claude-opus-4-8",
                    max_tokens: 8000,
                    system: sys,
                    messages: [{ role: "user", content: usr }],
                    output_config: { format: { type: "json_schema", schema: EVAL_SCHEMA } }
                })
            });

            if (!res.ok) { const t = await res.text(); throw new Error("HTTP " + res.status + " " + t.slice(0, 300)); }
            const data = await res.json();
            if (data.stop_reason === "refusal") { throw new Error("Anfrage wurde von Claude abgelehnt."); }
            const block = (data.content || []).find(b => b.type === "text");
            if (!block) { throw new Error("Keine Textantwort erhalten."); }

            const obj = JSON.parse(block.text);
            setSummaryText(obj.zusammenfassung || "");
            setTraktanden((obj.traktanden || []).map(t => ({ titel: t.titel || "", inhalt: t.inhalt || "" })));
            setTasks((obj.aufgaben || []).map(t => ({ text: t.text || "", who: t.verantwortlich || "", due: t.frist || "" })));
            setDecisions((obj.beschluesse || []).map(d => ({ text: d.text || "" })));
            setStatusMsg("✅ Auswertung fertig.");
            setTimeout(() => setStatusMsg(""), 4000);
        } catch (e) {
            setStatusMsg("❌ Auswertung fehlgeschlagen: " + e.message);
        }
    };

    const exportMarkdown = () => {
        const d = new Date();
        let md = `# Protokoll Generalversammlung\n\n`;
        if (selectedCustomer.name) md += `**Kunde:** ${selectedCustomer.name}\n\n`;
        md += `**Teilnehmer:** ${persons.map(p => p.name).join(", ") || "—"}\n\n`;
        if (summaryText) md += `## Zusammenfassung\n\n${summaryText}\n\n`;
        if (traktanden?.length) { md += `## Traktanden\n\n`; traktanden.forEach((t, i) => { md += `### ${t.titel || ("Traktandum " + (i + 1))}\n\n${t.inhalt || "—"}\n\n`; }); }
        if (decisions.length) { md += `## Beschlüsse\n\n`; decisions.forEach(x => md += `- ${x.text}\n`); md += `\n`; }
        if (tasks.length) { md += `## Aufgaben\n\n`; tasks.forEach(t => md += `- ${t.text}${t.who ? ` _(${t.who}${t.due ? ", " + t.due : ""})_` : t.due ? ` _(${t.due})_` : ""}\n`); md += `\n`; }
        if (segments.length) { md += `## Transkript\n\n`; segments.forEach(s => md += `**${speakerLabel(s.speaker)}:** ${s.text}\n\n`); }

        const blob = new Blob([md], { type: "text/markdown" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const kdPrefix = selectedCustomer.name ? selectedCustomer.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" : "";
        a.download = `GV-Protokoll_${kdPrefix}${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.md`;
        a.click();
    };

    // ════════════════════════════════════════════════════════════════
    //  Form Actions
    // ════════════════════════════════════════════════════════════════
    const addPerson = () => {
        const name = inputPersonName.trim();
        if (!name) return;
        setPersons([...persons, { id: "p" + Date.now() + Math.floor(persons.length), name, color: COLORS[persons.length % COLORS.length] }]);
        setInputPersonName("");
    };

    const removePerson = (id) => {
        setPersons(persons.filter(x => x.id !== id));
        const updatedMap = { ...speakerMap };
        Object.keys(updatedMap).forEach(k => { if (updatedMap[k] === id) delete updatedMap[k]; });
        setSpeakerMap(updatedMap);
    };

    const openSettingsModal = () => {
        setFormEleven(cfg.eleven);
        setFormLang(cfg.lang);
        setFormLive(cfg.liveInterval);
        setFormMic(cfg.mic);
        setFormClaudeKey(cfg.claudeKey);
        setFormClaudeModel(cfg.claudeModel);
        refreshMics();
        setShowModal(true);
    };

    const saveSettings = () => {
        const newCfg = {
            eleven: formEleven.trim(), lang: formLang,
            claudeKey: formClaudeKey.trim(), claudeModel: formClaudeModel,
            mic: formMic, liveInterval: parseInt(formLive) || 0
        };
        setCfg(newCfg);
        LS.set("gv_cfg", newCfg);
        setShowModal(false);
        setStatusMsg("Einstellungen gespeichert.");
        setTimeout(() => setStatusMsg(""), 2500);
    };

    return (
        <>
            <style dangerouslySetInnerHTML={{ __html: `
        :root{
          --surface:#ffffff; --surface-2:#f3f5fb; --surface-3:#e9edf9;
          --border:#e7ebf4; --border-2:#dce2ef;
          --fg:#0e1525; --fg2:#3a4763; --muted:#6b7691;
          --accent:#6366f1; --accent-2:#8b5cf6;
          --grad:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
          --grad-soft:linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.12));
          --green:#10b981; --amber:#f59e0b; --red:#ef4444; --rose:#f43f5e; --violet:#8b5cf6;
          --shadow:0 14px 40px -18px rgba(30,41,59,.28);
          --shadow-sm:0 2px 10px -3px rgba(30,41,59,.15);
          --ring:0 0 0 3px rgba(99,102,241,.22);
        }
        .gv-body { margin:0; display:flex; flex-direction:column; min-height:100vh; color:var(--fg);
          font-family:"Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;
          background:
            radial-gradient(900px 520px at 100% -8%, rgba(139,92,246,.13), transparent 60%),
            radial-gradient(820px 520px at -8% 112%, rgba(99,102,241,.13), transparent 60%),
            linear-gradient(180deg,#f7f9ff 0%,#eef1fb 100%);
          background-attachment:fixed; height:100%;
        }
        .gv-body button{font-family:inherit;cursor:pointer}
        /* ── Topbar ───────────────────────────────── */
        header{display:flex; align-items:center; gap:11px; padding:12px 18px; position:sticky; top:0; z-index:10;
          background:rgba(255,255,255,.72); backdrop-filter:blur(14px) saturate(160%); border-bottom:1px solid var(--border)}
        header h1{font-size:18px; margin:0; font-weight:800; letter-spacing:-.2px; display:flex; align-items:center; gap:8px;
          background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent}
        header .sub{color:var(--muted); font-size:12px; font-weight:500}
        .spacer{flex:1}
        .btn{background:var(--surface); color:var(--fg2); border:1px solid var(--border-2); border-radius:11px;
          padding:9px 15px; font-size:13px; font-weight:600; display:inline-flex; align-items:center; gap:7px;
          box-shadow:var(--shadow-sm); transition:transform .12s,box-shadow .12s,background .12s,border-color .12s}
        .btn:hover{transform:translateY(-1px); box-shadow:var(--shadow); border-color:#cdd6ea}
        .btn:active{transform:translateY(0)}
        .btn.primary{background:var(--grad); border-color:transparent; color:#fff; box-shadow:0 10px 24px -10px rgba(99,102,241,.7)}
        .btn.primary:hover{filter:brightness(1.06)}
        .btn.rec{background:linear-gradient(135deg,#fb7185,#ef4444); border-color:transparent; color:#fff; box-shadow:0 10px 24px -10px rgba(239,68,68,.55)}
        .btn.rec:hover{filter:brightness(1.05)}
        .btn:disabled{opacity:.5; cursor:not-allowed; transform:none; box-shadow:none}
        .btn.ghost{background:transparent; border-color:transparent; box-shadow:none; color:var(--muted)}
        .btn.ghost:hover{background:var(--surface-2); transform:none; box-shadow:none; color:var(--fg)}
        .rec-dot{width:10px; height:10px; border-radius:50%; background:#fff; animation:pulse 1s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        .timer{font-variant-numeric:tabular-nums; font-size:15px; font-weight:700; color:var(--fg2); min-width:56px; text-align:center}
        /* ── Layout ───────────────────────────────── */
        main{flex:1; min-height:0; display:grid; grid-template-columns:270px 1fr 340px; gap:14px; padding:14px}
        .col{display:flex; flex-direction:column; min-height:0; background:var(--surface);
          border:1px solid var(--border); border-radius:18px; box-shadow:var(--shadow); overflow:hidden}
        .col-hd{padding:14px 16px; font-size:12px; font-weight:800; letter-spacing:.4px; text-transform:uppercase;
          color:var(--fg2); border-bottom:1px solid var(--border); display:flex; align-items:center; gap:8px;
          background:linear-gradient(180deg,#fff,#fbfcff)}
        .col-hd .count{margin-left:auto; background:var(--grad-soft); color:var(--accent); font-weight:800;
          border-radius:20px; padding:2px 10px; font-size:11px}
        .col-body{flex:1; overflow-y:auto; padding:14px}
        /* ── Kunde ────────────────────────────────── */
        .customer-box{margin-bottom:14px; padding-bottom:14px; border-bottom:1px solid var(--border)}
        .cust-lbl{display:block; font-size:12px; font-weight:700; color:var(--fg2); margin-bottom:7px}
        .cust-lbl span{font-weight:500; color:var(--muted)}
        .cust-input{width:100%; background:var(--surface-2); border:1px solid var(--border-2); border-radius:10px; color:var(--fg); padding:9px 11px; font-size:13px; outline:none}
        .cust-input:focus{border-color:var(--accent); box-shadow:var(--ring); background:#fff}
        /* ── Personen ─────────────────────────────── */
        .person{display:flex; align-items:center; gap:10px; padding:9px 11px; border-radius:12px; margin-bottom:7px;
          background:var(--surface-2); border:1px solid transparent; transition:.12s}
        .person:hover{background:#fff; border-color:var(--border-2); box-shadow:var(--shadow-sm)}
        .person .dot{width:14px; height:14px; border-radius:50%; flex-shrink:0; box-shadow:0 0 0 3px rgba(0,0,0,.04)}
        .person .name{flex:1; font-size:13.5px; font-weight:600; color:var(--fg); outline:none}
        .person .x{color:var(--muted); background:none; border:none; font-size:15px; padding:2px 6px; border-radius:7px}
        .person .x:hover{color:var(--rose); background:#ffe4ea}
        .add-row{display:flex; gap:7px; margin-top:10px}
        .add-row input{flex:1; background:var(--surface-2); border:1px solid var(--border-2); border-radius:10px;
          color:var(--fg); padding:9px 11px; font-size:13px; outline:none; transition:.12s}
        .add-row input:focus{border-color:var(--accent); box-shadow:var(--ring); background:#fff}
        .mini{font-size:11.5px; color:var(--muted); margin:12px 2px 4px; line-height:1.5}
        /* ── Transkript ───────────────────────────── */
        .seg{display:flex; gap:11px; margin-bottom:13px; animation:fade .25s}
        @keyframes fade{from{opacity:0; transform:translateY(5px)}to{opacity:1}}
        .seg .av{width:32px; height:32px; border-radius:50%; flex-shrink:0; display:flex; align-items:center;
          justify-content:center; font-size:12px; font-weight:800; color:#fff; box-shadow:0 4px 10px -3px rgba(0,0,0,.25)}
        .seg .bubble{flex:1; background:var(--surface-2); border:1px solid var(--border); border-radius:14px;
          border-top-left-radius:4px; padding:9px 13px}
        .seg .who{font-size:12px; font-weight:700; margin-bottom:3px; display:flex; align-items:center; gap:8px}
        .seg .who select{background:#fff; color:var(--fg2); border:1px solid var(--border-2);
          border-radius:7px; font-size:11px; padding:2px 6px; font-weight:600}
        .seg .who .ts{color:var(--muted); font-weight:500; font-size:11px}
        .seg .txt{font-size:14px; line-height:1.55; color:var(--fg2)}
        .empty{color:var(--muted); text-align:center; margin-top:36px; font-size:13.5px; line-height:1.7; padding:0 18px}
        .empty .big{font-size:30px; width:74px; height:74px; display:flex; align-items:center; justify-content:center;
          margin:0 auto 14px; border-radius:22px; background:var(--grad-soft); box-shadow:var(--shadow-sm)}
        /* Sprecher-Panel */
        #speakerPanel{border-bottom:1px solid var(--border); background:linear-gradient(180deg,#fbfcff,#f3f5fb); padding:12px 14px; max-height:34vh; overflow-y:auto}
        .sp-hd{font-size:11px; font-weight:800; letter-spacing:.4px; text-transform:uppercase; color:var(--fg2); margin-bottom:9px}
        .sp-hd .muted{font-weight:600; color:var(--muted)}
        .sp-row{display:flex; align-items:center; gap:8px; margin-bottom:7px}
        .av.sm{width:26px; height:26px; font-size:10px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; color:#fff}
        .sp-play{background:#fff; border:1px solid var(--border-2); color:var(--accent); border-radius:9px; width:30px; height:30px; flex-shrink:0; font-size:11px; box-shadow:var(--shadow-sm); transition:.12s}
        .sp-play:hover{background:var(--accent); color:#fff; border-color:transparent}
        .sp-assign{flex:1; min-width:90px; background:#fff; color:var(--fg); border:1px solid var(--border-2); border-radius:9px; font-size:12px; padding:6px 8px; font-weight:600; outline:none}
        .sp-assign:focus{border-color:var(--accent); box-shadow:var(--ring)}
        .sp-merge{background:var(--surface-2); color:var(--muted); border:1px solid var(--border-2); border-radius:9px; font-size:11px; padding:6px 7px; max-width:150px; outline:none}
        .vol{height:5px; background:var(--surface-3); overflow:hidden}
        .vol > div{height:100%; background:var(--grad); transition:width .1s}
        .status{padding:9px 16px; font-size:12.5px; font-weight:600; color:#b45309; background:#fff7ed; border-bottom:1px solid #fde7c8}
        .recovery{padding:9px 16px; font-size:12.5px; background:#f5f3ff; border-bottom:1px solid #ddd6fe; color:#6d28d9}
        .rec-row{display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:5px 0}
        .rec-row .btn{padding:6px 11px; font-size:12px}
        /* ── Aufgaben / Beschlüsse ────────────────── */
        .sub-hd{font-size:12.5px; font-weight:800; color:var(--fg); margin:6px 2px 9px; display:flex; align-items:center; gap:8px}
        .sub-hd .ic{width:22px; height:22px; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:12px}
        .item{background:var(--surface-2); border:1px solid var(--border); border-radius:12px; padding:10px 12px; margin-bottom:8px; font-size:13px; position:relative; transition:.12s}
        .item:hover{background:#fff; box-shadow:var(--shadow-sm)}
        .item .meta{font-size:11px; color:var(--muted); margin-top:6px; display:flex; gap:10px; flex-wrap:wrap}
        .item .meta b{color:var(--fg2); font-weight:700}
        .item .x{position:absolute; top:7px; right:8px; color:var(--muted); background:none; border:none; font-size:14px; border-radius:6px}
        .item .x:hover{color:var(--rose); background:#ffe4ea}
        .item.task{border-left:3px solid var(--amber)}
        .item.decision{border-left:3px solid var(--green)}
        .addmini{font-size:12.5px; font-weight:700; color:var(--accent); background:none; border:none; padding:4px 2px; margin-bottom:16px}
        .addmini:hover{text-decoration:underline}
        /* ── Traktandenliste (links) ──────────────── */
        .agenda-box{margin-top:16px; border-top:1px solid var(--border); padding-top:14px}
        .agenda-lbl{display:block; font-size:12px; font-weight:700; color:var(--fg2); margin-bottom:7px}
        .agenda-lbl span{font-weight:500; color:var(--muted)}
        #agenda{width:100%; background:var(--surface-2); border:1px solid var(--border-2); border-radius:10px; color:var(--fg);
          padding:9px 11px; font-size:12.5px; font-family:inherit; line-height:1.5; outline:none; resize:vertical; transition:.12s}
        #agenda:focus{border-color:var(--accent); box-shadow:var(--ring); background:#fff}
        /* ── Summary / Traktanden (rechts) ────────── */
        .summary-box{background:var(--grad-soft); border:1px solid #e0e3fb; border-radius:14px; padding:13px 14px;
          font-size:13.5px; line-height:1.6; color:var(--fg2); margin-bottom:14px; white-space:pre-wrap}
        .trakt{margin-bottom:10px; border:1px solid var(--border); border-radius:12px; overflow:hidden}
        .trakt-t{background:var(--grad-soft); color:var(--fg); font-weight:800; font-size:12.5px; padding:8px 12px}
        .trakt-c{padding:10px 12px; font-size:13px; line-height:1.55; color:var(--fg2); outline:none; white-space:pre-wrap}
        .trakt-c:empty::before{content:'(nicht besprochen)'; color:var(--muted)}
        /* ── Modal ────────────────────────────────── */
        .modal-bg{position:fixed; inset:0; background:rgba(15,21,37,.45); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; z-index:50; padding:18px}
        .modal{background:var(--surface); border:1px solid var(--border); border-radius:20px; width:540px; max-width:100%;
          max-height:90vh; overflow-y:auto; padding:24px; box-shadow:0 30px 80px -20px rgba(15,21,37,.5)}
        .modal h2{margin:0 0 4px; font-size:19px; font-weight:800; letter-spacing:-.2px}
        .modal p.hint{color:var(--muted); font-size:12.5px; margin:0 0 14px; line-height:1.55}
        .keystatus{display:flex; gap:8px; flex-wrap:wrap; margin:0 0 18px}
        .keychip{font-size:11.5px; font-weight:700; padding:4px 11px; border-radius:20px; display:inline-flex; align-items:center; gap:5px}
        .keychip.ok{background:#dcfce7; color:#15803d}
        .keychip.no{background:#fee2e2; color:#b91c1c}
        .fld{margin-bottom:15px}
        .fld label{display:block; font-size:12.5px; font-weight:600; color:var(--fg2); margin-bottom:6px}
        .fld input,.fld select{width:100%; background:var(--surface-2); border:1px solid var(--border-2); border-radius:11px;
          color:var(--fg); padding:11px 13px; font-size:13.5px; outline:none; transition:.12s}
        .fld input:focus,.fld select:focus{border-color:var(--accent); box-shadow:var(--ring); background:#fff}
        .fld small{display:block; color:var(--muted); font-size:11.5px; margin-top:5px; line-height:1.45}
        .divider{border:none; border-top:1px solid var(--border); margin:20px 0}
        .modal-actions{display:flex; justify-content:flex-end; gap:9px; margin-top:10px}
        a{color:var(--accent); font-weight:600; text-decoration:none}
        a:hover{text-decoration:underline}
      `}} />

            <div className="gv-body">
                <header>
                    <h1>🏛️ GV-Protokoll</h1>
                    <span className="sub">Aufnahme · Transkript · Beschlüsse</span>
                    <div className="spacer"></div>
                    <span className="timer">{timerText}</span>

                    <button
                        className={`btn ${isRecording ? "" : "rec"}`}
                        style={isRecording ? { background: "var(--amber)", borderColor: "var(--amber)" } : {}}
                        onClick={isRecording ? stopRec : startRec}
                    >
                        <span>{isRecording ? "■" : "●"}</span> <span>{isRecording ? "Stopp" : "Aufnahme"}</span>
                    </button>

                    <button className="btn" onClick={() => document.getElementById('fileInput').click()}>📁 Audio laden</button>
                    <input
                        type="file"
                        id="fileInput"
                        accept="audio/*,video/webm"
                        style={{ display: "none" }}
                        onChange={(e) => { if(e.target.files[0]) transcribe(e.target.files[0]); e.target.value = ""; }}
                    />
                    <button className="btn primary" onClick={evaluateAI}>✨ Auswerten</button>
                    <button className="btn ghost" title="Protokoll exportieren" onClick={exportMarkdown}>⬇️</button>
                    <button className="btn ghost" title="Einstellungen" onClick={openSettingsModal}>⚙️</button>
                </header>

                <div className="vol"><div style={{ width: volWidth }}></div></div>
                {statusMsg && <div className="status">{statusMsg}</div>}

                {recoveryItems.length > 0 && (
                    <div className="recovery">
                        {recoveryItems.map(r => (
                            <div className="rec-row" key={r.id}>
                                <span>💾 Gesicherte Aufnahme von <b>{new Date(r.startedAt).toLocaleString("de-CH")}</b> (~{fmtTime(r.chunkCount * (CHUNK_MS / 1000))}) – noch nicht ausgewertet.</span>
                                <button className="btn primary" onClick={() => finalizeRecording(r.id)}>Wiederherstellen & transkribieren</button>
                                <button className="btn" onClick={() => downloadRecording(r.id)}>⬇️ Audio sichern</button>
                                <button className="btn ghost" onClick={() => { if(confirm("Diese gesicherte Aufnahme endgültig löschen?")) dbDeleteRecording(r.id); }}>Verwerfen</button>
                            </div>
                        ))}
                    </div>
                )}

                <main>
                    {/* LINKS: Personen */}
                    <section className="col">
                        <div className="col-hd">👥 Teilnehmer <span className="count">{persons.length}</span></div>
                        <div className="col-body">
                            <div className="customer-box">
                                {customers.length > 0 ? (
                                    <>
                                        <label className="cust-lbl">👤 Kunde <span>({customers.length})</span></label>
                                        <select
                                            className="cust-input"
                                            value={selectedCustomer.id}
                                            onChange={(e) => {
                                                const c = customers.find(x => x.id === e.target.value);
                                                setSelectedCustomer(c ? { id: c.id, name: customerLabel(c) } : { id: "", name: "" });
                                            }}
                                        >
                                            <option value="">— Kunde wählen —</option>
                                            {customers.map(c => <option key={c.id} value={c.id}>{customerLabel(c)}</option>)}
                                        </select>
                                    </>
                                ) : (
                                    <>
                                        <label className="cust-lbl">👤 Kunde <span>(optional)</span></label>
                                        <input
                                            className="cust-input"
                                            placeholder="Kundenname"
                                            value={selectedCustomer.name || ""}
                                            onChange={(e) => setSelectedCustomer({ id: "", name: e.target.value })}
                                        />
                                    </>
                                )}
                            </div>

                            <div id="personList">
                                {persons.map(p => (
                                    <div className="person" key={p.id}>
                                        <span className="dot" style={{ background: p.color }}></span>
                                        <span
                                            className="name"
                                            contentEditable
                                            suppressContentEditableWarning
                                            spellCheck="false"
                                            onBlur={(e) => {
                                                const val = e.target.textContent.trim();
                                                if (val) setPersons(persons.map(x => x.id === p.id ? { ...x, name: val } : x));
                                            }}
                                        >{p.name}</span>
                                        <button className="x" title="Entfernen" onClick={() => removePerson(p.id)}>✕</button>
                                    </div>
                                ))}
                            </div>

                            <div className="add-row">
                                <input
                                    placeholder="Name"
                                    autoComplete="off"
                                    value={inputPersonName}
                                    onChange={(e) => setInputPersonName(e.target.value)}
                                    onKeyDown={(e) => { if(e.key === "Enter") addPerson(); }}
                                />
                                <button className="btn primary" onClick={addPerson}>+</button>
                            </div>
                            <div className="mini">Tipp: erst Teilnehmer erfassen, dann erkannte Sprecher in der Mitte zuordnen.</div>

                            <div className="agenda-box">
                                <label className="agenda-lbl">📋 Traktandenliste <span>(optional)</span></label>
                                <textarea
                                    id="agenda"
                                    rows="6"
                                    placeholder="1. Begrüssung&#10;2. Genehmigung Protokoll&#10;3. Jahresrechnung 2025&#10;4. Wahlen&#10;5. Verschiedenes"
                                    value={agenda}
                                    onChange={(e) => setAgenda(e.target.value)}
                                ></textarea>
                                <div className="mini">Wenn ausgefüllt, gliedert Claude die Zusammenfassung nach diesen Traktanden (gleiche Titel/Reihenfolge). Sonst macht Claude eigene Titel.</div>
                            </div>
                        </div>
                    </section>

                    {/* MITTE: Transkript */}
                    <section className="col">
                        <div className="col-hd">🎙️ Transkript <span className="count">{segments.length}</span></div>

                        {distinctSpeakers().length > 0 && (
                            <div id="speakerPanel">
                                <div className="sp-hd">🗣️ Sprecher zuordnen <span className="muted">({distinctSpeakers().length})</span></div>
                                {distinctSpeakers().map(spk => {
                                    const col = speakerColor(spk);
                                    const lbl = speakerLabel(spk);
                                    const initials = lbl.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                                    return (
                                        <div className="sp-row" key={spk}>
                                            <div className="av sm" style={{ background: col }}>{initials}</div>
                                            {lastAudioUrlRef.current && <button className="sp-play" title="Stimme anhören" onClick={() => previewSpeaker(spk)}>▶</button>}
                                            <select
                                                className="sp-assign"
                                                value={speakerMap[spk] || ""}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    const updated = { ...speakerMap };
                                                    if (v) updated[spk] = v; else delete updated[spk];
                                                    setSpeakerMap(updated);
                                                }}
                                            >
                                                <option value="">— {rawSpkLabel(spk)} —</option>
                                                {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                            </select>
                                            <select
                                                className="sp-merge"
                                                value=""
                                                onChange={(e) => mergeSpeaker(spk, e.target.value)}
                                            >
                                                <option value="">⇄ zusammenführen…</option>
                                                {distinctSpeakers().filter(o => o !== spk).map(o => <option key={o} value={o}>→ {speakerLabel(o)}</option>)}
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <audio ref={previewAudioRef} preload="metadata" style={{ display: "none" }}></audio>

                        <div className="col-body" id="transcript">
                            {segments.length === 0 ? (
                                <div className="empty">
                                    <span className="big">🎙️</span>
                                    Noch keine Aufnahme.<br />Auf <b>Aufnahme</b> klicken oder eine Audio-Datei laden.<br />
                                    ElevenLabs transkribiert und trennt die Sprecher automatisch.
                                </div>
                            ) : (
                                segments.map((seg, idx) => {
                                    const col = speakerColor(seg.speaker);
                                    const lbl = speakerLabel(seg.speaker);
                                    const initials = lbl.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                                    return (
                                        <div className="seg" key={idx}>
                                            <div className="av" style={{ background: col }}>{initials}</div>
                                            <div className="bubble">
                                                <div className="who">
                                                    <span style={{ color: col }}>{lbl}</span>
                                                    <select
                                                        value={speakerMap[seg.speaker] || ""}
                                                        onChange={(e) => {
                                                            const v = e.target.value;
                                                            const updated = { ...speakerMap };
                                                            if (v) updated[seg.speaker] = v; else delete updated[seg.speaker];
                                                            setSpeakerMap(updated);
                                                        }}
                                                    >
                                                        <option value="">— {rawSpkLabel(seg.speaker)} —</option>
                                                        {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                    </select>
                                                    <span className="ts">{fmtTime(seg.start)}</span>
                                                </div>
                                                <div className="txt">{seg.text}</div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </section>

                    {/* RECHTS: Aufgaben & Beschlüsse + Summary */}
                    <section className="col">
                        <div className="col-hd">📋 Ergebnis</div>
                        <div className="col-body">
                            <div className="sub-hd"><span className="ic" style={{ background: "#fef3c7", color: "#d97706" }}>📝</span> Zusammenfassung</div>
                            <div id="summaryWrap">
                                {summaryText || traktanden.length > 0 ? (
                                    <>
                                        {summaryText && (
                                            <div
                                                className="summary-box"
                                                contentEditable
                                                suppressContentEditableWarning
                                                spellCheck="false"
                                                onBlur={(e) => setSummaryText(e.target.textContent)}
                                            >{summaryText}</div>
                                        )}
                                        {traktanden.map((t, i) => (
                                            <div className="trakt" key={i}>
                                                <div className="trakt-t">{t.titel || `Traktandum ${i + 1}`}</div>
                                                <div
                                                    className="trakt-c"
                                                    contentEditable
                                                    suppressContentEditableWarning
                                                    spellCheck="false"
                                                    onBlur={(e) => {
                                                        const updated = [...traktanden];
                                                        if (updated[i]) updated[i].inhalt = e.target.textContent;
                                                        setTraktanden(updated);
                                                    }}
                                                >{t.inhalt}</div>
                                            </div>
                                        ))}
                                    </>
                                ) : (
                                    <div className="summary-box" style={{ color: "var(--muted)" }}>Noch keine Auswertung. Nach dem Transkript auf „✨ Auswerten" klicken.</div>
                                )}
                            </div>

                            <div className="sub-hd"><span className="ic" style={{ background: "#fef3c7", color: "#d97706" }}>✔️</span> Aufgaben</div>
                            <div id="taskList">
                                {tasks.map((t, i) => (
                                    <div className="item task" key={i}>
                                        <button className="x" onClick={() => setTasks(tasks.filter((_, idx) => idx !== i))}>✕</button>
                                        <div
                                            contentEditable
                                            suppressContentEditableWarning
                                            spellCheck="false"
                                            onBlur={(e) => {
                                                const updated = [...tasks];
                                                if (updated[i]) updated[i].text = e.target.textContent;
                                                setTasks(updated);
                                            }}
                                        >{t.text}</div>
                                        <div className="meta">
                                            {t.who && <span>👤 <b>{t.who}</b></span>}
                                            {t.due && <span>📅 <b>{t.due}</b></span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button className="addmini" onClick={() => setTasks([...tasks, { text: "Neue Aufgabe", who: "", due: "" }])}>+ Aufgabe hinzufügen</button>

                            <div className="sub-hd"><span className="ic" style={{ background: "#d1fae5", color: "#059669" }}>⚖️</span> Beschlüsse</div>
                            <div id="decisionList">
                                {decisions.map((d, i) => (
                                    <div className="item decision" key={i}>
                                        <button className="x" onClick={() => setDecisions(decisions.filter((_, idx) => idx !== i))}>✕</button>
                                        <div
                                            contentEditable
                                            suppressContentEditableWarning
                                            spellCheck="false"
                                            onBlur={(e) => {
                                                const updated = [...decisions];
                                                if (updated[i]) updated[i].text = e.target.textContent;
                                                setDecisions(updated);
                                            }}
                                        >{d.text}</div>
                                    </div>
                                ))}
                            </div>
                            <button className="addmini" onClick={() => setDecisions([...decisions, { text: "Neuer Beschluss" }])}>+ Beschluss hinzufügen</button>
                        </div>
                    </section>
                </main>

                {/* Settings Modal */}
                {showModal && (
                    <div className="modal-bg" onClick={(e) => { if(e.target.classList.contains('modal-bg')) setShowModal(false); }}>
                        <div className="modal">
                            <h2>Einstellungen</h2>
                            <p className="hint">Online (smartis.me) laufen die Anfragen über einen sicheren <b>Server-Proxy</b> – du brauchst <b>keine</b> Keys. Optional kannst du eigene Keys eintragen (z.&nbsp;B. lokal); sie bleiben nur in diesem Browser und überschreiben dann den Proxy.</p>

                            <div className="keystatus">
                                <span className={`keychip ${(formEleven || PROXY_ON) ? 'ok' : 'no'}`}>{formEleven ? '✓ eigener' : (PROXY_ON ? '✓ Server-Proxy' : '○ fehlt')} · ElevenLabs</span>
                                <span className={`keychip ${(formClaudeKey || PROXY_ON) ? 'ok' : 'no'}`}>{formClaudeKey ? '✓ eigener' : (PROXY_ON ? '✓ Server-Proxy' : '○ fehlt')} · Claude</span>
                            </div>

                            <div className="fld">
                                <label>ElevenLabs API-Key <span style={{ color: "var(--red)" }}>*</span> (Transkription)</label>
                                <input type="password" placeholder="sk_..." value={formEleven} onChange={(e) => setFormEleven(e.target.value)} />
                                <small>Modell: <b>scribe_v2</b> (beste Sprecher-Trennung). Key auf <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">elevenlabs.io</a>.</small>
                            </div>

                            <div className="fld">
                                <label>Sprache</label>
                                <select value={formLang} onChange={(e) => setFormLang(e.target.value)}>
                                    <option value="deu">Deutsch / Schweizerdeutsch (deu)</option>
                                    <option value="">Automatisch erkennen</option>
                                </select>
                                <small>Schweizerdeutsch wird über das Deutsch-Modell verarbeitet.</small>
                            </div>

                            <div className="fld">
                                <label>Laufende Zwischen-Transkription</label>
                                <select value={formLive} onChange={(e) => setFormLive(e.target.value)}>
                                    <option value="0">Aus (erst beim Stopp)</option>
                                    <option value="60">Jede Minute</option>
                                    <option value="120">Alle 2 Minuten</option>
                                    <option value="180">Alle 3 Minuten</option>
                                    <option value="300">Alle 5 Minuten</option>
                                </select>
                                <small>Zeigt das Transkript schon <b>während</b> der Aufnahme. Jede Aktualisierung transkribiert das Bisherige neu.</small>
                            </div>

                            <div className="fld">
                                <label>Mikrofon</label>
                                <select value={formMic} onChange={(e) => setFormMic(e.target.value)}>
                                    <option value="">Standard-Mikrofon</option>
                                    {mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label || "Mikrofon"}</option>)}
                                </select>
                                <button className="btn ghost" style={{ marginTop: "7px", fontSize: "12px" }} onClick={requestMicAccess}>🎤 Zugriff erlauben &amp; Geräte laden</button>
                                <small>Erst Zugriff erlauben, dann erscheinen alle Mikrofone mit Namen.</small>
                            </div>

                            <hr className="divider" />
                            <p className="hint" style={{ marginBottom: "12px" }}><b>KI-Auswertung</b> über <b>Claude (Anthropic)</b>.</p>

                            <div className="fld">
                                <label>Claude API-Key</label>
                                <input type="password" placeholder="sk-ant-..." value={formClaudeKey} onChange={(e) => setFormClaudeKey(e.target.value)} />
                                <small>Key auf <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.</small>
                            </div>

                            <div className="fld">
                                <label>Claude Modell</label>
                                <select value={formClaudeModel} onChange={(e) => setFormClaudeModel(e.target.value)}>
                                    <option value="claude-opus-4-8">Opus 4.8 (stärkste Qualität)</option>
                                    <option value="claude-sonnet-4-6">Sonnet 4.6 (schneller/günstiger)</option>
                                    <option value="claude-haiku-4-5">Haiku 4.5 (am günstigsten)</option>
                                </select>
                            </div>

                            <div className="modal-actions">
                                <button className="btn ghost" onClick={() => setShowModal(false)}>Abbrechen</button>
                                <button className="btn primary" onClick={saveSettings}>Speichern</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}