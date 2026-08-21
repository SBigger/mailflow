/**
 * pgSafeText – macht maschinell erzeugte Texte fuer Postgres/PostgREST sicher.
 *
 * Hintergrund: PostgREST wandelt jeden Request-Body zuerst nach `jsonb` um und
 * fuellt daraus erst die Zeile. `jsonb` kann zwei Dinge nicht darstellen:
 *
 *   1. das Null-Zeichen U+0000  -> "unsupported Unicode escape sequence"
 *                                  (DETAIL: \u0000 cannot be converted to text)
 *   2. ungepaarte Surrogate     -> "invalid Unicode surrogate pair"
 *
 * Beides kommt bei uns nicht aus Tastatur-Eingaben, sondern aus extrahiertem
 * Text: pdfjs liefert bei kaputten ToUnicode-Tabellen U+0000, UTF-16-Dateien
 * (Excel "Unicode Text") sind voller Null-Bytes, und ein `.slice(0, 100000)`
 * kann mitten durch ein Surrogatpaar (Emoji, seltene CJK-Zeichen) schneiden.
 * Ohne diese Bereinigung kippt der ganze Insert und der Anwender sieht nur
 * "Fehler: unsupported Unicode escape sequence" – das Dokument wird nicht
 * gespeichert.
 */

const HAT_SURROGAT = /[\uD800-\uDFFF]/;

/** Ungepaarte Surrogate durch U+FFFD ersetzen (Paare bleiben unangetastet). */
function wohlgeformt(s) {
  if (!HAT_SURROGAT.test(s)) return s;
  if (typeof s.toWellFormed === "function") return s.toWellFormed();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
      else out += "\uFFFD";
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += "\uFFFD";
    } else {
      out += s[i];
    }
  }
  return out;
}

/** Einen einzelnen String Postgres-tauglich machen. */
export function scrubPgString(s) {
  if (typeof s !== "string") return s;
  const ohneNull = s.indexOf("\u0000") === -1 ? s : s.replace(/\u0000/g, "");
  return wohlgeformt(ohneNull);
}

/**
 * Rekursiv ueber ein Insert-/Update-Payload. Nur Strings, Arrays und einfache
 * Objekte werden angefasst – Date, File, Zahlen, null bleiben unveraendert.
 */
export function scrubPgPayload(value) {
  if (typeof value === "string") return scrubPgString(value);
  if (Array.isArray(value)) return value.map(scrubPgPayload);
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;  // Date, File, …
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubPgPayload(v);
    return out;
  }
  return value;
}
