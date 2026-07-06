import React, { useState, useMemo, useEffect, useRef, useContext } from "react";
import {
  Search,
  Upload,
  Download,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
  Pencil,
  Lock,
  LockOpen,
  ShieldAlert,
  RefreshCw,
  Link2,
  Copy,
  CopyPlus,
  CheckCheck,
  FolderOpen,
  Library,
  Eye,
  History as HistoryIcon,
  MessageSquare,
  Mail,
  Clock,
  MoreVertical
} from "lucide-react";
import VersionsDialog from "@/components/dokumente/VersionsDialog";
import DocHoverPreview from "@/components/dokumente/DocHoverPreview";
import ChartisPanel from "@/components/chartis/ChartisPanel";
import * as _pdfjsNs from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.js?url";
// pdfjs-dist 3.11 ist UMD → je nach Vite-Mode liegt getDocument direkt oder unter .default
const pdfjsLib = (_pdfjsNs && typeof _pdfjsNs.getDocument === "function") ? _pdfjsNs : (_pdfjsNs?.default || _pdfjsNs);
if (pdfjsLib?.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ─── Dokument-Textextraktion für Volltext-Suche ──────────────────────────────
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
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import TagSelectWidget from "@/components/dokumente/TagSelectWidget";
import BatchUploadDialog from "@/components/dokumente/BatchUploadDialog";
import { analyzeFile } from "@/lib/batchAiSuggest";
import { useAuth } from "@/lib/AuthContext";

const BUCKET   = "dokumente";

// GeBueV-Integritaet: SHA-256 einer Datei als Hex (best-effort, blockiert Upload nie).
async function sha256Hex(fileOrBlob) {
  try {
    const buf  = await fileOrBlob.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

// ─── SharePoint Helper ───────────────────────────────────────────────────────
const SPFILES = `${window.env.API_URL}/functions/v1/sharepoint-files`;

async function spCall(jwt, body) {
  const res = await fetch(SPFILES, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `SharePoint Fehler ${res.status}`); }
  return res.json();
}

async function spUpload(jwt, file, customer_id, category, year) {
  const form = new FormData();
  form.append('action', 'upload');
  form.append('file', file);
  form.append('customer_id', customer_id);
  form.append('category', category);
  form.append('year', String(year));
  form.append('filename', file.name);
  const res = await fetch(SPFILES, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload fehlgeschlagen'); }
  return res.json(); // { item_id, web_url, name, size }
}

const CUR_YEAR = new Date().getFullYear();

// Kategorien zentral in src/lib/categories.js definiert
import { CATEGORIES } from "@/lib/categories";
import HighlightedText from "@/components/dokumente/HighlightedText.tsx";

function getFileInfo(mimeType, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (mimeType === "application/pdf" || ext === "pdf")             return { label: "PDF", color: "#dc2626" };
  if (mimeType?.includes("spreadsheet") || ["xls","xlsx","csv"].includes(ext)) return { label: "XLS", color: "#16a34a" };
  if (mimeType?.includes("word") || ["doc","docx"].includes(ext)) return { label: "DOC", color: "#2563eb" };
  if (mimeType?.startsWith("image/"))                              return { label: "IMG", color: "#7c3aed" };
  if (["zip","rar","7z"].includes(ext))                           return { label: "ZIP", color: "#d97706" };
  return { label: ext.toUpperCase() || "FILE", color: "#71717a" };
}
function detectYear(filename) {
  const m = (filename || "").match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1]) : null;
}
function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

// ─── Share-Link Dialog ─────────────────────────────────────────────────────
const SHARE_FN = `${window.env.API_URL}/functions/v1/share-link`;

function ShareLinkDialog({ info, accent, s, border, onClose }) {
  const [expiry,   setExpiry]   = useState("30");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [link,     setLink]     = useState(null);
  const [copied,   setCopied]   = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  async function createLink() {
    setLoading(true);
    try {
      const insertData = { name: info.name };
      if (info.type === 'doc') insertData.doc_id      = info.doc_id;
      if (info.customer_id)    insertData.customer_id  = info.customer_id;
      if (info.category)       insertData.category     = info.category;
      if (info.year)           insertData.year         = info.year;
      if (password.trim())     insertData.password     = password.trim();
      if (expiry) {
        const exp = new Date();
        exp.setDate(exp.getDate() + parseInt(expiry));
        insertData.expires_at = exp.toISOString();
      }

      const { data, error } = await supabase
        .from("share_links")
        .insert(insertData)
        .select("token")
        .single();

      if (error) throw error;
      setLink(`${window.location.origin}/share/${data.token}`);
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  // Kopiert einen klickbaren Hyperlink: der Dateiname verlinkt auf die URL.
  // In die Zwischenablage kommen text/html (<a>) UND text/plain (URL) – so wird
  // beim Einfügen in Outlook/Word der Dateiname als Link angezeigt, in reinem
  // Text bleibt die URL.
  async function copyLink() {
    if (!link) return;
    const esc = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const label = info.name || "Dokument";
    const html = `<a href="${link}">${esc(label)}</a>`;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            "text/html":  new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([link], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(link);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
    }
  }

  async function copyUrl() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000); } catch { /* ignore */ }
  }

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const card    = { background: s.cardBg, border: "1px solid " + border, borderRadius: 14, padding: 28, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" };
  const inp     = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), borderRadius: 8, color: s.textMain, padding: "8px 12px", width: "100%", fontSize: 13, fontFamily: "inherit", outline: "none" };
  const lbl     = { display: "block", color: s.textMuted, fontSize: 11, marginBottom: 5, fontWeight: 700, letterSpacing: "0.05em" };
  const btn     = (primary) => ({ background: primary ? accent : "transparent", color: primary ? "#fff" : s.textMuted, border: primary ? "none" : "1px solid " + border, borderRadius: 8, padding: "9px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 });

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: accent + "18", border: "1px solid " + accent + "44", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Link2 size={16} style={{ color: accent }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: s.textMain, fontWeight: 700, fontSize: 15 }}>
              {info.type === 'folder' ? 'Ordner-Link erstellen' : 'Datei-Link erstellen'}
            </div>
            <div style={{ color: s.textMuted, fontSize: 12, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, fontSize: 16, padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        {!link ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {/* Ablaufdatum */}
              <div>
                <label style={lbl}>ABLAUFDATUM</label>
                <select value={expiry} onChange={e => setExpiry(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                  <option value="7">7 Tage</option>
                  <option value="30">30 Tage</option>
                  <option value="90">90 Tage</option>
                  <option value="365">1 Jahr</option>
                  <option value="">Permanent</option>
                </select>
              </div>
              {/* Passwort */}
              <div>
                <label style={lbl}>PASSWORT (optional)</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Kein Passwort"
                  style={inp}
                />
              </div>
            </div>

            {password.trim() && (
              <div style={{ background: accent + "12", border: "1px solid " + accent + "33", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: accent }}>
                🔒 Link wird mit Passwort geschützt
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btn(false)} onClick={onClose}>Abbrechen</button>
              <button style={btn(true)} onClick={createLink} disabled={loading}>
                {loading ? "Erstelle..." : <><Link2 size={14} /> Link erstellen</>}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: s.sidebarBg, border: "1px solid " + border, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ color: s.textMuted, fontSize: 10, marginBottom: 5, fontWeight: 700, letterSpacing: "0.05em" }}>LINK</div>
              <div style={{ color: accent, fontSize: 12, wordBreak: "break-all", lineHeight: 1.6 }}>{link}</div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button style={{ ...btn(true), flex: 1, justifyContent: "center" }} onClick={copyLink} title="Fügt den Dateinamen als klickbaren Link ein (z.B. in Outlook)">
                {copied ? <><CheckCheck size={14} /> Kopiert!</> : <><Copy size={14} /> Als Link kopieren</>}
              </button>
              <button style={btn(false)} onClick={copyUrl} title="Nur die reine URL kopieren">
                {copiedUrl ? <><CheckCheck size={14} /> Kopiert!</> : <><Copy size={14} /> Nur URL</>}
              </button>
              <button style={btn(false)} onClick={() => { setLink(null); setCopied(false); setCopiedUrl(false); setPassword(""); }}>Neu</button>
              <button style={btn(false)} onClick={onClose}>Schliessen</button>
            </div>
            <div style={{ color: s.textMuted, fontSize: 11, marginBottom: 10 }}>
              Beim Einfügen ins Mail (Outlook/Word) erscheint <strong style={{ color: s.textMain }}>„{info.name}"</strong> als klickbarer Link.
            </div>

            <div style={{ color: s.textMuted, fontSize: 11, textAlign: "center" }}>
              {expiry ? `Gültig für ${expiry} Tage` : "Permanenter Link"}
              {password.trim() ? " · 🔒 Passwortgeschützt" : ""}
              {" · "}{info.type === 'folder' ? 'Ordner-Inhalt' : 'Datei'} für alle mit dem Link
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Share-Links-Übersicht ─────────────────────────────────────────────────
function ShareLinksOverview({ accent, s, border, onClose }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("share_links").select("id, token, name, doc_id, customer_id, category, year, password, expires_at, is_active, download_count, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => { setLinks(data || []); setLoading(false); });
  }, []);

  async function toggleActive(link) {
    const newVal = !link.is_active;
    await supabase.from("share_links").update({ is_active: newVal }).eq("id", link.id);
    setLinks(prev => prev.map(l => l.id === link.id ? { ...l, is_active: newVal } : l));
  }

  async function deleteLink(link) {
    if (!confirm("Link endgültig löschen?")) return;
    await supabase.from("share_links").delete().eq("id", link.id);
    setLinks(prev => prev.filter(l => l.id !== link.id));
  }

  function isExpired(link) {
    return link.expires_at && new Date(link.expires_at) < new Date();
  }

  function formatDate(d) {
    if (!d) return "–";
    return new Date(d).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function statusBadge(link) {
    if (!link.is_active) return { label: "Deaktiviert", bg: "#450a0a", color: "#f87171" };
    if (isExpired(link)) return { label: "Abgelaufen", bg: "#451a03", color: "#fb923c" };
    return { label: "Aktiv", bg: "#052e16", color: "#4ade80" };
  }

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const card = { background: s.cardBg, border: "1px solid " + border, borderRadius: 14, padding: 28, width: "100%", maxWidth: 720, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <Link2 size={18} style={{ color: accent }} />
          <div style={{ flex: 1 }}>
            <div style={{ color: s.textMain, fontWeight: 700, fontSize: 15 }}>Geteilte Links</div>
            <div style={{ color: s.textMuted, fontSize: 12 }}>{links.length} Link{links.length !== 1 ? "s" : ""}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, fontSize: 16, padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", margin: "0 -8px", padding: "0 8px" }}>
          {loading && <div style={{ textAlign: "center", color: s.textMuted, padding: 40 }}>Lade...</div>}
          {!loading && links.length === 0 && <div style={{ textAlign: "center", color: s.textMuted, padding: 40 }}>Keine Links erstellt.</div>}

          {links.map(link => {
            const st = statusBadge(link);
            const url = `${window.location.origin}/share/${link.token}`;
            return (
              <div key={link.id} style={{ background: s.sidebarBg, border: "1px solid " + border, borderRadius: 10, padding: "12px 14px", marginBottom: 8, opacity: !link.is_active ? 0.5 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>{link.doc_id ? "\uD83D\uDCC4" : "\uD83D\uDCC2"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: s.textMain, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link.name}</div>
                  </div>
                  <span style={{ background: st.bg, color: st.color, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>{st.label}</span>
                  {link.password && <span title="Passwortgeschützt" style={{ fontSize: 12 }}>🔒</span>}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: s.textMuted, flexWrap: "wrap" }}>
                  <span>Erstellt: {formatDate(link.created_at)}</span>
                  <span>Ablauf: {link.expires_at ? formatDate(link.expires_at) : "Unbegrenzt"}</span>
                  <span>{link.download_count || 0}× heruntergeladen</span>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => { navigator.clipboard.writeText(url); toast.success("Link kopiert"); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 11, fontWeight: 600, padding: "2px 6px" }}>
                    Kopieren
                  </button>
                  <button onClick={() => toggleActive(link)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, fontSize: 11, padding: "2px 6px" }}>
                    {link.is_active ? "Deaktivieren" : "Aktivieren"}
                  </button>
                  <button onClick={() => deleteLink(link)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", fontSize: 11, padding: "2px 6px" }}>
                    Löschen
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Hex-Farbe → Farbton in Grad (0–360) für Rainbow-Sortierung */
function hexToHue(hex) {
  if (!hex || hex.length < 7) return 999;
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? (g-b)/d+(g<b?6:0) : max === g ? (b-r)/d+2 : (r-g)/d+4;
  return h * 60;
}

// ─── Tag-Filterung nach Kategorie ────────────────────────────────────────
// Nutzt das "category"-Feld auf Eltern-Tags (wird in den Einstellungen gesetzt)
function filterTagsByCategory(allTags, category) {
  if (!category) return allTags;
  // Eltern-Tags finden, die explizit dieser Kategorie zugeordnet sind
  const matchingParents = allTags.filter(t => !t.parent_id && t.category === category);
  if (matchingParents.length === 0) return allTags; // Fallback: alle Tags zeigen
  const parentIds = new Set(matchingParents.map(t => t.id));
  return allTags.filter(t => parentIds.has(t.id) || parentIds.has(t.parent_id));
}

// ─── Upload-Dialog ─────────────────────────────────────────────────────────
function UploadDialog({ customers, preCustomer, preFile, allTags, onCancel, onUpload, s, border, accent }) {
  const [file,       setFile]       = useState(null);
  const [custId,     setCustId]     = useState(preCustomer?.id || "");
  const [name,       setName]       = useState("");
  const [category,   setCategory]   = useState("");
  const [year,       setYear]       = useState(String(CUR_YEAR));
  const [tagIds,     setTagIds]     = useState([]);
  const [notes,      setNotes]      = useState("");
  const [uploading,  setUploading]  = useState(false);
  const [errors,     setErrors]     = useState({});
  const [aiBusy,     setAiBusy]     = useState(false);
  const [dup,        setDup]        = useState(null);   // bereits abgelegtes Dokument mit gleichem Hash
  const fileRef = useRef();
  const yearRef = useRef();

  // M-Files-Stil Duplikat-Check: SHA-256 der Datei gegen content_hash in der DB.
  // Byte-genauer Treffer = Datei wurde schon abgelegt. Sehr schnell (Hash lokal + Index-Query).
  const checkDuplicate = async (f) => {
    setDup(null);
    try {
      const h = await sha256Hex(f);
      if (!h) return;
      const { data } = await supabase.from("dokumente")
        .select("id,name,customer_id,created_at,year")
        .eq("content_hash", h).is("deleted_at", null).limit(1);
      if (data && data.length) setDup(data[0]);
    } catch { /* ignore */ }
  };

  // KI-Erfassung: Kunde / Kategorie / Jahr / Tags aus dem Dokument vorschlagen.
  // Nutzt dieselbe Logik wie die Massenablage – Artis Treuhand (= wir) wird dort
  // bereits via isSelfEntity NIE als Kunde erkannt. Fuellt nur leere Felder.
  const runAiSuggest = async (f) => {
    if (!f) return;
    setAiBusy(true);
    try {
      const res = await analyzeFile(f, { customers, allTags });
      const sug = res?.suggestions || {};
      if (sug.customer_id && !preCustomer) setCustId(prev => prev || sug.customer_id);
      if (sug.category)                    setCategory(prev => prev || sug.category);
      if (sug.year)                        setYear(prev => (prev && prev !== String(CUR_YEAR) ? prev : String(sug.year)));
      if (sug.tag_ids?.length)             setTagIds(prev => (prev.length ? prev : sug.tag_ids));
    } catch (e) {
      console.warn("[Upload] KI-Analyse fehlgeschlagen:", e);
    } finally {
      setAiBusy(false);
    }
  };

  // Per Drag & Drop übergebene Datei direkt einlesen
  useEffect(() => {
    if (preFile) pickFile(preFile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tags auf die gewählte Kategorie einschränken
  const filteredTags = useMemo(() => filterTagsByCategory(allTags, category), [allTags, category]);

  // Beim Kategoriewechsel: Tags entfernen, die nicht mehr zur Kategorie gehören
  useEffect(() => {
    const validIds = new Set(filteredTags.map(t => t.id));
    setTagIds(prev => prev.filter(id => validIds.has(id)));
  }, [filteredTags]);

  // Draggable state
  const [dragPos,    setDragPos]    = useState({ x: 0, y: 0 });
  const dragRef      = useRef({ dragging: false, startX: 0, startY: 0, posX: 0, posY: 0 });
  const dialogRef    = useRef();

  const onHeaderMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, posX: dragPos.x, posY: dragPos.y };
    const onMove = (ev) => {
      if (!dragRef.current.dragging) return;
      setDragPos({ x: dragRef.current.posX + ev.clientX - dragRef.current.startX, y: dragRef.current.posY + ev.clientY - dragRef.current.startY });
    };
    const onUp = () => {
      dragRef.current.dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  };

  const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

  const pickFile = (f) => {
    setFile(f);
    setName(f.name.replace(/\.[^.]+$/, ""));
    const y = detectYear(f.name);
    if (y) setYear(String(y));
    runAiSuggest(f);                 // KI erkennt Kunde/Kategorie/Tags im Hintergrund
    checkDuplicate(f);               // schneller Duplikat-Check (schon abgelegt?)
  };

  const handleUpload = async () => {
    const newErrors = {};
    if (!file || !custId || !name.trim()) { toast.error("Bitte Datei, Kunde und Name ausf\u00fcllen"); return; }
    if (!year || isNaN(parseInt(year)))   { toast.error("Bitte ein g\u00fcltiges Jahr eingeben"); return; }
    if (!category)                        { newErrors.category = "Bitte eine Kategorie ausw\u00e4hlen."; }
    if (!tagIds || tagIds.length === 0)   { newErrors.tags = "Bitte mindestens einen Tag ausw\u00e4hlen."; }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    setErrors({});
    setUploading(true);
    try {
      // Text extrahieren (PDF, Excel, Word, etc.) für Volltext-Suche
      const contentText = await extractDocumentText(file);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
      const path = `${custId}/${fileName}`;
      // File-Objekt mit sauberem Namen (ohne Umlaute) – Supabase Header-Kompatibilitaet
      const cleanFile = new File([file], fileName, { type: file.type });
      const { data: uploadData, error: uploadError } = await supabase
          .storage.from(BUCKET)
          .upload(path, cleanFile);

      if (uploadError) {
        throw uploadError;
      }
      const newDoc = await entities.Dokument.create({
        customer_id: custId, category, year: parseInt(year),
        name: name.trim(), filename: file.name,
        storage_path: uploadData.path, file_size: file.size, file_type: file.type,
        tag_ids: tagIds, notes,
        content_text: contentText,
        content_hash: await sha256Hex(cleanFile),
      });
      // Server-seitige Volltext-Indexierung als Sicherheitsnetz (no-op falls content_text bereits gefüllt)
      if (newDoc?.id) {
        supabase.functions.invoke("index-document", { body: { doc_id: newDoc.id } }).catch(() => {});
      }
      toast.success("Dokument hochgeladen", {closeButton: true});
      onUpload();
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Fehler: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div ref={dialogRef} style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 28, width: 660, minWidth: 500, minHeight: 400, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", resize: "both", transform: `translate(${dragPos.x}px, ${dragPos.y}px)` }}>
        <div onMouseDown={onHeaderMouseDown} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, cursor: "move", userSelect: "none" }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>Dokument hochladen</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Datei */}
          <div
            onClick={() => fileRef.current?.click()}
            tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
            style={{ border: "2px dashed " + (file ? accent : border), borderRadius: 8, padding: 14, textAlign: "center", cursor: "pointer", color: file ? accent : s.textMuted, fontSize: 13, outline: "none" }}>
            {file ? `${file.name} (${formatBytes(file.size)})` : "Datei auswaehlen oder hierher ziehen"}
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && pickFile(e.target.files[0])} />
          </div>
          {aiBusy && (
            <div style={{ fontSize: 12, color: accent, display: "flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> KI erkennt Kunde, Kategorie &amp; Tags…
            </div>
          )}
          {dup && (
            <div style={{ fontSize: 12, color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 10px", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>⚠️</span>
              <div>
                <strong>Diese Datei wurde schon abgelegt.</strong><br />
                „{dup.name}"
                {(() => { const c = customers.find(x => x.id === dup.customer_id); return c ? ` · ${c.company_name}` : ""; })()}
                {dup.year ? ` · ${dup.year}` : ""}
                {dup.created_at ? ` · ${new Date(dup.created_at).toLocaleDateString("de-CH")}` : ""}. Du kannst trotzdem ablegen.
              </div>
            </div>
          )}
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
          {/* Tags */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags *</label>
            <TagSelectWidget value={tagIds} onChange={(v) => { setTagIds(v); setErrors(prev => ({ ...prev, tags: undefined })); }} onCategoryChange={(cat) => { setCategory(cat); setTimeout(() => { yearRef.current?.select(); yearRef.current?.focus(); }, 80); }} allTags={filteredTags} s={s} border={errors.tags ? "#ef4444" : border} accent={accent} />
            {errors.tags && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{errors.tags}</div>}
          </div>
          {/* Kategorie + Jahr */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kategorie *</label>
              <select value={category} onChange={e => { setCategory(e.target.value); setErrors(prev => ({ ...prev, category: undefined })); }} style={{ ...inp, cursor: "pointer", borderColor: errors.category ? "#ef4444" : (s.inputBorder || border) }}>
                <option value="">-- Kategorie wählen --</option>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
              {errors.category && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{errors.category}</div>}
            </div>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr *</label>
              <input ref={yearRef} type="number" value={year} min="2000" max="2099" onChange={e => setYear(e.target.value)} style={{ ...inp, borderColor: !year ? "#ef4444" : (s.inputBorder || border) }} placeholder="z.B. 2025" />
            </div>
          </div>
          {/* Notiz */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung..." />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={handleUpload} disabled={uploading || !file || !custId || !year} style={{ background: accent, color: "#fff" }}>
            {uploading ? "Laedt hoch..." : "Hochladen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit-Dialog ───────────────────────────────────────────────────────────
function EditDialog({ doc, allTags, customers = [], onCancel, onSave, s, border, accent, mode = "edit" }) {
  // mode: "edit"  -> bestehendes Dokument updaten
  //       "copy"  -> neues Dokument mit gleichem storage_path anlegen
  const isCopy = mode === "copy";
  const [name,       setName]       = useState(isCopy ? ((doc.name || "") + " (Kopie)") : (doc.name || ""));
  const [text,       setText]       = useState("");           // Freitext fuer Auto-Filename
  const [customerId, setCustomerId] = useState(doc.customer_id || "");
  const [category,   setCategory]   = useState(doc.category || "steuern");
  const [year,       setYear]       = useState(String(doc.year || CUR_YEAR));
  const [tagIds,     setTagIds]     = useState(doc.tag_ids || []);
  const [notes,      setNotes]      = useState(doc.notes || "");
  const [saving,     setSaving]     = useState(false);

  // Tags auf die gewählte Kategorie einschränken
  const filteredTags = useMemo(() => filterTagsByCategory(allTags, category), [allTags, category]);

  // Beim Kategoriewechsel: Tags entfernen, die nicht mehr zur Kategorie gehören
  useEffect(() => {
    const validIds = new Set(filteredTags.map(t => t.id));
    setTagIds(prev => prev.filter(id => validIds.has(id)));
  }, [filteredTags]);

  // Vorschau-Name aus Tags + Text
  const suggestedName = useMemo(() => {
    const tagNames = (tagIds || [])
      .map(id => (allTags.find(t => t.id === id)?.name || "").trim())
      .filter(Boolean);
    const parts = [...tagNames];
    if (text.trim()) parts.push(text.trim());
    return parts.join(" - ");
  }, [tagIds, text, allTags]);

  // Live-Update: sobald Zusatztext getippt wird, Name automatisch synchronisieren
  // (User kann den Namen danach noch manuell ueberschreiben)
  useEffect(() => {
    if (text.trim() && suggestedName) {
      setName(suggestedName);
    }
  }, [text, tagIds, suggestedName]);

  const applyAutoName = () => {
    if (!suggestedName) { toast.error("Erst Tags auswaehlen oder Text eingeben"); return; }
    setName(suggestedName);
  };

  const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

  const handleSave = async () => {
    if (!name.trim() || !year || isNaN(parseInt(year))) { toast.error("Name und Jahr sind Pflicht"); return; }
    if (!customerId) { toast.error("Bitte einen Kunden auswählen"); return; }
    setSaving(true);
    try {
      if (isCopy) {
        // Echte Datei-Kopie: storage-Object physisch duplizieren
        let newStoragePath = doc.storage_path;
        if (doc.storage_path) {
          // Hinweis: viele DB-Zeilen haben "dokumente/" als Prefix im storage_path
          // gespeichert -- der EIGENTLICHE Pfad im Bucket ist ohne diesen Prefix.
          // Wir stripen drum fuer alle Storage-Calls, behalten den Prefix aber im
          // DB-Schreiben, damit's konsistent zu den bestehenden 633 Zeilen ist.
          const stripBucketPrefix = (p) => p.startsWith(BUCKET + "/") ? p.slice(BUCKET.length + 1) : p;
          const srcPath = stripBucketPrefix(doc.storage_path);

          // Neuen Storage-Pfad bilden: <srcPath>.copy-<ts>.<ext>
          const stamp = Date.now();
          const dot = srcPath.lastIndexOf(".");
          const newSrcPath = dot > srcPath.lastIndexOf("/")
            ? `${srcPath.slice(0, dot)}.copy-${stamp}${srcPath.slice(dot)}`
            : `${srcPath}.copy-${stamp}`;

          // Was wir in DB schreiben (mit gleichem Prefix-Schema wie das Original)
          newStoragePath = doc.storage_path.startsWith(BUCKET + "/")
            ? `${BUCKET}/${newSrcPath}`
            : newSrcPath;

          // 1) Versuch: native storage.copy()
          const { error: copyErr } = await supabase.storage
            .from(BUCKET)
            .copy(srcPath, newSrcPath);

          if (copyErr) {
            // 2) Fallback: Signed-URL -> Blob -> Re-Upload
            console.warn("storage.copy() fehlgeschlagen, Fallback via download+upload:", copyErr.message);
            const { data: urlData, error: urlErr } = await supabase.storage
              .from(BUCKET)
              .createSignedUrl(srcPath, 60);
            if (urlErr || !urlData?.signedUrl) {
              throw new Error("Originaldatei nicht zugreifbar: " + (urlErr?.message || "keine URL"));
            }
            const blobRes = await fetch(urlData.signedUrl);
            if (!blobRes.ok) throw new Error("Download fehlgeschlagen: HTTP " + blobRes.status);
            const blob = await blobRes.blob();
            const { error: upErr } = await supabase.storage
              .from(BUCKET)
              .upload(newSrcPath, blob, {
                contentType: doc.file_type || blob.type || "application/octet-stream",
                upsert: false,
              });
            if (upErr) throw new Error("Re-Upload fehlgeschlagen: " + upErr.message);
          }
        }
        await entities.Dokument.create({
          customer_id: customerId,
          name: name.trim(),
          category,
          year: parseInt(year),
          tag_ids: tagIds,
          notes,
          filename: doc.filename,
          storage_path: newStoragePath,     // <-- neuer Pfad
          file_size: doc.file_size,
          file_type: doc.file_type,
          sharepoint_web_url: doc.sharepoint_web_url || null,
        });
        toast.success("Kopie angelegt (Datei physisch dupliziert)", {closeButton: true});
      } else {
        await entities.Dokument.update(doc.id, { customer_id: customerId, name: name.trim(), category, year: parseInt(year), tag_ids: tagIds, notes });
        toast.success("Gespeichert", {closeButton: true});
      }
      onSave();
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 28, width: 660, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>
            {isCopy ? "Dokument kopieren" : "Dokument bearbeiten"}
            {isCopy && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: s.textMuted, background: s.sidebarBg, padding: "2px 7px", borderRadius: 6 }}>Datei wird physisch dupliziert</span>}
          </h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Datei</label>
            <div style={{ fontSize: 12, color: s.textMuted, padding: "5px 8px", background: s.sidebarBg, borderRadius: 6, border: "1px solid " + border }}>{doc.filename}</div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Unternehmen *</label>
            <select value={customerId} onChange={e => setCustomerId(e.target.value)}
              style={{ ...inp, cursor: "pointer", borderColor: !customerId ? "#ef4444" : (s.inputBorder || border) }}>
              <option value="">-- Kunde wählen --</option>
              {customers.slice().sort((a,b) => (a.company_name||"").localeCompare(b.company_name||"")).map(cx =>
                <option key={cx.id} value={cx.id}>{cx.company_name}</option>
              )}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Anzeigename *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} />
            <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "stretch" }}>
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Zusatztext fuer Auto-Name (optional)"
                style={{ ...inp, flex: 1, fontSize: 12 }}
              />
              <button
                type="button"
                onClick={applyAutoName}
                disabled={!suggestedName}
                title="Name aus ausgewaehlten Tags und Zusatztext bilden"
                style={{
                  background: suggestedName ? accent : s.sidebarBg,
                  color: suggestedName ? "#fff" : s.textMuted,
                  border: "1px solid " + (suggestedName ? accent : border),
                  borderRadius: 6,
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: suggestedName ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                }}
              >
                🪄 Aus Tags + Text
              </button>
            </div>
            {suggestedName && suggestedName !== name && (
              <div style={{ fontSize: 11, color: s.textMuted, marginTop: 4, fontStyle: "italic" }}>
                Vorschlag: <span style={{ color: s.textMain }}>{suggestedName}</span>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kategorie</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr *</label>
              <input type="number" value={year} min="2000" max="2099" onChange={e => setYear(e.target.value)} style={{ ...inp, borderColor: !year ? "#ef4444" : (s.inputBorder || border) }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags</label>
            <TagSelectWidget value={tagIds} onChange={setTagIds} allTags={filteredTags} s={s} border={border} accent={accent} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung..." />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving} style={{ background: accent, color: "#fff" }}>
            {saving ? "Speichert..." : (isCopy ? "Kopie anlegen" : "Speichern")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Hauptseite ────────────────────────────────────────────────────────────
export default function Dokumente() {
  const { theme } = useContext(ThemeContext);
  const { user }  = useAuth();
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = {
    cardBg:    isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a",
    border:    isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "#3f3f46",
    textMain:  isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7",
    textMuted: isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a",
    inputBg:   isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.8)",
    inputBorder: isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#3f3f46",
    sidebarBg: isArtis ? "#f5f8f5" : isLight ? "#f5f5fc" : "#1f1f23",
    selBg:     isArtis ? "rgba(122,155,127,0.18)" : isLight ? "rgba(99,102,241,0.13)" : "rgba(99,102,241,0.18)",
    rowHover:  isArtis ? "rgba(122,155,127,0.07)" : isLight ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.03)",
  };
  const border = s.border;
  const accent = isArtis ? "#4a7a4f" : "#7c3aed";
  const queryClient = useQueryClient();

  const [selCustomerId, setSelCustomerId] = useState(null);
  const [selCat,        setSelCat]        = useState(null);
  const [selYear,       setSelYear]       = useState(null);
  const [expandedC,     setExpandedC]     = useState({});
  const [expandedCat,   setExpandedCat]   = useState({});
  const [custSearch,    setCustSearch]    = useState("");
  const [typeaheadBuf,  setTypeaheadBuf]  = useState("");  // Tastatur-Schnellsuche
  const [fileSearch,    setFileSearch]    = useState("");
  const [ftSearch,    setFtSearch]    = useState("");
  const [ftResults,   setFtResults]   = useState(null);
  const [ftSearching, setFtSearching] = useState(false);
  const [syncData, setSyncData ] = useState(false);
  const [highlightDocId, setHighlightDocId] = useState(null);
  const [shareDialog,   setShareDialog]   = useState(null); // { type: 'doc'|'folder', doc?, customer_id?, category?, year?, name? }
  const [showShareLinks, setShowShareLinks] = useState(false);
  const [chartisDoc, setChartisDoc] = useState(null); // Chartis-Panel pro Dokument
  const [highestScore, setHighestScore] = useState(false);
  const [menuDocId, setMenuDocId] = useState(null);

  // Volltext-Suche via Supabase RPC (PostgreSQL GIN-Index)
  useEffect(() => {
    const q = ftSearch.trim();
    if (q.length < 2) { setFtResults(null); return; }
    const timer = setTimeout(async () => {
      setFtSearching(true);
      try {
        const { data, error } = await supabase.rpc("search_dokumente", {
          p_query:       q,
          p_customer_id: selCustomerId || null,
          p_limit:       50,
        });

        setHighestScore(data[0]?.rank || 1);

        if (error) throw error;
        setFtResults(data || []);
      } catch (e) { toast.error("Suche fehlgeschlagen: " + e.message); setFtResults([]); }
      finally { setFtSearching(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [ftSearch, selCustomerId]);

  const [showUpload,    setShowUpload]    = useState(false);
  const [showBatch,     setShowBatch]     = useState(false);
  const [dropFile,      setDropFile]      = useState(null);
  const [inboxPath,     setInboxPath]     = useState(null);  // Transfer-Objekt vom Smartis Agent (PDF-Capture)
  const [dragOver,      setDragOver]      = useState(false);
  const [dropTargetId,  setDropTargetId]  = useState(null);  // Dokument-Zeile, auf die gerade eine Datei gezogen wird
  const [replacingId,   setReplacingId]   = useState(null);  // Dokument, das gerade als neue Version ersetzt wird

  // Excel Add-in Integration: Tauri-Desktop injiziert window.__SMARTIS_EXCEL_UPLOAD__
  useEffect(() => {
    const check = setInterval(() => {
      const pending = window.__SMARTIS_EXCEL_UPLOAD__;
      if (!pending) return;
      window.__SMARTIS_EXCEL_UPLOAD__ = null;
      try {
        const binary = atob(pending.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], pending.filename);
        setDropFile(file);
        setShowUpload(true);
      } catch (e) { console.error("Excel-Upload Fehler:", e); }
    }, 500);
    return () => clearInterval(check);
  }, []);

  // Smartis Agent (PDF-Capture): ?inbox=<storage-key>&filename=<name>
  // Der Agent lädt das aktive PDF in den Transfer-Bereich (_inbox/) und öffnet
  // diese Seite. Hier laden wir die Datei und öffnen den normalen Hochladen-Dialog.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inbox  = params.get("inbox");
    if (!inbox) return;
    const fname = params.get("filename") || "dokument.pdf";
    window.history.replaceState({}, "", "/Dokumente");
    (async () => {
      try {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(inbox, 600);
        if (error || !data?.signedUrl) throw error || new Error("Transfer-Datei nicht gefunden");
        const resp = await fetch(data.signedUrl);
        if (!resp.ok) throw new Error("Download fehlgeschlagen (HTTP " + resp.status + ")");
        const blob = await resp.blob();
        const file = new File([blob], fname, { type: blob.type || "application/pdf" });
        setDropFile(file);
        setInboxPath(inbox);
        setShowUpload(true);
      } catch (e) {
        console.error("PDF-Transfer (inbox) Fehler:", e);
        toast.error("PDF-Übergabe fehlgeschlagen: " + (e?.message || e));
      }
    })();
  }, []);
  const [sortBy,        setSortBy]        = useState("-created_at"); // "-created_at" | "name" | "year"
  const [viewMode,      setViewMode]      = useState("normal");      // "normal" | "abschluss"
  const [openFolders,   setOpenFolders]   = useState(new Set());
  const [showSortMenu,  setShowSortMenu]  = useState(false);
  const [editDoc,        setEditDoc]        = useState(null);
  const [copyDoc,        setCopyDoc]        = useState(null);
  const [versionsDoc,    setVersionsDoc]    = useState(null);
  const [checkinDoc,     setCheckinDoc]     = useState(null);  // wird nicht mehr benoetigt, bleibt fuer Compat
  const [signedUrls,    setSignedUrls]    = useState({});
  const [hoverPreview,  setHoverPreview]  = useState(null);   // { doc, url, rect } – Hover-Vorschau-Popup
  const hoverTimer = useRef(null);
  const [pageTab,       setPageTab]       = useState('alle');
  const [deletingIds,   setDeletingIds]   = useState(new Set());
  const [clickedBtns,   setClickedBtns]   = useState({});

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn:  () => entities.Customer.list("company_name"),
  });

  useEffect(() => {
    // 1. Create the subscription
    const channel = supabase
        .channel('schema-dokumente-changes')
        .on(
            'postgres_changes',
            {
              event: '*', // Listen to INSERT, UPDATE, and DELETE
              schema: 'public',
              table: 'dokumente',
            },
            (payload) => {
              //console.log('Change received!', payload)
              const { eventType, new: newItem, old: oldItem } = payload;

              queryClient.setQueryData(["dokumente-all"], (oldData) => {
                // Ensure we have a list to work with
                const currentDocuments = oldData || [];

                switch (eventType) {
                  case 'INSERT':
                    // Add new mail to the top (since you sort by received desc)
                    return [newItem, ...currentDocuments];

                  case 'UPDATE':
                    // Find the item and update its fields
                    return currentDocuments.map((item) =>
                        item.id === newItem.id ? { ...item, ...newItem } : item
                    );

                  case 'DELETE':
                    // Remove the item from the list
                    return currentDocuments.filter((item) => item.id !== oldItem.id);

                  default:
                    return currentDocuments;
                }
              });

              // Also update Kanban columns if the status/folder changed
              if (eventType === 'UPDATE' && newItem.status !== oldItem.status) {
                queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
              }
            }
        )
        .subscribe((status, err) => {
          // console.log("Realtime Status Dokumente:", status);
          if (err) console.error("Realtime Error:", err);

          if (status === 'SUBSCRIBED') {
            console.log('Successfully connected to Realtime Dokumente!');
          }
          if (status === 'CLOSED') {
            // console.log('Connection closed.');
          }
          if (status === 'CHANNEL_ERROR') {
            // console.error('Error connecting. Check RLS policies or database settings.');
          }
        });

    // 3. Cleanup on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Schlanker Select (OHNE content_text + search_vector) -- spart ~14 MB / ~7 Sek
  // bei jedem Aufruf. content_text wird in der Liste nirgends gelesen, nur das
  // Auto-Indexing braucht die Info ob es leer ist -- das macht eine separate
  // kleine Query weiter unten.
  const DOK_LIST_FIELDS = 'id,customer_id,category,year,name,filename,storage_path,file_size,file_type,notes,created_by,created_at,updated_at,tag_ids,checked_out_by,checked_out_by_name,checked_out_at,sharepoint_item_id,sharepoint_web_url';
  const { data: allDoks = [], isLoading } = useQuery({
    queryKey: ["dokumente-all"],
    queryFn:  async () => {
      // Paginiert laden: PostgREST kappt server-seitig bei db-max-rows (typ. 1000).
      // Wir holen 1000er-Pakete bis nichts mehr kommt (Sicherheits-Cap: 500'000).
      const PAGE = 100000;
      const HARD_CAP = 500000;
      const all = [];
      for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
        const { data, error } = await supabase
          .from('dokumente')
          .select(DOK_LIST_FIELDS)
          .is('deleted_at', null)              // GeBueV: soft-geloeschte ausblenden
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      return all;
    },
  });
  const { data: allTags = [] } = useQuery({
    queryKey: ["dok_tags"],
    queryFn:  () => entities.DokTag.list("sort_order"),
  });

  const hashBackfillRef = useRef(false);
  useEffect(() => {
    // Standardmaessig AUS: der Backfill laedt jede Datei einmal herunter (Egress)
    // und kann auf Free-Tier das Kontingent sprengen. Nur laufen, wenn bewusst
    // aktiviert: im DevTools `window.__SMARTIS_HASH_BACKFILL = true` setzen.
    if (!window.__SMARTIS_HASH_BACKFILL) return;
    if (hashBackfillRef.current) return;
    if (!allDoks.length) return;
    hashBackfillRef.current = true;
    (async () => {
      const { data: toHash } = await supabase
          .from('dokumente')
          .select('id,storage_path')
          .is('content_hash', null)
          .not('storage_path', 'is', null)
          .is('deleted_at', null)
          .limit(5000);
      if (!toHash || !toHash.length) return;
      let done = 0;
      for (const d of toHash) {
        try {
          const sp = d.storage_path.replace(/^dokumente\//, '');
          const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(sp, 120);
          if (!urlData?.signedUrl) continue;
          const resp = await fetch(urlData.signedUrl);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const h = await sha256Hex(blob);
          if (h) { await entities.Dokument.update(d.id, { content_hash: h }); done++; }
        } catch { /* einzelne Datei überspringen */ }
      }
      if (done > 0) console.info(`[HashBackfill] ${done} Hashes nachgetragen`);
    })();
  }, [allDoks]);

  // Von aktuellem User ausgecheckte Dokumente
  const myCheckedOutDocs = useMemo(() =>
    allDoks.filter(d => d.checked_out_by && d.checked_out_by === user?.id),
    [allDoks, user]
  );

  // Zuletzt verwendete/gespeicherte Dokumente: nach jüngstem Datum (updated_at, sonst
  // created_at) absteigend, Top 60 — über alle Kunden (unabhängig von Sidebar-Auswahl).
  const recentDocs = useMemo(() => {
    const ts = (d) => new Date(d.updated_at || d.created_at || 0).getTime();
    return [...allDoks].sort((a, b) => ts(b) - ts(a)).slice(0, 60);
  }, [allDoks]);

  // ── Tastatur-Typeahead: tippen ohne ins Suchfeld zu klicken ──────────────
  // Du klickst irgendwo in die Dateiverwaltung und tippst "martin" -- die
  // Sidebar springt zum ersten Kunden, dessen Name das enthält.
  // ESC leert den Buffer, 1.5s Inaktivität auch. Tippen im Input wird ignoriert.
  useEffect(() => {
    if (pageTab !== 'alle' || ftResults) return;
    let timer = null;
    const onKey = (e) => {
      // ignoriere wenn fokussiert in Input/Textarea/contenteditable
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { setTypeaheadBuf(""); return; }
      if (e.key === 'Backspace') { setTypeaheadBuf(b => b.slice(0, -1)); e.preventDefault(); return; }
      // nur Buchstaben/Zahlen/Umlaute/Bindestrich/Leerzeichen
      if (e.key.length !== 1) return;
      if (!/[a-zA-Z0-9äöüÄÖÜß\- ]/.test(e.key)) return;
      setTypeaheadBuf(b => b + e.key);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    if (typeaheadBuf) {
      // Buffer nach 1.5s leeren
      timer = setTimeout(() => setTypeaheadBuf(""), 1500);
    }
    return () => { window.removeEventListener('keydown', onKey); if (timer) clearTimeout(timer); };
  }, [pageTab, ftResults, typeaheadBuf]);

  // Buffer → custSearch synchronisieren und ersten Treffer auswählen
  useEffect(() => {
    if (!typeaheadBuf) return;
    setCustSearch(typeaheadBuf);
    const q = typeaheadBuf.toLowerCase();
    const hit = customers.find(c =>
      (c.company_name || '').toLowerCase().includes(q) &&
      allDoks.some(d => d.customer_id === c.id)
    );
    if (hit) {
      setSelCustomerId(hit.id);
      // sanft in den Viewport scrollen
      setTimeout(() => {
        const el = document.querySelector(`[data-cust-id="${hit.id}"]`);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 50);
    }
  }, [typeaheadBuf]);

  // Tag-Resolver
  const getTag   = (id) => allTags.find(t => t.id === id);
  const tagLabel = (id) => { const t = getTag(id); if (!t) return null; const p = t.parent_id ? getTag(t.parent_id) : null; return p ? `${p.name} / ${t.name}` : t.name; };
  const tagColor = (id) => { const t = getTag(id); if (!t) return accent; return (t.parent_id ? getTag(t.parent_id)?.color : null) || t.color || accent; };

  // Dokumente in EINEM Durchgang nach Kunde gruppieren – O(Docs) statt O(Kunden×Docs).
  // Ohne das rechnet der Kundenbaum bei jedem Realtime-Update ~1 Sek. synchron neu
  // (sichtbares Einfrieren / kurz schwarzer Bildschirm), obwohl ein Check-in/-out die
  // Kundenzählung gar nicht ändert.
  const docsByCustomer = useMemo(() => {
    const m = new Map();
    for (const d of allDoks) {
      let arr = m.get(d.customer_id);
      if (!arr) { arr = []; m.set(d.customer_id, arr); }
      arr.push(d);
    }
    return m;
  }, [allDoks]);

  // Baum
  const tree = useMemo(() => {
    const q = custSearch.toLowerCase();
    return customers.filter(c => {
      const has    = docsByCustomer.has(c.id);
      const match  = !q || c.company_name.toLowerCase().includes(q);
      return has && match;
    }).map(c => {
      const docs = docsByCustomer.get(c.id) || [];
      const cats = CATEGORIES.map(cat => {
        const cd = docs.filter(d => d.category === cat.key);
        if (!cd.length) return null;
        const years  = [...new Set(cd.map(d => d.year).filter(Boolean))].sort((a, b) => b - a);
        const noYear = cd.filter(d => !d.year).length;
        return { ...cat, count: cd.length, years, noYear };
      }).filter(Boolean);
      return { ...c, docCount: docs.length, cats };
    });
  }, [customers, docsByCustomer, custSearch]);

  // Rechts: gefilterte Docs
  const selCustomer = customers.find(c => c.id === selCustomerId) || null;
  const filtered = useMemo(() => {
    if (!selCustomerId) return [];
    let list = allDoks.filter(d => d.customer_id === selCustomerId);
    if (selCat)              list = list.filter(d => d.category === selCat);
    if (selYear === "__none__") list = list.filter(d => !d.year);
    else if (selYear !== null)  list = list.filter(d => d.year === selYear);
    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      list = list.filter(d => d.name.toLowerCase().includes(q));
    }
    list = list.filter(d => !deletingIds.has(d.id));
    if (sortBy === "name")        list = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));
    else if (sortBy === "year")   list = [...list].sort((a, b) => (b.year || 0) - (a.year || 0));
    else                          list = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list;
  }, [allDoks, selCustomerId, selCat, selYear, fileSearch, deletingIds, sortBy]);

  // ── Abschluss-View: Dokumente nach Tag-Hierarchie gruppiert ──────────────
  const abschlussTree = useMemo(() => {
    if (viewMode !== "abschluss" || !filtered.length) return [];
    // parentId → { tag, children: Map(childId → { tag, docs[] }) }
    const parentMap = new Map();
    filtered.forEach(doc => {
      const ids = doc.tag_ids || [];
      if (!ids.length) {
        // Ohne Tag: in Sondergruppe "__none__"
        if (!parentMap.has("__none__")) parentMap.set("__none__", { tag: { id: "__none__", name: "Ohne Tag", sort_order: 9999 }, children: new Map() });
        const pm = parentMap.get("__none__");
        if (!pm.children.has("__direct__")) pm.children.set("__direct__", { tag: { id: "__direct__", name: "Allgemein", sort_order: 0 }, docs: [] });
        pm.children.get("__direct__").docs.push(doc);
        return;
      }
      ids.forEach(tagId => {
        const tag = allTags.find(t => t.id === tagId);
        if (!tag) return;
        if (tag.parent_id) {
          const parent = allTags.find(t => t.id === tag.parent_id);
          if (!parent) return;
          if (!parentMap.has(parent.id)) parentMap.set(parent.id, { tag: parent, children: new Map() });
          const pm = parentMap.get(parent.id);
          if (!pm.children.has(tag.id)) pm.children.set(tag.id, { tag, docs: [] });
          if (!pm.children.get(tag.id).docs.find(d => d.id === doc.id))
            pm.children.get(tag.id).docs.push(doc);
        } else {
          // Top-level Tag ohne Parent → direkt rein
          if (!parentMap.has(tag.id)) parentMap.set(tag.id, { tag, children: new Map() });
          const pm = parentMap.get(tag.id);
          if (!pm.children.has("__direct__")) pm.children.set("__direct__", { tag: { id: "__direct__", name: "Direkt", sort_order: -1 }, docs: [] });
          if (!pm.children.get("__direct__").docs.find(d => d.id === doc.id))
            pm.children.get("__direct__").docs.push(doc);
        }
      });
    });
    return [...parentMap.values()].sort((a, b) => hexToHue(a.tag.color) - hexToHue(b.tag.color));
  }, [filtered, allTags, viewMode]);

  const breadcrumb = useMemo(() => {
    if (!selCustomer) return "Alle Dokumente";
    const parts = [selCustomer.company_name];
    if (selCat) { const c = CATEGORIES.find(x => x.key === selCat); if (c) parts.push(c.icon + " " + c.label); }
    if (selYear) parts.push(selYear === "__none__" ? "Kein Jahr" : String(selYear));
    return parts.join(" \u203a ");
  }, [selCustomer, selCat, selYear]);

  // Signed URLs nur fuer Legacy-Dokumente (ohne SharePoint)
  useEffect(() => {
    const legacy = filtered.filter(d => !d.sharepoint_web_url && d.storage_path && !signedUrls[d.id]);
    if (!legacy.length) return;

    legacy.forEach(async doc => {
      const storagePath = doc.storage_path.replace('dokumente/', '');
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
      if (error) {
        console.warn("Signed URL nicht verfügbar:", doc.storage_path, error.message);
        return;
      }
      if (data?.signedUrl) setSignedUrls(prev => ({ ...prev, [doc.id]: data.signedUrl }));
    });
  }, [filtered]);

  // ── Ordner-Download als ZIP ──
  const downloadFolder = async (customerId, category, year) => {
    let docs = allDoks.filter(d => d.customer_id === customerId && d.storage_path);
    if (category) docs = docs.filter(d => d.category === category);
    if (year === "__none__") docs = docs.filter(d => !d.year);
    else if (year) docs = docs.filter(d => d.year === year);

    if (docs.length === 0) { toast.error("Keine Dateien zum Herunterladen"); return; }

    const customerName = (customers.find(c => c.id === customerId)?.company_name || "Kunde").replace(/[<>:"/\\|?*]/g, "_");
    const catLabel = category ? (CATEGORIES.find(c => c.key === category)?.label || category).replace(/[<>:"/\\|?*]/g, "_") : null;
    toast.info(`${docs.length} Dateien werden als ZIP vorbereitet...`);

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const root = zip.folder(customerName);

      let done = 0;
      for (const doc of docs) {
        try {
          let url = signedUrls[doc.id] || doc.sharepoint_web_url;
          if (!url) {
            const sp = doc.storage_path.replace('dokumente/', '');
            const { data } = await supabase.storage.from(BUCKET).createSignedUrl(sp, 600);
            url = data?.signedUrl;
          }
          if (!url) continue;

          // Pfad: Kategorie / Jahr / Datei
          let folder = root;
          if (!category) {
            const cat = CATEGORIES.find(c => c.key === doc.category);
            folder = folder.folder((cat ? cat.label : (doc.category || "Sonstige")).replace(/[<>:"/\\|?*]/g, "_"));
          } else {
            folder = root.folder(catLabel);
          }
          if (doc.year) folder = folder.folder(String(doc.year));

          const resp = await fetch(url);
          const blob = await resp.blob();
          folder.file((doc.filename || doc.name || "datei").replace(/[<>:"/\\|?*]/g, "_"), blob);
          done++;
        } catch (e) {
          console.warn("ZIP: Datei fehlgeschlagen:", doc.name, e);
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `${customerName}${catLabel ? " - " + catLabel : ""}${year && year !== "__none__" ? " - " + year : ""}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${done} Dateien als ZIP heruntergeladen`);
    } catch (e) {
      toast.error("Download fehlgeschlagen: " + e.message);
    }
  };

  // ── Abschluss-Ansicht als ZIP exportieren (Ordner = Tag-Hierarchie) ──
  const exportAbschlussZip = async () => {
    if (!selCustomer) { toast.error("Bitte zuerst einen Kunden wählen"); return; }
    if (!abschlussTree.length) { toast.error("Keine Abschluss-Dokumente"); return; }
    const safe = (str) => ((str || "").replace(/[<>:"/\\|?*]/g, "_").trim() || "Ordner");
    let total = 0;
    abschlussTree.forEach(p => p.children.forEach(ch => { total += ch.docs.length; }));
    if (!total) { toast.error("Keine Dateien zum Exportieren"); return; }
    const customerName = safe(selCustomer.company_name || "Kunde");
    const yearLabel = (selYear && selYear !== "__none__") ? " " + selYear : "";
    toast.info(`${total} Abschluss-Dateien werden als ZIP vorbereitet...`);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const root = zip.folder(`${customerName} - Abschluss${yearLabel}`);
      let done = 0;
      for (const parent of abschlussTree) {
        const pFolder = root.folder(safe(parent.tag?.name));
        for (const [, child] of parent.children) {
          const isDirect = child.tag?.id === "__direct__";
          const cFolder = isDirect ? pFolder : pFolder.folder(safe(child.tag?.name));
          for (const doc of child.docs) {
            if (!doc.storage_path) continue;
            try {
              let url = signedUrls[doc.id];
              if (!url) {
                const sp = doc.storage_path.replace('dokumente/', '');
                const { data } = await supabase.storage.from(BUCKET).createSignedUrl(sp, 600);
                url = data?.signedUrl;
              }
              if (!url) continue;
              const resp = await fetch(url);
              const blob = await resp.blob();
              cFolder.file(safe(doc.filename || doc.name || "datei"), blob);
              done++;
            } catch (e) { console.warn("ZIP Abschluss:", doc.name, e); }
          }
        }
      }
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `${customerName} - Abschluss${yearLabel}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${done} Dateien als ZIP exportiert`);
    } catch (e) {
      toast.error("Export fehlgeschlagen: " + e.message);
    }
  };

  const downloadDoc = async (doc) => {
    if (!doc) return;
    try {
      // 1) SharePoint-Pfad bevorzugen
      if (doc.sharepoint_web_url) {
        window.open(doc.sharepoint_web_url, '_blank');
        return;
      }
      if (!doc.storage_path) {
        toast.error('Keine Datei verfuegbar fuer ' + (doc.filename || doc.name || 'dieses Dokument'));
        return;
      }

      // 2) Hueschen Dateinamen bilden: Anzeigename + Original-Extension
      //    Sonderzeichen sanitiert fuer Windows/macOS-Kompatibilitaet
      const origExt = (doc.filename || "").includes(".")
        ? doc.filename.slice(doc.filename.lastIndexOf("."))
        : "";
      const sanitizedName = (doc.name || "download")
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim() || "download";
      const prettyFilename = sanitizedName.endsWith(origExt)
        ? sanitizedName
        : sanitizedName + origExt;

      // 3) storage_path normalisieren (DB hat oft 'dokumente/' Prefix, Storage nicht)
      const srcPath = doc.storage_path.startsWith(BUCKET + "/")
        ? doc.storage_path.slice(BUCKET.length + 1)
        : doc.storage_path;

      // 4) Signed URL mit download-Hint -> Content-Disposition: attachment; filename=<prettyFilename>
      const { data, error } = await supabase
        .storage
        .from(BUCKET)
        .createSignedUrl(srcPath, 360, { download: prettyFilename });

      if (error || !data?.signedUrl) {
        toast.error('Download-URL fehlgeschlagen: ' + (error?.message || 'unbekannt'));
        return;
      }

      // 5) Anchor-Klick fuer echten Download (umgeht Popup-Blocker)
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = prettyFilename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error('Download fehlgeschlagen', e);
      toast.error('Download fehlgeschlagen: ' + e.message);
    }
  }

  // ── URL-Parameter ?open=<doc_id> → Dokument direkt öffnen (von VoxDrop / Smartis) ──
  useEffect(() => {
    if (isLoading || !allDoks.length) return;
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('open');
    if (!openId) return;
    const doc = allDoks.find(d => d.id === openId);
    if (!doc) return;
    // Kunden-Filter setzen und Dokument öffnen
    setSelCustomerId(doc.customer_id);
    setHighlightDocId(doc.id);
    downloadDoc(doc);
    // URL bereinigen
    window.history.replaceState({}, '', '/Dokumente');
  }, [allDoks, isLoading]);

  // ?open=<doc_id> URL parameter support
  useEffect(() => {
    if (isLoading || !allDoks.length) return;
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("open");
    if (!openId) return;
    const doc = allDoks.find(d => d.id === openId);
    if (!doc) return;
    setSelCustomerId(doc.customer_id);
    setHighlightDocId(doc.id);
    downloadDoc(doc);
    window.history.replaceState({}, '', '/Dokumente');
  }, [allDoks, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Button-Klick animieren (kurzes Scale-Feedback)
  const animateBtn = (key) => {
    setClickedBtns(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setClickedBtns(prev => { const n = { ...prev }; delete n[key]; return n; }), 180);
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`"${doc.name}" wirklich l\u00f6schen?`)) return;
    animateBtn(`del-${doc.id}`);
    // Optimistic: sofort aus Liste entfernen
    setDeletingIds(prev => new Set([...prev, doc.id]));
    try {
      // GeBueV-revisionssicher: KEIN physisches Loeschen. Soft-Delete \u2013 Datei +
      // Versionen bleiben erhalten, das Dokument verschwindet nur aus der Ansicht.
      const { data: { user: _delUser } } = await supabase.auth.getUser();
      await entities.Dokument.update(doc.id, {
        deleted_at: new Date().toISOString(),
        deleted_by: _delUser?.id || null,
      });
      queryClient.invalidateQueries(["dokumente-all"]);
      toast.success("Dokument gel\u00f6scht", {closeButton: true});
    } catch (err) {
      // Bei Fehler: wieder anzeigen
      setDeletingIds(prev => { const n = new Set(prev); n.delete(doc.id); return n; });
      toast.error("Fehler: " + err.message);
    }
  };

  const handleCheckout = async (doc) => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: { session } }        = await supabase.auth.getSession();
      const jwt = session?.access_token || '';

      // Datei-URL ermitteln BEVOR die Checkout-Sperre gesetzt wird
      let fileUrl = '';
      if (doc.sharepoint_web_url) {
        // SharePoint-Dokument: direkte Web-URL verwenden
        fileUrl = doc.sharepoint_web_url;
      } else if (doc.storage_path) {
        // Legacy Supabase Storage: signierte URL erstellen
        const storagePath = doc.storage_path.replace('dokumente/', '');
        const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
        if (!urlData?.signedUrl) {
          toast.error('Fehler beim Erstellen der Download-URL');
          return;
        }
        fileUrl = urlData.signedUrl;
      } else {
        toast.error('Keine Datei-URL verfügbar.');
        return;
      }

      // Checkout-Sperre in DB setzen (erst nachdem URL erfolgreich ermittelt wurde)
      await entities.Dokument.update(doc.id, {
        checked_out_by:      authUser.id,
        checked_out_by_name: user?.full_name || authUser.email,
        checked_out_at:      new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });

      const uri = [
          'smartis-open://checkout',
          '?doc_id=',   encodeURIComponent(doc.id),
          '&jwt=',      encodeURIComponent(jwt),
          '&item_id=',  encodeURIComponent(fileUrl),
          '&filename=', encodeURIComponent(doc.filename),
        ].join('');
      const _a = document.createElement('a');
      _a.href = uri;
      document.body.appendChild(_a); _a.click();
      document.body.removeChild(_a);
      toast.success('Artis Agent öffnet die Datei – wird beim Schließen automatisch eingecheckt.');
    } catch (err) {
      toast.error('Fehler: ' + err.message);
    }
  };

  const openCheckin = (doc) => { handleCheckin(doc, null); };

  const handleCheckin = async (doc, file) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token || '';

      if (file && doc.sharepoint_item_id) {
        // SharePoint: neue Version hochladen + Sperre aufheben (checkin-save)
        const form = new FormData();
        form.append('action', 'checkin-save');
        form.append('doc_id',  doc.id);
        form.append('file',    file, file.name);
        const res = await fetch(SPFILES, {
          method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload fehlgeschlagen'); }
        setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
        toast.success('Eingecheckt – neue Version gespeichert.');
      } else if (!file && doc.sharepoint_item_id) {
        // Nur Sperre aufheben
        await spCall(jwt, { action: 'checkin-discard', doc_id: doc.id });
        toast.success('Eingecheckt.');
      } else if (file) {
        // Legacy: Upload zu SharePoint als neues Item
        const sp = await spUpload(jwt, file, doc.customer_id, doc.category, doc.year);
        if (doc.sharepoint_item_id) {
          await spCall(jwt, { action: 'delete', item_id: doc.sharepoint_item_id }).catch(() => {});
        } else if (doc.storage_path) {
          await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
        }
        await entities.Dokument.update(doc.id, {
          sharepoint_item_id: sp.item_id, sharepoint_web_url: sp.web_url,
          storage_path: '', filename: file.name, file_size: file.size, file_type: file.type,
          updated_at: new Date().toISOString(),
          checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
        });
        setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
        toast.success('Eingecheckt & neue Version hochgeladen.');
      } else {
        await entities.Dokument.update(doc.id, {
          checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
        });
        toast.success('Eingecheckt.');
      }
    } catch (err) { toast.error('Fehler: ' + err.message); }
    queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
  };

  // ── Datei per Drag&Drop auf eine bestehende Dokument-Zeile ablegen ────────
  // Ersetzt die aktuelle Datei durch die neue und legt automatisch eine neue
  // Version an. Bewusst SEPARAT von handleCheckin/CheckinDialog (hands-off):
  // nutzt nur den bestehenden Server-Endpoint 'checkin-save', der die Sperre
  // prueft (blockt bei Fremd-Checkout) und via storage_path-Wechsel den
  // DB-Versionstrigger ausloest. Kein Vor-Checkout noetig.
  const replaceDocFile = async (doc, file) => {
    if (!doc || !file) return;
    if (doc.checked_out_by && doc.checked_out_by !== user?.id) {
      toast.error(`Gesperrt – ausgecheckt von ${doc.checked_out_by_name || 'jemand anderem'}.`);
      return;
    }
    if (!window.confirm(`„${doc.name}" mit „${file.name}" überschreiben?\n\nDie bisherige Datei wird als ältere Version archiviert und die neue als aktuelle Version abgelegt.`)) return;
    setReplacingId(doc.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token || '';
      const form = new FormData();
      form.append('action', 'checkin-save');
      form.append('doc_id', doc.id);
      form.append('file',   file, file.name);
      const res = await fetch(SPFILES, {
        method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload fehlgeschlagen'); }
      // Volltext neu indexieren + neuen Integritaets-Hash setzen; best-effort.
      await entities.Dokument.update(doc.id, { content_text: null, content_hash: await sha256Hex(file) }).catch(() => {});
      supabase.functions.invoke('index-document', { body: { doc_id: doc.id } }).catch(() => {});
      setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
      toast.success('Neue Version abgelegt – vorherige Version archiviert.');
    } catch (err) {
      toast.error('Ersetzen fehlgeschlagen: ' + err.message);
    } finally {
      setReplacingId(null);
    }
  };

  // Drag&Drop-Props fuer eine Dokument-Zeile (Datei drauf ziehen = neue Version).
  const fileDropProps = (doc) => ({
    onDragOver: e => { e.preventDefault(); e.stopPropagation(); setDragOver(false); if (replacingId !== doc.id) setDropTargetId(doc.id); },
    onDragLeave: e => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget)) setDropTargetId(prev => (prev === doc.id ? null : prev)); },
    onDrop: e => {
      e.preventDefault(); e.stopPropagation(); setDropTargetId(null); setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) replaceDocFile(doc, f);
    },
  });

  // ── Hover-Vorschau: Maus ueber das Augen-Symbol → Popup mit Dateivorschau ──
  // Nur fuer Supabase-Dateien (Signed-URL abrufbar); SharePoint ist tabu.
  const openHoverPreview = (doc, el) => {
    clearTimeout(hoverTimer.current);
    const rect = el.getBoundingClientRect();
    hoverTimer.current = setTimeout(async () => {
      let url = signedUrls[doc.id];
      if (!url && doc.storage_path) {
        try {
          const sp = doc.storage_path.replace(/^dokumente\//, '');
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(sp, 600);
          url = data?.signedUrl;
        } catch { /* ignore */ }
      }
      if (url) setHoverPreview({ doc, url, rect });
    }, 280);
  };
  // Nur ein noch nicht ausgeloestes Oeffnen abbrechen — ein offenes Fenster bleibt.
  const cancelHoverOpen = () => { clearTimeout(hoverTimer.current); };
  // Gibt das Augen-Symbol fuer eine Zeile zurueck (nur bei lokal previewbaren Dateien).
  const renderPreviewEye = (doc) => {
    // Alles liegt in Supabase-Storage; sobald ein storage_path da ist, ist die Datei previewbar.
    if (!doc.storage_path) return null;
    return (
      <button title="Vorschau (Maus drüberhalten — Fenster bleibt, ist verschieb- und größenverstellbar)"
        onMouseEnter={e => openHoverPreview(doc, e.currentTarget)}
        onMouseLeave={cancelHoverOpen}
        onClick={e => e.stopPropagation()}
        style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
        <Eye size={13} />
      </button>
    );
  };

  // Per Mail senden: Freigabe-Link (Token) erstellen und ein neues Mail damit oeffnen.
  // Empfaenger kann den Link ohne Login anklicken (gleicher Mechanismus wie "Link erstellen").
  const handleMailDoc = async (doc) => {
    try {
      const { data, error } = await supabase
        .from("share_links")
        .insert({ name: doc.name, doc_id: doc.id, customer_id: doc.customer_id })
        .select("token")
        .single();
      if (error) throw error;
      const url = `${window.location.origin}/share/${data.token}`;
      const name = doc.name || "Dokument";
      // Ein mailto:-Body kann nur reinen Text tragen (kein HTML) – deshalb legen wir den
      // klickbaren Dateiname-Hyperlink zusaetzlich in die Zwischenablage. Im geoeffneten
      // Mail fuegt der Nutzer ihn mit Strg+V als Link ein (wie in Outlook). Die nackte URL
      // bleibt als Fallback im Text.
      let clipOk = false;
      try {
        const esc = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const html = `<a href="${url}">${esc(name)}</a>`;
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new window.ClipboardItem({
            "text/html":  new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([url],  { type: "text/plain" }),
          })]);
          clipOk = true;
        }
      } catch { /* ignore */ }
      const subject = encodeURIComponent(name);
      const body = encodeURIComponent(`Guten Tag\n\nanbei der Link zum Dokument „${name}":\n${url}\n\nFreundliche Grüsse`);
      const a = document.createElement("a");
      a.href = `mailto:?subject=${subject}&body=${body}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast.success(clipOk
        ? "Mail geöffnet · Dateiname-Link in Zwischenablage – mit Strg+V einfügen"
        : "Mail mit Freigabe-Link geöffnet");
    } catch (e) {
      toast.error("Mail konnte nicht erstellt werden: " + e.message);
    }
  };

  // Wiederverwendbare Zeilen-Aktionen: haeufige Icons einzeln, Rest im "⋯"-Menue.
  const iconBtn = { background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 };
  const renderRowActions = (doc, { isCheckedOut, isMyCheckout, lockedByOther, isAdmin }) => {
    const mItem = (icon, label, onClick, opts = {}) => (
      <button onClick={() => { setMenuDocId(null); if (!opts.disabled) onClick(); }} disabled={!!opts.disabled}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
          background: "none", border: "none", cursor: opts.disabled ? "default" : "pointer",
          color: opts.disabled ? s.textMuted + "66" : (opts.danger ? "#ef4444" : s.textMain),
          padding: "7px 10px", borderRadius: 6, fontSize: 13 }}
        onMouseEnter={e => { if (!opts.disabled) e.currentTarget.style.background = s.rowHover; }}
        onMouseLeave={e => e.currentTarget.style.background = "none"}>
        {icon}<span>{label}</span>
      </button>
    );
    return (
      <>
        <button onClick={() => handleMailDoc(doc)} title="Per Mail senden (Freigabe-Link)" style={iconBtn}><Mail size={15} /></button>
        {renderPreviewEye(doc)}
        <button onClick={() => setCopyDoc(doc)} title="Kopieren (neu verschlagworten)" style={iconBtn}><CopyPlus size={14} /></button>
        <button onClick={() => { animateBtn(`sh-${doc.id}`); setShareDialog({ type: 'doc', doc_id: doc.id, name: doc.name, customer_id: doc.customer_id }); }} title="Link erstellen" style={iconBtn}><Link2 size={15} /></button>
        <button onClick={() => setChartisDoc(doc)} title="Chartis – Chat zu diesem Dokument" style={iconBtn}><MessageSquare size={15} /></button>
        <button onClick={() => { animateBtn(`dl-${doc.id}`); downloadDoc(doc); }} title="Herunterladen" style={{ ...iconBtn, color: accent }}><Download size={15} /></button>
        <div style={{ position: "relative", display: "flex" }}>
          <button onClick={(e) => { e.stopPropagation(); setMenuDocId(menuDocId === doc.id ? null : doc.id); }} title="Mehr" style={iconBtn}><MoreVertical size={16} /></button>
          {menuDocId === doc.id && (
            <>
              <div onClick={() => setMenuDocId(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 41,
                background: s.cardBg, border: "1px solid " + border, borderRadius: 8,
                boxShadow: "0 8px 28px rgba(0,0,0,0.18)", padding: 4, minWidth: 200, display: "flex", flexDirection: "column" }}>
                {!isCheckedOut && mItem(<LockOpen size={14} />, "Auschecken", () => handleCheckout(doc))}
                {isMyCheckout && mItem(<Lock size={14} />, "Einchecken", () => openCheckin(doc))}
                {lockedByOther && isAdmin && mItem(<ShieldAlert size={14} />, "Sperre aufheben (Admin)", () => handleCheckin(doc, null))}
                {mItem(<Pencil size={14} />, "Bearbeiten", () => setEditDoc(doc))}
                {mItem(<HistoryIcon size={14} />, "Versionsverlauf", () => setVersionsDoc(doc))}
                {mItem(<Trash2 size={14} />, "Löschen", () => handleDelete(doc), { danger: true, disabled: lockedByOther })}
              </div>
            </>
          )}
        </div>
      </>
    );
  };

  // Gemeinsame flache Dokument-Zeile (Normal-View + "Zuletzt"-Tab).
  // showCustomer=true zeigt zusaetzlich den Kundennamen (nuetzlich im "Zuletzt"-Tab ueber alle Kunden).
  const renderDocRow = (doc, { showCustomer = false } = {}) => {
    const fi            = getFileInfo(doc.file_type, doc.filename);
    const cat           = CATEGORIES.find(c => c.key === doc.category);
    const ids           = doc.tag_ids || [];
    const isCheckedOut  = !!doc.checked_out_by;
    const isMyCheckout  = doc.checked_out_by === user?.id;
    const lockedByOther = isCheckedOut && !isMyCheckout;
    const isAdmin       = user?.role === 'admin';
    const cust          = showCustomer ? customers.find(cx => cx.id === doc.customer_id) : null;
    const openOrCheckout = () => { const _u = doc.sharepoint_web_url || signedUrls[doc.id]; if (!doc.checked_out_by) { handleCheckout(doc); } else if (doc.checked_out_by === user?.id) { openCheckin(doc); } else if (_u) { window.open(_u, '_blank'); } else { toast.error('URL nicht verfügbar.'); } };
    return (
      <div key={doc.id} {...fileDropProps(doc)}
        title="Neue Datei hierher ziehen = als neue Version ablegen"
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", borderBottom: "1px solid " + border + "55", transition: "background 0.1s", opacity: replacingId === doc.id ? 0.5 : 1, ...(doc.id === highlightDocId ? { boxShadow: "0 0 0 2px " + accent + "88 inset", background: accent + "12", borderRadius: 6 } : {}), ...(doc.id === dropTargetId ? { boxShadow: "0 0 0 2px #10b981 inset", background: "#10b98114", borderRadius: 6 } : {}) }}
        onMouseEnter={e => { if (doc.id !== dropTargetId) e.currentTarget.style.background = s.rowHover; }}
        onMouseLeave={e => e.currentTarget.style.background = doc.id === highlightDocId ? accent + "12" : "transparent"}>
        <span onClick={openOrCheckout} style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center", cursor: "pointer" }}>{fi.label}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div onClick={openOrCheckout} style={{ fontSize: 13, color: s.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, flex: 1, cursor: "pointer" }}>{doc.name}</div>
            {isCheckedOut && (
              <span title={"Ausgecheckt von " + doc.checked_out_by_name + " am " + (doc.checked_out_at ? new Date(doc.checked_out_at).toLocaleDateString("de-CH") : "")}
                style={{ fontSize: 10, color: isMyCheckout ? accent : "#f59e0b",
                  background: isMyCheckout ? accent + "18" : "#f59e0b18",
                  border: "1px solid " + (isMyCheckout ? accent + "44" : "#f59e0b44"),
                  borderRadius: 8, padding: "1px 6px", flexShrink: 0,
                  display: "flex", alignItems: "center", gap: 3 }}>
                <Lock size={9} />
                {isMyCheckout ? "Ich" : doc.checked_out_by_name}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
            {showCustomer && cust && (
              <span style={{ fontSize: 10, background: accent + "14", color: accent, border: "1px solid " + accent + "33", borderRadius: 8, padding: "1px 6px" }}>{cust.company_name}</span>
            )}
            {(showCustomer || !selCat) && cat && (
              <span style={{ fontSize: 10, background: s.sidebarBg, color: s.textMuted, border: "1px solid " + border, borderRadius: 8, padding: "1px 6px" }}>{cat.icon} {cat.label}</span>
            )}
            {ids.slice(0, 4).map(id => {
              const lbl = tagLabel(id);
              const col = tagColor(id);
              if (!lbl) return null;
              return (
                <span key={id} style={{ background: col + "22", color: col, border: "1px solid " + col + "55", borderRadius: 8, padding: "1px 7px", fontSize: 10, display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: col }} />
                  {lbl}
                </span>
              );
            })}
            {ids.length > 4 && <span style={{ fontSize: 10, color: s.textMuted }}>+{ids.length - 4}</span>}
            {doc.notes && <span style={{ fontSize: 10, color: s.textMuted, fontStyle: "italic" }}>{doc.notes}</span>}
          </div>
        </div>
        {doc.year && <span style={{ fontSize: 11, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{doc.year}</span>}
        <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0, width: 55, textAlign: "right" }}>{formatBytes(doc.file_size)}</span>
        {(doc.updated_at || doc.created_at) && (
          <span title={
              (doc.created_at ? "Hochgeladen: " + new Date(doc.created_at).toLocaleString("de-CH") : "") +
              (doc.updated_at ? "\nZuletzt gespeichert: " + new Date(doc.updated_at).toLocaleString("de-CH") : "")
            }
            style={{ fontSize: 10, color: s.textMuted, flexShrink: 0, whiteSpace: "nowrap", minWidth: 58, textAlign: "right" }}>
            {new Date(doc.updated_at || doc.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" })}
          </span>
        )}
        {renderRowActions(doc, { isCheckedOut, isMyCheckout, lockedByOther, isAdmin })}
      </div>
    );
  };

  const selectCustomer = (id) => { setSelCustomerId(id); setSelCat(null); setSelYear(null); setExpandedC(p => ({ ...p, [id]: true })); };
  const selectCat      = (cid, ck) => { setSelCustomerId(cid); setSelCat(ck); setSelYear(null); setExpandedCat(p => ({ ...p, [cid + "_" + ck]: true })); };

  const treeItem = { display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", cursor: "pointer", borderRadius: 5, fontSize: 12, userSelect: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: s.cardBg }}>

      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: s.textMain }}>Dokumente</span>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 8, padding: 3 }}>
          {[['alle', 'Alle Dokumente'], ['ausgecheckt', 'Ausgecheckt'], ['recent', 'Zuletzt']].map(([key, label]) => (
            <button key={key} onClick={() => setPageTab(key)}
              style={{ padding: "4px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: pageTab === key ? 600 : 400,
                background: pageTab === key ? accent : "transparent",
                color: pageTab === key ? "#fff" : s.textMuted, transition: "all 0.15s", display: "flex", alignItems: "center", gap: 5 }}>
              {key === 'recent' && <Clock size={12} />}
              {label}{key === 'ausgecheckt' && myCheckedOutDocs.length > 0 ? ' (' + myCheckedOutDocs.length + ')' : ''}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {/* ── Volltext-Suche ── */}
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: ftSearching ? accent : s.textMuted, pointerEvents: "none" }} />
          <input
            value={ftSearch}
            onChange={e => setFtSearch(e.target.value)}
            placeholder={selCustomerId ? "Volltext-Suche (dieser Kunde)…" : "Volltext-Suche über alle Dokumente…"}
            style={{ background: s.inputBg, border: "1px solid " + (ftSearch ? accent : border), color: s.textMain, borderRadius: 8, padding: "5px 32px 5px 30px", fontSize: 12, width: 280, outline: "none", transition: "border 0.2s" }}
          />
          {ftSearch && (
            <button onClick={() => { setFtSearch(""); setFtResults(null); }}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: s.textMuted, padding: 0 }}>
              <X size={13} />
            </button>
          )}
        </div>
        <span style={{ fontSize: 12, color: s.textMuted }}>{allDoks.length} Dok.</span>
        <Button onClick={() => setShowShareLinks(true)} style={{ background: "transparent", color: s.textMuted, border: "1px solid " + border, fontSize: 12, height: 32, display: "flex", alignItems: "center", gap: 5 }}>
          <Link2 size={13} /> Links
        </Button>
        <Button onClick={() => setShowUpload(true)} style={{ background: accent, color: "#fff", fontSize: 12, height: 32, display: "flex", alignItems: "center", gap: 5 }}>
          <Upload size={13} /> Hochladen
        </Button>
        <Button onClick={() => setShowBatch(true)}
          title="Mehrere Dateien auf einmal mit KI-Zuordnung hochladen (Beta)"
          style={{ background: "transparent", color: accent, border: "1px solid " + accent, fontSize: 12, height: 32, display: "flex", alignItems: "center", gap: 5 }}>
          <Library size={13} /> Massenablage
        </Button>
      </div>

      {/* ── Volltext-Suchergebnisse (überlagert normale Ansicht) ── */}
      {ftResults !== null && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          <div style={{ fontSize: 12, color: s.textMuted, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            {ftSearching
              ? <><Search size={12} style={{ color: accent }} /> Suche läuft…</>
              : <><Search size={12} style={{ color: accent }} />
                  <strong style={{ color: s.textMain }}>{ftResults.length}</strong> Treffer für „{ftSearch}"
                  {selCustomerId && <span> (nur dieser Kunde)</span>}
                </>
            }
          </div>
          {ftResults.length === 0 && !ftSearching && (
            <div style={{ textAlign: "center", color: s.textMuted, paddingTop: 60, fontSize: 14 }}>
              Kein Treffer — versuche andere Begriffe oder weniger spezifische Wörter.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ftResults.map(doc => {
              const fi   = getFileInfo(doc.file_type, doc.filename);
              const cat  = CATEGORIES.find(c => c.key === doc.category);
              const cust = customers.find(c => c.id === doc.customer_id);
              // RPC liefert schlanke Felder -- fuer Edit/Copy den vollen Datensatz nehmen
              const fullDoc = allDoks.find(d => d.id === doc.id) || doc;
              const relevancePercentage = Math.round((doc.rank / highestScore) * 100);

              return (
                <div key={doc.id}
                  onClick={() => handleCheckout(fullDoc)}
                  title="Auschecken (zum Bearbeiten öffnen)"
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", background: s.cardBg,
                    border: "1px solid " + border, borderRadius: 8, cursor: "pointer", transition: "border 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = accent}
                  onMouseLeave={e => e.currentTarget.style.borderColor = border}>
                  <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center", marginTop: 2 }}>{fi.label}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: s.textMain, fontWeight: 600 }}>{doc.name}</div>
                    {doc.headline && (
                      <div style={{ fontSize: 11, color: s.textMuted, marginTop: 2, fontStyle: "italic" }}
                        dangerouslySetInnerHTML={{ __html: doc.headline.replace(/<b>/g, `<b style="color:${accent};font-style:normal">`).replace(/<\/b>/g, "</b>") }} />
                    )}
                    <div style={{ fontSize: 11, color: s.textMuted, marginTop: 3, display: "flex", gap: 8 }}>
                      {cust && <span style={{ color: accent, fontWeight: 500 }}>{cust.company_name}</span>}
                      {cat && <span>{cat.icon} {cat.label}</span>}
                      {doc.year && <span>{doc.year}</span>}
                    </div>
                  </div>
                  {/* Action-Buttons (gleich wie Listen-Ansicht) */}
                  <div style={{ flexShrink: 0, alignSelf: "center", display: "flex", gap: 2, alignItems: "center" }}
                       onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleCheckout(fullDoc)} title="Auschecken" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}><LockOpen size={13} /></button>
                    <button onClick={() => setEditDoc(fullDoc)} title="Bearbeiten" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}><Pencil size={13} /></button>
                    <button onClick={() => setCopyDoc(fullDoc)} title="Kopieren (neu verschlagworten)" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}><CopyPlus size={13} /></button>
                    {renderPreviewEye(fullDoc)}
                    <button onClick={() => setVersionsDoc(fullDoc)} title="Versionsverlauf" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}><HistoryIcon size={13} /></button>
                    <button onClick={() => downloadDoc(fullDoc)} title="Herunterladen" style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}><Download size={14} /></button>
                    <button onClick={() => setShareDialog({ type: 'doc', doc_id: fullDoc.id, name: fullDoc.name, customer_id: fullDoc.customer_id })} title="Link erstellen" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}><Link2 size={14} /></button>
                    <button onClick={() => handleDelete(fullDoc)} title="Löschen" style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}><Trash2 size={14} /></button>
                    <button onClick={() => setChartisDoc(fullDoc)} title="Chartis – Chat zu diesem Dokument" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}><MessageSquare size={14} /></button>
                    <div style={{ flexShrink: 0, alignSelf: "center", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      {/* Die 5 Punkte passend zu den Prozenten einfärben */}
                      <div style={{ display: "flex", gap: 2 }}>
                        {[1,2,3,4,5].map(i => {
                          // Jeder Punkt entspricht 20% (Punkt 1 bei >=10%, Punkt 2 bei >=30% etc. durch die Abrundungsgrenze)
                          const filled = relevancePercentage >= (i * 20 - 10);
                          return <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: filled ? accent : border }} />;
                        })}
                      </div>

                      {/* Neue Prozentanzeige direkt unter den Punkten */}
                      <span style={{ fontSize: 10, color: s.textMuted, fontWeight: 600, fontFamily: "sans-serif" }}>{relevancePercentage}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pageTab === 'ausgecheckt' && !ftResults && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {myCheckedOutDocs.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50%", color: s.textMuted, gap: 10 }}>
              <span style={{ fontSize: 40 }}>&#128275;</span>
              <span style={{ fontSize: 14 }}>Keine Dokumente ausgecheckt</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 860 }}>
              <div style={{ fontSize: 12, color: s.textMuted, marginBottom: 4 }}>
                {myCheckedOutDocs.length} Dokument{myCheckedOutDocs.length !== 1 ? "e" : ""} von dir ausgecheckt
              </div>
              {myCheckedOutDocs.map(doc => {
                const fi   = getFileInfo(doc.file_type, doc.filename);
                const cat  = CATEGORIES.find(cx => cx.key === doc.category);
                const cust = customers.find(cx => cx.id === doc.customer_id);
                return (
                  <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: s.cardBg,
                    border: "1px solid " + accent + "44", borderRadius: 10, borderLeft: "3px solid " + accent }}>
                    <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center" }}>{fi.label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: s.textMain, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                      <div style={{ fontSize: 11, color: s.textMuted, marginTop: 3 }}>
                        {cust?.company_name || "Unbekannter Kunde"}
                        {cat ? " · " + cat.icon + " " + cat.label : ""}
                        {doc.year ? " · " + doc.year : ""}
                        {doc.checked_out_at ? " · seit " + new Date(doc.checked_out_at).toLocaleDateString("de-CH") : ""}
                      </div>
                    </div>
                    <button onClick={() => openCheckin(doc)}
                      style={{ background: accent, color: "#fff", border: "none", borderRadius: 7, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <Lock size={13} /> Einchecken
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {pageTab === 'recent' && !ftResults && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 8, position: "sticky", top: 0, background: s.cardBg, zIndex: 1 }}>
            <Clock size={14} style={{ color: accent }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: s.textMain }}>Zuletzt verwendet</span>
            <span style={{ fontSize: 12, color: s.textMuted }}>({recentDocs.length})</span>
            <span style={{ fontSize: 11, color: s.textMuted, marginLeft: 4 }}>· neu abgelegt oder geändert, über alle Kunden</span>
          </div>
          {recentDocs.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "40%", color: s.textMuted, gap: 10 }}>
              <Clock size={36} />
              <span style={{ fontSize: 14 }}>Noch keine Dokumente</span>
            </div>
          ) : (
            recentDocs.map(doc => renderDocRow(doc, { showCustomer: true }))
          )}
        </div>
      )}

      {pageTab === 'alle' && !ftResults && (
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ═══ LINKS: Baum ═══════════════════════════════════════════════ */}
        <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid " + border, background: s.sidebarBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid " + border, position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
            <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Kunde suchen... (oder einfach lostippen)"
              style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 24px", fontSize: 12, width: "100%", outline: "none" }} />
            {typeaheadBuf && (
              <div title="Tastatur-Schnellsuche (ESC zum Loeschen)"
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: accent, color: "#fff", fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10, pointerEvents: "none", letterSpacing: 0.3 }}>
                {typeaheadBuf}
              </div>
            )}
          </div>

          {/* "Alle" Root */}
          <div onClick={() => { setSelCustomerId(null); setSelCat(null); setSelYear(null); }}
            style={{ ...treeItem, margin: "4px 6px", background: !selCustomerId ? s.selBg : "transparent", color: !selCustomerId ? accent : s.textMain, fontWeight: !selCustomerId ? 600 : 400 }}>
            <span style={{ fontSize: 14 }}>{"\uD83D\uDCC1"}</span>
            <span style={{ flex: 1 }}>Alle Dokumente</span>
            <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px" }}>{allDoks.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
            {isLoading ? <div style={{ padding: 16, color: s.textMuted, fontSize: 12 }}>Laedt...</div>
              : tree.length === 0 ? <div style={{ padding: 16, color: s.textMuted, fontSize: 12 }}>Keine Dokumente</div>
              : tree.map(cust => {
                const isCustSel = selCustomerId === cust.id && !selCat;
                const isExp     = expandedC[cust.id];
                return (
                  <div key={cust.id} data-cust-id={cust.id} style={{ margin: "1px 6px" }}>
                    <div onClick={() => selectCustomer(cust.id)}
                      style={{ ...treeItem, background: selCustomerId === cust.id ? s.selBg + (isCustSel ? "" : "88") : "transparent", color: selCustomerId === cust.id ? accent : s.textMain, fontWeight: selCustomerId === cust.id ? 600 : 400 }}>
                      <span onClick={e => { e.stopPropagation(); setExpandedC(p => ({ ...p, [cust.id]: !p[cust.id] })); }}
                        style={{ display: "flex", alignItems: "center", color: s.textMuted, flexShrink: 0, width: 14 }}>
                        {isExp ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      </span>
                      <span style={{ fontSize: 13 }}>{isExp ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cust.company_name}</span>
                      <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cust.docCount}</span>
                      <span onClick={e => { e.stopPropagation(); downloadFolder(cust.id, null, null); }}
                        title="Alle Dokumente als ZIP herunterladen"
                        style={{ display: "flex", alignItems: "center", color: s.textMuted, padding: "0 2px", cursor: "pointer", flexShrink: 0, opacity: 0.6 }}>
                        <Download size={11} />
                      </span>
                      <span onClick={e => { e.stopPropagation(); setShareDialog({ type: 'folder', customer_id: cust.id, name: cust.company_name }); }}
                        title="Alle Dokumente dieses Kunden teilen"
                        style={{ display: "flex", alignItems: "center", color: s.textMuted, padding: "0 2px", cursor: "pointer", flexShrink: 0, opacity: 0.6 }}>
                        <Link2 size={11} />
                      </span>
                    </div>

                    {isExp && cust.cats.map(cat => {
                      const ck      = cust.id + "_" + cat.key;
                      const catSel  = selCustomerId === cust.id && selCat === cat.key && selYear === null;
                      const catExp  = expandedCat[ck];
                      return (
                        <div key={cat.key} style={{ paddingLeft: 14 }}>
                          <div onClick={() => selectCat(cust.id, cat.key)}
                            style={{ ...treeItem, background: catSel ? s.selBg : "transparent", color: (selCustomerId === cust.id && selCat === cat.key) ? accent : s.textMain, fontWeight: catSel ? 600 : 400 }}>
                            <span onClick={e => { e.stopPropagation(); setExpandedCat(p => ({ ...p, [ck]: !p[ck] })); }}
                              style={{ display: "flex", alignItems: "center", color: s.textMuted, flexShrink: 0, width: 14 }}>
                              {cat.years.length > 0 || cat.noYear > 0
                                ? (catExp ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
                                : <span style={{ width: 11 }} />}
                            </span>
                            <span style={{ fontSize: 12 }}>{cat.icon}</span>
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                            <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cat.count}</span>
                            <span onClick={e => { e.stopPropagation(); downloadFolder(cust.id, cat.key, null); }}
                              title="Ordner herunterladen"
                              style={{ display: "flex", alignItems: "center", color: s.textMuted, padding: "0 2px", cursor: "pointer", flexShrink: 0, opacity: 0.6 }}>
                              <Download size={11} />
                            </span>
                            <span onClick={e => { e.stopPropagation(); setShareDialog({ type: 'folder', customer_id: cust.id, category: cat.key, name: cust.company_name + " – " + cat.label }); }}
                              title="Ordner-Link erstellen"
                              style={{ display: "flex", alignItems: "center", color: s.textMuted, padding: "0 2px", cursor: "pointer", flexShrink: 0, opacity: 0.6 }}>
                              <Link2 size={11} />
                            </span>
                          </div>

                          {catExp && (
                            <div style={{ paddingLeft: 14 }}>
                              {cat.years.map(yr => {
                                const yrSel = selCustomerId === cust.id && selCat === cat.key && selYear === yr;
                                const cnt   = allDoks.filter(d => d.customer_id === cust.id && d.category === cat.key && d.year === yr).length;
                                return (
                                  <div key={yr} onClick={() => { setSelCustomerId(cust.id); setSelCat(cat.key); setSelYear(yr); }}
                                    style={{ ...treeItem, background: yrSel ? s.selBg : "transparent", color: yrSel ? accent : s.textMain, fontWeight: yrSel ? 600 : 400 }}>
                                    <span style={{ width: 14, flexShrink: 0 }} />
                                    <span style={{ fontSize: 12 }}>{"\uD83D\uDCC5"}</span>
                                    <span style={{ flex: 1 }}>{yr}</span>
                                    <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cnt}</span>
                                    <span onClick={e => { e.stopPropagation(); downloadFolder(cust.id, cat.key, yr); }}
                                      title="Jahr herunterladen"
                                      style={{ display: "flex", alignItems: "center", color: s.textMuted, padding: "0 2px", cursor: "pointer", flexShrink: 0, opacity: 0.6 }}>
                                      <Download size={11} />
                                    </span>
                                  </div>
                                );
                              })}
                              {cat.noYear > 0 && (
                                <div onClick={() => { setSelCustomerId(cust.id); setSelCat(cat.key); setSelYear("__none__"); }}
                                  style={{ ...treeItem, background: (selCustomerId === cust.id && selCat === cat.key && selYear === "__none__") ? s.selBg : "transparent", color: s.textMuted, fontStyle: "italic" }}>
                                  <span style={{ width: 14, flexShrink: 0 }} />
                                  <span style={{ fontSize: 12 }}>{"\uD83D\uDCC4"}</span>
                                  <span style={{ flex: 1 }}>Kein Jahr</span>
                                  <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cat.noYear}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        </div>

        {/* ═══ RECHTS: Dateiliste ════════════════════════════════════════ */}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", position: "relative" }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (selCustomerId) setDragOver(true); }}
          onDragEnter={e => { e.preventDefault(); e.stopPropagation(); if (selCustomerId) setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation(); setDragOver(false);
            if (!selCustomerId) { toast.error("Bitte zuerst einen Kunden in der Seitenleiste auswählen"); return; }
            const f = e.dataTransfer.files?.[0];
            if (f) { setDropFile(f); setShowUpload(true); }
          }}
        >
          {/* Drop-Overlay */}
          {dragOver && (
            <div style={{ position: "absolute", inset: 0, zIndex: 50, background: accent + "18",
              border: "3px dashed " + accent, borderRadius: 10, pointerEvents: "none",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Upload size={40} style={{ color: accent, opacity: 0.8 }} />
              <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>Datei hier ablegen</span>
              {selCustomer && <span style={{ fontSize: 12, color: accent, opacity: 0.7 }}>für {selCustomer.company_name}</span>}
            </div>
          )}
          {/* Topbar */}
          <div style={{ padding: "8px 16px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: accent, overflow: "hidden", minWidth: 0 }}>
              {selCustomer ? (<>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}>{selCustomer.company_name}</span>
                <span onClick={() => setShareDialog({ type: 'folder', customer_id: selCustomer.id, name: selCustomer.company_name })}
                  title="Alle Dokumente dieses Kunden teilen" style={{ cursor: "pointer", opacity: 0.5, flexShrink: 0, display: "flex" }}><Link2 size={12} /></span>
                {selCat && (<>
                  <span style={{ color: s.textMuted, margin: "0 2px", flexShrink: 0 }}>{"\u203a"}</span>
                  <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{(CATEGORIES.find(x => x.key === selCat)?.icon || "") + " " + (CATEGORIES.find(x => x.key === selCat)?.label || selCat)}</span>
                  <span onClick={() => setShareDialog({ type: 'folder', customer_id: selCustomer.id, category: selCat, name: selCustomer.company_name + " – " + (CATEGORIES.find(x => x.key === selCat)?.label || selCat) })}
                    title="Diese Kategorie teilen" style={{ cursor: "pointer", opacity: 0.5, flexShrink: 0, display: "flex" }}><Link2 size={12} /></span>
                </>)}
                {selYear && (<>
                  <span style={{ color: s.textMuted, margin: "0 2px", flexShrink: 0 }}>{"\u203a"}</span>
                  <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{selYear === "__none__" ? "Kein Jahr" : selYear}</span>
                  {selYear !== "__none__" && (
                    <span onClick={() => setShareDialog({ type: 'folder', customer_id: selCustomer.id, category: selCat, year: selYear, name: selCustomer.company_name + " – " + (CATEGORIES.find(x => x.key === selCat)?.label || selCat) + " " + selYear })}
                      title="Dieses Jahr teilen" style={{ cursor: "pointer", opacity: 0.5, flexShrink: 0, display: "flex" }}><Link2 size={12} /></span>
                  )}
                </>)}
              </>) : (
                <span>Alle Dokumente</span>
              )}
            </div>
            <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0 }}>({filtered.length})</span>
            <div style={{ flex: 1 }} />
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
              <input value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="Suchen..."
                style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 24px", fontSize: 12, width: 180, outline: "none" }} />
            </div>
            {/* View + Sortierung */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {/* View-Umschalter */}
              <div style={{ display: "flex", gap: 2, background: s.inputBg, border: "1px solid " + border, borderRadius: 6, padding: 2 }}>
                {[{ key: "normal", label: "Normal" }, { key: "abschluss", label: "Abschluss" }].map(v => (
                  <button key={v.key} onClick={() => { setViewMode(v.key); setOpenFolders(new Set()); }}
                    style={{ background: viewMode === v.key ? accent : "none", color: viewMode === v.key ? "#fff" : s.textMuted,
                      border: "none", cursor: "pointer", borderRadius: 4, padding: "2px 10px", fontSize: 11, fontWeight: viewMode === v.key ? 600 : 400 }}>
                    {v.label}
                  </button>
                ))}
              </div>
              {viewMode === "abschluss" && selCustomerId && (
                <button onClick={exportAbschlussZip} title="Alle Abschluss-Dokumente als ZIP exportieren (nach Tag-Ordnern)"
                  style={{ background: s.inputBg, border: "1px solid " + border, color: accent, borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  <Download size={12} /> Export
                </button>
              )}
              {/* Sort-Dropdown */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowSortMenu(m => !m)}
                  style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMuted, borderRadius: 6,
                    padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                  {sortBy === "-created_at" ? "Datum" : sortBy === "name" ? "Name" : "Jahr"}
                  <ChevronDown size={11} />
                </button>
                {showSortMenu && (
                  <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: s.cardBg,
                    border: "1px solid " + border, borderRadius: 6, padding: 4, zIndex: 60,
                    minWidth: 90, boxShadow: "0 4px 16px #0003" }}>
                    {[{ key: "-created_at", label: "Datum" }, { key: "name", label: "Name" }, { key: "year", label: "Jahr" }].map(opt => (
                      <button key={opt.key} onClick={() => { setSortBy(opt.key); setShowSortMenu(false); }}
                        style={{ display: "block", width: "100%", textAlign: "left",
                          background: sortBy === opt.key ? accent + "22" : "none",
                          color: sortBy === opt.key ? accent : s.textMain,
                          border: "none", cursor: "pointer", borderRadius: 4, padding: "5px 10px", fontSize: 11 }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Liste */}
          <div style={{ flex: 1, overflowY: "auto" }} onClick={() => showSortMenu && setShowSortMenu(false)}>
            {!selCustomerId ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: s.textMuted, gap: 10 }}>
                <span style={{ fontSize: 48 }}>{"\uD83D\uDCC1"}</span>
                <span style={{ fontSize: 14 }}>Kunden in der Ordnerstruktur auswaehlen</span>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: s.textMuted, gap: 10 }}>
                <span style={{ fontSize: 36 }}>{"\uD83D\uDCC2"}</span>
                <span style={{ fontSize: 13 }}>Keine Dokumente in diesem Ordner</span>
              </div>
            ) : viewMode === "abschluss" ? (
              /* ── Abschluss-View: Tag-Ordner ── */
              abschlussTree.map(({ tag: parent, children }) => {
                const isParentOpen = openFolders.has(parent.id);
                const totalDocs = [...children.values()].reduce((s, c) => s + c.docs.length, 0);
                const pColor = parent.color || accent;
                return (
                  <div key={parent.id}>
                    {/* Parent-Ordner */}
                    <div
                      onClick={() => setOpenFolders(f => { const n = new Set(f); n.has(parent.id) ? n.delete(parent.id) : n.add(parent.id); return n; })}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px",
                        borderBottom: "1px solid " + border + "66", cursor: "pointer",
                        background: isParentOpen ? pColor + "10" : "transparent", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = isParentOpen ? pColor + "15" : s.rowHover}
                      onMouseLeave={e => e.currentTarget.style.background = isParentOpen ? pColor + "10" : "transparent"}>
                      {isParentOpen
                        ? <ChevronDown size={14} style={{ color: pColor, flexShrink: 0 }} />
                        : <ChevronRight size={14} style={{ color: s.textMuted, flexShrink: 0 }} />}
                      <span style={{ fontSize: 16, flexShrink: 0 }}>📁</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: s.textMain, flex: 1 }}>{parent.name}</span>
                      <span style={{ fontSize: 11, color: s.textMuted, background: s.inputBg, border: "1px solid " + border,
                        borderRadius: 10, padding: "1px 7px" }}>{totalDocs}</span>
                    </div>
                    {/* Unterordner (Subtags) */}
                    {isParentOpen && [...children.values()]
                      .sort((a, b) => (a.tag.sort_order ?? 999) - (b.tag.sort_order ?? 999))
                      .map(({ tag: child, docs: childDocs }) => {
                        if (child.id === "__direct__" && childDocs.length === 0) return null;
                        const childKey = parent.id + "_" + child.id;
                        const isChildOpen = openFolders.has(childKey);
                        const cColor = child.color || pColor;
                        return (
                          <div key={child.id}>
                            {/* Subtag-Ordner */}
                            <div
                              onClick={() => setOpenFolders(f => { const n = new Set(f); n.has(childKey) ? n.delete(childKey) : n.add(childKey); return n; })}
                              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px 7px 36px",
                                borderBottom: "1px solid " + border + "44", cursor: "pointer",
                                background: isChildOpen ? cColor + "08" : "transparent", transition: "background 0.1s" }}
                              onMouseEnter={e => e.currentTarget.style.background = isChildOpen ? cColor + "12" : s.rowHover}
                              onMouseLeave={e => e.currentTarget.style.background = isChildOpen ? cColor + "08" : "transparent"}>
                              {isChildOpen
                                ? <ChevronDown size={12} style={{ color: cColor, flexShrink: 0 }} />
                                : <ChevronRight size={12} style={{ color: s.textMuted, flexShrink: 0 }} />}
                              <span style={{ fontSize: 14, flexShrink: 0 }}>📂</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: s.textMain, flex: 1 }}>
                                {child.id === "__direct__" ? "" : child.name}
                              </span>
                              <span style={{ fontSize: 10, color: s.textMuted, background: s.inputBg, border: "1px solid " + border,
                                borderRadius: 10, padding: "1px 6px" }}>{childDocs.length}</span>
                            </div>
                            {/* Dateien im Subtag */}
                            {isChildOpen && childDocs.map(doc => {
                              const fi           = getFileInfo(doc.file_type, doc.filename);
                              const isCheckedOut = !!doc.checked_out_by;
                              const isMyCheckout = doc.checked_out_by === user?.id;
                              const lockedByOther= isCheckedOut && !isMyCheckout;
                              const isAdmin      = user?.role === 'admin';
                              return (
                                <div key={doc.id} {...fileDropProps(doc)}
                                  title="Neue Datei hierher ziehen = als neue Version ablegen"
                                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px 6px 54px",
                                    borderBottom: "1px solid " + border + "33", transition: "background 0.1s", opacity: replacingId === doc.id ? 0.5 : 1,
                                    ...(doc.id === dropTargetId ? { boxShadow: "0 0 0 2px #10b981 inset", background: "#10b98114", borderRadius: 6 } : {}) }}
                                  onMouseEnter={e => { if (doc.id !== dropTargetId) e.currentTarget.style.background = s.rowHover; }}
                                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                  <span onClick={() => { const _u = doc.sharepoint_web_url || signedUrls[doc.id]; if (!doc.checked_out_by) { handleCheckout(doc); } else if (doc.checked_out_by === user?.id) { openCheckin(doc); } else if (_u) { window.open(_u, '_blank'); } else { toast.error('URL nicht verfügbar.'); } }}
                                    style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 10,
                                      fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center", cursor: "pointer" }}>{fi.label}</span>
                                  <div onClick={() => { const _u = doc.sharepoint_web_url || signedUrls[doc.id]; if (!doc.checked_out_by) { handleCheckout(doc); } else if (doc.checked_out_by === user?.id) { openCheckin(doc); } else if (_u) { window.open(_u, '_blank'); } else { toast.error('URL nicht verfügbar.'); } }}
                                    style={{ flex: 1, minWidth: 0, fontSize: 12, color: s.textMain, overflow: "hidden",
                                      textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", fontWeight: 500 }}>{doc.name}</div>
                                  {isCheckedOut && (
                                    <span style={{ fontSize: 10, color: isMyCheckout ? accent : "#f59e0b",
                                      background: isMyCheckout ? accent + "18" : "#f59e0b18",
                                      border: "1px solid " + (isMyCheckout ? accent + "44" : "#f59e0b44"),
                                      borderRadius: 8, padding: "1px 6px", flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>
                                      <Lock size={9} />{isMyCheckout ? "Ich" : doc.checked_out_by_name}
                                    </span>
                                  )}
                                  {doc.year && <span style={{ fontSize: 10, color: s.textMuted, flexShrink: 0 }}>{doc.year}</span>}
                                  <span style={{ fontSize: 10, color: s.textMuted, flexShrink: 0 }}>{formatBytes(doc.file_size)}</span>
                                  {doc.created_at && (
                                    <span title={"Hochgeladen: " + new Date(doc.created_at).toLocaleString("de-CH")}
                                      style={{ fontSize: 10, color: s.textMuted, flexShrink: 0, whiteSpace: "nowrap", minWidth: 50, textAlign: "right" }}>
                                      {new Date(doc.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                                    </span>
                                  )}
                                  {!isCheckedOut && <button onClick={() => handleCheckout(doc)} title="Auschecken" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><LockOpen size={13} /></button>}
                                  {isMyCheckout && <button onClick={() => openCheckin(doc)} title="Einchecken" style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><Lock size={13} /></button>}
                                  {lockedByOther && isAdmin && <button onClick={() => handleCheckin(doc, null)} title="Sperre aufheben" style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><ShieldAlert size={13} /></button>}
                                  <button onClick={() => setEditDoc(doc)} title="Bearbeiten" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><Pencil size={13} /></button>
                                  <button onClick={() => setCopyDoc(doc)} title="Kopieren (neu verschlagworten)" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><CopyPlus size={13} /></button>
                                  {renderPreviewEye(doc)}
                                  <button onClick={() => setVersionsDoc(doc)} title="Versionsverlauf" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><HistoryIcon size={13} /></button>
                                  <button onClick={() => { animateBtn(`dl-${doc.id}`); downloadDoc(doc); }} title="Herunterladen" style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0, transition: "transform 0.15s", transform: clickedBtns[`dl-${doc.id}`] ? "scale(0.75)" : "scale(1)" }}><Download size={14} /></button>
                                  <button onClick={() => { animateBtn(`sh-${doc.id}`); setShareDialog({ type: 'doc', doc_id: doc.id, name: doc.name, customer_id: doc.customer_id }); }} title="Link erstellen" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><Link2 size={14} /></button>
                                  <button onClick={() => !lockedByOther && handleDelete(doc)} title={lockedByOther ? "Gesperrt" : "Löschen"} style={{ background: "none", border: "none", cursor: lockedByOther ? "not-allowed" : "pointer", color: lockedByOther ? s.textMuted + "44" : "#ef4444", display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><Trash2 size={14} /></button>
                                  <button onClick={() => setChartisDoc(doc)} title="Chartis – Chat zu diesem Dokument" style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}><MessageSquare size={14} /></button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                  </div>
                );
              })
            ) : (
              /* ── Normal-View ── */
              filtered.map(doc => renderDocRow(doc))
            )}
          </div>
        </div>
      </div>
      )}


      {/* Dialoge */}
      {showUpload && (
        <UploadDialog customers={customers} preCustomer={selCustomer} preFile={dropFile} allTags={allTags}
          onCancel={() => { setShowUpload(false); setDropFile(null); if (inboxPath) { supabase.storage.from(BUCKET).remove([inboxPath]).catch(() => {}); setInboxPath(null); } }}
          onUpload={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); setShowUpload(false); setDropFile(null); if (inboxPath) { supabase.storage.from(BUCKET).remove([inboxPath]).catch(() => {}); setInboxPath(null); } }}
          s={s} border={border} accent={accent} />
      )}
      {showBatch && (
        <BatchUploadDialog
          preCustomerId={selCustomerId}
          onClose={() => setShowBatch(false)}
        />
      )}
      {versionsDoc && (
        <VersionsDialog doc={versionsDoc} onClose={() => setVersionsDoc(null)} />
      )}
      {hoverPreview && (
        <DocHoverPreview
          doc={hoverPreview.doc}
          url={hoverPreview.url}
          rect={hoverPreview.rect}
          theme={theme}
          onClose={() => setHoverPreview(null)}
        />
      )}
      {copyDoc && (
        <EditDialog doc={copyDoc} allTags={allTags} customers={customers}
          mode="copy"
          onCancel={() => setCopyDoc(null)}
          onSave={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); setCopyDoc(null); }}
          s={s} border={border} accent={accent} />
      )}
      {editDoc && (
        <EditDialog doc={editDoc} allTags={allTags} customers={customers}
          onCancel={() => setEditDoc(null)}
          onSave={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });  setEditDoc(null); }}
          s={s} border={border} accent={accent} />
      )}
      {/* Chartis – Chat-Panel pro Dokument (Slide-over rechts) */}
      {chartisDoc && (
        <>
          <div onClick={() => setChartisDoc(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 70 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, maxWidth: "92vw", zIndex: 71, boxShadow: "-8px 0 30px rgba(0,0,0,0.18)", borderLeft: `1px solid ${border}` }}>
            <ChartisPanel
              module="dokument"
              recordId={chartisDoc.id}
              subject={chartisDoc.name}
              docInfo={{ filename: chartisDoc.filename, onOpen: () => downloadDoc(chartisDoc) }}
              extContactEmail={customers.find(c => c.id === chartisDoc.customer_id)?.email}
              onClose={() => setChartisDoc(null)}
            />
          </div>
        </>
      )}

      {/* CheckinDialog ersetzt durch direktes handleCheckin */}

      {/* Share-Link Dialog */}
      {shareDialog && (
        <ShareLinkDialog
          info={shareDialog}
          accent={accent}
          s={s}
          border={border}
          onClose={() => setShareDialog(null)}
        />
      )}

      {/* Share-Links Übersicht */}
      {showShareLinks && (
        <ShareLinksOverview
          accent={accent}
          s={s}
          border={border}
          onClose={() => setShowShareLinks(false)}
        />
      )}
    </div>
  );
}
