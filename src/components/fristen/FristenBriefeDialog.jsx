import React, { useState, useMemo, useContext } from "react";
import { X, Printer, ChevronDown, ChevronUp, AlertTriangle, Save, BookOpen, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { entities } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function today() {
  const d  = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return dd + "." + mm + "." + d.getFullYear();
}

// Absender: nur Name, Strasse, Stadt, E-Mail (kein Telefon)
const SENDER_NAME   = "Artis Treuhand GmbH";
const SENDER_STREET = "Trischlistrasse 10";
const SENDER_CITY   = "9400 Rorschach";
const SENDER_EMAIL  = "info@artis-gmbh.ch";
const LETTER_CITY   = "Rorschach";

const DEFAULT_SUBJECT = "Einreichung Steuererkl\u00e4rung __JAHR__";
const DEFAULT_BODY =
  "Sehr geehrte Damen und Herren\n\n" +
  "Wir erlauben uns, Sie h\u00f6flich daran zu erinnern, dass wir f\u00fcr die Erstellung\n" +
  "Ihrer Steuererkl\u00e4rung __JAHR__ noch Ihre Unterlagen ben\u00f6tigen.\n\n" +
  "Wir bitten Sie, uns die Unterlagen baldm\u00f6glichst zukommen zu lassen.\n\n" +
  "F\u00fcr R\u00fcckfragen stehen wir Ihnen gerne zur Verf\u00fcgung.\n\n" +
  "Freundliche Gr\u00fcsse\n\n" +
  SENDER_NAME;

function generatePrintHtml(recipients, letterDate, subject, bodyTemplate, logoUrl) {
  const pages = recipients.map(r => {
    const kat  = r.kategorie || "Steuer";
    const jahr = r.jahr != null ? String(r.jahr) : String(new Date().getFullYear() - 1);
    const rSub  = subject.split("__KATEGORIE__").join(kat).split("__JAHR__").join(jahr);
    const rBody = bodyTemplate.split("__KATEGORIE__").join(kat).split("__JAHR__").join(jahr);
    const bodyHtml = rBody.split("\n").map(l => l === "" ? "<br/>" : "<p>" + l + "</p>").join("");
    return (
      "<div class=\"page\">" +
      "<div class=\"letterhead\">" +
      // Absender-Zeile: Name · Strasse · Stadt · E-Mail (kein Telefon)
      "<div class=\"sender-line\">" + SENDER_NAME + " \u00b7 " + SENDER_STREET + " \u00b7 " + SENDER_CITY + " \u00b7 " + SENDER_EMAIL + "</div>" +
      (logoUrl ? "<img class=\"logo\" src=\"" + logoUrl + "\" alt=\"Logo\" />" : "<span class=\"logo-text\">" + SENDER_NAME + "</span>") +
      "</div>" +
      "<div class=\"hline\"></div>" +
      "<div class=\"recipient\">" +
      "<div>" + r.company_name + "</div>" +
      (r.strasse ? "<div>" + r.strasse + "</div>" : "") +
      "<div>" + [r.plz, r.ort].filter(Boolean).join(" ") + "</div>" +
      "</div>" +
      // Ort + Datum rechtsb\u00fcndig
      "<div class=\"date\">" + LETTER_CITY + ", " + letterDate + "</div>" +
      "<div class=\"subject\">" + rSub + "</div>" +
      "<div class=\"body\">" + bodyHtml + "</div>" +
      "</div>"
    );
  }).join("\n");

  return (
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><title>Briefe</title><style>" +
    "* { box-sizing: border-box; margin: 0; padding: 0; }" +
    "body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #222; background: white; }" +
    "@page { size: A4; margin: 0; }" +
    "@media print { .page { page-break-after: always; } .page:last-child { page-break-after: avoid; } }" +
    ".page { width: 210mm; min-height: 297mm; padding: 18mm 22mm 20mm 25mm; position: relative; background: white; overflow: hidden; }" +
    ".letterhead { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 3mm; }" +
    ".sender-line { font-size: 7.5pt; color: #666; flex: 1; padding-bottom: 1mm; }" +
    ".logo { height: 16mm; max-width: 52mm; object-fit: contain; flex-shrink: 0; margin-left: 8mm; }" +
    ".logo-text { font-size: 13pt; font-weight: bold; color: #2d5a2d; flex-shrink: 0; margin-left: 8mm; }" +
    ".hline { border-top: 0.5pt solid #999; margin-top: 2mm; margin-bottom: 14mm; }" +
    ".recipient { margin-bottom: 14mm; line-height: 1.6; font-size: 11pt; }" +
    ".date { text-align: right; margin-bottom: 10mm; font-size: 11pt; }" +
    ".subject { font-weight: bold; margin-bottom: 8mm; font-size: 11pt; }" +
    ".body { line-height: 1.7; font-size: 11pt; }" +
    ".body p { margin: 0 0 3px 0; }" +
    "</style></head><body>" +
    pages +
    "</body></html>"
  );
}

// ─── Vorlage-Speichern Dialog ─────────────────────────────────────────────
function SaveTemplateDialog({ onSave, onCancel, s, border, accent }) {
  const [name, setName] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 10, padding: 20, width: 340 }}>
        <h4 style={{ color: s.textMain, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Vorlage speichern</h4>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          placeholder="Vorlagenname (z.B. Mahnung Steuern)"
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); if (e.key === "Escape") onCancel(); }}
          style={{ background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "6px 10px", fontSize: 13, width: "100%", outline: "none" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border, fontSize: 12 }}>Abbrechen</Button>
          <Button onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}
            style={{ background: accent, color: "#fff", fontSize: 12 }}>Speichern</Button>
        </div>
      </div>
    </div>
  );
}

export default function FristenBriefeDialog({ fristen, customers, onClose }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = {
    cardBg:      isArtis ? "#ffffff"             : isLight ? "#ffffff"             : "#27272a",
    border:      isArtis ? "#ccd8cc"             : isLight ? "#d4d4e8"             : "#3f3f46",
    textMain:    isArtis ? "#2d3a2d"             : isLight ? "#1a1a2e"             : "#e4e4e7",
    textMuted:   isArtis ? "#6b826b"             : isLight ? "#7a7a9a"             : "#71717a",
    inputBg:     isArtis ? "#ffffff"             : isLight ? "#ffffff"             : "rgba(24,24,27,0.8)",
    inputBorder: isArtis ? "#bfcfbf"             : isLight ? "#c8c8dc"             : "#3f3f46",
    accentBg:    isArtis ? "#7a9b7f"             : "#6366f1",
    rowBg:       isArtis ? "#f5f8f5"             : isLight ? "#f5f5fc"             : "#1f1f23",
  };
  const border = s.border;
  const accent = isArtis ? "#4a7a4f" : "#6366f1";
  const queryClient = useQueryClient();

  // ── Vorlagen ─────────────────────────────────────────────────────────
  const { data: vorlagen = [] } = useQuery({
    queryKey: ["brief_vorlagen"],
    queryFn:  () => entities.BriefVorlage.list("sort_order"),
  });

  const createVorlageMut = useMutation({
    mutationFn: (d) => entities.BriefVorlage.create(d),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ["brief_vorlagen"] }); toast.success("Vorlage gespeichert"); },
    onError:    (e) => toast.error("Fehler: " + e.message),
  });
  const deleteVorlageMut = useMutation({
    mutationFn: (id) => entities.BriefVorlage.delete(id),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ["brief_vorlagen"] }); toast.success("Vorlage gel\u00f6scht"); },
    onError:    (e) => toast.error("Fehler: " + e.message),
  });

  // ── Kandidaten ───────────────────────────────────────────────────────
  const candidates = useMemo(() => {
    const seen = new Set();
    const result = [];
    (fristen || []).forEach(f => {
      if (f.formular_erhalten) return;
      if (f.status === "erledigt") return;
      if (seen.has(f.customer_id)) return;
      seen.add(f.customer_id);
      const cust = (customers || []).find(c => c.id === f.customer_id) || {};
      if (cust.aktiv === false) return;
      result.push({
        customer_id:  f.customer_id,
        company_name: cust.company_name || "(unbekannt)",
        strasse:      cust.strasse || "",
        plz:          cust.plz || "",
        ort:          cust.ort || "",
        kategorie:    f.category || "",
        jahr:         f.jahr ?? null,
      });
    });
    return result.sort((a, b) => a.company_name.localeCompare(b.company_name, "de"));
  }, [fristen, customers]);

  const [selected,       setSelected]       = useState(() => new Set(candidates.map(c => c.customer_id)));
  const [letterDate,     setLetterDate]     = useState(today());
  const [subject,        setSubject]        = useState(DEFAULT_SUBJECT);
  const [bodyText,       setBodyText]       = useState(DEFAULT_BODY);
  const [showPreview,    setShowPreview]    = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [logoUrl]                           = useState("/artis-logo.png");

  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  const toggle      = id => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll   = () => allSelected ? setSelected(new Set()) : setSelected(new Set(candidates.map(c => c.customer_id)));
  const recipients  = candidates.filter(c => selected.has(c.customer_id));

  const loadVorlage = (vorlage) => {
    if (!vorlage) return;
    setSubject(vorlage.subject);
    setBodyText(vorlage.body);
    toast.success(`Vorlage "${vorlage.name}" geladen`);
  };

  const handleSaveVorlage = (name) => {
    createVorlageMut.mutate({ name, subject, body: bodyText, sort_order: vorlagen.length });
    setShowSaveDialog(false);
  };

  const handlePrint = () => {
    if (recipients.length === 0) return;
    const html = generatePrintHtml(recipients, letterDate, subject, bodyText, logoUrl);
    const win = window.open("", "_blank");
    if (!win) { alert("Popup blockiert. Bitte Popups f\u00fcr diese Seite erlauben."); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 700);
  };

  const inp = {
    background:   s.inputBg,
    border:       "1px solid " + s.inputBorder,
    color:        s.textMain,
    borderRadius: 6,
    padding:      "5px 8px",
    fontSize:     13,
    width:        "100%",
    outline:      "none",
  };

  const previewR    = recipients[0];
  const previewKat  = previewR?.kategorie || "Steuer";
  const previewJahr = previewR?.jahr != null ? String(previewR.jahr) : "";
  const resolve     = t => t.split("__KATEGORIE__").join(previewKat).split("__JAHR__").join(previewJahr);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 14, padding: 28, width: 740, maxHeight: "92vh", overflowY: "auto", position: "relative" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ color: s.textMain, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Printer size={17} /> Briefe generieren
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={20} /></button>
        </div>

        {candidates.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: s.textMuted, padding: "24px 0" }}>
            <AlertTriangle size={16} />
            <span>Keine Kunden ohne Formular-Eingang gefunden.</span>
          </div>
        ) : (
          <>
            {/* Empf\u00e4nger */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: s.textMain, fontWeight: 600, fontSize: 13 }}>
                  Empf\u00e4nger ({recipients.length} von {candidates.length})
                </span>
                <button onClick={toggleAll} style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 12, textDecoration: "underline" }}>
                  {allSelected ? "Alle abw\u00e4hlen" : "Alle w\u00e4hlen"}
                </button>
              </div>
              <div style={{ border: "1px solid " + border, borderRadius: 8, maxHeight: 190, overflowY: "auto", background: s.inputBg }}>
                {candidates.map(c => (
                  <label key={c.customer_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "pointer", borderBottom: "1px solid " + border, color: s.textMain, fontSize: 13 }}>
                    <input type="checkbox" checked={selected.has(c.customer_id)} onChange={() => toggle(c.customer_id)} style={{ accentColor: accent }} />
                    <span style={{ flex: 1 }}>{c.company_name}</span>
                    <span style={{ color: s.textMuted, fontSize: 11 }}>{c.plz} {c.ort}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Vorlagen-Leiste */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "10px 12px", background: s.rowBg, borderRadius: 8, border: "1px solid " + border }}>
              <BookOpen size={14} style={{ color: s.textMuted, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: s.textMuted, flexShrink: 0 }}>Vorlage:</span>
              <select
                defaultValue=""
                onChange={e => { const v = vorlagen.find(x => x.id === e.target.value); if (v) loadVorlage(v); e.target.value = ""; }}
                style={{ ...inp, flex: 1, cursor: "pointer", fontSize: 12 }}
              >
                <option value="">-- Vorlage laden --</option>
                {vorlagen.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              {/* Vorlagen verwalten: L\u00f6schen */}
              {vorlagen.length > 0 && (
                <select
                  defaultValue=""
                  onChange={e => {
                    const id = e.target.value;
                    if (!id) return;
                    const v = vorlagen.find(x => x.id === id);
                    if (v && window.confirm(`Vorlage "${v.name}" l\u00f6schen?`)) deleteVorlageMut.mutate(id);
                    e.target.value = "";
                  }}
                  style={{ ...inp, width: "auto", cursor: "pointer", fontSize: 12, color: "#ef4444" }}
                  title="Vorlage l\u00f6schen"
                >
                  <option value="">L\u00f6schen...</option>
                  {vorlagen.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              )}
              <button onClick={() => setShowSaveDialog(true)}
                style={{ background: accent, border: "none", cursor: "pointer", color: "#fff", borderRadius: 6, padding: "5px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, flexShrink: 0, fontWeight: 600 }}>
                <Save size={12} /> Speichern
              </button>
            </div>

            {/* Datum + Betreff */}
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ color: s.textMuted, fontSize: 12, display: "block", marginBottom: 4 }}>Datum</label>
                <input value={letterDate} onChange={e => setLetterDate(e.target.value)} style={inp} />
              </div>
              <div>
                <label style={{ color: s.textMuted, fontSize: 12, display: "block", marginBottom: 4 }}>
                  Betreff <small style={{ opacity: 0.65 }}>(Platzhalter: __JAHR__, __KATEGORIE__)</small>
                </label>
                <input value={subject} onChange={e => setSubject(e.target.value)} style={inp} />
              </div>
            </div>

            {/* Brieftext */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ color: s.textMuted, fontSize: 12, display: "block", marginBottom: 4 }}>
                Brieftext <small style={{ opacity: 0.65 }}>(Platzhalter: __JAHR__, __KATEGORIE__)</small>
              </label>
              <textarea
                value={bodyText}
                onChange={e => setBodyText(e.target.value)}
                rows={9}
                style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}
              />
            </div>

            {/* Aktionen */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
              <button onClick={() => setShowPreview(v => !v)}
                style={{ background: "none", border: "1px solid " + border, color: s.textMuted, borderRadius: 6, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                {showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Vorschau
              </button>
              <Button onClick={handlePrint} disabled={recipients.length === 0}
                style={{ background: accent, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                <Printer size={14} />
                {recipients.length} Brief{recipients.length !== 1 ? "e" : ""} drucken
              </Button>
            </div>

            {/* Vorschau */}
            {showPreview && previewR && (
              <div style={{ marginTop: 18, border: "1px solid " + border, borderRadius: 8, padding: 18, background: "#fff", color: "#222", maxHeight: 380, overflowY: "auto" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 10, fontWeight: 600 }}>
                  Vorschau \u2013 {previewR.company_name}
                </div>
                <div style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
                  {/* Briefkopf: Absender ohne Telefon */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "0.5px solid #bbb", paddingBottom: 4, marginBottom: 12 }}>
                    <span style={{ fontSize: 8, color: "#666" }}>
                      {SENDER_NAME} \u00b7 {SENDER_STREET} \u00b7 {SENDER_CITY} \u00b7 {SENDER_EMAIL}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: "bold", color: "#2d5a2d", marginLeft: 12 }}>{SENDER_NAME}</span>
                  </div>
                  {/* Empf\u00e4nger */}
                  <div style={{ marginBottom: 14, lineHeight: 1.6, fontSize: 10 }}>
                    <div>{previewR.company_name}</div>
                    {previewR.strasse && <div>{previewR.strasse}</div>}
                    <div>{[previewR.plz, previewR.ort].filter(Boolean).join(" ")}</div>
                  </div>
                  {/* Ort + Datum: rechtsb\u00fcndig */}
                  <div style={{ textAlign: "right", marginBottom: 10, fontSize: 10 }}>
                    {LETTER_CITY}, {letterDate}
                  </div>
                  <div style={{ fontWeight: "bold", marginBottom: 8, fontSize: 10 }}>{resolve(subject)}</div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 10 }}>{resolve(bodyText)}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Vorlage-Speichern Dialog */}
      {showSaveDialog && (
        <SaveTemplateDialog
          onSave={handleSaveVorlage}
          onCancel={() => setShowSaveDialog(false)}
          s={s} border={border} accent={accent}
        />
      )}
    </div>
  );
}
