import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Building2, ScanSearch, Download, X, ExternalLink, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import {
  sucheFirmen, firmenDetail, gemeindeliste, revisionsmandate, RECHTSFORMEN, formatUid,
} from "@/lib/handelsregister";

// ── Hilfen ────────────────────────────────────────────────────────────────────
const adresseVon = (r) => [r.strasse, [r.plz, r.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");

function csvExport(rows, dateiname) {
  if (!rows.length) return;
  const kopf = Object.keys(rows[0]);
  const zeile = (r) => kopf.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(";");
  // BOM, damit Excel die Umlaute richtig liest.
  const blob = new Blob(["﻿" + [kopf.join(";"), ...rows.map(zeile)].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: dateiname });
  a.click();
  URL.revokeObjectURL(a.href);
}

const Hinweis = ({ children }) => (
  <details className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
    <summary className="cursor-pointer font-medium text-slate-700 dark:text-zinc-200">
      <Info className="mr-1.5 inline h-4 w-4 align-[-2px]" />
      {children[0]}
    </summary>
    <div className="mt-2 leading-relaxed">{children[1]}</div>
  </details>
);

const Feld = ({ label, children }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</label>
    {children}
  </div>
);

const inputCls =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100";

// ── Detail-Dialog (Zefix) ─────────────────────────────────────────────────────
function DetailDialog({ uid, onClose }) {
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    let aktiv = true;
    firmenDetail(uid).then(
      (d) => aktiv && setDaten(d),
      (e) => aktiv && setFehler(e.message),
    );
    return () => { aktiv = false; };
  }, [uid]);

  const Zeile = ({ k, children }) => (
    <>
      <dt className="text-xs text-slate-400 sm:text-sm">{k}</dt>
      <dd className="mb-2 text-sm sm:mb-0">{children}</dd>
    </>
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-zinc-900 sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{daten?.name ?? "Lade …"}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        {fehler && <p className="text-sm text-red-600">{fehler}</p>}
        {!daten && !fehler && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}

        {daten && (
          <dl className="grid grid-cols-1 gap-x-5 sm:grid-cols-[150px_1fr] sm:gap-y-2">
            <Zeile k="UID">{formatUid(daten.uid)}</Zeile>
            <Zeile k="Rechtsform">{daten.rechtsform_lang}</Zeile>
            <Zeile k="Sitz">{daten.sitz} ({daten.kanton})</Zeile>
            <Zeile k="Domizil">
              {[[daten.adresse?.street, daten.adresse?.houseNumber].filter(Boolean).join(" "),
                [daten.adresse?.swissZipCode, daten.adresse?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
            </Zeile>
            <Zeile k="Kapital">
              {daten.kapital ? `${daten.kapital.waehrung} ${daten.kapital.betrag.toLocaleString("de-CH")}` : "—"}
            </Zeile>
            <Zeile k="Status">{daten.status}</Zeile>
            <Zeile k="Revisionsstelle">
              {daten.revisionsstellen.length
                ? daten.revisionsstellen.map((r) => <div key={r.uid}>{r.name} ({r.sitz})</div>)
                : <span className="text-slate-400">— keine (Opting-out) —</span>}
            </Zeile>
            <Zeile k="Zweck"><span className="leading-relaxed">{daten.zweck ?? "—"}</span></Zeile>
            {daten.auszug_url && (
              <Zeile k="Handelsregister">
                <a href={daten.auszug_url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                  Kantonaler Auszug <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Zeile>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}

// ── Ergebnisliste: Tabelle ab md, darunter Karten ─────────────────────────────
function Ergebnisse({ spalten, rows, onKlick }) {
  if (!rows.length) return null;
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 dark:border-zinc-700 md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-zinc-800">
            <tr>{spalten.map((s) => (
              <th key={s.key} className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.uid || i}
                  onClick={() => r.uid && onKlick?.(r.uid)}
                  className={`border-t border-slate-100 dark:border-zinc-800 ${r.uid ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-800/60" : ""}`}>
                {spalten.map((s) => <td key={s.key} className="px-3 py-2.5 align-top">{s.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2.5 md:hidden">
        {rows.map((r, i) => (
          <div key={r.uid || i}
               onClick={() => r.uid && onKlick?.(r.uid)}
               className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-1.5 font-semibold">{spalten[0].render(r)}</div>
            {spalten.slice(1).map((s) => {
              const inhalt = s.render(r);
              if (!inhalt || (typeof inhalt === "string" && !inhalt.trim())) return null;
              return (
                <div key={s.key} className="text-sm">
                  <span className="text-xs text-slate-400">{s.label} · </span>{inhalt}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Reiter 1: Suchen (LINDAS) ─────────────────────────────────────────────────
function SuchenTab({ gemeinden, onDetail }) {
  const [f, setF] = useState({ zweck: "", name: "", gemeinde: "", kanton: "", form: "" });
  const [rows, setRows] = useState([]);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState("");

  const setzen = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const suchen = async () => {
    const gem = gemeinden.find((g) => g.name.toLowerCase() === f.gemeinde.trim().toLowerCase());
    if (f.gemeinde.trim() && !gem) return toast.error("Gemeinde nicht gefunden — bitte aus der Liste wählen.");
    const params = { zweck: f.zweck.trim(), name: f.name.trim(), kanton: f.kanton.trim(), form: f.form, bfsId: gem?.bfsId };
    if (!Object.values(params).some(Boolean)) return toast.error("Mindestens ein Filter nötig.");

    // Ohne Ort-Filter durchsucht LINDAS die ganze Schweiz im Volltext (~1 Min).
    // Mit Gemeinde oder Kanton sind es ~2 Sekunden.
    const schweizweit = !gem && !params.kanton;
    setLaeuft(true);
    setMeldung(schweizweit
      ? "Schweizweite Volltextsuche – das dauert bis zu 2 Minuten. Tipp: Gemeinde oder Kanton eingeben macht es sofort schnell."
      : "Suche läuft …");
    try {
      const treffer = await sucheFirmen(params);
      setRows(treffer);
      setMeldung(`${treffer.length} Treffer${treffer.length >= 200 ? " — Limit erreicht, Filter verfeinern" : ""}`);
    } catch (e) {
      setMeldung(""); toast.error(e.message);
    } finally { setLaeuft(false); }
  };

  const spalten = [
    { key: "name", label: "Firma", render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "rechtsform", label: "Rechtsform", render: (r) => r.rechtsform },
    { key: "adresse", label: "Adresse", render: adresseVon },
    { key: "uid", label: "UID", render: (r) => formatUid(r.uid) },
    { key: "zweck", label: "Zweck", render: (r) => <span className="text-slate-500 dark:text-zinc-400">{r.zweck.slice(0, 110)}{r.zweck.length > 110 ? "…" : ""}</span> },
  ];

  return (
    <>
      <Hinweis>
        {"Warum die Trefferzahl eine Untergrenze ist"}
        {"Das Handelsregister kennt keinen NOGA-Branchencode. Die Branchensuche durchsucht den Zweck-Volltext — ein Schreiner mit dem Zweck «Holzarbeiten aller Art» erscheint deshalb nicht, und wer gar nicht im Handelsregister steht, erst recht nicht."}
      </Hinweis>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="col-span-2"><Feld label="Zweck enthält">
          <input className={inputCls} value={f.zweck} onChange={setzen("zweck")} placeholder="schreiner"
                 onKeyDown={(e) => e.key === "Enter" && suchen()} />
        </Feld></div>
        <Feld label="Name enthält"><input className={inputCls} value={f.name} onChange={setzen("name")} onKeyDown={(e) => e.key === "Enter" && suchen()} /></Feld>
        <Feld label="Gemeinde">
          <input className={inputCls} list="gemeindeliste" value={f.gemeinde} onChange={setzen("gemeinde")} placeholder="Rorschach" />
          <datalist id="gemeindeliste">
            {gemeinden.map((g) => <option key={g.bfsId} value={g.name}>{g.kanton}</option>)}
          </datalist>
        </Feld>
        <Feld label="Kanton"><input className={inputCls} maxLength={2} value={f.kanton} onChange={setzen("kanton")} placeholder="SG" /></Feld>
        <Feld label="Rechtsform">
          <select className={inputCls} value={f.form} onChange={setzen("form")}>
            <option value="">alle</option>
            {Object.entries(RECHTSFORMEN).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </Feld>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button onClick={suchen} disabled={laeuft}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-800 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {laeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Suchen
        </button>
        {rows.length > 0 && (
          <button onClick={() => csvExport(rows.map((r) => ({ firma: r.name, uid: formatUid(r.uid), rechtsform: r.rechtsform, adresse: adresseVon(r), kanton: r.kanton, zweck: r.zweck })), "firmensuche.csv")}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm dark:border-zinc-600">
            <Download className="h-4 w-4" /> CSV
          </button>
        )}
        <span className="text-sm text-slate-500 dark:text-zinc-400">{meldung}</span>
      </div>

      <Ergebnisse spalten={spalten} rows={rows} onKlick={onDetail} />
    </>
  );
}

// ── Reiter 2: Revisionsmandate (SHAB rückwärts + Zefix-Bestätigung) ───────────
function MandateTab({ onDetail }) {
  const [revisor, setRevisor] = useState("");
  const [rows, setRows] = useState([]);
  const [fortschritt, setFortschritt] = useState(null);
  const [meldung, setMeldung] = useState("");
  const abbruch = useRef(null);

  const suchen = async () => {
    if (revisor.trim().length < 3) return toast.error("Mindestens 3 Zeichen.");
    abbruch.current = new AbortController();
    setRows([]); setMeldung("");
    try {
      const d = await revisionsmandate(revisor.trim(), { onProgress: setFortschritt, signal: abbruch.current.signal });
      setRows(d.rows);
      const aktiv = d.rows.filter((r) => r.status === "aktiv").length;
      setMeldung(`${aktiv} aktive Mandate · ${d.rows.length} Firmen hatten diese Revisionsstelle je · ${d.publikationen} SHAB-Publikationen durchsucht`);
    } catch (e) {
      if (e.name !== "AbortError") toast.error(e.message);
    } finally { setFortschritt(null); }
  };

  const spalten = [
    { key: "firma", label: "Firma", render: (r) => <span className="font-medium">{r.firma}</span> },
    { key: "status", label: "Status", render: (r) => (
        <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${
          r.status === "aktiv"
            ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
            : "border-amber-600 text-amber-700 dark:text-amber-400"}`}>{r.status}</span>
      ) },
    { key: "adresse", label: "Adresse", render: (r) => r.adresse },
    { key: "uid", label: "UID", render: (r) => r.uidFormatiert },
    { key: "letztePublikation", label: "Letzte Publikation", render: (r) => r.letztePublikation },
  ];

  return (
    <>
      <Hinweis>
        {"Wie das funktioniert (der erste Lauf dauert ein bis drei Minuten)"}
        {"Zefix nennt die Revisionsstelle nur im Datensatz der geprüften Firma — eine Rückwärtssuche gibt es dort nicht. Dieser Reiter durchsucht deshalb den SHAB-Volltext aller Handelsregister-Publikationen und bestätigt jeden Treffer anschliessend gegen den aktuellen Zefix-Stand."}
      </Hinweis>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1"><Feld label="Revisionsgesellschaft">
          <input className={inputCls} value={revisor} onChange={(e) => setRevisor(e.target.value)}
                 placeholder="Interrevision" onKeyDown={(e) => e.key === "Enter" && !fortschritt && suchen()} />
        </Feld></div>
        <button onClick={suchen} disabled={!!fortschritt}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-800 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {fortschritt ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />} Mandate suchen
        </button>
        {rows.length > 0 && (
          <button onClick={() => csvExport(rows.map(({ uid, ...r }) => r), "revisionsmandate.csv")}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 text-sm dark:border-zinc-600">
            <Download className="h-4 w-4" /> CSV
          </button>
        )}
      </div>

      {fortschritt && (
        <p className="mb-4 text-sm text-slate-500 dark:text-zinc-400">
          {fortschritt.phase} … <b>{fortschritt.done}</b>{fortschritt.total ? ` / ${fortschritt.total}` : ""}
        </p>
      )}
      {meldung && <p className="mb-4 text-sm text-slate-500 dark:text-zinc-400">{meldung}</p>}

      <Ergebnisse spalten={spalten} rows={rows} onKlick={onDetail} />
    </>
  );
}

// ── Seite ─────────────────────────────────────────────────────────────────────
export default function Firmensuche() {
  const [reiter, setReiter] = useState("suchen");
  const [gemeinden, setGemeinden] = useState([]);
  const [detailUid, setDetailUid] = useState(null);

  useEffect(() => { gemeindeliste().then(setGemeinden).catch(() => setGemeinden([])); }, []);

  const reiterCls = (id) =>
    `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
      reiter === id
        ? "border-slate-800 text-slate-900 dark:border-zinc-100 dark:text-zinc-100"
        : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300"}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-1 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-slate-400" />
        <h1 className="text-xl font-semibold">Firmensuche</h1>
      </div>
      <p className="mb-5 text-sm text-slate-500 dark:text-zinc-400">
        Handelsregister der Schweiz — Suche über LINDAS, Mandate über das SHAB, Details aus Zefix.
      </p>

      <div className="mb-5 flex border-b border-slate-200 dark:border-zinc-700">
        <button className={reiterCls("suchen")} onClick={() => setReiter("suchen")}>Suchen</button>
        <button className={reiterCls("mandate")} onClick={() => setReiter("mandate")}>Revisionsmandate</button>
      </div>

      {reiter === "suchen"
        ? <SuchenTab gemeinden={gemeinden} onDetail={setDetailUid} />
        : <MandateTab onDetail={setDetailUid} />}

      {detailUid && <DetailDialog uid={detailUid} onClose={() => setDetailUid(null)} />}
    </div>
  );
}
