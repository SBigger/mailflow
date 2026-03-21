import React, { useState, useContext, useRef } from "react";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, supabase, uploadFile } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  Car, Wrench, ChevronRight, Plus, Trash2, Edit3, Save, X,
  FileText, Download, CheckSquare, Square, Upload, ExternalLink,
  ChevronDown, ChevronUp, AlertCircle, Calculator
} from "lucide-react";

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function fmtCHF(val, digits = 2) {
  if (val === null || val === undefined || isNaN(Number(val))) return "—";
  return Number(val).toLocaleString("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function calcPrivatanteil(fz) {
  if (fz.ausschliesslich_geschaeftlich) return { pa_month: 0, pa_year: 0, mwst: 0, lohnausweis: 0 };
  const basis = fz.leasing
    ? (parseFloat(fz.leasing_barkaufpreis) || 0)
    : (parseFloat(fz.kaufpreis_exkl_mwst) || 0);
  if (basis <= 0) return { pa_month: 0, pa_year: 0, mwst: 0, lohnausweis: 0 };
  const pa_month_raw = Math.max(basis * 0.009, 150);
  const selbst = parseFloat(fz.fahrer_selbstbezahlt_monat) || 0;
  const pa_month = Math.max(pa_month_raw - selbst, 0);
  const monate = Math.min(Math.max(parseInt(fz.monate_im_betrieb) || 12, 1), 12);
  const pa_year = pa_month * monate;
  const mwst = pa_year * 8.1 / 108.1;  // pa_year gilt als inkl. MWST
  return { pa_month, pa_year, mwst, lohnausweis: pa_year, basis };
}

function todayStr() {
  return new Date().toLocaleDateString("de-CH");
}

function exportCSV(fahrzeuge, customerName) {
  const headers = [
    "Kennzeichen", "Marke", "Modell", "Fahrzeugart", "Fahrer",
    "Kaufpreis exkl. MWST", "Leasing", "Leasing-Barkaufpreis", "Leasing bis",
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
      fz.leasing && fz.leasing_laufzeit_bis ? fz.leasing_laufzeit_bis : "",
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
  leasing_laufzeit_bis: "", leasing_vertrag_url: "",
  monate_im_betrieb: 12, fahrer_name: "", fahrer_selbstbezahlt_monat: "",
  unentgeltliche_befoerderung: false, fahrtenbuch: false,
  effektive_privatkilometer: "", ausschliesslich_geschaeftlich: false,
  notizen: "", sort_order: 0,
};

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

// ── Fahrzeug-Formular (Inline) ───────────────────────────────────────────────
function FahrzeugForm({ initial, onSave, onCancel, theme, accent, uploading, onFileUpload }) {
  const [f, setF] = useState({ ...EMPTY, ...initial });
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
        <div className="rounded-lg p-3 space-y-2" style={{
          backgroundColor: f.leasing ? (isArtis ? "#e8f2e8" : isLight ? "#eef2ff" : "#1e1e2e") : "transparent",
          border: `1px dashed ${f.leasing ? accent : borderC}`,
        }}>
          <CB checked={f.leasing} onChange={v => set("leasing", v)}
            label="Leasingfahrzeug (Barkaufpreis aus Vertrag verwenden)" color={accent} />
          {f.leasing && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div>
                <label style={labelStyle}>Barkaufpreis exkl. MWST *</label>
                <input value={f.leasing_barkaufpreis} onChange={e => set("leasing_barkaufpreis", e.target.value)}
                  placeholder="Laut Leasingvertrag" type="number" style={inpStyle} />
              </div>
              <div>
                <label style={labelStyle}>Leasing bis</label>
                <input value={f.leasing_laufzeit_bis} onChange={e => set("leasing_laufzeit_bis", e.target.value)}
                  type="date" style={inpStyle} />
              </div>
              <div>
                <label style={labelStyle}>Leasingvertrag</label>
                {f.leasing_vertrag_url ? (
                  <div className="flex items-center gap-1">
                    <a href={f.leasing_vertrag_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs"
                      style={{ color: accent }}>
                      <FileText className="w-3 h-3" /> Vertrag anzeigen
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button type="button" onClick={() => set("leasing_vertrag_url", "")}
                      className="text-red-400 hover:text-red-600 ml-1"><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <label className="flex items-center gap-1 cursor-pointer text-xs"
                    style={{ color: accent }}>
                    <Upload className="w-3 h-3" />
                    {uploading ? "Lädt…" : "PDF hochladen"}
                    <input type="file" accept=".pdf,.doc,.docx" className="hidden"
                      onChange={e => e.target.files?.[0] && onFileUpload(e.target.files[0], v => set("leasing_vertrag_url", v))} />
                  </label>
                )}
              </div>
            </div>
          )}
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
              <div style={{ color: labelC }}>Privatanteil / Monat</div>
              <div className="font-semibold" style={{ color: textC }}>CHF {fmtCHF(calc.pa_month)}</div>
              <div style={{ color: labelC, fontSize: 9 }}>max(Basis×0.9%, 150)</div>
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
        <button type="button" onClick={() => onSave(f)}
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

// ── Hauptkomponente ──────────────────────────────────────────────────────────
export default function Fahrzeugliste() {
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
  const [uploading, setUploading]     = useState(false);

  // ── Daten laden ────────────────────────────────────────────────────────────
  const { data: kunden = [] } = useQuery({
    queryKey: ["customers_all"],
    queryFn: () => entities.Customer.list("company_name"),
  });

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

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileUpload = async (file, onDone) => {
    setUploading(true);
    try {
      const url = await uploadFile(file, "leasing-vertraege");
      onDone(url);
      toast.success("Vertrag hochgeladen");
    } catch (e) {
      toast.error("Upload fehlgeschlagen: " + e.message);
    } finally {
      setUploading(false);
    }
  };

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
        <span className="text-sm" style={{ color: subC }}>Artis Tools</span>
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
              <select
                value={selectedCid}
                onChange={e => { setSelectedCid(e.target.value); setEditingId(null); }}
                className="w-full rounded-lg border text-sm px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: panelBg, borderColor: panelBdr,
                  color: headingC, focusRingColor: accent,
                }}
              >
                <option value="">– Mandant auswählen –</option>
                {/* Unternehmen */}
                <optgroup label="Unternehmen">
                  {kunden.filter(c => c.person_type !== "privatperson" && c.aktiv !== false)
                    .map(c => <option key={c.id} value={c.id}>{c.company_name}{c.ort ? ` – ${c.ort}` : ""}</option>)}
                </optgroup>
                {/* Privatpersonen */}
                <optgroup label="Privatpersonen">
                  {kunden.filter(c => c.person_type === "privatperson" && c.aktiv !== false)
                    .map(c => <option key={c.id} value={c.id}>
                      {[c.anrede, c.nachname, c.vorname].filter(Boolean).join(" ")}{c.ort ? ` – ${c.ort}` : ""}
                    </option>)}
                </optgroup>
              </select>
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
                          {fz.leasing && fz.leasing_vertrag_url && (
                            <a href={fz.leasing_vertrag_url} target="_blank" rel="noopener noreferrer"
                              className="text-xs flex items-center gap-0.5" style={{ color: accent }}
                              onClick={e => e.stopPropagation()}>
                              <FileText className="w-3 h-3" /> Vertrag
                            </a>
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
                          uploading={uploading}
                          onFileUpload={handleFileUpload}
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
                    uploading={uploading}
                    onFileUpload={handleFileUpload}
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
