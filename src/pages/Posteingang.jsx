import React, { useState, useMemo, useContext, useRef } from "react";
import {Search, Download, Trash2, FileUser, Eye} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import CreateLinkDialog from "../components/posteingang/CreateLinkDialog.jsx";
import AssignDialog from "../components/posteingang/AssignDialog.jsx";
import DocHoverPreview from "@/components/dokumente/DocHoverPreview";
import { useContainerWidth } from "@/components/layout/useContainerQuery";

const BUCKET = "posteingang";

// ─── Helper Functions ────────────────────────────────────────────────────────
function getFileInfo(mimeType, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (mimeType === "application/pdf" || ext === "pdf") return { label: "PDF", color: "#dc2626" };
  if (mimeType?.includes("spreadsheet") || ["xls", "xlsx", "csv"].includes(ext)) return { label: "XLS", color: "#16a34a" };
  if (mimeType?.includes("word") || ["doc", "docx"].includes(ext)) return { label: "DOC", color: "#2563eb" };
  if (mimeType?.startsWith("image/")) return { label: "IMG", color: "#7c3aed" };
  return { label: ext.toUpperCase() || "FILE", color: "#71717a" };
}

export default function Posteingang({ embedded = false } = {}) {
  const { theme } = useContext(ThemeContext);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = {
    cardBg: isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a",
    border: isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "#3f3f46",
    textMain: isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7",
    textMuted: isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a",
    inputBg: isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.8)",
    sidebarBg: isArtis ? "#f5f8f5" : isLight ? "#f5f5fc" : "#1f1f23",
    selBg: isArtis ? "rgba(122,155,127,0.18)" : isLight ? "rgba(99,102,241,0.13)" : "rgba(99,102,241,0.18)",
    rowHover: isArtis ? "rgba(122,155,127,0.07)" : isLight ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.03)",
  };
  const border = s.border;
  const accent = isArtis ? "#4a7a4f" : "#7c3aed";

  // States
  const [selCustomerId, setSelCustomerId] = useState(null);
  const [custSearch, setCustSearch] = useState("");
  const [ftSearch, setFtSearch] = useState("");
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignDoc, setAssignDoc] = useState(null);
  const [hoverPreview, setHoverPreview] = useState(null); // { doc, url, rect } — gleiches Vorschau-Fenster wie in der Dateiablage
  const hoverTimer = useRef(null);

  const [containerRef, containerWidth] = useContainerWidth();
  // Container-Query: die feste 280px-Sidebar kostet in einem schmalen
  // Widescreen-Panel zu viel Platz -- Kunden-Filter wandert dann in ein
  // kompaktes Dropdown im Header.
  const sidebarVisible = !embedded || containerWidth === 0 || containerWidth >= 700;

  // Queries
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => entities.Customer.list("company_name") });

  const { data: allDoks = [], isLoading } = useQuery({
    queryKey: ["dokumente-all-post"],
    queryFn: async () => {
      const { data: folders, error: folderError } = await supabase.storage.from(BUCKET).list();
      if (folderError) throw folderError;

      const results = await Promise.all(
          folders.map(async (folder) => {
            const { data: files, error: fileError } = await supabase.storage.from(BUCKET).list(folder.name);
            if (fileError) return { customerId: folder.name, docs: [] };

            const parsedFiles = files.map(f => {
              const [meta] = f.name.split('@');
              const [category, year] = meta ? meta.split('_') : [null, null];
              return {
                ...f,
                storage_path: `${folder.name}/${f.name}`,
                customer_id: folder.name,
                fileName: f.name.split('@')[1],
                category,
                year
              };
            });

            return { customerId: folder.name, docs: parsedFiles };
          })
      );
      return results;
    }
  });

  const { data: allTags = [] } = useQuery({ queryKey: ["dok_tags"], queryFn: () => entities.DokTag.list("sort_order") });

  // Tree processing: Links Storage folders to Customer Names
  const tree = useMemo(() => {
    const q = custSearch.toLowerCase();
    return allDoks.map(folder => {
      const customer = customers.find(c => c.id === folder.customerId);
      return {
        ...folder,
        company_name: customer ? customer.company_name : `Unbekannt (${folder.customerId})`,
        docCount: folder.docs?.length
      };
    })
        .filter(item => item.company_name?.toLowerCase().includes(q))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [customers, allDoks]);

  // Main List Filtering
  const filtered = useMemo(() => {
    let list = [];
    if (!selCustomerId) {
      list = allDoks.flatMap(folder => folder.docs);
    } else {
      const folder = allDoks.find(d => d.customerId === selCustomerId);
      list = folder ? folder.docs : [];
    }
    const q = ftSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(d =>
        (d.fileName || d.name || "").toLowerCase().includes(q) ||
        (d.category || "").toLowerCase().includes(q) ||
        String(d.year || "").includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [allDoks, selCustomerId, ftSearch]);

  const breadcrumb = useMemo(() => {
    const cust = customers.find(c => c.id === selCustomerId);
    return cust ? cust.company_name : "Alle Dokumente";
  }, [selCustomerId, customers]);

  const downloadDoc = async (doc) => {
    // download-Option: Browser speichert unter dem echten Dateinamen statt
    // dem Storage-Namen mit "kategorie_jahr_zeit@"-Praefix.
    const { data, error } = await supabase.storage.from(BUCKET)
      .createSignedUrl(doc.storage_path, 360, { download: doc.fileName || true });
    if (error || !data?.signedUrl) {
      toast.error("Download fehlgeschlagen" + (error?.message ? `: ${error.message}` : ""));
      return;
    }
    const a = window.document.createElement("a");
    a.href = data.signedUrl;
    a.download = doc.fileName || "";
    window.document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Vorschau: Datei per Signed-URL laden und im selben schwebenden Fenster
  // zeigen wie in der Dateiablage (verschieb-/vergroesserbar, × schliesst).
  const openPreview = async (doc, targetEl) => {
    const rect = targetEl?.getBoundingClientRect?.() || null;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Vorschau nicht möglich" + (error?.message ? `: ${error.message}` : ""));
      return;
    }
    setHoverPreview({
      doc: {
        id: doc.id || doc.storage_path,
        name: doc.fileName || doc.name,
        filename: doc.fileName || doc.name,
        file_size: doc.metadata?.size,
      },
      url: data.signedUrl,
      rect,
    });
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`«${doc.fileName || doc.name}» wirklich löschen?`)) return;
    const { error } = await supabase.storage.from(BUCKET).remove([doc.storage_path])

    if(error) {
      toast.error(`Löschen für ${doc.fileName || doc.name} hat nicht funktioniert.`);
    } else {
      toast.success(`${doc.fileName || doc.name} gelöscht.`)
      queryClient.invalidateQueries({ queryKey: ["dokumente-all-post"] });
    }
  }

  const treeItem = { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", cursor: "pointer", borderRadius: 5, fontSize: 13, userSelect: "none" };

  return (
      <div ref={containerRef} className="w-screen" style={{ display: "flex", flexDirection: "column", height: embedded ? "100%" : "100vh", overflow: "hidden", background: s.cardBg, color: s.textMain }}>
        {/* Header */}
        <div style={{padding: "12px 20px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap"}}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Paperboy</span>
          <div style={{ position: "relative", flex: sidebarVisible ? "none" : 1, minWidth: 120 }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: s.textMuted }} />
            <input
                value={ftSearch}
                onChange={e => setFtSearch(e.target.value)}
                placeholder="Suchen (Name, Kategorie, Jahr)..."
                style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 8, padding: "5px 30px", fontSize: 12, width: sidebarVisible ? 280 : "100%" }}
            />
          </div>
          {!sidebarVisible && (
            <select
              value={selCustomerId || ""}
              onChange={(e) => setSelCustomerId(e.target.value || null)}
              style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 8, padding: "5px 8px", fontSize: 12, minWidth: 140 }}
            >
              <option value="">Alle Kunden</option>
              {tree.map((item) => (
                <option key={item.customerId} value={item.customerId}>{item.company_name}</option>
              ))}
            </select>
          )}
          <div style={{ flex: 1 }} />
          <Button onClick={() => setShowLinkDialog(true)} style={{ background: accent, color: "#fff" }}>
            Uploadseite für Kunde
          </Button>
        </div>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Sidebar -- im schmalen Panel ausgeblendet, Kunden-Filter dann oben im Header */}
          {sidebarVisible && (
          <div style={{ width: 280, borderRight: "1px solid " + border, background: s.sidebarBg, overflowY: "auto" }}>
            <div
                onClick={() => setSelCustomerId(null)}
                style={{ ...treeItem, fontWeight: !selCustomerId ? 700 : 400, background: !selCustomerId ? s.selBg : "transparent" }}
            >
              📁 Alle Dokumente ({allDoks.reduce((acc, curr) => acc + curr.docs?.length, 0)})
            </div>

            {tree.map(item => (
                <div key={item.customerId}>
                  <div
                      onClick={() => setSelCustomerId(item.customerId)}
                      style={{
                        ...treeItem,
                        background: selCustomerId === item.customerId ? s.selBg : "transparent",
                        color: selCustomerId === item.customerId ? accent : s.textMain
                      }}
                  >
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  🏢 {item.company_name}
                </span>
                    <span style={{ fontSize: 11, opacity: 0.6 }}>({item.docCount})</span>
                  </div>
                </div>
            ))}
          </div>
          )}

          {/* Main List */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: accent }}>{breadcrumb}</h3>
            </div>

            {filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: s.textMuted, marginTop: 40 }}>Keine Dokumente gefunden.</div>
            ) : (
                filtered.map(doc => {
                  const fi = getFileInfo(doc?.metadata?.mimetype, doc?.name);
                  return (
                      <div key={doc?.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px", borderBottom: "1px solid " + border, transition: "background 0.2s" }}>
                        <span style={{ background: fi.color, color: "white", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{fi.label}</span>
                        <span
                            title="Vorschau öffnen"
                            onClick={e => openPreview(doc, e.currentTarget)}
                            style={{ flex: 1, fontSize: 14, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >{doc?.fileName || doc?.name}</span>
                        {doc?.year && <span style={{ fontSize: 11, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{doc?.year}</span>}
                        {doc?.category && <span style={{ fontSize: 11, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{doc?.category}</span>}
                        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                          <Eye
                              size={18}
                              title="Vorschau"
                              onClick={e => openPreview(doc, e.currentTarget)}
                              onMouseEnter={e => {
                                const el = e.currentTarget;
                                clearTimeout(hoverTimer.current);
                                hoverTimer.current = setTimeout(() => openPreview(doc, el), 350);
                              }}
                              onMouseLeave={() => clearTimeout(hoverTimer.current)}
                              style={{ cursor: "pointer", color: s.textMuted }}
                          />
                          <FileUser size={25} title="Kunde zuweisen" onClick={() => {setAssignDoc(doc), setShowAssignDialog(true)}} style={{ cursor: "pointer", color: s.textMuted }} />
                          <Download size={16} title="Herunterladen" onClick={() => downloadDoc(doc)} style={{ cursor: "pointer", color: s.textMuted }} />
                          <Trash2 size={16} title="Löschen" onClick={() => handleDelete(doc)} style={{ cursor: "pointer", color: "#ef4444" }} />
                        </div>
                      </div>
                  );
                })
            )}
          </div>
        </div>

        {hoverPreview && (
            <DocHoverPreview
                doc={hoverPreview.doc}
                url={hoverPreview.url}
                rect={hoverPreview.rect}
                theme={theme}
                onClose={() => setHoverPreview(null)}
            />
        )}

        {showAssignDialog && (
            <AssignDialog
                open={showAssignDialog}
                onClose={() => {
                  setShowAssignDialog(false);
                  setAssignDoc(null);
                  queryClient.invalidateQueries({ queryKey: ["dokumente-all-post"] });
                }}
                doc={assignDoc}
                customers={customers}
                preCustomerId={selCustomerId}
                allTags={allTags}
                s={s}
                border={border}
                accent={accent}
            />
        )}

        {showLinkDialog && (
            <CreateLinkDialog
                open={showLinkDialog}
                onClose={() => setShowLinkDialog(false)}
                customers={customers}
                preCustomerId={selCustomerId}
                allTags={allTags}
                s={s}
                border={border}
                accent={accent}/>
        )}
      </div>
  );
}