import React, { useState, useMemo, useEffect, useRef, useContext } from "react";
import { Search, Upload, Download, Trash2, ChevronDown, ChevronRight, X, Pencil, Lock, LockOpen, ShieldAlert } from "lucide-react";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter} from "@/components/ui/dialog";
import * as pdfjsLib from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import {useNavigate} from "react-router-dom";
import CreateLinkDialog from "../components/posteingang/CreateLinkDialog.jsx";

// Configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
const BUCKET = "posteingang";
const CATEGORIES = [
  { key: "rechnung", label: "Rechnungen", icon: "🧾" },
  { key: "vertrag", label: "Verträge", icon: "🤝" },
  { key: "korrespondenz", label: "Korrespondenz", icon: "✉️" },
];

// ─── Helper Functions ────────────────────────────────────────────────────────
async function extractDocumentText(file) {
  if (!file) return "";
  const name = file.name?.toLowerCase() || "";
  const type = file.type || "";

  try {
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

    if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
      const { read, utils } = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = read(new Uint8Array(buf), { type: "array" });
      let text = "";
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = utils.sheet_to_json(ws, { header: 1, defval: "" });
        text += rows.map(r => r.join(" ")).join("\n") + "\n";
      }
      return text.trim().slice(0, 100000);
    }

    if (name.endsWith(".docx")) {
      const { default: JSZip } = await import("jszip");
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const xml = await zip.file("word/document.xml")?.async("text") || "";
      const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return text.slice(0, 100000);
    }

    if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
      const text = await file.text();
      return text.slice(0, 100000);
    }
    return "";
  } catch (e) {
    console.warn("Textextraktion fehlgeschlagen", e);
    return "";
  }
}

function getFileInfo(mimeType, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (mimeType === "application/pdf" || ext === "pdf") return { label: "PDF", color: "#dc2626" };
  if (mimeType?.includes("spreadsheet") || ["xls", "xlsx", "csv"].includes(ext)) return { label: "XLS", color: "#16a34a" };
  if (mimeType?.includes("word") || ["doc", "docx"].includes(ext)) return { label: "DOC", color: "#2563eb" };
  if (mimeType?.startsWith("image/")) return { label: "IMG", color: "#7c3aed" };
  return { label: ext.toUpperCase() || "FILE", color: "#71717a" };
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

// ─── Hauptseite ────────────────────────────────────────────────────────────
export default function Posteingang() {
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
  const [selCat, setSelCat] = useState(null);
  const [selYear, setSelYear] = useState(null);
  const [expandedC, setExpandedC] = useState({});
  const [expandedCat, setExpandedCat] = useState({});
  const [custSearch, setCustSearch] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [ftSearch, setFtSearch] = useState("");
  const [ftResults, setFtResults] = useState(null);
  const [ftSearching, setFtSearching] = useState(false);
  const [signedUrls, setSignedUrls] = useState({});
  const [pageTab, setPageTab] = useState('alle');
  const navigate = useNavigate();
  const [showLinkDialog, setShowLinkDialog] = useState(false);

  // Queries
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => entities.Customer.list("company_name") });
  const { data: allDoks = [], isLoading } = useQuery({ queryKey: ["dokumente-all"], queryFn: () => entities.Dokument.list("-created_at", 5000) });
  const { data: allTags = [] } = useQuery({ queryKey: ["dok_tags"], queryFn: () => entities.DokTag.list("sort_order") });

  // Stub functions for missing logic
  const handleCheckout = (doc) => toast.info(`Checking out ${doc.name}`);
  const handleCheckin = (doc) => toast.info(`Checking in ${doc.name}`);
  const openCheckin = (doc) => toast.info(`Opening check-in for ${doc.name}`);
  const setEditDoc = (doc) => toast.info(`Editing ${doc.name}`);
  const handleDelete = (doc) => toast.error(`Delete clicked for ${doc.name}`);
  const myCheckedOutDocs = useMemo(() => allDoks.filter(d => d.checked_out_by === user?.id), [allDoks, user]);

  // Tree processing
  const tree = useMemo(() => {
    const q = custSearch.toLowerCase();
    return customers
        .filter(c => {
          const has = allDoks.some(d => d.customer_id === c.id);
          const match = !q || c.company_name.toLowerCase().includes(q);
          return has && match;
        })
        .map(c => {
          const docs = allDoks.filter(d => d.customer_id === c.id);
          const cats = CATEGORIES.map(cat => {
            const catDocs = docs.filter(d => d.category === cat.key);
            const years = [...new Set(catDocs.map(d => d.year).filter(Boolean))].sort((a,b) => b-a);
            return { ...cat, count: catDocs.length, years, noYear: catDocs.filter(d => !d.year).length };
          }).filter(cat => cat.count > 0);
          return { ...c, docCount: docs.length, cats };
        });
  }, [customers, allDoks, custSearch]);

  const filtered = useMemo(() => {
    if (!selCustomerId) return [];
    let list = allDoks.filter(d => d.customer_id === selCustomerId);
    if (selCat) list = list.filter(d => d.category === selCat);
    if (selYear === "__none__") list = list.filter(d => !d.year);
    else if (selYear !== null) list = list.filter(d => d.year === selYear);
    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      list = list.filter(d => d.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [allDoks, selCustomerId, selCat, selYear, fileSearch]);

  const breadcrumb = useMemo(() => {
    const cust = customers.find(c => c.id === selCustomerId);
    if (!cust) return "Alle Dokumente";
    let path = cust.company_name;
    if (selCat) path += ` › ${selCat}`;
    if (selYear) path += ` › ${selYear === "__none__" ? "Kein Jahr" : selYear}`;
    return path;
  }, [selCustomerId, selCat, selYear, customers]);

  const downloadDoc = async (doc) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 360);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const selectCustomer = (id) => { setSelCustomerId(id); setSelCat(null); setSelYear(null); setExpandedC(p => ({ ...p, [id]: true })); };
  const selectCat = (cid, ck) => { setSelCustomerId(cid); setSelCat(ck); setSelYear(null); setExpandedCat(p => ({ ...p, [cid + "_" + ck]: true })); };

  const tagLabel = (id) => allTags.find(t => t.id === id)?.name;
  const tagColor = (id) => allTags.find(t => t.id === id)?.color || accent;
  const treeItem = { display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", cursor: "pointer", borderRadius: 5, fontSize: 12, userSelect: "none" };

  const createUploadPageLink = async () => {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 14);

    // 2. Formatieren zu YYYY-MM-DD (ISO-String abschneiden)
    const expiryString = expiryDate.toISOString().split('T')[0];
    const data = {
      expiry: expiryString,
      customerId: selCustomerId,
      tags: ['Steuern', '2025'],
      bucket: 'posteingang'
    };
    const hash = btoa(JSON.stringify(data));
    const url = `/upload/${hash}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const openLinkDialog = () => {
    setShowLinkDialog(true);
  };

  return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: s.cardBg, color: s.textMain }}>
        {/* Header */}
        <div style={{padding: "12px 20px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0}}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Dokumente</span>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: s.textMuted }} />
            <input
                value={ftSearch}
                onChange={e => setFtSearch(e.target.value)}
                placeholder="Volltext-Suche..."
                style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 8, padding: "5px 30px", fontSize: 12, width: 280 }}
            />
          </div>

          <div style={{ flex: 1 }} />

          <Button
              onClick={openLinkDialog}
              hidden={!selCustomerId}
              style={{ background: accent, color: "#fff" }}
          >
            {false ? "Laedt hoch..." : "Uploadseite für Kunde"}
          </Button>
        </div>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Sidebar */}
          <div style={{ width: 260, borderRight: "1px solid " + border, background: s.sidebarBg, overflowY: "auto" }}>
            <div onClick={() => { setSelCustomerId(null); setSelCat(null); setSelYear(null); }} style={treeItem}>
              📁 Alle Dokumente ({allDoks.length})
            </div>
            {tree.map(cust => (
                <div key={cust.id} style={{ marginLeft: 10 }}>
                  <div onClick={() => selectCustomer(cust.id)} style={{...treeItem, fontWeight: selCustomerId === cust.id ? 700 : 400}}>
                    {expandedC[cust.id] ? <ChevronDown size={12}/> : <ChevronRight size={12}/>} 🏢 {cust.company_name}
                  </div>
                </div>
            ))}
          </div>

          {/* Main List */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10
            }}>
              <h3 style={{ margin: 0, fontWeight: 600, color: accent }}>
                {breadcrumb}
              </h3>
            </div>

            {filtered.map(doc => {
              const fi = getFileInfo(doc.file_type, doc.filename);
              return (
                  <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px", borderBottom: "1px solid " + border }}>
                    <span style={{ background: fi.color, color: "white", padding: "2px 6px", borderRadius: 4, fontSize: 10 }}>{fi.label}</span>
                    <span style={{ flex: 1 }}>{doc.name}</span>
                    <Download size={14} onClick={() => downloadDoc(doc)} style={{ cursor: "pointer" }} />
                    <Trash2 size={14} onClick={() => handleDelete(doc)} style={{ cursor: "pointer", color: "#ef4444" }} />
                  </div>
              );
            })}
          </div>
        </div>

        <CreateLinkDialog
            open={showLinkDialog}
            onClose={() => setShowLinkDialog(false)}
            customers={customers}
            preCustomerId={selCustomerId}
            allTags={allTags}
            s={s}
            border={border}
            accent={accent}
        />

      </div>
  );
}