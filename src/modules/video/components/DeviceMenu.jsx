import React, { useEffect, useRef, useState } from "react";
import { Check, Mic, Video as Cam, Volume2 } from "lucide-react";
import { supportsBlur } from "../theme";

// ===========================================================================
// DeviceMenu – Geräte MITTEN im Gespräch wechseln.
//
// Sascha nach dem ersten Test: "dass man während dem gespräch mikrofon und
// kamera aktualisieren kann auf etwas anderes". Genau der Praxisfall: Man
// startet am Laptop-Mikrofon und setzt erst danach das Headset auf — bisher
// hätte man das Gespräch verlassen müssen.
//
// Bewusst als kleines Menü an den vorhandenen Knöpfen (Zahnrad-Pfeil), NICHT
// als siebter Knopf in der Leiste: Die Leiste soll übersichtlich bleiben.
// Dasselbe Muster benutzen Teams und Zoom.
//
// Die Liste wird bei jedem Öffnen NEU gelesen und horcht zusätzlich auf
// Gerätewechsel — ein Headset, das man während des Gesprächs einschaltet,
// muss sofort auftauchen.
// ===========================================================================
export default function DeviceMenu({ t, art, aktuell, onWaehlen, onClose }) {
  const [geraete, setGeraete] = useState({ mics: [], cams: [], speakers: [] });
  const boxRef = useRef(null);

  useEffect(() => {
    let weg = false;
    const lade = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (weg) return;
        setGeraete({
          mics: list.filter((d) => d.kind === "audioinput"),
          cams: list.filter((d) => d.kind === "videoinput"),
          speakers: list.filter((d) => d.kind === "audiooutput"),
        });
      } catch { /* ohne Liste bleibt das Menü leer */ }
    };
    lade();
    const md = navigator.mediaDevices;
    md?.addEventListener?.("devicechange", lade);
    return () => { weg = true; md?.removeEventListener?.("devicechange", lade); };
  }, []);

  // Klick daneben schliesst – sonst bleibt das Menü über dem Video kleben.
  useEffect(() => {
    const daneben = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose?.(); };
    const esc = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("mousedown", daneben);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", daneben);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const blur = supportsBlur();
  const gruppen = art === "audio"
    ? [
        { titel: "Mikrofon", kind: "audioinput", icon: Mic, items: geraete.mics },
        { titel: "Lautsprecher", kind: "audiooutput", icon: Volume2, items: geraete.speakers },
      ]
    : [{ titel: "Kamera", kind: "videoinput", icon: Cam, items: geraete.cams }];

  return (
    <div
      ref={boxRef}
      role="menu"
      style={{
        position: "absolute", bottom: "calc(100% + 10px)", left: 0, zIndex: 40,
        width: 296, maxHeight: 340, overflowY: "auto",
        background: blur ? "rgba(21,24,29,.92)" : "#15181D",
        ...(blur ? { backdropFilter: "blur(20px)" } : {}),
        border: `1px solid ${t.stageLine}`, borderRadius: 14,
        boxShadow: "0 20px 50px rgba(0,0,0,.5)", padding: 8,
        animation: "vidMenu .16s ease-out",
      }}
    >
      {gruppen.map((g, gi) => (
        <div key={g.kind} style={{ marginTop: gi ? 8 : 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 7, padding: "6px 9px 5px",
            fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em",
            textTransform: "uppercase", color: t.onStageMuted,
          }}>
            <g.icon size={12} /> {g.titel}
          </div>
          {g.items.length === 0 && (
            <div style={{ padding: "6px 10px 8px", fontSize: 11.5, color: t.onStageMuted }}>
              Kein Gerät gefunden.
            </div>
          )}
          {g.items.map((d) => {
            const gewaehlt = aktuell?.[g.kind] === d.deviceId;
            return (
              <button
                key={d.deviceId}
                role="menuitemradio"
                aria-checked={gewaehlt}
                onClick={() => { onWaehlen(g.kind, d.deviceId); onClose?.(); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 10px", borderRadius: 9, border: "none", cursor: "pointer",
                  background: gewaehlt ? t.accentFill + "33" : "transparent",
                  color: t.onStage, fontFamily: "inherit", fontSize: 12.5,
                  textAlign: "left", transition: "background .12s",
                }}
                onMouseEnter={(e) => { if (!gewaehlt) e.currentTarget.style.background = t.stageHover; }}
                onMouseLeave={(e) => { if (!gewaehlt) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ width: 15, flexShrink: 0, color: t.accentFill }}>
                  {gewaehlt && <Check size={15} />}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.label || "Gerät ohne Namen"}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
