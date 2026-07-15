import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ShieldCheck, Mail, Search, Folder, Calendar, Tag as TagIcon, Eye, Download,
  LogOut, Loader2, CheckCircle2, AlertCircle, FileText, ChevronRight, Lock, Archive, X, Upload,
  MessageSquare, Send,
} from "lucide-react";
import JSZip from "jszip";
import './styles.css';
import {functions} from "../../api/supabaseClient.js";
import {CATEGORIES} from "../../lib/categories.js";

async function callPortal(action, payload = {}) {
  const session = localStorage.getItem("portal_session") || undefined;
  const {data, error} = await functions.invoke('portal-api', {
    method: "POST",
    body: { action, session, ...payload },
    appUrl: window.env.HOSTNAME
  });

  if (error) throw new Error(error || "Verbindung fehlgeschlagen.");
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
// Antworten kommen als E-Mail-HTML — für die Blase auf reinen Text reduzieren
function stripHtml(html) {
  if (!html) return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
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
  const [upload, setUpload] = useState(null);      // { busy, done, total, ok, msg }
  const fileInputRef = useRef(null);

  // Chat (Chartis) — nur email_in/email_out, nie interne Notizen
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef(null);

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

  // Datei(en) an den Posteingang des Mandanten hochladen (base64 → portal-api)
  const MAX_UPLOAD = 8 * 1024 * 1024;
  const fileToB64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const tooBig = files.find(f => f.size > MAX_UPLOAD);
    if (tooBig) { setUpload({ ok: false, msg: `„${tooBig.name}" ist zu gross (max. 8 MB).` }); return; }
    setUpload({ busy: true, done: 0, total: files.length, msg: "Wird übermittelt…" });
    let done = 0, failed = 0;
    for (const file of files) {
      try {
        const data = await fileToB64(file);
        await callPortal("upload", { filename: file.name, content_type: file.type, data });
      } catch { failed++; }
      done++; setUpload(u => u && ({ ...u, done }));
    }
    setUpload({ ok: failed === 0, msg: failed === 0
      ? `${files.length} Datei${files.length > 1 ? "en" : ""} an Ihre Treuhänderin übermittelt.`
      : `${files.length - failed} von ${files.length} übermittelt, ${failed} fehlgeschlagen.` });
    setTimeout(() => setUpload(u => (u && u.busy ? u : null)), 6000);
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  const loadChat = useCallback(async () => {
    setChatLoading(true);
    try {
      const data = await callPortal("chat-list");
      setChatMsgs(data.messages || []);
    } catch (e) { setError(e.message); }
    finally { setChatLoading(false); }
  }, []);

  useEffect(() => { if (chatOpen) loadChat(); }, [chatOpen, loadChat]);
  useEffect(() => { if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs, chatOpen]);

  async function sendChat() {
    const text = chatText.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    try {
      await callPortal("chat-send", { text });
      setChatText("");
      await loadChat();
    } catch (e) { setError(e.message); }
    finally { setChatBusy(false); }
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
      <div className="pp">
        <div className="loadwrap"><Loader2 size={26} className="animate-spin" /><span>Einen Moment…</span></div>
      </div>
    );
  }

  if (phase === "login" || phase === "sent") {
    return (
      <div className="pp">
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
    <div className="pp">
      <div className="topbar">
        <span className="mk"><ShieldCheck size={20} style={{ color: "var(--accent)" }} /> Smartis <span className="badge">Kundenportal</span></span>
        <div className="who">
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
            onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
          <button className="ghost" title="Nachricht an Ihre Treuhänderin"
            onClick={() => setChatOpen(true)}>
            <MessageSquare size={16} /> Nachrichten
          </button>
          <button className="pbtn" title="Dokumente an Ihre Treuhänderin senden"
            disabled={upload?.busy} onClick={() => fileInputRef.current?.click()}>
            {upload?.busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Hochladen
          </button>
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

      {/* Nachrichten (Chat) */}
      {chatOpen && (
        <div className="overlay" onClick={e => { if (e.target.classList.contains("overlay")) setChatOpen(false); }}>
          <div className="chatpane">
            <div className="mhead">
              <MessageSquare size={18} style={{ color: "var(--accent)" }} />
              <div className="t" style={{ minWidth: 0 }}>
                <b style={{ display: "block", fontSize: 15, fontWeight: 600 }}>Nachrichten</b>
                <small style={{ color: "var(--faint)", fontSize: 12.5 }}>mit {customerName}s Treuhänderin</small>
              </div>
              <button className="closebtn" style={{ marginLeft: "auto" }} onClick={() => setChatOpen(false)}><X size={18} /></button>
            </div>

            <div className="chatbody">
              {chatLoading ? (
                <div className="empty"><Loader2 size={20} className="animate-spin" /></div>
              ) : chatMsgs.length === 0 ? (
                <div className="empty" style={{ padding: "40px 20px" }}>
                  <MessageSquare size={34} style={{ color: "var(--faint)" }} />
                  <p style={{ margin: "12px 0 4px", fontWeight: 600, color: "var(--ink)" }}>Noch keine Nachrichten</p>
                  <p style={{ margin: 0, fontSize: 13.5 }}>Schreiben Sie uns — wir antworten hier im Portal.</p>
                </div>
              ) : chatMsgs.map(m => {
                const mine = m.kind === "email_in";
                return (
                  <div key={m.id} className={"bubblerow" + (mine ? " mine" : "")}>
                    <div className={"bubble" + (mine ? " mine" : "")}>
                      <div className="who2">{mine ? "Sie" : "Artis Treuhand"}</div>
                      <div className="txt">{m.body_text || stripHtml(m.body_html)}</div>
                      <div className="when">{fmtWhen(m.created_at)}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            <div className="chatfoot">
              <textarea className="chatinput" rows={2} value={chatText} placeholder="Nachricht schreiben…"
                onChange={e => setChatText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }} />
              <button className="pbtn" disabled={chatBusy || !chatText.trim()} onClick={sendChat}>
                {chatBusy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Senden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload-Status */}
      {upload && (
        <div className="ziptoast">
          {upload.busy
            ? <Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)", flex: "none" }} />
            : upload.ok
              ? <CheckCircle2 size={18} style={{ color: "var(--accent)", flex: "none" }} />
              : <AlertCircle size={18} style={{ color: "var(--danger)", flex: "none" }} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{upload.msg}</div>
            {upload.busy && (
              <div style={{ height: 5, background: "var(--surface3)", borderRadius: 3, marginTop: 7, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${upload.total ? Math.round((upload.done / upload.total) * 100) : 0}%`, background: "var(--accent)", transition: "width .2s" }} />
              </div>
            )}
          </div>
          {!upload.busy && <button className="closebtn" style={{ width: 28, height: 28 }} onClick={() => setUpload(null)}><X size={16} /></button>}
        </div>
      )}
    </div>
  );
}
