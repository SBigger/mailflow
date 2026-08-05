/**
 * Beleg-Upload mit Fortschritt.
 *
 * Zeigt bewusst an, WAS gerade passiert (Lesen, OCR, Einordnen, Ablegen) —
 * OCR dauert bei gescannten PDFs mehrere Sekunden pro Seite, und ein
 * stummer Spinner sieht dabei aus wie ein Absturz.
 */
import React, { useCallback, useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stapelVerarbeiten } from "@/lib/ingest";
import { terminateOcr } from "@/lib/dokumentText";
import { toast } from "sonner";

const SCHRITT_TEXT = {
  hash:      "Prüfsumme",
  extract:   "Inhalt lesen",
  ocr:       "OCR läuft",
  "ocr-done":"OCR fertig",
  triage:    "Einordnen",
  upload:    "Ablegen",
  save:      "Speichern",
  fertig:    "Fertig",
  fehler:    "Fehler",
  warnung:   "Hinweis",
};

export default function BelegUpload({ mandantId, deklarationId, periode, bekannteHashes, onFertig }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState(null);
  const [ergebnisse, setErgebnisse] = useState([]);
  const [ueberZiel, setUeberZiel] = useState(false);
  const inputRef = useRef(null);

  const verarbeiten = useCallback(async (dateien) => {
    if (!dateien?.length) return;
    if (!deklarationId) {
      toast.error("Zuerst eine Deklaration wählen");
      return;
    }

    setLaeuft(true);
    setErgebnisse([]);
    try {
      const res = await stapelVerarbeiten(
        Array.from(dateien),
        { mandantId, deklarationId, periode, bekannteHashes },
        (p) => setFortschritt(p)
      );
      setErgebnisse(res);

      const fehler   = res.filter(r => r.fehler).length;
      const doppelt  = res.filter(r => r.uebersprungen).length;
      const neu      = res.length - fehler - doppelt;

      if (fehler)  toast.error(`${fehler} Beleg(e) fehlgeschlagen`);
      if (neu)     toast.success(`${neu} Beleg(e) erfasst${doppelt ? `, ${doppelt} Duplikat(e)` : ""}`);
      else if (doppelt && !fehler) toast.info(`${doppelt} Duplikat(e), nichts Neues`);

      onFertig?.(res);
    } finally {
      setLaeuft(false);
      setFortschritt(null);
      // OCR-Worker freigeben — er belegt sonst dauerhaft Speicher.
      terminateOcr();
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [mandantId, deklarationId, periode, bekannteHashes, onFertig]);

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setUeberZiel(true); }}
        onDragLeave={() => setUeberZiel(false)}
        onDrop={(e) => {
          e.preventDefault();
          setUeberZiel(false);
          if (!laeuft) verarbeiten(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          ueberZiel ? "border-slate-500 bg-slate-100" : "border-slate-300 bg-white"
        }`}
      >
        {laeuft ? (
          <div className="space-y-1">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-500" />
            <p className="text-sm font-medium">
              {fortschritt
                ? `Beleg ${fortschritt.index + 1} von ${fortschritt.gesamt}`
                : "Wird verarbeitet…"}
            </p>
            {fortschritt && (
              <p className="text-[11px] text-slate-500 truncate">
                {SCHRITT_TEXT[fortschritt.schritt] || fortschritt.schritt}
                {" · "}{fortschritt.datei?.name}
                {fortschritt.info ? ` — ${fortschritt.info}` : ""}
              </p>
            )}
          </div>
        ) : (
          <>
            <Upload className="w-5 h-5 mx-auto text-slate-400" />
            <p className="text-sm mt-1.5">Belege hierher ziehen</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              PDF, Bilder, eSteuerauszug-XML. Gescannte PDFs werden per OCR gelesen.
            </p>
            <Button variant="outline" size="sm" className="mt-2"
                    onClick={() => inputRef.current?.click()}>
              Dateien wählen
            </Button>
            <input ref={inputRef} type="file" multiple hidden
                   accept=".pdf,.xml,.png,.jpg,.jpeg,.webp,.tif,.tiff,.txt"
                   onChange={(e) => verarbeiten(e.target.files)} />
          </>
        )}
      </div>

      {ergebnisse.length > 0 && (
        <ul className="space-y-1">
          {ergebnisse.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12px]">
              {r.fehler
                ? <AlertTriangle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" />
                : r.uebersprungen
                  ? <Copy className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />}
              <span className="min-w-0">
                <span className="font-medium">{r.datei.name}</span>
                {r.fehler
                  ? <span className="text-rose-600"> — {r.fehler}</span>
                  : r.uebersprungen
                    ? <span className="text-slate-500"> — bereits im Dossier</span>
                    : <span className="text-slate-600">
                        {" — "}{r.triage?.belegart || "nicht klassifiziert"}
                        {r.positionen ? `, ${r.positionen} Position(en)` : ""}
                      </span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
