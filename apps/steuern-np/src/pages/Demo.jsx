/**
 * Demo-Modus — Belegtriage ohne Backend.
 *
 * Zweck: die Pipeline ausprobieren, ohne Supabase-Projekt, ohne Schlüssel,
 * ohne Anmeldung. Alles läuft im Browser: Extraktion, OCR, Regel-Triage,
 * eSteuerauszug-Parsing, XML-Vorschau.
 *
 * Bewusst NUR die Regelstufe — der KI-Fallback braucht die Edge Function
 * und damit ein Backend. Was hier zu sehen ist, ist also die *untere*
 * Schranke der Erkennungsqualität, nicht die obere.
 *
 * Nichts wird hochgeladen oder gespeichert. Die Dateien verlassen den
 * Browser nicht — bei Steuerbelegen ist das keine Nebensache.
 */
import React, { useState, useCallback, useRef } from "react";
import {
  Upload, Loader2, FileCode2, ScanLine, Sparkles, AlertTriangle,
  CheckCircle2, EyeOff, HelpCircle, Landmark, Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractBeleg, dateiHash, terminateOcr } from "@/lib/dokumentText";
import { triageRegeln, brauchtKi, SCHWELLE_KI } from "@/lib/triage";
import { parseESteuerauszug, zuPositionen } from "@/lib/ech0196";
import { BELEGART_BY_KEY, echPfadFuer } from "@/lib/belegarten";
import { baueXml } from "@/lib/ech0119";

const RELEVANZ_STIL = {
  relevant:       { icon: CheckCircle2,  klasse: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  unklar:         { icon: HelpCircle,    klasse: "text-amber-700 bg-amber-50 border-amber-200" },
  nicht_relevant: { icon: EyeOff,        klasse: "text-slate-600 bg-slate-50 border-slate-200" },
};

const PARSE_LABEL = {
  ech0196: "eCH-0196 (XML)", ech0270: "Barcode", ech0275: "eCH-0275",
  pdf_text: "PDF-Textlayer", ocr: "OCR", manuell: "manuell",
};

export default function Demo() {
  const [periode, setPeriode] = useState(new Date().getFullYear() - 1);
  const [laeuft, setLaeuft] = useState(false);
  const [status, setStatus] = useState(null);
  const [belege, setBelege] = useState([]);
  const [ueberZiel, setUeberZiel] = useState(false);
  const [zeigeXml, setZeigeXml] = useState(false);
  const inputRef = useRef(null);

  const verarbeiten = useCallback(async (dateien) => {
    if (!dateien?.length) return;
    setLaeuft(true);
    const neue = [];
    const hashes = belege.map(b => b.hash);

    try {
      for (const datei of Array.from(dateien)) {
        setStatus(`${datei.name} — Prüfsumme…`);
        const hash = await dateiHash(datei);

        setStatus(`${datei.name} — Inhalt lesen…`);
        const { text, xml, parseMethode } = await extractBeleg(datei, {
          onStage: (s, i) => setStatus(`${datei.name} — ${i || s}`),
        });

        setStatus(`${datei.name} — einordnen…`);
        const triage = triageRegeln(
          { text, dateiname: datei.name, parseMethode, dateiHash: hash },
          { periode: Number(periode), bekannteHashes: [...hashes, ...neue.map(n => n.hash)] }
        );

        // Positionen: strukturiert aus dem eSteuerauszug, sonst keine —
        // ohne Backend gibt es keinen KI-Fallback.
        let positionen = [];
        let warnungen = [];
        if (parseMethode === "ech0196" && xml) {
          const erg = parseESteuerauszug(xml);
          positionen = zuPositionen(erg);
          warnungen = erg.warnungen || [];
        }

        neue.push({
          name: datei.name, groesse: datei.size, hash,
          textLaenge: (text || "").length,
          parseMethode, triage, positionen, warnungen,
          auszug: (text || "").slice(0, 400),
        });
      }
      setBelege(b => [...b, ...neue]);
    } finally {
      setLaeuft(false);
      setStatus(null);
      terminateOcr();
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [periode, belege]);

  const allePositionen = belege.flatMap(b => b.positionen);
  const xmlVorschau = belege.length
    ? baueXml({
        deklaration: { kanton: "ZH", periode: Number(periode) },
        person: { name: "Muster", vorname: "Demo", zivilstand: "ledig", gemeinde: "—" },
        positionen: allePositionen,
      })
    : null;

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-slate-400" />
          <h1 className="text-lg font-semibold">Belegtriage — Demo</h1>
        </div>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Zieh Steuerbelege hinein und sieh zu, wie sie eingeordnet werden. Läuft
          vollständig im Browser: <strong>nichts wird hochgeladen oder gespeichert</strong>,
          die Dateien verlassen dein Gerät nicht.
        </p>
        <p className="text-[12px] text-amber-700 mt-1.5 max-w-2xl">
          Hier läuft nur die <strong>Regelstufe</strong>. Der KI-Fallback für unklare Belege
          braucht das Backend — was du siehst, ist die untere Schranke der Erkennung,
          nicht die obere.
        </p>
      </div>

      <div className="flex items-end gap-3">
        <label className="space-y-0.5">
          <span className="block text-[11px] font-medium text-slate-600">Steuerperiode</span>
          <input type="number" value={periode} onChange={e => setPeriode(e.target.value)}
                 className="border border-slate-300 rounded-md px-2 h-8 text-sm w-28" />
        </label>
        {belege.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setBelege([])}>Zurücksetzen</Button>
        )}
      </div>

      {/* Ablagefläche */}
      <div
        onDragOver={e => { e.preventDefault(); setUeberZiel(true); }}
        onDragLeave={() => setUeberZiel(false)}
        onDrop={e => { e.preventDefault(); setUeberZiel(false); if (!laeuft) verarbeiten(e.dataTransfer.files); }}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          ueberZiel ? "border-slate-500 bg-slate-100" : "border-slate-300 bg-white"}`}
      >
        {laeuft ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-500" />
            <p className="text-sm mt-1.5">{status || "Wird verarbeitet…"}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Gescannte PDFs brauchen OCR — das dauert einige Sekunden pro Seite.
            </p>
          </>
        ) : (
          <>
            <Upload className="w-5 h-5 mx-auto text-slate-400" />
            <p className="text-sm mt-1.5">Belege hierher ziehen</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Lohnausweis, eSteuerauszug (XML), Säule-3a-Bescheinigung, Arztrechnung, Werbung…
            </p>
            <Button variant="outline" size="sm" className="mt-2"
                    onClick={() => inputRef.current?.click()}>
              Dateien wählen
            </Button>
            <input ref={inputRef} type="file" multiple hidden
                   accept=".pdf,.xml,.png,.jpg,.jpeg,.webp,.tif,.tiff,.txt"
                   onChange={e => verarbeiten(e.target.files)} />
          </>
        )}
      </div>

      {/* Ergebnisse */}
      {belege.map((b, i) => {
        const stil = RELEVANZ_STIL[b.triage.relevanz] || RELEVANZ_STIL.unklar;
        const Icon = stil.icon;
        const art = BELEGART_BY_KEY[b.triage.belegart];
        return (
          <div key={i} className={`rounded-lg border p-3 ${stil.klasse}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium truncate">{b.name}</span>
                </div>
                <div className="text-[11px] mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 opacity-90">
                  <span className="inline-flex items-center gap-1">
                    {b.parseMethode === "ech0196"
                      ? <FileCode2 className="w-3 h-3" />
                      : <ScanLine className="w-3 h-3" />}
                    {PARSE_LABEL[b.parseMethode] || b.parseMethode}
                  </span>
                  <span>{b.textLaenge.toLocaleString("de-CH")} Zeichen gelesen</span>
                  {b.triage.periodeBeleg && <span>Periode im Beleg: {b.triage.periodeBeleg}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold">{art?.label || "nicht klassifiziert"}</div>
                <div className="text-[11px]">
                  {Math.round(b.triage.confidence * 100)}% sicher
                </div>
              </div>
            </div>

            <p className="text-[12px] mt-2">{b.triage.begruendung}</p>

            {brauchtKi(b.triage) && (
              <p className="text-[11px] mt-1 inline-flex items-center gap-1 opacity-80">
                <Sparkles className="w-3 h-3" />
                Unter {Math.round(SCHWELLE_KI * 100)}% — im Vollbetrieb ginge dieser Beleg
                zusätzlich an die KI.
              </p>
            )}

            {b.warnungen.map((w, j) => (
              <p key={j} className="text-[11px] mt-1 inline-flex items-start gap-1 text-amber-800">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {w}
              </p>
            ))}

            {b.positionen.length > 0 && (
              <ul className="mt-2 space-y-0.5 bg-white/70 rounded-md p-2">
                {b.positionen.map((p, j) => (
                  <li key={j} className="flex justify-between text-[12px]">
                    <span>{p.bezeichnung}</span>
                    <span className="font-mono">
                      CHF {Number(p.wert_num).toLocaleString("de-CH", { minimumFractionDigits: 2 })}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {b.auszug && (
              <details className="mt-2">
                <summary className="text-[11px] cursor-pointer opacity-80">
                  Gelesener Text (Anfang)
                </summary>
                <pre className="text-[10px] mt-1 whitespace-pre-wrap bg-white/70 rounded p-2 max-h-40 overflow-auto">
                  {b.auszug}
                </pre>
              </details>
            )}
          </div>
        );
      })}

      {/* XML-Vorschau */}
      {xmlVorschau && (
        <section className="space-y-1.5">
          <button onClick={() => setZeigeXml(v => !v)}
                  className="text-sm font-semibold flex items-center gap-1.5 hover:text-slate-900">
            <Code2 className="w-4 h-4 text-slate-400" />
            eCH-0119-Vorschau {zeigeXml ? "ausblenden" : "anzeigen"}
          </button>
          <p className="text-[11px] text-rose-700 max-w-2xl">
            <strong>Nicht schemakonform.</strong> Die eCH-0119-XSD lag bei der Umsetzung nicht
            vor — Elementnamen sind aus dem Standarddokument abgeleitet, Kardinalitäten und
            Datentypen ungeprüft. Dieses XML ist eine Struktur­vorschau, kein einreichbares
            Paket. Die App verweigert den Paketbau deshalb auch bewusst.
          </p>
          {zeigeXml && (
            <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-auto max-h-96">
              {xmlVorschau}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
