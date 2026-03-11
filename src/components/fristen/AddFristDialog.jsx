import React, { useState, useEffect, useContext } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { entities, functions } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, RefreshCw, Search, Eye, EyeOff, KeyRound } from "lucide-react";
import { ThemeContext } from "@/Layout";
import { KantonMultiSelect, YEARS } from "@/components/fristen/FristInlineRow";

export const CATEGORIES = [
  "MWST",
  "Steuererklärung",
  "Lohnabrechnung",
  "AHV / IV / ALV",
  "Jahresabschluss",
  "Pensionskasse",
  "Unfallversicherung",
  "Behörden",
  "Verschiedenes",
];

const RECURRENCE_OPTIONS = [
  { value: "monthly",   label: "Monatlich" },
  { value: "quarterly", label: "Quartalsweise" },
  { value: "yearly",    label: "Jährlich" },
];

const currentYear = new Date().getFullYear();

export default function AddFristDialog({ open, onClose, onSave, initial = null }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  // ── Theme ────────────────────────────────────────────────────
  const dialogBg     = isArtis ? "#f2f5f2" : isLight ? "#ffffff" : "#18181b";
  const headerBg     = isArtis ? "#e6ede6" : isLight ? "#f8fafc" : "#1c1c21";
  const dialogBorder = isArtis ? "#bfcfbf" : isLight ? "#e2e8f0" : "#3f3f46";
  const labelColor   = isArtis ? "#4a5e4a" : isLight ? "#374151" : "#a1a1aa";
  const textColor    = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const mutedColor   = isArtis ? "#6b826b" : isLight ? "#6b7280" : "#71717a";
  const inputBg      = isArtis ? "#ffffff" : isLight ? "#f9fafb" : "#27272a";
  const inputBorder  = isArtis ? "#bfcfbf" : isLight ? "#d1d5db" : "#3f3f46";
  const accentBg     = isArtis ? "#7a9b7f" : "#7c3aed";
  const dropdownBg   = isArtis ? "#f8faf8" : isLight ? "#ffffff" : "#1c1c21";
  const dropdownHover= isArtis ? "#edf2ed" : isLight ? "#f3f4f6" : "#27272a";
  const sectionBg    = isArtis ? "rgba(122,155,127,0.06)" : isLight ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.03)";

  const inStyle = { backgroundColor: inputBg, borderColor: inputBorder, color: textColor };

  // ── State ────────────────────────────────────────────────────
  const isEdit = !!(initial && initial.id);
  const [title,          setTitle]          = useState("");
  const [description,    setDescription]    = useState("");
  const [dueDate,        setDueDate]        = useState("");
  const [category,       setCategory]       = useState("Steuererklärung");
  const [jahr,           setJahr]           = useState(String(currentYear));
  const [kanton,         setKanton]         = useState("");
  const [hauptdomizil,   setHauptdomizil]   = useState(true);
  const [customerId,     setCustomerId]     = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustDrop,   setShowCustDrop]   = useState(false);
  const [assignee,       setAssignee]       = useState("");
  const [portalLogin,    setPortalLogin]    = useState("");
  const [portalUid,      setPortalUid]      = useState("");
  const [portalPassword, setPortalPassword] = useState("");
  const [showPw,         setShowPw]         = useState(false);
  const [recurring,      setRecurring]      = useState(false);
  const [recurrence,     setRecurrence]     = useState("yearly");
  const [saving,         setSaving]         = useState(false);

  // Pre-fill when editing
  useEffect(() => {
    if (open && initial) {
      setTitle(initial.title || "");
      setDescription(initial.description || "");
      setDueDate(initial.due_date || "");
      setCategory(initial.category || "Steuererklärung");
      setJahr(initial.jahr ? String(initial.jahr) : String(currentYear));
      setKanton(initial.kanton || "");
      setHauptdomizil(initial.ist_hauptsteuerdomizil !== false);
      setCustomerId(initial.customer_id || "");
      setAssignee(initial.assignee || "");
      setPortalLogin(initial.portal_login || "");
      setPortalUid(initial.portal_uid || "");
      setPortalPassword(initial.portal_password || "");
      setRecurring(initial.is_recurring || false);
      setRecurrence(initial.recurrence || "yearly");
      setCustomerSearch("");
    } else if (open && !initial) {
      setTitle(""); setDescription(""); setDueDate("");
      setCategory("Steuererklärung"); setJahr(String(currentYear));
      setKanton(""); setHauptdomizil(true);
      setCustomerId(""); setAssignee("");
      setPortalLogin(""); setPortalUid(""); setPortalPassword("");
      setCustomerSearch(""); setRecurring(false); setRecurrence("yearly");
    }
  }, [open, initial]);

  const { data: users = [] } = useQuery({
    queryKey: ["allUsers-fristen"],
    queryFn: async () => {
      const res = await functions.invoke("getAllUsers");
      return res.data?.users || [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  useEffect(() => {
    if (customerId) {
      const c = customers.find(c => c.id === customerId);
      if (c) setCustomerSearch(c.company_name);
    }
  }, [customerId, customers]);

  const filteredCustomers = customers.filter(c =>
    c.company_name.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const handleSave = async () => {
    if (!title.trim() || !dueDate || !customerId) return;
    setSaving(true);
    try {
      await onSave({
        title:                   title.trim(),
        description:             description.trim() || null,
        due_date:                dueDate,
        category,
        jahr:                    parseInt(jahr, 10),
        kanton:                  kanton || null,
        ist_hauptsteuerdomizil:  hauptdomizil,
        customer_id:             customerId || null,
        assignee:                assignee || null,
        portal_login:            portalLogin || null,
        portal_uid:              portalUid || null,
        portal_password:         portalPassword || null,
        is_recurring:            recurring,
        recurrence:              recurring ? recurrence : null,
        status:                  "offen",
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "rounded-md border px-3 py-1.5 text-sm focus:outline-none w-full";
  const labelCls = "text-xs font-semibold uppercase tracking-wide mb-1 block";
  const selectCls = "rounded-md border px-2 py-1.5 text-sm focus:outline-none w-full cursor-pointer";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-lg p-0 overflow-hidden gap-0"
        style={{ backgroundColor: dialogBg, borderColor: dialogBorder, color: textColor }}
      >
        {/* ── Header ── */}
        <DialogHeader
          className="px-5 pt-4 pb-3 border-b"
          style={{ backgroundColor: headerBg, borderColor: dialogBorder }}
        >
          <DialogTitle className="flex items-center gap-2 text-base font-semibold" style={{ color: textColor }}>
            <CalendarClock className="h-5 w-5" style={{ color: accentBg }} />
            {isEdit ? "Frist bearbeiten" : "Neue Frist"}
          </DialogTitle>
        </DialogHeader>

        {/* ── Body ── */}
        <div className="px-5 py-4 space-y-4 max-h-[72vh] overflow-y-auto">

          {/* Bezeichnung */}
          <div>
            <label className={labelCls} style={{ color: labelColor }}>Bezeichnung *</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="z.B. Steuererklärung 2025"
              className={inputCls}
              style={inStyle}
            />
          </div>

          {/* Kategorie | Jahr | Fällig am */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls} style={{ color: labelColor }}>Kategorie</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={selectCls} style={inStyle}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: labelColor }}>Jahr *</label>
              <select value={jahr} onChange={e => setJahr(e.target.value)} className={selectCls} style={inStyle}>
                {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: labelColor }}>Fällig am *</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} style={inStyle} />
            </div>
          </div>

          {/* Kanton | H-Dom */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className={labelCls} style={{ color: labelColor }}>Kanton(e)</label>
              <KantonMultiSelect
                value={kanton}
                onChange={setKanton}
                inStyle={inStyle}
                s={{ checkBg: isArtis ? "rgba(122,155,127,0.15)" : "rgba(124,58,237,0.1)", accentBg }}
              />
            </div>
            <div className="flex items-center gap-2 pb-1.5">
              <input
                type="checkbox" id="hdom" checked={hauptdomizil}
                onChange={e => setHauptdomizil(e.target.checked)}
                style={{ accentColor: accentBg, width: 15, height: 15, cursor: "pointer" }}
              />
              <label htmlFor="hdom" className="text-sm cursor-pointer select-none font-medium"
                style={{ color: hauptdomizil ? accentBg : textColor }}>
                Hauptsteuerdomizil (H-Dom)
              </label>
            </div>
          </div>

          {/* Kunde */}
          <div>
            <label className={labelCls} style={{ color: labelColor }}>Kunde *</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: mutedColor }} />
              <input
                value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); setShowCustDrop(true); if (!e.target.value) setCustomerId(""); }}
                onFocus={() => setShowCustDrop(true)}
                onBlur={() => setTimeout(() => setShowCustDrop(false), 150)}
                placeholder="Kunde suchen..."
                className={inputCls}
                style={{ ...inStyle, paddingLeft: "2rem" }}
                autoComplete="off"
              />
              {!customerId && customerSearch && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: accentBg }}>Auswählen ↓</span>
              )}
              {showCustDrop && filteredCustomers.length > 0 && (
                <div className="absolute z-50 top-full left-0 mt-1 w-full rounded-md border shadow-lg max-h-44 overflow-y-auto"
                  style={{ backgroundColor: dropdownBg, borderColor: dialogBorder }}>
                  {filteredCustomers.map(c => (
                    <div key={c.id}
                      className="px-3 py-2 text-sm cursor-pointer"
                      style={{ color: textColor }}
                      onMouseDown={() => { setCustomerId(c.id); setCustomerSearch(c.company_name); setShowCustDrop(false); }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = dropdownHover}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                    >{c.company_name}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Zuständig */}
          <div>
            <label className={labelCls} style={{ color: labelColor }}>Zuständig (optional)</label>
            <select value={assignee || ""} onChange={e => setAssignee(e.target.value)} className={selectCls} style={inStyle}>
              <option value="">— Niemand —</option>
              {users.map(u => <option key={u.id} value={u.email}>{u.full_name || u.email}</option>)}
            </select>
          </div>

          {/* Bemerkung */}
          <div>
            <label className={labelCls} style={{ color: labelColor }}>Bemerkung (optional)</label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Hinweise, Details zur Frist..."
              className="resize-none h-20 text-sm"
              style={{ ...inStyle }}
            />
          </div>

          {/* ── Zugangsdaten ── */}
          <div className="rounded-lg p-3 space-y-3" style={{ backgroundColor: sectionBg, border: `1px solid ${dialogBorder}` }}>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: labelColor }}>
              <KeyRound className="h-3.5 w-3.5" /> Zugangsdaten (optional)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs mb-1 block" style={{ color: mutedColor }}>Login</label>
                <input value={portalLogin} onChange={e => setPortalLogin(e.target.value)}
                  placeholder="Benutzername" className={inputCls} style={inStyle} autoComplete="off" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: mutedColor }}>UID</label>
                <input value={portalUid} onChange={e => setPortalUid(e.target.value)}
                  placeholder="UID" className={inputCls} style={inStyle} autoComplete="off" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: mutedColor }}>Passwort</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={portalPassword} onChange={e => setPortalPassword(e.target.value)}
                    placeholder="••••••" className={inputCls}
                    style={{ ...inStyle, paddingRight: portalPassword ? "1.75rem" : undefined }}
                    autoComplete="new-password"
                  />
                  {portalPassword && (
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded hover:bg-black/5"
                      style={{ color: mutedColor }}>
                      {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Wiederkehrend */}
          <div className="flex items-center gap-3 py-1">
            <input type="checkbox" id="recurring" checked={recurring} onChange={e => setRecurring(e.target.checked)}
              style={{ accentColor: accentBg, width: 15, height: 15, cursor: "pointer" }} />
            <label htmlFor="recurring" className="text-sm cursor-pointer select-none flex items-center gap-1.5 font-medium" style={{ color: textColor }}>
              <RefreshCw className="h-3.5 w-3.5" style={{ color: mutedColor }} /> Wiederkehrend
            </label>
            {recurring && (
              <select value={recurrence} onChange={e => setRecurrence(e.target.value)}
                className={selectCls} style={{ ...inStyle, width: "auto", minWidth: 130, marginLeft: "auto" }}>
                {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <DialogFooter
          className="px-5 py-3 border-t flex items-center justify-end gap-2"
          style={{ borderColor: dialogBorder, backgroundColor: headerBg }}
        >
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: mutedColor }}>
            Abbrechen
          </button>
          <button onClick={handleSave}
            disabled={!title.trim() || !dueDate || !customerId || saving}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: accentBg }}>
            {saving ? "Speichern…" : isEdit ? "Speichern" : "Erstellen"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
