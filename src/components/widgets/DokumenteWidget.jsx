import React, { useContext, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Search, FileText, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase, entities } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";

// ── Dokumente-Widget für Widescreen-Panels ─────────────────────────
// BEWUSST eine eigene, schlanke Read-only-Komponente statt eine Einbettung
// von src/pages/Dokumente.jsx: handleCheckout/handleCheckin dort sind laut
// CLAUDE.md tabu, und praktisch jeder Klick auf ein Dokument in der
// Originalseite löst einen Checkout aus. Dieses Widget liest nur Metadaten
// (kein Storage-Write, kein Lock) und öffnet Dokumente ausschliesslich als
// Webansicht (SharePoint-Link oder Signed-URL) in einem neuen Tab.
const BUCKET = "dokumente";
const LIST_FIELDS = "id,customer_id,name,filename,year,storage_path,sharepoint_web_url,tag_ids,updated_at";
const LS_RECENT = "dokwidget_recent";

function loadRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_RECENT));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function rememberRecent(docId) {
  const next = [docId, ...loadRecent().filter((id) => id !== docId)].slice(0, 8);
  try {
    localStorage.setItem(LS_RECENT, JSON.stringify(next));
  } catch { /* egal */ }
  return next;
}

export default function DokumenteWidget() {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const textMain = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#5a5a7a" : "#9090b8";
  const borderColor = isArtis ? "#e0e8e0" : isLight ? "#e4e4ea" : "#3f3f46";
  const cardBg = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.4)";
  const accent = isArtis ? "#4d6a50" : "#5b21b6";

  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState(loadRecent);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["dokumente-widget-meta"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dokumente")
        .select(LIST_FIELDS)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Gleicher queryKey wie Telefonliste.jsx -- React Query dedupliziert,
  // wenn beide Widgets gleichzeitig in Panels laufen.
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });
  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.company_name || c.name || ""]));
    return (id) => map.get(id) || "";
  }, [customers]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return docs;
    return docs.filter((d) => {
      const hay = [d.name, d.filename, customerName(d.customer_id)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [docs, q, customerName]);

  const recentDocs = useMemo(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    return recent.map((id) => byId.get(id)).filter(Boolean);
  }, [recent, docs]);

  const openDoc = async (doc) => {
    setRecent(rememberRecent(doc.id));
    if (doc.sharepoint_web_url) {
      window.open(doc.sharepoint_web_url, "_blank", "noopener");
      return;
    }
    if (!doc.storage_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 600);
    if (!error && data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: cardBg, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${borderColor}`, flexShrink: 0 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: textMuted }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Dokumente suchen…"
            style={{ paddingLeft: 32, height: 32, fontSize: 13, borderColor, color: textMain }}
          />
        </div>
      </div>

      {!q && recentDocs.length > 0 && (
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", overflowX: "auto", borderBottom: `1px solid ${borderColor}`, flexShrink: 0 }}>
          {recentDocs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => openDoc(d)}
              title={d.name}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
                padding: "4px 10px", borderRadius: 999, border: `1px solid ${borderColor}`,
                background: "transparent", color: textMuted, fontSize: 11.5, cursor: "pointer",
              }}
            >
              <FileText size={11} />
              <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {isLoading && <div style={{ padding: 24, textAlign: "center", color: textMuted, fontSize: 13 }}>Lädt…</div>}
        {!isLoading && filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: textMuted, fontSize: 13 }}>
            {q ? "Keine Treffer." : "Keine Dokumente."}
          </div>
        )}
        {!isLoading && filtered.map((d) => (
          <div
            key={d.id}
            onClick={() => openDoc(d)}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
              borderBottom: `1px solid ${borderColor}`, cursor: "pointer",
            }}
          >
            <FileText size={16} style={{ color: accent, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: textMain, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.name || d.filename}
              </div>
              <div style={{ color: textMuted, fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {[customerName(d.customer_id), d.year].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{ color: textMuted, fontSize: 11, flexShrink: 0 }}>
              {d.updated_at ? format(new Date(d.updated_at), "dd.MM.yy", { locale: de }) : ""}
            </div>
            <ExternalLink size={12} style={{ color: textMuted, flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
