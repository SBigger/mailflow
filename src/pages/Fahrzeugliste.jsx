import React, { useState, useContext, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  Car, Wrench, ChevronRight, Plus, Trash2, Edit3, Save, X,
  FileText, Download, Link, ExternalLink,
  ChevronDown, ChevronUp, AlertCircle, Calculator, Search
} from "lucide-react";

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

// Leere Strings / 0-Strings zu null konvertieren (für DB-Felder)
function toNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
// Leere Strings zu null für Datum-Felder
function toNullDate(v) {
  if (!v || String(v).trim() === "") return null;
  return v;
}

function fmtCHF(val, digits = 2) {
  if (val === null || val === undefined || isNaN(Number(val))) return "—";
  return Number(val).toLocaleString("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function calcPrivatanteil(fz) {
  if (fz.ausschliesslich_geschaeftlich) return { pa_month: 0, pa_month_brutto: 0, pa_year: 0, mwst: 0, lohnausweis: 0, selbst: 0 };
  const basis = fz.leasing
    ? (parseFloat(fz.leasing_barkaufpreis) || 0)
    : (parseFloat(fz.kaufpreis_exkl_mwst) || 0);
  if (basis <= 0) return { pa_month: 0, pa_month_brutto: 0, pa_year: 0, mwst: 0, lohnausweis: 0, selbst: 0 };
  const pa_month_brutto = Math.max(basis * 0.009, 150);
  const selbst = parseFloat(fz.fahrer_selbstbezahlt_monat) || 0;
  const pa_month = Math.max(pa_month_brutto - selbst, 0);
  const monate = Math.min(Math.max(parseInt(fz.monate_im_betrieb) || 12, 1), 12);
  const pa_year = pa_month * monate;
  const mwst = pa_year * 8.1 / 108.1;
  return { pa_month, pa_month_brutto, pa_year, mwst, lohnausweis: pa_year, basis, selbst };
}

function todayStr() {
  return new Date().toLocaleDateString("de-CH");
}

function exportCSV(fahrzeuge, customerName) {
  const headers = [
    "Kennzeichen", "Marke", "Modell", "Fahrzeugart", "Fahrer",
    "Kaufpreis exkl. MWST", "Leasing", "Leasing-Barkaufpreis", "Leasingbeginn", "Laufzeit Ende", "Anz. Raten", "Monatl. Rate CHF", "Erste Rate CHF", "Restwert CHF",
    "Monate im Betrieb", "Eigenanteil Fahrer/Mt", "Privatanteil/Mt (CHF)",
    "Privatanteil/Jahr (CHF)", "MWST 8.1% (Ziff. 415)",
    "Lohnausweis Ziff. 2.2", "Feld F (unentgeltl. Befördg.)", "Fahrtenbuch",
    "Ausschl. geschäftlich", "Chassisnummer", "Anschaffungsjahr", "Notizen"
  ];
  const rows = fahrzeuge.map(fz => {
    const c = calcPrivatanteil(fz);
    return [
      fz.kennzeichen, fz.marke, fz.modell, fz.fahrzeugart, fz.fahrer_name,
      fz.kaufpreis_exkl_mwst ?? "", fz.leasing ? "Ja" : "Nein",
      fz.leasing ? (fz.leasing_barkaufpreis ?? "") : "",
      fz.leasing ? (fz.leasing_startdatum ?? "") : "",
      fz.leasing ? (fz.leasing_laufzeit_bis ?? "") : "",
      fz.leasing ? (fz.leasing_anzahl_raten ?? "") : "",
      fz.leasing ? (fz.leasing_monatliche_rate ?? "") : "",
      fz.leasing ? (fz.leasing_erste_rate ?? "") : "",
      fz.leasing ? (fz.leasing_restwert ?? "") : "",
      fz.monate_im_betrieb,
      fz.fahrer_selbstbezahlt_monat ?? 0,
      c.pa_month.toFixed(2), c.pa_year.toFixed(2),
      c.mwst.toFixed(2), c.lohnausweis.toFixed(2),
      fz.unentgeltliche_befoerderung ? "Ja" : "Nein",
      fz.fahrtenbuch ? "Ja" : "Nein",
      fz.ausschliesslich_geschaeftlich ? "Ja" : "Nein",
      fz.chassis_nummer, fz.anschaffungsjahr ?? "",
      fz.notizen,
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";");
  });

  // Totals
  const totals = fahrzeuge.reduce((acc, fz) => {
    const c = calcPrivatanteil(fz);
    acc.pa_year += c.pa_year;
    acc.mwst += c.mwst;
    return acc;
  }, { pa_year: 0, mwst: 0 });

  const totalRow = ["", "", "", "", "", "", "", "", "", "", "TOTAL",
    "", totals.pa_year.toFixed(2), totals.mwst.toFixed(2), totals.pa_year.toFixed(2),
    "", "", "", "", "", ""]
    .map(v => `"${v}"`).join(";");

  const bom = "\uFEFF";  // UTF-8 BOM für Excel
  const csv = bom + [
    `"Fahrzeugliste – ${customerName}"`,
    `"Erstellt am: ${todayStr()}"`,
    "",
    headers.map(h => `"${h}"`).join(";"),
    ...rows,
    "",
    totalRow,
  ].join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Fahrzeugliste_${customerName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().getFullYear()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Leeres Fahrzeug-Objekt ───────────────────────────────────────────────────
const EMPTY = {
  kennzeichen: "", marke: "", modell: "", fahrzeugart: "Personenwagen",
  chassis_nummer: "", anschaffungsjahr: "",
  kaufpreis_exkl_mwst: "", leasing: false, leasing_barkaufpreis: "",
  leasing_startdatum: "", leasing_laufzeit_bis: "",
  leasing_anzahl_raten: "", leasing_erste_rate: "",
  leasing_monatliche_rate: "", leasing_restwert: "",
  leasing_vertrag_url: "", leasing_dokument_id: null,
  _leasing_dok_filename: "",
  monate_im_betrieb: 12, fahrer_name: "", fahrer_selbstbezahlt_monat: "",
  unentgeltliche_befoerderung: false, fahrtenbuch: false,
  effektive_privatkilometer: "", ausschliesslich_geschaeftlich: false,
  notizen: "", sort_order: 0,
};

// Auto-berechne Anzahl Raten aus Start- und Enddatum
function calcRaten(startdatum, laufzeit_bis) {
  if (!startdatum || !laufzeit_bis) return "";
  const s = new Date(startdatum);
  const e = new Date(laufzeit_bis);
  if (isNaN(s) || isNaN(e) || e <= s) return "";
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
}

const FAHRZEUGARTEN = [
  "Personenwagen", "Kombi", "SUV", "Lieferwagen", "Transporter",
  "Elektrofahrzeug", "Hybridfahrzeug", "Motorrad", "LKW", "Sonstiges",
];

// ── Checkbox-Komponente ──────────────────────────────────────────────────────
function CB({ checked, onChange, label, color }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors"
        style={{
          backgroundColor: checked ? color : "transparent",
          borderColor: checked ? color : "#9ca3af",
        }}
      >
        {checked && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
      </button>
      {label && <span className="text-xs" style={{ color: "#6b7280" }}>{label}</span>}
    </label>
  );
}

// ── Dateiablage-Modal ────────────────────────────────────────────────────────
function DateiablageModal({ customerId, onSelect, onClose, theme, accent }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const overlayBg = "rgba(0,0,0,0.5)";
  const panelBg = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a";
  const borderC = isArtis ? "#ccd8cc" : isLight ? "#e2e2ec" : "#3f3f46";
  const headingC = isArtis ? "#1a3a1a" : isLight ? "#1e293b" : "#e4e4e7";
  const subC = isArtis ? "#4a6a4a" : isLight ? "#64748b" : "#a1a1aa";
  const rowHover = isLight ? "#f8f8fc" : isArtis ? "#f0f5f0" : "#2f2f35";

  const { data: dokumente = [], isLoading } = useQuery({
    queryKey: ["dokumente_dateiablage", customerId],
    queryFn: () => supabase
      .from("dokumente")
      .select("id, filename, category, tags, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => { if (error) throw error; return data || []; }),
    enabled: !!customerId,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: overlayBg }}>
      <div className="rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        style={{ backgroundColor: panelBg, border: `1px solid ${borderC}`, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${borderC}`, backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
          <div className="flex items-center gap-2">
            <Link className="w-4 h-4" style={{ color: accent }} />
            <span className="text-sm font-semibold" style={{ color: headingC }}>Dokument aus Dateiablage wählen</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X className="w-4 h-4" style={{ color: subC }} /></button>
        </div>
        {/* Liste */}
        <div className="overflow-y-auto flex-1">
          {isLoading && <div className="px-4 py-8 text-sm text-center" style={{ color: subC }}>Lädt…</div>}
          {!isLoading && dokumente.length === 0 && (
            <div className="px-4 py-8 text-sm text-center" style={{ color: subC }}>
              Keine Dokumente für diesen Kunden in der Dateiablage gefunden.
            </div>
          )}
          {dokumente.map(dok => (
            <button key={dok.id} type="button"
              onClick={() => onSelect(dok)}
              className="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors"
              style={{ borderBottom: `1px solid ${borderC}` }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHover}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
              <FileText className="w-4 h-4 flex-shrink-0" style={{ color: accent }} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate" style={{ color: headingC }}>{dok.filename}</div>
                <div className="text-[10px]" style={{ color: subC }}>
                  {dok.category && <span className="mr-2">{dok.category}</span>}
                  {new Date(dok.created_at).toLocaleDateString("de-CH")}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Fahrzeug-Formular (Inline) ───────────────────────────────────────────────
function FahrzeugForm({ initial, onSave, onCancel, theme, accent, customerId }) {
  const [f, setF] = useState({ ...EMPTY, ...initial });
  const [showDateiablage, setShowDateiablage] = useState(false);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const calc = calcPrivatanteil(f);
  const inputBg = "#ffffff";
  const borderC = isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#d1d5db";
  const textC = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#1f2937";
  const labelC = isArtis ? "#6b826b" : isLight ? "#7070a0" : "#6b7280";
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const inpStyle = {
    backgroundColor: inputBg, border: `1px solid ${borderC}`,
    color: textC, borderRadius: 6, padding: "4px 8px",
    fontSize: 12, outline: "none", width: "100%",
  };
  const labelStyle = { color: labelC, fontSize: 10, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 2 };

  return (
    <div className="p-4 rounded-xl space-y-4" style={{
      backgroundColor: isArtis ? "#f5f8f5" : isLight ? "#f7f7fc" : "#27272a",
      border: `2px solid ${accent}`,
    }}>

      {/* ── Zeile 1: Identifikation ── */}
      <div>
        <div className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: accent }}>
          Fahrzeug-Identifikation
        </div>
        <div className="grid grid-cols-5 gap-2">
          <div>
            <label style={labelStyle}>Kennzeichen *</label>
            <input value={f.kennzeichen} onChange={e => set("kennzeichen", e.target.value)}
              placeholder="SG 12345" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Marke *</label>
            <input value={f.marke} onChange={e => set("marke", e.target.value)}
              placeholder="VW" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Modell</label>
            <input value={f.modell} onChange={e => set("modell", e.target.value)}
              placeholder="Golf" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Fahrzeugart</label>
            <select value={f.fahrzeugart} onChange={e => set("fahrzeugart", e.target.value)}
              style={{ ...inpStyle, height: 26 }}>
              {FAHRZEUGARTEN.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Baujahr</label>
            <input value={f.anschaffungsjahr} onChange={e => set("anschaffungsjahr", e.target.value)}
              placeholder="2023" type="number" style={inpStyle} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label style={labelStyle}>Chassisnummer (VIN)</label>
            <input value={f.chassis_nummer} onChange={e => set("chassis_nummer", e.target.value)}
              placeholder="WV1ZZZ..." style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Fahrer</label>
            <input value={f.fahrer_name} onChange={e => set("fahrer_name", e.target.value)}
              placeholder="Max Muster" style={inpStyle} />
          </div>
        </div>
      </div>

      {/* ── Zeile 2: Finanzdaten ── */}
      <div>
        <div className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: accent }}>
          Finanzdaten & Privatanteil
        </div>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <div>
            <label style={labelStyle}>Kaufpreis exkl. MWST *</label>
            <input value={f.kaufpreis_exkl_mwst} onChange={e => set("kaufpreis_exkl_mwst", e.target.value)}
              placeholder="40000.00" type="number" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Monate im Betrieb</label>
            <input value={f.monate_im_betrieb} onChange={e => set("monate_im_betrieb", e.target.value)}
              type="number" min="1" max="12" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Eigenanteil Fahrer/Mt</label>
            <input value={f.fahrer_selbstbezahlt_monat} onChange={e => set("fahrer_selbstbezahlt_monat", e.target.value)}
              placeholder="0.00" type="number" style={inpStyle} />
          </div>
          <div className="flex flex-col justify-end pb-0.5">
            <CB checked={f.ausschliesslich_geschaeftlich}
              onChange={v => set("ausschliesslich_geschaeftlich", v)}
              label="Ausschliesslich geschäftlich" color={accent} />
          </div>
        </div>

        {/* Leasing */}
        <div className="rounded-lg p-3 space-y-3" style={{
          backgroundColor: f.leasing ? (isArtis ? "#e8f2e8" : isLight ? "#eef2ff" : "#1e1e2e") : "transparent",
          border: `1px dashed ${f.leasing ? accent : borderC}`,
        }}>
          <CB checked={f.leasing} onChange={v => set("leasing", v)}
            label="Leasingfahrzeug (Barkaufpreis aus Vertrag verwenden)" color={accent} />
          {f.leasing && (<>
            {/* Zeile 1: Barkaufpreis + Laufzeit */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label style={labelStyle}>Barkaufpreis exkl. MWST *</label>
                <input value={f.leasing_barkaufpreis} onChange={e => set("leasing_barkaufpreis", e.target.value)}
                  placeholder="Laut Vertrag" type="number" style={inpStyle} />
              </div>
              <div>
                <label style={labelStyle}>Leasingbeginn</label>
                <input value={f.leasing_startdatum} type="date" style={inpStyle}
                  onChange={e => {
                    const nd = e.target.value;
                    const raten = calcRaten(nd, f.leasing_laufzeit_bis);
                    setF(p => ({ ...p, leasing_startdatum: nd, leasing_anzahl_raten: raten !== "" ? raten : p.leasing_anzahl_raten }));
                  }} />
              </div>
              <div>
                <label style={labelStyle}>Laufzeit Ende</label>
                <input value={f.leasing_laufzeit_bis} type="date" style={inpStyle}
                  onChange={e => {
                    const nd = e.target.value;
                    const raten = calcRaten(f.leasing_startdatum, nd);
                    setF(p => ({ ...p, leasing_laufzeit_bis: nd, leasing_anzahl_raten: raten !== "" ? raten : p.leasing_anzahl_raten }));
                  }} />
              </div>
            </div>
            {/* Zeile 2: Raten-Details */}
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label style={labelStyle}>
                  Anz. Raten
                  {calcRaten(f.leasing_startdatum, f.leasing_laufzeit_bis) !== "" && (
                    <span className="ml-1 text-[9px]" style={{ color: accent }}>(auto)</span>
                  )}
                </label>
                <input value={f.leasing_anzahl_raten} onChange={e => set("leasing_anzahl_raten", e.target.value)}
                  type="number" min="1" placeholder="z.B. 48" style={inpStyle} />
              </div>
              <div>
                <label style={labelStyle}>Monatl. Rate CHF</label>
                <input value={f.leasing_monatliche_rate} onChange={e => set("leasing_monatliche_rate", e.target.value)}
                  type="number" min="0" placeholder="0.00" style={inpStyle} />
              </div>
              <div>
                <label style={labelStyle}>Erste Rate CHF</label>
                <input value={f.leasing_erste_rate} onChange={e => set("leasing_erste_rate", e.target.value)}
                  type="number" min="0" placeholder="Sonderzahlung" style={inpStyle} />
              </div>
              <div>
                <label style={labelStyle}>Restwert CHF</label>
                <input value={f.leasing_restwert} onChange={e => set("leasing_restwert", e.target.value)}
                  type="number" min="0" placeholder="Fakultativ" style={inpStyle} />
              </div>
            </div>
            {/* Leasing-Zusammenfassung */}
            {f.leasing_anzahl_raten && f.leasing_monatliche_rate && (
              <div className="text-xs rounded px-3 py-1.5 flex gap-4 flex-wrap"
                style={{ backgroundColor: isArtis ? "#ddeedd" : "#eff6ff", color: "#374151" }}>
                <span>
                  <span style={{ color: "#6b7280" }}>Total Raten: </span>
                  <strong style={{ color: accent }}>CHF {fmtCHF(
                    (parseFloat(f.leasing_erste_rate) || parseFloat(f.leasing_monatliche_rate) || 0) +
                    Math.max(0, (parseInt(f.leasing_anzahl_raten) || 0) - 1) * (parseFloat(f.leasing_monatliche_rate) || 0)
                  )}</strong>
                </span>
                {f.leasing_restwert && <span>
                  <span style={{ color: "#6b7280" }}>+ Restwert: </span>
                  <strong>CHF {fmtCHF(parseFloat(f.leasing_restwert))}</strong>
                </span>}
              </div>
            )}
            {/* Leasingvertrag – Dateiablage-Verlinkung */}
            <div>
              <label style={labelStyle}>Leasingvertrag (aus Dateiablage)</label>
              {f.leasing_dokument_id ? (
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3 flex-shrink-0" style={{ color: accent }} />
                  <span className="text-xs font-medium" style={{ color: accent }}>
                    {f._leasing_dok_filename || "Dokument verknüpft"}
                  </span>
                  <button type="button"
                    onClick={() => { set("leasing_dokument_id", null); set("_leasing_dok_filename", ""); }}
                    className="text-red-400 hover:text-red-600 ml-1" title="Verknüpfung entfernen">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button type="button"
                  onClick={() => setShowDateiablage(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors"
                  style={{ color: accent, border: `1px solid ${accent}` }}>
                  <Link className="w-3 h-3" />
                  Aus Dateiablage wählen
                </button>
              )}
              {showDateiablage && (
                <DateiablageModal
                  customerId={customerId}
                  theme={theme}
                  accent={accent}
                  onClose={() => setShowDateiablage(false)}
                  onSelect={(dok) => {
                    set("leasing_dokument_id", dok.id);
                    set("_leasing_dok_filename", dok.filename);
                    setShowDateiablage(false);
                  }}
                />
              )}
            </div>
          </>)}
        </div>
      </div>

      {/* ── Zeile 3: Nutzung & Checkboxen ── */}
      <div>
        <div className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: accent }}>
          Nutzung & Deklaration
        </div>
        <div className="flex flex-wrap gap-6">
          <CB checked={f.unentgeltliche_befoerderung}
            onChange={v => set("unentgeltliche_befoerderung", v)}
            label="Unentgeltliche Beförderung (Lohnausweis Feld F)" color={accent} />
          <CB checked={f.fahrtenbuch}
            onChange={v => set("fahrtenbuch", v)}
            label="Fahrtenbuch wird geführt" color={accent} />
          {f.fahrtenbuch && (
            <div className="flex items-center gap-1">
              <label style={{ ...labelStyle, marginBottom: 0 }}>Privatkilometer/Jahr:</label>
              <input value={f.effektive_privatkilometer} onChange={e => set("effektive_privatkilometer", e.target.value)}
                type="number" placeholder="km" style={{ ...inpStyle, width: 80 }} />
            </div>
          )}
        </div>
        <div className="mt-2">
          <label style={labelStyle}>Notizen</label>
          <input value={f.notizen} onChange={e => set("notizen", e.target.value)}
            placeholder="Zusätzliche Hinweise..." style={inpStyle} />
        </div>
      </div>

      {/* ── Berechnete Werte ── */}
      {!f.ausschliesslich_geschaeftlich && calc.basis > 0 && (
        <div className="rounded-lg p-3" style={{
          backgroundColor: isArtis ? "#ddeedd" : isLight ? "#eff6ff" : "#1a1a2e",
          border: `1px solid ${isArtis ? "#b0c8b0" : isLight ? "#bfdbfe" : "#2d2d4e"}`,
        }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Calculator className="w-3.5 h-3.5" style={{ color: accent }} />
            <span className="text-xs font-bold tracking-wide uppercase" style={{ color: accent }}>
              Berechneter Privatanteil
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div>
              <div style={{ color: labelC }}>Basis (exkl. MWST)</div>
              <div className="font-semibold" style={{ color: textC }}>CHF {fmtCHF(calc.basis)}</div>
            </div>
            <div>
              <div style={{ color: labelC }}>PA brutto / Monat</div>
              <div className="font-semibold" style={{ color: textC }}>CHF {fmtCHF(calc.pa_month_brutto)}</div>
              <div style={{ color: labelC, fontSize: 9 }}>max(Basis×0.9%, 150)</div>
              {calc.selbst > 0 && (
                <div style={{ color: labelC, fontSize: 9 }}>− Eigenanteil CHF {fmtCHF(calc.selbst)}</div>
              )}
              {calc.selbst > 0 && (
                <div className="font-semibold" style={{ color: calc.pa_month === 0 ? "#ef4444" : accent, fontSize: 11 }}>
                  = CHF {fmtCHF(calc.pa_month)} netto
                </div>
              )}
            </div>
            <div>
              <div style={{ color: labelC }}>Lohnausweis Ziff. 2.2</div>
              <div className="font-bold text-sm" style={{ color: accent }}>CHF {fmtCHF(calc.lohnausweis)}</div>
              <div style={{ color: labelC, fontSize: 9 }}>pro Jahr ({f.monate_im_betrieb} Mt.)</div>
            </div>
            <div>
              <div style={{ color: labelC }}>MWST-Anteil (Ziff. 415)</div>
              <div className="font-semibold" style={{ color: "#059669" }}>CHF {fmtCHF(calc.mwst)}</div>
              <div style={{ color: labelC, fontSize: 9 }}>8.1% von {fmtCHF(calc.lohnausweis)}</div>
            </div>
          </div>
        </div>
      )}
      {f.ausschliesslich_geschaeftlich && (
        <div className="rounded-lg px-3 py-2 flex items-center gap-2 text-xs"
          style={{ backgroundColor: isArtis ? "#ddeedd" : "#f0fdf4", color: "#15803d" }}>
          <AlertCircle className="w-3.5 h-3.5" />
          Ausschliesslich geschäftlich → kein Privatanteil, kein Lohnausweis-Eintrag
        </div>
      )}

      {/* ── Buttons ── */}
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={() => {
          // eslint-disable-next-line no-unused-vars
          const { _leasing_dok_filename, ...rest } = f;
          onSave({
            ...rest,
            anschaffungsjahr:           toNull(rest.anschaffungsjahr),
            kaufpreis_exkl_mwst:        toNull(rest.kaufpreis_exkl_mwst),
            monate_im_betrieb:          toNull(rest.monate_im_betrieb),
            fahrer_selbstbezahlt_monat: toNull(rest.fahrer_selbstbezahlt_monat),
            effektive_privatkilometer:  toNull(rest.effektive_privatkilometer),
            leasing_barkaufpreis:       toNull(rest.leasing_barkaufpreis),
            leasing_anzahl_raten:       toNull(rest.leasing_anzahl_raten),
            leasing_monatliche_rate:    toNull(rest.leasing_monatliche_rate),
            leasing_erste_rate:         toNull(rest.leasing_erste_rate),
            leasing_restwert:           toNull(rest.leasing_restwert),
            leasing_startdatum:         toNullDate(rest.leasing_startdatum),
            leasing_laufzeit_bis:       toNullDate(rest.leasing_laufzeit_bis),
            leasing_vertrag_url: rest.leasing_dokument_id ? null : (rest.leasing_vertrag_url || null),
          });
        }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
          style={{ backgroundColor: accent }}>
          <Save className="w-3.5 h-3.5" /> Speichern
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ backgroundColor: "transparent", border: `1px solid ${borderC}`, color: "#6b7280" }}>
          <X className="w-3.5 h-3.5" /> Abbrechen
        </button>
      </div>
    </div>
  );
}

// ── Suchbares Mandanten-Select mit Portal ────────────────────────────────────
function FahrzeuglisteDropdown({ unternehmen, privatpersonen, selectedCid, mitFahrzeugenSet, onChange, panelBg, panelBdr, headingC, subC, accent }) {
  const [open,    setOpen]    = useState(false);
  const [search,  setSearch]  = useState("");
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const inputRef   = useRef(null);

  const allKunden = [...unternehmen, ...privatpersonen];
  const getLabel  = (c) => c.person_type === "privatperson"
    ? [c.anrede, c.nachname, c.vorname].filter(Boolean).join(" ") + (c.ort ? ` · ${c.ort}` : "")
    : c.company_name + (c.ort ? ` · ${c.ort}` : "");

  const selected    = allKunden.find(c => c.id === selectedCid);
  const hasSelected = !!selected && mitFahrzeugenSet.has(selectedCid);

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= 340 ? rect.bottom + 4 : rect.top - 340 - 4;
    setDropPos({ top, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) { setSearch(""); return; }
    calcPos();
    setTimeout(() => inputRef.current?.focus(), 30);
    const onClose  = (e) => { if (!triggerRef.current?.contains(e.target)) setOpen(false); };
    const onScroll = () => calcPos();
    document.addEventListener("mousedown", onClose);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", calcPos);
    return () => {
      document.removeEventListener("mousedown", onClose);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", calcPos);
    };
  }, [open, calcPos]);

  const q = search.trim().toLowerCase();
  const filterKunden = (list) => list.filter(c =>
    !q || getLabel(c).toLowerCase().includes(q)
  );
  const filteredU = filterKunden(unternehmen);
  const filteredP = filterKunden(privatpersonen);

  const renderRow = (c) => {
    const hatFahrzeuge = mitFahrzeugenSet.has(c.id);
    const isActive     = c.id === selectedCid;
    return (
      <div
        key={c.id}
        onMouseDown={e => e.stopPropagation()}
        onClick={() => { onChange(c.id); setOpen(false); }}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", cursor: "pointer", fontSize: 13,
          backgroundColor: isActive ? accent + "20" : "transparent", color: headingC,
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = accent + "12"; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = isActive ? accent + "20" : "transparent"; }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          backgroundColor: hatFahrzeuge ? "#22c55e" : "transparent",
          border: hatFahrzeuge ? "none" : `1.5px solid ${panelBdr}`,
          display: "inline-block",
        }} />
        <span style={{ flex: 1 }}>{getLabel(c)}</span>
        {hatFahrzeuge && <span style={{ fontSize: 10, color: "#22c55e", fontWeight: 600 }}>●</span>}
      </div>
    );
  };

  const dropdown = open && createPortal(
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width,
        backgroundColor: panelBg, border: `1px solid ${panelBdr}`, borderRadius: 10,
        boxShadow: "0 8px 28px rgba(0,0,0,0.16)", zIndex: 999999, overflow: "hidden",
      }}
    >
      {/* Suchfeld */}
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${panelBdr}`, display: "flex", alignItems: "center", gap: 6 }}>
        <Search size={13} style={{ color: subC, flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
          placeholder="Mandant suchen…"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 13, background: "transparent", color: headingC }}
        />
        {search && <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 16, padding: 0 }}>&times;</button>}
      </div>

      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {/* Leer-Option */}
        {!q && (
          <div onClick={() => { onChange(""); setOpen(false); }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13, color: subC }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = accent + "14"}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
            <span style={{ width: 8, height: 8, display: "inline-block" }} />
            – Mandant auswählen –
          </div>
        )}
        {filteredU.length > 0 && (
          <>
            <div style={{ padding: "5px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: subC, borderTop: `1px solid ${panelBdr}`, textTransform: "uppercase" }}>Unternehmen</div>
            {filteredU.map(renderRow)}
          </>
        )}
        {filteredP.length > 0 && (
          <>
            <div style={{ padding: "5px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: subC, borderTop: `1px solid ${panelBdr}`, textTransform: "uppercase" }}>Privatpersonen</div>
            {filteredP.map(renderRow)}
          </>
        )}
        {filteredU.length === 0 && filteredP.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: subC, textAlign: "center" }}>Keine Treffer</div>
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={triggerRef} style={{ flex: 1, maxWidth: 440 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full rounded-lg border text-sm px-3 py-2 focus:outline-none text-left"
        style={{ backgroundColor: panelBg, borderColor: open ? accent : panelBdr, color: headingC, cursor: "pointer", transition: "border-color 0.15s" }}>
        {selected && (
          <span style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            backgroundColor: hasSelected ? "#22c55e" : "transparent",
            border: hasSelected ? "none" : `1.5px solid ${panelBdr}`,
            display: "inline-block",
          }} />
        )}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? getLabel(selected) : "– Mandant auswählen –"}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, color: subC, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

// ── Hauptkomponente ──────────────────────────────────────────────────────────
export default function Fahrzeugliste() {
  const navigate = useNavigate();
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const pageBg    = isLight ? "#f4f4f8"   : isArtis ? "#f2f5f2"   : "#2a2a2f";
  const panelBg   = isLight ? "#ffffff"   : isArtis ? "#ffffff"   : "#27272a";
  const panelBdr  = isLight ? "#e2e2ec"   : isArtis ? "#ccd8cc"   : "#3f3f46";
  const headingC  = isLight ? "#1e293b"   : isArtis ? "#1a3a1a"   : "#e4e4e7";
  const subC      = isLight ? "#64748b"   : isArtis ? "#4a6a4a"   : "#a1a1aa";
  const accent    = isArtis ? "#5b8a5b"   : isLight  ? "#3b6a8a"  : "#3b82f6";
  const accentL   = isArtis ? "#7a9b7a"   : isLight  ? "#5b8aaa"  : "#60a5fa";
  const rowHover  = isLight ? "#f8f8fc"   : isArtis ? "#f0f5f0"   : "#2f2f35";
  const badgeBg   = isLight ? "#f1f5f9"   : isArtis ? "#e8f2e8"   : "#3f3f46";
  const tableBdr  = isLight ? "#e8e8f0"   : isArtis ? "#d4e4d4"   : "#3f3f46";

  const qc = useQueryClient();
  const [selectedCid, setSelectedCid] = useState("");
  const [editingId, setEditingId]     = useState(null);   // null | "new" | uuid

  // ── Daten laden ────────────────────────────────────────────────────────────
  const { data: kunden = [] } = useQuery({
    queryKey: ["customers_all"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  // Welche customer_ids haben bereits Fahrzeug-Einträge?
  const { data: mitFahrzeuge = [] } = useQuery({
    queryKey: ["fahrzeuge_cids"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fahrzeuge").select("customer_id");
      if (error) throw new Error(error.message);
      return [...new Set((data || []).map(r => r.customer_id))];
    },
  });
  const mitFahrzeugenSet = new Set(mitFahrzeuge);

  const unternehmen   = kunden.filter(c => c.person_type !== "privatperson" && c.aktiv !== false);
  const privatpersonen = kunden.filter(c => c.person_type === "privatperson" && c.aktiv !== false);
  const getKundeLabel = (c) => c.person_type === "privatperson"
    ? [c.anrede, c.nachname, c.vorname].filter(Boolean).join(" ")
    : c.company_name;

  const { data: fahrzeuge = [], isLoading } = useQuery({
    queryKey: ["fahrzeuge", selectedCid],
    queryFn: () => selectedCid
      ? entities.Fahrzeug.filter({ customer_id: selectedCid }, "sort_order")
      : Promise.resolve([]),
    enabled: !!selectedCid,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ["fahrzeuge", selectedCid] });

  const createMut = useMutation({
    mutationFn: (d) => entities.Fahrzeug.create({ ...d, customer_id: selectedCid }),
    onSuccess: () => { invalidate(); setEditingId(null); toast.success("Fahrzeug gespeichert"); },
    onError: (e) => toast.error("Fehler: " + e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...d }) => entities.Fahrzeug.update(id, d),
    onSuccess: () => { invalidate(); setEditingId(null); toast.success("Fahrzeug aktualisiert"); },
    onError: (e) => toast.error("Fehler: " + e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => entities.Fahrzeug.delete(id),
    onSuccess: () => { invalidate(); toast.success("Fahrzeug gelöscht"); },
    onError: (e) => toast.error("Fehler: " + e.message),
  });

  // ── Gewählter Kunde ────────────────────────────────────────────────────────
  const selectedCustomer = kunden.find(c => c.id === selectedCid);
  const customerName = selectedCustomer
    ? (selectedCustomer.person_type === "privatperson"
        ? [selectedCustomer.anrede, selectedCustomer.nachname, selectedCustomer.vorname].filter(Boolean).join(" ")
        : selectedCustomer.company_name)
    : "";

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totals = fahrzeuge.reduce((acc, fz) => {
    const c = calcPrivatanteil(fz);
    acc.pa_year += c.pa_year;
    acc.mwst    += c.mwst;
    acc.count   += 1;
    return acc;
  }, { pa_year: 0, mwst: 0, count: 0 });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
        <Wrench className="w-4 h-4" style={{ color: accentL }} />
        <button onClick={() => navigate("/ArtisTools")} className="text-sm hover:underline"
          style={{ color: subC, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          Artis Tools
        </button>
        <ChevronRight className="w-3 h-3" style={{ color: subC }} />
        <Car className="w-4 h-4" style={{ color: accent }} />
        <span className="text-sm font-semibold" style={{ color: headingC }}>Fahrzeugliste</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div style={{ maxWidth: 1100 }}>

          {/* ── Mandant wählen ───────────────────────────────────────────── */}
          <div className="flex items-end gap-4 mb-6">
            <div className="flex-1 max-w-md">
              <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
                Mandant / Unternehmen
              </label>
              <FahrzeuglisteDropdown
                unternehmen={unternehmen}
                privatpersonen={privatpersonen}
                selectedCid={selectedCid}
                mitFahrzeugenSet={mitFahrzeugenSet}
                onChange={cid => { setSelectedCid(cid); setEditingId(null); }}
                panelBg={panelBg}
                panelBdr={panelBdr}
                headingC={headingC}
                subC={subC}
                accent={accent}
              />
            </div>

            {selectedCid && fahrzeuge.length > 0 && (
              <button
                onClick={() => exportCSV(fahrzeuge, customerName)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ backgroundColor: badgeBg, color: headingC, border: `1px solid ${panelBdr}` }}
              >
                <Download className="w-4 h-4" /> Excel-Export (CSV)
              </button>
            )}
          </div>

          {/* ── Schnellliste: Kunden mit Fahrzeugen ──────────────────────── */}
          {mitFahrzeugenSet.size > 0 && (
            <div className="mb-5 px-3 py-2 rounded-xl" style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}` }}>
              <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: subC }}>
                Mit Einträgen ({mitFahrzeugenSet.size})
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                {[...unternehmen, ...privatpersonen].filter(c => mitFahrzeugenSet.has(c.id)).map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedCid(c.id); setEditingId(null); }}
                    className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
                    style={{ color: c.id === selectedCid ? accent : headingC, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    <span style={{ color: "#22c55e", fontSize: 8 }}>●</span>
                    {getKundeLabel(c)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Stats Cards ──────────────────────────────────────────────── */}
          {selectedCid && fahrzeuge.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { label: "Fahrzeuge", value: totals.count, unit: "Stück", color: accent },
                { label: "Privatanteil / Jahr (Lohnausweis Ziff. 2.2)", value: `CHF ${fmtCHF(totals.pa_year)}`, unit: "Total aller Fahrzeuge", color: accent },
                { label: "MWST-Anteil (Vorsteuerkorrektur Ziff. 415)", value: `CHF ${fmtCHF(totals.mwst)}`, unit: "8.1% auf Privatanteil", color: "#059669" },
              ].map(({ label, value, unit, color }) => (
                <div key={label} className="rounded-xl p-4"
                  style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}` }}>
                  <div className="text-xs mb-1" style={{ color: subC }}>{label}</div>
                  <div className="text-xl font-bold" style={{ color }}>{value}</div>
                  <div className="text-xs mt-0.5" style={{ color: subC }}>{unit}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Fahrzeug-Tabelle ──────────────────────────────────────────── */}
          {selectedCid && (
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}` }}>

              {/* Tabellen-Header */}
              <div className="grid text-xs font-semibold uppercase tracking-wider px-4 py-2.5"
                style={{
                  gridTemplateColumns: "130px 160px 120px 100px 90px 110px 110px 80px 80px 60px",
                  backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35",
                  color: subC, borderBottom: `1px solid ${tableBdr}`,
                }}>
                <span>Kennzeichen</span>
                <span>Marke / Modell</span>
                <span>Art</span>
                <span>Fahrer</span>
                <span>Preis exkl.</span>
                <span>PA / Monat</span>
                <span>PA / Jahr (Z.2.2)</span>
                <span>Leasing</span>
                <span>Fahrtenbuch</span>
                <span></span>
              </div>

              {/* Zeilen */}
              {isLoading && (
                <div className="px-4 py-6 text-sm text-center" style={{ color: subC }}>Lädt…</div>
              )}
              {!isLoading && fahrzeuge.length === 0 && editingId !== "new" && (
                <div className="px-4 py-8 text-sm text-center" style={{ color: subC }}>
                  Noch keine Fahrzeuge erfasst. Klicken Sie auf «+ Fahrzeug hinzufügen».
                </div>
              )}

              {fahrzeuge.map(fz => {
                const c = calcPrivatanteil(fz);
                const isEditing = editingId === fz.id;
                return (
                  <div key={fz.id} style={{ borderBottom: `1px solid ${tableBdr}` }}>
                    {!isEditing ? (
                      /* ─ Kompakt-Zeile ─ */
                      <div
                        className="grid items-center px-4 py-2.5 transition-colors cursor-default"
                        style={{
                          gridTemplateColumns: "130px 160px 120px 100px 90px 110px 110px 80px 80px 60px",
                          backgroundColor: "transparent",
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHover}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                      >
                        {/* Kennzeichen */}
                        <div className="flex items-center gap-1.5">
                          <Car className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentL }} />
                          <span className="text-sm font-mono font-semibold" style={{ color: headingC }}>
                            {fz.kennzeichen || "—"}
                          </span>
                        </div>
                        {/* Marke */}
                        <div className="text-xs" style={{ color: headingC }}>
                          <div className="font-medium">{fz.marke} {fz.modell}</div>
                          {fz.anschaffungsjahr && <div style={{ color: subC }}>{fz.anschaffungsjahr}</div>}
                        </div>
                        {/* Art */}
                        <div className="text-xs" style={{ color: subC }}>{fz.fahrzeugart}</div>
                        {/* Fahrer */}
                        <div className="text-xs" style={{ color: headingC }}>{fz.fahrer_name || "—"}</div>
                        {/* Preis */}
                        <div className="text-xs" style={{ color: subC }}>
                          {fz.leasing
                            ? <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: badgeBg, color: accent }}>Leasing</span>
                            : `CHF ${fmtCHF(fz.kaufpreis_exkl_mwst, 0)}`}
                        </div>
                        {/* PA/Monat */}
                        <div className="text-xs font-medium" style={{ color: headingC }}>
                          {fz.ausschliesslich_geschaeftlich ? <span style={{ color: "#059669", fontSize: 10 }}>Kein PA</span>
                            : `CHF ${fmtCHF(c.pa_month)}`}
                        </div>
                        {/* PA/Jahr */}
                        <div className="text-sm font-bold" style={{ color: accent }}>
                          {fz.ausschliesslich_geschaeftlich ? "—" : `CHF ${fmtCHF(c.pa_year)}`}
                        </div>
                        {/* Leasing badge */}
                        <div>
                          {fz.leasing && (fz.leasing_dokument_id || fz.leasing_vertrag_url) && (
                            <span className="text-xs flex items-center gap-0.5" style={{ color: accent }}>
                              <FileText className="w-3 h-3" /> Vertrag
                            </span>
                          )}
                        </div>
                        {/* Fahrtenbuch */}
                        <div className="text-xs" style={{ color: subC }}>
                          {fz.fahrtenbuch ? "✓ Ja" : "—"}
                          {fz.unentgeltliche_befoerderung && <div style={{ color: accent, fontSize: 9 }}>Feld F</div>}
                        </div>
                        {/* Aktionen */}
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditingId(fz.id)} title="Bearbeiten"
                            className="p-1.5 rounded hover:bg-blue-50 transition-colors"
                            style={{ color: accentL }}>
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => { if (window.confirm(`Fahrzeug "${fz.kennzeichen}" löschen?`)) deleteMut.mutate(fz.id); }}
                            title="Löschen"
                            className="p-1.5 rounded hover:bg-red-50 transition-colors"
                            style={{ color: "#d1d5db" }}
                            onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                            onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ─ Edit-Formular ─ */
                      <div className="p-4">
                        <FahrzeugForm
                          initial={fz}
                          theme={theme}
                          accent={accent}
                          customerId={selectedCid}
                          onSave={(data) => updateMut.mutate({ id: fz.id, ...data })}
                          onCancel={() => setEditingId(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Neues Fahrzeug Formular */}
              {editingId === "new" && (
                <div className="p-4" style={{ borderTop: `1px solid ${tableBdr}` }}>
                  <FahrzeugForm
                    initial={{}}
                    theme={theme}
                    accent={accent}
                    customerId={selectedCid}
                    onSave={(data) => createMut.mutate(data)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              )}

              {/* Footer-Leiste */}
              <div className="flex items-center justify-between px-4 py-3"
                style={{ backgroundColor: isArtis ? "#f0f5f0" : isLight ? "#f8f8fc" : "#2f2f35", borderTop: `1px solid ${tableBdr}` }}>
                {editingId !== "new" ? (
                  <button
                    onClick={() => setEditingId("new")}
                    className="flex items-center gap-1.5 text-sm font-medium transition-colors"
                    style={{ color: accent }}
                  >
                    <Plus className="w-4 h-4" /> Fahrzeug hinzufügen
                  </button>
                ) : (
                  <span className="text-xs" style={{ color: subC }}>Formular oben ausfüllen und speichern</span>
                )}

                {fahrzeuge.length > 0 && (
                  <div className="text-xs font-semibold" style={{ color: subC }}>
                    Total: <span style={{ color: accent }}>CHF {fmtCHF(totals.pa_year)}</span>
                    {" · "}MWST: <span style={{ color: "#059669" }}>CHF {fmtCHF(totals.mwst)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Kein Mandant gewählt ─────────────────────────────────────── */}
          {!selectedCid && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Car className="w-12 h-12 mb-3" style={{ color: isArtis ? "#ccd8cc" : "#d1d5db" }} />
              <div className="text-base font-medium mb-1" style={{ color: headingC }}>
                Mandant auswählen
              </div>
              <div className="text-sm" style={{ color: subC }}>
                Wählen Sie oben einen Mandanten aus, um die Fahrzeugliste anzuzeigen.
              </div>
            </div>
          )}

          {/* ── Hinweis-Box ──────────────────────────────────────────────── */}
          {selectedCid && (
            <div className="mt-6 rounded-xl p-4 text-xs space-y-1"
              style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}`, color: subC }}>
              <div className="font-semibold mb-2" style={{ color: headingC }}>ℹ️ Berechnungsgrundlagen (Schweiz)</div>
              <div>• <strong>Privatanteil:</strong> 0.9% des Kaufpreises exkl. MWST pro Monat, mind. CHF 150/Mt (ab 1.1.2022)</div>
              <div>• <strong>Leasing:</strong> Basis = Barkaufpreis laut Leasingvertrag exkl. MWST (nicht monatliche Rate)</div>
              <div>• <strong>Lohnausweis Ziff. 2.2:</strong> Jahresbetrag (abzüglich Eigenanteil Mitarbeiter)</div>
              <div>• <strong>Feld F:</strong> Ankreuzen bei kostenloser Beförderung zwischen Wohn- und Arbeitsort (nur Pauschalmethode)</div>
              <div>• <strong>MWST Ziff. 415:</strong> Vorsteuerkorrektur; Privatanteil gilt als inkl. MWST → 8.1/108.1</div>
              <div>• <strong>Fahrtenbuch:</strong> Alternative zur Pauschale; CHF 0.75/km × Privatkilometer; Feld F entfällt</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
