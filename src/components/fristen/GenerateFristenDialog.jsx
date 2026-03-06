import React, { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Wand2, CheckCircle2, AlertCircle, RefreshCw, Building2, UserRound } from "lucide-react";
import { entities } from "@/api/supabaseClient";
import { toast } from "sonner";

// ──────────────────────────────────────────────────────────────
// Schweizer Kantone
// ──────────────────────────────────────────────────────────────
const CH_KANTONE = [
  { code: 'AG', name: 'Aargau' },         { code: 'AI', name: 'Appenzell Innerrhoden' },
  { code: 'AR', name: 'Appenzell Ausserrhoden' }, { code: 'BE', name: 'Bern' },
  { code: 'BL', name: 'Basel-Landschaft' }, { code: 'BS', name: 'Basel-Stadt' },
  { code: 'FR', name: 'Freiburg' },        { code: 'GE', name: 'Genf' },
  { code: 'GL', name: 'Glarus' },          { code: 'GR', name: 'Graubünden' },
  { code: 'JU', name: 'Jura' },            { code: 'LU', name: 'Luzern' },
  { code: 'NE', name: 'Neuenburg' },       { code: 'NW', name: 'Nidwalden' },
  { code: 'OW', name: 'Obwalden' },        { code: 'SG', name: 'St. Gallen' },
  { code: 'SH', name: 'Schaffhausen' },    { code: 'SO', name: 'Solothurn' },
  { code: 'SZ', name: 'Schwyz' },          { code: 'TG', name: 'Thurgau' },
  { code: 'TI', name: 'Tessin' },          { code: 'UR', name: 'Uri' },
  { code: 'VD', name: 'Waadt' },           { code: 'VS', name: 'Wallis' },
  { code: 'ZG', name: 'Zug' },             { code: 'ZH', name: 'Zürich' },
];

// ──────────────────────────────────────────────────────────────
// Templates
// ──────────────────────────────────────────────────────────────
const TEMPLATES = [
  // Für alle (Unternehmen + Privatpersonen)
  {
    id: "steuererklaerung",
    category: "Steuererklärung",
    title: (year) => `Steuererklärung ${year}`,
    due: (year) => `${year + 1}-03-31`,
    forAll: true,
    label: "Steuererklärung (31.03. Folgejahr)",
  },
  // Nur Unternehmen
  {
    id: "jahresabschluss",
    category: "Jahresabschluss",
    title: (year) => `Jahresabschluss ${year}`,
    due: (year) => `${year + 1}-06-30`,
    unternehmenOnly: true,
    label: "Jahresabschluss (30.06. Folgejahr)",
  },
  // MWST — nur MWST-pflichtige Unternehmen
  {
    id: "mwst_q1",
    category: "MWST",
    title: (year) => `MWST Q1 ${year}`,
    due: (year) => `${year}-05-31`,
    mwstOnly: true,
    label: "MWST Q1 (31.05.)",
  },
  {
    id: "mwst_q2",
    category: "MWST",
    title: (year) => `MWST Q2 ${year}`,
    due: (year) => `${year}-08-31`,
    mwstOnly: true,
    label: "MWST Q2 (31.08.)",
  },
  {
    id: "mwst_q3",
    category: "MWST",
    title: (year) => `MWST Q3 ${year}`,
    due: (year) => `${year}-11-30`,
    mwstOnly: true,
    label: "MWST Q3 (30.11.)",
  },
  {
    id: "mwst_q4",
    category: "MWST",
    title: (year) => `MWST Q4 ${year}`,
    due: (year) => `${year + 1}-02-28`,
    mwstOnly: true,
    label: "MWST Q4 (28.02. Folgejahr)",
  },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear + 1 - i);

// Check if customer is MWST-pflichtig
function isMwstPflichtig(customer) {
  return (customer.activities || []).some(
    a => (a.name === 'MWSt Pflichtig' || a.name === 'MWST Pflichtig' || a.name === 'MWSt pflichtig') && a.completed
  );
}

// Check if a template applies to a customer
function templateApplies(tpl, customer, includeMwst = true) {
  const isUnternehmen = !customer.person_type || customer.person_type === 'unternehmen';
  if (tpl.mwstOnly) {
    if (!includeMwst) return false;
    return isUnternehmen && isMwstPflichtig(customer);
  }
  if (tpl.unternehmenOnly) return isUnternehmen;
  return true; // forAll
}

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────
export default function GenerateFristenDialog({
  open,
  onClose,
  customers = [],
  existingFristen = [],
  singleCustomer = null,
  onGenerated,
}) {
  const [year,            setYear]            = useState(String(currentYear));
  const [status,          setStatus]          = useState("idle");
  const [progress,        setProgress]        = useState(0);
  const [result,          setResult]          = useState(null);
  const [scopePersonType, setScopePersonType] = useState("alle"); // "alle" | "unternehmen" | "privatperson"
  const [includeMwst,     setIncludeMwst]     = useState(true);
  const [selectedKantone, setSelectedKantone] = useState([]);

  const baseCustomers = singleCustomer ? [singleCustomer] : customers;
  const yearInt = parseInt(year, 10);

  // Unique kantone found in data
  const availableKantone = useMemo(() => {
    const codes = [...new Set(baseCustomers.map(c => c.kanton).filter(Boolean))].sort();
    return codes.map(code => CH_KANTONE.find(k => k.code === code) || { code, name: code });
  }, [baseCustomers]);

  const toggleKanton = (code) => {
    setSelectedKantone(prev =>
      prev.includes(code) ? prev.filter(k => k !== code) : [...prev, code]
    );
    setStatus("idle");
    setResult(null);
  };

  const resetFilters = () => {
    setStatus("idle");
    setResult(null);
  };

  // Apply filters to get target customers (always exclude inactive)
  const filteredCustomers = useMemo(() => {
    if (singleCustomer) return singleCustomer.aktiv === false ? [] : [singleCustomer];
    let list = baseCustomers.filter(c => c.aktiv !== false); // skip inactive
    if (scopePersonType !== "alle") {
      list = list.filter(c => {
        const isPrivat = c.person_type === 'privatperson';
        return scopePersonType === 'privatperson' ? isPrivat : !isPrivat;
      });
    }
    if (selectedKantone.length > 0) {
      list = list.filter(c => c.kanton && selectedKantone.includes(c.kanton));
    }
    return list;
  }, [baseCustomers, singleCustomer, scopePersonType, selectedKantone]);

  // ── Live-Vorschau
  const preview = useMemo(() => {
    let toCreate = 0;
    let skipped  = 0;
    const byCategory = {};

    for (const customer of filteredCustomers) {
      for (const tpl of TEMPLATES) {
        if (!templateApplies(tpl, customer, includeMwst)) continue;
        const title = tpl.title(yearInt);
        const exists = existingFristen.some(
          f => f.customer_id === customer.id && f.title === title && f.jahr === yearInt
        );
        const key = tpl.label;
        if (!byCategory[key]) byCategory[key] = { new: 0, skip: 0 };
        if (exists) { skipped++; byCategory[key].skip++; }
        else        { toCreate++; byCategory[key].new++; }
      }
    }
    return { toCreate, skipped, byCategory };
  }, [filteredCustomers, existingFristen, yearInt, includeMwst]);

  // ── Generate
  const handleGenerate = async () => {
    if (preview.toCreate === 0) return;
    setStatus("running");
    setProgress(0);

    try {
      const batch = [];
      for (const customer of filteredCustomers) {
        for (const tpl of TEMPLATES) {
          if (!templateApplies(tpl, customer, includeMwst)) continue;
          const title = tpl.title(yearInt);
          const exists = existingFristen.some(
            f => f.customer_id === customer.id && f.title === title && f.jahr === yearInt
          );
          if (!exists) {
            batch.push({
              title,
              due_date:    tpl.due(yearInt),
              category:    tpl.category,
              customer_id: customer.id,
              jahr:        yearInt,
              status:      'offen',
            });
          }
        }
      }

      let created = 0;
      const chunkSize = 50;
      for (let i = 0; i < batch.length; i += chunkSize) {
        const chunk = batch.slice(i, i + chunkSize);
        await entities.Frist.bulkCreate(chunk);
        created += chunk.length;
        setProgress(Math.round((created / batch.length) * 100));
      }

      setResult({ created, skipped: preview.skipped });
      setStatus("done");
      toast.success(`${created} Fristen generiert!`);
      if (onGenerated) onGenerated();
    } catch (err) {
      setResult({ error: err.message });
      setStatus("error");
      toast.error("Fehler beim Generieren: " + err.message);
    }
  };

  const handleClose = () => {
    setStatus("idle");
    setProgress(0);
    setResult(null);
    onClose();
  };

  const scopeLabel = singleCustomer
    ? `für: ${singleCustomer.company_name}`
    : `${filteredCustomers.length} von ${baseCustomers.length} Kunden`;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="bg-white border-gray-200 text-gray-800 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" />
            Fristen automatisch generieren
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* ── Jahr-Auswahl ── */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 w-16 flex-shrink-0">Jahr</label>
            <Select value={year} onValueChange={v => { setYear(v); resetFilters(); }}>
              <SelectTrigger className="w-28 bg-white border-gray-300 text-gray-800">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-gray-400">{scopeLabel}</span>
          </div>

          {/* ── Personentyp-Filter (nur global) ── */}
          {!singleCustomer && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 w-16 flex-shrink-0">Typ</label>
              <div className="flex gap-1">
                {[
                  { value: "alle",         label: "Alle" },
                  { value: "unternehmen",  label: "Juristisch",  Icon: Building2 },
                  { value: "privatperson", label: "Natürlich",   Icon: UserRound },
                ].map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    onClick={() => { setScopePersonType(value); resetFilters(); }}
                    className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 border transition-colors ${
                      scopePersonType === value
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400'
                    }`}
                  >
                    {Icon && <Icon className="h-3 w-3" />}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── MWST-Toggle (nur bei juristischen/alle) ── */}
          {!singleCustomer && scopePersonType !== "privatperson" && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-16 flex-shrink-0">MWST</span>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeMwst}
                  onChange={e => { setIncludeMwst(e.target.checked); resetFilters(); }}
                  className="h-4 w-4 rounded border-gray-300 accent-violet-600"
                />
                <span className="text-xs text-gray-600">MWST-Fristen (Q1–Q4) einschliessen</span>
              </label>
            </div>
          )}

          {/* ── Kanton-Filter ── */}
          {!singleCustomer && availableKantone.length > 0 && (
            <div className="flex items-start gap-3">
              <label className="text-sm font-medium text-gray-700 w-16 flex-shrink-0 pt-0.5">Kanton</label>
              <div className="flex flex-wrap gap-1">
                {availableKantone.map(({ code, name }) => (
                  <button
                    key={code}
                    onClick={() => toggleKanton(code)}
                    title={name}
                    className={`px-2 py-0.5 rounded text-xs font-mono font-semibold border transition-colors ${
                      selectedKantone.includes(code)
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400'
                    }`}
                  >
                    {code}
                  </button>
                ))}
                {selectedKantone.length > 0 && (
                  <button
                    onClick={() => { setSelectedKantone([]); resetFilters(); }}
                    className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-gray-600 border border-transparent"
                  >
                    ✕ alle
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Vorschau-Tabelle ── */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-100">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Vorschau</span>
            </div>
            <div className="divide-y divide-gray-100">
              {Object.entries(preview.byCategory).map(([label, counts]) => (
                <div key={label} className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs text-gray-700">{label}</span>
                  <div className="flex items-center gap-3">
                    {counts.new > 0 && (
                      <span className="text-xs font-medium text-green-600">+{counts.new} neu</span>
                    )}
                    {counts.skip > 0 && (
                      <span className="text-xs text-gray-400">{counts.skip} übersprungen</span>
                    )}
                  </div>
                </div>
              ))}
              {Object.keys(preview.byCategory).length === 0 && (
                <div className="px-3 py-4 text-xs text-gray-400 text-center">
                  Keine Fristen anzulegen für dieses Jahr / diese Kunden.
                </div>
              )}
            </div>
            <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex justify-between">
              <span className="text-xs font-bold text-gray-700">Total neu</span>
              <span className="text-xs font-bold text-green-600">{preview.toCreate} Fristen</span>
            </div>
          </div>

          {/* ── Progress bar ── */}
          {status === "running" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Generiere Fristen...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* ── Ergebnis ── */}
          {status === "done" && result && (
            <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-green-700">
                <strong>{result.created} Fristen</strong> für {year} erstellt.
                {result.skipped > 0 && (
                  <span className="text-green-600"> · {result.skipped} bereits vorhanden (übersprungen).</span>
                )}
              </div>
            </div>
          )}

          {status === "error" && result && (
            <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-600">{result.error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={handleClose} className="text-gray-500">
            {status === "done" ? "Schließen" : "Abbrechen"}
          </Button>
          {status !== "done" && (
            <Button
              onClick={handleGenerate}
              disabled={preview.toCreate === 0 || status === "running"}
              className="bg-violet-600 hover:bg-violet-500 text-white gap-2"
            >
              {status === "running"
                ? <><RefreshCw className="h-4 w-4 animate-spin" /> Generiere...</>
                : <><Wand2 className="h-4 w-4" /> {preview.toCreate} Fristen generieren</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
