import React, { useState, useContext, useMemo } from "react";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  Scale, Plus, Trash2, Save, X, Download, FileSpreadsheet,
  Calculator, Percent, FileText, ChevronDown, ChevronRight,
  Settings, AlertCircle, Building2,
} from "lucide-react";
import * as XLSX from "xlsx";
import CustomerMiniList from "../components/customers/CustomerMiniList";

// ── Konstanten ────────────────────────────────────────────────────────
const KANTONE = ["AG","AI","AR","BE","BL","BS","FR","GE","GL","GR","JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG","TI","UR","VD","VS","ZG","ZH"];
const ANKNUEPFUNGEN = [
  { value: "sitz",            label: "Sitz / Hauptsteuerdomizil" },
  { value: "betriebsstaette", label: "Betriebsstätte" },
  { value: "liegenschaft",    label: "Liegenschaft" },
];
const RECHNUNGSTYPEN = [
  { value: "akonto",       label: "Akonto" },
  { value: "provisorisch", label: "Provisorisch" },
  { value: "definitiv",    label: "Definitiv" },
  { value: "schluss",      label: "Schlussrechnung" },
  { value: "zins",         label: "Zinsen" },
];
const SCHLUESSEL_OPTIONEN = [
  { value: "schluessel_umsatz",      label: "Umsatz" },
  { value: "schluessel_lohnsumme",   label: "Lohnsumme" },
  { value: "schluessel_anlagewerte", label: "Anlagewerte" },
  { value: "schluessel_mobiliar",    label: "Mobiliar" },
];

// ── Hilfsfunktionen ───────────────────────────────────────────────────
const fmtCHF = (v) => v != null && v !== "" && !isNaN(Number(v))
  ? Number(v).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : "—";
const fmtPct = (v) => v != null && v !== "" && !isNaN(Number(v))
  ? `${Number(v).toFixed(2)} %` : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("de-CH") : "—";
const toNum = (v) => v === "" || v == null ? null : (isNaN(Number(v)) ? null : Number(v));

function computeQuotes(units, schluesselField) {
  const total = units.reduce((s, u) => s + (Number(u[schluesselField]) || 0), 0);
  return units.map(u => ({
    ...u,
    _quote_calc: total > 0 ? ((Number(u[schluesselField]) || 0) / total) * 100 : null,
  }));
}

function effectiveQuote(unit) {
  if (unit.quote_manuell_pct != null && unit.quote_manuell_pct !== "") {
    return Number(unit.quote_manuell_pct);
  }
  return unit._quote_calc;
}

function computeFaktoren(units, period) {
  const gewinn = Number(period?.gesamtgewinn) || 0;
  const kapital = Number(period?.gesamtkapital) || 0;
  const praez = Number(period?.praezipuum_pct) || 0;
  const sitz = units.find(u => u.anknuepfung === "sitz");
  const verteilGewinn = gewinn * (1 - praez / 100);

  return units.map(u => {
    const q = effectiveQuote(u);
    let gewinnEigen = q != null ? verteilGewinn * q / 100 : 0;
    if (sitz && u.id === sitz.id) gewinnEigen += gewinn * praez / 100;
    const kapitalEigen = q != null ? kapital * q / 100 : 0;
    return {
      ...u,
      _gewinn_eigen: gewinnEigen,
      _gewinn_zum_satz: gewinn,
      _kapital_eigen: kapitalEigen,
      _kapital_zum_satz: kapital,
      _quote_eff: q,
    };
  });
}

// ── Themed Tokens Hook ────────────────────────────────────────────────
function useTokens() {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  return {
    isArtis, isLight,
    pageBg:    isArtis ? "#f2f5f2" : isLight ? "#f4f4f8" : "#2a2a2f",
    cardBg:    isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.6)",
    cardBorder: isArtis ? "#ccd8cc" : isLight ? "#e2e2ec" : "#3f3f46",
    textMain:  isArtis ? "#1a3a1a" : isLight ? "#1a1a2e" : "#e4e4e7",
    textMuted: isArtis ? "#6b826b" : isLight ? "#5a5a7a" : "#a1a1aa",
    accent:    isArtis ? "#7a9b7f" : isLight ? "#4f6aab" : "#7c3aed",
    inputBg:   isArtis ? "#f5f8f5" : isLight ? "#ffffff" : "rgba(24,24,27,0.6)",
    headerBg:  isArtis ? "#e8f2e8" : isLight ? "#f0f0fa" : "#3f3f46",
    rowHover:  isArtis ? "rgba(122,155,127,0.08)" : isLight ? "rgba(100,100,180,0.06)" : "rgba(63,63,70,0.4)",
  };
}

// ── Mini-Input mit Styling ────────────────────────────────────────────
function NumInput({ value, onChange, placeholder, step = "0.01", suffix, className = "" }) {
  const t = useTokens();
  return (
    <div style={{ position: "relative" }} className={className}>
      <input
        type="number"
        step={step}
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 6,
          border: `1px solid ${t.cardBorder}`, background: t.inputBg, color: t.textMain,
          outline: "none", paddingRight: suffix ? 28 : 8,
        }}
      />
      {suffix && <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: t.textMuted }}>{suffix}</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }) {
  const t = useTokens();
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 6,
        border: `1px solid ${t.cardBorder}`, background: t.inputBg, color: t.textMain, outline: "none",
      }}
    />
  );
}

function Sel({ value, onChange, options, placeholder = "—" }) {
  const t = useTokens();
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value || null)}
      style={{
        width: "100%", padding: "5px 6px", fontSize: 12, borderRadius: 6,
        border: `1px solid ${t.cardBorder}`, background: t.inputBg, color: t.textMain, outline: "none",
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Btn({ children, onClick, variant = "primary", icon: Icon, disabled, title }) {
  const t = useTokens();
  const styles = {
    primary:   { bg: t.accent,                color: "#fff" },
    secondary: { bg: "transparent",           color: t.textMain, border: `1px solid ${t.cardBorder}` },
    danger:    { bg: "transparent",           color: "#dc2626",  border: "1px solid rgba(220,38,38,0.3)" },
    ghost:     { bg: "transparent",           color: t.textMuted },
  };
  const s = styles[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 12px", fontSize: 12, fontWeight: 500, borderRadius: 6,
        background: s.bg, color: s.color, border: s.border || "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {Icon && <Icon size={13} />}
      {children}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Periode-Tab
// ══════════════════════════════════════════════════════════════════════
function PeriodeTab({ customer }) {
  const t = useTokens();
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [schluessel, setSchluessel] = useState("schluessel_umsatz");

  // ── Load periods (for year-list) ────────────────────────────────────
  const { data: allPeriods = [] } = useQuery({
    queryKey: ["taxPeriods", customer.id],
    queryFn: () => entities.TaxPeriod.filter({ customer_id: customer.id }, "-steuerjahr"),
  });

  const period = useMemo(
    () => allPeriods.find(p => p.steuerjahr === selectedYear) || null,
    [allPeriods, selectedYear]
  );

  // ── Load units + invoices for current period ────────────────────────
  const { data: units = [] } = useQuery({
    queryKey: ["taxUnits", period?.id],
    queryFn: () => period ? entities.TaxUnit.filter({ period_id: period.id }, "sort_order") : [],
    enabled: !!period,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["taxInvoices", period?.id, units.map(u => u.id).join(",")],
    queryFn: async () => {
      if (!period || units.length === 0) return [];
      const all = await Promise.all(units.map(u => entities.TaxInvoice.filter({ unit_id: u.id }, "rechnungsdatum")));
      return all.flat();
    },
    enabled: !!period && units.length > 0,
  });

  // ── Mutations ───────────────────────────────────────────────────────
  const createPeriod = useMutation({
    mutationFn: () => entities.TaxPeriod.create({
      customer_id: customer.id, steuerjahr: selectedYear,
      person_type: "jp", status: "entwurf",
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taxPeriods", customer.id] });
      toast.success(`Periode ${selectedYear} angelegt`);
    },
    onError: (e) => toast.error(e.message),
  });

  const updatePeriod = useMutation({
    mutationFn: ({ id, data }) => entities.TaxPeriod.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxPeriods", customer.id] }),
    onError: (e) => toast.error(e.message),
  });

  const createUnit = useMutation({
    mutationFn: (data) => entities.TaxUnit.create({ period_id: period.id, ...data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxUnits", period.id] }),
    onError: (e) => toast.error(e.message),
  });

  const updateUnit = useMutation({
    mutationFn: ({ id, data }) => entities.TaxUnit.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxUnits", period.id] }),
    onError: (e) => toast.error(e.message),
  });

  const deleteUnit = useMutation({
    mutationFn: (id) => entities.TaxUnit.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxUnits", period.id] }),
    onError: (e) => toast.error(e.message),
  });

  const createInvoice = useMutation({
    mutationFn: (data) => entities.TaxInvoice.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxInvoices", period?.id] }),
    onError: (e) => toast.error(e.message),
  });

  const updateInvoice = useMutation({
    mutationFn: ({ id, data }) => entities.TaxInvoice.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxInvoices", period?.id] }),
    onError: (e) => toast.error(e.message),
  });

  const deleteInvoice = useMutation({
    mutationFn: (id) => entities.TaxInvoice.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxInvoices", period?.id] }),
    onError: (e) => toast.error(e.message),
  });

  // ── Berechnete Units ────────────────────────────────────────────────
  const enrichedUnits = useMemo(() => {
    const withQuotes = computeQuotes(units, schluessel);
    return computeFaktoren(withQuotes, period);
  }, [units, period, schluessel]);

  // ── Year-List (existierende + aktuelles + nächstes) ─────────────────
  const yearOptions = useMemo(() => {
    const years = new Set(allPeriods.map(p => p.steuerjahr));
    years.add(currentYear);
    years.add(currentYear - 1);
    years.add(currentYear - 2);
    return Array.from(years).sort((a, b) => b - a);
  }, [allPeriods, currentYear]);

  // ── Excel Export für aktuelle Periode ───────────────────────────────
  const exportPeriodExcel = () => {
    if (!period) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Stammdaten
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [`Steuerausscheidung ${selectedYear} – ${customer.company_name}`],
      [],
      ["Steuerjahr", period.steuerjahr],
      ["Person-Type", period.person_type === "jp" ? "Juristische Person" : "Natürliche Person"],
      ["DBSt-Kanton", period.dbst_kanton || "—"],
      ["Gesamtgewinn / Einkommen (CHF)", Number(period.gesamtgewinn) || 0],
      ["Gesamtkapital / Vermögen (CHF)", Number(period.gesamtkapital) || 0],
      ["Präzipuum (%)", Number(period.praezipuum_pct) || 0],
      ["Status", period.status],
      ["Notiz", period.notiz || ""],
    ]), "Stammdaten");

    // Sheet 2: Schlüssel & Quoten & Faktoren
    const headers = [
      "Ebene", "Kanton", "Gemeinde", "Anknüpfung",
      "Umsatz", "Lohnsumme", "Anlagewerte", "Mobiliar",
      "Quote berechnet (%)", "Quote manuell (%)", "Quote effektiv (%)",
      "Steuerb. Gewinn eigen", "Gewinn zum Satz",
      "Steuerb. Kapital eigen", "Kapital zum Satz",
      "Veranl.-Datum", "Veranl.-Status",
    ];
    const rows = enrichedUnits.map(u => [
      u.ebene, u.kanton, u.gemeinde || "",
      ANKNUEPFUNGEN.find(a => a.value === u.anknuepfung)?.label || "",
      Number(u.schluessel_umsatz) || 0,
      Number(u.schluessel_lohnsumme) || 0,
      Number(u.schluessel_anlagewerte) || 0,
      Number(u.schluessel_mobiliar) || 0,
      u._quote_calc != null ? Number(u._quote_calc.toFixed(4)) : "",
      u.quote_manuell_pct != null ? Number(u.quote_manuell_pct) : "",
      u._quote_eff != null ? Number(u._quote_eff.toFixed(4)) : "",
      Number(u._gewinn_eigen.toFixed(2)),
      Number(u._gewinn_zum_satz.toFixed(2)),
      Number(u._kapital_eigen.toFixed(2)),
      Number(u._kapital_zum_satz.toFixed(2)),
      u.veranlagung_datum || "",
      u.veranlagung_status || "",
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Ausscheidung");

    // Sheet 3: Rechnungen
    const invHeaders = ["Kanton", "Gemeinde", "Typ", "Rechnungsdatum", "Fälligkeit", "Soll (CHF)", "Bezahlt (CHF)", "Bezahlt am", "Differenz", "Notiz"];
    const invRows = invoices.map(i => {
      const u = units.find(x => x.id === i.unit_id);
      const diff = (Number(i.betrag_soll) || 0) - (Number(i.betrag_haben) || 0);
      return [
        u?.kanton || "", u?.gemeinde || "",
        RECHNUNGSTYPEN.find(t => t.value === i.rechnungstyp)?.label || i.rechnungstyp,
        i.rechnungsdatum || "", i.faelligkeit || "",
        Number(i.betrag_soll) || 0, Number(i.betrag_haben) || 0,
        i.bezahlt_datum || "", Number(diff.toFixed(2)),
        i.notiz || "",
      ];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([invHeaders, ...invRows]), "Rechnungen");

    const safeName = customer.company_name.replace(/[^a-zA-Z0-9]/g, "_");
    XLSX.writeFile(wb, `Steuerausscheidung_${safeName}_${selectedYear}.xlsx`);
  };

  // ── UI ──────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Year-Selector + Schlüssel + Export */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Steuerjahr
          </label>
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(Number(e.target.value))}
            style={{
              padding: "6px 10px", fontSize: 13, fontWeight: 600, borderRadius: 6,
              border: `1px solid ${t.cardBorder}`, background: t.inputBg, color: t.textMain, outline: "none",
            }}
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}{allPeriods.some(p => p.steuerjahr === y) ? "" : " (neu)"}</option>
            ))}
          </select>
        </div>

        {period && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Schlüssel
              </label>
              <select
                value={schluessel}
                onChange={e => setSchluessel(e.target.value)}
                style={{
                  padding: "6px 10px", fontSize: 12, borderRadius: 6,
                  border: `1px solid ${t.cardBorder}`, background: t.inputBg, color: t.textMain, outline: "none",
                }}
              >
                {SCHLUESSEL_OPTIONEN.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <Btn variant="secondary" icon={FileSpreadsheet} onClick={exportPeriodExcel}>Excel-Export</Btn>
          </>
        )}
      </div>

      {/* Periode anlegen */}
      {!period && (
        <div style={{
          padding: 24, borderRadius: 12, border: `1px dashed ${t.cardBorder}`,
          background: t.cardBg, textAlign: "center",
        }}>
          <AlertCircle size={24} style={{ color: t.textMuted, margin: "0 auto 8px" }} />
          <div style={{ fontSize: 13, color: t.textMain, marginBottom: 12 }}>
            Für {selectedYear} ist noch keine Periode angelegt.
          </div>
          <Btn icon={Plus} onClick={() => createPeriod.mutate()}>Periode {selectedYear} anlegen</Btn>
        </div>
      )}

      {period && (
        <>
          {/* Block A: Periode-Stammdaten */}
          <Card title="Periode" icon={Calculator}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <Field label="DBSt-Kanton" hint="Veranlagungskanton DBSt">
                <Sel
                  value={period.dbst_kanton}
                  onChange={v => updatePeriod.mutate({ id: period.id, data: { dbst_kanton: v } })}
                  options={KANTONE.map(k => ({ value: k, label: k }))}
                />
              </Field>
              <Field label="Gesamtgewinn (CHF)">
                <NumInput
                  value={period.gesamtgewinn}
                  onChange={v => updatePeriod.mutate({ id: period.id, data: { gesamtgewinn: toNum(v) } })}
                />
              </Field>
              <Field label="Gesamtkapital (CHF)">
                <NumInput
                  value={period.gesamtkapital}
                  onChange={v => updatePeriod.mutate({ id: period.id, data: { gesamtkapital: toNum(v) } })}
                />
              </Field>
              <Field label="Präzipuum Hauptsitz" hint="0–20% vorab vom Gewinn">
                <NumInput
                  value={period.praezipuum_pct}
                  onChange={v => updatePeriod.mutate({ id: period.id, data: { praezipuum_pct: toNum(v) } })}
                  suffix="%"
                />
              </Field>
              <Field label="Status">
                <Sel
                  value={period.status}
                  onChange={v => updatePeriod.mutate({ id: period.id, data: { status: v || "entwurf" } })}
                  options={[
                    { value: "entwurf",   label: "Entwurf" },
                    { value: "definitiv", label: "Definitiv" },
                  ]}
                  placeholder="Entwurf"
                />
              </Field>
              <Field label="Notiz" col="span 3">
                <TextInput
                  value={period.notiz}
                  onChange={v => updatePeriod.mutate({ id: period.id, data: { notiz: v } })}
                />
              </Field>
            </div>
          </Card>

          {/* Block B+C: Units / Schlüssel / Quoten / Faktoren */}
          <Card title="Ausscheidung" icon={Percent} headerRight={
            <Btn variant="secondary" icon={Plus} onClick={() => createUnit.mutate({
              ebene: "kanton", kanton: "SG",
              sort_order: (units[units.length - 1]?.sort_order || 0) + 10,
            })}>
              Kanton/Gemeinde hinzufügen
            </Btn>
          }>
            {enrichedUnits.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: t.textMuted, fontSize: 12 }}>
                Noch keine Einträge. Klicke „Kanton/Gemeinde hinzufügen".
              </div>
            ) : (
              <UnitsTable
                units={enrichedUnits}
                onUpdate={(id, data) => updateUnit.mutate({ id, data })}
                onDelete={(id) => deleteUnit.mutate(id)}
                schluessel={schluessel}
              />
            )}
          </Card>

          {/* Block D: Rechnungen */}
          <Card title="Rechnungen" icon={FileText}>
            {units.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: t.textMuted, fontSize: 12 }}>
                Erst Kanton/Gemeinde hinzufügen.
              </div>
            ) : (
              <InvoicesSection
                units={units}
                invoices={invoices}
                onCreate={(data) => createInvoice.mutate(data)}
                onUpdate={(id, data) => updateInvoice.mutate({ id, data })}
                onDelete={(id) => deleteInvoice.mutate(id)}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ── Card-Wrapper ──────────────────────────────────────────────────────
function Card({ title, icon: Icon, headerRight, children }) {
  const t = useTokens();
  return (
    <div style={{
      borderRadius: 10, border: `1px solid ${t.cardBorder}`, background: t.cardBg, overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px", borderBottom: `1px solid ${t.cardBorder}`, background: t.headerBg,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {Icon && <Icon size={14} style={{ color: t.accent }} />}
          <span style={{ fontSize: 12, fontWeight: 700, color: t.textMain, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
        </div>
        {headerRight}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

// ── Field-Wrapper ─────────────────────────────────────────────────────
function Field({ label, children, hint, col }) {
  const t = useTokens();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: col || "auto" }}>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: t.textMuted }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: t.textMuted, opacity: 0.8 }}>{hint}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Units-Tabelle
// ══════════════════════════════════════════════════════════════════════
function UnitsTable({ units, onUpdate, onDelete, schluessel }) {
  const t = useTokens();
  const totals = useMemo(() => units.reduce((acc, u) => ({
    umsatz:      acc.umsatz      + (Number(u.schluessel_umsatz)      || 0),
    lohnsumme:   acc.lohnsumme   + (Number(u.schluessel_lohnsumme)   || 0),
    anlagewerte: acc.anlagewerte + (Number(u.schluessel_anlagewerte) || 0),
    mobiliar:    acc.mobiliar    + (Number(u.schluessel_mobiliar)    || 0),
    quote:       acc.quote       + (u._quote_eff || 0),
    gewinn:      acc.gewinn      + (u._gewinn_eigen || 0),
    kapital:     acc.kapital     + (u._kapital_eigen || 0),
  }), { umsatz: 0, lohnsumme: 0, anlagewerte: 0, mobiliar: 0, quote: 0, gewinn: 0, kapital: 0 }), [units]);

  const th = { padding: "8px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", color: t.textMuted, borderBottom: `1px solid ${t.cardBorder}` };
  const td = { padding: "4px 6px", fontSize: 12, color: t.textMain, borderBottom: `1px solid ${t.cardBorder}`, verticalAlign: "middle" };
  const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const isActiveSchluessel = (field) => schluessel === field;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 80 }}>Ebene</th>
            <th style={{ ...th, width: 70 }}>Kanton</th>
            <th style={th}>Gemeinde</th>
            <th style={{ ...th, width: 130 }}>Anknüpfung</th>
            <th style={{ ...th, textAlign: "right", background: isActiveSchluessel("schluessel_umsatz")      ? t.rowHover : undefined }}>Umsatz</th>
            <th style={{ ...th, textAlign: "right", background: isActiveSchluessel("schluessel_lohnsumme")   ? t.rowHover : undefined }}>Lohnsumme</th>
            <th style={{ ...th, textAlign: "right", background: isActiveSchluessel("schluessel_anlagewerte") ? t.rowHover : undefined }}>Anlagewerte</th>
            <th style={{ ...th, textAlign: "right", background: isActiveSchluessel("schluessel_mobiliar")    ? t.rowHover : undefined }}>Mobiliar</th>
            <th style={{ ...th, textAlign: "right" }}>Quote berechn.</th>
            <th style={{ ...th, textAlign: "right" }}>Quote man.</th>
            <th style={{ ...th, textAlign: "right" }}>Gewinn eigen</th>
            <th style={{ ...th, textAlign: "right" }}>Kapital eigen</th>
            <th style={{ ...th, width: 32 }}></th>
          </tr>
        </thead>
        <tbody>
          {units.map(u => (
            <tr key={u.id} style={{ background: u.anknuepfung === "sitz" ? t.rowHover : undefined }}>
              <td style={td}>
                <Sel value={u.ebene} onChange={v => onUpdate(u.id, { ebene: v })}
                  options={[{ value: "kanton", label: "Kanton" }, { value: "gemeinde", label: "Gemeinde" }]} />
              </td>
              <td style={td}>
                <Sel value={u.kanton} onChange={v => onUpdate(u.id, { kanton: v })}
                  options={KANTONE.map(k => ({ value: k, label: k }))} />
              </td>
              <td style={td}>
                <TextInput value={u.gemeinde} onChange={v => onUpdate(u.id, { gemeinde: v || null })} placeholder={u.ebene === "gemeinde" ? "Gemeindename" : "—"} />
              </td>
              <td style={td}>
                <Sel value={u.anknuepfung} onChange={v => onUpdate(u.id, { anknuepfung: v })} options={ANKNUEPFUNGEN} />
              </td>
              <td style={tdNum}><NumInput value={u.schluessel_umsatz}      onChange={v => onUpdate(u.id, { schluessel_umsatz:      toNum(v) })} /></td>
              <td style={tdNum}><NumInput value={u.schluessel_lohnsumme}   onChange={v => onUpdate(u.id, { schluessel_lohnsumme:   toNum(v) })} /></td>
              <td style={tdNum}><NumInput value={u.schluessel_anlagewerte} onChange={v => onUpdate(u.id, { schluessel_anlagewerte: toNum(v) })} /></td>
              <td style={tdNum}><NumInput value={u.schluessel_mobiliar}    onChange={v => onUpdate(u.id, { schluessel_mobiliar:    toNum(v) })} /></td>
              <td style={{ ...tdNum, color: t.textMuted }}>{fmtPct(u._quote_calc)}</td>
              <td style={tdNum}>
                <NumInput value={u.quote_manuell_pct} onChange={v => onUpdate(u.id, { quote_manuell_pct: toNum(v) })} suffix="%" />
              </td>
              <td style={{ ...tdNum, fontWeight: 600 }}>{fmtCHF(u._gewinn_eigen)}</td>
              <td style={{ ...tdNum, fontWeight: 600 }}>{fmtCHF(u._kapital_eigen)}</td>
              <td style={td}>
                <button onClick={() => { if (confirm(`Eintrag ${u.kanton}${u.gemeinde ? `/${u.gemeinde}` : ""} löschen?`)) onDelete(u.id); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 4 }}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
          <tr style={{ background: t.headerBg, fontWeight: 700 }}>
            <td colSpan={4} style={{ ...td, borderBottom: "none" }}>Total</td>
            <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totals.umsatz)}</td>
            <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totals.lohnsumme)}</td>
            <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totals.anlagewerte)}</td>
            <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totals.mobiliar)}</td>
            <td style={{ ...tdNum, borderBottom: "none" }}>—</td>
            <td style={{ ...tdNum, borderBottom: "none" }}>{fmtPct(totals.quote)}</td>
            <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totals.gewinn)}</td>
            <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totals.kapital)}</td>
            <td style={{ ...td, borderBottom: "none" }}></td>
          </tr>
        </tbody>
      </table>

      {/* Veranlagung pro Unit ausklappbar */}
      <div style={{ marginTop: 12 }}>
        {units.map(u => (
          <VeranlagungRow key={u.id} unit={u} onUpdate={(data) => onUpdate(u.id, data)} />
        ))}
      </div>
    </div>
  );
}

// ── Veranlagung pro Kanton (collapse) ─────────────────────────────────
function VeranlagungRow({ unit, onUpdate }) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const label = `${unit.kanton}${unit.gemeinde ? ` / ${unit.gemeinde}` : ""}`;
  return (
    <div style={{ marginTop: 8, border: `1px solid ${t.cardBorder}`, borderRadius: 8, background: t.cardBg }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
        background: "none", border: "none", cursor: "pointer", color: t.textMain, fontSize: 12, fontWeight: 600,
      }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Veranlagung {label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: t.textMuted }}>
          {unit.veranlagung_status || "offen"}{unit.veranlagung_datum ? ` · ${fmtDate(unit.veranlagung_datum)}` : ""}
        </span>
      </button>
      {open && (
        <div style={{ padding: 12, borderTop: `1px solid ${t.cardBorder}`, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Field label="Datum">
            <TextInput type="date" value={unit.veranlagung_datum} onChange={v => onUpdate({ veranlagung_datum: v || null })} />
          </Field>
          <Field label="Status">
            <Sel value={unit.veranlagung_status} onChange={v => onUpdate({ veranlagung_status: v })}
              options={[
                { value: "offen",         label: "Offen" },
                { value: "provisorisch",  label: "Provisorisch" },
                { value: "definitiv",     label: "Definitiv" },
              ]} />
          </Field>
          <Field label="PDF-URL" col="span 2">
            <TextInput value={unit.veranlagung_pdf_url} onChange={v => onUpdate({ veranlagung_pdf_url: v || null })} placeholder="https://…" />
          </Field>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Rechnungen-Section
// ══════════════════════════════════════════════════════════════════════
function InvoicesSection({ units, invoices, onCreate, onUpdate, onDelete }) {
  const t = useTokens();
  const th = { padding: "6px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", color: t.textMuted, borderBottom: `1px solid ${t.cardBorder}` };
  const td = { padding: "4px 6px", fontSize: 12, color: t.textMain, borderBottom: `1px solid ${t.cardBorder}` };
  const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const totalSoll = invoices.reduce((s, i) => s + (Number(i.betrag_soll) || 0), 0);
  const totalHaben = invoices.reduce((s, i) => s + (Number(i.betrag_haben) || 0), 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <Btn variant="secondary" icon={Plus} onClick={() => onCreate({ unit_id: units[0]?.id, rechnungstyp: "akonto" })}>
          Rechnung hinzufügen
        </Btn>
      </div>
      {invoices.length === 0 ? (
        <div style={{ padding: 12, textAlign: "center", color: t.textMuted, fontSize: 12 }}>
          Noch keine Rechnungen erfasst.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 160 }}>Kanton/Gemeinde</th>
              <th style={{ ...th, width: 130 }}>Typ</th>
              <th style={{ ...th, width: 130 }}>Datum</th>
              <th style={{ ...th, width: 130 }}>Fälligkeit</th>
              <th style={{ ...th, textAlign: "right", width: 110 }}>Soll</th>
              <th style={{ ...th, textAlign: "right", width: 110 }}>Bezahlt</th>
              <th style={{ ...th, width: 130 }}>Bezahlt am</th>
              <th style={{ ...th, textAlign: "right", width: 100 }}>Differenz</th>
              <th style={th}>Notiz</th>
              <th style={{ ...th, width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(i => {
              const diff = (Number(i.betrag_soll) || 0) - (Number(i.betrag_haben) || 0);
              return (
                <tr key={i.id}>
                  <td style={td}>
                    <Sel
                      value={i.unit_id}
                      onChange={v => onUpdate(i.id, { unit_id: v })}
                      options={units.map(u => ({ value: u.id, label: `${u.kanton}${u.gemeinde ? ` / ${u.gemeinde}` : ""}` }))}
                    />
                  </td>
                  <td style={td}>
                    <Sel value={i.rechnungstyp} onChange={v => onUpdate(i.id, { rechnungstyp: v })} options={RECHNUNGSTYPEN} />
                  </td>
                  <td style={td}><TextInput type="date" value={i.rechnungsdatum} onChange={v => onUpdate(i.id, { rechnungsdatum: v || null })} /></td>
                  <td style={td}><TextInput type="date" value={i.faelligkeit}    onChange={v => onUpdate(i.id, { faelligkeit:    v || null })} /></td>
                  <td style={tdNum}><NumInput value={i.betrag_soll}  onChange={v => onUpdate(i.id, { betrag_soll:  toNum(v) })} /></td>
                  <td style={tdNum}><NumInput value={i.betrag_haben} onChange={v => onUpdate(i.id, { betrag_haben: toNum(v) })} /></td>
                  <td style={td}><TextInput type="date" value={i.bezahlt_datum} onChange={v => onUpdate(i.id, { bezahlt_datum: v || null })} /></td>
                  <td style={{ ...tdNum, color: diff > 0 ? "#dc2626" : diff < 0 ? "#059669" : t.textMuted }}>{fmtCHF(diff)}</td>
                  <td style={td}><TextInput value={i.notiz} onChange={v => onUpdate(i.id, { notiz: v || null })} /></td>
                  <td style={td}>
                    <button onClick={() => { if (confirm("Rechnung löschen?")) onDelete(i.id); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 4 }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: t.headerBg, fontWeight: 700 }}>
              <td colSpan={4} style={{ ...td, borderBottom: "none" }}>Total</td>
              <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totalSoll)}</td>
              <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totalHaben)}</td>
              <td style={{ ...td, borderBottom: "none" }}></td>
              <td style={{ ...tdNum, borderBottom: "none" }}>{fmtCHF(totalSoll - totalHaben)}</td>
              <td colSpan={2} style={{ ...td, borderBottom: "none" }}></td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Übersicht-Tab (Pivot über alle Jahre × Kantone)
// ══════════════════════════════════════════════════════════════════════
function UebersichtTab({ customer }) {
  const t = useTokens();

  const { data: periods = [] } = useQuery({
    queryKey: ["taxPeriods", customer.id],
    queryFn: () => entities.TaxPeriod.filter({ customer_id: customer.id }, "-steuerjahr"),
  });

  const { data: allUnits = [] } = useQuery({
    queryKey: ["taxAllUnits", customer.id, periods.map(p => p.id).join(",")],
    queryFn: async () => {
      if (periods.length === 0) return [];
      const all = await Promise.all(periods.map(p => entities.TaxUnit.filter({ period_id: p.id }, "sort_order")));
      return all.flat().map(u => ({ ...u, _period: periods.find(p => p.id === u.period_id) }));
    },
    enabled: periods.length > 0,
  });

  const { data: allInvoices = [] } = useQuery({
    queryKey: ["taxAllInvoices", customer.id, allUnits.map(u => u.id).join(",")],
    queryFn: async () => {
      if (allUnits.length === 0) return [];
      const all = await Promise.all(allUnits.map(u => entities.TaxInvoice.filter({ unit_id: u.id })));
      return all.flat();
    },
    enabled: allUnits.length > 0,
  });

  const rows = useMemo(() => allUnits.map(u => {
    const invs = allInvoices.filter(i => i.unit_id === u.id);
    const soll = invs.reduce((s, i) => s + (Number(i.betrag_soll) || 0), 0);
    const haben = invs.reduce((s, i) => s + (Number(i.betrag_haben) || 0), 0);
    const quote = u.quote_manuell_pct != null ? Number(u.quote_manuell_pct) : Number(u.quote_berechnet_pct) || null;
    return {
      jahr: u._period?.steuerjahr,
      kanton: u.kanton,
      gemeinde: u.gemeinde,
      ebene: u.ebene,
      quote,
      gewinn_eigen: u.steuerbarer_gewinn_eigen,
      kapital_eigen: u.steuerbares_kapital_eigen,
      veranl_status: u.veranlagung_status,
      veranl_datum: u.veranlagung_datum,
      soll, haben, diff: soll - haben,
    };
  }).sort((a, b) => (b.jahr - a.jahr) || a.kanton.localeCompare(b.kanton)), [allUnits, allInvoices]);

  const exportPivot = () => {
    const wb = XLSX.utils.book_new();
    const headers = ["Jahr", "Kanton", "Gemeinde", "Ebene", "Quote %", "Gewinn eigen", "Kapital eigen",
      "Veranl.-Status", "Veranl.-Datum", "Soll", "Bezahlt", "Differenz"];
    const data = rows.map(r => [
      r.jahr, r.kanton, r.gemeinde || "", r.ebene,
      r.quote != null ? Number(r.quote.toFixed(4)) : "",
      Number((r.gewinn_eigen || 0).toFixed(2)),
      Number((r.kapital_eigen || 0).toFixed(2)),
      r.veranl_status || "", r.veranl_datum || "",
      Number(r.soll.toFixed(2)), Number(r.haben.toFixed(2)), Number(r.diff.toFixed(2)),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [`Steuerausscheidung Übersicht – ${customer.company_name}`], [], headers, ...data,
    ]), "Übersicht");
    const safe = customer.company_name.replace(/[^a-zA-Z0-9]/g, "_");
    XLSX.writeFile(wb, `Steuerausscheidung_Übersicht_${safe}.xlsx`);
  };

  // Letzte Veranlagung pro Kanton
  const letzteVeranlagung = useMemo(() => {
    const byKanton = new Map();
    for (const r of rows) {
      if (r.veranl_status === "definitiv" && r.veranl_datum) {
        const cur = byKanton.get(r.kanton);
        if (!cur || r.veranl_datum > cur.veranl_datum) byKanton.set(r.kanton, r);
      }
    }
    return Array.from(byKanton.values()).sort((a, b) => a.kanton.localeCompare(b.kanton));
  }, [rows]);

  const th = { padding: "8px 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", color: t.textMuted, borderBottom: `1px solid ${t.cardBorder}` };
  const td = { padding: "6px 8px", fontSize: 12, color: t.textMain, borderBottom: `1px solid ${t.cardBorder}` };
  const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn variant="secondary" icon={FileSpreadsheet} onClick={exportPivot} disabled={rows.length === 0}>
          Excel-Export Übersicht
        </Btn>
      </div>

      {letzteVeranlagung.length > 0 && (
        <Card title="Letzte definitive Veranlagung pro Kanton" icon={Calculator}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
            {letzteVeranlagung.map(r => (
              <div key={r.kanton} style={{ padding: 10, borderRadius: 8, border: `1px solid ${t.cardBorder}`, background: t.headerBg }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.textMain }}>{r.kanton}</div>
                <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
                  Jahr {r.jahr} · {fmtDate(r.veranl_datum)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Pivot: Jahre × Kantone/Gemeinden" icon={FileSpreadsheet}>
        {rows.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: t.textMuted, fontSize: 12 }}>
            Keine Daten. Lege Perioden im Tab „Periode" an.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Jahr</th>
                  <th style={th}>Kanton</th>
                  <th style={th}>Gemeinde</th>
                  <th style={{ ...th, textAlign: "right" }}>Quote</th>
                  <th style={{ ...th, textAlign: "right" }}>Gewinn eigen</th>
                  <th style={{ ...th, textAlign: "right" }}>Kapital eigen</th>
                  <th style={th}>Veranl.</th>
                  <th style={{ ...th, textAlign: "right" }}>Soll</th>
                  <th style={{ ...th, textAlign: "right" }}>Bezahlt</th>
                  <th style={{ ...th, textAlign: "right" }}>Differenz</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx}>
                    <td style={td}>{r.jahr}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.kanton}</td>
                    <td style={td}>{r.gemeinde || "—"}</td>
                    <td style={tdNum}>{fmtPct(r.quote)}</td>
                    <td style={tdNum}>{fmtCHF(r.gewinn_eigen)}</td>
                    <td style={tdNum}>{fmtCHF(r.kapital_eigen)}</td>
                    <td style={td}>{r.veranl_status || "offen"}{r.veranl_datum ? ` (${fmtDate(r.veranl_datum)})` : ""}</td>
                    <td style={tdNum}>{fmtCHF(r.soll)}</td>
                    <td style={tdNum}>{fmtCHF(r.haben)}</td>
                    <td style={{ ...tdNum, color: r.diff > 0 ? "#dc2626" : r.diff < 0 ? "#059669" : t.textMuted }}>{fmtCHF(r.diff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Steuerfuss-Tab
// ══════════════════════════════════════════════════════════════════════
function SteuerfussTab() {
  const t = useTokens();
  const qc = useQueryClient();

  const { data: list = [] } = useQuery({
    queryKey: ["taxSteuerfuss"],
    queryFn: () => entities.TaxSteuerfuss.list("-jahr"),
  });

  const create = useMutation({
    mutationFn: (data) => entities.TaxSteuerfuss.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxSteuerfuss"] }),
    onError: (e) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: ({ id, data }) => entities.TaxSteuerfuss.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxSteuerfuss"] }),
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id) => entities.TaxSteuerfuss.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxSteuerfuss"] }),
    onError: (e) => toast.error(e.message),
  });

  const th = { padding: "8px 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", color: t.textMuted, borderBottom: `1px solid ${t.cardBorder}` };
  const td = { padding: "4px 6px", fontSize: 12, color: t.textMain, borderBottom: `1px solid ${t.cardBorder}` };
  const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ padding: 16 }}>
      <Card title="Steuerfuss-Datenbank" icon={Settings} headerRight={
        <Btn variant="secondary" icon={Plus} onClick={() => create.mutate({
          kanton: "SG", jahr: new Date().getFullYear(), steuerfuss_pct: 100,
        })}>Neuer Eintrag</Btn>
      }>
        {list.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: t.textMuted, fontSize: 12 }}>
            Noch keine Steuerfüsse hinterlegt.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 100 }}>Kanton</th>
                  <th style={{ ...th, width: 200 }}>Gemeinde</th>
                  <th style={{ ...th, width: 100 }}>Jahr</th>
                  <th style={{ ...th, width: 130, textAlign: "right" }}>Steuerfuss</th>
                  <th style={th}>Quelle / Notiz</th>
                  <th style={{ ...th, width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {list.map(s => (
                  <tr key={s.id}>
                    <td style={td}>
                      <Sel value={s.kanton} onChange={v => update.mutate({ id: s.id, data: { kanton: v } })}
                        options={KANTONE.map(k => ({ value: k, label: k }))} />
                    </td>
                    <td style={td}>
                      <TextInput value={s.gemeinde} onChange={v => update.mutate({ id: s.id, data: { gemeinde: v || null } })} placeholder="leer = Kanton" />
                    </td>
                    <td style={td}>
                      <NumInput value={s.jahr} onChange={v => update.mutate({ id: s.id, data: { jahr: toNum(v) } })} step="1" />
                    </td>
                    <td style={tdNum}>
                      <NumInput value={s.steuerfuss_pct} onChange={v => update.mutate({ id: s.id, data: { steuerfuss_pct: toNum(v) } })} suffix="%" step="0.001" />
                    </td>
                    <td style={td}>
                      <TextInput value={s.tarif_referenz} onChange={v => update.mutate({ id: s.id, data: { tarif_referenz: v || null } })} placeholder="Quelle / Override-Notiz" />
                    </td>
                    <td style={td}>
                      <button onClick={() => { if (confirm("Eintrag löschen?")) remove.mutate(s.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 4 }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Haupt-Page
// ══════════════════════════════════════════════════════════════════════
export default function Steuerausscheidung() {
  const t = useTokens();
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [tab, setTab] = useState("periode"); // periode | uebersicht | steuerfuss

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  // Default: nur jur. Personen
  const filteredCustomers = useMemo(
    () => customers.filter(c => !c.person_type || c.person_type === "unternehmen"),
    [customers]
  );

  const tabBtnStyle = (active) => ({
    padding: "8px 16px", fontSize: 12, fontWeight: 600,
    color: active ? t.accent : t.textMuted,
    background: "none",
    border: "none",
    borderBottom: `2px solid ${active ? t.accent : "transparent"}`,
    cursor: "pointer",
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: t.pageBg }}>

      {/* Page-Header */}
      <div style={{ padding: "12px 20px", borderBottom: `1px solid ${t.cardBorder}`, display: "flex", alignItems: "center", gap: 12 }}>
        <Scale size={22} style={{ color: t.accent }} />
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: t.textMain, margin: 0 }}>Steuerausscheidung</h1>
          <div style={{ fontSize: 11, color: t.textMuted }}>Interkantonale & innerkantonale Ausscheidung – juristische Personen</div>
        </div>
      </div>

      {/* Split-View */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Mini-Liste */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <CustomerMiniList
            customers={filteredCustomers}
            selectedId={selectedCustomer?.id}
            onSelect={setSelectedCustomer}
            personTypeFilter="alle"
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!selectedCustomer ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: t.textMuted }}>
              <div style={{ textAlign: "center" }}>
                <Building2 size={32} style={{ margin: "0 auto 8px" }} />
                <div style={{ fontSize: 13 }}>Kunde auswählen</div>
              </div>
            </div>
          ) : (
            <>
              {/* Customer-Header */}
              <div style={{ padding: "12px 20px", borderBottom: `1px solid ${t.cardBorder}`, display: "flex", alignItems: "center", gap: 12 }}>
                <Building2 size={16} style={{ color: t.accent }} />
                <div style={{ fontSize: 14, fontWeight: 700, color: t.textMain }}>
                  {selectedCustomer.company_name}
                </div>
                {selectedCustomer.kanton && (
                  <span style={{ fontSize: 11, color: t.textMuted, padding: "2px 8px", borderRadius: 4, background: t.headerBg }}>
                    Sitz: {selectedCustomer.kanton}
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", borderBottom: `1px solid ${t.cardBorder}`, paddingLeft: 20 }}>
                <button onClick={() => setTab("periode")}    style={tabBtnStyle(tab === "periode")}>Periode</button>
                <button onClick={() => setTab("uebersicht")} style={tabBtnStyle(tab === "uebersicht")}>Übersicht</button>
                <button onClick={() => setTab("steuerfuss")} style={tabBtnStyle(tab === "steuerfuss")}>Steuerfüsse</button>
              </div>

              {/* Tab-Content */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {tab === "periode"    && <PeriodeTab    customer={selectedCustomer} />}
                {tab === "uebersicht" && <UebersichtTab customer={selectedCustomer} />}
                {tab === "steuerfuss" && <SteuerfussTab />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
