import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ShieldCheck, Mail, Search, Folder, Calendar, Tag as TagIcon, Eye, Download,
  LogOut, Loader2, CheckCircle2, AlertCircle, FileText, ChevronRight, Lock, Archive, X,
} from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import JSZip from "jszip";

const API = `${window.env.API_URL}/functions/v1/portal-api`;
const ANON = window.env.KEY1;
const SESSION_KEY = "portal_session";

async function callPortal(action, payload = {}) {
  const session = localStorage.getItem(SESSION_KEY) || undefined;
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ action, session, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Verbindung fehlgeschlagen.");
  return data;
}

function fmtBytes(b) {
  if (!b) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}
function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function catLabel(key) {
  const c = CATEGORIES.find(x => x.key === key);
  return c ? c.label : (key || "Weitere");
}
function fileKind(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx", "xlsm", "csv"].includes(ext)) return "xls";
  if (["doc", "docx"].includes(ext)) return "doc";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "img";
  return "file";
}

const CSS = `
.pp{--bg:#eef1f0;--surface:#fff;--surface2:#f6f8f7;--surface3:#eef2f0;--ink:#132420;--muted:#5c6c67;
  --faint:#8b9994;--line:#e1e6e4;--accent:#0e756a;--accentStrong:#0a544c;--accentSoft:#dceeea;--accentInk:#0a544c;
  --danger:#bb4438;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--ink);background:var(--bg);min-height:100vh}
@media (prefers-color-scheme:dark){.pp{--bg:#0c1211;--surface:#141d1b;--surface2:#101816;--surface3:#182220;
  --ink:#e9efed;--muted:#93a39e;--faint:#6d7d78;--line:#232e2b;--accent:#46b6a8;--accentStrong:#74d2c5;
  --accentSoft:#153230;--accentInk:#8fe0d4;--danger:#e0796d}}
.pp *{box-sizing:border-box}
.pp .center{max-width:none;margin:0;padding:0 24px}
.pp .topbar{display:flex;align-items:center;gap:12px;padding:14px 18px;background:var(--surface);border-bottom:1px solid var(--line)}
.pp .mk{font-weight:600;font-size:17px;display:flex;align-items:center;gap:9px}
.pp .mk .badge{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--accentInk);
  background:var(--accentSoft);padding:3px 8px;border-radius:6px;font-weight:600}
.pp .who{margin-left:auto;display:flex;align-items:center;gap:11px}
.pp .avatar{width:34px;height:34px;border-radius:50%;background:var(--accentSoft);color:var(--accentInk);
  display:grid;place-items:center;font-weight:600;font-size:13px}
.pp .nm{font-size:13.5px;line-height:1.25;text-align:right}
.pp .nm small{display:block;color:var(--faint);font-size:12px}
.pp .ghost{border:1px solid var(--line);background:var(--surface2);color:var(--muted);border-radius:8px;
  padding:8px 12px;font-size:13px;font-weight:500;display:inline-flex;gap:7px;align-items:center;cursor:pointer}
.pp .ghost:hover{color:var(--ink)}
.pp .cols{display:grid;grid-template-columns:250px 1fr;gap:0;background:var(--surface);border:1px solid var(--line);
  border-radius:14px;overflow:hidden;margin:22px 0 60px}
.pp .side{border-right:1px solid var(--line);background:var(--surface2);padding:16px 12px;min-height:520px}
.pp .lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:600;padding:4px 10px;margin-bottom:4px}
.pp .node{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:var(--muted);font-size:14px;
  border:0;background:transparent;width:100%;text-align:left;cursor:pointer}
.pp .node .ct{margin-left:auto;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.pp .node:hover{background:var(--surface3);color:var(--ink)}
.pp .node.sel{background:var(--accentSoft);color:var(--accentInk);font-weight:600}
.pp .node.sel .ct{color:var(--accentInk)}
.pp .years{display:flex;flex-direction:column;gap:1px;margin:1px 0 4px 26px;border-left:1px solid var(--line);padding-left:6px}
.pp .ynode{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;color:var(--muted);font-size:13px;
  border:0;background:transparent;width:100%;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums}
.pp .ynode .ct{margin-left:auto;font-size:11.5px;color:var(--faint)}
.pp .ynode:hover{background:var(--surface3);color:var(--ink)}
.pp .ynode.sel{color:var(--accentInk);font-weight:600}
.pp .main{padding:20px 22px;min-width:0}
.pp .crumbs{display:flex;align-items:center;gap:7px;color:var(--faint);font-size:13px;margin-bottom:14px;flex-wrap:wrap}
.pp .crumbs b{color:var(--ink);font-weight:600}
.pp .toolbar{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.pp .search{flex:1;min-width:200px;position:relative}
.pp .search input{width:100%;border:1px solid var(--line);background:var(--surface2);color:var(--ink);border-radius:9px;
  padding:10px 12px 10px 38px;font-size:14px;font-family:inherit;outline:none}
.pp .search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accentSoft)}
.pp .search .si{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--faint)}
.pp .readonly{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--muted);
  background:var(--surface2);border:1px solid var(--line);padding:8px 12px;border-radius:8px}
.pp .readonly svg{color:var(--accent)}
.pp .chiprow{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.pp .chiplbl{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint)}
.pp .chip{border:1px solid var(--line);background:var(--surface2);color:var(--muted);border-radius:20px;padding:5px 12px;
  font-size:13px;font-weight:500;cursor:pointer;font-family:inherit}
.pp .chip:hover{border-color:var(--accent);color:var(--accentInk)}
.pp .chip.on{background:var(--accentSoft);border-color:var(--accent);color:var(--accentInk);font-weight:600}
.pp .flist{border:1px solid var(--line);border-radius:12px;overflow:hidden}
.pp .frow{display:grid;grid-template-columns:1fr 120px 88px auto;align-items:center;gap:14px;padding:13px 16px;
  border-bottom:1px solid var(--line);background:var(--surface)}
.pp .frow:last-child{border-bottom:0}
.pp .frow.head{background:var(--surface2);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:600;padding:10px 16px}
.pp .frow:not(.head):hover{background:var(--surface2)}
.pp .fname{display:flex;align-items:center;gap:12px;min-width:0}
.pp .ftag{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;flex:none;background:var(--surface3);color:var(--muted)}
.pp .ftag.pdf{background:#fbe9e6;color:#bb4438}.pp .ftag.xls{background:#e4f2ea;color:#2f8f5b}.pp .ftag.doc{background:#e6eefb;color:#2f5fa5}
@media (prefers-color-scheme:dark){.pp .ftag.pdf{background:#2c1613;color:#e0796d}.pp .ftag.xls{background:#12251c;color:#57b483}.pp .ftag.doc{background:#101d2e;color:#7ba7dd}}
.pp .fname .t{min-width:0}
.pp .fname .t b{display:block;font-weight:500;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp .fname .t small{color:var(--faint);font-size:12.5px}
.pp .fmeta{font-size:13.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.pp .facts{display:flex;gap:6px;justify-content:flex-end}
.pp .iconbtn{width:34px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--surface2);color:var(--muted);
  display:grid;place-items:center;cursor:pointer}
.pp .iconbtn:hover{color:var(--accentInk);border-color:var(--accent);background:var(--accentSoft)}
.pp .iconbtn:disabled{opacity:.5;cursor:default}
.pp .empty{padding:40px 16px;text-align:center;color:var(--faint);font-size:14px}
/* Login */
.pp .lwrap{min-height:100vh;display:grid;place-items:center;padding:24px}
.pp .lcard{width:min(440px,100%);background:var(--surface);border:1px solid var(--line);border-radius:16px;
  padding:38px 34px;box-shadow:0 10px 40px rgba(19,36,32,.08)}
.pp .lcard .mk{font-size:20px;margin-bottom:6px}
.pp .lcard h1{font-size:22px;font-weight:600;margin:14px 0 6px}
.pp .lcard p.sub{color:var(--muted);font-size:14px;margin:0 0 20px;line-height:1.5}
.pp .fld{font-size:13px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px}
.pp .input{width:100%;border:1px solid var(--line);background:var(--surface2);color:var(--ink);border-radius:9px;
  padding:12px 13px;font-size:15px;font-family:inherit;outline:none}
.pp .input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accentSoft)}
.pp .btn{width:100%;margin-top:16px;border:0;border-radius:9px;padding:13px 16px;font-size:15px;font-weight:600;
  background:var(--accent);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px}
.pp .btn:hover{background:var(--accentStrong)}
.pp .btn:disabled{opacity:.7;cursor:default}
.pp .hint{margin-top:14px;font-size:12.5px;color:var(--faint);display:flex;gap:8px;line-height:1.5}
.pp .hint svg{color:var(--accent);flex:none;margin-top:1px}
.pp .sent{margin-top:16px;background:var(--accentSoft);border:1px solid var(--accent);border-radius:10px;
  padding:14px 15px;display:flex;gap:11px;align-items:flex-start}
.pp .sent svg{color:var(--accent);flex:none;margin-top:1px}
.pp .sent b{display:block;margin-bottom:2px}.pp .sent span{color:var(--muted);font-size:13.5px}
.pp .errbox{margin-top:16px;background:#fbe9e6;border:1px solid var(--danger);color:var(--danger);border-radius:10px;
  padding:12px 14px;font-size:13.5px;display:flex;gap:9px;align-items:flex-start}
@media (prefers-color-scheme:dark){.pp .errbox{background:#2c1613}}
.pp .pbtn{border:0;border-radius:8px;padding:9px 13px;font-size:13.5px;font-weight:600;background:var(--accent);color:#fff;
  cursor:pointer;display:inline-flex;align-items:center;gap:7px;font-family:inherit;white-space:nowrap}
.pp .pbtn:hover{background:var(--accentStrong)}
.pp .pbtn:disabled{opacity:.6;cursor:default}
.pp .overlay{position:fixed;inset:0;background:rgba(10,20,18,.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:24px}
.pp .modal{width:min(940px,100%);height:min(88vh,920px);background:var(--surface);border-radius:14px;overflow:hidden;
  display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.42)}
.pp .mhead{display:flex;align-items:center;gap:12px;padding:13px 16px;border-bottom:1px solid var(--line)}
.pp .mbody{flex:1;background:var(--surface2);overflow:auto;display:flex;align-items:center;justify-content:center}
.pp .mbody iframe{width:100%;height:100%;border:0;background:#fff}
.pp .mbody img{max-width:100%;max-height:100%;object-fit:contain}
.pp .fallback{text-align:center;padding:40px 24px}
.pp .closebtn{width:36px;height:36px;border-radius:8px;border:0;background:transparent;color:var(--muted);
  display:grid;place-items:center;cursor:pointer}
.pp .closebtn:hover{background:var(--surface2);color:var(--ink)}
.pp .ziptoast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--line);
  border-radius:12px;padding:13px 18px;box-shadow:0 14px 40px rgba(0,0,0,.22);display:flex;gap:12px;align-items:center;z-index:90;width:min(340px,90vw)}
.pp .loadwrap{min-height:100vh;display:grid;place-items:center;color:var(--muted);gap:12px}
@media (max-width:720px){.pp .cols{grid-template-columns:1fr}.pp .side{display:none}.pp .frow{grid-template-columns:1fr auto}.pp .fmeta{display:none}}
`;

export default function Portal() {
  const [phase, setPhase] = useState("boot"); // boot|login|sent|loading|docs|error
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [docs, setDocs] = useState([]);
  const [tagMap, setTagMap] = useState({});
  const [busy, setBusy] = useState({});
  const [preview, setPreview] = useState(null);   // { doc, url, kind }
  const [zip, setZip] = useState(null);            // { done, total, label }

  const [selCat, setSelCat] = useState(null);
  const [selYear, setSelYear] = useState(null);
  const [selTag, setSelTag] = useState(null);
  const [q, setQ] = useState("");

  const loadDocs = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await callPortal("list");
      setDocs(data.docs || []);
      setTagMap(data.tags || {});
      setCustomerName(data.customer_name || "");
      setUser(u => u || data.user);
      setPhase("docs");
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
      setPhase("login");
      setError(e.message);
    }
  }, []);

  // Boot: Token aus URL einlösen, sonst bestehende Session, sonst Login
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) {
      setPhase("loading");
      callPortal("verify", { token })
        .then(data => {
          localStorage.setItem(SESSION_KEY, data.session);
          setUser(data.user);
          setCustomerName(data.user?.customer_name || "");
          window.history.replaceState({}, "", window.location.pathname);
          loadDocs();
        })
        .catch(e => { setError(e.message); setPhase("login"); });
    } else if (localStorage.getItem(SESSION_KEY)) {
      loadDocs();
    } else {
      setPhase("login");
    }
  }, [loadDocs]);

  async function requestLink() {
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setError("Bitte eine gültige E-Mail-Adresse eingeben."); return; }
    setSending(true); setError("");
    try {
      await callPortal("request-link", { email: em });
      setPhase("sent");
    } catch (e) { setError(e.message); } finally { setSending(false); }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setUser(null); setDocs([]); setPhase("login"); setEmail("");
  }

  // Ansehen → Vorschau-Modal (PDF/Bild inline; sonst Download-Hinweis)
  async function openPreview(doc) {
    const kind = fileKind(doc.filename || doc.name);
    if (kind !== "pdf" && kind !== "img") { setPreview({ doc, url: null, kind }); return; }
    setBusy(b => ({ ...b, [doc.id]: true }));
    try {
      const { url } = await callPortal("download", { doc_id: doc.id, mode: "view" });
      setPreview({ doc, url, kind });
    } catch (e) { setError(e.message); }
    finally { setBusy(b => ({ ...b, [doc.id]: false })); }
  }

  // Einzeldatei herunterladen. Die Signed-URL trägt bereits
  // Content-Disposition: attachment → direktes Laden per verstecktem iframe
  // vermeidet Cross-Origin-fetch (Datei liegt auf supabase.co, Portal auf smartis.me).
  async function downloadOne(doc) {
    setBusy(b => ({ ...b, [doc.id]: true }));
    try {
      const { url } = await callPortal("download", { doc_id: doc.id, mode: "download" });
      if (!url) throw new Error("Kein Download-Link erhalten.");
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 60000);
    } catch (e) { setError(e.message); }
    finally { setBusy(b => ({ ...b, [doc.id]: false })); }
  }

  // Alle sichtbaren Dokumente als ZIP (Ordner: Kategorie/Jahr/Datei), 4er-Pool
  async function downloadZip(list, zipName) {
    if (!list.length) return;
    setZip({ done: 0, total: list.length, label: "Sammle Dateien…" });
    const archive = new JSZip();
    const safe = s => (s || "").replace(/[\\/:*?"<>|]/g, "_").trim() || "_";
    let done = 0;
    const fetchOne = async (doc) => {
      try {
        const { url } = await callPortal("download", { doc_id: doc.id, mode: "download" });
        const r = await fetch(url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const blob = await r.blob();
        const cat = safe(catLabel(doc.category));
        const year = doc.year || "Ohne Jahr";
        archive.file(`${cat}/${year}/${safe(doc.filename || doc.name || "datei")}`, blob);
      } catch { /* einzelne Ausfälle überspringen */ }
      finally { done++; setZip(z => z && ({ ...z, done, label: `${done} / ${list.length} geladen…` })); }
    };
    const queue = [...list];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) { const d = queue.shift(); if (d) await fetchOne(d); }
    }));
    setZip(z => z && ({ ...z, label: "Erstelle ZIP…" }));
    const blob = await archive.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 5 } });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (safe(zipName) || "dokumente") + ".zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setZip(null);
  }

  // Ableitungen für die Doku-Ansicht
  const cats = useMemo(() => {
    const known = CATEGORIES.map(c => c.key);
    const present = [...new Set(docs.map(d => d.category))];
    const ordered = [...CATEGORIES.map(c => c.key), ...present.filter(k => !known.includes(k))];
    return ordered
      .filter(k => docs.some(d => d.category === k))
      .map(k => ({ key: k, count: docs.filter(d => d.category === k).length }));
  }, [docs]);

  useEffect(() => {
    if (phase === "docs" && !selCat && cats.length) setSelCat(cats[0].key);
  }, [phase, cats, selCat]);

  const years = useMemo(() => {
    if (!selCat) return [];
    return [...new Set(docs.filter(d => d.category === selCat).map(d => d.year).filter(Boolean))].sort((a, b) => b - a);
  }, [docs, selCat]);

  useEffect(() => { setSelYear(years[0] ?? null); setSelTag(null); }, [selCat]); // eslint-disable-line

  const catTags = useMemo(() => {
    const ids = [...new Set(docs.filter(d => d.category === selCat).flatMap(d => d.tag_ids || []))];
    return ids.map(id => ({ id, name: tagMap[id] || "Tag" })).filter(t => t.name).sort((a, b) => a.name.localeCompare(b.name));
  }, [docs, selCat, tagMap]);

  const visibleDocs = useMemo(() => {
    let list = docs.filter(d => d.category === selCat && (selYear == null || d.year === selYear));
    if (selTag) list = list.filter(d => (d.tag_ids || []).includes(selTag));
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(d => `${d.name} ${d.filename}`.toLowerCase().includes(s));
    }
    return list;
  }, [docs, selCat, selYear, selTag, q]);

  // ── Rendering ─────────────────────────────────────────────────────────────
  if (phase === "boot" || phase === "loading") {
    return (
      <div className="pp"><style>{CSS}</style>
        <div className="loadwrap"><Loader2 size={26} className="animate-spin" /><span>Einen Moment…</span></div>
      </div>
    );
  }

  if (phase === "login" || phase === "sent") {
    return (
      <div className="pp"><style>{CSS}</style>
        <div className="lwrap">
          <div className="lcard">
            <div className="mk"><ShieldCheck size={22} style={{ color: "var(--accent)" }} /> Smartis <span style={{ color: "var(--muted)", fontWeight: 400 }}>· Kundenportal</span></div>
            {phase === "sent" ? (
              <>
                <h1>Postfach prüfen</h1>
                <p className="sub">Wir haben Ihnen einen Anmeldelink geschickt — sofern für diese Adresse ein Zugang besteht.</p>
                <div className="sent"><CheckCircle2 size={20} /><div><b>Link gesendet</b><span>Öffnen Sie die E-Mail und klicken Sie auf „Jetzt anmelden". Der Link ist 15 Minuten gültig.</span></div></div>
                <button className="btn" style={{ background: "transparent", color: "var(--accent)", border: "1px solid var(--line)" }} onClick={() => { setPhase("login"); }}>Andere Adresse verwenden</button>
              </>
            ) : (
              <>
                <h1>Anmelden</h1>
                <p className="sub">Geben Sie die E-Mail-Adresse ein, die Ihre Treuhänderin hinterlegt hat. Sie erhalten einen sicheren Anmeldelink — kein Passwort nötig.</p>
                <label className="fld" htmlFor="pmail">E-Mail-Adresse</label>
                <input id="pmail" className="input" type="email" value={email} placeholder="name@firma.ch"
                  onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && requestLink()} />
                <button className="btn" onClick={requestLink} disabled={sending}>
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />} Anmeldelink senden
                </button>
                <div className="hint"><Lock size={15} /> Ihre Dokumente sind geschützt. Sie können sie ausschliesslich ansehen und herunterladen.</div>
                {error && <div className="errbox"><AlertCircle size={17} />{error}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // phase === "docs"
  return (
    <div className="pp"><style>{CSS}</style>
      <div className="topbar">
        <span className="mk"><ShieldCheck size={20} style={{ color: "var(--accent)" }} /> Smartis <span className="badge">Kundenportal</span></span>
        <div className="who">
          <div className="nm">{customerName}<small>angemeldet als {user?.vorname} {user?.nachname}</small></div>
          <div className="avatar">{((user?.vorname?.[0] || "") + (user?.nachname?.[0] || "")).toUpperCase()}</div>
          <button className="ghost" onClick={logout}><LogOut size={16} /> Abmelden</button>
        </div>
      </div>

      <div className="center">
        <div className="cols">
          <aside className="side">
            <div className="lbl">Kategorien</div>
            <div>
              {cats.length === 0 && <div className="empty" style={{ padding: "18px 10px" }}>Keine Dokumente.</div>}
              {cats.map(c => (
                <div key={c.key}>
                  <button className={"node" + (c.key === selCat ? " sel" : "")} onClick={() => setSelCat(c.key)}>
                    <Folder size={17} /> {catLabel(c.key)} <span className="ct">{c.count}</span>
                  </button>
                  {c.key === selCat && years.length > 0 && (
                    <div className="years">
                      {years.map(y => (
                        <button key={y} className={"ynode" + (y === selYear ? " sel" : "")} onClick={() => setSelYear(y)}>
                          <Calendar size={14} /> {y}
                          <span className="ct">{docs.filter(d => d.category === selCat && d.year === y).length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </aside>

          <div className="main">
            <div className="crumbs">
              {customerName} <ChevronRight size={14} /> <b>{selCat ? catLabel(selCat) : "—"}</b>
              {selYear != null && <><ChevronRight size={14} /> <span style={{ color: "var(--muted)" }}>{selYear}</span></>}
            </div>
            <div className="toolbar">
              <div className="search"><Search size={17} className="si" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="In Dokumenten suchen…" /></div>
              {visibleDocs.length > 1 && (
                <button className="pbtn" title="Alle sichtbaren Dokumente als ZIP" disabled={!!zip}
                  onClick={() => downloadZip(visibleDocs, `${customerName} ${selCat ? catLabel(selCat) : ""} ${selYear ?? ""}`.trim())}>
                  <Archive size={16} /> Alle ({visibleDocs.length})
                </button>
              )}
              <span className="readonly"><Lock size={15} /> Nur Ansehen &amp; Download</span>
            </div>
            {catTags.length > 0 && (
              <div className="chiprow">
                <span className="chiplbl"><TagIcon size={14} /> Tags</span>
                <button className={"chip" + (selTag ? "" : " on")} onClick={() => setSelTag(null)}>Alle</button>
                {catTags.map(t => (
                  <button key={t.id} className={"chip" + (selTag === t.id ? " on" : "")} onClick={() => setSelTag(t.id === selTag ? null : t.id)}>{t.name}</button>
                ))}
              </div>
            )}

            <div className="flist">
              <div className="frow head"><span>Name</span><span>Geändert</span><span>Grösse</span><span style={{ textAlign: "right" }}>Aktion</span></div>
              {visibleDocs.length === 0 ? (
                <div className="empty">Keine Dokumente in dieser Auswahl.</div>
              ) : visibleDocs.map(d => {
                const kind = fileKind(d.filename || d.name);
                return (
                  <div className="frow" key={d.id}>
                    <div className="fname">
                      <div className={"ftag " + kind}><FileText size={17} /></div>
                      <div className="t"><b>{d.name || d.filename}</b><small>{(tagMap[(d.tag_ids || [])[0]]) || catLabel(d.category)}</small></div>
                    </div>
                    <div className="fmeta">{fmtDate(d.updated_at || d.created_at)}</div>
                    <div className="fmeta">{fmtBytes(d.file_size)}</div>
                    <div className="facts">
                      <button className="iconbtn" title="Ansehen" disabled={busy[d.id]} onClick={() => openPreview(d)}>
                        {busy[d.id] ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                      </button>
                      <button className="iconbtn" title="Herunterladen" disabled={busy[d.id]} onClick={() => downloadOne(d)}>
                        <Download size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {error && <div className="errbox" style={{ marginTop: 14 }}><AlertCircle size={17} />{error}</div>}
          </div>
        </div>
      </div>

      {/* Vorschau-Modal */}
      {preview && (
        <div className="overlay" onClick={e => { if (e.target.classList.contains("overlay")) setPreview(null); }}>
          <div className="modal">
            <div className="mhead">
              <div className={"ftag " + preview.kind}><FileText size={17} /></div>
              <div className="t" style={{ minWidth: 0 }}>
                <b style={{ display: "block", fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview.doc.name || preview.doc.filename}</b>
                <small style={{ color: "var(--faint)", fontSize: 12.5 }}>{catLabel(preview.doc.category)} · {preview.doc.year || ""} · {fmtBytes(preview.doc.file_size)}</small>
              </div>
              <button className="pbtn" style={{ marginLeft: "auto" }} onClick={() => downloadOne(preview.doc)}><Download size={16} /> Herunterladen</button>
              <button className="closebtn" title="Schliessen" onClick={() => setPreview(null)}><X size={18} /></button>
            </div>
            <div className="mbody">
              {preview.kind === "pdf" && preview.url && <iframe title="Vorschau" src={preview.url} />}
              {preview.kind === "img" && preview.url && <img src={preview.url} alt={preview.doc.name || "Vorschau"} />}
              {(preview.kind !== "pdf" && preview.kind !== "img") && (
                <div className="fallback">
                  <FileText size={40} style={{ color: "var(--faint)" }} />
                  <p style={{ margin: "12px 0 4px", fontWeight: 600 }}>Keine Vorschau möglich</p>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5 }}>Dieser Dateityp kann heruntergeladen werden.</p>
                  <button className="pbtn" style={{ marginTop: 16 }} onClick={() => { downloadOne(preview.doc); setPreview(null); }}><Download size={16} /> Herunterladen</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ZIP-Fortschritt */}
      {zip && (
        <div className="ziptoast">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)", flex: "none" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{zip.label}</div>
            <div style={{ height: 5, background: "var(--surface3)", borderRadius: 3, marginTop: 7, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${zip.total ? Math.round((zip.done / zip.total) * 100) : 0}%`, background: "var(--accent)", transition: "width .2s" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
