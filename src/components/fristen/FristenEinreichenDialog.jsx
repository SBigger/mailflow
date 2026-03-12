import React, { useState, useMemo, useContext } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CheckSquare, Square, Search, X, RefreshCw, Globe,
  AlertTriangle, CheckCircle2, XCircle, Play,
} from "lucide-react";
import { ThemeContext } from "@/Layout";
import { YEARS } from "@/components/fristen/FristInlineRow";
import { toast } from "sonner";

const CH_KANTONE = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH",
];

const currentYear = new Date().getFullYear();

// Default: 30. Juni des aktuellen Jahres (typische Steuerfrist)
function getDefaultTargetDate() {
  const d = new Date();
  // Wenn wir schon nach dem 30.06 sind → nächstes Jahr
  const candidate = new Date(d.getFullYear(), 5, 30); // 30. Juni
  if (d > candidate) candidate.setFullYear(d.getFullYear() + 1);
  return candidate.toISOString().split("T")[0]; // YYYY-MM-DD
}

const STATUS_COLOR = {
  pending: "#71717a",
  running: "#f59e0b",
  success: "#22c55e",
  error:   "#ef4444",
  skipped: "#a1a1aa",
};

// ─────────────────────────────────────────────────────────────
export default function FristenEinreichenDialog({
  open,
  onClose,
  fristen = [],
  customers = [],
  onAutomationStart,
}) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const dialogBg    = isArtis ? "#f8faf8" : isLight ? "#ffffff" : "#18181b";
  const headerBg    = isArtis ? "#e8f0e8" : isLight ? "#f4f4f8" : "#1c1c21";
  const borderColor = isArtis ? "#ccd8cc" : isLight ? "#e2e2f0" : "#3f3f46";
  const inputBg     = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.8)";
  const inputBorder = isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#3f3f46";
  const textMain    = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted   = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";
  const accentBg    = isArtis ? "#7a9b7f" : "#7c3aed";
  const rowHover    = isArtis ? "rgba(122,155,127,0.08)" : isLight ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.04)";
  const warnBg      = "rgba(245,158,11,0.1)";

  const inStyle  = { backgroundColor: inputBg, borderColor: inputBorder, color: textMain };
  const selCls   = "rounded border px-2 py-1.5 text-xs focus:outline-none cursor-pointer";
  const inpCls   = "rounded border px-2 py-1.5 text-xs focus:outline-none";

  const [kanton,      setKanton]     = useState("SG");
  const [jahr,        setJahr]       = useState(currentYear - 1);
  const [targetDate,  setTargetDate] = useState(getDefaultTargetDate);  // ← Default-Datum vorausgefüllt
  const [search,      setSearch]     = useState("");
  const [excluded,    setExcluded]   = useState(new Set());
  const [phase,       setPhase]      = useState("setup");
  const [results,     setResults]    = useState([]);
  const [currentIdx,  setCurrentIdx] = useState(0);

  // ── Filtered candidates ──────────────────────────────────
  const kandidaten = useMemo(() => {
    return fristen
      .filter(f => {
        if (f.status === "erledigt") return false;
        if (f.jahr !== jahr) return false;
        const kantone = (f.kanton || "").split(",").map(k => k.trim());
        return kantone.includes(kanton);
      })
      .map(f => ({ frist: f, customer: customers.find(c => c.id === f.customer_id) }))
      .filter(({ customer }) => Boolean(customer))
      .sort((a, b) => (a.customer.company_name || "").localeCompare(b.customer.company_name || "", "de"));
  }, [fristen, kanton, jahr, customers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return kandidaten;
    const q = search.toLowerCase();
    return kandidaten.filter(({ customer }) =>
      (customer.company_name || "").toLowerCase().includes(q)
    );
  }, [kandidaten, search]);

  const selected     = filtered.filter(({ frist }) => !excluded.has(frist.id));
  const missingCreds = selected.filter(({ frist }) => !frist.portal_login && !frist.portal_uid);
  const allSelected  = excluded.size === 0;
  const noneSelected = excluded.size >= filtered.length;

  const toggleAll = () => {
    if (noneSelected) setExcluded(new Set());
    else setExcluded(new Set(filtered.map(({ frist }) => frist.id)));
  };

  const toggleOne = (id) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleClose = () => {
    if (phase === "running") return;
    setPhase("setup");
    setResults([]);
    setCurrentIdx(0);
    setExcluded(new Set());
    setSearch("");
    onClose();
  };

  const handleStart = () => {
    if (selected.length === 0) { toast.error("Keine Fristen ausgewählt"); return; }
    if (!targetDate) { toast.error("Bitte ein Zieldatum eingeben"); return; }
    const init = selected.map(({ frist, customer }) => ({
      frist, customer,
      status: frist.portal_login ? "pending" : "skipped",
      screenshot: null,
      note: frist.portal_login ? "" : "Keine Zugangsdaten",
    }));
    setResults(init);
    // Springe direkt zum ersten Portal-Item
    const firstPortalIdx = init.findIndex(r => r.status === "pending");
    setCurrentIdx(firstPortalIdx >= 0 ? firstPortalIdx : init.length);
    setPhase("running");
    if (onAutomationStart) {
      let consecutiveErrors = 0;
      onAutomationStart({
        items: selected,
        targetDate,
        kanton,
        jahr,
        maxAttempts: 2,
        maxConsecutiveErrors: 3,
        onProgress: (idx, status, screenshot, note) => {
          if (status === "error") {
            consecutiveErrors++;
          } else {
            consecutiveErrors = 0;
          }
          const shouldAbort = consecutiveErrors >= 3;
          setResults(prev => {
            const updated = prev.map((r, i) =>
              i === idx ? { ...r, status, screenshot: screenshot || null, note: note || "" } : r
            );
            if (shouldAbort) {
              return updated.map((r, i) =>
                i > idx && r.status === "pending"
                  ? { ...r, status: "skipped", note: "Abgebrochen – 3 aufeinanderfolgende Fehler" }
                  : r
              );
            }
            return updated;
          });
          setCurrentIdx(idx + 1);
          if (shouldAbort) {
            if (window.__fristenAutomation) {
              window.__fristenAutomation._aborted = true;
              window.__fristenAutomation._abortReason = "3 aufeinanderfolgende Fehler";
            }
            setPhase("done");
          }
        },
        onDone: () => setPhase("done"),
      });
    }
  };

  // Nach "done" → nochmals starten, nur Fehler-Items zurücksetzen
  const handleRestart = () => {
    setResults([]);
    setCurrentIdx(0);
    setPhase("setup");
  };

  // Manuelle Stopp-Funktion während der Automation
  const handleStop = () => {
    if (window.__fristenAutomation) {
      window.__fristenAutomation._aborted = true;
      window.__fristenAutomation._abortReason = "Manuell gestoppt";
    }
    setResults(prev => prev.map(r =>
      r.status === "pending" ? { ...r, status: "skipped", note: "Manuell gestoppt" } : r
    ));
    setPhase("done");
  };

  // Aktuelles Item manuell überspringen (falls Automation hängt)
  const handleSkipCurrent = () => {
    const idx = results.findIndex(r => r.status === "pending");
    if (idx === -1) return;
    const a = window.__fristenAutomation;
    if (a?.onProgress) {
      a.onProgress(idx, "skipped", null, "Manuell übersprungen");
    } else {
      setResults(prev => prev.map((r, i) =>
        i === idx ? { ...r, status: "skipped", note: "Manuell übersprungen" } : r
      ));
      setCurrentIdx(idx + 1);
    }
  };

  const successCount = results.filter(r => r.status === "success").length;
  const errorCount   = results.filter(r => r.status === "error").length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent style={{
        backgroundColor: dialogBg, borderColor,
        maxWidth: 720, maxHeight: "90vh",
        display: "flex", flexDirection: "column",
        overflow: "hidden", padding: 0,
      }}>

        {/* ── Header ── */}
        <div className="flex-shrink-0 px-5 py-4 flex items-center gap-3"
          style={{ backgroundColor: headerBg, borderBottom: `1px solid ${borderColor}` }}>
          <Globe className="h-5 w-5" style={{ color: accentBg }} />
          <div>
            <DialogTitle style={{ color: textMain, fontSize: 15, margin: 0 }}>
              Fristen online einreichen
            </DialogTitle>
            <p className="text-xs mt-0.5" style={{ color: textMuted }}>
              Fristgesuche automatisch auf dem Kantonsportal einreichen
            </p>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Setup Phase */}
          {phase === "setup" && (<>

            {/* Filter-Zeile */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium" style={{ color: textMuted }}>Kanton</span>
                <select value={kanton}
                  onChange={e => { setKanton(e.target.value); setExcluded(new Set()); }}
                  className={selCls} style={{ ...inStyle, width: 80 }}>
                  {CH_KANTONE.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium" style={{ color: textMuted }}>SP Jahr</span>
                <select value={jahr}
                  onChange={e => { setJahr(parseInt(e.target.value)); setExcluded(new Set()); }}
                  className={selCls} style={{ ...inStyle, width: 80 }}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium" style={{ color: textMuted }}>Gewünschte Frist</span>
                <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                  className={inpCls} style={{ ...inStyle }} />
              </div>
            </div>

            {/* Suche + Alle/Keine */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: textMuted }} />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Kunde suchen..."
                  className={inpCls}
                  style={{ ...inStyle, width: "100%", paddingLeft: 28 }} />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: textMuted }}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button onClick={toggleAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border"
                style={{ ...inStyle }}>
                {!noneSelected
                  ? <CheckSquare className="h-3.5 w-3.5" style={{ color: accentBg }} />
                  : <Square className="h-3.5 w-3.5" style={{ color: textMuted }} />}
                {allSelected ? "Alle" : noneSelected ? "Keine" : `${selected.length}/${filtered.length}`}
              </button>
            </div>

            {/* Liste */}
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-xs" style={{ color: textMuted }}>
                Keine offenen Fristen für Kanton {kanton} / SP {jahr}
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor }}>
                {/* Header */}
                <div className="grid px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
                  style={{
                    gridTemplateColumns: "24px 1fr 110px 90px 70px",
                    backgroundColor: headerBg, color: textMuted,
                    borderBottom: `1px solid ${borderColor}`,
                  }}>
                  <div />
                  <div>Kunde</div>
                  <div>Portal Login</div>
                  <div>UID</div>
                  <div>Passwort</div>
                </div>
                {/* Rows */}
                {filtered.map(({ frist, customer }, idx) => {
                  const isChecked = !excluded.has(frist.id);
                  const noLogin   = !frist.portal_login && !frist.portal_uid;
                  return (
                    <div key={frist.id}
                      onClick={() => toggleOne(frist.id)}
                      className="grid px-3 py-2 cursor-pointer transition-colors"
                      style={{
                        gridTemplateColumns: "24px 1fr 110px 90px 70px",
                        alignItems: "center",
                        backgroundColor: noLogin ? warnBg : "transparent",
                        borderBottom: idx < filtered.length - 1 ? `1px solid ${borderColor}` : "none",
                        opacity: isChecked ? 1 : 0.45,
                      }}
                      onMouseEnter={e => { if (!noLogin) e.currentTarget.style.backgroundColor = rowHover; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = noLogin ? warnBg : "transparent"; }}
                    >
                      <div onClick={e => { e.stopPropagation(); toggleOne(frist.id); }}>
                        {isChecked
                          ? <CheckSquare className="h-4 w-4" style={{ color: accentBg }} />
                          : <Square className="h-4 w-4" style={{ color: textMuted }} />}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate" style={{ color: textMain }}>
                          {customer.company_name}
                        </span>
                        {noLogin && (
                          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" title="Keine Zugangsdaten" />
                        )}
                      </div>
                      <span className="text-xs truncate" style={{ color: frist.portal_login ? textMain : textMuted }}>
                        {frist.portal_login || "—"}
                      </span>
                      <span className="text-xs truncate" style={{ color: frist.portal_uid ? textMain : textMuted }}>
                        {frist.portal_uid || "—"}
                      </span>
                      <span className="text-xs" style={{ color: frist.portal_password ? accentBg : textMuted }}>
                        {frist.portal_password ? "••••" : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Warning fehlende Credentials */}
            {missingCreds.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{ backgroundColor: warnBg, color: "#d97706", border: "1px solid #fbbf24" }}>
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {missingCreds.length} Frist(en) ohne Zugangsdaten – diese werden während der Automation übersprungen.
              </div>
            )}
          </>)}

          {/* Running Phase */}
          {phase === "running" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-4 w-4 animate-spin" style={{ color: accentBg }} />
                <span className="text-sm font-medium" style={{ color: textMain }}>
                  Einreichen läuft... {Math.min(currentIdx, results.length)}/{results.length}
                </span>
              </div>
              <div className="rounded-full h-2 overflow-hidden" style={{ backgroundColor: borderColor }}>
                <div className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${results.length > 0 ? (currentIdx / results.length) * 100 : 0}%`,
                    backgroundColor: accentBg,
                  }} />
              </div>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg"
                    style={{
                      backgroundColor: i === currentIdx
                        ? (isArtis ? "rgba(122,155,127,0.12)" : "rgba(99,102,241,0.08)")
                        : headerBg,
                      border: i === currentIdx ? `1px solid ${accentBg}` : `1px solid transparent`,
                    }}>
                    <div className="flex-shrink-0 mt-0.5">
                      {r.status === "pending" && i === currentIdx &&
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ color: STATUS_COLOR.running }} />}
                      {r.status === "pending" && i !== currentIdx &&
                        <div className="h-3.5 w-3.5 rounded-full border" style={{ borderColor: textMuted }} />}
                      {r.status === "success" && <CheckCircle2 className="h-3.5 w-3.5" style={{ color: STATUS_COLOR.success }} />}
                      {r.status === "error"   && <XCircle className="h-3.5 w-3.5" style={{ color: STATUS_COLOR.error }} />}
                      {r.status === "skipped" && <div className="h-3.5 w-3.5 rounded-full bg-zinc-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: textMain }}>
                        {r.customer.company_name}
                      </div>
                      {r.note && (
                        <div className="text-xs mt-0.5" style={{ color: textMuted }}>{r.note}</div>
                      )}
                    </div>
                    {r.screenshot && (
                      <img src={r.screenshot} alt="Screenshot"
                        className="flex-shrink-0 rounded border w-20 h-12 object-cover cursor-pointer"
                        style={{ borderColor }}
                        onClick={() => window.open(r.screenshot, "_blank")}
                        title="Klicken zum Vergrössern"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Done Phase – Ergebnisübersicht */}
          {phase === "done" && (
            <div className="space-y-4">
              {/* Zusammenfassung */}
              <div className="flex items-center gap-4 px-4 py-3 rounded-lg border"
                style={{ borderColor, backgroundColor: headerBg }}>
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: STATUS_COLOR.success }} />
                <div>
                  <div className="text-sm font-medium" style={{ color: textMain }}>
                    Automation abgeschlossen
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: textMuted }}>
                    {successCount} erfolgreich
                    {errorCount > 0 && <span style={{ color: STATUS_COLOR.error }}> · {errorCount} Fehler</span>}
                    {" "}· Kanton {kanton} / SP {jahr}
                  </div>
                </div>
              </div>

              {/* Ergebnis-Liste */}
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded"
                    style={{ backgroundColor: headerBg }}>
                    {r.status === "success" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                    {r.status === "error"   && <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                    {r.status === "skipped" && <div className="h-3.5 w-3.5 rounded-full bg-zinc-400 flex-shrink-0" />}
                    {r.status === "pending" && <div className="h-3.5 w-3.5 rounded-full border flex-shrink-0" style={{ borderColor: textMuted }} />}
                    <span className="flex-1 truncate" style={{ color: textMain }}>{r.customer.company_name}</span>
                    {r.note && <span style={{ color: textMuted }}>{r.note}</span>}
                    {r.screenshot && (
                      <img src={r.screenshot} alt="Screenshot"
                        className="flex-shrink-0 rounded border w-16 h-10 object-cover cursor-pointer"
                        style={{ borderColor }}
                        onClick={() => window.open(r.screenshot, "_blank")}
                        title="Klicken zum Vergrössern"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Nochmals-Hinweis bei Fehlern */}
              {errorCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ backgroundColor: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  {errorCount} Frist(en) konnten nicht eingereicht werden. Klicke «Nochmals einreichen» für einen weiteren Versuch.
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-5 py-3 flex items-center justify-between gap-3 border-t"
          style={{ backgroundColor: headerBg, borderColor }}>
          <div className="text-xs" style={{ color: textMuted }}>
            {phase === "setup"   && selected.length > 0 && `${selected.length} Frist${selected.length !== 1 ? "en" : ""} ausgewählt`}
            {phase === "running" && "Portal-Automation läuft..."}
            {phase === "done"    && `${successCount}/${results.length} erfolgreich eingereicht`}
          </div>
          <div className="flex gap-2">
            {phase === "running" && (
              <Button variant="outline" size="sm" onClick={handleSkipCurrent}
                style={{ borderColor: "#f59e0b", color: "#f59e0b" }}>
                Weiter
              </Button>
            )}
            {phase === "running" && (
              <Button variant="outline" size="sm" onClick={handleStop}
                style={{ borderColor: "#ef4444", color: "#ef4444" }}>
                Stoppen
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleClose}
              disabled={phase === "running"}
              style={{ borderColor, color: textMain }}>
              {phase === "done" ? "Schliessen" : "Abbrechen"}
            </Button>

            {/* Setup: Einreichen-Button */}
            {phase === "setup" && (
              <Button size="sm" onClick={handleStart}
                disabled={selected.length === 0 || !targetDate}
                style={{ backgroundColor: accentBg, color: "#fff" }}
                className="gap-1.5">
                <Play className="h-3.5 w-3.5" />
                Einreichen ({selected.length})
              </Button>
            )}

            {/* Done: Nochmals einreichen */}
            {phase === "done" && (
              <Button size="sm" onClick={handleRestart}
                style={{ backgroundColor: accentBg, color: "#fff" }}
                className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Nochmals einreichen
              </Button>
            )}
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
