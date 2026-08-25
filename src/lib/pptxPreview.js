/**
 * pptxPreview.js — liest eine PowerPoint-Datei (.pptx/.pptm) so weit aus, dass
 * sich daraus eine erkennbare Folie zeichnen laesst.
 *
 * Es ist bewusst KEIN vollstaendiger PowerPoint-Nachbau. Gelesen werden die
 * Dinge, die eine Folie wiedererkennbar machen:
 *   - Foliengroesse und Reihenfolge der Folien
 *   - Textfelder mit ihrer echten Position und Groesse (EMU aus a:xfrm)
 *   - Schrift: fett, kursiv, unterstrichen, Groesse, Farbe, Ausrichtung,
 *     Aufzaehlungsebene
 *   - Bilder aus ppt/media, an ihrer Position
 *   - Tabellen aus p:graphicFrame, als einfache Tabelle
 *   - Notizen zur Folie
 *
 * Nicht gelesen: Animationen, Uebergaenge, Diagramme, SmartArt, Farbverlaeufe,
 * Themenfarben. Fehlt einer Form die Position (typisch bei Platzhaltern), wird
 * sie im Folienlayout und danach im Folienmaster nachgeschlagen -- genau so
 * macht es PowerPoint auch.
 *
 * Laeuft im Hauptthread, weil DOMParser in einem Worker nicht zur Verfuegung
 * steht. Die XML-Teile einer Praesentation sind klein, das faellt nicht auf.
 */
import JSZip from "jszip";

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const MAX_SLIDES = 100;
const EMU_PER_PX = 9525;          // 914400 EMU je Zoll, 96 Pixel je Zoll

const parser = new DOMParser();
const parseXml = (text) => parser.parseFromString(text, "application/xml");

const el  = (node, ns, name) => node?.getElementsByTagNameNS(ns, name)?.[0] || null;
const els = (node, ns, name) => Array.from(node?.getElementsByTagNameNS(ns, name) || []);
// Nur direkte Kinder -- wichtig, damit verschachtelte Gruppen nicht doppelt kommen.
const kids = (node, ns, name) =>
  Array.from(node?.childNodes || []).filter(n => n.nodeType === 1 && n.namespaceURI === ns && n.localName === name);

const px = (emu) => (emu == null ? null : Number(emu) / EMU_PER_PX);

// ── Beziehungen (rels) ───────────────────────────────────────────────────
async function loadRels(zip, partPath) {
  const dir  = partPath.slice(0, partPath.lastIndexOf("/"));
  const base = partPath.slice(partPath.lastIndexOf("/") + 1);
  const file = zip.file(`${dir}/_rels/${base}.rels`);
  const map = {};
  if (!file) return map;
  const doc = parseXml(await file.async("string"));
  for (const r of Array.from(doc.getElementsByTagName("Relationship"))) {
    map[r.getAttribute("Id")] = {
      type: r.getAttribute("Type") || "",
      target: resolvePath(dir, r.getAttribute("Target") || ""),
    };
  }
  return map;
}

// "ppt/slides" + "../media/image1.png" -> "ppt/media/image1.png"
function resolvePath(dir, target) {
  if (/^https?:/i.test(target)) return target;
  const parts = (dir + "/" + target).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop(); else out.push(p);
  }
  return out.join("/");
}

// ── Farbe und Text ───────────────────────────────────────────────────────
function colorOf(node) {
  if (!node) return null;
  const srgb = el(node, NS_A, "srgbClr");
  if (srgb) return "#" + srgb.getAttribute("val");
  const sys = el(node, NS_A, "sysClr");
  if (sys?.getAttribute("lastClr")) return "#" + sys.getAttribute("lastClr");
  return null;   // Themenfarben lassen wir bewusst aus
}

function runStyle(rPr) {
  if (!rPr) return {};
  const st = {};
  if (rPr.getAttribute("b") === "1") st.bold = true;
  if (rPr.getAttribute("i") === "1") st.italic = true;
  const u = rPr.getAttribute("u");
  if (u && u !== "none") st.underline = true;
  if (rPr.getAttribute("strike") && rPr.getAttribute("strike") !== "noStrike") st.strike = true;
  const sz = rPr.getAttribute("sz");
  if (sz) st.size = Number(sz) / 100;              // Hundertstel Punkt
  const c = colorOf(el(rPr, NS_A, "solidFill"));
  if (c) st.color = c;
  const latin = el(rPr, NS_A, "latin");
  if (latin?.getAttribute("typeface")) st.font = latin.getAttribute("typeface");
  return st;
}

function readTextBody(txBody) {
  if (!txBody) return [];
  return kids(txBody, NS_A, "p").map((p) => {
    const pPr = el(p, NS_A, "pPr");
    const runs = [];
    for (const node of Array.from(p.childNodes)) {
      if (node.nodeType !== 1 || node.namespaceURI !== NS_A) continue;
      if (node.localName === "r") {
        const t = el(node, NS_A, "t");
        runs.push({ text: t?.textContent || "", ...runStyle(el(node, NS_A, "rPr")) });
      } else if (node.localName === "br") {
        runs.push({ text: "\n" });
      } else if (node.localName === "fld") {
        const t = el(node, NS_A, "t");
        if (t?.textContent) runs.push({ text: t.textContent, ...runStyle(el(node, NS_A, "rPr")) });
      }
    }
    const bullet = !el(pPr, NS_A, "buNone") && (!!el(pPr, NS_A, "buChar") || !!el(pPr, NS_A, "buAutoNum"));
    return {
      runs,
      level: Number(pPr?.getAttribute("lvl") || 0),
      align: pPr?.getAttribute("algn") || null,      // l | ctr | r | just
      bullet,
    };
  }).filter(p => p.runs.length);
}

// ── Position, notfalls aus Layout oder Master ────────────────────────────
function xfrmOf(sp) {
  // Formen und Bilder tragen die Position in p:spPr > a:xfrm, Rahmen fuer
  // Tabellen und Diagramme dagegen direkt in p:xfrm.
  const spPr = el(sp, NS_P, "spPr") || el(sp, NS_P, "grpSpPr");
  const xfrm = el(spPr, NS_A, "xfrm") || el(sp, NS_P, "xfrm");
  if (!xfrm) return null;
  const off = el(xfrm, NS_A, "off"), ext = el(xfrm, NS_A, "ext");
  if (!off || !ext) return null;
  return {
    x: px(off.getAttribute("x")), y: px(off.getAttribute("y")),
    w: px(ext.getAttribute("cx")), h: px(ext.getAttribute("cy")),
    rot: Number(xfrm.getAttribute("rot") || 0) / 60000,
  };
}

function placeholderOf(sp) {
  const ph = el(sp, NS_P, "ph");
  if (!ph) return null;
  return { type: ph.getAttribute("type") || "body", idx: ph.getAttribute("idx") || null };
}

// Im Layout bzw. Master die Form mit demselben Platzhalter suchen.
function findPlaceholderXfrm(doc, want) {
  if (!doc || !want) return null;
  for (const sp of els(doc, NS_P, "sp")) {
    const ph = placeholderOf(sp);
    if (!ph) continue;
    const sameIdx  = want.idx != null && ph.idx === want.idx;
    const sameType = want.idx == null && ph.type === want.type;
    if (sameIdx || sameType) {
      const x = xfrmOf(sp);
      if (x) return x;
    }
  }
  return null;
}

// ── Eine Folie einlesen ──────────────────────────────────────────────────
async function readSlide(zip, slidePath, mediaCache) {
  const file = zip.file(slidePath);
  if (!file) return null;
  const doc  = parseXml(await file.async("string"));
  const rels = await loadRels(zip, slidePath);

  // Layout und Master fuer fehlende Platzhalter-Positionen.
  let layoutDoc = null, masterDoc = null;
  const layoutRel = Object.values(rels).find(r => r.type.endsWith("/slideLayout"));
  if (layoutRel && zip.file(layoutRel.target)) {
    layoutDoc = parseXml(await zip.file(layoutRel.target).async("string"));
    const layoutRels = await loadRels(zip, layoutRel.target);
    const masterRel = Object.values(layoutRels).find(r => r.type.endsWith("/slideMaster"));
    if (masterRel && zip.file(masterRel.target)) {
      masterDoc = parseXml(await zip.file(masterRel.target).async("string"));
    }
  }

  const tree = el(doc, NS_P, "cSld") && el(el(doc, NS_P, "cSld"), NS_P, "spTree");
  const shapes = [];

  const place = (node) => {
    let box = xfrmOf(node);
    if (!box) {
      const ph = placeholderOf(node);
      box = findPlaceholderXfrm(layoutDoc, ph) || findPlaceholderXfrm(masterDoc, ph);
    }
    return box;
  };

  const walk = (parent) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== 1 || node.namespaceURI !== NS_P) continue;

      if (node.localName === "grpSp") { walk(node); continue; }

      if (node.localName === "sp") {
        const paras = readTextBody(el(node, NS_P, "txBody"));
        if (!paras.length) continue;
        shapes.push({ kind: "text", box: place(node), paras });
        continue;
      }

      if (node.localName === "pic") {
        const blip = el(node, NS_A, "blip");
        const id = blip?.getAttributeNS(NS_R, "embed");
        const target = id && rels[id]?.target;
        if (target) shapes.push({ kind: "image", box: place(node), src: target });
        continue;
      }

      if (node.localName === "graphicFrame") {
        const tbl = el(node, NS_A, "tbl");
        if (!tbl) continue;
        const rows = kids(tbl, NS_A, "tr").map(tr =>
          kids(tr, NS_A, "tc").map(tc => ({
            paras: readTextBody(el(tc, NS_A, "txBody")),
            colSpan: Number(tc.getAttribute("gridSpan") || 1),
            merged: tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1",
          })),
        );
        // Spaltenbreiten aus dem Raster, damit die Tabelle nicht gleichmaessig
        // verteilt wird, sondern so aussieht wie in PowerPoint.
        const grid = kids(el(tbl, NS_A, "tblGrid"), NS_A, "gridCol")
          .map(g => px(g.getAttribute("w")));
        if (rows.length) shapes.push({ kind: "table", box: place(node), rows, grid });
      }
    }
  };
  if (tree) walk(tree);

  // Bilder einmalig als data:-URL bereitstellen.
  for (const sh of shapes) {
    if (sh.kind !== "image") continue;
    if (!mediaCache.has(sh.src)) {
      const mf = zip.file(sh.src);
      mediaCache.set(sh.src, mf ? await asDataUrl(mf, sh.src) : null);
    }
    sh.url = mediaCache.get(sh.src);
  }

  // Notizen, falls vorhanden.
  let notes = "";
  const notesRel = Object.values(rels).find(r => r.type.endsWith("/notesSlide"));
  if (notesRel && zip.file(notesRel.target)) {
    const nd = parseXml(await zip.file(notesRel.target).async("string"));
    notes = els(nd, NS_A, "t").map(t => t.textContent).join(" ").trim();
  }

  return { shapes: shapes.filter(s => s.box), notes };
}

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  bmp: "image/bmp", svg: "image/svg+xml", webp: "image/webp", tiff: "image/tiff", emf: null, wmf: null,
};

async function asDataUrl(zipFile, name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const mime = MIME[ext];
  if (!mime) return null;                 // EMF/WMF kann der Browser nicht zeigen
  const b64 = await zipFile.async("base64");
  return `data:${mime};base64,${b64}`;
}

// ── Einstieg ─────────────────────────────────────────────────────────────
export async function parsePptx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const presFile = zip.file("ppt/presentation.xml");
  if (!presFile) throw new Error("Das ist keine lesbare PowerPoint-Datei.");
  const pres = parseXml(await presFile.async("string"));
  const rels = await loadRels(zip, "ppt/presentation.xml");

  const sz = el(pres, NS_P, "sldSz");
  const width  = px(sz?.getAttribute("cx")) || 960;
  const height = px(sz?.getAttribute("cy")) || 540;

  // Reihenfolge steht in sldIdLst, nicht in der Dateinummerierung.
  const order = els(pres, NS_P, "sldId")
    .map(s => rels[s.getAttributeNS(NS_R, "id")]?.target)
    .filter(Boolean);
  const paths = order.length
    ? order
    : Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort();

  const mediaCache = new Map();
  const slides = [];
  for (const p of paths.slice(0, MAX_SLIDES)) {
    const s = await readSlide(zip, p, mediaCache);
    if (s) slides.push(s);
  }
  if (!slides.length) throw new Error("Die Praesentation enthaelt keine lesbaren Folien.");

  return { width, height, slides, truncated: paths.length > MAX_SLIDES };
}
