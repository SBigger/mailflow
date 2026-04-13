import React, { useState, useEffect, useMemo } from "react";
import { Download, FileText, Folder, AlertCircle, Clock, CheckCircle2, Loader2, ChevronDown, ChevronRight } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SHARE_FN = `${SUPABASE_URL}/functions/v1/share-link`;

import { CATEGORIES } from "@/lib/categories";

function catLabel(key) {
  const c = CATEGORIES.find(x => x.key === key);
  return c ? c.icon + " " + c.label : key || "Ohne Kategorie";
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function getFileIcon(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (ext === "pdf") return { label: "PDF", color: "#dc2626" };
  if (["xls","xlsx","xlsm","csv"].includes(ext)) return { label: "XLS", color: "#16a34a" };
  if (["doc","docx"].includes(ext)) return { label: "DOC", color: "#2563eb" };
  if (["jpg","jpeg","png","gif","webp"].includes(ext)) return { label: "IMG", color: "#7c3aed" };
  if (["zip","rar","7z"].includes(ext)) return { label: "ZIP", color: "#d97706" };
  return { label: ext.toUpperCase() || "FILE", color: "#71717a" };
}

export default function SharePage() {
  const token = new URLSearchParams(window.location.search).get("token")
    || window.location.pathname.split("/share/")[1]?.split("?")[0];

  const [info,          setInfo]          = useState(null);
  const [error,         setError]         = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [downloading,   setDownloading]   = useState({});
  const [pwRequired,    setPwRequired]    = useState(false);
  const [pwInput,       setPwInput]       = useState("");
  const [pwError,       setPwError]       = useState(false);
  const [expanded,      setExpanded]      = useState({});

  function fetchInfo(password = "") {
    if (!token) { setError("Kein Token in der URL gefunden."); setLoading(false); return; }
    const url = `${SHARE_FN}?token=${token}&action=info${password ? "&password=" + encodeURIComponent(password) : ""}`;
    fetch(url, { headers: { apikey: SUPABASE_ANON } })
      .then(r => r.json())
      .then(data => {
        if (data.password_required) { setPwRequired(true); }
        else if (data.error) setError(data.error);
        else setInfo(data);
      })
      .catch(() => setError("Verbindung fehlgeschlagen."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchInfo(); }, [token]);

  function submitPassword() {
    if (!pwInput.trim()) return;
    setPwError(false);
    setLoading(true);
    const url = `${SHARE_FN}?token=${token}&action=info&password=${encodeURIComponent(pwInput.trim())}`;
    fetch(url, { headers: { apikey: SUPABASE_ANON } })
      .then(r => r.json())
      .then(data => {
        if (data.password_required) { setPwError(true); }
        else if (data.error) setError(data.error);
        else setInfo(data);
      })
      .catch(() => setError("Verbindung fehlgeschlagen."))
      .finally(() => setLoading(false));
  }

  async function downloadFile(docId, docName) {
    setDownloading(p => ({ ...p, [docId]: true }));
    try {
      const pwParam = pwInput.trim() ? `&password=${encodeURIComponent(pwInput.trim())}` : "";
      const res = await fetch(`${SHARE_FN}?token=${token}&action=download&doc_id=${docId}${pwParam}`, {
        headers: { apikey: SUPABASE_ANON },
      });
      const data = await res.json();
      if (data.url) {
        const a = document.createElement("a");
        a.href = data.url;
        a.download = docName || "download";
        a.target = "_blank";
        a.click();
      } else {
        alert(data.error || "Download fehlgeschlagen");
      }
    } catch {
      alert("Download fehlgeschlagen");
    } finally {
      setDownloading(p => ({ ...p, [docId]: false }));
    }
  }

  // Dokumente nach Kategorie > Jahr gruppieren
  const tree = useMemo(() => {
    if (!info?.docs?.length) return [];
    const catMap = {};
    for (const doc of info.docs) {
      const ck = doc.category || "__none__";
      if (!catMap[ck]) catMap[ck] = {};
      const yr = doc.year || "Ohne Jahr";
      if (!catMap[ck][yr]) catMap[ck][yr] = [];
      catMap[ck][yr].push(doc);
    }
    // Sortiert nach CATEGORIES-Reihenfolge
    const catOrder = CATEGORIES.map(c => c.key);
    return Object.entries(catMap)
      .sort(([a], [b]) => {
        const ai = catOrder.indexOf(a), bi = catOrder.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(([catKey, years]) => ({
        key: catKey,
        label: catLabel(catKey),
        years: Object.entries(years)
          .sort(([a], [b]) => String(b).localeCompare(String(a)))
          .map(([yr, docs]) => ({ year: yr, docs })),
        totalDocs: Object.values(years).flat().length,
      }));
  }, [info]);

  // Beim Laden alle aufklappen wenn nur 1 Kategorie
  useEffect(() => {
    if (tree.length === 1) {
      setExpanded({ [tree[0].key]: true });
    } else if (tree.length > 0) {
      const all = {};
      tree.forEach(c => { all[c.key] = true; });
      setExpanded(all);
    }
  }, [tree]);

  const needsTree = info?.is_folder && info?.docs?.length > 1 && tree.length > 0;

  const BG    = "#0f172a";
  const CARD  = "#1e293b";
  const ACC   = "#3d7a3d";
  const FG    = "#f1f5f9";
  const FG2   = "#94a3b8";
  const BORD  = "#334155";

  function DocRow({ doc }) {
    const fi = getFileIcon(doc.filename || doc.name);
    const isLoading = downloading[doc.id];
    return (
      <div style={{ background: CARD, border: "1px solid " + BORD, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 32, textAlign: "center" }}>
          {fi.label}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: FG, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {doc.name || doc.filename}
          </div>
          <div style={{ color: FG2, fontSize: 11, marginTop: 1 }}>
            {formatBytes(doc.file_size)}{doc.year ? " \u00b7 " + doc.year : ""}
          </div>
        </div>
        <button
          onClick={() => downloadFile(doc.id, doc.filename || doc.name)}
          disabled={isLoading}
          style={{ background: isLoading ? BORD : ACC, color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", cursor: isLoading ? "default" : "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, flexShrink: 0, transition: "background 0.15s" }}
        >
          {isLoading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Download size={13} />}
          {isLoading ? "..." : "Download"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "0 0 40px 0", fontFamily: "Segoe UI, system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ width: "100%", background: "#1e293b", borderBottom: "1px solid " + BORD, padding: "10px 24px", display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <img src="/artis-logo.png" alt="Artis" style={{ height: 36, borderRadius: 6 }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: FG, fontWeight: 700, fontSize: 15 }}>Artis Treuhand GmbH</div>
          <div style={{ color: FG2, fontSize: 12 }}>Freigegebene Dokumente</div>
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 700, padding: "0 16px" }}>
        {loading && (
          <div style={{ textAlign: "center", color: FG2, padding: 60 }}>
            <Loader2 style={{ width: 32, height: 32, animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
            <div>Lade...</div>
          </div>
        )}

        {error && (
          <div style={{ background: "#450a0a", border: "1px solid #dc2626", borderRadius: 12, padding: 24, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <AlertCircle style={{ color: "#f87171", flexShrink: 0, marginTop: 2 }} size={20} />
            <div>
              <div style={{ color: "#fca5a5", fontWeight: 600, marginBottom: 4 }}>Link nicht verfügbar</div>
              <div style={{ color: "#f87171", fontSize: 14 }}>{error}</div>
            </div>
          </div>
        )}

        {pwRequired && !info && (
          <div style={{ background: CARD, border: "1px solid " + BORD, borderRadius: 12, padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
            <div style={{ color: FG, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Passwort erforderlich</div>
            <div style={{ color: FG2, fontSize: 13, marginBottom: 20 }}>Dieser Link ist passwortgeschützt.</div>
            <input
              type="password"
              value={pwInput}
              onChange={e => setPwInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitPassword()}
              placeholder="Passwort eingeben..."
              style={{ background: "#0f172a", border: "1px solid " + (pwError ? "#ef4444" : BORD), borderRadius: 8, color: FG, padding: "10px 14px", width: "100%", fontSize: 14, outline: "none", marginBottom: 8, boxSizing: "border-box" }}
            />
            {pwError && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>Falsches Passwort</div>}
            <button onClick={submitPassword} style={{ background: ACC, color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontSize: 14, fontWeight: 600, width: "100%" }}>
              Bestätigen
            </button>
          </div>
        )}

        {info && (
          <div>
            {/* Titel-Karte */}
            <div style={{ background: CARD, border: "1px solid " + BORD, borderRadius: 12, padding: 24, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                {info.is_folder
                  ? <Folder style={{ color: ACC }} size={28} />
                  : <FileText style={{ color: ACC }} size={28} />
                }
                <div>
                  <div style={{ color: FG, fontWeight: 700, fontSize: 18 }}>{info.name}</div>
                  {info.customer_name && (
                    <div style={{ color: FG2, fontSize: 13, marginTop: 2 }}>Kunde: {info.customer_name}</div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: FG2, fontSize: 13 }}>
                  <FileText size={14} />
                  {info.docs.length} Datei{info.docs.length !== 1 ? "en" : ""}
                </div>
                {info.download_count > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: FG2, fontSize: 13 }}>
                    <CheckCircle2 size={14} />
                    {info.download_count}× heruntergeladen
                  </div>
                )}
                {info.expires_at ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: FG2, fontSize: 13 }}>
                    <Clock size={14} />
                    Gültig bis {new Date(info.expires_at).toLocaleDateString("de-CH")}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: FG2, fontSize: 13 }}>
                    <Clock size={14} />
                    Permanenter Link
                  </div>
                )}
              </div>
            </div>

            {/* Datei-Liste */}
            {info.docs.length === 0 && (
              <div style={{ textAlign: "center", color: FG2, padding: 40 }}>Keine Dateien in diesem Ordner.</div>
            )}

            {needsTree ? (
              /* Baum-Ansicht nach Kategorie > Jahr */
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tree.map(cat => {
                  const isExp = expanded[cat.key];
                  return (
                    <div key={cat.key}>
                      {/* Kategorie-Header */}
                      <div
                        onClick={() => setExpanded(p => ({ ...p, [cat.key]: !p[cat.key] }))}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: CARD, border: "1px solid " + BORD, borderRadius: 10, cursor: "pointer", userSelect: "none" }}
                      >
                        {isExp ? <ChevronDown size={14} style={{ color: FG2 }} /> : <ChevronRight size={14} style={{ color: FG2 }} />}
                        <span style={{ color: FG, fontWeight: 600, fontSize: 14 }}>{cat.label}</span>
                        <span style={{ color: FG2, fontSize: 11, background: BORD, borderRadius: 8, padding: "1px 7px" }}>{cat.totalDocs}</span>
                      </div>

                      {isExp && (
                        <div style={{ paddingLeft: 16, marginTop: 4 }}>
                          {cat.years.map(({ year, docs }) => (
                            <div key={year} style={{ marginBottom: 8 }}>
                              {cat.years.length > 1 && (
                                <div style={{ color: FG2, fontSize: 12, fontWeight: 600, padding: "4px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                                  <span>{"\uD83D\uDCC5"}</span> {year}
                                  <span style={{ color: FG2, fontSize: 10, background: BORD, borderRadius: 8, padding: "0 5px" }}>{docs.length}</span>
                                </div>
                              )}
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: cat.years.length > 1 ? 8 : 0 }}>
                                {docs.map(doc => <DocRow key={doc.id} doc={doc} />)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Einfache Liste (1 Datei oder alle gleiche Kategorie) */
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {info.docs.map(doc => <DocRow key={doc.id} doc={doc} />)}
              </div>
            )}

            {/* Footer */}
            <div style={{ marginTop: 32, textAlign: "center", color: FG2, fontSize: 12 }}>
              Dieser Link wurde von Artis Treuhand GmbH geteilt via{" "}
              <a href="https://smartis.me" style={{ color: ACC }}>smartis.me</a>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
