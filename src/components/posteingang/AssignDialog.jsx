import {useEffect, useRef, useState} from "react";
import {X, ChevronLeft, ChevronRight, Sparkles} from "lucide-react";
import {entities, supabase} from "../../api/supabaseClient.js";
import {toast} from "sonner";
import {useQuery} from "@tanstack/react-query";
import TagSelectWidget from "../dokumente/TagSelectWidget.jsx";
import {Button} from "../ui/button.jsx";
import { CATEGORIES } from "@/lib/categories";
// Gleiche Pipeline wie die Massenablage: Text-Extraktion (inkl. OCR fuer Scans),
// lokales Matching (Kunde/Jahr/Kategorie/Tags) und KI-Fallback fuer Bild-Belege.
import { analyzeFile, extractDocumentText, pdfPagesToImages } from "@/lib/batchAiSuggest";

const BUCKET = "posteingang";

// ─── Vorschau (links im Dialog) ──────────────────────────────────────────
// Rendert komplett lokal aus dem bereits geladenen Blob:
// Bild | PDF (Seiten blaetterbar) | Excel (Blatt-Tabs) | Word (docx) | Text.
function PreviewPane({ file, loadError, s, border }) {
  const [st, setSt] = useState({ kind: "loading" });
  const [pdfPages, setPdfPages] = useState([]);
  const [pdfPage, setPdfPage] = useState(0);
  const [excel, setExcel] = useState(null); // { sheets: [{name, rows}], active }
  const objUrlRef = useRef(null);

  useEffect(() => {
    if (loadError) { setSt({ kind: "error", error: loadError }); return; }
    if (!file) { setSt({ kind: "loading" }); return; }
    let cancelled = false;
    setSt({ kind: "loading" });
    setPdfPages([]); setPdfPage(0); setExcel(null);
    const name = (file.name || "").toLowerCase();
    const type = file.type || "";

    (async () => {
      try {
        if (type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|svg)$/.test(name)) {
          const o = URL.createObjectURL(file);
          objUrlRef.current = o;
          if (!cancelled) setSt({ kind: "img", payload: o });
          return;
        }
        if (type === "application/pdf" || name.endsWith(".pdf")) {
          // pdfPagesToImages pairt pdfjs mit dem passenden Worker (siehe batchAiSuggest) —
          // eigenes getDocument hier wuerde den bekannten render()-Haenger riskieren.
          const imgs = await pdfPagesToImages(file, 15);
          if (cancelled) return;
          if (!imgs.length) { setSt({ kind: "error", error: "PDF konnte nicht gerendert werden." }); return; }
          setPdfPages(imgs.map(b => `data:image/jpeg;base64,${b}`));
          setSt({ kind: "pdf" });
          return;
        }
        if (/\.(xlsx|xls|xlsm|xlsb|ods|csv)$/.test(name)) {
          const { read, utils } = await import("xlsx");
          const buf = await file.arrayBuffer();
          const wb = read(new Uint8Array(buf), { type: "array", cellDates: true, sheetRows: 500 });
          const sheets = wb.SheetNames.map(nm => ({
            name: nm,
            rows: utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: false, defval: "" })
              .slice(0, 500).map(r => (Array.isArray(r) ? r.slice(0, 60) : r)),
          }));
          if (!cancelled) { setExcel({ sheets, active: 0 }); setSt({ kind: "excel" }); }
          return;
        }
        if (/\.(docx|docm)$/.test(name)) {
          const buf = await file.arrayBuffer();
          const mod = await import("mammoth/mammoth.browser");
          const mammoth = mod.default || mod;
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setSt({ kind: "word", payload: value || "" });
          return;
        }
        if (type.startsWith("text/") || /\.(txt|md|json|xml|log)$/.test(name)) {
          const txt = await file.text();
          if (!cancelled) setSt({ kind: "text", payload: txt.slice(0, 12000) });
          return;
        }
        if (!cancelled) setSt({ kind: "none" });
      } catch (e) {
        if (!cancelled) setSt({ kind: "error", error: e.message });
      }
    })();

    return () => {
      cancelled = true;
      if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    };
  }, [file, loadError]);

  const centered = (msg) => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      textAlign: "center", color: s.textMuted, fontSize: 12, padding: 20 }}>{msg}</div>
  );

  if (st.kind === "loading") return centered("Lade Vorschau…");
  if (st.kind === "error")   return centered(`⚠ ${st.error}`);
  if (st.kind === "none")    return centered("Keine Vorschau für diesen Dateityp – bitte herunterladen.");

  if (st.kind === "img") return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 10, overflow: "auto" }}>
      <img src={st.payload} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }} />
    </div>
  );

  if (st.kind === "pdf") return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {pdfPages.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "5px 10px",
          borderBottom: "1px solid " + border, flexShrink: 0 }}>
          <button type="button" onClick={() => setPdfPage(p => Math.max(0, p - 1))} disabled={pdfPage === 0}
            style={{ background: "none", border: "none", cursor: pdfPage > 0 ? "pointer" : "default",
              color: pdfPage > 0 ? s.textMain : s.textMuted, display: "flex", padding: 3 }}>
            <ChevronLeft size={15} />
          </button>
          <span style={{ color: s.textMuted, fontSize: 11, minWidth: 70, textAlign: "center" }}>
            Seite {pdfPage + 1} / {pdfPages.length}
          </span>
          <button type="button" onClick={() => setPdfPage(p => Math.min(pdfPages.length - 1, p + 1))} disabled={pdfPage >= pdfPages.length - 1}
            style={{ background: "none", border: "none", cursor: pdfPage < pdfPages.length - 1 ? "pointer" : "default",
              color: pdfPage < pdfPages.length - 1 ? s.textMain : s.textMuted, display: "flex", padding: 3 }}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto", padding: 10, display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
        <img src={pdfPages[pdfPage]} alt={`Seite ${pdfPage + 1}`}
          style={{ maxWidth: "100%", borderRadius: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.25)" }} />
      </div>
    </div>
  );

  if (st.kind === "excel") {
    const rows = excel?.sheets?.[excel.active]?.rows || [];
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: 4 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11, color: s.textMain }}>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {(row.length ? row : [""]).map((cell, ci) => (
                    <td key={ci} style={{ border: "1px solid " + border, padding: "2px 6px", whiteSpace: "nowrap",
                      maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", fontWeight: ri === 0 ? 600 : 400 }}>
                      {String(cell ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {excel && excel.sheets.length > 1 && (
          <div style={{ flexShrink: 0, display: "flex", borderTop: "1px solid " + border, overflowX: "auto" }}>
            {excel.sheets.map((sh, i) => (
              <button type="button" key={i} onClick={() => setExcel(e => ({ ...e, active: i }))}
                style={{ padding: "4px 12px", fontSize: 10, border: "none", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
                  borderRight: "1px solid " + border,
                  background: i === excel.active ? s.selBg || "rgba(122,155,127,0.18)" : "transparent",
                  color: i === excel.active ? s.textMain : s.textMuted }}>
                {sh.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (st.kind === "word") return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: 12 }}>
      <style>{`
        .pb-word table { border-collapse: collapse; width: 100%; margin: 6px 0; }
        .pb-word td, .pb-word th { border: 1px solid #ccc; padding: 3px 6px; font-size: 11px; vertical-align: top; }
        .pb-word img { max-width: 100%; height: auto; }
        .pb-word p { margin: 0 0 0.5em; } .pb-word h1,.pb-word h2,.pb-word h3 { margin: .5em 0 .25em; }
      `}</style>
      <div className="pb-word"
        style={{ background: "#fff", color: "#1a1a1a", padding: "22px 24px", borderRadius: 3, maxWidth: 780, margin: "0 auto",
          fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif", fontSize: 13, lineHeight: 1.55,
          boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }}
        dangerouslySetInnerHTML={{ __html: st.payload || "<p style='color:#888'>Keine Textvorschau.</p>" }} />
    </div>
  );

  // Text
  return (
    <pre style={{ margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap",
      wordBreak: "break-word", color: s.textMain, height: "100%", overflow: "auto" }}>{st.payload}</pre>
  );
}

export default function AssignDialog({ customers, preCustomerId, doc, onClose, s, border, accent }) {
    // Der Ordner im Bucket IST der Kunde (Upload-Link legt pro Kunde ab) —
    // in der Ansicht "Alle Dokumente" kommt kein preCustomerId mit, der
    // Ordner weiss es trotzdem.
    const folderCustId = customers?.some(c => c.id === doc.customer_id) ? doc.customer_id : "";
    const displayName = doc.fileName || doc.name || "";

    const [custId,     setCustId]     = useState(preCustomerId || folderCustId || "");
    const [name,       setName]       = useState(displayName.includes(".") ? displayName.slice(0, displayName.lastIndexOf(".")) : displayName);
    const [cat,        setCategory]   = useState("");   // leer bis Tag gewählt
    const [ye,         setYear]       = useState(doc.year || "");
    const [tagIds,     setTagIds]     = useState([]);
    const [notes,      setNotes]      = useState("");
    const [uploading,  setUploading]  = useState(false);
    const [catError,   setCatError]   = useState(false);
    const yearRef = useRef();

    // ── Datei einmal laden: dient Vorschau UND Texterkennung ──────────
    const [fileObj,   setFileObj]   = useState(null);
    const [fileErr,   setFileErr]   = useState(null);
    const [ki, setKi] = useState({ status: "lädt", info: "", applied: [] });
    const contentTextRef = useRef("");
    // Was der Nutzer selbst angefasst hat, ueberschreibt die KI nie.
    const touched = useRef({ tags: false, cat: false, year: false, cust: false });

    const { data: allTags = [] } = useQuery({
        queryKey: ["dok_tags"],
        queryFn:  () => entities.DokTag.list("sort_order"),
    });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 600);
            if (cancelled) return;
            if (error || !data?.signedUrl) {
                setFileErr("Datei konnte nicht geladen werden" + (error?.message ? `: ${error.message}` : ""));
                setKi({ status: "fertig", info: "", applied: [] });
                return;
            }
            try {
                const resp = await fetch(data.signedUrl);
                if (!resp.ok) throw new Error("Download fehlgeschlagen (" + resp.status + ")");
                const blob = await resp.blob();
                if (cancelled) return;
                const file = new File([blob], displayName || "datei",
                    { type: blob.type || doc.metadata?.mimetype || "" });
                setFileObj(file);
            } catch (e) {
                if (!cancelled) { setFileErr(e.message); setKi({ status: "fertig", info: "", applied: [] }); }
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doc.storage_path]);

    // ── Texterkennung wie in der Massenablage, sobald Datei + Tags da sind ──
    const analysisStarted = useRef(false);
    useEffect(() => {
        if (!fileObj || !allTags.length || analysisStarted.current) return;
        analysisStarted.current = true;
        let cancelled = false;
        (async () => {
            try {
                setKi({ status: "läuft", info: "Texterkennung läuft…", applied: [] });
                const res = await analyzeFile(fileObj, {
                    customers, allTags, useClaude: true,
                    onStage: (stage, info) => { if (!cancelled && info) setKi(k => ({ ...k, info })); },
                });
                if (cancelled) return;
                contentTextRef.current = res.contentText || "";

                // Alles synchron entscheiden: `touched` sagt, ob der Nutzer ein Feld
                // schon angefasst hat — nur unberuehrte Felder bekommen Vorschlaege.
                // (Kein applied.push in State-Updatern: die laufen verzoegert und
                // der Hinweis-Text waere unvollstaendig.)
                const sugg = res.suggestions || {};
                const applied = [];

                if (sugg.tag_ids?.length && !touched.current.tags) {
                    setTagIds(sugg.tag_ids);
                    const names = sugg.tag_ids
                        .map(id => allTags.find(t => t.id === id)?.name).filter(Boolean);
                    if (names.length) applied.push(`Tag «${names.join(", ")}»`);
                }

                if (!touched.current.cat) {
                    // Kategorie vom Parent-Tag (gleiche Logik wie beim manuellen
                    // Tag-Klick), sonst aus dem Keyword-Matching.
                    let neueKat = "";
                    if (sugg.tag_ids?.length && !touched.current.tags) {
                        const tag = allTags.find(t => t.id === sugg.tag_ids[0]);
                        const parent = tag?.parent_id ? allTags.find(t => t.id === tag.parent_id) : tag;
                        if (parent?.category) neueKat = parent.category;
                    }
                    if (!neueKat && sugg.category) neueKat = sugg.category;
                    if (neueKat) {
                        setCategory(neueKat);
                        setCatError(false);
                        applied.push(`Kategorie ${CATEGORIES.find(c => c.key === neueKat)?.label || neueKat}`);
                    }
                }

                if (sugg.year && !touched.current.year && !doc.year) {
                    setYear(String(sugg.year));
                }
                if (sugg.customer_id && !touched.current.cust
                    && !(preCustomerId || folderCustId)
                    && customers?.some(c => c.id === sugg.customer_id)) {
                    setCustId(sugg.customer_id);
                    const kName = customers.find(c => c.id === sugg.customer_id)?.company_name;
                    if (kName) applied.push(`Kunde «${kName}»`);
                }

                setKi({
                    status: "fertig",
                    info: res.hints?.customer || "",
                    applied,
                });
            } catch (e) {
                console.warn("[Paperboy] Texterkennung fehlgeschlagen:", e);
                if (!cancelled) setKi({ status: "fertig", info: "", applied: [] });
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileObj, allTags]);

    const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

    const handleUpload = async () => {
        if (!cat) { setCatError(true); return; }
        setCatError(false);
        setUploading(true);
        try {
            // Dateiname bereinigen (Umlaute → ae/oe/ue) fuer Storage-Kompatibilitaet
            const cleanFileName = (displayName || "file")
                .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/ß/g, "ss")
                .replace(/[^a-zA-Z0-9._-]/g, "_");
            const { data: uploadData, error: uploadError } = await supabase
                .storage.from(BUCKET)
                .copy(doc.storage_path, `${custId}/${Date.now()}-${cleanFileName}`, {
                    destinationBucket: 'dokumente'
                });

            if (uploadError) {
                throw uploadError;
            }
            // Text kommt aus der bereits gelaufenen Erkennung; falls die (noch)
            // nichts hat, direkt aus der geladenen Datei extrahieren.
            const contentText = contentTextRef.current
                || (fileObj ? await extractDocumentText(fileObj) : "");

            await entities.Dokument.create({
                customer_id: custId,
                category: cat,
                year: ye ? parseInt(ye) : null,
                name: name.trim(), filename: displayName,
                storage_path: uploadData.path,
                file_size: doc.metadata?.size ?? null,
                file_type: doc.metadata?.mimetype ?? null,
                tag_ids: tagIds, notes,
                content_text: contentText
            });

            await supabase.storage.from(BUCKET).remove([doc.storage_path]);

            toast.success("Dokument zugewiesen", {closeButton: true});
            onClose();
        } catch (err) {
            console.error("Upload error:", err);
            toast.error("Fehler: " + err.message);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 0, width: 1120, maxWidth: "96vw", height: "min(720px, 92vh)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {/* Kopf */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid " + border, flexShrink: 0 }}>
                    <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Dokument zuweisen · <span style={{ fontWeight: 400, color: s.textMuted }}>{displayName}</span>
                    </h3>
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, flexShrink: 0 }}><X size={18} /></button>
                </div>

                <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
                    {/* ── Vorschau links ── */}
                    <div style={{ flex: "1 1 520px", minWidth: 0, background: s.sidebarBg, borderRight: "1px solid " + border, overflow: "hidden" }}>
                        <PreviewPane file={fileObj} loadError={fileErr} s={s} border={border} />
                    </div>

                    {/* ── Formular rechts ── */}
                    <div style={{ flex: "0 0 400px", maxWidth: "100%", overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* KI-Status */}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "8px 10px", borderRadius: 8,
                            background: s.selBg || "rgba(122,155,127,0.12)", fontSize: 11.5, color: s.textMain, lineHeight: 1.45 }}>
                            <Sparkles size={14} style={{ color: accent, flexShrink: 0, marginTop: 1 }} />
                            {ki.status === "fertig" ? (
                                ki.applied.length
                                    ? <span><b>Automatisch erkannt:</b> {ki.applied.join(" · ")}{ki.info ? <span style={{ color: s.textMuted }}> — {ki.info}</span> : null}</span>
                                    : <span style={{ color: s.textMuted }}>Keine automatische Zuordnung erkannt — bitte manuell wählen.</span>
                            ) : (
                                <span style={{ color: s.textMuted }}>{ki.info || "Texterkennung läuft…"}</span>
                            )}
                        </div>

                        {/* Kunde */}
                        <div>
                            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kunde *</label>
                            <select value={custId} onChange={e => { touched.current.cust = true; setCustId(e.target.value); }} style={{ ...inp, cursor: "pointer" }}>
                                <option value="">-- Kunde waehlen --</option>
                                {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                            </select>
                        </div>
                        {/* Name */}
                        <div>
                            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Anzeigename *</label>
                            <input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="Dateiname (ohne Endung)" />
                        </div>
                        {/* Tags — zuerst, befüllen Kategorie auto */}
                        <div>
                            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags</label>
                            <TagSelectWidget
                                value={tagIds}
                                onChange={ids => { touched.current.tags = true; setTagIds(ids); }}
                                allTags={allTags}
                                s={s} border={border} accent={accent}
                                onCategoryChange={newCat => {
                                    touched.current.cat = true;
                                    setCategory(newCat);
                                    setCatError(false);
                                    setTimeout(() => { yearRef.current?.select(); yearRef.current?.focus(); }, 80);
                                }}
                            />
                        </div>
                        {/* Kategorie + Jahr */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div>
                                <label style={{ fontSize: 12, color: catError ? "#ef4444" : s.textMuted, display: "block", marginBottom: 3 }}>
                                    Kategorie * {catError && <span style={{ fontSize: 11 }}>– Pflichtfeld</span>}
                                </label>
                                <select
                                    value={cat}
                                    onChange={e => { touched.current.cat = true; setCategory(e.target.value); setCatError(false); }}
                                    style={{ ...inp, cursor: "pointer", borderColor: catError ? "#ef4444" : (s.inputBorder || border) }}
                                >
                                    <option value="">-- wählen --</option>
                                    {CATEGORIES.map(c => (
                                        <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr *</label>
                                <input
                                    ref={yearRef}
                                    type="number"
                                    value={ye}
                                    min="2000"
                                    max="2099"
                                    onChange={e => { touched.current.year = true; setYear(e.target.value); }}
                                    style={{ ...inp, borderColor: !ye ? "#ef4444" : (s.inputBorder || border) }}
                                    placeholder="z.B. 2025"
                                />
                            </div>
                        </div>
                        {/* Notiz */}
                        <div>
                            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz (optional)</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung..." />
                        </div>

                        <div style={{ flex: 1 }} />
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 6 }}>
                            <Button variant="outline" onClick={onClose} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
                            <Button onClick={handleUpload} disabled={uploading || !custId} style={{ background: accent, color: "#fff" }}>
                                {uploading ? "Zuweisung läuft..." : "zuweisen"}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
