/**
 * VersionsDialog.jsx — Versionsverwaltung eines Dokuments
 *
 * Additiver Code, der NICHT die Tabu-Funktionen (handleCheckout/handleCheckin)
 * berührt. Die Versionierung läuft komplett über DB-Trigger.
 *
 * Aufruf: <VersionsDialog doc={selectedDoc} onClose={...} />
 */
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Clock, Download, RotateCcw, Pin, X, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";

function formatBytes(b) {
  if (!b) return "?";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

function formatDate(s) {
  if (!s) return "";
  try { return new Date(s).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}

const BUCKET = "dokumente";

export default function VersionsDialog({ doc, onClose }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ["dokument-versions", doc?.id],
    queryFn: async () => {
      if (!doc?.id) return [];
      const { data, error } = await supabase
        .from("dokumente_versions")
        .select("id, version_number, filename, storage_path, file_size, file_type, notes, created_by, created_at, source, is_pinned")
        .eq("doc_id", doc.id)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!doc?.id,
  });

  const restore = useMutation({
    mutationFn: async (versionId) => {
      const { data, error } = await supabase.rpc("dokumente_restore_version", { p_version_id: versionId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Version wiederhergestellt");
      qc.invalidateQueries({ queryKey: ["dokumente-all"] });
      qc.invalidateQueries({ queryKey: ["dokument-versions", doc?.id] });
    },
    onError: (e) => toast.error("Wiederherstellen fehlgeschlagen: " + e.message),
  });

  const togglePin = useMutation({
    mutationFn: async ({ id, current }) => {
      const { error } = await supabase.from("dokumente_versions").update({ is_pinned: !current }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dokument-versions", doc?.id] }),
    onError: (e) => toast.error("Pinnen fehlgeschlagen: " + e.message),
  });

  async function downloadVersion(v) {
    setBusy(true);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(v.storage_path, 300);
      if (error) throw error;
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = v.filename || `version-${v.version_number}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {
      toast.error("Download fehlgeschlagen: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!doc) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center"
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 12, padding: 20, minWidth: 600, maxWidth: 900,
        maxHeight: "85vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.3)"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Clock size={18} />
            <h3 style={{ margin: 0, fontSize: 16 }}>Versionsverlauf</h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: 13, color: "#666", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <FileText size={14} />
          {doc.filename}
        </div>

        {/* Aktuelle Version */}
        <div style={{ padding: 12, borderRadius: 8, background: "#f0fdf4", border: "1px solid #86efac", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong style={{ color: "#15803d" }}>Aktuelle Version</strong>
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                {formatDate(doc.updated_at || doc.created_at)} · {formatBytes(doc.file_size)} · {doc.filename}
              </div>
            </div>
          </div>
        </div>

        {/* Versionen-Liste */}
        {isLoading && <div style={{ textAlign: "center", padding: 20, color: "#999" }}><Loader2 className="animate-spin" /></div>}
        {!isLoading && versions.length === 0 && (
          <div style={{ textAlign: "center", padding: 20, color: "#999", fontSize: 13 }}>
            Noch keine ältere Version vorhanden.
          </div>
        )}
        {versions.map(v => (
          <div key={v.id} style={{
            padding: 10, borderRadius: 6, border: "1px solid #e5e7eb", marginBottom: 6,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: v.is_pinned ? "#fef3c7" : "#fafafa"
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>v{v.version_number}</span>
                {v.is_pinned && <Pin size={12} color="#d97706" />}
                <span style={{ fontSize: 11, color: "#888", padding: "1px 6px", borderRadius: 4, background: "#e5e7eb" }}>
                  {v.source || "?"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                {formatDate(v.created_at)} · {formatBytes(v.file_size)}
                {v.notes && ` · ${v.notes}`}
              </div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.filename}
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => downloadVersion(v)} disabled={busy} title="Herunterladen"
                style={btnStyle}>
                <Download size={14} />
              </button>
              <button onClick={() => togglePin.mutate({ id: v.id, current: v.is_pinned })} title={v.is_pinned ? "Pin entfernen" : "Pinnen"}
                style={{ ...btnStyle, color: v.is_pinned ? "#d97706" : "#6b7280" }}>
                <Pin size={14} />
              </button>
              <button onClick={() => { if(confirm(`Version v${v.version_number} wiederherstellen? Die aktuelle Version wird automatisch archiviert.`)) restore.mutate(v.id); }}
                disabled={restore.isPending} title="Wiederherstellen"
                style={{ ...btnStyle, color: "#dc2626" }}>
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 14, fontSize: 11, color: "#888", textAlign: "center" }}>
          Versionen werden automatisch beim Checkin/Update erstellt. Gepinnte Versionen sind vor Cleanup geschützt.
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: "transparent",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  padding: "4px 6px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
