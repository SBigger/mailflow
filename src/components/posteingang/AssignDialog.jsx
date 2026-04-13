import {createContext, useRef, useState} from "react";
import {X} from "lucide-react";
import {entities, supabase} from "../../api/supabaseClient.js";
import {toast} from "sonner";
import {useQuery} from "@tanstack/react-query";
import TagSelectWidget from "../dokumente/TagSelectWidget.jsx";
import {Button} from "../ui/button.jsx";
import * as pdfjsLib from "pdfjs-dist";
import { CATEGORIES } from "@/lib/categories";

export default function AssignDialog({ customers, preCustomerId, doc, onClose, onUpload, s, border, accent }) {
    const [custId,     setCustId]     = useState(preCustomerId || "");
    const [name,       setName]       = useState(doc.fileName.split('.')[0]);
    const [cat,   setCategory]   = useState(doc.category);
    const [ye,       setYear]       = useState(doc.year);
    const [tagIds,     setTagIds]     = useState([]);
    const [notes,      setNotes]      = useState("");
    const [uploading,  setUploading]  = useState(false);
    const [document, seDocument] = useState(doc);
    const fileRef = useRef();

    const BUCKET = 'posteingang';

    // CATEGORIES zentral importiert aus @/lib/categories

    const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

    const { data: allTags = [] } = useQuery({
        queryKey: ["dok_tags"],
        queryFn:  () => entities.DokTag.list("sort_order"),
    });

    async function extractDocumentText(file) {
        if (!file) return "";
        const name = file.name?.toLowerCase() || "";
        const type = file.type || "";

        try {
            // PDF → pdfjs-dist
            if (type === "application/pdf" || name.endsWith(".pdf")) {
                const buf = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
                let text = "";
                for (let i = 1; i <= Math.min(pdf.numPages, 100); i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    text += content.items.map(it => it.str).join(" ") + "\n";
                }
                return text.trim().slice(0, 100000);
            }

            // Excel (.xlsx, .xls, .csv) → xlsx library
            if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
                const { read, utils } = await import("xlsx");
                const buf = await file.arrayBuffer();
                const wb  = read(new Uint8Array(buf), { type: "array" });
                let text  = "";
                for (const sheetName of wb.SheetNames) {
                    const ws   = wb.Sheets[sheetName];
                    const rows = utils.sheet_to_json(ws, { header: 1, defval: "" });
                    text += rows.map(r => r.join(" ")).join("\n") + "\n";
                }
                return text.trim().slice(0, 100000);
            }

            // Word (.docx) → XML aus ZIP extrahieren
            if (name.endsWith(".docx")) {
                const { default: JSZip } = await import("jszip");
                const buf  = await file.arrayBuffer();
                const zip  = await JSZip.loadAsync(buf);
                const xml  = await zip.file("word/document.xml")?.async("text") || "";
                const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                return text.slice(0, 100000);
            }

            // Plaintext (.txt, .md, .csv ohne Extension-Match)
            if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
                const text = await file.text();
                return text.slice(0, 100000);
            }

            return "";
        } catch (e) {
            console.warn("Textextraktion fehlgeschlagen für", name, e);
            return "";
        }
    }

    const handleUpload = async () => {
        setUploading(true);
        try {
            // Dateiname bereinigen (Umlaute → ae/oe/ue) fuer Storage-Kompatibilitaet
            const cleanFileName = (doc.fileName || "file")
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
            await entities.Dokument.create({
                customer_id: custId,
                category: cat,
                year: parseInt(ye),
                name: name.trim(), filename: doc.name,
                storage_path: uploadData.path, file_size: doc.size, file_type: doc.type,
                tag_ids: tagIds, notes,
                content_text: await extractDocumentText(doc)
            });

            const { data , error} = await supabase.storage.from(BUCKET).remove([doc.storage_path])

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
            <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 28, width: 660, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>Dokument Kunde zuweisen</h3>
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Kunde */}
                    <div>
                        <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kunde *</label>
                        <select value={custId} onChange={e => setCustId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                            <option value="">-- Kunde waehlen --</option>
                            {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                        </select>
                    </div>
                    {/* Name */}
                    <div>
                        <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Anzeigename *</label>
                        <input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="Dateiname (ohne Endung)" />
                    </div>
                    {/* Kategorie + Jahr */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kategorie *</label>
                            <select
                                value={cat} // Use state 'cat', not prop 'category'
                                onChange={e => setCategory(e.target.value)}
                                style={{ ...inp, cursor: "pointer" }}
                            >
                                {CATEGORIES.map(c => (
                                    <option key={c.key} value={c.key}>
                                        {c.icon} {c.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr *</label>
                            <input
                                type="number"
                                value={ye} // Use state 'ye', not prop 'year'
                                min="2000"
                                max="2099"
                                onChange={e => setYear(e.target.value)}
                                style={{ ...inp, borderColor: !ye ? "#ef4444" : (s.inputBorder || border) }}
                                placeholder="z.B. 2025"
                            />
                        </div>
                    </div>
                    {/* Tags */}
                    <div>
                        <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags</label>
                        <TagSelectWidget value={tagIds} onChange={setTagIds} allTags={allTags} s={s} border={border} accent={accent} />
                    </div>
                    {/* Notiz */}
                    <div>
                        <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz (optional)</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung..." />
                    </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                    <Button variant="outline" onClick={onClose} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
                    <Button onClick={handleUpload} disabled={uploading || !custId} style={{ background: accent, color: "#fff" }}>
                        {uploading ? "Zuweisung läuft..." : "zuweisen"}
                    </Button>
                </div>
            </div>
        </div>
    );
}