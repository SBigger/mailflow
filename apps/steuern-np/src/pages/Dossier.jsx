/**
 * Dossier — die Arbeitsfläche einer Steuererklärung.
 *
 * Drei Schritte in der Reihenfolge, in der man sie tut:
 *   Belege     einlesen, sortieren, aussortieren
 *   Zuweisung  auf die Positionen des SG-Hauptformulars, Seite 1 bis 4
 *   Export     sortiert nach Seite und Ziffer
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload, Loader2, FolderOpen, FileText, Eye, EyeOff, Check, Plus, Trash2,
  AlertTriangle, Download, HelpCircle, CircleCheck, Copy,
} from "lucide-react";
import * as db from "@/lib/db";
import { stapelVerarbeiten } from "@/lib/ingest";
import { terminateOcr } from "@/lib/dokumentText";
import { BELEGART_BY_KEY } from "@/lib/belegarten";
import {
  SEITEN, POSITIONEN, POSITION_BY_ZIFFER, positionenDerSeite,
  positionenFuerBelegart, summenBerechnen, VERIFIZIERT,
} from "@/lib/sgFormular";
import {
  alsUebersicht, alsCsv, alsJsonExport, exportSpeichern, dateinameBauen, zeilenBauen,
} from "@/lib/export";

const SCHRITT = {
  hash: "Prüfsumme", extract: "Inhalt lesen", ocr: "OCR läuft", "ocr-done": "OCR fertig",
  triage: "Einordnen", ablegen: "Ablegen", save: "Speichern", fertig: "Fertig", fehler: "Fehler",
};

const chf = (n) => n == null ? "—"
  : Number(n).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ══════════════════════════════════════════════════════════════════════
// Belegkarte
// ══════════════════════════════════════════════════════════════════════

function BelegKarte({ beleg, positionen, onRelevanz, onOeffnen }) {
  const art = BELEGART_BY_KEY[beleg.belegart];
  const raus = beleg.relevanz === "nicht_relevant";
  const marke = raus ? "marke-raus" : beleg.relevanz === "unklar" ? "marke-unklar" : "marke-relevant";
  const markeText = raus ? "Aussortiert" : beleg.relevanz === "unklar" ? "Unklar" : "Relevant";

  return (
    <div className="karte" style={{ padding: "12px 14px", opacity: raus ? .72 : 1 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 shrink-0" style={{ color: "var(--ink-faint)" }} />
            <span className="font-medium truncate">{beleg.dateiname}</span>
            <span className={`marke ${marke}`}>{markeText}</span>
          </div>
          <div className="text-[12px] mt-1" style={{ color: "var(--ink-weak)" }}>
            {art?.label || "nicht klassifiziert"}
            {beleg.periode_beleg ? ` · Periode ${beleg.periode_beleg}` : ""}
            {beleg.confidence != null ? ` · ${Math.round(beleg.confidence * 100)} % sicher` : ""}
          </div>
          {beleg.begruendung && (
            <p className="text-[12px] mt-1" style={{ color: "var(--ink-faint)" }}>
              {beleg.begruendung}
            </p>
          )}
          {positionen.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {positionen.map(p => (
                <li key={p.id} className="text-[12px] flex justify-between gap-4"
                    style={{ color: "var(--ink-weak)" }}>
                  <span>Ziffer {p.ziffer} · {p.bezeichnung}</span>
                  <span className="zahl">{p.betrag == null ? "offen" : chf(p.betrag)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {beleg.ablage && (
            <button className="knopf knopf-still knopf-klein" title="Datei öffnen"
                    onClick={() => onOeffnen(beleg)}>
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          )}
          <button className="knopf knopf-still knopf-klein"
                  title={raus ? "Doch berücksichtigen" : "Aussortieren"}
                  onClick={() => onRelevanz(beleg, raus ? "relevant" : "nicht_relevant")}>
            {raus ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Zuweisungszeile
// ══════════════════════════════════════════════════════════════════════

function PositionZeile({ def, eintraege, summe, onAendern, onLoeschen, onNeu }) {
  const [neu, setNeu] = useState("");
  const istSumme = !!def.summeVon;

  return (
    <div style={{ borderTop: "1px solid var(--rule-soft)", padding: "7px 0" }}>
      <div className="flex items-baseline gap-3">
        <span className="eyebrow zahl shrink-0" style={{ width: 46 }}>{def.ziffer}</span>
        <span className={`flex-1 min-w-0 ${istSumme ? "font-semibold" : ""}`}>{def.label}</span>
        <span className={`zahl shrink-0 text-right ${istSumme ? "font-semibold" : ""}`}
              style={{ width: 120, color: summe == null ? "var(--ink-faint)" : "var(--ink)" }}>
          {chf(summe)}
        </span>
      </div>

      {def.hinweis && (
        <p className="text-[11.5px] mt-0.5" style={{ color: "var(--ink-faint)", paddingLeft: 58 }}>
          {def.hinweis}
        </p>
      )}

      {!istSumme && eintraege.map(e => (
        <div key={e.id} className="flex items-center gap-2 mt-1" style={{ paddingLeft: 58 }}>
          <span className="text-[12px] flex-1 min-w-0 truncate" style={{ color: "var(--ink-weak)" }}>
            {e.bezeichnung || "—"}
            {e.herkunft === "ech0196" && (
              <span className="marke marke-relevant ml-2">belegt</span>
            )}
            {e.herkunft === "vorschlag" && (
              <span className="marke marke-unklar ml-2">Vorschlag</span>
            )}
          </span>
          <input
            className="feld zahl knopf-klein" style={{ width: 116, height: 26, textAlign: "right" }}
            inputMode="decimal" placeholder="Betrag"
            defaultValue={e.betrag ?? ""}
            onBlur={ev => onAendern(e, ev.target.value)}
            aria-label={`Betrag für Ziffer ${def.ziffer}`}
          />
          <button className="knopf knopf-still knopf-klein" title="Entfernen"
                  onClick={() => onLoeschen(e)}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {!istSumme && (
        <div className="flex items-center gap-2 mt-1" style={{ paddingLeft: 58 }}>
          <input className="feld zahl" style={{ width: 116, height: 26, textAlign: "right" }}
                 inputMode="decimal" placeholder="+ Betrag"
                 value={neu} onChange={e => setNeu(e.target.value)}
                 onKeyDown={e => {
                   if (e.key === "Enter" && neu.trim()) { onNeu(def, neu); setNeu(""); }
                 }}
                 aria-label={`Neuen Betrag für Ziffer ${def.ziffer} erfassen`} />
          <button className="knopf knopf-rand knopf-klein" disabled={!neu.trim()}
                  onClick={() => { onNeu(def, neu); setNeu(""); }}>
            <Plus className="w-3.5 h-3.5" /> von Hand
          </button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Seite
// ══════════════════════════════════════════════════════════════════════

export default function Dossier({ deklaration, person, mandant, benutzer, onZurueck }) {
  const [reiter, setReiter] = useState("belege");
  const [belege, setBelege] = useState([]);
  const [positionen, setPositionen] = useState([]);
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState(null);
  const [zeigeRaus, setZeigeRaus] = useState(false);
  const [meldung, setMeldung] = useState(null);
  const [ort, setOrt] = useState("");
  const inputRef = useRef(null);

  const neuLaden = useCallback(async () => {
    setBelege(await db.belegeListe(deklaration.id));
    setPositionen(await db.positionenListe(deklaration.id));
  }, [deklaration.id]);

  useEffect(() => { neuLaden(); db.speicherOrt().then(setOrt); }, [neuLaden]);

  // ─── Einlesen ───────────────────────────────────────────────────
  const einlesen = useCallback(async (dateien) => {
    if (!dateien?.length) return;
    setLaeuft(true); setMeldung(null);
    try {
      const res = await stapelVerarbeiten(
        Array.from(dateien),
        {
          mandantId: deklaration.mandant_id, deklarationId: deklaration.id,
          periode: deklaration.periode,
          bekannteHashes: belege.map(b => b.datei_hash).filter(Boolean),
        },
        setFortschritt
      );
      const fehler  = res.filter(r => r.fehler).length;
      const doppelt = res.filter(r => r.uebersprungen).length;
      const neu     = res.length - fehler - doppelt;
      setMeldung({
        art: fehler ? "warn" : "ok",
        text: `${neu} Beleg(e) erfasst` +
              (doppelt ? `, ${doppelt} Duplikat(e) übersprungen` : "") +
              (fehler ? `, ${fehler} fehlgeschlagen` : ""),
      });
      await neuLaden();
    } finally {
      setLaeuft(false); setFortschritt(null); terminateOcr();
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [deklaration, belege, neuLaden]);

  // ─── Zuweisung ──────────────────────────────────────────────────
  const proZiffer = useMemo(() => {
    const m = {};
    for (const p of positionen) (m[p.ziffer] ||= []).push(p);
    return m;
  }, [positionen]);

  const summen = useMemo(() => {
    const roh = {};
    for (const [z, liste] of Object.entries(proZiffer)) {
      const werte = liste.filter(p => p.betrag != null);
      if (werte.length) roh[z] = werte.reduce((s, p) => s + Number(p.betrag), 0);
    }
    return summenBerechnen(roh);
  }, [proZiffer]);

  const betragAendern = async (eintrag, roh) => {
    const wert = roh.trim() === "" ? null : Number(String(roh).replace(/['\s]/g, "").replace(",", "."));
    if (wert != null && !Number.isFinite(wert)) {
      setMeldung({ art: "warn", text: `«${roh}» ist keine Zahl` });
      return;
    }
    // Ein von Hand gesetzter Wert ist bestätigt — er hat einen Menschen als Herkunft.
    await db.positionAendern(eintrag.id, {
      betrag: wert,
      bestaetigt_von: benutzer?.id ?? "unbekannt",
      bestaetigt_am: new Date().toISOString(),
    });
    await neuLaden();
  };

  const positionNeu = async (def, roh) => {
    const wert = Number(String(roh).replace(/['\s]/g, "").replace(",", "."));
    if (!Number.isFinite(wert)) { setMeldung({ art: "warn", text: `«${roh}» ist keine Zahl` }); return; }
    await db.positionAnlegen({
      mandant_id: deklaration.mandant_id, deklaration_id: deklaration.id,
      ziffer: def.ziffer, bezeichnung: def.label, betrag: wert,
      herkunft: "manuell", bestaetigt_von: benutzer?.id ?? "unbekannt",
      bestaetigt_am: new Date().toISOString(),
    });
    await neuLaden();
  };

  const relevanzAendern = async (beleg, relevanz) => {
    await db.belegAendern(beleg.id, {
      relevanz,
      relevanz_grund: relevanz === "relevant" ? null : "von Hand aussortiert",
      bestaetigt_von: benutzer?.id ?? null,
    });
    await neuLaden();
  };

  const belegOeffnen = async (beleg) => {
    if (window.steuerAPI && beleg.ablage) await window.steuerAPI.belegOeffnen(beleg.ablage);
  };

  // ─── Export ─────────────────────────────────────────────────────
  const exportieren = async (format) => {
    const daten = { deklaration, person, positionen, belege };
    const [inhalt, endung] =
      format === "csv"  ? [alsCsv(daten), "csv"] :
      format === "json" ? [alsJsonExport(daten), "json"] :
                          [alsUebersicht(daten), "txt"];
    const res = await exportSpeichern(dateinameBauen(deklaration, person, endung), inhalt);
    if (!res?.abgebrochen) {
      setMeldung({ art: "ok", text: `Export gespeichert: ${res.pfad}` });
    }
  };

  // ─── Kennzahlen ─────────────────────────────────────────────────
  const unklare = belege.filter(b => b.relevanz === "unklar");
  const rein    = belege.filter(b => b.relevanz === "relevant");
  const raus    = belege.filter(b => b.relevanz === "nicht_relevant");
  const offen   = positionen.filter(p => p.betrag == null).length;
  const zeilen  = zeilenBauen(positionen, belege);

  const REITER = [
    { key: "belege",    label: "Belege",    zahl: belege.length },
    { key: "zuweisung", label: "Zuweisung", zahl: zeilen.filter(z => !z.istSumme).length },
    { key: "export",    label: "Export" },
  ];

  return (
    <div style={{ padding: "24px 28px 64px" }}>
      {/* Kopf */}
      <div className="flex items-start justify-between gap-4 flex-wrap"
           style={{ borderBottom: "2px solid var(--ink)", paddingBottom: 12 }}>
        <div>
          <p className="eyebrow" style={{ color: "var(--spot)" }}>
            {mandant?.name} · Steuerperiode {deklaration.periode} · Kanton {deklaration.kanton}
          </p>
          <h1 className="serif" style={{ fontSize: 30, fontWeight: 600, margin: "4px 0 0", lineHeight: 1.1 }}>
            {`${person.vorname || ""} ${person.name}`.trim()}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="knopf knopf-still" onClick={onZurueck}>Übersicht</button>
          {window.steuerAPI && (
            <button className="knopf knopf-rand" onClick={() => window.steuerAPI.ordnerZeigen()}>
              <FolderOpen className="w-4 h-4" /> Datenordner
            </button>
          )}
        </div>
      </div>

      {/* Reiter */}
      <div className="flex items-center gap-1 mt-4">
        {REITER.map(r => (
          <button key={r.key} onClick={() => setReiter(r.key)}
                  className={`knopf ${reiter === r.key ? "knopf-primaer" : "knopf-still"}`}>
            {r.label}
            {r.zahl != null && <span className="zahl" style={{ opacity: .7 }}>{r.zahl}</span>}
          </button>
        ))}
        <div className="flex-1" />
        {offen > 0 && (
          <span className="marke marke-unklar">{offen} Position(en) ohne Betrag</span>
        )}
      </div>

      {meldung && (
        <div className="karte mt-3" style={{
          padding: "9px 12px", fontSize: 13,
          borderLeft: `3px solid ${meldung.art === "warn" ? "var(--warn)" : "var(--spot)"}`,
        }}>
          {meldung.text}
        </div>
      )}

      {/* ── Belege ─────────────────────────────────────────────── */}
      {reiter === "belege" && (
        <div className="mt-4 space-y-4">
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (!laeuft) einlesen(e.dataTransfer.files); }}
            className="karte"
            style={{ padding: 24, textAlign: "center", borderStyle: "dashed", borderWidth: 2 }}
          >
            {laeuft ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: "var(--spot)" }} />
                <p className="mt-2 font-medium">
                  {fortschritt ? `Beleg ${fortschritt.index + 1} von ${fortschritt.gesamt}` : "Wird gelesen…"}
                </p>
                {fortschritt && (
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--ink-weak)" }}>
                    {SCHRITT[fortschritt.schritt] || fortschritt.schritt} · {fortschritt.datei?.name}
                  </p>
                )}
              </>
            ) : (
              <>
                <Upload className="w-5 h-5 mx-auto" style={{ color: "var(--ink-faint)" }} />
                <p className="mt-2">Belege hierher ziehen</p>
                <p className="text-[12px] mt-0.5" style={{ color: "var(--ink-weak)" }}>
                  PDF, Scan, Foto oder eSteuerauszug-XML. Gescanntes wird per OCR gelesen.
                </p>
                <button className="knopf knopf-rand mt-3" onClick={() => inputRef.current?.click()}>
                  Dateien wählen
                </button>
                <input ref={inputRef} type="file" multiple hidden
                       accept=".pdf,.xml,.png,.jpg,.jpeg,.webp,.tif,.tiff,.txt"
                       onChange={e => einlesen(e.target.files)} />
              </>
            )}
          </div>

          {unklare.length > 0 && (
            <section>
              <h2 className="eyebrow" style={{ color: "var(--warn)" }}>
                Unklar — brauchen eine Entscheidung ({unklare.length})
              </h2>
              <div className="space-y-2 mt-2">
                {unklare.map(b => (
                  <BelegKarte key={b.id} beleg={b} positionen={positionen.filter(p => p.beleg_id === b.id)}
                              onRelevanz={relevanzAendern} onOeffnen={belegOeffnen} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="eyebrow">Berücksichtigt ({rein.length})</h2>
            <div className="space-y-2 mt-2">
              {rein.length === 0 && (
                <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
                  Noch keine Belege erfasst.
                </p>
              )}
              {rein.map(b => (
                <BelegKarte key={b.id} beleg={b} positionen={positionen.filter(p => p.beleg_id === b.id)}
                            onRelevanz={relevanzAendern} onOeffnen={belegOeffnen} />
              ))}
            </div>
          </section>

          <section>
            <button className="eyebrow flex items-center gap-1.5"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    onClick={() => setZeigeRaus(v => !v)}>
              {zeigeRaus ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              Aussortiert ({raus.length})
            </button>
            <p className="text-[11.5px] mt-1" style={{ color: "var(--ink-faint)" }}>
              Aussortierte Belege werden nie gelöscht. Ein zu Unrecht aussortierter Beleg ist
              der teuerste Fehler — bitte durchsehen.
            </p>
            {zeigeRaus && (
              <div className="space-y-2 mt-2">
                {raus.map(b => (
                  <BelegKarte key={b.id} beleg={b} positionen={[]}
                              onRelevanz={relevanzAendern} onOeffnen={belegOeffnen} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Zuweisung ──────────────────────────────────────────── */}
      {reiter === "zuweisung" && (
        <div className="mt-4 space-y-5">
          {!VERIFIZIERT && (
            <div className="karte" style={{
              padding: "10px 13px", fontSize: 12.5, borderLeft: "3px solid var(--warn)",
            }}>
              Die Ziffern dieses Formularmodells sind noch nicht gegen die Wegleitung des
              Kantons St. Gallen geprüft. Struktur und Reihenfolge stimmen mit dem üblichen
              Aufbau überein, die konkreten Nummern sind vor der Übernahme abzugleichen.
            </div>
          )}

          {SEITEN.map(seite => {
            const defs = positionenDerSeite(seite.nr).filter(d => d.typ === "betrag");
            if (!defs.length) return null;
            return (
              <section key={seite.nr} className="karte" style={{ padding: "14px 16px" }}>
                <div className="flex items-baseline justify-between gap-3"
                     style={{ borderBottom: "1px solid var(--rule)", paddingBottom: 8 }}>
                  <h2 className="serif" style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
                    Seite {seite.nr} · {seite.titel}
                  </h2>
                  <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
                    {seite.beschreibung}
                  </span>
                </div>
                <div className="mt-1">
                  {defs.map(def => (
                    <PositionZeile
                      key={def.ziffer} def={def}
                      eintraege={proZiffer[def.ziffer] ?? []}
                      summe={summen[def.ziffer] ?? null}
                      onAendern={betragAendern}
                      onLoeschen={async e => { await db.positionLoeschen(e.id); await neuLaden(); }}
                      onNeu={positionNeu}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ── Export ─────────────────────────────────────────────── */}
      {reiter === "export" && (
        <div className="mt-4 space-y-4" style={{ maxWidth: 760 }}>
          <div className="karte" style={{ padding: 16 }}>
            <h2 className="serif" style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
              Sortiert nach Seite und Ziffer
            </h2>
            <p className="text-[13px] mt-1" style={{ color: "var(--ink-weak)" }}>
              Der Export folgt der Reihenfolge des Formulars, nicht der Erfassung —
              damit er sich von vorne nach hinten abarbeiten lässt.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="knopf knopf-primaer" onClick={() => exportieren("uebersicht")}>
                <Download className="w-4 h-4" /> Übersicht zum Abtippen
              </button>
              <button className="knopf knopf-rand" onClick={() => exportieren("csv")}>
                <Download className="w-4 h-4" /> CSV für Excel
              </button>
              <button className="knopf knopf-rand" onClick={() => exportieren("json")}>
                <Download className="w-4 h-4" /> JSON
              </button>
            </div>
          </div>

          <div className="karte" style={{ padding: 16 }}>
            <h2 className="eyebrow">Vorschau</h2>
            <pre className="mt-2" style={{
              fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11.5,
              lineHeight: 1.5, whiteSpace: "pre", overflowX: "auto",
              color: "var(--ink-weak)", margin: 0,
            }}>
{alsUebersicht({ deklaration, person, positionen, belege })}
            </pre>
          </div>

          <p className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
            Datenbestand: {ort}
          </p>
        </div>
      )}
    </div>
  );
}
