import React, { useState, useMemo, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Building2, UserRound, CheckSquare, Square, Search, X,
  RefreshCw, PlayCircle, CheckCircle2, AlertCircle,
} from "lucide-react";
import { entities } from "@/api/supabaseClient";
import { toast } from "sonner";
import { INLINE_CATEGORIES, YEARS } from "@/components/fristen/FristInlineRow";

const currentYear = new Date().getFullYear();

// ─────────────────────────────────────────────────────────────
// FristenlaufDialog
// Zeigt alle Kunden tabellarisch; pro Kunde eine Checkbox
// um ihn vom Lauf auszuschliessen.
// Separate Ansichten für Juristische / Natürliche Personen.
// ─────────────────────────────────────────────────────────────
export default function FristenlaufDialog({
  open,
  onClose,
  customers = [],
  existingFristen = [],
  onGenerated,
}) {
  // ── Settings ──────────────────────────────────────────────
  const [personType,    setPersonType]    = useState("unternehmen");
  const [jahr,          setJahr]          = useState(currentYear);
  const [category,      setCategory]      = useState("Steuererklärung");
  const [dueDate,       setDueDate]       = useState("");
  const [hkt,           setHkt]           = useState(true);
  const [search,        setSearch]        = useState("");

  // ── Selection: Set von ausgeschlossenen Kunden-IDs ────────
  const [excluded, setExcluded] = useState(new Set());

  // ── Status ────────────────────────────────────────────────
  const [status,   setStatus]   = useState("idle");   // idle | running | done | error
  const [progress, setProgress] = useState(0);
  const [result,   setResult]   = useState(null);

  // ── Kundenlisten ──────────────────────────────────────────
  const juristische = useMemo(() =>
    customers
      .filter(c => c.aktiv !== false && c.person_type !== "privatperson")
      .sort((a, b) => (a.company_name || "").localeCompare(b.company_name || "", "de")),
    [customers]
  );

  const natuerliche = useMemo(() =>
    customers
      .filter(c => c.aktiv !== false && c.person_type === "privatperson")
      .sort((a, b) => (a.company_name || "").localeCompare(b.company_name || "", "de")),
    [customers]
  );

  const activeList = personType === "unternehmen" ? juristische : natuerliche;

  // ── Gefilterte + gesuchte Liste ────────────────────────────
  const visibleList = useMemo(() => {
    if (!search.trim()) return activeList;
    const q = search.toLowerCase();
    return activeList.filter(c =>
      c.company_name?.toLowerCase().includes(q) ||
      c.vorname?.toLowerCase().includes(q) ||
      c.nachname?.toLowerCase().includes(q) ||
      c.ort?.toLowerCase().includes(q) ||
      c.plz?.toLowerCase().includes(q) ||
      c.kanton?.toLowerCase().includes(q)
    );
  }, [activeList, search]);

  // ── Eingeschlossene Kunden (aktive Liste, nicht excluded) ──
  const includedInActive = useMemo(
    () => activeList.filter(c => !excluded.has(c.id)),
    [activeList, excluded]
  );

  // ── Duplikat-Check: hat dieser Kunde diese Frist schon? ───
  const hasExisting = useCallback((customerId) => {
    return existingFristen.some(
      f => f.customer_id === customerId &&
           f.category    === category &&
           f.jahr        === jahr
    );
  }, [existingFristen, category, jahr]);

  // ── Select / Deselect all (für aktive Liste) ──────────────
  const selectAll = () => {
    setExcluded(prev => {
      const next = new Set(prev);
      activeList.forEach(c => next.delete(c.id));
      return next;
    });
  };

  const deselectAll = () => {
    setExcluded(prev => {
      const next = new Set(prev);
      activeList.forEach(c => next.add(c.id));
      return next;
    });
  };

  const toggleCustomer = (id) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else              next.add(id);
      return next;
    });
  };

  // ── Vorschau: wie viele neue / übersprungene ──────────────
  const previewCounts = useMemo(() => {
    let neu = 0, skip = 0;
    for (const c of includedInActive) {
      if (hasExisting(c.id)) skip++;
      else                   neu++;
    }
    return { neu, skip };
  }, [includedInActive, hasExisting]);

  // ── Erstellen ─────────────────────────────────────────────
  const handleCreate = async () => {
    const batch = includedInActive
      .filter(c => !hasExisting(c.id))
      .map(c => ({
        title:                  [category, c.kanton || "", String(jahr)].filter(Boolean).join(" "),
        category,
        jahr,
        due_date:               dueDate || null,
        ist_hauptsteuerdomizil: hkt,
        is_recurring:           false,
        status:                 "offen",
        customer_id:            c.id,
        kanton:                 c.kanton || null,
      }));

    if (batch.length === 0) {
      toast.info("Keine neuen Fristen zu erstellen.");
      return;
    }

    setStatus("running");
    setProgress(0);

    try {
      const chunkSize = 50;
      let created = 0;
      for (let i = 0; i < batch.length; i += chunkSize) {
        await entities.Frist.bulkCreate(batch.slice(i, i + chunkSize));
        created += Math.min(chunkSize, batch.length - i);
        setProgress(Math.round((created / batch.length) * 100));
      }
      setResult({ created, skipped: previewCounts.skip });
      setStatus("done");
      toast.success(`${created} Fristen erstellt!`);
      if (onGenerated) onGenerated();
    } catch (err) {
      setResult({ error: err.message });
      setStatus("error");
      toast.error("Fehler: " + err.message);
    }
  };

  const handleClose = () => {
    setStatus("idle");
    setProgress(0);
    setResult(null);
    setSearch("");
    onClose();
  };

  // ── Rendering ─────────────────────────────────────────────
  const isUnternehmen = personType === "unternehmen";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-5xl w-full bg-white text-gray-800 border-gray-200 flex flex-col gap-0 p-0 overflow-hidden"
        style={{ maxHeight: "90vh" }}>

        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <PlayCircle className="h-5 w-5 text-violet-600" />
            Fristenlauf
          </DialogTitle>
        </DialogHeader>

        {/* ── Settings Bar ── */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">

          {/* Steuerperiode */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-500">SP</span>
            <select
              value={String(jahr)}
              onChange={e => setJahr(parseInt(e.target.value))}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
              title="Steuerperiode"
            >
              {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>

          {/* Kategorie */}
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
          >
            {INLINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Frist bis */}
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
            title="Frist bis (optional)"
          />

          {/* HKT */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-medium text-gray-600">
            <input
              type="checkbox"
              checked={hkt}
              onChange={e => setHkt(e.target.checked)}
              className="rounded accent-violet-600"
            />
            HKT
          </label>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Vorschau-Zähler */}
          {status === "idle" && (
            <span className="text-xs text-gray-400">
              {previewCounts.neu} neu · {previewCounts.skip} bereits vorhanden
            </span>
          )}
        </div>

        {/* ── Personen-Typ Tabs ── */}
        <div className="flex items-center gap-0 border-b border-gray-200 flex-shrink-0 bg-white px-5">
          {[
            { value: "unternehmen",  label: "Juristische Personen",  Icon: Building2,  count: juristische.length },
            { value: "privatperson", label: "Natürliche Personen",   Icon: UserRound,  count: natuerliche.length },
          ].map(({ value, label, Icon, count }) => (
            <button
              key={value}
              onClick={() => { setPersonType(value); setSearch(""); }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                personType === value
                  ? "border-violet-600 text-violet-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-normal ${
                personType === value ? "bg-violet-100 text-violet-600" : "bg-gray-100 text-gray-500"
              }`}>
                {count}
              </span>
            </button>
          ))}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Alles / Nichts + Suche */}
          <div className="flex items-center gap-2 py-1.5">
            <button
              onClick={selectAll}
              className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium"
              title="Alle auswählen"
            >
              <CheckSquare className="h-3.5 w-3.5" /> Alle
            </button>
            <button
              onClick={deselectAll}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 font-medium"
              title="Alle abwählen"
            >
              <Square className="h-3.5 w-3.5" /> Keine
            </button>

            {/* Suche */}
            <div className="relative ml-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Suchen..."
                className="pl-6 pr-5 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-400 w-36"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2">
                  <X className="h-3 w-3 text-gray-400" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Tabelle ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="border-b border-gray-200">
                <th className="w-10 px-3 py-2 text-center">
                  <span className="sr-only">Einschliessen</span>
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {isUnternehmen ? "Firma" : "Name"}
                </th>
                {!isUnternehmen && (
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Vorname
                  </th>
                )}
                <th className="w-20 px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">PLZ</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ort</th>
                <th className="w-16 px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Kanton</th>
                <th className="w-24 px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleList.length === 0 ? (
                <tr>
                  <td colSpan={isUnternehmen ? 6 : 7} className="px-3 py-10 text-center text-sm text-gray-400">
                    {search ? "Keine Treffer." : "Keine Kunden vorhanden."}
                  </td>
                </tr>
              ) : (
                visibleList.map(c => {
                  const isExcluded = excluded.has(c.id);
                  const alreadyHas = hasExisting(c.id);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => toggleCustomer(c.id)}
                      className={`cursor-pointer transition-colors ${
                        isExcluded
                          ? "bg-gray-50 opacity-50"
                          : "hover:bg-violet-50"
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-2 text-center" onClick={e => { e.stopPropagation(); toggleCustomer(c.id); }}>
                        <input
                          type="checkbox"
                          checked={!isExcluded}
                          onChange={() => toggleCustomer(c.id)}
                          className="rounded accent-violet-600 cursor-pointer"
                        />
                      </td>

                      {/* Name */}
                      <td className="px-3 py-2 text-gray-800 font-medium text-xs">
                        {isUnternehmen
                          ? c.company_name || "–"
                          : (c.nachname || c.company_name || "–")}
                      </td>

                      {/* Vorname (nur Natürliche) */}
                      {!isUnternehmen && (
                        <td className="px-3 py-2 text-gray-700 text-xs">
                          {c.vorname || "–"}
                        </td>
                      )}

                      {/* PLZ */}
                      <td className="px-3 py-2 text-gray-500 text-xs">{c.plz || "–"}</td>

                      {/* Ort */}
                      <td className="px-3 py-2 text-gray-700 text-xs">{c.ort || "–"}</td>

                      {/* Kanton */}
                      <td className="px-3 py-2 text-xs">
                        {c.kanton ? (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono font-semibold text-[11px]">
                            {c.kanton}
                          </span>
                        ) : "–"}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2 text-center">
                        {alreadyHas ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                            ✓ vorhanden
                          </span>
                        ) : !isExcluded ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-200">
                            + neu
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Progress / Ergebnis ── */}
        {status === "running" && (
          <div className="px-5 py-3 border-t border-gray-200 space-y-1.5 flex-shrink-0">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Erstelle Fristen...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {status === "done" && result && (
          <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-3 bg-green-50 flex-shrink-0">
            <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
            <span className="text-sm text-green-700">
              <strong>{result.created} Fristen</strong> erstellt
              {result.skipped > 0 && ` · ${result.skipped} übersprungen (bereits vorhanden)`}.
            </span>
          </div>
        )}

        {status === "error" && result && (
          <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-3 bg-red-50 flex-shrink-0">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-600">{result.error}</span>
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter className="px-5 py-3 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-gray-500">
            {includedInActive.length} von {activeList.length} Kunden ausgewählt
            {previewCounts.neu > 0 && ` · ${previewCounts.neu} neue Fristen`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose} className="text-gray-500 h-8 text-sm">
              {status === "done" ? "Schliessen" : "Abbrechen"}
            </Button>
            {status !== "done" && (
              <Button
                onClick={handleCreate}
                disabled={previewCounts.neu === 0 || status === "running"}
                className="h-8 gap-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white"
              >
                {status === "running"
                  ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Erstelle...</>
                  : <><PlayCircle className="h-3.5 w-3.5" /> {previewCounts.neu} Fristen erstellen</>}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
