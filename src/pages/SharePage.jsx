import React, { useState, useEffect } from "react";
import { Download, FileText, Folder, AlertCircle, Clock, CheckCircle2, Loader2 } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SHARE_FN = `${SUPABASE_URL}/functions/v1/share-link`;

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function getFileIcon(filename, fileType) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (fileType === "application/pdf" || ext === "pdf") return { label: "PDF", color: "#dc2626" };
  if (["xls","xlsx","csv"].includes(ext)) return { label: "XLS", color: "#16a34a" };
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

  // Styles
  const BG    = "#0f172a";
  const CARD  = "#1e293b";
  const ACC   = "#3d7a3d";
  const FG    = "#f1f5f9";
  const FG2   = "#94a3b8";
  const BORD  = "#334155";

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "0 0 40px 0", fontFamily: "Segoe UI, system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ width: "100%", background: "#1e293b", borderBottom: "1px solid " + BORD, padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: ACC, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>A</span>
        </div>
        <div>
          <div style={{ color: FG, fontWeight: 700, fontSize: 15 }}>Artis Treuhand GmbH</div>
          <div style={{ color: FG2, fontSize: 12 }}>Freigegebene Datei</div>
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 640, padding: "0 16px" }}>
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
                {info.expires_at && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: FG2, fontSize: 13 }}>
                    <Clock size={14} />
                    Gültig bis {new Date(info.expires_at).toLocaleDateString("de-CH")}
                  </div>
                )}
                {!info.expires_at && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: FG2, fontSize: 13 }}>
                    <Clock size={14} />
                    Unbegrenzt gültig
                  </div>
                )}
              </div>
            </div>

            {/* Datei-Liste */}
            {info.docs.length === 0 && (
              <div style={{ textAlign: "center", color: FG2, padding: 40 }}>Keine Dateien in diesem Ordner.</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {info.docs.map(doc => {
                const fi = getFileIcon(doc.filename || doc.name, doc.file_type);
                const isLoading = downloading[doc.id];
                return (
                  <div key={doc.id} style={{ background: CARD, border: "1px solid " + BORD, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center" }}>
                      {fi.label}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: FG, fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {doc.name || doc.filename}
                      </div>
                      {doc.file_size && (
                        <div style={{ color: FG2, fontSize: 12, marginTop: 2 }}>{formatBytes(doc.file_size)}</div>
                      )}
                    </div>
                    <button
                      onClick={() => downloadFile(doc.id, doc.filename || doc.name)}
                      disabled={isLoading}
                      style={{ background: isLoading ? BORD : ACC, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: isLoading ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, flexShrink: 0, transition: "background 0.15s" }}
                    >
                      {isLoading
                        ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                        : <Download size={14} />
                      }
                      {isLoading ? "..." : "Download"}
                    </button>
                  </div>
                );
              })}
            </div>

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
