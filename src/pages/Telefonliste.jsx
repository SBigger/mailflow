import React, { useContext, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { entities } from "@/api/supabaseClient";
import { Input } from "@/components/ui/input";
import {
  Search, Phone, Mail, User as UserIcon, Building2, StickyNote,
} from "lucide-react";
import { ThemeContext } from "@/Layout";
import CallNotePopup from "@/components/customers/CallNotePopup";

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
export default function Telefonliste() {
  const { theme } = useContext(ThemeContext);
  const navigate = useNavigate();
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
  const [filterKind, setFilterKind] = useState("alle"); // alle | firma | privat | kontakt
  const [callPopup, setCallPopup] = useState(null);

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

  // ── Filter + Suche ────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = rows;
    if (filterKind !== "alle") list = list.filter(r => r.kind === filterKind);
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
  }, [rows, q, filterKind]);

  // Stats für Filter-Buttons
  const counts = useMemo(() => {
    const c = { alle: rows.length, firma: 0, privat: 0, kontakt: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);

  const dialTel = (phoneRaw) => {
    const clean = String(phoneRaw || "").replace(/[^\d+]/g, "");
    if (!clean) return;
    window.location.href = `tel:${clean}`;
  };

  const filterBtn = (key, label) => {
    const active = filterKind === key;
    return (
      <button
        key={key}
        onClick={() => setFilterKind(key)}
        style={{
          backgroundColor: active ? accent : "transparent",
          color: active ? "#fff" : textMuted,
          fontSize: 11,
          padding: "3px 10px",
          borderRadius: 6,
          border: "none",
          cursor: "pointer",
          fontWeight: 500,
          transition: "all 0.15s",
        }}
      >
        {label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{counts[key]}</span>
      </button>
    );
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: pageBg, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${borderColor}`, background: cardBg, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: textMain, margin: 0 }}>Telefonliste</h1>
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 8, background: isArtis ? "rgba(0,0,0,0.04)" : isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.05)" }}>
          {filterBtn("alle",    "Alle")}
          {filterBtn("firma",   "Firmen")}
          {filterBtn("privat",  "Privat")}
          {filterBtn("kontakt", "Kontakte")}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative", width: 320 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: subtle }} />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen: Name, Firma, Telefon, E-Mail …"
            style={{ paddingLeft: 32, height: 32, fontSize: 13, background: isArtis ? "#f5f5f5" : isLight ? "#f0f0f8" : "rgba(24,24,27,0.6)", borderColor, color: textMain }}
          />
        </div>
      </div>

      {/* Liste */}
      <div style={{ flex: 1, overflow: "auto", background: cardBg }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr style={{ position: "sticky", top: 0, zIndex: 2, background: headerBg, borderBottom: `1px solid ${borderColor}` }}>
              <th style={thStyle}></th>
              <th style={{ ...thStyle, color: textMuted }}>Name</th>
              <th style={{ ...thStyle, color: textMuted }}>Firma / Funktion</th>
              <th style={{ ...thStyle, color: textMuted }}>Telefon</th>
              <th style={{ ...thStyle, color: textMuted }}>E-Mail</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: subtle, fontSize: 13 }}>Lädt…</td></tr>
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
                      onClick={() => navigate("/Kunden")}
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
                            onClick={() => dialTel(p)}
                            title={`Anrufen via Teams: ${p}`}
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
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p}</span>
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
                  <td style={{ ...tdBase, borderBottomColor: borderColor, paddingRight: 12, textAlign: "right" }}>
                    {r.phones[0] && (
                      <button
                        type="button"
                        onClick={() => setCallPopup({
                          phone: r.phones[0],
                          customerId: r.customerId,
                          customerName: r.customerName,
                          contactLabel: r.kind === "kontakt"
                            ? r.name + (r.role ? " · " + r.role : "")
                            : r.name,
                        })}
                        title="Anruf mit Notiz erfassen"
                        style={{
                          background: "transparent", border: "none", padding: 4,
                          cursor: "pointer", color: subtle, borderRadius: 4,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = accent; }}
                        onMouseLeave={e => { e.currentTarget.style.color = subtle; }}
                      >
                        <StickyNote size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 48, textAlign: "center", color: subtle, fontSize: 13 }}>
                  {q ? "Keine Treffer." : "Keine Einträge mit Telefon oder Mail."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
