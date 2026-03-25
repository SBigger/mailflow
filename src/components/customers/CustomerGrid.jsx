import React, { useState, useContext } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search, Building2, UserRound, Phone, Mail,
  MapPin, ChevronDown, ChevronRight,
} from "lucide-react";
import { ThemeContext } from "@/Layout";

function CustomerCard({ customer, onSelect, isArtis, isLight, accent, border, textMuted, textMain, cardBg }) {
  const isPrivat  = customer.person_type === "privatperson";
  const isInaktiv = customer.aktiv === false;

  const adressParts = [customer.strasse, [customer.plz, customer.ort].filter(Boolean).join(" ")].filter(Boolean);

  return (
    <button
      onClick={() => onSelect(customer)}
      style={{
        background: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: "14px 16px",
        textAlign: "left",
        width: "100%",
        cursor: "pointer",
        opacity: isInaktiv ? 0.55 : 1,
        transition: "box-shadow 0.15s, border-color 0.15s, transform 0.1s",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
        boxSizing: "border-box",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = `0 4px 16px ${accent}33`;
        e.currentTarget.style.borderColor = accent + "88";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.borderColor = border;
        e.currentTarget.style.transform = "none";
      }}
    >
      {/* Header: Type + Kanton + Inaktiv */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            display: "flex", alignItems: "center", gap: 4,
            fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
            color: isPrivat ? accent : textMuted,
            background: isPrivat ? accent + "18" : border + "88",
            border: `1px solid ${isPrivat ? accent + "44" : border}`,
            borderRadius: 5, padding: "2px 7px",
          }}>
            {isPrivat
              ? <UserRound size={10} />
              : <Building2 size={10} />}
            {isPrivat ? "Privatperson" : "Unternehmen"}
          </span>

          {customer.kanton && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: textMuted,
              background: border + "66",
              borderRadius: 4, padding: "2px 6px",
            }}>
              {customer.kanton}
            </span>
          )}
        </div>

        {isInaktiv && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: "#ef4444",
            background: "#fee2e2", borderRadius: 4, padding: "2px 6px",
          }}>
            INAKTIV
          </span>
        )}
      </div>

      {/* Name */}
      <div style={{
        fontSize: 14, fontWeight: 700, color: textMain,
        lineHeight: 1.3,
        textDecoration: isInaktiv ? "line-through" : "none",
        overflow: "hidden", display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
      }}>
        {customer.company_name}
      </div>

      {/* Kontakt */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {customer.phone && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: textMuted }}>
            <Phone size={11} style={{ flexShrink: 0, color: accent }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {customer.phone}
            </span>
          </div>
        )}
        {customer.email && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: textMuted }}>
            <Mail size={11} style={{ flexShrink: 0, color: accent }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {customer.email}
            </span>
          </div>
        )}
        {adressParts.length > 0 && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: textMuted }}>
            <MapPin size={11} style={{ flexShrink: 0, marginTop: 1, color: accent }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {adressParts.join(", ")}
            </span>
          </div>
        )}
      </div>

      {/* Tags */}
      {customer.tags?.length > 0 && !isInaktiv && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
          {customer.tags.slice(0, 4).map(tag => (
            <span key={tag} style={{
              fontSize: 10, padding: "2px 7px", borderRadius: 8,
              background: accent + "14",
              color: accent,
              border: `1px solid ${accent}33`,
            }}>
              {tag}
            </span>
          ))}
          {customer.tags.length > 4 && (
            <span style={{ fontSize: 10, color: textMuted }}>+{customer.tags.length - 4}</span>
          )}
        </div>
      )}
    </button>
  );
}

export default function CustomerGrid({ customers, onSelect, personTypeFilter = "alle" }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const accent    = isArtis ? "#7a9b7f" : "#7c3aed";
  const border    = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.6)";
  const textMuted = isArtis ? "#8aaa8f" : isLight ? "#8080a0" : "#71717a";
  const textMain  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const cardBg    = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(30,30,34,0.9)";
  const pageBg    = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#18181b";

  const [search,      setSearch]      = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const typeFiltered = customers.filter(c => {
    if (c.ist_nebensteuerdomizil === true) return false;
    if (personTypeFilter === "privatperson") return c.person_type === "privatperson";
    if (personTypeFilter === "unternehmen")  return c.person_type === "unternehmen" || !c.person_type;
    return true;
  });

  const searchFiltered = typeFiltered.filter(c =>
    (c.company_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.phone        || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.email        || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.ort          || "").toLowerCase().includes(search.toLowerCase())
  );

  const active   = searchFiltered.filter(c => c.aktiv !== false);
  const inactive = searchFiltered.filter(c => c.aktiv === false);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: pageBg }}>

      {/* Suchleiste */}
      <div style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${border}`,
        background: cardBg,
      }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            color: textMuted, pointerEvents: "none",
          }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen nach Name, Telefon, E-Mail, Ort…"
            style={{
              width: "100%", paddingLeft: 32, paddingRight: 12,
              paddingTop: 7, paddingBottom: 7,
              border: `1px solid ${border}`,
              borderRadius: 8, fontSize: 13,
              background: isArtis ? "#f5f5f5" : isLight ? "#f0f0f8" : "rgba(24,24,27,0.6)",
              color: textMain,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: textMuted }}>
          {active.length} {active.length === 1 ? "Eintrag" : "Einträge"}
          {inactive.length > 0 && ` · ${inactive.length} inaktiv`}
        </div>
      </div>

      {/* Kacheln-Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {active.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: textMuted, fontSize: 13 }}>
            Keine Einträge gefunden
          </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 12,
        }}>
          {active.map(c => (
            <CustomerCard
              key={c.id}
              customer={c}
              onSelect={onSelect}
              isArtis={isArtis}
              isLight={isLight}
              accent={accent}
              border={border}
              textMuted={textMuted}
              textMain={textMain}
              cardBg={cardBg}
            />
          ))}
        </div>

        {/* Inaktive */}
        {inactive.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <button
              onClick={() => setShowInactive(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", cursor: "pointer",
                color: textMuted, fontSize: 12, fontWeight: 500,
                padding: "6px 4px", marginBottom: 8,
              }}
            >
              {showInactive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Inaktiv ({inactive.length})
            </button>
            {showInactive && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 12,
              }}>
                {inactive.map(c => (
                  <CustomerCard
                    key={c.id}
                    customer={c}
                    onSelect={onSelect}
                    isArtis={isArtis}
                    isLight={isLight}
                    accent={accent}
                    border={border}
                    textMuted={textMuted}
                    textMain={textMain}
                    cardBg={cardBg}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
