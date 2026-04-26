import React, { useContext, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, Building2, UserRound, ChevronDown, ChevronRight } from "lucide-react";
import { ThemeContext } from "@/Layout";

/**
 * Compact customer list for the profile-view sidebar.
 * Smaller than CustomerList.jsx: single-line rows, no tags, no footer new-button.
 * Expects `onSelect(customer)` to switch the selected customer.
 */
export default function CustomerMiniList({
  customers,
  selectedId,
  onSelect,
  personTypeFilter = "alle",
}) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const textMain   = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted  = isArtis ? "#6b826b" : isLight ? "#5a5a7a" : "#9090b8";
  const subtle     = isArtis ? "#8aaa8f" : isLight ? "#9090b8" : "#71717a";
  const borderColor= isArtis ? "#e0e8e0" : isLight ? "#e4e4ea" : "#3f3f46";
  const cardBg     = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.4)";
  const selBg      = isArtis ? "rgba(122,155,127,0.18)" : isLight ? "rgba(124,58,237,0.1)" : "rgba(124,58,237,0.18)";
  const selAccent  = isArtis ? "#7a9b7f" : "#7c3aed";
  const hoverBg    = isArtis ? "#edf2ed" : isLight ? "#ebebf4" : "rgba(63,63,70,0.4)";

  const [search, setSearch]             = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const typeFiltered = customers.filter(c => {
    if (c.ist_nebensteuerdomizil === true) return false;
    if (personTypeFilter === "alle") return true;
    if (personTypeFilter === "privatperson") return c.person_type === "privatperson";
    return c.person_type === "unternehmen" || !c.person_type;
  });

  const q = search.trim().toLowerCase();
  const searchFiltered = !q ? typeFiltered : typeFiltered.filter(c =>
    (c.company_name || "").toLowerCase().includes(q)
  );

  const active   = searchFiltered.filter(c => c.aktiv !== false);
  const inactive = searchFiltered.filter(c => c.aktiv === false);

  return (
    <div style={{ background: cardBg, borderRight: `1px solid ${borderColor}`, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${borderColor}` }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: subtle }} />
          <Input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen… (Ctrl+F)"
            style={{
              paddingLeft: 28, height: 30, fontSize: 12.5,
              background: isArtis ? "#f5f5f5" : isLight ? "#f0f0f8" : "rgba(24,24,27,0.6)",
              borderColor, color: textMain,
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 4px" }}>
        {active.map(c => (
          <Row key={c.id} c={c} selected={c.id === selectedId} onSelect={onSelect}
               textMain={textMain} textMuted={textMuted} subtle={subtle}
               selBg={selBg} selAccent={selAccent} hoverBg={hoverBg} isArtis={isArtis} />
        ))}

        {active.length === 0 && inactive.length === 0 && (
          <div style={{ textAlign: "center", padding: "24px 8px", fontSize: 12.5, color: subtle }}>
            {q ? "Keine Treffer." : "Keine Einträge."}
          </div>
        )}

        {inactive.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => setShowInactive(v => !v)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
                       background: "none", border: "none", cursor: "pointer", color: textMuted, fontSize: 11.5, fontWeight: 500 }}
            >
              {showInactive ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Inaktiv ({inactive.length})
            </button>
            {showInactive && inactive.map(c => (
              <Row key={c.id} c={c} selected={c.id === selectedId} onSelect={onSelect}
                   textMain={textMain} textMuted={textMuted} subtle={subtle}
                   selBg={selBg} selAccent={selAccent} hoverBg={hoverBg} isArtis={isArtis} inactive />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ c, selected, onSelect, textMain, textMuted, subtle, selBg, selAccent, hoverBg, isArtis, inactive }) {
  const isPrivat = c.person_type === "privatperson";
  return (
    <button
      onClick={() => onSelect(c)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8,
        padding: "7px 10px", borderRadius: 7, border: "none", cursor: "pointer",
        background: selected ? selBg : "transparent",
        borderLeft: `3px solid ${selected ? selAccent : "transparent"}`,
        textAlign: "left", marginBottom: 1,
        opacity: inactive ? 0.55 : 1,
        transition: "background .1s",
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = hoverBg; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      {isPrivat
        ? <UserRound size={13} style={{ color: selAccent, flexShrink: 0 }} />
        : <Building2 size={13} style={{ color: subtle, flexShrink: 0 }} />
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: selected ? 600 : 500, color: textMain,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textDecoration: inactive ? "line-through" : "none",
        }}>
          {c.company_name || "Ohne Name"}
        </div>
        {(c.kanton || c.ort) && (
          <div style={{ fontSize: 10.5, color: subtle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
            {[c.kanton, c.ort].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </button>
  );
}
