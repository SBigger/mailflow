import React, { useState, useEffect, useRef, useMemo } from "react";
import { Search } from "lucide-react";

// ⌘K-Command-Palette: zentriertes Overlay, fuzzy-Filter, Tastatur-Navigation.
// commands: [{ id, icon, label, sub?, run() }], t = chartisTheme-Tokens.
export default function CommandPalette({ open, onClose, commands, t }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  useEffect(() => { setIdx(0); }, [q]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const arr = !s ? commands : commands.filter(c => (c.label + " " + (c.sub || "")).toLowerCase().includes(s));
    return arr.slice(0, 50);
  }, [q, commands]);

  if (!open) return null;
  const run = (c) => { onClose(); c?.run?.(); };
  const onKey = (e) => {
    if (e.key === "Escape") return onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(filtered[idx]); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 90, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}>
      <div onClick={e => e.stopPropagation()} onKeyDown={onKey} style={{ width: 560, maxWidth: "92vw", background: t.raised, borderRadius: 14, border: `1px solid ${t.borderStrong}`, boxShadow: t.shadow, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${t.borderSubtle}` }}>
          <Search style={{ width: 18, height: 18, color: t.textMuted, flexShrink: 0 }} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Suchen oder Aktion … (Direkt an, Anrufe, Mails …)"
            style={{ flex: 1, background: "transparent", outline: "none", border: "none", fontSize: 15, color: t.textPrimary }} />
          <span style={{ fontSize: 10, color: t.textMuted, border: `1px solid ${t.borderSubtle}`, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>Esc</span>
        </div>
        <div style={{ maxHeight: "52vh", overflowY: "auto", padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: t.textMuted }}>Nichts gefunden</div>
          ) : filtered.map((c, i) => (
            <button key={c.id} onMouseEnter={() => setIdx(i)} onClick={() => run(c)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "9px 11px", borderRadius: 9, textAlign: "left", background: i === idx ? t.accentSoft : "transparent", color: t.textPrimary, border: "none", cursor: "pointer" }}>
              {c.icon && <c.icon style={{ width: 17, height: 17, color: i === idx ? t.accent : t.textMuted, flexShrink: 0 }} />}
              <span style={{ flex: 1, fontSize: 14 }}>{c.label}</span>
              {c.sub && <span style={{ fontSize: 12, color: t.textMuted }}>{c.sub}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
