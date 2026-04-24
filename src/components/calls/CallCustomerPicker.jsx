import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, RotateCcw, Check } from "lucide-react";
import { ThemeContext } from "@/Layout";

/**
 * Popover/Dropdown zum manuellen Zuordnen eines Anrufs zu einem Kunden.
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - anchorRect: DOMRect | null   – Ankerposition (für Positionierung)
 *  - customers: [{ id, company_name, vorname, name }]
 *  - currentCustomerId: string | null
 *  - isManual: boolean            – ist der aktuelle Zustand manuell?
 *  - onAssign: (customerId: string) => Promise<void>
 *  - onClear:  () => Promise<void>   – "kein Kunde" (manuell)
 *  - onReset:  () => Promise<void>   – Auto-Zuordnung wiederherstellen
 */
export default function CallCustomerPicker({
  open, onClose, anchorRect,
  customers, currentCustomerId, isManual,
  onAssign, onClear, onReset,
}) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const bg        = isLight ? "#ffffff" : isArtis ? "#ffffff" : "#27272a";
  const border    = isLight ? "#e4e4ea" : isArtis ? "#d0dcd0" : "#3f3f46";
  const text      = isLight ? "#1a1a2e" : isArtis ? "#1a3a1a" : "#e4e4e7";
  const mutedCol  = isLight ? "#7a7a95" : isArtis ? "#6b826b" : "#a1a1aa";
  const hover     = isLight ? "#f4f4fa" : isArtis ? "#eaf0ea" : "rgba(63,63,70,0.35)";
  const accent    = isArtis ? "#5b8a5b" : isLight ? "#5b21b6" : "#a78bfa";

  const [q, setQ] = useState("");
  const inputRef  = useRef(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // ESC zum Schließen
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = customers.slice().sort((a, b) => {
      const la = (a.company_name || `${a.vorname || ""} ${a.name || ""}`).toLowerCase();
      const lb = (b.company_name || `${b.vorname || ""} ${b.name || ""}`).toLowerCase();
      return la.localeCompare(lb);
    });
    if (!s) return list.slice(0, 40);
    return list.filter(c => {
      const hay = [c.company_name, c.vorname, c.name].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(s);
    }).slice(0, 80);
  }, [customers, q]);

  if (!open) return null;

  // Positionierung direkt unter Anchor, rechtsbündig
  const POP_W = 320;
  const POP_MAX_H = 420;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r  = anchorRect;
  let left = r ? Math.min(r.right - POP_W, vw - POP_W - 8) : Math.max(8, vw / 2 - POP_W / 2);
  left = Math.max(8, left);
  let top  = r ? r.bottom + 6 : 80;
  // Wenn unten zu wenig Platz → nach oben
  if (top + POP_MAX_H > vh - 8 && r) {
    top = Math.max(8, r.top - POP_MAX_H - 6);
  }

  return createPortal(
    <>
      {/* Backdrop (klick = schließen) */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9998, background: "transparent",
        }}
      />
      <div
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed", top, left,
          width: POP_W, maxHeight: POP_MAX_H,
          background: bg, border: `1px solid ${border}`,
          borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          zIndex: 9999,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px", borderBottom: `1px solid ${border}`,
        }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: mutedCol }} />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Kunde suchen …"
              style={{
                width: "100%", padding: "6px 8px 6px 26px",
                fontSize: 12.5, borderRadius: 7,
                border: `1px solid ${border}`, outline: "none",
                background: bg, color: text,
              }}
            />
          </div>
          <button
            onClick={onClose}
            title="Schließen"
            style={{
              border: "none", background: "transparent", cursor: "pointer",
              color: mutedCol, padding: 4, borderRadius: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = hover}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
          >
            <X size={14} />
          </button>
        </div>

        {/* Actions */}
        <div style={{ padding: "6px 8px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: `1px solid ${border}` }}>
          {currentCustomerId && (
            <button
              onClick={async () => { await onClear(); onClose(); }}
              style={actionBtn(mutedCol, border, bg, hover)}
              title="Diesen Anruf als 'kein Kunde' markieren (manuell)"
            >
              <X size={11} /> Kein Kunde
            </button>
          )}
          {isManual && (
            <button
              onClick={async () => { await onReset(); onClose(); }}
              style={actionBtn("#8a5a00", border, bg, hover)}
              title="Manuelle Zuordnung aufheben – Auto-Matching greift wieder"
            >
              <RotateCcw size={11} /> Auto wiederherstellen
            </button>
          )}
        </div>

        {/* Liste */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: mutedCol, textAlign: "center" }}>
              Keine Treffer
            </div>
          )}
          {filtered.map(c => {
            const label = c.company_name || `${c.vorname || ""} ${c.name || ""}`.trim() || "—";
            const subtitle = c.company_name
              ? `${c.vorname || ""} ${c.name || ""}`.trim()
              : "";
            const isCurrent = c.id === currentCustomerId;
            return (
              <button
                key={c.id}
                onClick={async () => { await onAssign(c.id); onClose(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", textAlign: "left",
                  padding: "8px 10px",
                  border: "none", background: isCurrent ? hover : "transparent",
                  cursor: "pointer",
                  borderBottom: `1px solid ${border}`,
                  color: text,
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = hover}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = isCurrent ? hover : "transparent"}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}
                  </div>
                  {subtitle && (
                    <div style={{ fontSize: 10.5, color: mutedCol, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {subtitle}
                    </div>
                  )}
                </div>
                {isCurrent && <Check size={12} style={{ color: accent, flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </>,
    document.body
  );
}

function actionBtn(color, border, bg, hover) {
  return {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "4px 8px", fontSize: 11, fontWeight: 600,
    border: `1px solid ${border}`, background: bg, color,
    borderRadius: 6, cursor: "pointer",
  };
}
