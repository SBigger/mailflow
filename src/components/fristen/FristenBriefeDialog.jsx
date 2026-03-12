import React, { useState, useMemo, useContext } from "react";
import { X, Printer, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";

function today() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  return dd+"."+mm+"."+d.getFullYear();
}
const SENDER_NAME   = "Artis Treuhand GmbH";
const SENDER_STREET = "Trischlistrasse 10";
const SENDER_CITY   = "9400 Rorschach";
const SENDER_PHONE  = "+41 71 844 04 58";
const SENDER_EMAIL  = "info@artis-gmbh.ch";
const LETTER_CITY   = "Rorschach";

function generatePrintHtml(recipients, letterDate, subject, bodyTemplate, logoUrl) {
  const pages = recipients.map(r => {
    const kategorie = r.kategorie || "Steuer";
    const jahr = r.jahr != null ? String(r.jahr) : String(new Date().getFullYear() - 1);
    const resolvedSubject = subject.split("__KATEGORIE__").join(kategorie).split("__JAHR__").join(jahr);
    const resolvedBody = bodyTemplate.split("__KATEGORIE__").join(kategorie).split("__JAHR__").join(jahr);
    const bodyHtml = resolvedBody
      .split("\n")
      .map(l => l === "" ? "<br/>" : "<p>" + l + "</p>")
      .join("");
    return (
      "<div class=\"page\">" +
      "<div class=\"letterhead\">" +
      "<div class=\"sender-line\">" + SENDER_NAME + " &middot; " + SENDER_STREET + " &middot; " + SENDER_CITY + " &middot; " + SENDER_PHONE + " &middot; " + SENDER_EMAIL + "</div>" +
      (logoUrl ? "<img class=\"logo\" src=\"" + logoUrl + "\" alt=\"Logo\" />" : "<span class=\"logo-text\">" + SENDER_NAME + "</span>") +
      "</div>" +
      "<div class=\"hline\"></div>" +
      "<div class=\"recipient\">" +
      "<div>" + r.company_name + "</div>" +
      (r.strasse ? "<div>" + r.strasse + "</div>" : "") +
      "<div>" + [r.plz, r.ort].filter(Boolean).join(" ") + "</div>" +
      "</div>" +
      "<div class=\"date\">" + LETTER_CITY + ", " + letterDate + "</div>" +
      "<div class=\"subject\">" + resolvedSubject + "</div>" +
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
    ".sender-line { font-size: 7.5pt; color: #666; flex: 1; padding-bottom: 1mm; border-bottom: 0.5pt solid #aaa; }" +
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

export default function FristenBriefeDialog({ fristen, customers, onClose }) {
  const { style: s } = useContext(ThemeContext);

  const candidates = useMemo(() => {
    const seen = new Set();
    const result = [];
    (fristen || []).forEach(f => {
      if (f.formular_erhalten) return;
      if (f.status === "erledigt") return;
      if (seen.has(f.customer_id)) return;
      seen.add(f.customer_id);
      const cust = (customers || []).find(c => c.id === f.customer_id) || {};
      result.push({
        customer_id: f.customer_id,
        company_name: cust.company_name || "(unbekannt)",
        strasse: cust.strasse || "",
        plz: cust.plz || "",
        ort: cust.ort || "",
        kategorie: f.category || "",
        jahr: f.jahr ?? null,
      });
    });
    return result.sort((a, b) => a.company_name.localeCompare(b.company_name, "de"));
  }, [fristen, customers]);

  const [selected, setSelected]     = useState(() => new Set(candidates.map(c => c.customer_id)));
  const [letterDate, setLetterDate] = useState(today());
  const [subject, setSubject]       = useState("Einreichung Steuererklärung __JAHR__");
  const [bodyText, setBodyText]     = useState(
    "Sehr geehrte Damen und Herren\n\n" +
    "Wir erlauben uns, Sie höflich daran zu erinnern, dass wir für die Erstellung\n" +
    "Ihrer Steuererklärung __JAHR__ noch Ihre Unterlagen benötigen.\n\n" +
    "Wir bitten Sie, uns die Unterlagen baldmöglichst zukommen zu lassen.\n\n" +
    "Für Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\n" +
    "Freundliche Grüsse\n\n" +
    SENDER_NAME + "\n" + SENDER_PHONE + " | " + SENDER_EMAIL
  );
  const [showPreview, setShowPreview] = useState(false);
  const [logoUrl]                     = useState("/artis-logo.png");

  const allSelected = candidates.length > 0 && selected.size === candidates.length;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(candidates.map(c => c.customer_id)));
  };

  const toggle = id => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const recipients = candidates.filter(c => selected.has(c.customer_id));

  const handlePrint = () => {
    if (recipients.length === 0) return;
    const html = generatePrintHtml(recipients, letterDate, subject, bodyText, logoUrl);
    const win = window.open("", "_blank");
    if (!win) { alert("Popup blockiert. Bitte Popups für diese Seite erlauben."); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 700);
  };

  const inp = {
    background: s.inputBg || s.cardBg,
    border: "1px solid " + (s.inputBorder || s.border),
    color: s.textMain,
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 13,
    width: "100%",
    outline: "none",
  };

  const previewR   = recipients[0];
  const previewKat  = previewR?.kategorie || "Steuer";
  const previewJahr = previewR?.jahr != null ? String(previewR.jahr) : "";
  const resolve = t => t.split("__KATEGORIE__").join(previewKat).split("__JAHR__").join(previewJahr);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: s.cardBg,
        border: "1px solid " + s.border,
        borderRadius: 14,
        padding: 28,
        width: 720,
        maxHeight: "92vh",
        overflowY: "auto",
        position: "relative",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ color: s.textMain, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Printer size={17} /> Briefe generieren
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}>
            <X size={20} />
          </button>
        </div>

        {candidates.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: s.textMuted, padding: "24px 0" }}>
            <AlertTriangle size={16} />
            <span>Keine Kunden ohne Formular-Eingang gefunden.</span>
          </div>
        ) : (
          <>
            {/* Empfänger-Liste */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: s.textMain, fontWeight: 600, fontSize: 13 }}>
                  Empfänger ({recipients.length} von {candidates.length})
                </span>
                <button onClick={toggleAll} style={{ background: "none", border: "none", cursor: "pointer", color: s.accentBg, fontSize: 12, textDecoration: "underline" }}>
                  {allSelected ? "Alle abwählen" : "Alle wählen"}
                </button>
              </div>
              <div style={{ border: "1px solid " + s.border, borderRadius: 8, maxHeight: 190, overflowY: "auto", background: s.inputBg || s.cardBg }}>
                {candidates.map(c => (
                  <label key={c.customer_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "pointer", borderBottom: "1px solid " + s.border, color: s.textMain, fontSize: 13 }}>
                    <input type="checkbox" checked={selected.has(c.customer_id)} onChange={() => toggle(c.customer_id)} style={{ accentColor: s.accentBg }} />
                    <span style={{ flex: 1 }}>{c.company_name}</span>
                    <span style={{ color: s.textMuted, fontSize: 11 }}>{c.plz} {c.ort}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Einstellungen */}
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ color: s.textMuted, fontSize: 12, display: "block", marginBottom: 4 }}>Datum</label>
                <input value={letterDate} onChange={e => setLetterDate(e.target.value)} style={inp} />
              </div>
              <div>
                <label style={{ color: s.textMuted, fontSize: 12, display: "block", marginBottom: 4 }}>
                  Betreff{" "}
                  <small style={{ opacity: 0.65 }}>(Platzhalter: __JAHR__, __KATEGORIE__)</small>
                </label>
                <input value={subject} onChange={e => setSubject(e.target.value)} style={inp} />
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ color: s.textMuted, fontSize: 12, display: "block", marginBottom: 4 }}>
                Brieftext{" "}
                <small style={{ opacity: 0.65 }}>(Platzhalter: __JAHR__, __KATEGORIE__)</small>
              </label>
              <textarea
                value={bodyText}
                onChange={e => setBodyText(e.target.value)}
                rows={8}
                style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}
              />
            </div>

            {/* Aktionen */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setShowPreview(v => !v)}
                style={{ background: "none", border: "1px solid " + s.border, color: s.textMuted, borderRadius: 6, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}
              >
                {showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Vorschau
              </button>
              <Button
                onClick={handlePrint}
                disabled={recipients.length === 0}
                style={{ background: s.accentBg, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}
              >
                <Printer size={14} />
                {recipients.length} Brief{recipients.length !== 1 ? "e" : ""} drucken
              </Button>
            </div>

            {/* Vorschau */}
            {showPreview && previewR && (
              <div style={{ marginTop: 18, border: "1px solid " + s.border, borderRadius: 8, padding: 18, background: "#fff", color: "#222", maxHeight: 340, overflowY: "auto" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 10, fontWeight: 600 }}>
                  Vorschau – {previewR.company_name}
                </div>
                <div style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "0.5px solid #bbb", paddingBottom: 3, marginBottom: 10 }}>
                    <span style={{ fontSize: 8, color: "#666" }}>{SENDER_NAME} · {SENDER_STREET} · {SENDER_CITY} · {SENDER_PHONE}</span>
                    <span style={{ fontSize: 9, fontWeight: "bold", color: "#2d5a2d" }}>{SENDER_NAME}</span>
                  </div>
                  <div style={{ marginBottom: 12, lineHeight: 1.5, fontSize: 10 }}>
                    <div>{previewR.company_name}</div>
                    {previewR.strasse && <div>{previewR.strasse}</div>}
                    <div>{[previewR.plz, previewR.ort].filter(Boolean).join(" ")}</div>
                  </div>
                  <div style={{ textAlign: "right", marginBottom: 8, fontSize: 10 }}>{LETTER_CITY}, {letterDate}</div>
                  <div style={{ fontWeight: "bold", marginBottom: 6, fontSize: 10 }}>{resolve(subject)}</div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 10 }}>{resolve(bodyText)}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
