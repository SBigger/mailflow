/**
 * DocPreviewContent.jsx — der reine Vorschau-Renderer.
 *
 * Herausgeloest aus DocHoverPreview, damit ihn ZWEI Oberflaechen teilen:
 *   - DocHoverPreview  = schwebendes Fenster (Hover ueber das Augen-Symbol)
 *   - DocPanelView     = fest angedocktes Panel (M-Files-Stil)
 * Der Renderer selbst kennt kein Fenster, keine Position, keine Groesse --
 * er fuellt schlicht seinen Container.
 *
 * Rendert KOMPLETT LOKAL (keine externen Dienste, kein SharePoint):
 *   Bild | PDF (alle Seiten, blaetterbar) | Excel (alle Blaetter) | Word (docx) | Text.
 *
 * Seitenblaettern und Excel-Blatt-Tabs gehoeren zur Bedienleiste, die je nach
 * Oberflaeche woanders sitzt. Darum meldet der Renderer seinen Zustand per
 * onStatus nach oben; die Leiste baut der Aufrufer selbst.
 */
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.js",
    import.meta.url,
  ).href;
}

const MAX_BYTES = 15 * 1024 * 1024;

const blobCache = new Map();  // doc.id -> { url, blob }

async function getBlob(doc, url) {
  const c = blobCache.get(doc?.id);
  if (c && c.url === url) return c.blob;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Download fehlgeschlagen (" + resp.status + ")");
  const blob = await resp.blob();
  blobCache.set(doc?.id, { url, blob });
  return blob;
}

export default function DocPreviewContent({ doc, url, C, onStatus, pdfScale = 1.6 }) {
  const [st, setSt] = useState({ kind: "loading", payload: null, error: null });

  const pdfDocRef = useRef(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNum, setPdfNum]   = useState(1);
  const [pdfImg, setPdfImg]   = useState(null);

  const [excel, setExcel] = useState(null);  // { sheets:[{name,rows}], active }
  const [pptx, setPptx]   = useState(null);  // { width, height, slides:[...] }
  const objUrlRef = useRef(null);
  const workerRef = useRef(null);

  // ── Inhalt laden ──
  useEffect(() => {
    let cancelled = false;
    setSt({ kind: "loading", payload: null, error: null });
    setPdfImg(null); pdfDocRef.current = null; setExcel(null); setPptx(null);
    const name = (doc?.filename || doc?.name || "").toLowerCase();

    if (!doc || !url) { setSt({ kind: "idle" }); return; }

    (async () => {
      try {
        if (doc?.file_size && doc?.file_size > MAX_BYTES) { if (!cancelled) setSt({ kind: "toobig" }); return; }
        const blob = await getBlob(doc, url);
        if (cancelled) return;

        if (/\.(png|jpe?g|webp|bmp|gif|svg)$/.test(name) || (blob.type || "").startsWith("image/")) {
          const o = URL.createObjectURL(blob); objUrlRef.current = o;
          if (!cancelled) setSt({ kind: "img", payload: o }); return;
        }
        if (name.endsWith(".pdf") || blob.type === "application/pdf") {
          const buf = await blob.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          if (cancelled) return;
          pdfDocRef.current = pdf; setPdfNum(pdf.numPages); setPdfPage(1); setSt({ kind: "pdf" }); return;
        }
        if (/\.(xlsx|xls|xlsm|xlsb|ods|csv)$/.test(name)) {
          const buf = await blob.arrayBuffer();
          if (cancelled) return;
          // Parsen im Web-Worker: haelt den Haupt-Thread frei, damit die App bei grossen
          // Dateien (z. B. XLSM) nicht einfriert.
          let worker = null;
          try {
            worker = new Worker(new URL("./xlsxPreview.worker.js", import.meta.url), { type: "module" });
          } catch { worker = null; }

          if (worker) {
            workerRef.current = worker;
            const timeout = setTimeout(() => {
              if (cancelled) return;
              try { worker.terminate(); } catch { /* ignore */ }
              if (workerRef.current === worker) workerRef.current = null;
              setSt({ kind: "error", error: "Vorschau dauert zu lange – bitte die Datei herunterladen." });
            }, 25000);
            worker.onmessage = (ev) => {
              clearTimeout(timeout);
              try { worker.terminate(); } catch { /* ignore */ }
              if (workerRef.current === worker) workerRef.current = null;
              if (cancelled) return;
              if (ev.data?.ok) { setExcel({ sheets: ev.data.sheets, active: 0 }); setSt({ kind: "excel" }); }
              else setSt({ kind: "error", error: ev.data?.error || "Excel konnte nicht gelesen werden" });
            };
            worker.onerror = () => {
              clearTimeout(timeout);
              try { worker.terminate(); } catch { /* ignore */ }
              if (workerRef.current === worker) workerRef.current = null;
              if (!cancelled) setSt({ kind: "error", error: "Vorschau fehlgeschlagen – bitte herunterladen." });
            };
            worker.postMessage({ buf });
            return;
          }

          // Fallback ohne Worker (kann kurz haengen): Zeilen beim Lesen begrenzen.
          // Gleiche Datenform wie der Worker, nur ohne Zellformate.
          const { read, utils } = await import("xlsx");
          const wb = read(new Uint8Array(buf), { type: "array", cellDates: true, sheetRows: 1000 });
          const sheets = wb.SheetNames.map(nm => ({
            name: nm, cols: [], styles: [], freeze: null, formatted: false,
            rows: utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: false, defval: "" })
              .slice(0, 1000)
              .map(r => ({ px: null, cells: (Array.isArray(r) ? r.slice(0, 60) : []).map(v => ({ t: String(v ?? ""), s: -1 })) })),
          }));
          if (!cancelled) { setExcel({ sheets, active: 0 }); setSt({ kind: "excel" }); } return;
        }
        if (/\.(pptx|pptm)$/.test(name)) {
          const buf = await blob.arrayBuffer();
          const { parsePptx } = await import("@/lib/pptxPreview");
          const deck = await parsePptx(buf);
          if (!cancelled) {
            setPptx(deck);
            setPdfPage(1); setPdfNum(deck.slides.length);   // gleiche Blaetter-Leiste wie beim PDF
            setSt({ kind: "pptx" });
          }
          return;
        }
        if (/\.ppt$/.test(name)) {
          if (!cancelled) setSt({ kind: "error", error: "Alte .ppt-Dateien lassen sich nicht anzeigen - bitte als .pptx speichern oder herunterladen." });
          return;
        }
        if (/\.(docx|docm)$/.test(name)) {
          const buf = await blob.arrayBuffer();
          const mod = await import("mammoth/mammoth.browser");
          const mammoth = mod.default || mod;
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setSt({ kind: "word", payload: value || "" }); return;
        }
        if (/\.(txt|md|json|xml|log|csv)$/.test(name) || (blob.type || "").startsWith("text/")) {
          const txt = await blob.text();
          if (!cancelled) setSt({ kind: "text", payload: txt.slice(0, 12000) }); return;
        }
        if (!cancelled) setSt({ kind: "none" });
      } catch (e) {
        if (!cancelled) setSt({ kind: "error", error: e.message });
      }
    })();

    return () => {
      cancelled = true;
      if (workerRef.current) { try { workerRef.current.terminate(); } catch { /* ignore */ } workerRef.current = null; }
      if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    };
  }, [doc?.id, url]);

  // ── PDF-Seite rendern ──
  useEffect(() => {
    if (st.kind !== "pdf" || !pdfDocRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDocRef.current.getPage(pdfPage);
        const vp = page.getViewport({ scale: pdfScale });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        if (!cancelled) setPdfImg(canvas.toDataURL("image/jpeg", 0.85));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [st.kind, pdfPage, pdfScale]);

  // ── Zustand nach oben melden, damit der Aufrufer seine Leiste bauen kann ──
  useEffect(() => {
    onStatus?.({ kind: st.kind, pdfPage, pdfNum, setPdfPage, excel, setExcel });
    // onStatus bewusst NICHT in den Abhaengigkeiten: der Aufrufer gibt oft eine
    // frische Funktion herein, das wuerde eine Endlosschleife ergeben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.kind, pdfPage, pdfNum, excel]);

  return (
    <>
      {st.kind === "idle"    && <Centered c={C}>Dokument in der Liste anklicken</Centered>}
      {st.kind === "loading" && <Centered c={C}>Lade Vorschau…</Centered>}
      {st.kind === "toobig"  && <Centered c={C}>Datei zu groß für die Schnell-Vorschau<br/>(über 15 MB) – bitte herunterladen.</Centered>}
      {st.kind === "none"    && <Centered c={C}>Keine Vorschau für diesen Dateityp.</Centered>}
      {st.kind === "error"   && <Centered c={C}>⚠ {st.error}</Centered>}

      {st.kind === "img" && (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
          <img src={st.payload} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }} />
        </div>
      )}

      {st.kind === "pdf" && (
        <div style={{ padding: 10, display: "flex", justifyContent: "center" }}>
          {pdfImg
            ? <img src={pdfImg} alt="" style={{ maxWidth: "100%", borderRadius: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }} />
            : <span style={{ color: C.faint, fontSize: 12, padding: 30 }}>Seite wird gerendert…</span>}
        </div>
      )}

      {st.kind === "excel" && <ExcelSheet sheet={excel?.sheets?.[excel.active]} />}

      {st.kind === "pptx" && <PptxSlide deck={pptx} index={pdfPage - 1} />}

      {st.kind === "word" && (
        <div style={{ padding: 12 }}>
          <style>{`
            .hov-word table { border-collapse: collapse; width: 100%; margin: 6px 0; }
            .hov-word td, .hov-word th { border: 1px solid #ccc; padding: 3px 6px; font-size: 11px; vertical-align: top; }
            .hov-word img { max-width: 100%; height: auto; }
            .hov-word p { margin: 0 0 0.5em; } .hov-word h1,.hov-word h2,.hov-word h3 { margin: .5em 0 .25em; }
          `}</style>
          <div className="hov-word"
            style={{ background: "#fff", color: "#1a1a1a", padding: "22px 24px", borderRadius: 3,
              fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif", fontSize: 13, lineHeight: 1.55 }}
            dangerouslySetInnerHTML={{ __html: st.payload || "<p style='color:#888'>Keine Textvorschau.</p>" }} />
        </div>
      )}

      {st.kind === "text" && (
        <pre style={{ margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", color: C.fg }}>{st.payload}</pre>
      )}
    </>
  );
}

export function Centered({ children, c }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
      color: c?.faint || "#888", fontSize: 12, padding: 20 }}>{children}</div>
  );
}

/** Theme-Farben fuer Rahmen/Kopf/Inhalt — von Popup und Panel gemeinsam genutzt. */
export function previewChrome(theme) {
  if (theme === "artis") return {
    border: "#4a7a4f", headBg: "#4a7a4f", headFg: "#ffffff", headBorder: "#3c6741",
    btn: "#d9ead9", btnHover: "#ffffff", body: "#eef3ee", fg: "#1f2a1f", faint: "#5d7a5d",
    cellBorder: "#cddccd", headerRow: "#dce9dc", rowAlt: "#f3f8f3",
    tabBar: "#e4efe4", tabActive: "#ffffff", tabActiveFg: "#1f2a1f", tabFg: "#5d7a5d", tabAccent: "#4a7a4f",
  };
  if (theme === "light") return {
    border: "#cfcfdf", headBg: "#ffffff", headFg: "#1a1a2e", headBorder: "#e6e6ee",
    btn: "#9a9ab0", btnHover: "#1a1a2e", body: "#f4f4f8", fg: "#1a1a2e", faint: "#7a7a9a",
    cellBorder: "#dcdce6", headerRow: "#e8e8f0", rowAlt: "#f7f7fb",
    tabBar: "#eeeef4", tabActive: "#ffffff", tabActiveFg: "#1a1a2e", tabFg: "#7a7a9a", tabAccent: "#7c3aed",
  };
  return {
    border: "#3a3a3a", headBg: "#222222", headFg: "#eeeeee", headBorder: "#333333",
    btn: "#999999", btnHover: "#ffffff", body: "#151515", fg: "#dddddd", faint: "#777777",
    cellBorder: "#2c2c2c", headerRow: "#252525", rowAlt: "#1b1b1b",
    tabBar: "#111111", tabActive: "#252525", tabActiveFg: "#ffffff", tabFg: "#888888", tabAccent: "#4a7a4f",
  };
}

// ── Excel-Blatt ────────────────────────────────────────────────────────────
// Bewusst immer auf Weiss und in Excel-Optik, unabhaengig vom App-Thema: graue
// Gitternetzlinien, Spaltenkoepfe A B C, Zeilennummern, und die Formate aus der
// Datei (fett, Farben, Rahmen, Ausrichtung, Zahlenformate). Fixierte Bereiche
// aus Excel bleiben beim Scrollen stehen.
const SHEET_BG     = "#ffffff";
const SHEET_GRID   = "#d4d4d4";
const SHEET_HEADBG = "#f5f5f5";
const SHEET_HEADFG = "#616161";
const SHEET_FG     = "#000000";
const ROWHEAD_W    = 42;
const HEAD_H       = 18;   // Hoehe der Spaltenkopfzeile
const DEFAULT_ROW_H = 20;  // Excel-Standardzeile in Pixel

function colLetter(n) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function ExcelSheet({ sheet }) {
  if (!sheet) return null;
  const { rows = [], cols = [], styles = [], freeze } = sheet;
  const colCount = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
  if (!colCount) return <Centered c={{ faint: "#888" }}>Das Blatt ist leer.</Centered>;

  // Fixierte Spalten/Zeilen aus Excel: links bzw. oben klebend.
  const freezeX = freeze?.x || 0;
  const freezeY = freeze?.y || 0;
  const leftOffset = (ci) => {
    let x = ROWHEAD_W;
    for (let i = 0; i < ci; i++) x += cols[i]?.px ?? 84;
    return x;
  };
  // Fixierte Zeilen brauchen ihren echten Abstand von oben -- mit einer fest
  // angenommenen Zeilenhoehe wuerden sie sich bei hohen Zeilen ueberlappen.
  const topOffset = [];
  {
    let y = HEAD_H;
    for (let i = 0; i < rows.length; i++) { topOffset.push(y); y += rows[i].px || DEFAULT_ROW_H; }
  }

  const headCell = {
    position: "sticky", top: 0, zIndex: 3, background: SHEET_HEADBG, color: SHEET_HEADFG,
    border: "1px solid " + SHEET_GRID, fontSize: 10, fontWeight: 400, textAlign: "center",
    padding: "1px 4px", height: HEAD_H,
  };

  return (
    <div style={{ background: SHEET_BG, minHeight: "100%", overflow: "auto" }}>
      <table style={{ borderCollapse: "collapse", background: SHEET_BG, color: SHEET_FG,
        fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif", fontSize: 12, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: ROWHEAD_W }} />
          {Array.from({ length: colCount }, (_, i) => (
            <col key={i} style={{ width: cols[i]?.px ?? 84 }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...headCell, left: 0, zIndex: 5, width: ROWHEAD_W }} />
            {Array.from({ length: colCount }, (_, i) => (
              <th key={i} style={i < freezeX
                ? { ...headCell, position: "sticky", left: leftOffset(i), zIndex: 5 }
                : headCell}>{colLetter(i + 1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            if (row.px === 0) return null;                    // in Excel ausgeblendet
            const stickyRow = ri < freezeY;
            return (
              <tr key={ri} style={row.px ? { height: row.px } : undefined}>
                <th style={{ ...headCell, top: stickyRow ? topOffset[ri] : undefined,
                  position: "sticky", left: 0, zIndex: stickyRow ? 5 : 2 }}>{ri + 1}</th>
                {Array.from({ length: colCount }, (_, ci) => {
                  const cell = row.cells[ci];
                  if (cell === null) return null;             // von einer Verbindung verdeckt
                  const st = cell && cell.s >= 0 ? styles[cell.s] : null;
                  const sticky = ci < freezeX || stickyRow;
                  return (
                    <td key={ci} colSpan={cell?.cs} rowSpan={cell?.rs}
                      style={{
                        border: "1px solid " + SHEET_GRID,
                        borderTop:    st?.bt || undefined,
                        borderRight:  st?.br || undefined,
                        borderBottom: st?.bb || undefined,
                        borderLeft:   st?.bl || undefined,
                        background: st?.bg || SHEET_BG,
                        color: st?.c || SHEET_FG,
                        fontWeight: st?.b ? 700 : 400,
                        fontStyle: st?.i ? "italic" : undefined,
                        textDecoration: st?.u ? "underline" : st?.s ? "line-through" : undefined,
                        fontSize: st?.sz ? st.sz + "px" : undefined,
                        fontFamily: st?.ff || undefined,
                        textAlign: st?.ha || "left",
                        verticalAlign: st?.va === "middle" ? "middle" : st?.va === "top" ? "top" : "bottom",
                        whiteSpace: st?.wrap ? "pre-wrap" : "nowrap",
                        paddingLeft: 4 + (st?.ind ? st.ind * 8 : 0),
                        paddingRight: 4,
                        overflow: "hidden", textOverflow: "ellipsis",
                        ...(sticky ? {
                          position: "sticky", zIndex: 1,
                          ...(ci < freezeX ? { left: leftOffset(ci) } : null),
                          ...(stickyRow ? { top: topOffset[ri] } : null),
                        } : null),
                      }}>{cell?.t || ""}</td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── PowerPoint-Folie ───────────────────────────────────────────────────────
// Die Folie wird in ihrer echten Groesse aufgebaut (Positionen kommen als
// Pixel aus pptxPreview) und dann als Ganzes auf die Breite des Containers
// skaliert. Damit stimmen Verhaeltnisse und Schriftgroessen zueinander, egal
// wie schmal die Vorschau gerade ist.
function PptxSlide({ deck, index }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  const slide = deck?.slides?.[index];

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || !deck?.width) return;
    const fit = () => {
      const avail = node.clientWidth - 24;            // Rand links und rechts
      setScale(Math.max(0.15, Math.min(1.6, avail / deck.width)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(node);
    return () => ro.disconnect();
  }, [deck?.width]);

  if (!deck || !slide) return null;

  return (
    <div ref={wrapRef} style={{ padding: 12, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: deck.width * scale, height: deck.height * scale, flexShrink: 0 }}>
        <div style={{ width: deck.width, height: deck.height, transform: `scale(${scale})`, transformOrigin: "top left",
          position: "relative", background: "#ffffff", color: "#1a1a1a", overflow: "hidden",
          boxShadow: "0 2px 14px rgba(0,0,0,0.28)", borderRadius: 2,
          fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif" }}>
          {slide.shapes.map((sh, i) => (
            <PptxShape key={i} shape={sh} />
          ))}
        </div>
      </div>

      {slide.notes && (
        <div style={{ width: deck.width * scale, marginTop: 10, fontSize: 11, lineHeight: 1.5,
          color: "#888", whiteSpace: "pre-wrap", textAlign: "left" }}>
          <b style={{ color: "#aaa" }}>Notizen:</b> {slide.notes}
        </div>
      )}
    </div>
  );
}

function PptxShape({ shape }) {
  const b = shape.box;
  const base = {
    position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h,
    ...(b.rot ? { transform: `rotate(${b.rot}deg)` } : null),
  };

  if (shape.kind === "image") {
    return shape.url
      ? <img src={shape.url} alt="" style={{ ...base, objectFit: "contain" }} />
      : <div style={{ ...base, border: "1px dashed #ccc", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 11, color: "#aaa" }}>Bild</div>;
  }

  if (shape.kind === "table") {
    return (
      <div style={{ ...base, overflow: "hidden" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, tableLayout: shape.grid?.length ? "fixed" : "auto" }}>
          {shape.grid?.length > 0 && (
            <colgroup>{shape.grid.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          )}
          <tbody>
            {shape.rows.map((row, ri) => (
              <tr key={ri}>
                {row.filter(c => !c.merged).map((c, ci) => (
                  <td key={ci} colSpan={c.colSpan > 1 ? c.colSpan : undefined}
                    style={{ border: "1px solid #c8c8c8", padding: "2px 5px", verticalAlign: "top" }}>
                    <PptxParas paras={c.paras} compact />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ ...base, display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden" }}>
      <PptxParas paras={shape.paras} />
    </div>
  );
}

const PPTX_ALIGN = { l: "left", ctr: "center", r: "right", just: "justify" };

function PptxParas({ paras, compact }) {
  return paras.map((p, pi) => (
    <p key={pi} style={{
      margin: compact ? 0 : "0 0 3px",
      paddingLeft: p.level * 20 + (p.bullet ? 14 : 0),
      textIndent: p.bullet ? -14 : 0,
      textAlign: PPTX_ALIGN[p.align] || "left",
      lineHeight: 1.25,
    }}>
      {p.bullet && <span style={{ opacity: 0.65 }}>{"\u2022 "}</span>}
      {p.runs.map((r, ri) => r.text === "\n" ? <br key={ri} /> : (
        <span key={ri} style={{
          fontWeight: r.bold ? 700 : 400,
          fontStyle: r.italic ? "italic" : undefined,
          textDecoration: r.underline ? "underline" : r.strike ? "line-through" : undefined,
          fontSize: r.size ? r.size * 1.333 : undefined,   // Punkt in Pixel
          color: r.color || undefined,
          fontFamily: r.font || undefined,
        }}>{r.text}</span>
      ))}
    </p>
  ));
}
