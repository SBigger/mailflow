/**
 * docxExport — baut aus dem Auswertungs-Ergebnis eine echte Word-Datei (.docx).
 *
 * Kein zusaetzliches Paket noetig: die .docx ist ein ZIP mit OOXML darin,
 * gepackt mit jszip (liegt bereits im Projekt). Damit laeuft der Export
 * vollstaendig im Browser, ohne Server und ohne Umweg ueber HTML-nach-Word.
 */
import JSZip from "jszip";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Ein Textlauf; Zeilenumbrueche im Text werden zu echten Word-Umbruechen. */
const run = (text, { b = false, i = false, color = null, sz = null } = {}) => {
    const rPr = (b || i || color || sz)
        ? `<w:rPr>${b ? "<w:b/>" : ""}${i ? "<w:i/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}${sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : ""}</w:rPr>`
        : "";
    return String(text ?? "").split(/\r?\n/).map((line, idx) =>
        `<w:r>${rPr}${idx ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`
    ).join("");
};

/** Ein Absatz. `style` ist eine Formatvorlage aus styles.xml. */
const para = (text = "", { style = null, after = null, ...runOpts } = {}) => {
    const pPr = (style || after != null)
        ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${after != null ? `<w:spacing w:after="${after}"/>` : ""}</w:pPr>`
        : "";
    return `<w:p>${pPr}${text === "" ? "" : run(text, runOpts)}</w:p>`;
};

const bullet = (text) => para(`•  ${text}`, { style: "Aufzaehlung" });

const cell = (content, width, { fill = null } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    `${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}` +
    `<w:vAlign w:val="top"/></w:tcPr>${content}</w:tc>`;

const COLS = [4870, 2600, 1600];   // Summe 9070 twips = A4 minus 2.5 cm Rand

const table = (headers, rows) => {
    const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>` + headers.map((h, i) =>
        cell(para(h, { style: "Tabellenkopf", b: true }), COLS[i], { fill: "EEF1F6" })
    ).join("") + `</w:tr>`;
    const body = rows.map(r => `<w:tr>` + r.map((c, i) =>
        cell(para(c, { style: "Tabellenzelle" }), COLS[i])
    ).join("") + `</w:tr>`).join("");
    return `<w:tbl>` +
        `<w:tblPr><w:tblW w:w="9070" w:type="dxa"/>` +
        `<w:tblBorders>` +
        ["top", "left", "bottom", "right", "insideH", "insideV"].map(s =>
            `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="C9D1DF"/>`).join("") +
        `</w:tblBorders>` +
        `<w:tblLayout w:type="fixed"/>` +
        `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>` +
        `<w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar>` +
        `</w:tblPr>` +
        `<w:tblGrid>${COLS.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
        head + body + `</w:tbl>`;
};

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS_W}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-CH"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:after="320"/></w:pPr><w:rPr><w:color w:val="6B7691"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="C9D1DF"/></w:pBdr>
<w:spacing w:before="360" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="260" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:b/><w:color w:val="2E4C86"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Aufzaehlung"><w:name w:val="Aufzaehlung"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:after="80"/><w:ind w:left="360" w:hanging="200"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Tabellenkopf"><w:name w:val="Tabellenkopf"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Tabellenzelle"><w:name w:val="Tabellenzelle"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
</w:styles>`;

const SECT_PR = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr>`;

const coreXml = (title, isoNow) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title>
<dc:creator>Smartis GV-Protokoll</dc:creator>
<cp:lastModifiedBy>Smartis GV-Protokoll</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${isoNow}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${isoNow}</dcterms:modified>
</cp:coreProperties>`;

/**
 * Baut den Dokumentteil aus dem Ergebnis der Auswertung.
 * Leere Abschnitte werden weggelassen, damit kein leeres Geruest entsteht.
 */
function buildBody({ customerName, title, dateText, persons, agenda, summaryText, traktanden, decisions, tasks }) {
    const out = [];

    out.push(para(title || "Protokoll", { style: "Title" }));
    const sub = [customerName, dateText].filter(Boolean).join(" · ");
    if (sub) out.push(para(sub, { style: "Subtitle" }));

    if (persons?.length) {
        out.push(para("Teilnehmer", { style: "Heading1" }));
        out.push(para(persons.map(p => p.name).filter(Boolean).join(", ")));
    }

    // Handgetippte Traktandenliste nur zeigen, wenn die Auswertung keine geliefert hat
    if (!traktanden?.length && agenda?.trim()) {
        out.push(para("Traktandenliste", { style: "Heading1" }));
        agenda.split(/\r?\n/).filter(l => l.trim()).forEach(l => out.push(bullet(l.trim())));
    }

    if (summaryText?.trim()) {
        out.push(para("Zusammenfassung", { style: "Heading1" }));
        out.push(para(summaryText.trim()));
    }

    if (traktanden?.length) {
        out.push(para("Traktanden", { style: "Heading1" }));
        traktanden.forEach((t, i) => {
            out.push(para(`${i + 1}. ${t.titel || "Traktandum"}`, { style: "Heading2" }));
            if (t.inhalt?.trim()) out.push(para(t.inhalt.trim()));
        });
    }

    if (decisions?.length) {
        out.push(para("Beschlüsse", { style: "Heading1" }));
        decisions.forEach(d => out.push(bullet(d.text || "")));
    }

    if (tasks?.length) {
        out.push(para("Aufgaben", { style: "Heading1" }));
        out.push(table(
            ["Aufgabe", "Verantwortlich", "Frist"],
            tasks.map(t => [t.text || "", t.who || "", t.due || ""])
        ));
        out.push(para(""));   // Abstand nach der Tabelle
    }

    return out.join("");
}

/** Baut die .docx und gibt sie als Blob zurueck. */
export async function buildProtocolDocx(data) {
    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}"><w:body>${buildBody(data)}${SECT_PR}</w:body></w:document>`;

    const zip = new JSZip();
    const opt = { createFolders: false };
    zip.file("[Content_Types].xml", CONTENT_TYPES, opt);
    zip.file("_rels/.rels", ROOT_RELS, opt);
    zip.file("docProps/core.xml", coreXml(data.title || "Protokoll", isoNow), opt);
    zip.file("word/_rels/document.xml.rels", DOC_RELS, opt);
    zip.file("word/document.xml", documentXml, opt);
    zip.file("word/styles.xml", STYLES, opt);

    return zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE",
    });
}

/** Dateiname ohne Zeichen, die Windows/macOS nicht mögen. */
export const safeFileName = (s) =>
    String(s || "Protokoll").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);
