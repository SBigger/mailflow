import React, { useContext, useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, supabase } from "@/api/supabaseClient";
import { addPending, getAllPending, syncPendingQueue, fileToBase64 } from "@/lib/wineOfflineQueue";
import { toast } from "sonner";
import {
  Wine, Wrench, ChevronRight, Camera, Loader2, Plus, Minus,
  Trash2, RefreshCw, WifiOff, Sparkles,
} from "lucide-react";

// ── Foto clientseitig verkleinern (schont Handy-Datenvolumen & IndexedDB) ────
function resizeImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error("Bild konnte nicht verarbeitet werden"));
      }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild konnte nicht geladen werden")); };
    img.src = url;
  });
}

const EMPTY_FIELDS = { name: "", winzer: "", jahrgang: "", rebsorte: "", region: "", land: "" };

export default function Weinregister() {
  const navigate = useNavigate();
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const pageBg   = isLight ? "#f4f4f8" : isArtis ? "#f2f5f2" : "#2a2a2f";
  const panelBg  = isLight ? "#ffffff" : isArtis ? "#ffffff" : "#27272a";
  const panelBdr = isLight ? "#e2e2ec" : isArtis ? "#ccd8cc" : "#3f3f46";
  const headingC = isLight ? "#1e293b" : isArtis ? "#1a3a1a" : "#e4e4e7";
  const subC     = isLight ? "#64748b" : isArtis ? "#4a6a4a" : "#a1a1aa";
  const accent   = isArtis ? "#7a3b5b" : isLight ? "#8a2d5b" : "#c026d3";
  const accentBg = isLight ? "#fbe9f3" : isArtis ? "#f5e0ea" : "rgba(192,38,212,0.12)";
  const rowHover = isLight ? "#f8f8fc" : isArtis ? "#f0f5f0" : "#2f2f35";
  const inputBg  = "#ffffff";
  const inputBdr = isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#d1d5db";
  const inputC   = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#1f2937";

  const inpStyle = {
    backgroundColor: inputBg, border: `1px solid ${inputBdr}`, color: inputC,
    borderRadius: 6, padding: "6px 8px", fontSize: 13, outline: "none", width: "100%",
  };
  const labelStyle = {
    color: subC, fontSize: 10, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.06em", display: "block", marginBottom: 3,
  };

  const fileInputRef = useRef(null);
  const [staged, setStaged] = useState(null);
  const [pendingItems, setPendingItems] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const pendingPreviewUrls = useRef(new Map());

  function getPendingPreviewUrl(item) {
    let url = pendingPreviewUrls.current.get(item.id);
    if (!url) {
      url = URL.createObjectURL(item.photoBlob);
      pendingPreviewUrls.current.set(item.id, url);
    }
    return url;
  }

  useEffect(() => {
    const cache = pendingPreviewUrls.current;
    const liveIds = new Set(pendingItems.map((p) => p.id));
    for (const [id, url] of cache) {
      if (!liveIds.has(id)) { URL.revokeObjectURL(url); cache.delete(id); }
    }
  }, [pendingItems]);

  const refreshPending = useCallback(async () => {
    setPendingItems(await getAllPending());
  }, []);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      const { synced } = await syncPendingQueue();
      if (synced > 0) {
        toast.success(`${synced} Wein${synced > 1 ? "e" : ""} synchronisiert`);
        qc.invalidateQueries({ queryKey: ["wines"] });
      }
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [qc, refreshPending]);

  useEffect(() => {
    refreshPending();
    triggerSync();
    const goOnline = () => { setOnline(true); triggerSync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Registrierte Weine ────────────────────────────────────────────────────
  const { data: wines = [], isLoading } = useQuery({
    queryKey: ["wines"],
    queryFn: () => entities.Wine.list("-created_at"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, quantity }) => entities.Wine.update(id, { quantity }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wines"] }),
    onError: (e) => toast.error("Fehler: " + e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => entities.Wine.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wines"] }); toast.success("Wein gelöscht"); },
    onError: (e) => toast.error("Fehler: " + e.message),
  });

  const totalFlaschen = wines.reduce((sum, w) => sum + (w.quantity || 0), 0);

  // ── Foto aufnehmen → verkleinern → (falls online) KI-Erkennung starten ────
  async function handleFileSelected(file) {
    if (!file) return;
    let resized;
    try {
      resized = await resizeImage(file);
    } catch (e) {
      toast.error(e.message);
      return;
    }
    const id = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(resized);
    setStaged({
      id, blob: resized, previewUrl, quantity: 1, notizen: "",
      identifying: navigator.onLine, aiAttempted: false, ...EMPTY_FIELDS,
    });

    if (navigator.onLine) {
      try {
        const b64 = await fileToBase64(resized);
        const { data, error } = await supabase.functions.invoke("identify-wine", {
          body: { image: b64, mimeType: "image/jpeg" },
        });
        const ok = !error && data?.ok;
        setStaged((prev) => (prev && prev.id === id ? {
          ...prev, identifying: false, aiAttempted: true,
          name: ok ? (data.name || "") : "",
          winzer: ok ? (data.winzer || "") : "",
          jahrgang: ok && data.jahrgang ? String(data.jahrgang) : "",
          rebsorte: ok ? (data.rebsorte || "") : "",
          region: ok ? (data.region || "") : "",
          land: ok ? (data.land || "") : "",
        } : prev));
        if (!ok) toast.info("Etikett nicht erkannt – bitte Angaben ergänzen");
      } catch (_) {
        setStaged((prev) => (prev && prev.id === id ? { ...prev, identifying: false, aiAttempted: true } : prev));
      }
    }
  }

  function setField(k, v) {
    setStaged((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  function cancelStaged() {
    if (staged?.previewUrl) URL.revokeObjectURL(staged.previewUrl);
    setStaged(null);
  }

  async function handleSaveStaged() {
    if (!staged) return;
    const identifiedPayload = staged.aiAttempted ? {
      name: staged.name, winzer: staged.winzer,
      jahrgang: staged.jahrgang ? parseInt(staged.jahrgang, 10) : null,
      rebsorte: staged.rebsorte, region: staged.region, land: staged.land,
    } : null;

    await addPending({
      id: staged.id,
      photoBlob: staged.blob,
      mimeType: "image/jpeg",
      quantity: Math.max(1, parseInt(staged.quantity, 10) || 1),
      notizen: staged.notizen,
      identified: identifiedPayload,
    });
    toast.success(online ? "Wein gespeichert" : "Wein gespeichert – wird synchronisiert sobald online");
    cancelStaged();
    await refreshPending();
    if (online) triggerSync();
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
        <Wrench className="w-4 h-4" style={{ color: subC }} />
        <button onClick={() => navigate("/ArtisTools")} className="text-sm hover:underline"
          style={{ color: subC, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          Artis Tools
        </button>
        <ChevronRight className="w-3 h-3" style={{ color: subC }} />
        <Wine className="w-4 h-4" style={{ color: accent }} />
        <span className="text-sm font-semibold" style={{ color: headingC }}>Weinregister</span>

        <div className="ml-auto flex items-center gap-3">
          {!online && (
            <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full"
              style={{ backgroundColor: "#fde8e8", color: "#b91c1c" }}>
              <WifiOff className="w-3 h-3" /> Offline
            </span>
          )}
          {pendingItems.length > 0 && (
            <button onClick={triggerSync} disabled={syncing || !online}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
              style={{ backgroundColor: accentBg, color: accent, opacity: (syncing || !online) ? 0.6 : 1 }}>
              <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
              {pendingItems.length} ausstehend
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div style={{ maxWidth: 900 }} className="mx-auto">

          {/* ── Foto aufnehmen ───────────────────────────────────────────── */}
          {!staged && (
            <div className="rounded-2xl p-6 mb-6 flex flex-col items-center justify-center text-center"
              style={{ backgroundColor: panelBg, border: `2px dashed ${panelBdr}` }}>
              <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
                style={{ backgroundColor: accentBg }}>
                <Camera className="w-7 h-7" style={{ color: accent }} />
              </div>
              <div className="text-sm font-semibold mb-1" style={{ color: headingC }}>
                Wein fotografieren
              </div>
              <div className="text-xs mb-4" style={{ color: subC }}>
                Etikett fotografieren – die KI erkennt Winzer, Jahrgang & Rebsorte automatisch
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
                className="hidden" onChange={(e) => { handleFileSelected(e.target.files?.[0]); e.target.value = ""; }} />
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: accent }}>
                <Camera className="w-4 h-4" /> Foto aufnehmen
              </button>
            </div>
          )}

          {/* ── Staged: Erkennung + Anzahl + Speichern ──────────────────────── */}
          {staged && (
            <div className="rounded-2xl p-4 mb-6 flex gap-4" style={{ backgroundColor: panelBg, border: `2px solid ${accent}` }}>
              <img src={staged.previewUrl} alt="Wein" className="rounded-xl object-cover flex-shrink-0"
                style={{ width: 110, height: 140 }} />
              <div className="flex-1 min-w-0">
                {staged.identifying && (
                  <div className="flex items-center gap-2 text-xs mb-3" style={{ color: accent }}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Etikett wird erkannt…
                  </div>
                )}
                {!staged.identifying && !online && (
                  <div className="flex items-center gap-2 text-xs mb-3" style={{ color: "#b91c1c" }}>
                    <WifiOff className="w-3.5 h-3.5" /> Offline – wird erkannt, sobald wieder online
                  </div>
                )}
                {!staged.identifying && online && (
                  <div className="flex items-center gap-2 text-xs mb-3" style={{ color: accent }}>
                    <Sparkles className="w-3.5 h-3.5" /> KI-Vorschlag (bei Bedarf anpassen)
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label style={labelStyle}>Name</label>
                    <input style={inpStyle} value={staged.name} placeholder="z.B. Château ..."
                      onChange={(e) => setField("name", e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Winzer / Weingut</label>
                    <input style={inpStyle} value={staged.winzer}
                      onChange={(e) => setField("winzer", e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Jahrgang</label>
                    <input style={inpStyle} type="number" value={staged.jahrgang} placeholder="2019"
                      onChange={(e) => setField("jahrgang", e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Rebsorte</label>
                    <input style={inpStyle} value={staged.rebsorte}
                      onChange={(e) => setField("rebsorte", e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Region</label>
                    <input style={inpStyle} value={staged.region}
                      onChange={(e) => setField("region", e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Land</label>
                    <input style={inpStyle} value={staged.land}
                      onChange={(e) => setField("land", e.target.value)} />
                  </div>
                </div>

                <div className="flex items-end gap-4 mt-3">
                  <div>
                    <label style={labelStyle}>Anzahl Flaschen</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setField("quantity", Math.max(1, (parseInt(staged.quantity, 10) || 1) - 1))}
                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ border: `1px solid ${inputBdr}`, color: headingC }}>
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input style={{ ...inpStyle, width: 56, textAlign: "center" }} type="number" min="1"
                        value={staged.quantity}
                        onChange={(e) => setField("quantity", e.target.value)} />
                      <button onClick={() => setField("quantity", (parseInt(staged.quantity, 10) || 1) + 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ border: `1px solid ${inputBdr}`, color: headingC }}>
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1">
                    <label style={labelStyle}>Notizen (optional)</label>
                    <input style={inpStyle} value={staged.notizen} placeholder="z.B. Fundort, Anlass..."
                      onChange={(e) => setField("notizen", e.target.value)} />
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4">
                  <button onClick={handleSaveStaged}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
                    style={{ backgroundColor: accent }}>
                    Speichern
                  </button>
                  <button onClick={cancelStaged}
                    className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{ border: `1px solid ${inputBdr}`, color: subC }}>
                    Abbrechen
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Ausstehende (noch nicht synchronisierte) Einträge ───────────── */}
          {pendingItems.length > 0 && (
            <div className="mb-6 rounded-xl p-3" style={{ backgroundColor: accentBg, border: `1px solid ${accent}40` }}>
              <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: accent }}>
                Wird synchronisiert ({pendingItems.length})
              </div>
              <div className="flex flex-wrap gap-3">
                {pendingItems.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg"
                    style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}` }}>
                    <img src={getPendingPreviewUrl(p)} alt="" className="w-6 h-8 object-cover rounded" />
                    <span style={{ color: headingC }}>{p.quantity}× Flasche{p.status === "syncing" ? " · wird gesendet…" : online ? "" : " · wartet auf Internet"}</span>
                    {p.status === "syncing" && <Loader2 className="w-3 h-3 animate-spin" style={{ color: accent }} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Registrierte Weine ───────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: subC }}>
              Weinkeller ({wines.length} Wein{wines.length !== 1 ? "e" : ""}, {totalFlaschen} Flaschen)
            </span>
          </div>

          {isLoading && <div className="text-sm text-center py-8" style={{ color: subC }}>Lädt…</div>}
          {!isLoading && wines.length === 0 && (
            <div className="text-sm text-center py-8" style={{ color: subC }}>
              Noch keine Weine registriert. Foto aufnehmen, um zu starten.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {wines.map((w) => (
              <div key={w.id} className="rounded-xl p-3 flex gap-3"
                style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}` }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = rowHover}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = panelBg}>
                {w.photo_url ? (
                  <img src={w.photo_url} alt={w.name} className="rounded-lg object-cover flex-shrink-0" style={{ width: 56, height: 72 }} />
                ) : (
                  <div className="rounded-lg flex items-center justify-center flex-shrink-0" style={{ width: 56, height: 72, backgroundColor: accentBg }}>
                    <Wine className="w-5 h-5" style={{ color: accent }} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: headingC }}>
                    {w.name || "Unbenannter Wein"}
                  </div>
                  <div className="text-xs truncate" style={{ color: subC }}>
                    {[w.winzer, w.jahrgang].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div className="text-xs truncate mb-2" style={{ color: subC }}>
                    {[w.rebsorte, w.region, w.land].filter(Boolean).join(" · ")}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateMut.mutate({ id: w.id, quantity: Math.max(0, (w.quantity || 0) - 1) })}
                      className="w-6 h-6 rounded-md flex items-center justify-center" style={{ border: `1px solid ${panelBdr}`, color: headingC }}>
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-sm font-bold w-6 text-center" style={{ color: accent }}>{w.quantity}</span>
                    <button onClick={() => updateMut.mutate({ id: w.id, quantity: (w.quantity || 0) + 1 })}
                      className="w-6 h-6 rounded-md flex items-center justify-center" style={{ border: `1px solid ${panelBdr}`, color: headingC }}>
                      <Plus className="w-3 h-3" />
                    </button>
                    <button onClick={() => { if (window.confirm(`"${w.name || "Wein"}" löschen?`)) deleteMut.mutate(w.id); }}
                      className="ml-auto p-1 rounded-md" style={{ color: "#d1d5db" }}
                      onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"}
                      onMouseLeave={(e) => e.currentTarget.style.color = "#d1d5db"}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
