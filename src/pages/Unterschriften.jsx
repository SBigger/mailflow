import React, { useState, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ThemeContext } from "@/Layout";
import { entities, supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  PenLine, Plus, Download, X, ChevronRight, Wrench, Upload,
  User, Clock, CheckCircle2, Ban, FileText, Copy, FolderInput,
  Send, Loader2, RefreshCw, ExternalLink, Info
} from "lucide-react";

// ── Status-Konfiguration ─────────────────────────────────────────────────────
const STATUS_CONFIG = {
  draft:     { label: "Entwurf",        color: "#6b7280", bg: "#f3f4f6", dot: false },
  open:      { label: "Ausstehend",     color: "#d97706", bg: "#fef3c7", dot: true  },
  signed:    { label: "Unterschrieben", color: "#16a34a", bg: "#dcfce7", dot: false },
  declined:  { label: "Abgelehnt",      color: "#dc2626", bg: "#fee2e2", dot: false },
  withdrawn: { label: "Storniert",      color: "#9ca3af", bg: "#f3f4f6", dot: false },
  expired:   { label: "Abgelaufen",     color: "#ea580c", bg: "#ffedd5", dot: false },
};

const SIG_TYPES = [
  { value: "SES", label: "SES – Einfach",                desc: "Für formfreie Dokumente, keine SMS-Bestätigung nötig" },
  { value: "AES", label: "AES – Fortgeschritten ✓ Empfohlen", desc: "Mandate, Verträge, Vollmachten – rechtsgültig nach OR Art. 14" },
];

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      {cfg.dot && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: cfg.color }} />}
      {cfg.label}
    </span>
  );
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function defaultExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

// ── Haupt-Komponente ─────────────────────────────────────────────────────────
export default function Unterschriften() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const pageBg       = isLight ? "#f4f4f8"               : isArtis ? "#f2f5f2"               : "#2a2a2f";
  const cardBg       = isLight ? "#ffffff"                : isArtis ? "#ffffff"                : "#27272a";
  const cardBorder   = isLight ? "#e2e2ec"                : isArtis ? "#ccd8cc"                : "#3f3f46";
  const headingCol   = isLight ? "#1e293b"                : isArtis ? "#1a3a1a"                : "#e4e4e7";
  const subCol       = isLight ? "#64748b"                : isArtis ? "#4a6a4a"                : "#a1a1aa";
  const inputBg      = isLight ? "#f8f8fc"                : isArtis ? "#f5f8f5"                : "rgba(24,24,27,0.8)";
  const inputBorder  = isLight ? "#d4d4e8"                : isArtis ? "#bfcfbf"                : "#3f3f46";
  const rowHover     = isLight ? "#f8fafc"                : isArtis ? "#f0f5f0"                : "#323236";
  const accent       = isArtis ? "#4a7a4f"                : isLight  ? "#4f6aab"               : "#7c3aed";
  const accentLight  = isArtis ? "#7a9b7f"                : isLight  ? "#7a9abf"               : "#9f7aef";
  const headerIconBg = isLight ? "#f0f0fa"                : isArtis ? "#e8f2e8"                : "#3f3f46";
  const badgeBg      = isLight ? "#f1f5f9"                : isArtis ? "#e8f2e8"                : "#3f3f46";

  const inp = {
    background: inputBg, border: `1px solid ${inputBorder}`,
    color: headingCol, borderRadius: 8, padding: "8px 12px",
    fontSize: 13, width: "100%", outline: "none",
  };

  const qc = useQueryClient();

  // ── Daten ──────────────────────────────────────────────────────────────────
  const { data: signaturen = [], isLoading, refetch } = useQuery({
    queryKey: ["signaturen"],
    queryFn: () => entities.Signatur.list("-created_at"),
  });
  const { data: kunden = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });
  const { data: personen = [] } = useQuery({
    queryKey: ["personen_sign"],
    queryFn: async () => {
      const { data } = await supabase.from("personen").select("id,vorname,nachname,email").order("nachname");
      return data || [];
    },
  });

  // ── UI State ───────────────────────────────────────────────────────────────
  const [filter, setFilter]         = useState("alle");
  const [showModal, setShowModal]   = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // Modal-Felder
  const [file, setFile]             = useState(null);
  const [dragOver, setDragOver]     = useState(false);
  const [signers, setSigners]       = useState([{ name: "", email: "" }]);
  const [message, setMessage]       = useState("");
  const [expiresAt, setExpiresAt]   = useState(defaultExpiry());
  const [sigType, setSigType]       = useState("AES");
  const [custId, setCustId]         = useState("");
  const [sending, setSending]       = useState(false);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const cancelMut = useMutation({
    mutationFn: async (req) => {
      const { error } = await supabase.functions.invoke("skribble-proxy", {
        body: { action: "cancel", request_id: req.skribble_request_id, id: req.id },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["signaturen"] }); toast.success("Anfrage storniert"); },
    onError:   (e) => toast.error("Fehler: " + e.message),
  });

  const storeMut = useMutation({
    mutationFn: async (req) => {
      const { error } = await supabase.functions.invoke("skribble-proxy", {
        body: { action: "store-in-dokumente", request_id: req.skribble_request_id, id: req.id, customer_id: req.customer_id },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["signaturen"] }); toast.success("In Dokumente abgelegt ✓"); },
    onError:   (e) => toast.error("Fehler: " + e.message),
  });

  const refreshMut = useMutation({
    mutationFn: async (req) => {
      const { error } = await supabase.functions.invoke("skribble-proxy", {
        body: { action: "status", request_id: req.skribble_request_id, id: req.id },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["signaturen"] }); toast.success("Status aktualisiert"); },
    onError:   () => toast.error("Status-Update fehlgeschlagen"),
  });

  // ── Senden ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!file) { toast.error("Bitte PDF auswählen"); return; }
    const validSigners = signers.filter(s => s.email.trim());
    if (validSigners.length === 0) { toast.error("Mindestens eine E-Mail-Adresse nötig"); return; }

    setSending(true);
    try {
      const safeName = file.name
        .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/ß/g, "ss")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `signing-temp/${Date.now()}_${safeName}`;
      const cleanFile = new File([file], safeName, { type: file.type });
      const { error: upErr } = await supabase.storage.from("dokumente").upload(path, cleanFile);
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("dokumente").getPublicUrl(path);

      const { error } = await supabase.functions.invoke("skribble-proxy", {
        body: {
          action: "create",
          document_url: publicUrl,
          document_name: file.name,
          signers: validSigners,
          message,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          signature_type: sigType,
          customer_id: custId || null,
        },
      });
      if (error) throw new Error(error.message);

      toast.success("Zur Unterschrift versendet ✓");
      qc.invalidateQueries({ queryKey: ["signaturen"] });
      setShowModal(false);
      resetModal();
    } catch (e) {
      toast.error("Fehler: " + (e.message || "Unbekannter Fehler"));
    } finally {
      setSending(false);
    }
  };

  const resetModal = () => {
    setFile(null); setSigners([{ name: "", email: "" }]);
    setMessage(""); setExpiresAt(defaultExpiry());
    setSigType("AES"); setCustId("");
  };

  const handleDownload = async (req) => {
    try {
      const { data, error } = await supabase.functions.invoke("skribble-proxy", {
        body: { action: "download", request_id: req.skribble_request_id, id: req.id },
      });
      if (error) throw new Error(error.message);
      if (data?.download_url) window.open(data.download_url, "_blank");
      else toast.error("Download-URL nicht verfügbar");
    } catch (e) {
      toast.error("Download fehlgeschlagen: " + e.message);
    }
  };

  // ── Unterzeichner-Helfer ───────────────────────────────────────────────────
  const addSigner    = ()          => setSigners(s => [...s, { name: "", email: "" }]);
  const removeSigner = (i)         => setSigners(s => s.filter((_, idx) => idx !== i));
  const updateSigner = (i, f, v)   => setSigners(s => s.map((sg, idx) => idx === i ? { ...sg, [f]: v } : sg));

  const quickAddKunde = (id) => {
    const k = kunden.find(c => c.id === id);
    if (!k) return;
    const cps = k.contact_persons || [];
    if (cps.length > 0) {
      const cp = cps[0];
      const name = [cp.anrede, cp.vorname, cp.name].filter(Boolean).join(" ");
      setSigners(prev => {
        const clean = prev.filter(x => x.email.trim());
        return [...clean, { name, email: cp.email || "" }];
      });
    }
    setCustId(id);
  };

  const quickAddPerson = (id) => {
    const p = personen.find(x => x.id === id);
    if (!p) return;
    const name = [p.vorname, p.nachname].filter(Boolean).join(" ");
    setSigners(prev => {
      const clean = prev.filter(x => x.email.trim());
      return [...clean, { name, email: p.email || "" }];
    });
  };

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = signaturen.filter(s => {
    if (filter === "alle")           return true;
    if (filter === "ausstehend")     return s.skribble_status === "open";
    if (filter === "unterschrieben") return s.skribble_status === "signed";
    if (filter === "abgelehnt")      return ["declined", "withdrawn"].includes(s.skribble_status);
    if (filter === "abgelaufen")     return s.skribble_status === "expired";
    return true;
  });

  const stats = {
    ausstehend:     signaturen.filter(s => s.skribble_status === "open").length,
    unterschrieben: signaturen.filter(s => s.skribble_status === "signed").length,
    total:          signaturen.length,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 py-5" style={{ borderBottom: `1px solid ${cardBorder}` }}>
        <div className="flex items-center gap-2 mb-4">
          <Wrench className="w-4 h-4" style={{ color: accentLight }} />
          <span className="text-sm" style={{ color: subCol }}>Artis Tools</span>
          <ChevronRight className="w-3 h-3" style={{ color: subCol }} />
          <PenLine className="w-4 h-4" style={{ color: accent }} />
          <span className="text-sm font-semibold" style={{ color: headingCol }}>Unterschriften</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: headerIconBg }}>
              <PenLine className="w-5 h-5" style={{ color: accent }} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: headingCol }}>Unterschriften</h1>
              <p className="text-xs" style={{ color: subCol }}>Digitale Signaturverwaltung · Skribble</p>
            </div>
          </div>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ backgroundColor: accent }}>
            <Plus className="w-4 h-4" /> Neue Anfrage
          </button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-4">
          {[
            { label: "Ausstehend",    value: stats.ausstehend,     color: "#d97706", bg: "#fef3c7" },
            { label: "Unterschrieben",value: stats.unterschrieben, color: "#16a34a", bg: "#dcfce7" },
            { label: "Total",         value: stats.total,          color: subCol,    bg: badgeBg   },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: bg }}>
              <span className="text-lg font-bold" style={{ color }}>{value}</span>
              <span className="text-xs" style={{ color }}>{label}</span>
            </div>
          ))}
          <button onClick={() => refetch()}
            className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ color: subCol, backgroundColor: badgeBg }}>
            <RefreshCw className="w-3 h-3" /> Aktualisieren
          </button>
        </div>
      </div>

      {/* ── Filter Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex gap-1 px-6 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${cardBorder}` }}>
        {[
          { key: "alle",           label: "Alle" },
          { key: "ausstehend",     label: "Ausstehend" },
          { key: "unterschrieben", label: "Unterschrieben" },
          { key: "abgelehnt",      label: "Abgelehnt / Storniert" },
          { key: "abgelaufen",     label: "Abgelaufen" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ backgroundColor: filter === key ? accent : "transparent", color: filter === key ? "#fff" : subCol }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Anfragen-Liste ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: accent }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: badgeBg }}>
              <PenLine className="w-8 h-8" style={{ color: subCol }} />
            </div>
            <p className="text-base font-semibold mb-1" style={{ color: headingCol }}>
              {filter === "alle" ? "Noch keine Signaturanfragen" : "Keine Einträge in diesem Filter"}
            </p>
            <p className="text-sm mb-4" style={{ color: subCol }}>
              {filter === "alle" ? "Sende dein erstes Dokument zur digitalen Unterschrift." : ""}
            </p>
            {filter === "alle" && (
              <button onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: accent }}>
                <Plus className="w-4 h-4" /> Erste Anfrage erstellen
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl">
            {filtered.map((req) => {
              const signerList = Array.isArray(req.signers) ? req.signers : [];
              const kunde = kunden.find(k => k.id === req.customer_id);
              const isExpanded = expandedId === req.id;

              return (
                <div key={req.id} className="rounded-xl overflow-hidden transition-all"
                  style={{ border: `1px solid ${cardBorder}`, backgroundColor: cardBg }}>

                  {/* Zeile */}
                  <div
                    className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                    style={{ borderBottom: isExpanded ? `1px solid ${cardBorder}` : "none" }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHover}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                    onClick={() => setExpandedId(isExpanded ? null : req.id)}
                  >
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: badgeBg }}>
                      <FileText className="w-4 h-4" style={{ color: accentLight }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate" style={{ color: headingCol }}>
                          {req.document_name || "Dokument"}
                        </span>
                        {kunde && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: badgeBg, color: subCol }}>
                            {kunde.company_name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-xs" style={{ color: subCol }}>
                          {signerList.map(s => s.name || s.email).join(", ") || "—"}
                        </span>
                        <span className="text-xs" style={{ color: subCol }}>· {fmtDate(req.created_at)}</span>
                        {req.expires_at && req.skribble_status === "open" && (
                          <span className="text-xs flex items-center gap-1" style={{ color: "#d97706" }}>
                            <Clock className="w-3 h-3" /> Frist: {fmtDate(req.expires_at)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={req.skribble_status} />
                      {req.skribble_status === "signed" && !req.signed_stored && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                          Noch nicht abgelegt
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Detail-Bereich */}
                  {isExpanded && (
                    <div className="px-5 py-4"
                      style={{ backgroundColor: isArtis ? "#f8fbf8" : isLight ? "#f8fafc" : "#232326" }}>
                      <div className="flex flex-wrap gap-2">
                        {req.signing_url && req.skribble_status === "open" && (
                          <>
                            <button onClick={() => { navigator.clipboard.writeText(req.signing_url); toast.success("Link kopiert"); }}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                              style={{ backgroundColor: badgeBg, color: accent }}>
                              <Copy className="w-3.5 h-3.5" /> Signatur-Link kopieren
                            </button>
                            <button onClick={() => window.open(req.signing_url, "_blank")}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                              style={{ backgroundColor: badgeBg, color: accent }}>
                              <ExternalLink className="w-3.5 h-3.5" /> Im Browser öffnen
                            </button>
                          </>
                        )}

                        {req.skribble_request_id && req.skribble_status === "open" && (
                          <button onClick={() => refreshMut.mutate(req)} disabled={refreshMut.isPending}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                            style={{ backgroundColor: badgeBg, color: subCol }}>
                            <RefreshCw className="w-3.5 h-3.5" /> Status prüfen
                          </button>
                        )}

                        {req.skribble_status === "signed" && (
                          <button onClick={() => handleDownload(req)}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                            style={{ backgroundColor: "#dcfce7", color: "#16a34a" }}>
                            <Download className="w-3.5 h-3.5" /> Signiertes PDF herunterladen
                          </button>
                        )}

                        {req.skribble_status === "signed" && !req.signed_stored && (
                          <button onClick={() => storeMut.mutate(req)} disabled={storeMut.isPending}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white transition-colors"
                            style={{ backgroundColor: accent }}>
                            <FolderInput className="w-3.5 h-3.5" />
                            {storeMut.isPending ? "Wird abgelegt…" : "In Dokumente ablegen"}
                          </button>
                        )}

                        {req.signed_stored && (
                          <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                            style={{ backgroundColor: "#dcfce7", color: "#16a34a" }}>
                            <CheckCircle2 className="w-3.5 h-3.5" /> In Dokumente abgelegt
                          </span>
                        )}

                        {req.skribble_status === "open" && (
                          <button
                            onClick={() => { if (window.confirm("Signaturanfrage wirklich stornieren?")) cancelMut.mutate(req); }}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium ml-auto transition-colors"
                            style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}>
                            <Ban className="w-3.5 h-3.5" /> Stornieren
                          </button>
                        )}
                      </div>

                      {signerList.length > 0 && (
                        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${cardBorder}` }}>
                          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: subCol }}>Unterzeichner</p>
                          <div className="flex flex-wrap gap-2">
                            {signerList.map((s, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
                                style={{ backgroundColor: badgeBg, color: headingCol }}>
                                <User className="w-3 h-3" style={{ color: subCol }} />
                                <span className="font-medium">{s.name || s.email}</span>
                                {s.email && s.name && <span style={{ color: subCol }}>· {s.email}</span>}
                                {s.signed_at && <span className="text-green-600 font-medium">✓ {fmtDate(s.signed_at)}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {req.message && (
                        <p className="mt-2 text-xs italic" style={{ color: subCol }}>„{req.message}"</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Send Modal ──────────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => { setShowModal(false); resetModal(); }} />

          <div className="relative h-full w-full max-w-lg overflow-y-auto shadow-2xl flex flex-col"
            style={{ backgroundColor: cardBg, borderLeft: `1px solid ${cardBorder}` }}>

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 flex-shrink-0"
              style={{ borderBottom: `1px solid ${cardBorder}` }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: badgeBg }}>
                  <Send className="w-4 h-4" style={{ color: accent }} />
                </div>
                <div>
                  <h2 className="text-base font-bold" style={{ color: headingCol }}>Zur Unterschrift senden</h2>
                  <p className="text-xs" style={{ color: subCol }}>Digitale Signaturanfrage erstellen</p>
                </div>
              </div>
              <button onClick={() => { setShowModal(false); resetModal(); }}
                className="p-1.5 rounded-lg transition-colors hover:bg-red-50">
                <X className="w-5 h-5" style={{ color: subCol }} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 px-6 py-5 space-y-6 overflow-y-auto">

              {/* 1 · Dokument */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: subCol }}>
                  1 · Dokument (PDF)
                </h3>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault(); setDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f?.type === "application/pdf") setFile(f);
                    else toast.error("Nur PDF-Dateien erlaubt");
                  }}
                  onClick={() => document.getElementById("sig-file-input").click()}
                  className="rounded-xl flex flex-col items-center justify-center py-8 cursor-pointer transition-all"
                  style={{
                    border: `2px dashed ${dragOver ? accent : cardBorder}`,
                    backgroundColor: dragOver ? (isArtis ? "#e8f2e8" : "#f0f4ff") : inputBg,
                  }}>
                  {file ? (
                    <div className="flex items-center gap-3">
                      <FileText className="w-8 h-8" style={{ color: accent }} />
                      <div>
                        <p className="text-sm font-semibold" style={{ color: headingCol }}>{file.name}</p>
                        <p className="text-xs" style={{ color: subCol }}>{(file.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setFile(null); }}
                        className="p-1 rounded-lg hover:bg-red-50">
                        <X className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 mb-2" style={{ color: subCol }} />
                      <p className="text-sm font-medium" style={{ color: headingCol }}>PDF hier ablegen</p>
                      <p className="text-xs mt-1" style={{ color: subCol }}>oder klicken zum Auswählen</p>
                    </>
                  )}
                </div>
                <input id="sig-file-input" type="file" accept=".pdf" className="hidden"
                  onChange={e => { const f = e.target.files[0]; if (f) setFile(f); }} />
              </section>

              {/* 2 · Unterzeichner */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: subCol }}>
                  2 · Unterzeichner
                </h3>
                <div className="flex gap-2 mb-3">
                  <select style={{ ...inp, fontSize: 12 }} defaultValue=""
                    onChange={e => { if (e.target.value) quickAddKunde(e.target.value); e.target.value = ""; }}>
                    <option value="">+ Aus Kunden</option>
                    {kunden.map(k => <option key={k.id} value={k.id}>{k.company_name}</option>)}
                  </select>
                  <select style={{ ...inp, fontSize: 12 }} defaultValue=""
                    onChange={e => { if (e.target.value) quickAddPerson(e.target.value); e.target.value = ""; }}>
                    <option value="">+ Aus Personen</option>
                    {personen.map(p => (
                      <option key={p.id} value={p.id}>{[p.vorname, p.nachname].filter(Boolean).join(" ")}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  {signers.map((s, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input placeholder="Name" value={s.name}
                        onChange={e => updateSigner(i, "name", e.target.value)}
                        style={{ ...inp, flex: 1 }} />
                      <input placeholder="E-Mail *" type="email" value={s.email}
                        onChange={e => updateSigner(i, "email", e.target.value)}
                        style={{ ...inp, flex: 1.5 }} />
                      {signers.length > 1 && (
                        <button onClick={() => removeSigner(i)}
                          className="p-2 rounded-lg hover:bg-red-50 flex-shrink-0">
                          <X className="w-4 h-4 text-red-400" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={addSigner}
                  className="flex items-center gap-1.5 text-xs mt-2 px-2.5 py-1.5 rounded-lg transition-colors"
                  style={{ color: accent, backgroundColor: badgeBg }}>
                  <Plus className="w-3 h-3" /> Weiteren Unterzeichner hinzufügen
                </button>
              </section>

              {/* 3 · Optionen */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: subCol }}>
                  3 · Optionen
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: subCol }}>Nachricht (optional)</label>
                    <textarea value={message} onChange={e => setMessage(e.target.value)}
                      placeholder="Bitte unterzeichnen Sie dieses Dokument bis zum..."
                      rows={2} style={{ ...inp, resize: "none" }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: subCol }}>Frist</label>
                    <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                      style={{ ...inp, maxWidth: 200 }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-2 block" style={{ color: subCol }}>Signaturtyp</label>
                    <div className="space-y-2">
                      {SIG_TYPES.map(t => (
                        <label key={t.value} className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all"
                          style={{
                            border: `1px solid ${sigType === t.value ? accent : cardBorder}`,
                            backgroundColor: sigType === t.value
                              ? (isArtis ? "#e8f2e8" : isLight ? "#f0f4ff" : "#2f2f40")
                              : inputBg,
                          }}>
                          <input type="radio" name="sigtype" value={t.value} checked={sigType === t.value}
                            onChange={() => setSigType(t.value)} className="mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold" style={{ color: headingCol }}>{t.label}</p>
                            <p className="text-[11px] mt-0.5" style={{ color: subCol }}>{t.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: subCol }}>Kunde zuweisen (optional)</label>
                    <select value={custId} onChange={e => setCustId(e.target.value)} style={inp}>
                      <option value="">– Keinem Kunden zuweisen –</option>
                      {kunden.map(k => <option key={k.id} value={k.id}>{k.company_name}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              {/* Info-Box */}
              <div className="flex gap-2 p-3 rounded-xl text-xs"
                style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f0f4ff" : "#2f2f40", color: subCol }}>
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }} />
                <span>
                  Der Unterzeichner erhält eine E-Mail von Skribble.
                  Er muss sich <strong style={{ color: headingCol }}>nicht registrieren</strong> und kann
                  auf dem Handy unterschreiben. Das signierte PDF wird automatisch verfügbar.
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 px-6 py-4 flex-shrink-0"
              style={{ borderTop: `1px solid ${cardBorder}` }}>
              <button onClick={() => { setShowModal(false); resetModal(); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors"
                style={{ backgroundColor: badgeBg, color: subCol }}>
                Abbrechen
              </button>
              <button onClick={handleSend} disabled={sending || !file}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ backgroundColor: accent }}>
                {sending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Wird gesendet…</>
                  : <><Send className="w-4 h-4" /> Zur Unterschrift senden</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
