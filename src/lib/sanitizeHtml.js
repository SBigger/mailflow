/**
 * Minimaler Allowlist-Sanitizer fuer HTML, das die KI erzeugt.
 *
 * Der KI-Assistent laesst Claude bewusst HTML ausgeben und rendert es mit
 * dangerouslySetInnerHTML. In dieses HTML fliessen auch Tool-Ergebnisse aus der
 * Datenbank ein (Kundennotizen, Dateinamen, Belegtexte). Enthaelt so ein Feld
 * Markup, landet es sonst ungefiltert im DOM. Darum: nur bekannte Tags und
 * Attribute durchlassen, alles andere verwerfen.
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'SPAN', 'DIV',
  'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'CODE', 'PRE', 'BLOCKQUOTE', 'HR', 'SMALL', 'SUP', 'SUB',
]);

const ALLOWED_ATTRS = new Set(['colspan', 'rowspan', 'title']);

/**
 * Entfernt aus einem HTML-Fragment alles, was nicht auf der Allowlist steht.
 * Text bleibt erhalten, auch wenn das umgebende Tag verworfen wird.
 *
 * @param {string} html rohes HTML-Fragment
 * @returns {string} bereinigtes HTML
 */
export function sanitizeAiHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return '';
  if (typeof window === 'undefined' || !window.DOMParser) return escapeHtml(html);

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}

function clean(node) {
  // Rueckwaerts, weil unwrap/remove die Kinderliste veraendert.
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i];

    if (child.nodeType === 3) continue;          // Text
    if (child.nodeType !== 1) { child.remove(); continue; }  // Kommentare etc.

    const tag = child.tagName;

    // Script/Style/iframe & Co. samt Inhalt entfernen - deren Text ist Code,
    // nicht Inhalt, und darf beim Auspacken nicht sichtbar werden.
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' ||
        tag === 'OBJECT' || tag === 'EMBED' || tag === 'LINK' || tag === 'META') {
      child.remove();
      continue;
    }

    clean(child);

    if (!ALLOWED_TAGS.has(tag)) {
      // Unbekanntes Tag auspacken: Kinder an seine Stelle setzen.
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      child.remove();
      continue;
    }

    for (const attr of Array.from(child.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) child.removeAttribute(attr.name);
    }
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
