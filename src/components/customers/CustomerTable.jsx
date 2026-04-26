import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search, Building2, UserRound, ChevronDown, ChevronRight, Phone,
} from "lucide-react";
import { ThemeContext } from "@/Layout";
import CallNotePopup from "./CallNotePopup";

/**
 * Full-width table view of customers.
 * Columns sind verschiebbar (Drag am Header) und breitenänderbar (Drag am rechten Rand).
 * Anordnung & Breiten bleiben in localStorage gespeichert.
 */
const LS_ORDER = "customerTable.order.v1";
const LS_WIDTHS = "customerTable.widths.v1";

// ── Column config ─────────────────────────────────────────────
const DEFAULT_COLS = [
  { key: "name",    label: "Name",    w: 260, minW: 140 },
  { key: "typ",     label: "Typ",     w: 100, minW:  70 },
  { key: "kt",      label: "KT",      w:  56, minW:  40 },
  { key: "ort",     label: "Ort",     w: 150, minW:  80 },
  { key: "email",   label: "E-Mail",  w: 220, minW: 100 },
  { key: "phone",   label: "Tel.",    w: 130, minW:  80 },
  { key: "tags",    label: "Tags",    w: 180, minW:  80 },
  { key: "fristen", label: "Fristen", w:  84, minW:  60, align: "right" },
  { key: "mails",   label: "Mails",   w:  84, minW:  60, align: "right" },
  { key: "uid",     label: "UID",     w: 150, minW:  80 },
];

export default function CustomerTable({
  customers,
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
  const rowHover   = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "rgba(63,63,70,0.35)";
  const headerBg   = isArtis ? "#f7faf7" : isLight ? "#f7f7fb" : "rgba(30,30,34,0.9)";
  const cardBg     = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.4)";
  const accent     = isArtis ? "#4d6a50" : "#5b21b6";

  const [search, setSearch]       = useState("");
  const [groupByKt, setGroupByKt] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [collapsedKt, setCollapsedKt]   = useState({});
  const [callPopup, setCallPopup] = useState(null); // { phone, customerId, customerName } | null

  // ── Columns: Order + Widths ────────────────────────────────
  const [colKeys, setColKeys] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_ORDER) || "null");
      if (Array.isArray(saved) && saved.length) {
        // alle Default-Keys ergänzen (neue Spalten) und unbekannte rauswerfen
        const valid = saved.filter(k => DEFAULT_COLS.some(c => c.key === k));
        const missing = DEFAULT_COLS.map(c => c.key).filter(k => !valid.includes(k));
        return [...valid, ...missing];
      }
    } catch { /* ignore */ }
    return DEFAULT_COLS.map(c => c.key);
  });
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_WIDTHS) || "null");
      if (saved && typeof saved === "object") {
        const base = Object.fromEntries(DEFAULT_COLS.map(c => [c.key, c.w]));
        return { ...base, ...saved };
      }
    } catch { /* ignore */ }
    return Object.fromEntries(DEFAULT_COLS.map(c => [c.key, c.w]));
  });

  useEffect(() => { localStorage.setItem(LS_ORDER, JSON.stringify(colKeys)); }, [colKeys]);
  useEffect(() => { localStorage.setItem(LS_WIDTHS, JSON.stringify(colWidths)); }, [colWidths]);

  const cols = colKeys
    .map(k => DEFAULT_COLS.find(c => c.key === k))
    .filter(Boolean)
    .map(c => ({ ...c, w: colWidths[c.key] ?? c.w }));

  // ── Drag-to-reorder (Header) ────────────────────────────────
  const dragKeyRef  = useRef(null);
  const searchRef   = useRef(null);

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
  const [dragOverKey, setDragOverKey] = useState(null);

  const onDragStart = (key) => (e) => {
    dragKeyRef.current = key;
    e.dataTransfer.effectAllowed = "move";
    // Chrome braucht ein gesetztes dataTransfer
    try { e.dataTransfer.setData("text/plain", key); } catch {}
  };
  const onDragOver = (key) => (e) => {
    if (!dragKeyRef.current || dragKeyRef.current === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverKey !== key) setDragOverKey(key);
  };
  const onDrop = (key) => (e) => {
    e.preventDefault();
    const src = dragKeyRef.current;
    dragKeyRef.current = null;
    setDragOverKey(null);
    if (!src || src === key) return;
    setColKeys(prev => {
      const next = prev.filter(k => k !== src);
      const idx = next.indexOf(key);
      next.splice(idx, 0, src);
      return next;
    });
  };
  const onDragEnd = () => {
    dragKeyRef.current = null;
    setDragOverKey(null);
  };

  // ── Drag-to-resize (rechter Rand) ───────────────────────────
  const resizeStart = (key, minW) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[key] ?? (DEFAULT_COLS.find(c => c.key === key)?.w || 100);
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const next = Math.max(minW || 40, startW + dx);
      setColWidths(w => ({ ...w, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Data: all mails/fristen, aggregate client-side ──────────
  const { data: allMails = [] } = useQuery({
    queryKey: ["mails-all-unread"],
    queryFn:  () => entities.MailItem.filter({ is_read: false }, "-received_date", 500),
  });
  const { data: allFristen = [] } = useQuery({
    queryKey: ["fristen"],
    queryFn:  () => entities.Frist.list("due_date"),
  });

  const mailsByCustomer = useMemo(() => {
    const m = {};
    for (const x of allMails) {
      if (!x.customer_id) continue;
      m[x.customer_id] = (m[x.customer_id] || 0) + 1;
    }
    return m;
  }, [allMails]);

  const fristenByCustomer = useMemo(() => {
    const m = {};
    for (const f of allFristen) {
      if (!f.customer_id || f.status === "erledigt") continue;
      m[f.customer_id] = (m[f.customer_id] || 0) + 1;
    }
    return m;
  }, [allFristen]);

  // ── Filter ──────────────────────────────────────────────────
  const typeFiltered = customers.filter(c => {
    if (c.ist_nebensteuerdomizil === true) return false;
    if (personTypeFilter === "alle") return true;
    if (personTypeFilter === "privatperson") return c.person_type === "privatperson";
    return c.person_type === "unternehmen" || !c.person_type;
  });

  const q = search.trim().toLowerCase();
  const searchFiltered = !q ? typeFiltered : typeFiltered.filter(c => {
    return (c.company_name || "").toLowerCase().includes(q)
        || (c.email        || "").toLowerCase().includes(q)
        || (c.ort          || "").toLowerCase().includes(q)
        || (c.portal_uid   || "").toLowerCase().includes(q)
        || (c.tags || []).some(t => (t || "").toLowerCase().includes(q));
  });

  const activeRows   = searchFiltered.filter(c => c.aktiv !== false);
  const inactiveRows = searchFiltered.filter(c => c.aktiv === false);

  // ── Group by Kanton ─────────────────────────────────────────
  const grouped = useMemo(() => {
    if (!groupByKt) return [{ key: null, rows: activeRows }];
    const m = new Map();
    for (const c of activeRows) {
      const key = c.kanton || "—";
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(c);
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, rows]) => ({ key, rows }));
  }, [activeRows, groupByKt]);

  const totalActive = activeRows.length;
  const totalW = cols.reduce((a, c) => a + c.w, 0);

  return (
    <div style={{ background: cardBg, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Toolbar ──────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${borderColor}` }}>
        <div style={{ position: "relative", flex: "0 1 320px" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: subtle }} />
          <Input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen: Name, E-Mail, Ort, UID, Tag… (Ctrl+F)"
            style={{ paddingLeft: 32, height: 32, fontSize: 13, background: isArtis ? "#f5f5f5" : isLight ? "#f0f0f8" : "rgba(24,24,27,0.6)", borderColor, color: textMain }}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: textMuted, cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={groupByKt} onChange={e => setGroupByKt(e.target.checked)} />
          Nach Kanton gruppieren
        </label>

        <button
          onClick={() => {
            setColKeys(DEFAULT_COLS.map(c => c.key));
            setColWidths(Object.fromEntries(DEFAULT_COLS.map(c => [c.key, c.w])));
          }}
          title="Spalten auf Standard zurücksetzen"
          style={{ fontSize: 11, color: textMuted, background: "transparent", border: `1px solid ${borderColor}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
        >
          Spalten zurücksetzen
        </button>

        <div style={{ marginLeft: "auto", fontSize: 12, color: subtle }}>
          {totalActive} {totalActive === 1 ? "Eintrag" : "Einträge"}
          {inactiveRows.length > 0 && <> · {inactiveRows.length} inaktiv</>}
        </div>
      </div>

      {/* ── Scrollable Table ─────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: Math.max(totalW, 800), borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
          <colgroup>
            {cols.map(c => <col key={c.key} style={{ width: c.w }} />)}
          </colgroup>
          <thead>
            <tr style={{ position: "sticky", top: 0, zIndex: 2, background: headerBg, borderBottom: `1px solid ${borderColor}` }}>
              {cols.map((col, i) => (
                <th
                  key={col.key}
                  draggable
                  onDragStart={onDragStart(col.key)}
                  onDragOver={onDragOver(col.key)}
                  onDrop={onDrop(col.key)}
                  onDragEnd={onDragEnd}
                  style={{
                    ...thStyle,
                    color: textMuted,
                    width: col.w,
                    textAlign: col.align || "left",
                    paddingLeft: i === 0 ? 16 : 10,
                    paddingRight: 16,
                    background: dragOverKey === col.key
                      ? (isArtis ? "#dfe9df" : isLight ? "#e3e3ef" : "rgba(63,63,70,0.6)")
                      : headerBg,
                    borderLeft: dragOverKey === col.key ? `2px solid ${accent}` : "none",
                    cursor: "grab",
                    position: "relative",
                    userSelect: "none",
                  }}
                  title="Ziehen zum Verschieben · rechter Rand zum Verbreitern"
                >
                  {col.label}
                  {/* Resize-Handle */}
                  <span
                    onMouseDown={resizeStart(col.key, col.minW)}
                    onDragStart={e => e.preventDefault()}
                    style={{
                      position: "absolute",
                      top: 0, right: 0, bottom: 0,
                      width: 6,
                      cursor: "col-resize",
                      zIndex: 3,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = accent + "33"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ key, rows }) => (
              <React.Fragment key={key ?? "__none"}>
                {groupByKt && (
                  <tr>
                    <td colSpan={cols.length} style={{ background: isArtis ? "#edf2ed" : isLight ? "#eeeef4" : "rgba(30,30,34,0.6)", borderBottom: `1px solid ${borderColor}`, padding: "6px 16px" }}>
                      <button
                        onClick={() => setCollapsedKt(s => ({ ...s, [key]: !s[key] }))}
                        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: textMain, fontSize: 11.5, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase" }}
                      >
                        {collapsedKt[key] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <span>{key || "Ohne Kanton"}</span>
                        <span style={{ color: subtle, fontWeight: 500 }}>· {rows.length}</span>
                      </button>
                    </td>
                  </tr>
                )}
                {!collapsedKt[key] && rows.map(c => (
                  <Row
                    key={c.id}
                    c={c}
                    cols={cols}
                    onSelect={onSelect}
                    rowHover={rowHover}
                    textMain={textMain}
                    textMuted={textMuted}
                    subtle={subtle}
                    borderColor={borderColor}
                    accent={accent}
                    openMails={mailsByCustomer[c.id] || 0}
                    openFristen={fristenByCustomer[c.id] || 0}
                    isArtis={isArtis}
                    onPhoneClick={(phone, customer) => {
                      setCallPopup({ phone, customerId: customer.id, customerName: customer.company_name });
                      const clean = normalizePhone(phone).replace(/[^+\d]/g, "");
                      if (clean) setTimeout(() => { window.location.href = `tel:${clean}`; }, 80);
                    }}
                  />
                ))}
              </React.Fragment>
            ))}

            {activeRows.length === 0 && (
              <tr>
                <td colSpan={cols.length} style={{ padding: 48, textAlign: "center", color: subtle, fontSize: 13 }}>
                  {q ? "Keine Treffer." :
                    personTypeFilter === "privatperson" ? "Keine Privatpersonen." :
                    personTypeFilter === "unternehmen"  ? "Keine Unternehmen." :
                    "Keine Einträge."}
                </td>
              </tr>
            )}

            {/* ── Inaktive: ausklappbar ── */}
            {inactiveRows.length > 0 && (
              <>
                <tr>
                  <td colSpan={cols.length} style={{ borderTop: `1px solid ${borderColor}`, padding: "10px 16px", background: isArtis ? "#fafcfa" : isLight ? "#fafaff" : "rgba(30,30,34,0.4)" }}>
                    <button
                      onClick={() => setShowInactive(v => !v)}
                      style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: textMuted, fontSize: 11.5, fontWeight: 600 }}
                    >
                      {showInactive ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      Inaktiv ({inactiveRows.length})
                    </button>
                  </td>
                </tr>
                {showInactive && inactiveRows.map(c => (
                  <Row
                    key={c.id}
                    c={c}
                    cols={cols}
                    onSelect={onSelect}
                    rowHover={rowHover}
                    textMain={textMain}
                    textMuted={textMuted}
                    subtle={subtle}
                    borderColor={borderColor}
                    accent={accent}
                    openMails={mailsByCustomer[c.id] || 0}
                    openFristen={fristenByCustomer[c.id] || 0}
                    isArtis={isArtis}
                    onPhoneClick={(phone, customer) => {
                      setCallPopup({ phone, customerId: customer.id, customerName: customer.company_name });
                      const clean = normalizePhone(phone).replace(/[^+\d]/g, "");
                      if (clean) setTimeout(() => { window.location.href = `tel:${clean}`; }, 80);
                    }}
                    inactive
                  />
                ))}
              </>
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
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const tdBase = {
  padding: "10px",
  verticalAlign: "middle",
  borderBottom: "1px solid",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function normalizePhone(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/[\s.\-()/]/g, "");
  if (s.startsWith("+41"))  return s;
  if (s.startsWith("0041")) return "+41" + s.slice(4);
  if (s.startsWith("00"))   return "+41" + s.slice(2);
  if (s.startsWith("0"))    return "+41" + s.slice(1);
  return s;
}

function formatPhoneDisplay(raw) {
  if (!raw) return "";
  const n = normalizePhone(raw);
  if (!n.startsWith("+41")) return raw;
  const rest = n.slice(3);
  if (rest.length === 9)
    return `+41 ${rest.slice(0,2)} ${rest.slice(2,5)} ${rest.slice(5,7)} ${rest.slice(7,9)}`;
  return n;
}

function Row({ c, cols, onSelect, rowHover, textMain, textMuted, subtle, borderColor, accent, openMails, openFristen, isArtis, inactive, onPhoneClick }) {
  const isPrivat = c.person_type === "privatperson";
  return (
    <tr
      onClick={() => onSelect(c)}
      style={{ cursor: "pointer", opacity: inactive ? 0.55 : 1 }}
      onMouseEnter={e => { e.currentTarget.style.background = rowHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      {cols.map((col, i) => {
        const paddingLeft = i === 0 ? 16 : 10;
        const align = col.align || "left";
        const td = { ...tdBase, borderBottomColor: borderColor, paddingLeft, textAlign: align };

        switch (col.key) {
          case "name":
            return (
              <td key={col.key} style={td}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {isPrivat
                    ? <UserRound size={14} style={{ color: accent, flexShrink: 0 }} />
                    : <Building2 size={14} style={{ color: subtle, flexShrink: 0 }} />
                  }
                  <span style={{ fontWeight: 500, color: textMain, overflow: "hidden", textOverflow: "ellipsis", textDecoration: inactive ? "line-through" : "none" }}>
                    {c.company_name || "Ohne Name"}
                  </span>
                </div>
              </td>
            );
          case "typ":
            return <td key={col.key} style={{ ...td, color: textMuted }}>{isPrivat ? "Person" : "Unternehmen"}</td>;
          case "kt":
            return <td key={col.key} style={{ ...td, color: textMuted, fontVariantNumeric: "tabular-nums" }}>{c.kanton || "—"}</td>;
          case "ort":
            return <td key={col.key} style={{ ...td, color: textMuted }}>{c.ort || ""}</td>;
          case "email":
            return (
              <td key={col.key} style={{ ...td, color: textMuted }}>
                {c.email ? (
                  <a
                    href={`mailto:${c.email}`}
                    onClick={e => e.stopPropagation()}
                    title={`E-Mail an ${c.email}`}
                    style={{ color: textMuted, textDecoration: "none" }}
                    onMouseEnter={e => { e.currentTarget.style.color = accent; e.currentTarget.style.textDecoration = "underline"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = textMuted; e.currentTarget.style.textDecoration = "none"; }}
                  >
                    {c.email}
                  </a>
                ) : ""}
              </td>
            );
          case "phone":
            return (
              <td key={col.key} style={{ ...td, color: textMuted }}>
                {c.phone ? (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onPhoneClick && onPhoneClick(c.phone, c); }}
                    title={`Anrufen mit Notiz: ${formatPhoneDisplay(c.phone)}`}
                    style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: textMuted, font: "inherit", textAlign: "left", display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%" }}
                    onMouseEnter={e => { e.currentTarget.style.color = accent; }}
                    onMouseLeave={e => { e.currentTarget.style.color = textMuted; }}
                  >
                    <Phone size={11} style={{ color: "#10b981", flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{formatPhoneDisplay(c.phone)}</span>
                  </button>
                ) : ""}
              </td>
            );
          case "tags":
            return (
              <td key={col.key} style={td}>
                {(c.tags || []).length > 0 ? (
                  <div style={{ display: "flex", gap: 4, flexWrap: "nowrap", overflow: "hidden" }}>
                    {c.tags.slice(0, 3).map(t => (
                      <Badge key={t} variant="outline" style={{ fontSize: 10, padding: "0 6px", borderColor: isArtis ? "#bfcfbf" : "#d4dcd4", color: accent, background: isArtis ? "#e6ede6" : "#f2f5f2", whiteSpace: "nowrap" }}>
                        {t}
                      </Badge>
                    ))}
                    {c.tags.length > 3 && <span style={{ fontSize: 10.5, color: subtle, alignSelf: "center" }}>+{c.tags.length - 3}</span>}
                  </div>
                ) : <span style={{ color: subtle }}>—</span>}
              </td>
            );
          case "fristen":
            return (
              <td key={col.key} style={{ ...td, fontVariantNumeric: "tabular-nums" }}>
                {openFristen > 0
                  ? <span style={{ display: "inline-block", minWidth: 22, padding: "1px 7px", borderRadius: 10, background: "#fef0c7", color: "#8a5a00", fontWeight: 600, fontSize: 11 }}>{openFristen}</span>
                  : <span style={{ color: subtle }}>0</span>}
              </td>
            );
          case "mails":
            return (
              <td key={col.key} style={{ ...td, fontVariantNumeric: "tabular-nums" }}>
                {openMails > 0
                  ? <span style={{ display: "inline-block", minWidth: 22, padding: "1px 7px", borderRadius: 10, background: "#fde7e7", color: "#8a2d2d", fontWeight: 600, fontSize: 11 }}>{openMails}</span>
                  : <span style={{ color: subtle }}>0</span>}
              </td>
            );
          case "uid":
            return <td key={col.key} style={{ ...td, color: textMuted, fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>{c.portal_uid || ""}</td>;
          default:
            return <td key={col.key} style={td} />;
        }
      })}
    </tr>
  );
}
