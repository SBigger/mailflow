import React, { useCallback, useEffect, useRef, useState } from "react";
import { Video as Cam, VideoOff, Mic, MicOff, Volume2, Loader2 } from "lucide-react";
import { VM } from "../theme";

// ===========================================================================
// GreenRoom – Geräte prüfen, BEVOR jemand zusieht (Designregel 12).
//
// Läuft bewusst im normalen App-Theme, nicht auf der dunklen Bühne: Der
// Beitritt gehört sichtbar noch zu smartis, erst der Eintritt wechselt die
// Welt. Die Vorschau läuft über getUserMedia direkt – nicht über LiveKit,
// denn hier ist noch keine Verbindung aufgebaut und niemand hört mit.
// ===========================================================================
export default function GreenRoom({
  t, title, subtitle, joinLabel = "Beitreten", onJoin, busy,
  askName = false,        // Gäste tragen ihren Namen selbst ein
  defaultName = "",
  hint = "Noch sieht und hört Sie niemand.",
  brand = false,          // Artis-Zeile für die Gästeseite
}) {
  const [guestName, setGuestName] = useState(defaultName);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  // ⚠️ Laufnummer gegen verwaiste Kamerastreams: getUserMedia ist asynchron.
  // Wechselt man schnell das Gerät (oder läuft der Effekt doppelt — React
  // StrictMode tut das in der Entwicklung), kommt ein älterer Aufruf ZURÜCK,
  // nachdem längst aufgeräumt wurde. Ohne diese Prüfung bliebe dieser Stream
  // für immer offen: Das Kamera-Lämpchen brennt weiter, obwohl niemand
  // sendet — genau die Sorte Fehler, die Vertrauen kostet.
  const runRef = useRef(0);
  const deadRef = useRef(false);
  // Verweis auf startPreview, damit der Geräte-Wächter sie aufrufen kann,
  // ohne dass die beiden sich gegenseitig als Abhängigkeit brauchen.
  const startPreviewRef = useRef(null);

  const [devices, setDevices] = useState({ cams: [], mics: [], speakers: [] });
  const [sel, setSel] = useState({ cam: "", mic: "", speaker: "" });
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [level, setLevel] = useState(0);
  const [permError, setPermError] = useState(null);

  // Geräteliste einlesen. Bewusst als eigene Funktion: Sie läuft nicht nur
  // beim Öffnen, sondern auch, wenn sich später etwas ändert (siehe unten).
  const ladeGeraete = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        cams: list.filter((d) => d.kind === "videoinput"),
        mics: list.filter((d) => d.kind === "audioinput"),
        speakers: list.filter((d) => d.kind === "audiooutput"),
      });
      return list;
    } catch {
      return [];
    }
  }, []);

  // ⚠️ Geräte kommen und gehen (2026-07-27, Sascha: "mein Bluetooth-Kopfhörer
  // ist nicht integriert"): Wer sein Headset erst NACH dem Öffnen verbindet,
  // sah es vorher nie – die Liste wurde nur einmal gelesen. Der Browser meldet
  // solche Änderungen von sich aus; darauf hören wir jetzt.
  // Verschwindet das gerade gewählte Gerät (Headset ausgeschaltet), fallen
  // wir bewusst auf die Standardauswahl zurück, statt auf ein totes Gerät zu
  // zeigen und den Nutzer im Stillen ohne Ton dastehen zu lassen.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const beiWechsel = async () => {
      const list = await ladeGeraete();
      const gibtEs = (id, kind) => !id || list.some((d) => d.kind === kind && d.deviceId === id);
      setSel((s) => {
        const camWeg = !gibtEs(s.cam, "videoinput");
        const micWeg = !gibtEs(s.mic, "audioinput");
        const spkWeg = !gibtEs(s.speaker, "audiooutput");
        if (!camWeg && !micWeg && !spkWeg) return s;
        // Vorschau mit den verbliebenen Geräten neu aufbauen.
        setTimeout(() => startPreviewRef.current?.(camWeg ? "" : s.cam, micWeg ? "" : s.mic), 0);
        return { cam: camWeg ? "" : s.cam, mic: micWeg ? "" : s.mic, speaker: spkWeg ? "" : s.speaker };
      });
    };
    md.addEventListener("devicechange", beiWechsel);
    return () => md.removeEventListener("devicechange", beiWechsel);
  }, [ladeGeraete]);

  // ── Vorschau starten / bei Gerätewechsel neu aufbauen ──────────────────
  const startPreview = useCallback(async (camId, micId) => {
    const run = ++runRef.current;
    // Alten Stream immer zuerst stoppen, sonst bleibt die Kamera belegt und
    // das Lämpchen brennt weiter.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* egal */ } audioCtxRef.current = null; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: camId ? { deviceId: { exact: camId } } : true,
        audio: micId ? { deviceId: { exact: micId } } : true,
      });
      // Überholt worden oder Komponente weg? Dann diesen Stream sofort
      // schliessen, statt ihn liegen zu lassen.
      if (run !== runRef.current || deadRef.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPermError(null);

      // Gerätenamen sind erst NACH erteilter Berechtigung lesbar – deshalb
      // die Liste hier und nicht schon beim Laden holen.
      await ladeGeraete();
      setSel((s) => ({
        cam: s.cam || stream.getVideoTracks()[0]?.getSettings?.().deviceId || "",
        mic: s.mic || stream.getAudioTracks()[0]?.getSettings?.().deviceId || "",
        speaker: s.speaker,
      }));

      // Pegelmessung – zeigt dem Nutzer, dass das Mikrofon wirklich anliegt.
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          // Gehört diese Messschleife noch zum aktuellen Lauf? Sonst still
          // beenden – sie hinge sonst am schon geschlossenen Stream.
          if (run !== runRef.current || deadRef.current) return;
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
          setLevel(Math.min(1, peak / 60));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch { /* Pegel ist Komfort, kein Muss */ }
    } catch (e) {
      setPermError(
        e?.name === "NotAllowedError"
          ? "Kamera und Mikrofon sind blockiert. Bitte im Browser erlauben (Schloss-Symbol in der Adresszeile)."
          : "Kein Zugriff auf Kamera oder Mikrofon: " + (e?.message || "unbekannter Fehler"),
      );
    }
  }, []);

  useEffect(() => { startPreviewRef.current = startPreview; }, [startPreview]);

  useEffect(() => {
    deadRef.current = false;
    startPreview();
    return () => {
      deadRef.current = true;
      runRef.current++; // laufende getUserMedia-Aufrufe entwerten
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* egal */ } }
      if (streamRef.current) streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [startPreview]);

  // Kamera-/Mikro-Vorschalter wirken direkt auf die Vorschau-Tracks.
  useEffect(() => {
    streamRef.current?.getVideoTracks().forEach((tr) => { tr.enabled = camOn; });
  }, [camOn]);
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((tr) => { tr.enabled = micOn; });
  }, [micOn]);

  const pick = (kind, id) => {
    setSel((s) => ({ ...s, [kind]: id }));
    if (kind === "cam") startPreview(id, sel.mic);
    if (kind === "mic") startPreview(sel.cam, id);
  };

  const join = () => {
    // Vorschau-Stream freigeben – LiveKit macht gleich seinen eigenen auf.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    onJoin?.({ camOn, micOn, camId: sel.cam, micId: sel.mic, speakerId: sel.speaker, name: guestName.trim() });
  };

  const nameFehlt = askName && guestName.trim().length < 2;

  return (
    <div style={{
      minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 16, padding: "34px 24px", background: t.sunken,
    }}>
      {brand && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 2 }}>
          <span style={{
            width: 24, height: 24, borderRadius: 7, background: t.accentFill, color: "#fff",
            display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
          }}>A</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: t.textPrimary }}>Artis Treuhand</span>
        </div>
      )}

      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-.01em", color: t.textPrimary }}>
          {title}
        </h1>
        {subtitle && <p style={{ fontSize: 13, color: t.textMuted, margin: "5px 0 0" }}>{subtitle}</p>}
      </div>

      {/* Vorschau – gespiegelt, wie man sich selbst im Spiegel kennt */}
      <div style={{
        width: "100%", maxWidth: 560, aspectRatio: "16/9", borderRadius: VM.tileRadius,
        overflow: "hidden", position: "relative", background: "#1b2430",
        border: `1px solid ${t.borderSubtle}`,
      }}>
        <video
          ref={videoRef} autoPlay playsInline muted
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            transform: "scaleX(-1)", display: camOn ? "block" : "none",
          }}
        />
        {!camOn && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,.5)" }}>
            <VideoOff size={34} />
          </div>
        )}
      </div>

      {permError && (
        <div style={{
          maxWidth: 560, fontSize: 12.5, color: t.missed, background: t.missed + "14",
          border: `1px solid ${t.missed}44`, borderRadius: 11, padding: "10px 13px",
        }}>{permError}</div>
      )}

      {/* Pegel – zehn Balken, gefüllt nach Lautstärke */}
      <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 14 }} aria-label="Mikrofonpegel">
        {Array.from({ length: 10 }).map((_, i) => (
          <i key={i} style={{
            width: 4, height: "100%", borderRadius: 2, display: "block",
            background: micOn && level * 10 > i ? t.accentFill : t.borderSubtle,
            transition: "background .08s linear",
          }} />
        ))}
      </div>

      {/* Vorschalter + Gerätewahl */}
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", justifyContent: "center", width: "100%", maxWidth: 560 }}>
        <Toggle t={t} on={micOn} onClick={() => setMicOn((v) => !v)}
                icon={micOn ? Mic : MicOff} label={micOn ? "Mikro an" : "Mikro aus"} />
        <Toggle t={t} on={camOn} onClick={() => setCamOn((v) => !v)}
                icon={camOn ? Cam : VideoOff} label={camOn ? "Kamera an" : "Kamera aus"} />
      </div>

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", justifyContent: "center", width: "100%", maxWidth: 560 }}>
        <Picker t={t} icon={Cam} value={sel.cam} onChange={(v) => pick("cam", v)}
                items={devices.cams} fallback="Kamera" />
        <Picker t={t} icon={Mic} value={sel.mic} onChange={(v) => pick("mic", v)}
                items={devices.mics} fallback="Mikrofon" />
        {devices.speakers.length > 0 && (
          <Picker t={t} icon={Volume2} value={sel.speaker} onChange={(v) => pick("speaker", v)}
                  items={devices.speakers} fallback="Lautsprecher" />
        )}
      </div>

      {askName && (
        <input
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !nameFehlt && !busy) join(); }}
          placeholder="Ihr Name"
          aria-label="Ihr Name"
          autoFocus
          style={{
            width: "100%", maxWidth: 560, background: t.raised,
            border: `1px solid ${t.borderSubtle}`, borderRadius: 11,
            padding: "11px 13px", fontFamily: "inherit", fontSize: 13.5, color: t.textPrimary,
          }}
        />
      )}

      <button
        onClick={join}
        disabled={busy || nameFehlt}
        style={{
          width: "100%", maxWidth: 560, border: "none", borderRadius: 13, padding: 13,
          background: t.accentFill, color: "#fff", fontFamily: "inherit",
          fontSize: 14, fontWeight: 750, cursor: busy || nameFehlt ? "default" : "pointer",
          opacity: busy || nameFehlt ? .55 : 1, display: "flex", alignItems: "center",
          justifyContent: "center", gap: 8, transition: "filter .15s ease-out",
        }}
        onMouseEnter={(e) => { if (!busy && !nameFehlt) e.currentTarget.style.filter = "brightness(1.08)"; }}
        onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
      >
        {busy && <Loader2 size={16} style={{ animation: "vidSpin 1s linear infinite" }} />}
        {busy ? "Verbinde…" : joinLabel}
      </button>

      <p style={{ fontSize: 11, color: t.textMuted, margin: 0 }}>{hint}</p>
    </div>
  );
}

function Toggle({ t, on, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
        background: on ? t.accentSoft : t.missed + "14",
        border: `1px solid ${on ? t.accentFill + "55" : t.missed + "44"}`,
        color: on ? t.accent : t.missed,
        borderRadius: 11, padding: "9px 14px", fontFamily: "inherit",
        fontSize: 12.5, fontWeight: 650,
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

function Picker({ t, icon: Icon, value, onChange, items, fallback }) {
  return (
    <label style={{
      flex: 1, minWidth: 150, display: "flex", alignItems: "center", gap: 7,
      background: t.raised, border: `1px solid ${t.borderSubtle}`, borderRadius: 11,
      padding: "9px 11px", fontSize: 12, color: t.textSecondary, cursor: "pointer",
    }}>
      <Icon size={15} style={{ color: t.textMuted, flexShrink: 0 }} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1, minWidth: 0, border: "none", background: "transparent",
          font: "inherit", color: "inherit", cursor: "pointer", outline: "none",
        }}
      >
        {items.length === 0 && <option value="">{fallback} (Standard)</option>}
        {items.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${fallback} ${d.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
    </label>
  );
}
