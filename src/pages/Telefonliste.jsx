import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { entities } from "@/api/supabaseClient";
import { Input } from "@/components/ui/input";
import {
  Search, Phone, Mail, User as UserIcon, Building2,
} from "lucide-react";
import { ThemeContext } from "@/Layout";
import CallNotePopup from "@/components/customers/CallNotePopup";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { useContainerWidth } from "@/components/layout/useContainerQuery";

/**
 * Telefonliste – Vollbild-Telefonbuch mit allen Kontakten:
 *   - Firmenkunden (mit Tel)
 *   - Privatpersonen (mit Tel)
 *   - Kontaktpersonen (aus contact_persons jsonb, mit Tel/Mail)
 *
 * Klick auf Telefonnummer → öffnet 'tel:'-URL → wird durch Teams (oder
 * Default Phone-App) übernommen.
 * Stift-Icon → 'Anrufen mit Notiz'-Popup wie bisher.
 */
export default function Telefonliste({ embedded = false, onOpen }) {
  const { theme } = useContext(ThemeContext);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [containerRef, containerWidth] = useContainerWidth();
  // Kartenliste auch im Widescreen-Panel, sobald es schmal ist (Container-
  // Query) -- unabhaengig vom Browser-Viewport, der bei einem Panel ja breit
  // sein kann, waehrend das Panel selbst schmal ist.
  const isNarrowPanel = embedded && containerWidth > 0 && containerWidth < 700;
  const showCards = isMobile || isNarrowPanel;
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const textMain    = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted   = isArtis ? "#6b826b" : isLight ? "#5a5a7a" : "#9090b8";
  const subtle      = isArtis ? "#8aaa8f" : isLight ? "#9090b8" : "#71717a";
  const borderColor = isArtis ? "#e0e8e0" : isLight ? "#e4e4ea" : "#3f3f46";
  const rowHover    = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "rgba(63,63,70,0.35)";
  const headerBg    = isArtis ? "#f7faf7" : isLight ? "#f7f7fb" : "rgba(30,30,34,0.9)";
  const cardBg      = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.4)";
  const pageBg      = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#2a2a2f";
  const accent      = isArtis ? "#4d6a50" : "#5b21b6";

  const [search, setSearch] = useState("");
  const [callPopup, setCallPopup] = useState(null);
  const searchRef = useRef(null);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn:  () => entities.Customer.list("company_name"),
  });

  // ── Zeilen aufbauen ──────────────────────────────────────────
  const rows = useMemo(() => {
    const out = [];
    for (const c of customers || []) {
      if (c.aktiv === false) continue;
      const isPrivat = c.person_type === "privatperson";

      if (isPrivat) {
        const fullName = [c.anrede, c.vorname, c.nachname || c.name]
          .filter(Boolean).join(" ").trim() || c.company_name || "";
        if (c.phone || c.email) {
          out.push({
            kind: "privat",
            customer: c,
            customerId: c.id,
            customerName: c.company_name || fullName,
            sortName: (c.nachname || c.name || c.vorname || c.company_name || "").toLowerCase(),
            name: fullName || c.company_name || "—",
            firma: "",
            role: "",
            phones: [c.phone].filter(Boolean),
            email: c.email || "",
          });
        }
      } else {
        // Firmenkunde – nur wenn Telefon oder Mail vorhanden
        if (c.phone || c.email) {
          out.push({
            kind: "firma",
            customer: c,
            customerId: c.id,
            customerName: c.company_name || "",
            sortName: (c.company_name || "").toLowerCase(),
            name: c.company_name || "—",
            firma: "",
            role: "",
            phones: [c.phone].filter(Boolean),
            email: c.email || "",
          });
        }
      }

      // Kontaktpersonen
      const cps = Array.isArray(c.contact_persons) ? c.contact_persons : [];
      for (let i = 0; i < cps.length; i++) {
        const cp = cps[i] || {};
        const phones = [];
        if (cp.phone)  phones.push(cp.phone);
        if (cp.phone2 && cp.phone2 !== cp.phone) phones.push(cp.phone2);
        if (phones.length === 0 && !cp.email) continue;
        const fullName = [cp.anrede, cp.vorname, cp.name].filter(Boolean).join(" ").trim();
        out.push({
          kind: "kontakt",
          customer: c,
          customerId: c.id,
          customerName: c.company_name || "",
          contactIdx: i,
          sortName: (cp.name || cp.vorname || "").toLowerCase(),
          name: fullName || "—",
          firma: c.company_name || "",
          role: cp.role || "",
          phones,
          email: cp.email || "",
        });
      }
    }
    return out;
  }, [customers]);

  // ── Suche ─────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = rows;
    if (q) {
      list = list.filter(r => {
        const hay = [r.name, r.firma, r.role, r.email, ...r.phones]
          .filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    return list.slice().sort((a, b) => {
      if (a.sortName !== b.sortName) return a.sortName.localeCompare(b.sortName);
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [rows, q]);

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

  const normalizePhone = (raw) => {
    if (!raw) return "";
    let s = String(raw).replace(/[\s.\-()/]/g, "");
    if (s.startsWith("+")) return s;
    if (s.startsWith("00")) return "+" + s.slice(2); // 0049… → +49…, 0041… → +41…
    if (s.startsWith("0")) return "+41" + s.slice(1);
    return s;
  };

  const formatPhoneDisplay = (raw) => {
    if (!raw) return "";
    const n = normalizePhone(raw);
    if (!n.startsWith("+41")) return raw;
    const rest = n.slice(3);
    if (rest.length === 9)
      return `+41 ${rest.slice(0,2)} ${rest.slice(2,5)} ${rest.slice(5,7)} ${rest.slice(7,9)}`;
    return n;
  };

  const callAndNote = (row, phoneRaw) => {
    setCallPopup({
      phone: phoneRaw,
      customerId: row.customerId,
      customerName: row.customerName,
      contactLabel: row.kind === "kontakt"
        ? row.name + (row.role ? " · " + row.role : "")
        : row.name,
    });
    const clean = normalizePhone(phoneRaw).replace(/[^\d+]/g, "");
    if (clean) setTimeout(() => { window.location.href = `tel:${clean}`; }, 80);
  };

  // Alphabetische Sections für Karten-Ansicht (Mobile oder schmales
  // Widescreen-Panel) — filtered ist bereits sortiert, linearer Durchlauf reicht.
  const sections = useMemo(() => {
    if (!showCards) return [];
    const out = [];
    let currentLetter = null;
    let currentRows = null;
    for (const r of filtered) {
      const letter = (r.sortName?.[0] || "#").toUpperCase();
      if (letter !== currentLetter) {
        currentRows = [];
        out.push({ letter, rows: currentRows });
        currentLetter = letter;
      }
      currentRows.push(r);
    }
    return out;
  }, [filtered, showCards]);

  return (
    <div ref={containerRef} style={{ height: "100%", display: "flex", flexDirection: "column", background: pageBg, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: showCards ? "8px 12px" : "10px 16px", borderBottom: `1px solid ${borderColor}`, background: cardBg, flexShrink: 0 }}>
        {!embedded && !isMobile && <h1 style={{ fontSize: 18, fontWeight: 600, color: textMain, margin: 0, flexShrink: 0 }}>Telefonliste</h1>}
        <div style={{ position: "relative", flex: 1, maxWidth: showCards ? "none" : 420 }}>
          <Search size={showCards ? 16 : 14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: subtle }} />
          <Input
            ref={searchRef}
            type="search"
            inputMode="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={showCards ? "Name, Firma, Nummer…" : "Suchen: Name, Firma, Telefon, E-Mail … (Ctrl+F)"}
            style={{ paddingLeft: showCards ? 36 : 32, height: isMobile ? 40 : 32, fontSize: isMobile ? 16 : 13, background: isArtis ? "#f5f5f5" : isLight ? "#f0f0f8" : "rgba(24,24,27,0.6)", borderColor, color: textMain }}
          />
        </div>
      </div>

      {/* Liste */}
      <div style={{ flex: 1, overflow: "auto", background: cardBg }}>
        {showCards ? (
          <MobileList
            sections={sections}
            isLoading={isLoading}
            q={q}
            filtered={filtered}
            textMain={textMain}
            textMuted={textMuted}
            subtle={subtle}
            borderColor={borderColor}
            headerBg={headerBg}
            accent={accent}
            onCall={callAndNote}
            onOpenCustomer={(r) => (embedded && onOpen) ? onOpen("kunden", { customerId: r.customerId }) : navigate("/Kunden")}
            formatPhoneDisplay={formatPhoneDisplay}
          />
        ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "26%" }} />
          </colgroup>
          <thead>
            <tr style={{ position: "sticky", top: 0, zIndex: 2, background: headerBg, borderBottom: `1px solid ${borderColor}` }}>
              <th style={thStyle}></th>
              <th style={{ ...thStyle, color: textMuted }}>Name</th>
              <th style={{ ...thStyle, color: textMuted }}>Firma / Funktion</th>
              <th style={{ ...thStyle, color: textMuted }}>Telefon</th>
              <th style={{ ...thStyle, color: textMuted }}>E-Mail</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: subtle, fontSize: 13 }}>Lädt…</td></tr>
            )}
            {!isLoading && filtered.map((r, idx) => {
              const key = r.kind + ":" + r.customerId + ":" + (r.contactIdx ?? "x") + ":" + idx;
              return (
                <tr
                  key={key}
                  style={{ cursor: "default" }}
                  onMouseEnter={e => { e.currentTarget.style.background = rowHover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ ...tdBase, borderBottomColor: borderColor, paddingLeft: 16 }}>
                    {r.kind === "firma"   && <Building2 size={14} style={{ color: subtle }} />}
                    {r.kind === "privat"  && <UserIcon  size={14} style={{ color: accent }} />}
                    {r.kind === "kontakt" && <UserIcon  size={14} style={{ color: subtle }} />}
                  </td>
                  <td style={{ ...tdBase, borderBottomColor: borderColor, color: textMain, fontWeight: 500 }}>
                    <button
                      type="button"
                      onClick={() => (embedded && onOpen) ? onOpen("kunden", { customerId: r.customerId }) : navigate("/Kunden")}
                      title="Zum Kunden-Profil"
                      style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: textMain, font: "inherit", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}
                      onMouseEnter={e => { e.currentTarget.style.color = accent; }}
                      onMouseLeave={e => { e.currentTarget.style.color = textMain; }}
                    >
                      {r.name}
                    </button>
                  </td>
                  <td style={{ ...tdBase, borderBottomColor: borderColor, color: textMuted }}>
                    {r.kind === "kontakt" ? (
                      <div style={{ minWidth: 0 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.firma}</div>
                        {r.role && <div style={{ fontSize: 11, color: subtle, overflow: "hidden", textOverflow: "ellipsis" }}>{r.role}</div>}
                      </div>
                    ) : r.kind === "privat" ? (
                      <span style={{ color: subtle }}>Privatperson</span>
                    ) : (
                      <span style={{ color: subtle }}>Firmenkunde</span>
                    )}
                  </td>
                  <td style={{ ...tdBase, borderBottomColor: borderColor }}>
                    {r.phones.length === 0 ? <span style={{ color: subtle }}>—</span> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {r.phones.map((p, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => callAndNote(r, p)}
                            title={`Anrufen & Notiz: ${formatPhoneDisplay(p)}`}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              background: "transparent", border: "none", padding: 0,
                              cursor: "pointer", color: textMuted, font: "inherit",
                              textAlign: "left", maxWidth: "100%",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = accent; }}
                            onMouseLeave={e => { e.currentTarget.style.color = textMuted; }}
                          >
                            <Phone size={11} style={{ color: "#10b981", flexShrink: 0 }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{formatPhoneDisplay(p)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdBase, borderBottomColor: borderColor, color: textMuted }}>
                    {r.email ? (
                      <a
                        href={`mailto:${r.email}`}
                        title={`E-Mail an ${r.email}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, color: textMuted, textDecoration: "none", maxWidth: "100%" }}
                        onMouseEnter={e => { e.currentTarget.style.color = accent; e.currentTarget.style.textDecoration = "underline"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = textMuted; e.currentTarget.style.textDecoration = "none"; }}
                      >
                        <Mail size={11} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</span>
                      </a>
                    ) : <span style={{ color: subtle }}>—</span>}
                  </td>
                </tr>
              );
            })}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 48, textAlign: "center", color: subtle, fontSize: 13 }}>
                  {q ? "Keine Treffer." : "Keine Einträge mit Telefon oder Mail."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </div>

      <CallNotePopup
        open={!!callPopup}
        onClose={() => setCallPopup(null)}
        phone={callPopup?.phone}
        customerId={callPopup?.customerId}
        customerName={callPopup?.customerName}
        contactLabel={callPopup?.contactLabel}
      />
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: ".08em",
  fontWeight: 700,
  padding: "8px 10px",
  whiteSpace: "nowrap",
};

const tdBase = {
  padding: "9px 10px",
  verticalAlign: "middle",
  borderBottom: "1px solid",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// Mobile-Kartenliste mit alphabetischen Section-Headern und 44×44 Call-Buttons.
// Zeilen-Tap öffnet den Kunden; Call-Button feuert tel: sofort und öffnet
// danach den CallNotePopup ("Notiz erfassen?"-Flow bleibt für Desktop identisch).
function MobileList({
  sections, isLoading, q, filtered,
  textMain, textMuted, subtle, borderColor, headerBg, accent,
  onCall, onOpenCustomer, formatPhoneDisplay,
}) {
  if (isLoading) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: subtle, fontSize: 14 }}>Lädt…</div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: subtle, fontSize: 14 }}>
        {q ? "Keine Treffer." : "Keine Einträge mit Telefon oder Mail."}
      </div>
    );
  }
  return (
    <div>
      {sections.map(({ letter, rows }) => (
        <section key={letter}>
          <div
            style={{
              position: "sticky", top: 0, zIndex: 1,
              background: headerBg, color: textMuted,
              fontSize: 11, fontWeight: 700, letterSpacing: ".08em",
              padding: "6px 16px", borderBottom: `1px solid ${borderColor}`,
              textTransform: "uppercase",
            }}
          >
            {letter}
          </div>
          {rows.map((r, idx) => {
            const key = r.kind + ":" + r.customerId + ":" + (r.contactIdx ?? "x") + ":" + idx;
            const subtitle = r.kind === "kontakt"
              ? [r.firma, r.role].filter(Boolean).join(" · ")
              : r.kind === "privat" ? "Privatperson" : "Firmenkunde";
            const KindIcon = r.kind === "firma" ? Building2 : UserIcon;
            const iconColor = r.kind === "privat" ? accent : subtle;
            return (
              <div
                key={key}
                onClick={() => onOpenCustomer(r)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px 10px 16px",
                  borderBottom: `1px solid ${borderColor}`,
                  minHeight: 60, cursor: "pointer",
                }}
              >
                <KindIcon size={20} style={{ color: iconColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: textMain, fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.name}
                  </div>
                  {subtitle && (
                    <div style={{ color: textMuted, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {subtitle}
                    </div>
                  )}
                  {r.phones[0] && (
                    <div style={{ color: subtle, fontSize: 12, marginTop: 2, whiteSpace: "nowrap" }}>
                      {formatPhoneDisplay(r.phones[0])}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                  {r.phones.slice(0, 2).map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onCall(r, p); }}
                      aria-label={`Anrufen ${formatPhoneDisplay(p)}`}
                      style={{
                        width: 44, height: 44, borderRadius: 22,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(16,185,129,0.12)",
                        border: "1px solid rgba(16,185,129,0.28)",
                        cursor: "pointer",
                      }}
                    >
                      <Phone size={18} style={{ color: "#10b981" }} />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
