import React, { useState, useContext } from "react";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  BookOpen, Wrench, ChevronRight, Plus, Trash2, Edit3, Save, X,
  Download, ArrowRight, Scissors, RotateCcw, Users, BarChart2,
  Clock, Shield, AlertCircle, Building2, TrendingUp, Percent, Search
} from "lucide-react";

// ── Konstanten ────────────────────────────────────────────────────────────────
const AKTIENARTEN = ["Namenaktie", "Stammaktie", "Vorzugsaktie", "Stimmrechtsaktie"];
const TRANSAKTIONSTYPEN = ["Gründung", "Emission", "Übertragung", "Split", "Einzug", "Korrektur"];

const AKTIENART_COLORS = {
  "Namenaktie":       { bg: "#dbeafe", text: "#1d4ed8" },
  "Stammaktie":       { bg: "#dcfce7", text: "#15803d" },
  "Vorzugsaktie":     { bg: "#fef9c3", text: "#854d0e" },
  "Stimmrechtsaktie": { bg: "#fae8ff", text: "#7e22ce" },
};

const TRANSAKTION_ICONS = {
  "Gründung":   "🏛️", "Emission": "📤", "Übertragung": "🔄",
  "Split": "✂️", "Einzug": "🗑️", "Korrektur": "✏️",
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("de-CH") : "—";
const fmtCHF  = (v, d = 2) => v != null && !isNaN(v)
  ? Number(v).toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d })
  : "—";

function calcGesamtnominal(e) {
  if (!e.anzahl || !e.nominalwert) return 0;
  return e.anzahl * e.nominalwert * (e.liberierungsgrad / 100);
}

function aktionaerDisplay(e) {
  return e.aktionaer_name || "—";
}

// ── CSV Export ────────────────────────────────────────────────────────────────
function exportCSV(eintraege, firma, nurAktiv = true) {
  const rows = (nurAktiv ? eintraege.filter(e => e.aktiv) : eintraege);
  const total = rows.reduce((s, e) => s + e.anzahl, 0);
  const hdrs = ["Aktionär", "Adresse", "Wirtschaftl. Berechtigter", "Nutzniesser",
    "Aktienart", "Anzahl", "Nominalwert/Aktie (CHF)", "Gesamtnominal (CHF)",
    "Liberierungsgrad (%)", "Liberiert (CHF)", "Zertifikat-Nr.", "Aktien-Nr. von",
    "Aktien-Nr. bis", "Transaktionstyp", "Kaufdatum", "Datum VR-Entscheid",
    "Vinkuliert", "Anteil (%)", "Notizen"];
  const dataRows = rows.map(e => {
    const gn = e.anzahl * (e.nominalwert || 0);
    const lib = gn * ((e.liberierungsgrad || 100) / 100);
    const anteil = total > 0 ? ((e.anzahl / total) * 100).toFixed(2) : "0.00";
    return [
      e.aktionaer_name, e.aktionaer_adresse, e.wirtschaftlich_berechtigter,
      e.nutzniesser, e.aktienart, e.anzahl, e.nominalwert ?? "",
      gn.toFixed(2), e.liberierungsgrad ?? 100, lib.toFixed(2),
      e.zertifikat_nr, e.aktien_nr_von ?? "", e.aktien_nr_bis ?? "",
      e.transaktionstyp, e.kaufdatum ?? "", e.datum_vr_entscheid ?? "",
      e.vinkuliert ? "Ja" : "Nein", anteil, e.notizen,
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";");
  });
  const bom = "\uFEFF";
  const csv = bom + [
    `"Aktienbuch – ${firma}"`,
    `"Stand: ${new Date().toLocaleDateString("de-CH")}"`,
    `"Rechtsgrundlage: Art. 686 OR"`,
    "",
    hdrs.map(h => `"${h}"`).join(";"),
    ...dataRows,
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Aktienbuch_${firma.replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Leeres Formular ───────────────────────────────────────────────────────────
const EMPTY = {
  aktionaer_name: "", aktionaer_adresse: "", wirtschaftlich_berechtigter: "",
  nutzniesser: "", aktienart: "Namenaktie", anzahl: "", nominalwert: 100,
  liberierungsgrad: 100, zertifikat_nr: "", aktien_nr_von: "", aktien_nr_bis: "",
  transaktionstyp: "Emission", kaufdatum: "", datum_vr_entscheid: "",
  vorgaenger_id: null, vinkuliert: false, notizen: "",
};

// ── Eingabefelder-Helfer ──────────────────────────────────────────────────────
function Field({ label, children, hint, col }) {
  return (
    <div className="flex flex-col gap-1" style={col ? { gridColumn: col } : {}}>
      <label className="text-[10px] font-semibold uppercase tracking-widest leading-none" style={{ color: "#9ca3af", minHeight: 12 }}>
        {label}
      </label>
      {children}
      {hint && <div className="text-[9px] leading-tight" style={{ color: "#b0b8c4" }}>{hint}</div>}
    </div>
  );
}

// ── Aktionär-Modal (Add / Edit) ───────────────────────────────────────────────
function AktionaerModal({ initial, title, onSave, onClose, accent, theme }) {
  const [f, setF] = useState({ ...EMPTY, ...initial });
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const gn = (parseFloat(f.anzahl) || 0) * (parseFloat(f.nominalwert) || 0);
  const libBetrag = gn * ((parseInt(f.liberierungsgrad) || 100) / 100);

  const iStyle = {
    backgroundColor: "#ffffff", border: "1px solid #d1d5db", borderRadius: 6,
    padding: "0 10px", fontSize: 12, color: "#1f2937", width: "100%", outline: "none",
    height: 32, boxSizing: "border-box",
  };
  const selectStyle = { ...iStyle };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="rounded-2xl overflow-hidden" style={{
        background: isArtis ? "#f5f8f5" : isLight ? "#f8f8fc" : "#27272a",
        border: `1px solid ${isArtis ? "#ccd8cc" : isLight ? "#e2e2ec" : "#3f3f46"}`,
        width: 720, maxHeight: "90vh", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{
          borderBottom: `1px solid ${isArtis ? "#ccd8cc" : isLight ? "#e2e2ec" : "#3f3f46"}`,
          background: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35",
        }}>
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4" style={{ color: accent }} />
            <span className="font-semibold text-sm" style={{ color: isArtis ? "#1a3a1a" : isLight ? "#1e293b" : "#e4e4e7" }}>
              {title}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/10 transition-colors">
            <X className="w-4 h-4" style={{ color: "#9ca3af" }} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-6">

          {/* Aktionär */}
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-3 pb-2" style={{ color: accent, borderBottom: `1px solid ${isArtis ? "#ccd8cc" : "#e5e7eb"}` }}>
              Aktionär (Art. 686 Abs. 1 OR)
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name / Firma *">
                <input value={f.aktionaer_name} onChange={e => set("aktionaer_name", e.target.value)}
                  placeholder="Max Muster / Muster AG" style={iStyle} />
              </Field>
              <Field label="Adresse *">
                <input value={f.aktionaer_adresse} onChange={e => set("aktionaer_adresse", e.target.value)}
                  placeholder="Musterstrasse 1, 9000 St. Gallen" style={iStyle} />
              </Field>
              <Field label="Wirtschaftlich Berechtigter" hint="Art. 697l OR – nur wenn abweichend">
                <input value={f.wirtschaftlich_berechtigter} onChange={e => set("wirtschaftlich_berechtigter", e.target.value)}
                  placeholder="Wenn abweichend vom Aktionär" style={iStyle} />
              </Field>
              <Field label="Nutzniesser" hint="Nur wenn abweichend">
                <input value={f.nutzniesser} onChange={e => set("nutzniesser", e.target.value)}
                  placeholder="Wenn abweichend" style={iStyle} />
              </Field>
            </div>
          </div>

          {/* Aktien */}
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-3 pb-2" style={{ color: accent, borderBottom: `1px solid ${isArtis ? "#ccd8cc" : "#e5e7eb"}` }}>
              Aktien
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
              <Field label="Aktienart *">
                <select value={f.aktienart} onChange={e => set("aktienart", e.target.value)} style={selectStyle}>
                  {AKTIENARTEN.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Anzahl *">
                <input value={f.anzahl} onChange={e => set("anzahl", e.target.value)}
                  type="number" min="1" placeholder="100" style={iStyle} />
              </Field>
              <Field label="Nennwert CHF *">
                <input value={f.nominalwert} onChange={e => set("nominalwert", e.target.value)}
                  type="number" min="0.01" step="0.01" style={iStyle} />
              </Field>
              <Field label="Liberierung %">
                <input value={f.liberierungsgrad} onChange={e => set("liberierungsgrad", Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                  type="number" min="0" max="100" style={iStyle} />
              </Field>
            </div>
            {/* Berechnung */}
            {f.anzahl > 0 && f.nominalwert > 0 && (
              <div className="mt-2 px-3 py-2 rounded-lg flex gap-6 text-xs"
                style={{ backgroundColor: isArtis ? "#ddeedd" : isLight ? "#eff6ff" : "#1a1a2e", border: `1px solid ${isArtis ? "#b0c8b0" : "#bfdbfe"}` }}>
                <div><span style={{ color: "#6b7280" }}>Gesamtnominal: </span>
                  <strong style={{ color: accent }}>CHF {fmtCHF(gn)}</strong></div>
                <div><span style={{ color: "#6b7280" }}>Liberiert: </span>
                  <strong style={{ color: "#059669" }}>CHF {fmtCHF(libBetrag)}</strong></div>
                <div><span style={{ color: "#6b7280" }}>Offen: </span>
                  <strong style={{ color: "#dc2626" }}>CHF {fmtCHF(gn - libBetrag)}</strong></div>
              </div>
            )}
          </div>

          {/* Zertifikat */}
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-3 pb-2" style={{ color: accent, borderBottom: `1px solid ${isArtis ? "#ccd8cc" : "#e5e7eb"}` }}>
              Zertifikat & Aktiennummern
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Zertifikat-Nr." hint="z.B. Z-001 oder leer lassen">
                <input value={f.zertifikat_nr} onChange={e => set("zertifikat_nr", e.target.value)}
                  placeholder="Z-001" style={iStyle} />
              </Field>
              <Field label="Aktie-Nr. von" hint="Erste Aktiennummer">
                <input value={f.aktien_nr_von} onChange={e => set("aktien_nr_von", e.target.value)}
                  type="number" placeholder="1" style={iStyle} />
              </Field>
              <Field label="Aktie-Nr. bis" hint="Letzte Aktiennummer">
                <input value={f.aktien_nr_bis} onChange={e => set("aktien_nr_bis", e.target.value)}
                  type="number" placeholder="100" style={iStyle} />
              </Field>
            </div>
          </div>

          {/* Transaktion */}
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase mb-3 pb-2" style={{ color: accent, borderBottom: `1px solid ${isArtis ? "#ccd8cc" : "#e5e7eb"}` }}>
              Transaktion & Rechtliches
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Transaktionstyp *">
                <select value={f.transaktionstyp} onChange={e => set("transaktionstyp", e.target.value)} style={selectStyle}>
                  {TRANSAKTIONSTYPEN.map(t => <option key={t} value={t}>{TRANSAKTION_ICONS[t]} {t}</option>)}
                </select>
              </Field>
              <Field label="Kaufdatum / Eintragung">
                <input value={f.kaufdatum} onChange={e => set("kaufdatum", e.target.value)}
                  type="date" style={iStyle} />
              </Field>
              <Field label="Datum VR-Entscheid" hint="Bei vinkulierten Aktien">
                <input value={f.datum_vr_entscheid} onChange={e => set("datum_vr_entscheid", e.target.value)}
                  type="date" style={iStyle} />
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <button type="button"
                  onClick={() => set("vinkuliert", !f.vinkuliert)}
                  className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ backgroundColor: f.vinkuliert ? accent : "transparent", borderColor: f.vinkuliert ? accent : "#9ca3af" }}>
                  {f.vinkuliert && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                </button>
                <span className="text-xs" style={{ color: "#6b7280" }}>Vinkulierte Namenaktie (Übertragung bedarf VR-Zustimmung)</span>
              </label>
            </div>
            <div className="mt-4">
              <Field label="Notizen">
                <input value={f.notizen} onChange={e => set("notizen", e.target.value)}
                  placeholder="Zusätzliche Bemerkungen..." style={iStyle} />
              </Field>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: `1px solid ${isArtis ? "#ccd8cc" : isLight ? "#e2e2ec" : "#3f3f46"}` }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ color: "#6b7280" }}>
            Abbrechen
          </button>
          <button
            onClick={() => {
              if (!f.aktionaer_name.trim()) return toast.error("Name des Aktionärs fehlt");
              if (!f.anzahl || parseInt(f.anzahl) <= 0) return toast.error("Anzahl Aktien fehlt");
              onSave(f);
            }}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: accent }}>
            <Save className="w-3.5 h-3.5" /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Übertragungs-Modal ────────────────────────────────────────────────────────
function UebertragungsModal({ eintrag, onSave, onClose, accent, theme }) {
  const [f, setF] = useState({
    aktionaer_name: "", aktionaer_adresse: "", wirtschaftlich_berechtigter: "",
    nutzniesser: "", kaufdatum: "", datum_vr_entscheid: "",
    zertifikat_nr: eintrag.zertifikat_nr || "",
    aktien_nr_von: eintrag.aktien_nr_von || "", aktien_nr_bis: eintrag.aktien_nr_bis || "",
    notizen: "",
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const iStyle = {
    backgroundColor: "#fff", border: "1px solid #d1d5db", borderRadius: 6,
    padding: "5px 10px", fontSize: 12, color: "#1f2937", width: "100%", outline: "none",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="rounded-2xl overflow-hidden" style={{
        background: isArtis ? "#f5f8f5" : isLight ? "#f8f8fc" : "#27272a",
        border: `1px solid ${isArtis ? "#ccd8cc" : isLight ? "#e2e2ec" : "#3f3f46"}`,
        width: 560,
      }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${isArtis ? "#ccd8cc" : "#e2e2ec"}`, background: isArtis ? "#fff8e8" : "#fef9c3" }}>
          <div className="flex items-center gap-2">
            <ArrowRight className="w-4 h-4" style={{ color: "#854d0e" }} />
            <span className="font-semibold text-sm" style={{ color: "#854d0e" }}>
              🔄 Übertragung — {eintrag.anzahl} Aktie(n) von {eintrag.aktionaer_name}
            </span>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: "#fef9c3", color: "#854d0e" }}>
            Der bisherige Eintrag wird als <strong>inaktiv</strong> markiert (Datum: Verkaufsdatum).
            Für den neuen Eigentümer wird ein neuer Eintrag erstellt.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Neuer Aktionär *">
              <input value={f.aktionaer_name} onChange={e => set("aktionaer_name", e.target.value)}
                placeholder="Name / Firma" style={iStyle} />
            </Field>
            <Field label="Adresse *">
              <input value={f.aktionaer_adresse} onChange={e => set("aktionaer_adresse", e.target.value)}
                placeholder="Adresse" style={iStyle} />
            </Field>
            <Field label="Wirtschaftlich Berechtigter">
              <input value={f.wirtschaftlich_berechtigter} onChange={e => set("wirtschaftlich_berechtigter", e.target.value)}
                placeholder="Wenn abweichend" style={iStyle} />
            </Field>
            <Field label="Datum Übertragung / Kaufdatum">
              <input value={f.kaufdatum} onChange={e => set("kaufdatum", e.target.value)}
                type="date" style={iStyle} />
            </Field>
            <Field label="Datum VR-Entscheid" hint="Bei Vinkulierung Pflicht">
              <input value={f.datum_vr_entscheid} onChange={e => set("datum_vr_entscheid", e.target.value)}
                type="date" style={iStyle} />
            </Field>
            <Field label="Neues Zertifikat-Nr.">
              <input value={f.zertifikat_nr} onChange={e => set("zertifikat_nr", e.target.value)}
                placeholder="Z-002" style={iStyle} />
            </Field>
          </div>
          <Field label="Notizen">
            <input value={f.notizen} onChange={e => set("notizen", e.target.value)}
              placeholder="Kaufpreis, Besonderheiten..." style={iStyle} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3"
          style={{ borderTop: `1px solid ${isArtis ? "#ccd8cc" : "#e2e2ec"}` }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-500">Abbrechen</button>
          <button
            onClick={() => {
              if (!f.aktionaer_name.trim()) return toast.error("Name des neuen Aktionärs fehlt");
              onSave(f);
            }}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: "#b45309" }}>
            <ArrowRight className="w-3.5 h-3.5" /> Übertragung durchführen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Split-Modal ───────────────────────────────────────────────────────────────
function SplitModal({ eintrag, onSave, onClose, accent, theme }) {
  const [splits, setSplits] = useState([
    { aktionaer_name: eintrag.aktionaer_name, aktionaer_adresse: eintrag.aktionaer_adresse,
      anzahl: "", zertifikat_nr: "", aktien_nr_von: "", aktien_nr_bis: "", notizen: "" },
    { aktionaer_name: "", aktionaer_adresse: "", anzahl: "", zertifikat_nr: "", aktien_nr_von: "", aktien_nr_bis: "", notizen: "" },
  ]);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const iStyle = {
    backgroundColor: "#fff", border: "1px solid #d1d5db", borderRadius: 6,
    padding: "4px 8px", fontSize: 12, color: "#1f2937", width: "100%", outline: "none",
  };
  const totalSplit = splits.reduce((s, sp) => s + (parseInt(sp.anzahl) || 0), 0);
  const ok = totalSplit === eintrag.anzahl;

  const setRow = (i, k, v) => setSplits(prev => prev.map((r, j) => j === i ? { ...r, [k]: v } : r));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="rounded-2xl overflow-hidden" style={{
        background: isArtis ? "#f5f8f5" : isLight ? "#f8f8fc" : "#27272a",
        border: `1px solid ${isArtis ? "#ccd8cc" : "#e2e2ec"}`,
        width: 680, maxHeight: "90vh", display: "flex", flexDirection: "column",
      }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #e2e2ec", background: isArtis ? "#eef5ee" : "#f0fdf4" }}>
          <div className="flex items-center gap-2">
            <Scissors className="w-4 h-4" style={{ color: "#15803d" }} />
            <span className="font-semibold text-sm" style={{ color: "#15803d" }}>
              ✂️ Split — {eintrag.anzahl} Aktie(n) aufteilen (Zertifikat {eintrag.zertifikat_nr || "–"})
            </span>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: "#f0fdf4", color: "#15803d" }}>
            Bisheriger Eintrag wird <strong>eingezogen</strong>. Neue Einträge mit den aufgeteilten Zertifikaten werden erstellt.
            Die Summe aller Anteile muss exakt <strong>{eintrag.anzahl}</strong> Aktien ergeben.
          </div>

          {splits.map((sp, i) => (
            <div key={i} className="rounded-lg p-3 space-y-2"
              style={{ border: "1px solid #d1fae5", backgroundColor: "#f0fdf4" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold" style={{ color: "#15803d" }}>Teil {i + 1}</span>
                {splits.length > 2 && (
                  <button onClick={() => setSplits(prev => prev.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 2 }}>Aktionär *</label>
                  <input value={sp.aktionaer_name} onChange={e => setRow(i, "aktionaer_name", e.target.value)}
                    placeholder="Name" style={iStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 2 }}>Anzahl *</label>
                  <input value={sp.anzahl} onChange={e => setRow(i, "anzahl", e.target.value)}
                    type="number" min="1" placeholder="0" style={iStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 2 }}>Zertifikat-Nr.</label>
                  <input value={sp.zertifikat_nr} onChange={e => setRow(i, "zertifikat_nr", e.target.value)}
                    placeholder="Z-001a" style={iStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 2 }}>Aktie-Nr. von</label>
                  <input value={sp.aktien_nr_von} onChange={e => setRow(i, "aktien_nr_von", e.target.value)}
                    type="number" placeholder="1" style={iStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 2 }}>Aktie-Nr. bis</label>
                  <input value={sp.aktien_nr_bis} onChange={e => setRow(i, "aktien_nr_bis", e.target.value)}
                    type="number" placeholder="50" style={iStyle} />
                </div>
                <div className="col-span-2">
                  <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 2 }}>Adresse</label>
                  <input value={sp.aktionaer_adresse} onChange={e => setRow(i, "aktionaer_adresse", e.target.value)}
                    placeholder="Adresse" style={iStyle} />
                </div>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <button onClick={() => setSplits(p => [...p, { aktionaer_name: "", aktionaer_adresse: "", anzahl: "", zertifikat_nr: "", aktien_nr_von: "", aktien_nr_bis: "", notizen: "" }])}
              className="flex items-center gap-1 text-xs" style={{ color: "#15803d" }}>
              <Plus className="w-3.5 h-3.5" /> Weiteren Teil hinzufügen
            </button>
            <div className="ml-auto text-xs font-bold" style={{ color: ok ? "#15803d" : "#dc2626" }}>
              Summe: {totalSplit} / {eintrag.anzahl} {ok ? "✓" : "❌ muss gleich sein"}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid #e2e2ec" }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-500">Abbrechen</button>
          <button
            disabled={!ok}
            onClick={() => { if (ok) onSave(splits); }}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity"
            style={{ backgroundColor: "#15803d", opacity: ok ? 1 : 0.5 }}>
            <Scissors className="w-3.5 h-3.5" /> Split durchführen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Kapitalstruktur-Übersicht ─────────────────────────────────────────────────
function KapitalstrukturView({ eintraege, headingC, subC, accent, panelBg, panelBdr }) {
  const aktiv = eintraege.filter(e => e.aktiv);
  const total = aktiv.reduce((s, e) => s + (e.anzahl || 0), 0);
  const totalNominal = aktiv.reduce((s, e) => s + (e.anzahl || 0) * (e.nominalwert || 0), 0);
  const totalLib = aktiv.reduce((s, e) => s + (e.anzahl || 0) * (e.nominalwert || 0) * ((e.liberierungsgrad || 100) / 100), 0);

  // Grupieren nach Aktienart
  const byArt = AKTIENARTEN.reduce((acc, art) => {
    const rows = aktiv.filter(e => e.aktienart === art);
    if (rows.length) {
      acc[art] = {
        anzahl: rows.reduce((s, e) => s + (e.anzahl || 0), 0),
        nominal: rows.reduce((s, e) => s + (e.anzahl || 0) * (e.nominalwert || 0), 0),
        aktionaere: [...new Set(rows.map(e => e.aktionaer_name))].length,
      };
    }
    return acc;
  }, {});

  // Grupieren nach Aktionär
  const byAktionaer = aktiv.reduce((acc, e) => {
    if (!acc[e.aktionaer_name]) acc[e.aktionaer_name] = { anzahl: 0, nominal: 0 };
    acc[e.aktionaer_name].anzahl += e.anzahl || 0;
    acc[e.aktionaer_name].nominal += (e.anzahl || 0) * (e.nominalwert || 0);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Gesamtkapital", value: `CHF ${fmtCHF(totalNominal)}`, sub: `${fmtCHF(total, 0)} Aktien`, color: accent },
          { label: "Liberiertes Kapital", value: `CHF ${fmtCHF(totalLib)}`, sub: `${total > 0 ? ((totalLib / totalNominal) * 100).toFixed(0) : 0}% liberiert`, color: "#059669" },
          { label: "Nicht liberiert", value: `CHF ${fmtCHF(totalNominal - totalLib)}`, sub: "Ausstehende Einlagen", color: "#dc2626" },
          { label: "Aktionäre", value: Object.keys(byAktionaer).length, sub: "Aktuelle Aktionäre", color: accent },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="rounded-xl p-4" style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}` }}>
            <div className="text-xs mb-1" style={{ color: subC }}>{label}</div>
            <div className="text-lg font-bold" style={{ color }}>{value}</div>
            <div className="text-xs mt-0.5" style={{ color: subC }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Nach Aktienart */}
      {Object.keys(byArt).length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}` }}>
          <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider"
            style={{ backgroundColor: panelBg, borderBottom: `1px solid ${panelBdr}`, color: subC }}>
            Nach Aktienart
          </div>
          {Object.entries(byArt).map(([art, d]) => {
            const c = AKTIENART_COLORS[art] || { bg: "#f3f4f6", text: "#374151" };
            const anteil = total > 0 ? (d.anzahl / total * 100) : 0;
            return (
              <div key={art} className="flex items-center gap-4 px-4 py-3"
                style={{ borderBottom: `1px solid ${panelBdr}` }}>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: c.bg, color: c.text }}>{art}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "#f3f4f6" }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${anteil}%`, backgroundColor: c.text }} />
                </div>
                <span className="text-xs font-bold w-12 text-right" style={{ color: headingC }}>{anteil.toFixed(1)}%</span>
                <span className="text-xs w-20 text-right" style={{ color: subC }}>{fmtCHF(d.anzahl, 0)} Aktien</span>
                <span className="text-xs w-28 text-right font-medium" style={{ color: headingC }}>CHF {fmtCHF(d.nominal)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Nach Aktionär */}
      {Object.keys(byAktionaer).length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}` }}>
          <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider"
            style={{ backgroundColor: panelBg, borderBottom: `1px solid ${panelBdr}`, color: subC }}>
            Aktionärsstruktur
          </div>
          {Object.entries(byAktionaer)
            .sort((a, b) => b[1].anzahl - a[1].anzahl)
            .map(([name, d]) => {
              const anteil = total > 0 ? (d.anzahl / total * 100) : 0;
              return (
                <div key={name} className="flex items-center gap-4 px-4 py-2.5"
                  style={{ borderBottom: `1px solid ${panelBdr}` }}>
                  <span className="text-sm flex-1 font-medium" style={{ color: headingC }}>{name}</span>
                  <div className="w-36 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#f3f4f6" }}>
                    <div className="h-full rounded-full" style={{ width: `${anteil}%`, backgroundColor: accent }} />
                  </div>
                  <span className="text-xs w-14 text-right font-bold" style={{ color: accent }}>{anteil.toFixed(2)}%</span>
                  <span className="text-xs w-20 text-right" style={{ color: subC }}>{fmtCHF(d.anzahl, 0)} Aktien</span>
                  <span className="text-xs w-28 text-right font-medium" style={{ color: headingC }}>CHF {fmtCHF(d.nominal)}</span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function Aktienbuch() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const pageBg   = isLight ? "#f4f4f8"  : isArtis ? "#f2f5f2"  : "#2a2a2f";
  const panelBg  = isLight ? "#ffffff"  : isArtis ? "#ffffff"  : "#27272a";
  const panelBdr = isLight ? "#e2e2ec"  : isArtis ? "#ccd8cc"  : "#3f3f46";
  const headingC = isLight ? "#1e293b"  : isArtis ? "#1a3a1a"  : "#e4e4e7";
  const subC     = isLight ? "#64748b"  : isArtis ? "#4a6a4a"  : "#a1a1aa";
  const accent   = isArtis ? "#5b8a5b"  : isLight  ? "#5b8a5b" : "#22c55e";
  const accentL  = isArtis ? "#7a9b7a"  : isLight  ? "#7a9b7a" : "#4ade80";
  const rowHov   = isLight ? "#f8f8fc"  : isArtis ? "#f0f5f0"  : "#2f2f35";
  const tableBdr = isLight ? "#e8e8f0"  : isArtis ? "#d4e4d4"  : "#3f3f46";

  const qc = useQueryClient();
  const [selectedCid, setSelectedCid] = useState("");
  const [activeTab,   setActiveTab]   = useState("aktionaere");
  const [addModal,    setAddModal]    = useState(false);
  const [editModal,   setEditModal]   = useState(null);   // eintrag | null
  const [uebModal,    setUebModal]    = useState(null);   // eintrag | null
  const [splitModal,  setSplitModal]  = useState(null);   // eintrag | null

  // ── Daten ────────────────────────────────────────────────────────────────
  const { data: kunden = [] } = useQuery({
    queryKey: ["customers_all"],
    queryFn: () => entities.Customer.list("company_name"),
  });
  const unternehmen = kunden.filter(c => c.person_type !== "privatperson" && c.aktiv !== false);

  const { data: eintraege = [], isLoading } = useQuery({
    queryKey: ["aktienbuch", selectedCid],
    queryFn: () => selectedCid
      ? entities.Aktienbuch.filter({ customer_id: selectedCid }, "-kaufdatum")
      : Promise.resolve([]),
    enabled: !!selectedCid,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["aktienbuch", selectedCid] });

  const createMut = useMutation({
    mutationFn: (d) => entities.Aktienbuch.create({ ...d, customer_id: selectedCid }),
    onSuccess: () => { invalidate(); toast.success("Eintrag gespeichert"); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...d }) => entities.Aktienbuch.update(id, d),
    onSuccess: () => { invalidate(); toast.success("Eintrag aktualisiert"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => entities.Aktienbuch.delete(id),
    onSuccess: () => { invalidate(); toast.success("Eintrag gelöscht"); },
    onError: (e) => toast.error(e.message),
  });

  // ── Übertragung ───────────────────────────────────────────────────────────
  const handleUebertragung = async (eintrag, neu) => {
    // 1. Alten Eintrag inaktivieren
    await entities.Aktienbuch.update(eintrag.id, {
      aktiv: false, verkaufsdatum: neu.kaufdatum || new Date().toISOString().slice(0, 10),
    });
    // 2. Neuen Eintrag für neuen Eigentümer
    await entities.Aktienbuch.create({
      customer_id: selectedCid,
      aktionaer_name: neu.aktionaer_name,
      aktionaer_adresse: neu.aktionaer_adresse,
      wirtschaftlich_berechtigter: neu.wirtschaftlich_berechtigter || "",
      nutzniesser: neu.nutzniesser || "",
      aktienart: eintrag.aktienart,
      anzahl: eintrag.anzahl,
      nominalwert: eintrag.nominalwert,
      liberierungsgrad: eintrag.liberierungsgrad,
      zertifikat_nr: neu.zertifikat_nr || eintrag.zertifikat_nr,
      aktien_nr_von: neu.aktien_nr_von || eintrag.aktien_nr_von,
      aktien_nr_bis: neu.aktien_nr_bis || eintrag.aktien_nr_bis,
      transaktionstyp: "Übertragung",
      kaufdatum: neu.kaufdatum || null,
      datum_vr_entscheid: neu.datum_vr_entscheid || null,
      vorgaenger_id: eintrag.id,
      vinkuliert: eintrag.vinkuliert,
      notizen: neu.notizen || "",
      aktiv: true,
    });
    invalidate();
    setUebModal(null);
    toast.success("Übertragung erfolgreich eingetragen");
  };

  // ── Split ─────────────────────────────────────────────────────────────────
  const handleSplit = async (eintrag, splits) => {
    // 1. Ursprünglichen Eintrag einziehen
    await entities.Aktienbuch.update(eintrag.id, {
      aktiv: false, transaktionstyp: "Einzug", verkaufsdatum: new Date().toISOString().slice(0, 10),
    });
    // 2. Neue Einträge erstellen
    for (const sp of splits) {
      await entities.Aktienbuch.create({
        customer_id: selectedCid,
        aktionaer_name: sp.aktionaer_name,
        aktionaer_adresse: sp.aktionaer_adresse || eintrag.aktionaer_adresse,
        wirtschaftlich_berechtigter: eintrag.wirtschaftlich_berechtigter,
        aktienart: eintrag.aktienart,
        anzahl: parseInt(sp.anzahl),
        nominalwert: eintrag.nominalwert,
        liberierungsgrad: eintrag.liberierungsgrad,
        zertifikat_nr: sp.zertifikat_nr || "",
        aktien_nr_von: sp.aktien_nr_von ? parseInt(sp.aktien_nr_von) : null,
        aktien_nr_bis: sp.aktien_nr_bis ? parseInt(sp.aktien_nr_bis) : null,
        transaktionstyp: "Split",
        kaufdatum: eintrag.kaufdatum,
        vorgaenger_id: eintrag.id,
        vinkuliert: eintrag.vinkuliert,
        notizen: sp.notizen || `Split von ${eintrag.zertifikat_nr || "Zertifikat"}`,
        aktiv: true,
      });
    }
    invalidate();
    setSplitModal(null);
    toast.success(`Split in ${splits.length} Teile durchgeführt`);
  };

  // ── Einziehen ─────────────────────────────────────────────────────────────
  const handleEinzug = (eintrag) => {
    if (!window.confirm(`${eintrag.anzahl} Aktie(n) von "${eintrag.aktionaer_name}" wirklich einziehen (Zertifikat entwerten)?`)) return;
    updateMut.mutate({ id: eintrag.id, aktiv: false, transaktionstyp: "Einzug",
      verkaufsdatum: new Date().toISOString().slice(0, 10) });
  };

  // ── Gewählte Firma ────────────────────────────────────────────────────────
  const selectedFirma = unternehmen.find(c => c.id === selectedCid);
  const firmaName = selectedFirma?.company_name || "";
  const aktivEintraege = eintraege.filter(e => e.aktiv);
  const totalAktien = aktivEintraege.reduce((s, e) => s + (e.anzahl || 0), 0);

  const TABS = [
    { key: "aktionaere", label: "Aktuelle Aktionäre", icon: Users },
    { key: "transaktionen", label: "Transaktionshistorie", icon: Clock },
    { key: "kapitalstruktur", label: "Kapitalstruktur", icon: BarChart2 },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
        <Wrench className="w-4 h-4" style={{ color: accentL }} />
        <span className="text-sm" style={{ color: subC }}>Artis Tools</span>
        <ChevronRight className="w-3 h-3" style={{ color: subC }} />
        <BookOpen className="w-4 h-4" style={{ color: accent }} />
        <span className="text-sm font-semibold" style={{ color: headingC }}>Aktienbuch</span>
        {firmaName && <>
          <ChevronRight className="w-3 h-3" style={{ color: subC }} />
          <span className="text-sm" style={{ color: headingC }}>{firmaName}</span>
        </>}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div style={{ maxWidth: 1100 }}>

          {/* ── Unternehmens-Auswahl ──────────────────────────────────────────── */}
          <div className="rounded-2xl mb-6 overflow-hidden" style={{ border: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
            <div className="px-5 py-4 flex items-center gap-4" style={{ borderBottom: selectedCid ? `1px solid ${panelBdr}` : "none" }}>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Building2 className="w-4 h-4" style={{ color: accent }} />
                <span className="text-sm font-semibold" style={{ color: headingC }}>Aktiengesellschaft</span>
              </div>
              <select
                value={selectedCid}
                onChange={e => { setSelectedCid(e.target.value); setActiveTab("aktionaere"); }}
                className="flex-1 rounded-lg border text-sm px-3 py-2 focus:outline-none"
                style={{ backgroundColor: isArtis ? "#f5f8f5" : isLight ? "#f8fafc" : "#1c1c21", borderColor: panelBdr, color: headingC, maxWidth: 440 }}>
                <option value="">– Unternehmen wählen –</option>
                {unternehmen.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}{c.ort ? ` · ${c.ort}` : ""}
                  </option>
                ))}
              </select>
              <div className="ml-auto flex items-center gap-2">
                {selectedCid && eintraege.length > 0 && (
                  <button
                    onClick={() => exportCSV(eintraege, firmaName)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35", color: headingC, border: `1px solid ${panelBdr}` }}>
                    <Download className="w-4 h-4" /> CSV
                  </button>
                )}
                {selectedCid && (
                  <button
                    onClick={() => setAddModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
                    style={{ backgroundColor: accent }}>
                    <Plus className="w-4 h-4" /> Aktionär
                  </button>
                )}
              </div>
            </div>

            {/* ── KPI-Strip ────────────────────────────────────────────── */}
            {selectedCid && aktivEintraege.length > 0 && (() => {
              const totalNom = aktivEintraege.reduce((s, e) => s + (e.anzahl || 0) * (e.nominalwert || 0), 0);
              const totalLib = aktivEintraege.reduce((s, e) => s + (e.anzahl || 0) * (e.nominalwert || 0) * ((e.liberierungsgrad || 100) / 100), 0);
              const libPct   = totalNom > 0 ? Math.round(totalLib / totalNom * 100) : 100;
              const aktionaereCount = [...new Set(aktivEintraege.map(e => e.aktionaer_name))].length;
              const kpis = [
                { icon: TrendingUp,  label: "Gesamtnominal",  value: `CHF ${fmtCHF(totalNom)}`,        sub: `${totalAktien.toLocaleString("de-CH")} Aktien`,    color: accent },
                { icon: Percent,     label: "Liberierungsgrad", value: `${libPct}%`,                   sub: `CHF ${fmtCHF(totalLib)} liberiert`,                color: libPct === 100 ? "#059669" : "#d97706" },
                { icon: Users,       label: "Aktionäre",       value: aktionaereCount,                  sub: `${aktivEintraege.length} Eintrag${aktivEintraege.length !== 1 ? "e" : ""}`, color: accent },
                { icon: BarChart2,   label: "Nicht liberiert", value: `CHF ${fmtCHF(totalNom - totalLib)}`, sub: "Ausstehende Einlagen",                        color: totalNom - totalLib > 0 ? "#dc2626" : "#059669" },
              ];
              return (
                <div className="grid grid-cols-4 divide-x" style={{ borderColor: panelBdr }}>
                  {kpis.map(({ icon: Icon, label, value, sub, color }) => (
                    <div key={label} className="px-5 py-4 flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
                        <Icon className="w-4 h-4" style={{ color }} />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: subC }}>{label}</div>
                        <div className="text-lg font-bold leading-none" style={{ color }}>{value}</div>
                        <div className="text-xs mt-1" style={{ color: subC }}>{sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {selectedCid && (
            <>
              {/* Tabs */}
              <div className="flex items-center gap-1 mb-5 p-1 rounded-xl w-fit"
                style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => setActiveTab(key)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      backgroundColor: activeTab === key ? accent : "transparent",
                      color: activeTab === key ? "#fff" : subC,
                    }}>
                    <Icon className="w-3.5 h-3.5" /> {label}
                    {key === "aktionaere" && totalAktien > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px]"
                        style={{ backgroundColor: activeTab === key ? "rgba(255,255,255,0.25)" : (isArtis ? "#ccd8cc" : "#e2e8f0"), color: activeTab === key ? "#fff" : subC }}>
                        {aktivEintraege.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Tab: Aktuelle Aktionäre ─────────────────────────────── */}
              {activeTab === "aktionaere" && (
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}` }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3"
                    style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f8fafc" : "#2f2f35", borderBottom: `1px solid ${tableBdr}` }}>
                    <div className="flex items-center gap-2">
                      <Shield className="w-3.5 h-3.5" style={{ color: accent }} />
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: subC }}>
                        Aktuelle Aktionäre — Stand {new Date().toLocaleDateString("de-CH")}
                      </span>
                    </div>
                  </div>

                  {/* Spalten-Header */}
                  <div className="grid text-[10px] font-semibold uppercase tracking-wider px-4 py-2"
                    style={{
                      gridTemplateColumns: "1fr 90px 100px 120px 90px 70px 110px 110px",
                      backgroundColor: isArtis ? "#f0f5f0" : isLight ? "#f8fafc" : "#27272a",
                      color: subC, borderBottom: `1px solid ${tableBdr}`,
                    }}>
                    <span>Aktionär</span>
                    <span>Art</span>
                    <span className="text-right">Anzahl</span>
                    <span className="text-right">Nominal/Aktie</span>
                    <span className="text-right">Anteil %</span>
                    <span className="text-right">Lib. %</span>
                    <span>Zertifikat</span>
                    <span></span>
                  </div>

                  {isLoading && <div className="px-4 py-6 text-sm text-center" style={{ color: subC }}>Lädt…</div>}

                  {!isLoading && aktivEintraege.length === 0 && (
                    <div className="px-4 py-10 text-sm text-center" style={{ color: subC }}>
                      <BookOpen className="w-8 h-8 mx-auto mb-2" style={{ color: panelBdr }} />
                      Noch keine Einträge. Klicken Sie auf «Aktionär hinzufügen».
                    </div>
                  )}

                  {aktivEintraege.map(e => {
                    const anteil = totalAktien > 0 ? (e.anzahl / totalAktien * 100) : 0;
                    const artC = AKTIENART_COLORS[e.aktienart] || { bg: "#f3f4f6", text: "#374151" };
                    return (
                      <div key={e.id} className="grid items-center px-4 py-3 transition-colors"
                        style={{
                          gridTemplateColumns: "1fr 90px 100px 120px 90px 70px 110px 110px",
                          borderBottom: `1px solid ${tableBdr}`,
                        }}
                        onMouseEnter={ev => ev.currentTarget.style.backgroundColor = rowHov}
                        onMouseLeave={ev => ev.currentTarget.style.backgroundColor = "transparent"}>

                        {/* Aktionär */}
                        <div>
                          <div className="text-sm font-semibold" style={{ color: headingC }}>{e.aktionaer_name}</div>
                          {e.aktionaer_adresse && <div className="text-xs" style={{ color: subC }}>{e.aktionaer_adresse}</div>}
                          {e.kaufdatum && <div className="text-xs" style={{ color: subC }}>Eingetragen: {fmtDate(e.kaufdatum)}</div>}
                          {e.vinkuliert && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Vinkuliert</span>}
                        </div>

                        {/* Art */}
                        <div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                            style={{ backgroundColor: artC.bg, color: artC.text }}>
                            {e.aktienart}
                          </span>
                        </div>

                        {/* Anzahl */}
                        <div className="text-sm font-bold text-right" style={{ color: headingC }}>
                          {(e.anzahl || 0).toLocaleString("de-CH")}
                        </div>

                        {/* Nominal/Aktie */}
                        <div className="text-sm text-right" style={{ color: subC }}>
                          CHF {fmtCHF(e.nominalwert)}
                        </div>

                        {/* Anteil */}
                        <div className="text-right">
                          <div className="text-sm font-bold" style={{ color: accent }}>{anteil.toFixed(2)}%</div>
                          <div className="w-full h-1 rounded-full mt-1" style={{ backgroundColor: "#f3f4f6" }}>
                            <div className="h-full rounded-full" style={{ width: `${anteil}%`, backgroundColor: accent }} />
                          </div>
                        </div>

                        {/* Liberierungsgrad */}
                        <div className="text-right text-sm" style={{ color: e.liberierungsgrad < 100 ? "#dc2626" : "#059669" }}>
                          {e.liberierungsgrad ?? 100}%
                        </div>

                        {/* Zertifikat */}
                        <div className="text-xs" style={{ color: subC }}>
                          {e.zertifikat_nr && <div className="font-mono">{e.zertifikat_nr}</div>}
                          {e.aktien_nr_von && e.aktien_nr_bis && (
                            <div>Nr. {e.aktien_nr_von}–{e.aktien_nr_bis}</div>
                          )}
                        </div>

                        {/* Aktionen */}
                        <div className="flex items-center gap-0.5 justify-end">
                          <button onClick={() => setEditModal(e)} title="Bearbeiten"
                            className="p-1.5 rounded hover:bg-blue-50 transition-colors" style={{ color: "#93c5fd" }}
                            onMouseEnter={ev => ev.currentTarget.style.color = "#3b82f6"}
                            onMouseLeave={ev => ev.currentTarget.style.color = "#93c5fd"}>
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setUebModal(e)} title="Übertragen"
                            className="p-1.5 rounded hover:bg-amber-50 transition-colors" style={{ color: "#fcd34d" }}
                            onMouseEnter={ev => ev.currentTarget.style.color = "#b45309"}
                            onMouseLeave={ev => ev.currentTarget.style.color = "#fcd34d"}>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setSplitModal(e)} title="Split"
                            className="p-1.5 rounded hover:bg-green-50 transition-colors" style={{ color: "#86efac" }}
                            onMouseEnter={ev => ev.currentTarget.style.color = "#15803d"}
                            onMouseLeave={ev => ev.currentTarget.style.color = "#86efac"}>
                            <Scissors className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleEinzug(e)} title="Einziehen"
                            className="p-1.5 rounded hover:bg-red-50 transition-colors" style={{ color: "#d1d5db" }}
                            onMouseEnter={ev => ev.currentTarget.style.color = "#ef4444"}
                            onMouseLeave={ev => ev.currentTarget.style.color = "#d1d5db"}>
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => { if (window.confirm(`Eintrag von "${e.aktionaer_name}" löschen?`)) deleteMut.mutate(e.id); }}
                            title="Löschen"
                            className="p-1.5 rounded hover:bg-red-50 transition-colors" style={{ color: "#d1d5db" }}
                            onMouseEnter={ev => ev.currentTarget.style.color = "#ef4444"}
                            onMouseLeave={ev => ev.currentTarget.style.color = "#d1d5db"}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Total */}
                  {aktivEintraege.length > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5"
                      style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f8fafc" : "#2f2f35", borderTop: `1px solid ${tableBdr}` }}>
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: subC }}>Total</span>
                      <span className="text-sm font-bold" style={{ color: accent }}>
                        {totalAktien.toLocaleString("de-CH")} Aktien ·{" "}
                        CHF {fmtCHF(aktivEintraege.reduce((s, e) => s + (e.anzahl || 0) * (e.nominalwert || 0), 0))} Gesamtnominal
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Transaktionshistorie ────────────────────────────── */}
              {activeTab === "transaktionen" && (
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}` }}>
                  <div className="px-4 py-3 flex items-center gap-2"
                    style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f8fafc" : "#2f2f35", borderBottom: `1px solid ${tableBdr}` }}>
                    <Clock className="w-3.5 h-3.5" style={{ color: accent }} />
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: subC }}>
                      Transaktionshistorie — {eintraege.length} Einträge
                    </span>
                  </div>
                  {eintraege.length === 0 && (
                    <div className="px-4 py-8 text-sm text-center" style={{ color: subC }}>Keine Einträge vorhanden.</div>
                  )}
                  {eintraege.map(e => (
                    <div key={e.id} className="flex items-start gap-4 px-4 py-3 transition-colors"
                      style={{ borderBottom: `1px solid ${tableBdr}`, opacity: e.aktiv ? 1 : 0.6 }}
                      onMouseEnter={ev => ev.currentTarget.style.backgroundColor = rowHov}
                      onMouseLeave={ev => ev.currentTarget.style.backgroundColor = "transparent"}>
                      {/* Typ-Badge */}
                      <div className="flex-shrink-0 mt-0.5 text-lg">{TRANSAKTION_ICONS[e.transaktionstyp] || "📄"}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold" style={{ color: headingC }}>{e.aktionaer_name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: isArtis ? "#e8f2e8" : "#f1f5f9", color: subC }}>
                            {e.transaktionstyp}
                          </span>
                          {!e.aktiv && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Historisch</span>}
                          {e.vinkuliert && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Vinkuliert</span>}
                        </div>
                        <div className="text-xs mt-0.5 flex flex-wrap gap-3" style={{ color: subC }}>
                          <span>{e.aktienart} · <strong style={{ color: headingC }}>{(e.anzahl || 0).toLocaleString("de-CH")} Stk.</strong> · CHF {fmtCHF(e.nominalwert)}/Aktie</span>
                          {e.zertifikat_nr && <span>Zertifikat: <strong style={{ color: headingC }}>{e.zertifikat_nr}</strong></span>}
                          {e.aktien_nr_von && e.aktien_nr_bis && <span>Nr. {e.aktien_nr_von}–{e.aktien_nr_bis}</span>}
                          {e.kaufdatum && <span>Eingetragen: {fmtDate(e.kaufdatum)}</span>}
                          {e.verkaufsdatum && <span>Ausgetreten: {fmtDate(e.verkaufsdatum)}</span>}
                          {e.datum_vr_entscheid && <span>VR-Entscheid: {fmtDate(e.datum_vr_entscheid)}</span>}
                        </div>
                        {e.notizen && <div className="text-xs mt-1 italic" style={{ color: subC }}>{e.notizen}</div>}
                      </div>
                      <div className="flex gap-0.5 flex-shrink-0">
                        <button onClick={() => setEditModal(e)} title="Bearbeiten"
                          className="p-1.5 rounded hover:bg-blue-50" style={{ color: "#93c5fd" }}
                          onMouseEnter={ev => ev.currentTarget.style.color = "#3b82f6"}
                          onMouseLeave={ev => ev.currentTarget.style.color = "#93c5fd"}>
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button onClick={() => { if (window.confirm("Eintrag löschen?")) deleteMut.mutate(e.id); }}
                          title="Löschen" className="p-1.5 rounded hover:bg-red-50" style={{ color: "#d1d5db" }}
                          onMouseEnter={ev => ev.currentTarget.style.color = "#ef4444"}
                          onMouseLeave={ev => ev.currentTarget.style.color = "#d1d5db"}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Tab: Kapitalstruktur ─────────────────────────────────── */}
              {activeTab === "kapitalstruktur" && (
                <KapitalstrukturView
                  eintraege={eintraege}
                  headingC={headingC} subC={subC}
                  accent={accent} panelBg={panelBg} panelBdr={panelBdr}
                />
              )}

              {/* Rechtlicher Hinweis */}
              <div className="mt-6 rounded-xl p-4 text-xs space-y-1"
                style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}`, color: subC }}>
                <div className="font-semibold mb-2" style={{ color: headingC }}>⚖️ Rechtliche Grundlagen</div>
                <div>• <strong>Art. 686 OR:</strong> Pflicht zur Führung des Aktienbuches für Namenaktien (Name, Adresse, Aktienart, Anzahl, Nennwert)</div>
                <div>• <strong>Art. 697l OR:</strong> Verzeichnis der wirtschaftlich Berechtigten (kann dem Aktienbuch hinzugefügt werden)</div>
                <div>• <strong>Art. 685a OR:</strong> Vinkulierung – Übertragung bedarf Zustimmung des Verwaltungsrats (max. 3 Monate Prüfungszeit)</div>
                <div>• <strong>Art. 686 Abs. 5 OR:</strong> Belege 10 Jahre aufbewahren nach Streichung des Aktionärs</div>
                <div>• <strong>Art. 327a StGB:</strong> Busse bis CHF 10'000 bei fehlendem oder mangelhaftem Aktienbuch</div>
                <div>• <strong>Inhaberaktien</strong> sind seit 1.11.2019 in der Schweiz für nicht börsenkotierte AG verboten</div>
              </div>
            </>
          )}

          {!selectedCid && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
                style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
                <BookOpen className="w-9 h-9" style={{ color: isArtis ? "#5b8a5b" : isLight ? "#94a3b8" : "#52525b" }} />
              </div>
              <div className="text-lg font-semibold mb-2" style={{ color: headingC }}>Aktienbuch (Art. 686 OR)</div>
              <div className="text-sm mb-6 max-w-sm" style={{ color: subC }}>
                Wählen Sie oben eine Aktiengesellschaft aus. Das Aktienbuch verzeichnet alle Aktionäre, Transaktionen und die Kapitalstruktur rechtskonform gemäss OR.
              </div>
              <div className="grid grid-cols-3 gap-3 text-left max-w-lg">
                {[
                  { icon: Users,    title: "Aktionärsverzeichnis", desc: "Name, Adresse, wirtschaftlich Berechtigter" },
                  { icon: Clock,    title: "Transaktionshistorie",  desc: "Gründung, Übertragung, Split, Einzug" },
                  { icon: BarChart2, title: "Kapitalstruktur",     desc: "Nominalkapital, Liberierungsgrad, Anteile" },
                ].map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="rounded-xl p-4" style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}` }}>
                    <Icon className="w-5 h-5 mb-2" style={{ color: accent }} />
                    <div className="text-sm font-semibold mb-1" style={{ color: headingC }}>{title}</div>
                    <div className="text-xs leading-tight" style={{ color: subC }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {addModal && (
        <AktionaerModal
          initial={{ transaktionstyp: "Emission" }}
          title="Aktionär hinzufügen"
          theme={theme} accent={accent}
          onSave={(f) => { createMut.mutate(f); setAddModal(false); }}
          onClose={() => setAddModal(false)}
        />
      )}
      {editModal && (
        <AktionaerModal
          initial={editModal}
          title={`Bearbeiten — ${editModal.aktionaer_name}`}
          theme={theme} accent={accent}
          onSave={(f) => { updateMut.mutate({ id: editModal.id, ...f }); setEditModal(null); }}
          onClose={() => setEditModal(null)}
        />
      )}
      {uebModal && (
        <UebertragungsModal
          eintrag={uebModal} theme={theme} accent={accent}
          onSave={(f) => handleUebertragung(uebModal, f)}
          onClose={() => setUebModal(null)}
        />
      )}
      {splitModal && (
        <SplitModal
          eintrag={splitModal} theme={theme} accent={accent}
          onSave={(splits) => handleSplit(splitModal, splits)}
          onClose={() => setSplitModal(null)}
        />
      )}
    </div>
  );
}
