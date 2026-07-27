import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pen, Eraser, Trash2 } from "lucide-react";
import { bildRechteck } from "../lib/bildRechteck";

// ===========================================================================
// ZeichenFlaeche – die Markierebene über dem geteilten Bildschirm.
//
// ⚠️ DER GANZE TRICK LIEGT IM RECHTECK, nicht im Zeichnen.
//
// Das geteilte Bild liegt mit object-fit:contain in seiner Fläche, hat also
// fast immer schwarze Ränder – ein 16:9-Fenster zeigt einen 4:3-Bildschirm
// mit Balken links und rechts. Würde die Leinwand die GANZE Fläche abdecken,
// läge jede Markierung um die Balkenbreite daneben, und zwar bei jedem
// Gegenüber unterschiedlich weit.
//
// Deshalb rechnet videoRechteck() aus, wo das Bild tatsächlich liegt, und die
// Leinwand deckt exakt dieses Rechteck ab. Damit sind Leinwandkoordinaten und
// Bildkoordinaten dasselbe, und 0..1 bedeutet überall dieselbe Stelle im
// geteilten Bildschirm.
// ===========================================================================
// Das Ausrechnen selbst steht in lib/bildRechteck.js — als reine Funktion,
// damit es sich mit Zahlen nachprüfen lässt statt nur im Gespräch zu zweit.
function videoRechteck(container, video) {
  const cr = container.getBoundingClientRect();
  return bildRechteck(cr.width, cr.height, video?.videoWidth || 0, video?.videoHeight || 0);
}

function useVideoRechteck(containerRef, videoRef) {
  const [rechteck, setRechteck] = useState(null);
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const mess = () => {
      const r = videoRechteck(c, videoRef.current);
      if (r) setRechteck((alt) => (
        alt && alt.left === r.left && alt.top === r.top
          && alt.width === r.width && alt.height === r.height ? alt : r
      ));
    };
    mess();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(mess) : null;
    ro?.observe(c);
    // "resize" feuert, wenn der Teilende sein Fenster wechselt und sich damit
    // das Seitenverhältnis des geteilten Bildes ändert.
    const v = videoRef.current;
    v?.addEventListener("loadedmetadata", mess);
    v?.addEventListener("resize", mess);
    return () => {
      ro?.disconnect();
      v?.removeEventListener("loadedmetadata", mess);
      v?.removeEventListener("resize", mess);
    };
  }, [containerRef, videoRef]);
  return rechteck;
}

// Ein Strich. Zweimal gezeichnet: erst ein dunkler Saum, dann die Farbe.
// Ohne den Saum verschwindet Gelb auf einer weissen Tabelle und Blau auf
// einem dunklen Editor – und man weiss vorher nie, was geteilt wird.
function malen(ctx, punkte, br, hr, farbe, saum) {
  if (punkte.length === 0) return;
  ctx.strokeStyle = farbe;
  ctx.lineWidth = saum;
  ctx.beginPath();
  if (punkte.length === 1) {
    // Ein einzelner Klick ist ein Punkt, keine Linie.
    ctx.arc(punkte[0][0] * br, punkte[0][1] * hr, saum / 2, 0, Math.PI * 2);
    ctx.fillStyle = farbe;
    ctx.fill();
    return;
  }
  punkte.forEach(([x, y], i) => {
    const px = x * br;
    const py = y * hr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

export default function ZeichenFlaeche({
  t, containerRef, videoRef, striche, stiftAn, meineFarbe,
  onStart, onPunkt, onEnde,
}) {
  const canvasRef = useRef(null);
  const rechteck = useVideoRechteck(containerRef, videoRef);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !rechteck) return;
    // Auf hochauflösenden Bildschirmen sonst sichtbar verwaschene Linien.
    // Bei 3 wird die Leinwand riesig, ohne dass man es noch sieht – Deckel.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const br = rechteck.width;
    const hr = rechteck.height;
    cv.width = Math.max(1, Math.round(br * dpr));
    cv.height = Math.max(1, Math.round(hr * dpr));
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, br, hr);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Strichstärke am Bild, nicht am Fenster: In der schmalen Ansicht wäre
    // eine feste Pixelbreite plump, in der grossen dünn wie ein Haar.
    const stark = Math.max(2.5, br * 0.0035);
    for (const s of striche) {
      malen(ctx, s.punkte, br, hr, "rgba(0,0,0,.5)", stark + 3.5);
      malen(ctx, s.punkte, br, hr, s.farbe, stark);
    }
  }, [striche, rechteck]);

  // Bildschirmpunkt -> 0..1 im geteilten Bild. Weil die Leinwand genau auf
  // dem Bild liegt, genügt ihr eigenes Rechteck.
  const normiert = useCallback((e) => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  }, []);

  const zeichnetRef = useRef(false);
  const letzterRef = useRef(null);

  const runter = (e) => {
    if (!stiftAn) return;
    const p = normiert(e);
    if (!p) return;
    zeichnetRef.current = true;
    letzterRef.current = p;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* nicht überall vorhanden */ }
    onStart(p[0], p[1]);
  };

  const bewegt = (e) => {
    if (!zeichnetRef.current) return;
    const p = normiert(e);
    if (!p) return;
    // Winzige Bewegungen wegwerfen: Sie bringen kein sichtbares Ergebnis,
    // kosten aber Pakete und machen die Linie zittrig.
    const l = letzterRef.current;
    if (l && Math.abs(p[0] - l[0]) < 0.0015 && Math.abs(p[1] - l[1]) < 0.0015) return;
    letzterRef.current = p;
    onPunkt(p[0], p[1]);
  };

  const hoch = () => {
    if (!zeichnetRef.current) return;
    zeichnetRef.current = false;
    letzterRef.current = null;
    onEnde();
  };

  if (!rechteck) return null;

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={runter}
      onPointerMove={bewegt}
      onPointerUp={hoch}
      onPointerCancel={hoch}
      onPointerLeave={hoch}
      style={{
        position: "absolute",
        left: rechteck.left, top: rechteck.top,
        width: rechteck.width, height: rechteck.height,
        zIndex: 3,
        // Ausgeschaltet darf die Ebene nichts abfangen – sonst käme man an
        // nichts mehr heran, was darunter liegt.
        pointerEvents: stiftAn ? "auto" : "none",
        cursor: stiftAn ? "crosshair" : "default",
        touchAction: "none",   // sonst scrollt das Tablet statt zu zeichnen
        borderRadius: 4,
        boxShadow: stiftAn ? `inset 0 0 0 2px ${meineFarbe}` : "none",
      }}
    />
  );
}

// ===========================================================================
// MarkierLeiste – Stift, eigenes Radiergummi, alles löschen.
//
// Sitzt am geteilten Bild und NICHT in der Steuerleiste unten: Das Werkzeug
// gehört zu der Sache, auf die es wirkt, und die untere Leiste soll bei ihren
// sechs Bedienelementen bleiben (Designregel 6). Ausserdem gäbe es sonst
// einen Knopf, der die meiste Zeit nichts tut – markiert wird nur, solange
// jemand teilt.
// ===========================================================================
export function MarkierLeiste({ t, stiftAn, meineFarbe, onStift, onMeineWeg, onAlleWeg, darfAlle }) {
  return (
    <div style={{
      position: "absolute", top: 12, right: 12, zIndex: 6,
      display: "flex", alignItems: "center", gap: 4,
      background: "rgba(10,13,18,.72)", backdropFilter: "blur(14px)",
      border: `1px solid ${t.stageLine}`, borderRadius: 999, padding: 4,
    }}>
      <button
        onClick={onStift}
        aria-pressed={stiftAn}
        title={stiftAn ? "Stift weglegen" : "Auf dem geteilten Bild markieren"}
        style={{
          display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
          border: "none", borderRadius: 999, padding: "7px 13px",
          background: stiftAn ? meineFarbe : "transparent",
          color: stiftAn ? "#fff" : t.onStage,
          fontFamily: "inherit", fontSize: 12.5, fontWeight: 650,
          transition: "background .15s ease-out",
        }}
        onMouseEnter={(e) => { if (!stiftAn) e.currentTarget.style.background = t.stageHover; }}
        onMouseLeave={(e) => { if (!stiftAn) e.currentTarget.style.background = "transparent"; }}
      >
        {/* Der Farbpunkt sagt ohne Worte "das ist deine Farbe" – und zwar
            auch dann, wenn der Stift gerade nicht aktiv ist. */}
        <span style={{
          width: 11, height: 11, borderRadius: "50%", flexShrink: 0,
          background: meineFarbe,
          boxShadow: stiftAn ? "0 0 0 2px rgba(255,255,255,.85)" : "none",
        }} />
        <Pen size={14} /> Markieren
      </button>

      <LeistenKnopf t={t} icon={Eraser} titel="Meine Markierungen löschen" onClick={onMeineWeg} />
      {darfAlle && (
        <LeistenKnopf t={t} icon={Trash2} titel="Alle Markierungen löschen" onClick={onAlleWeg} />
      )}
    </div>
  );
}

function LeistenKnopf({ t, icon: Icon, titel, onClick }) {
  return (
    <button
      onClick={onClick}
      title={titel}
      aria-label={titel}
      style={{
        width: 32, height: 32, borderRadius: 999, border: "none",
        background: "transparent", color: t.onStageMuted, cursor: "pointer",
        display: "grid", placeItems: "center",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = t.stageHover; e.currentTarget.style.color = t.onStage; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.onStageMuted; }}
    >
      <Icon size={15} />
    </button>
  );
}
