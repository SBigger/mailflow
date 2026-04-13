import React, { useState, useRef, useCallback, useEffect, useContext, useMemo } from "react";
import { Stage, Layer, Line, Rect, Image as KonvaImage } from "react-konva";
import { getStroke } from "perfect-freehand";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
import {
  ArrowLeft, Pen, Eraser, Hand, ZoomIn, ZoomOut, Save, Download, Upload,
  FileText, Plus, Trash2, ChevronLeft, ChevronRight, Maximize2, Undo2, Redo2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

// ── A4 Dimensionen (96 DPI) ─────────────────────────────────
const A4_W = 794;
const A4_H = 1123;

// ── perfect-freehand Optionen ────────────────────────────────
const PEN_OPTIONS = {
  size: 3, thinning: 0.5, smoothing: 0.5, streamline: 0.5,
  easing: (t) => t, start: { taper: 0, cap: true }, end: { taper: 0, cap: true },
};
const ERASER_SIZE = 20;

// ── SVG-Path aus perfect-freehand Punkten ────────────────────
function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

// ── Strich-Komponente (perfect-freehand gerendert als Konva Shape) ──
function FreehandLine({ points, color, options, opacity }) {
  // points ist ein flaches Array [x,y,pressure, x,y,pressure, ...]
  // getStroke erwartet [[x,y,pressure], ...]
  const pointArrays = [];
  for (let i = 0; i < points.length; i += 3) {
    pointArrays.push([points[i], points[i + 1], points[i + 2]]);
  }
  const stroke = getStroke(pointArrays, options || PEN_OPTIONS);
  if (stroke.length < 2) return null;
  const flatPoints = [];
  for (const [x, y] of stroke) { flatPoints.push(x, y); }
  return (
    <Line points={flatPoints} fill={color || "#000"} opacity={opacity != null ? opacity : 1} closed tension={0} listening={false} />
  );
}

// ══════════════════════════════════════════════════════════════
export default function Whiteboard() {
  const { theme } = useContext(ThemeContext);
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const queryClient = useQueryClient();
  const stageRef  = useRef(null);
  const containerRef = useRef(null);

  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const accent  = isArtis ? "#4a7a4f" : "#6366f1";
  const bgColor = isArtis ? "#f8faf8" : isLight ? "#f8f8fc" : "#18181b";
  const cardBg  = isArtis ? "#fff" : isLight ? "#fff" : "#27272a";
  const border  = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "#3f3f46";
  const textMain = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";

  // ── State ──────────────────────────────────────────────────
  const [tool, setTool]           = useState("pen");      // pen | eraser | hand
  const [penColor, setPenColor]   = useState("#000000");
  const [penSize, setPenSize]     = useState(3);
  const [penOpacity, setPenOpacity] = useState(1);
  const [mode, setMode]           = useState("infinite");  // infinite | a4
  const [lines, setLines]         = useState([]);          // {points, color, size, page}
  const [currentLine, setCurrentLine] = useState(null);
  const [history, setHistory]     = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [scale, setScale]         = useState(1);
  const [position, setPosition]   = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 });
  const [page, setPage]           = useState(0);           // A4-Seite (0-basiert)
  const [pageCount, setPageCount] = useState(1);
  const [pdfPages, setPdfPages]   = useState([]);          // {page, image (HTMLImageElement)}
  const [isDrawing, setIsDrawing] = useState(false);

  // ── Whiteboard-Liste & aktuelles Board ─────────────────────
  const [boardId, setBoardId]       = useState(null);
  const [boardName, setBoardName]   = useState("Neues Whiteboard");
  const [customerId, setCustomerId] = useState("");
  const [saving, setSaving]         = useState(false);
  const [showList, setShowList]     = useState(true);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-wb"],
    queryFn: async () => {
      const { data: wbs } = await supabase.from("whiteboards").select("customer_id");
      const ids = [...new Set((wbs || []).map(w => w.customer_id).filter(Boolean))];
      if (ids.length === 0) return [];
      const { data } = await supabase.from("customers").select("id, company_name").in("id", ids).order("company_name");
      return data || [];
    },
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ["customers-wb-all"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, company_name").order("company_name");
      return data || [];
    },
  });

  const { data: boards = [], refetch: refetchBoards } = useQuery({
    queryKey: ["whiteboards", customerId],
    queryFn: async () => {
      let q = supabase.from("whiteboards").select("id, name, customer_id, updated_at, thumbnail").order("updated_at", { ascending: false });
      if (customerId) q = q.eq("customer_id", customerId);
      const { data } = await q;
      return data || [];
    },
  });

  // ── Resize ─────────────────────────────────────────────────
  useEffect(() => {
    function onResize() {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setStageSize({ w: r.width, h: r.height });
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [showList]);

  // ── Zeichnen ───────────────────────────────────────────────
  const handlePointerDown = useCallback((e) => {
    if (tool === "hand") return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    const x = (pos.x - position.x) / scale;
    const y = (pos.y - position.y) / scale;

    if (tool === "eraser") {
      // Linien im Radierer-Bereich entfernen
      setLines(prev => {
        const remaining = prev.filter(line => {
          if (mode === "a4" && line.page !== page) return true;
          return !line.points.some((p, i) => {
            if (i % 3 !== 0) return false;
            const dx = p - x, dy = line.points[i + 1] - y;
            return Math.sqrt(dx * dx + dy * dy) < ERASER_SIZE;
          });
        });
        if (remaining.length !== prev.length) {
          setHistory(h => [...h, prev]);
          setRedoStack([]);
        }
        return remaining;
      });
      return;
    }

    setIsDrawing(true);
    setCurrentLine({ points: [x, y, 0.5], color: penColor, size: penSize, opacity: penOpacity, page: mode === "a4" ? page : 0 });
  }, [tool, penColor, penSize, position, scale, mode, page]);

  const handlePointerMove = useCallback((e) => {
    if (!isDrawing || tool !== "pen") return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    const x = (pos.x - position.x) / scale;
    const y = (pos.y - position.y) / scale;
    const pressure = e.evt?.pressure || 0.5;
    setCurrentLine(prev => prev ? { ...prev, points: [...prev.points, x, y, pressure] } : null);
  }, [isDrawing, tool, position, scale]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawing || !currentLine) { setIsDrawing(false); return; }
    setHistory(h => [...h, lines]);
    setRedoStack([]);
    setLines(prev => [...prev, currentLine]);
    setCurrentLine(null);
    setIsDrawing(false);
  }, [isDrawing, currentLine, lines]);

  // ── Undo / Redo ────────────────────────────────────────────
  const undo = useCallback(() => {
    if (history.length === 0) return;
    setRedoStack(r => [...r, lines]);
    setLines(history[history.length - 1]);
    setHistory(h => h.slice(0, -1));
  }, [history, lines]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    setHistory(h => [...h, lines]);
    setLines(redoStack[redoStack.length - 1]);
    setRedoStack(r => r.slice(0, -1));
  }, [redoStack, lines]);

  // ── Zoom ───────────────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.evt.preventDefault();
    const scaleBy = 1.08;
    const oldScale = scale;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.1, Math.min(5, newScale));
    const pointer = e.target.getStage().getPointerPosition();
    const mx = pointer.x / oldScale - position.x / oldScale;
    const my = pointer.y / oldScale - position.y / oldScale;
    setScale(clampedScale);
    setPosition({ x: -(mx - pointer.x / clampedScale) * clampedScale, y: -(my - pointer.y / clampedScale) * clampedScale });
  }, [scale, position]);

  // ── Keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.key === "z") { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === "y") { e.preventDefault(); redo(); }
      if (e.key === "p" && !e.ctrlKey) setTool("pen");
      if (e.key === "e" && !e.ctrlKey) setTool("eraser");
      if (e.key === "h" && !e.ctrlKey) setTool("hand");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ── Sichtbare Linien (im A4-Modus nur aktuelle Seite) ─────
  const visibleLines = useMemo(() => {
    if (mode === "infinite") return lines;
    return lines.filter(l => l.page === page);
  }, [lines, mode, page]);

  // ── PDF-Hintergrundbild fuer aktuelle Seite ────────────────
  const pdfBg = useMemo(() => {
    return pdfPages.find(p => p.page === page)?.image || null;
  }, [pdfPages, page]);

  // ── PDF Import ─────────────────────────────────────────────
  const importPdf = useCallback(async (file) => {
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const vp = pg.getViewport({ scale: A4_W / pg.getViewport({ scale: 1 }).width });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        await pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        const img = new window.Image();
        img.src = canvas.toDataURL("image/png");
        await new Promise(res => { img.onload = res; });
        pages.push({ page: i - 1, image: img });
      }
      setPdfPages(pages);
      setPageCount(Math.max(pageCount, pdf.numPages));
      setMode("a4");
      setPage(0);
      toast.success(`${pdf.numPages} PDF-Seiten importiert`);
    } catch (e) {
      toast.error("PDF Import fehlgeschlagen: " + e.message);
    }
  }, [pageCount]);

  // ── PDF Export ─────────────────────────────────────────────
  const exportPdf = useCallback(async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "px", format: [A4_W, A4_H] });
    const exportPages = mode === "a4" ? pageCount : 1;

    for (let p = 0; p < exportPages; p++) {
      if (p > 0) doc.addPage([A4_W, A4_H]);

      // Temporaeres Stage rendern
      const offscreen = document.createElement("div");
      offscreen.style.cssText = "position:absolute;left:-9999px;top:-9999px";
      document.body.appendChild(offscreen);

      const { default: Konva } = await import("konva");
      const tmpStage = new Konva.Stage({ container: offscreen, width: A4_W, height: A4_H });
      const tmpLayer = new Konva.Layer();
      tmpStage.add(tmpLayer);

      // Weisser Hintergrund
      tmpLayer.add(new Konva.Rect({ x: 0, y: 0, width: A4_W, height: A4_H, fill: "#fff" }));

      // PDF-Hintergrund
      const pdfBgForPage = pdfPages.find(pg => pg.page === p);
      if (pdfBgForPage) {
        tmpLayer.add(new Konva.Image({ image: pdfBgForPage.image, x: 0, y: 0, width: A4_W, height: A4_H }));
      }

      // Zeichnungen
      const pageLines = mode === "a4" ? lines.filter(l => l.page === p) : lines;
      for (const line of pageLines) {
        const stroke = getStroke(
          // points in Triplets (x, y, pressure)
          Array.from({ length: line.points.length / 3 }, (_, i) => [line.points[i * 3], line.points[i * 3 + 1], line.points[i * 3 + 2]]),
          { ...PEN_OPTIONS, size: line.size || 3 }
        );
        if (stroke.length < 2) continue;
        const flat = [];
        for (const [x, y] of stroke) flat.push(x, y);
        tmpLayer.add(new Konva.Line({ points: flat, fill: line.color, opacity: line.opacity != null ? line.opacity : 1, closed: true, tension: 0 }));
      }
      tmpLayer.draw();

      const dataUrl = tmpStage.toDataURL({ pixelRatio: 2 });
      doc.addImage(dataUrl, "PNG", 0, 0, A4_W, A4_H);
      tmpStage.destroy();
      document.body.removeChild(offscreen);
    }

    doc.save(`${boardName || "whiteboard"}.pdf`);
    toast.success("PDF exportiert");
  }, [lines, mode, pageCount, pdfPages, boardName]);

  // ── Speichern ──────────────────────────────────────────────
  const saveBoard = useCallback(async () => {
    setSaving(true);
    try {
      const data = { lines, mode, pageCount, page };
      // Thumbnail vom aktuellen Stage
      let thumbnail = null;
      if (stageRef.current) {
        thumbnail = stageRef.current.toDataURL({ pixelRatio: 0.2 });
      }

      if (boardId) {
        await supabase.from("whiteboards").update({ name: boardName, customer_id: customerId || null, data, thumbnail, updated_at: new Date().toISOString() }).eq("id", boardId);
      } else {
        const { data: row } = await supabase.from("whiteboards").insert({
          name: boardName, customer_id: customerId || null, data, thumbnail,
          created_by: user?.id,
        }).select("id").single();
        if (row) setBoardId(row.id);
      }
      toast.success("Gespeichert");
      refetchBoards();
      queryClient.invalidateQueries({ queryKey: ["customers-wb"] });
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setSaving(false);
    }
  }, [boardId, boardName, customerId, lines, mode, pageCount, page, user, refetchBoards]);

  // ── Board laden ────────────────────────────────────────────
  const loadBoard = useCallback(async (id) => {
    const { data: row } = await supabase.from("whiteboards").select("*").eq("id", id).single();
    if (!row) return;
    setBoardId(row.id);
    setBoardName(row.name);
    setCustomerId(row.customer_id || "");
    setLines(row.data?.lines || []);
    setMode(row.data?.mode || "infinite");
    setPageCount(row.data?.pageCount || 1);
    setPage(row.data?.page || 0);
    setPdfPages([]);
    setHistory([]);
    setRedoStack([]);
    setShowList(false);
  }, []);

  // ── Neues Board ────────────────────────────────────────────
  const newBoard = useCallback(() => {
    setBoardId(null);
    setBoardName("Neues Whiteboard");
    setLines([]);
    setPdfPages([]);
    setHistory([]);
    setRedoStack([]);
    setMode("infinite");
    setPage(0);
    setPageCount(1);
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setShowList(false);
  }, []);

  // ── Board loeschen ─────────────────────────────────────────
  const deleteBoard = useCallback(async (id) => {
    if (!window.confirm("Whiteboard wirklich loeschen?")) return;
    await supabase.from("whiteboards").delete().eq("id", id);
    refetchBoards();
    if (boardId === id) newBoard();
    toast.success("Geloescht");
  }, [boardId, newBoard, refetchBoards]);

  // ── Farben ─────────────────────────────────────────────────
  const [showPalette, setShowPalette] = useState(false);
  const COLOR_ROWS = [
    // Kräftig
    ["#000000", "#374151", "#64748b", "#ffffff"],
    ["#dc2626", "#ea580c", "#d97706", "#ca8a04"],
    ["#16a34a", "#0d9488", "#2563eb", "#7c3aed"],
    ["#db2777", "#e11d48", "#8b5cf6", "#6366f1"],
    // Pastell
    ["#fca5a5", "#fdba74", "#fde68a", "#fef08a"],
    ["#bbf7d0", "#a7f3d0", "#99f6e4", "#a5f3fc"],
    ["#bfdbfe", "#c7d2fe", "#ddd6fe", "#e9d5ff"],
    ["#fbcfe8", "#fecdd3", "#fed7aa", "#fef9c3"],
  ];

  // ── Styles ─────────────────────────────────────────────────
  const btnStyle = (active) => ({
    background: active ? accent : "transparent", color: active ? "#fff" : textMain,
    border: `1px solid ${active ? accent : border}`, borderRadius: 8, padding: "6px 8px",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    transition: "all 0.15s",
  });

  const pdfInputRef = useRef(null);

  // ════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════

  if (showList) {
    return (
      <div style={{ background: bgColor, minHeight: "100vh", padding: 24, fontFamily: "Segoe UI, system-ui, sans-serif" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => navigate("/ArtisTools")} style={{ ...btnStyle(false), padding: 8 }}><ArrowLeft size={16} /></button>
              <h1 style={{ color: textMain, fontSize: 20, fontWeight: 700, margin: 0 }}>Whiteboard</h1>
            </div>
            <button onClick={newBoard} style={{ ...btnStyle(true), gap: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600 }}>
              <Plus size={14} /> Neues Whiteboard
            </button>
          </div>

          {/* Kunde Filter */}
          <div style={{ marginBottom: 16 }}>
            <select value={customerId} onChange={e => setCustomerId(e.target.value)}
              style={{ background: cardBg, border: `1px solid ${border}`, color: textMain, borderRadius: 8, padding: "8px 12px", fontSize: 13, width: 300 }}>
              <option value="">Alle Kunden</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>

          {/* Board-Liste */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {boards.map(b => (
              <div key={b.id} onClick={() => loadBoard(b.id)}
                style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: 16, cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = accent}
                onMouseLeave={e => e.currentTarget.style.borderColor = border}>
                {b.thumbnail && (
                  <img src={b.thumbnail} alt="" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, marginBottom: 10, background: "#f0f0f0" }} />
                )}
                <div style={{ color: textMain, fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{b.name}</div>
                <div style={{ color: textMuted, fontSize: 11 }}>
                  {new Date(b.updated_at).toLocaleDateString("de-CH")} {new Date(b.updated_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteBoard(b.id); }}
                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", marginTop: 8, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                  <Trash2 size={12} /> Loeschen
                </button>
              </div>
            ))}
            {boards.length === 0 && (
              <div style={{ color: textMuted, fontSize: 13, padding: 40, textAlign: "center", gridColumn: "1 / -1" }}>
                Noch keine Whiteboards. Klicke auf "Neues Whiteboard" um loszulegen.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: bgColor, fontFamily: "Segoe UI, system-ui, sans-serif" }}>
      {/* ── Toolbar ────────────────────────────────────────── */}
      <div style={{ background: cardBg, borderBottom: `1px solid ${border}`, padding: "6px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        {/* Zurueck */}
        <button onClick={() => setShowList(true)} style={btnStyle(false)} title="Zurueck"><ArrowLeft size={15} /></button>

        {/* Board-Name */}
        <input value={boardName} onChange={e => setBoardName(e.target.value)}
          style={{ background: "transparent", border: "none", color: textMain, fontWeight: 600, fontSize: 14, width: 200, outline: "none" }} />

        <div style={{ width: 1, height: 24, background: border, margin: "0 4px" }} />

        {/* Werkzeuge */}
        <button onClick={() => setTool("pen")} style={btnStyle(tool === "pen")} title="Stift (P)"><Pen size={15} /></button>
        <button onClick={() => setTool("eraser")} style={btnStyle(tool === "eraser")} title="Radierer (E)"><Eraser size={15} /></button>
        <button onClick={() => setTool("hand")} style={btnStyle(tool === "hand")} title="Verschieben (H)"><Hand size={15} /></button>

        <div style={{ width: 1, height: 24, background: border, margin: "0 4px" }} />

        {/* Farben - aktuelle Farbe + Faecher */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowPalette(p => !p)}
            style={{ width: 28, height: 28, borderRadius: "50%", background: penColor, border: `3px solid ${accent}`, cursor: "pointer", padding: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
            title="Farbpalette" />
          {showPalette && (
            <div style={{
              position: "absolute", top: 36, left: 0, zIndex: 100,
              background: cardBg, border: `1px solid ${border}`, borderRadius: 12,
              padding: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", minWidth: 160,
            }}>
              {COLOR_ROWS.map((row, ri) => (
                <div key={ri} style={{ display: "flex", gap: 4, marginBottom: ri === 3 ? 6 : 3 }}>
                  {row.map(c => (
                    <button key={c} onClick={() => { setPenColor(c); setTool("pen"); setShowPalette(false); }}
                      style={{
                        width: 26, height: 26, borderRadius: 6,
                        background: c, cursor: "pointer", padding: 0,
                        border: penColor === c ? `3px solid ${accent}` : c === "#ffffff" ? `2px solid ${border}` : "2px solid transparent",
                        transition: "transform 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.transform = "scale(1.2)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                    />
                  ))}
                </div>
              ))}
              {/* Custom Color */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, borderTop: `1px solid ${border}`, paddingTop: 6 }}>
                <input type="color" value={penColor} onChange={e => { setPenColor(e.target.value); setTool("pen"); }}
                  style={{ width: 26, height: 26, border: "none", padding: 0, cursor: "pointer", borderRadius: 4 }} />
                <span style={{ color: textMuted, fontSize: 11 }}>Eigene Farbe</span>
              </div>
            </div>
          )}
        </div>

        {/* Stiftgroesse */}
        <input type="range" min="1" max="12" value={penSize} onChange={e => setPenSize(Number(e.target.value))}
          style={{ width: 70, accentColor: accent }} title={`Stiftgroesse: ${penSize}`} />

        {/* Deckkraft */}
        <input type="range" min="0.05" max="1" step="0.05" value={penOpacity} onChange={e => setPenOpacity(Number(e.target.value))}
          style={{ width: 60, accentColor: accent }} title={`Deckkraft: ${Math.round(penOpacity * 100)}%`} />
        <span style={{ color: textMuted, fontSize: 10, minWidth: 28 }}>{Math.round(penOpacity * 100)}%</span>

        <div style={{ width: 1, height: 24, background: border, margin: "0 4px" }} />

        {/* Undo/Redo */}
        <button onClick={undo} disabled={history.length === 0} style={{ ...btnStyle(false), opacity: history.length === 0 ? 0.3 : 1 }} title="Rueckgaengig (Ctrl+Z)"><Undo2 size={15} /></button>
        <button onClick={redo} disabled={redoStack.length === 0} style={{ ...btnStyle(false), opacity: redoStack.length === 0 ? 0.3 : 1 }} title="Wiederherstellen (Ctrl+Y)"><Redo2 size={15} /></button>

        <div style={{ width: 1, height: 24, background: border, margin: "0 4px" }} />

        {/* Modus */}
        <select value={mode} onChange={e => { setMode(e.target.value); setPage(0); }}
          style={{ background: cardBg, border: `1px solid ${border}`, color: textMain, borderRadius: 6, padding: "4px 8px", fontSize: 12 }}>
          <option value="infinite">Endlos-Canvas</option>
          <option value="a4">A4 Seiten</option>
        </select>

        {/* A4 Seiten-Navigation */}
        {mode === "a4" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...btnStyle(false), opacity: page === 0 ? 0.3 : 1 }}><ChevronLeft size={14} /></button>
            <span style={{ color: textMain, fontSize: 12, minWidth: 50, textAlign: "center" }}>
              {page + 1} / {pageCount}
            </span>
            <button onClick={() => { if (page >= pageCount - 1) setPageCount(c => c + 1); setPage(p => p + 1); }} style={btnStyle(false)}><ChevronRight size={14} /></button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Zoom */}
        <button onClick={() => setScale(s => Math.min(5, s * 1.2))} style={btnStyle(false)} title="Zoom +"><ZoomIn size={15} /></button>
        <span style={{ color: textMuted, fontSize: 11, minWidth: 40, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale(s => Math.max(0.1, s / 1.2))} style={btnStyle(false)} title="Zoom -"><ZoomOut size={15} /></button>
        <button onClick={() => { setScale(1); setPosition({ x: 0, y: 0 }); }} style={btnStyle(false)} title="Zuruecksetzen"><Maximize2 size={15} /></button>

        <div style={{ width: 1, height: 24, background: border, margin: "0 4px" }} />

        {/* PDF Import/Export */}
        <input ref={pdfInputRef} type="file" accept=".pdf" style={{ display: "none" }}
          onChange={e => { if (e.target.files[0]) importPdf(e.target.files[0]); e.target.value = ""; }} />
        <button onClick={() => pdfInputRef.current?.click()} style={btnStyle(false)} title="PDF importieren"><Upload size={15} /></button>
        <button onClick={exportPdf} style={btnStyle(false)} title="PDF exportieren"><Download size={15} /></button>

        {/* Kunde */}
        <select value={customerId} onChange={e => setCustomerId(e.target.value)}
          style={{ background: cardBg, border: `1px solid ${border}`, color: customerId ? textMain : textMuted, borderRadius: 6, padding: "4px 8px", fontSize: 12, maxWidth: 160 }}>
          <option value="">Kein Kunde</option>
          {allCustomers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>

        {/* Speichern */}
        <button onClick={saveBoard} disabled={saving} style={{ ...btnStyle(true), gap: 5, padding: "6px 14px", fontSize: 12, fontWeight: 600 }}>
          <Save size={14} /> {saving ? "..." : "Speichern"}
        </button>
      </div>

      {/* ── Canvas ─────────────────────────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, overflow: "hidden", cursor: tool === "hand" ? "grab" : tool === "eraser" ? "crosshair" : "crosshair" }}>
        <Stage
          ref={stageRef}
          width={stageSize.w}
          height={stageSize.h}
          scaleX={scale}
          scaleY={scale}
          x={position.x}
          y={position.y}
          draggable={tool === "hand"}
          onDragEnd={(e) => setPosition({ x: e.target.x(), y: e.target.y() })}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <Layer>
            {/* A4-Seitenhintergrund */}
            {mode === "a4" && (
              <Rect x={0} y={0} width={A4_W} height={A4_H} fill="#ffffff" stroke="#e0e0e0" strokeWidth={1} shadowColor="#00000022" shadowBlur={8} />
            )}

            {/* PDF-Hintergrundbild */}
            {pdfBg && (
              <KonvaImage image={pdfBg} x={0} y={0} width={A4_W} height={A4_H} listening={false} />
            )}

            {/* Gespeicherte Linien */}
            {visibleLines.map((line, i) => (
              <FreehandLine key={i} points={line.points} color={line.color} opacity={line.opacity} options={{ ...PEN_OPTIONS, size: line.size || 3 }} />
            ))}

            {/* Aktuelle Linie (wird gerade gezeichnet) */}
            {currentLine && (
              <FreehandLine points={currentLine.points} color={currentLine.color} opacity={currentLine.opacity} options={{ ...PEN_OPTIONS, size: currentLine.size || 3 }} />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
