import React, { useState, useContext } from "react";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { FONT_REGULAR_B64, FONT_BOLD_B64 } from "@/components/fristen/fontData.js";
import {
  BookOpen, Save, Printer, Plus, Trash2,
  Building2, User, Edit3, FileText, Wrench,
  ChevronRight, Search, Eye
} from "lucide-react";

// ── Absender-Konstanten (gleich wie Fristen-Briefe) ──────────────────────────
const SENDER_NAME   = "Artis Treuhand GmbH";
const SENDER_STREET = "Trischlistrasse 10";
const SENDER_CITY   = "9400 Rorschach";
const LETTER_CITY   = "Rorschach";

function todayStr() {
  const d = new Date();
  return String(d.getDate()).padStart(2, "0") + "." +
    String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
}

// ── Eingebaute Vorlagen-Vorschläge ───────────────────────────────────────────
const PRESETS = [
  {
    id: "p1", name: "Unterlagen Steuererklärung",
    betreff: "Steuererklärung – Unterlagen benötigt",
    body: `Sehr geehrte Damen und Herren\n\nWir erlauben uns, Sie höflich daran zu erinnern, dass wir für die Erstellung Ihrer Steuererklärung noch Ihre Unterlagen benötigen.\n\nWir bitten Sie, uns die Unterlagen baldmöglichst zukommen zu lassen.\n\nFür Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nFreundliche Grüsse\n\n${SENDER_NAME}`,
  },
  {
    id: "p2", name: "Unterlagen Jahresabschluss",
    betreff: "Jahresabschluss – Unterlagen benötigt",
    body: `Sehr geehrte Damen und Herren\n\nFür die Erstellung Ihres Jahresabschlusses benötigen wir noch folgende Unterlagen:\n\n– Kontoauszüge per Jahresende\n– Belege für Anlagenzugänge\n– Inventarliste\n– Offene Debitoren und Kreditoren\n\nWir bitten Sie, uns die Unterlagen baldmöglichst zukommen zu lassen.\n\nFreundliche Grüsse\n\n${SENDER_NAME}`,
  },
  {
    id: "p3", name: "GV-Einladung",
    betreff: "Einladung zur ordentlichen Generalversammlung",
    body: `Sehr geehrte Damen und Herren\n\nWir laden Sie herzlich zur ordentlichen Generalversammlung ein.\n\nDatum: [Datum einfügen]\nZeit: [Uhrzeit einfügen]\nOrt: [Ort einfügen]\n\nTraktanden:\n1. Begrüssung\n2. Genehmigung des Jahresberichts\n3. Genehmigung der Jahresrechnung\n4. Entlastung des Verwaltungsrats\n5. Diverses\n\nUm Ihre Teilnahme bitten wir freundlichst bis [Datum] zu bestätigen.\n\nFreundliche Grüsse\n\n${SENDER_NAME}`,
  },
  {
    id: "p4", name: "GV-Protokoll Begleitschreiben",
    betreff: "Protokoll der Generalversammlung vom [Datum]",
    body: `Sehr geehrte Damen und Herren\n\nWir übermitteln Ihnen anbei das Protokoll der Generalversammlung vom [Datum].\n\nBitte prüfen Sie das Protokoll und bestätigen Sie uns, ob Sie damit einverstanden sind.\n\nFreundliche Grüsse\n\n${SENDER_NAME}`,
  },
  {
    id: "p5", name: "Zahlungserinnerung",
    betreff: "Zahlungserinnerung – Rechnung vom [Datum]",
    body: `Sehr geehrte Damen und Herren\n\nErlauben Sie uns, Sie höflich daran zu erinnern, dass unsere Rechnung vom [Datum] über CHF [Betrag] noch offen ist.\n\nWir bitten Sie, den ausstehenden Betrag bis zum [Fälligkeitsdatum] auf unser Konto zu überweisen.\n\nFalls Sie bereits bezahlt haben, betrachten Sie dieses Schreiben als gegenstandslos.\n\nFreundliche Grüsse\n\n${SENDER_NAME}`,
  },
  {
    id: "p6", name: "Fristverlängerungsgesuch",
    betreff: "Gesuch um Fristverlängerung",
    body: `Sehr geehrte Damen und Herren\n\nWir erlauben uns, für unseren Mandanten um Fristverlängerung zu ersuchen.\n\nAls Begründung führen wir an: [Grund einfügen]\n\nWir bitten Sie, die Frist bis zum [Datum] zu erstrecken.\n\nFür Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nFreundliche Grüsse\n\n${SENDER_NAME}`,
  },
];

// ── HTML-Generator (identisch mit Fristen-Briefe) ────────────────────────────
function generateBriefHtml(recipient, datum, betreff, body, signer) {
  const logoUrl = "/artis-logo.png";
  const bodyHtml = body.split("\n").map(l => l === "" ? "<br/>" : "<p>" + l + "</p>").join("");
  // Signatur: Name + Titel unter Artis Treuhand GmbH
  const signerHtml = signer?.name
    ? `<div class="signer-name">${signer.name}</div>` +
      (signer.titel ? `<div class="signer-titel">${signer.titel}</div>` : "")
    : "";
  const page =
    `<div class="page">` +
    `<div class="letterhead"><div class="left-col"></div>` +
    `<img class="logo" src="${logoUrl}" alt="Logo" /></div>` +
    `<div class="sender-line">${SENDER_NAME} · ${SENDER_STREET} · ${SENDER_CITY}</div>` +
    `<div class="recipient">` +
    (recipient.name ? `<div>${recipient.name}</div>` : "") +
    (recipient.firma ? `<div>${recipient.firma}</div>` : "") +
    (recipient.strasse ? `<div>${recipient.strasse}</div>` : "") +
    ((recipient.plz || recipient.ort) ? `<div>${[recipient.plz, recipient.ort].filter(Boolean).join(" ")}</div>` : "") +
    `</div>` +
    `<div class="date">${LETTER_CITY}, ${datum}</div>` +
    `<div class="subject">${betreff}</div>` +
    `<div class="body">${bodyHtml}</div>` +
    (signerHtml ? `<div class="signature">${signerHtml}</div>` : "") +
    `<div class="footer">` +
    `<div class="footer-col">Artis Treuhand GmbH<br/>www.artis-gmbh.ch</div>` +
    `<div class="footer-col">Trischlistrasse 10<br/>9400 Rorschach</div>` +
    `<div class="footer-col">info@artis-gmbh.ch<br/>+41 71 511 50 00</div>` +
    `</div></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Brief</title><style>` +
    `@font-face{font-family:'CenturyGothic';font-weight:normal;src:url('data:font/otf;base64,${FONT_REGULAR_B64}') format('opentype');}` +
    `@font-face{font-family:'CenturyGothic';font-weight:bold;src:url('data:font/otf;base64,${FONT_BOLD_B64}') format('opentype');}` +
    `*{box-sizing:border-box;margin:0;padding:0;}` +
    `body{font-family:'CenturyGothic',Helvetica,Arial,sans-serif;font-size:10pt;color:#222;background:white;}` +
    `@page{size:A4;margin:0;}` +
    `@media print{.page{page-break-after:always;}.page:last-child{page-break-after:avoid;}}` +
    `.page{width:210mm;min-height:297mm;padding:24mm 22mm 20mm 25mm;position:relative;background:white;overflow:hidden;}` +
    `.letterhead{height:24mm;margin-bottom:0;}` +
    `.sender-line{display:inline-block;font-size:7pt;color:#666;letter-spacing:-0.15px;word-spacing:-0.5px;margin-bottom:8mm;border-bottom:0.5pt solid #222;padding-bottom:1mm;}` +
    `.logo{position:absolute;top:22mm;right:20mm;height:32mm;max-width:88mm;object-fit:contain;}` +
    `.recipient{margin-bottom:14mm;line-height:1.6;font-size:10pt;}` +
    `.date{text-align:left;margin-top:14mm;margin-bottom:20mm;font-size:10pt;}` +
    `.subject{font-weight:bold;margin-bottom:8mm;font-size:10pt;}` +
    `.body{line-height:1.7;font-size:10pt;}` +
    `.body p{margin:0 0 3px 0;}` +
    `.signature{margin-top:2mm;font-size:10pt;}` +
    `.signer-name{font-size:10pt;color:#222;}` +
    `.signer-titel{font-size:8.5pt;color:#555;margin-top:1mm;}` +
    `.footer{position:absolute;bottom:12mm;left:0;right:0;display:flex;justify-content:space-between;font-size:7pt;color:#7a9b7f;border-top:0.5pt solid #7a9b7f;padding-top:2.5mm;padding-left:25mm;padding-right:22mm;}` +
    `.footer-col{line-height:1.6;color:#7a9b7f;}` +
    `.footer-col:last-child{text-align:right;color:#7a9b7f;}` +
    `</style></head><body>${page}</body></html>`;
}

// ── Haupt-Komponente ─────────────────────────────────────────────────────────
export default function BriefSchreiben() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const isDark   = !isLight && !isArtis;

  // Farben
  const pageBg      = isLight ? "#f4f4f8"               : isArtis ? "#f2f5f2"               : "#2a2a2f";
  const panelBg     = isLight ? "#ffffff"                : isArtis ? "#ffffff"                : "#27272a";
  const panelBorder = isLight ? "#e2e2ec"                : isArtis ? "#ccd8cc"                : "#3f3f46";
  const headingCol  = isLight ? "#1e293b"                : isArtis ? "#1a3a1a"                : "#e4e4e7";
  const subCol      = isLight ? "#64748b"                : isArtis ? "#4a6a4a"                : "#a1a1aa";
  const inputBg     = isLight ? "#f8f8fc"                : isArtis ? "#f5f8f5"                : "rgba(24,24,27,0.8)";
  const inputBorder = isLight ? "#d4d4e8"                : isArtis ? "#bfcfbf"                : "#3f3f46";
  const rowHover    = isLight ? "#f1f5f9"                : isArtis ? "#f0f5f0"                : "#323236";
  const accent      = isArtis ? "#4a7a4f"                : isLight  ? "#4f6aab"               : "#7c3aed";
  const accentLight = isArtis ? "#7a9b7f"                : isLight  ? "#7a9abf"               : "#9f7aef";
  const badgeBg     = isLight ? "#f1f5f9"                : isArtis ? "#e8f2e8"                : "#3f3f46";

  const inp = {
    background: inputBg, border: `1px solid ${inputBorder}`,
    color: headingCol, borderRadius: 8, padding: "8px 12px",
    fontSize: 13, width: "100%", outline: "none",
  };
  const qc = useQueryClient();

  // ── Daten laden ────────────────────────────────────────────────────────────
  const { data: kunden = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });
  const { data: personen = [] } = useQuery({
    queryKey: ["personen_brief"],
    queryFn: async () => {
      const { data } = await supabase.from("personen").select("id,vorname,nachname,strasse,plz,ort").order("nachname");
      return data || [];
    },
  });
  const { data: vorlagen = [] } = useQuery({
    queryKey: ["brief_vorlagen"],
    queryFn: () => entities.BriefVorlage.list("sort_order"),
  });

  const saveMut = useMutation({
    mutationFn: (d) => entities.BriefVorlage.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brief_vorlagen"] }); toast.success("Vorlage gespeichert"); setSaveModal(false); setNewName(""); },
    onError: (e) => toast.error("Fehler: " + e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => entities.BriefVorlage.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brief_vorlagen"] }); toast.success("Vorlage gelöscht"); },
    onError: (e) => toast.error("Fehler: " + e.message),
  });

  // ── Aktueller Benutzer (für Signatur) ─────────────────────────────────────
  const { data: currentProfile } = useQuery({
    queryKey: ["currentProfile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("full_name, titel").eq("id", user.id).single();
      return data;
    },
  });

  // ── Formular-State ─────────────────────────────────────────────────────────
  const [empfMode, setEmpfMode] = useState("kunden"); // "kunden" | "personen" | "frei"
  const [selectedKunde, setSelectedKunde] = useState("");
  const [selectedKontakt, setSelectedKontakt] = useState(""); // index in contact_persons
  const [selectedPerson, setSelectedPerson] = useState("");
  const [freiName, setFreiName] = useState("");
  const [freiStrasse, setFreiStrasse] = useState("");
  const [freiPlz, setFreiPlz] = useState("");
  const [freiOrt, setFreiOrt] = useState("");
  const [datum, setDatum] = useState(todayStr());
  const [betreff, setBetreff] = useState("");
  const [body, setBody] = useState("");
  const [vorlageSearch, setVorlageSearch] = useState("");
  const [saveModal, setSaveModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  // ── Empfänger-Objekt ───────────────────────────────────────────────────────
  const selectedKundeObj = kunden.find(c => c.id === selectedKunde) || null;
  const kundeKontakte = selectedKundeObj?.contact_persons || [];

  const getRecipient = () => {
    if (empfMode === "kunden" && selectedKunde) {
      const k = selectedKundeObj;
      if (!k) return null;
      // Wenn Kontaktperson gewählt: Namen-Zeile = Kontaktperson, darunter Firma + Adresse
      if (selectedKontakt !== "" && kundeKontakte[parseInt(selectedKontakt)]) {
        const cp = kundeKontakte[parseInt(selectedKontakt)];
        const cpName = [cp.anrede, cp.vorname, cp.name].filter(Boolean).join(" ");
        return { name: cpName, firma: k.company_name, strasse: k.strasse, plz: k.plz, ort: k.ort };
      }
      return { name: k.company_name, strasse: k.strasse, plz: k.plz, ort: k.ort };
    }
    if (empfMode === "personen" && selectedPerson) {
      const p = personen.find(x => x.id === selectedPerson);
      if (!p) return null;
      const name = [p.anrede, p.vorname, p.nachname].filter(Boolean).join(" ") ||
                   [p.vorname, p.nachname].filter(Boolean).join(" ");
      return { name, strasse: p.strasse, plz: p.plz, ort: p.ort };
    }
    if (empfMode === "frei" && freiName.trim()) {
      return { name: freiName.trim(), strasse: freiStrasse.trim(), plz: freiPlz.trim(), ort: freiOrt.trim() };
    }
    return null;
  };

  const recipient = getRecipient();
  const canPrint = !!recipient && betreff.trim() && body.trim();

  // ── Vorlage laden ──────────────────────────────────────────────────────────
  const loadVorlage = (v) => {
    setBetreff(v.betreff || v.subject || "");
    setBody(v.body || "");
    toast.success(`"${v.name}" geladen`);
  };

  // ── Drucken ────────────────────────────────────────────────────────────────
  const signer = currentProfile ? { name: currentProfile.full_name, titel: currentProfile.titel } : null;

  const handlePrint = () => {
    if (!canPrint) return;
    const html = generateBriefHtml(recipient, datum, betreff, body, signer);
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 700);
  };

  // ── Filter Vorlagen ────────────────────────────────────────────────────────
  const filteredVorlagen = vorlagen.filter(v => v.name.toLowerCase().includes(vorlageSearch.toLowerCase()));
  const filteredPresets  = PRESETS.filter(v => v.name.toLowerCase().includes(vorlageSearch.toLowerCase()));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* ── Breadcrumb-Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 py-4 flex-shrink-0" style={{ borderBottom: `1px solid ${panelBorder}` }}>
        <Wrench className="w-4 h-4" style={{ color: accentLight }} />
        <span className="text-sm" style={{ color: subCol }}>Artis Tools</span>
        <ChevronRight className="w-3 h-3" style={{ color: subCol }} />
        <FileText className="w-4 h-4" style={{ color: accent }} />
        <span className="text-sm font-semibold" style={{ color: headingCol }}>Briefe schreiben</span>
      </div>

      {/* ── Zwei-Spalten-Layout ───────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ──── Linke Spalte: Vorlagen ──────────────────────────────────── */}
        <div
          className="flex flex-col flex-shrink-0 overflow-hidden"
          style={{ width: 260, borderRight: `1px solid ${panelBorder}`, backgroundColor: panelBg }}
        >
          {/* Vorlagen-Header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderBottom: `1px solid ${panelBorder}` }}>
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" style={{ color: accent }} />
              <span className="text-sm font-semibold" style={{ color: headingCol }}>Vorlagen</span>
            </div>
            <button
              onClick={() => setSaveModal(true)}
              title="Aktuelle Eingabe als Vorlage speichern"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
              style={{ backgroundColor: badgeBg, color: accent }}
            >
              <Plus className="w-3 h-3" /> Neu
            </button>
          </div>

          {/* Suchfeld */}
          <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: `1px solid ${panelBorder}` }}>
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5" style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}` }}>
              <Search className="w-3.5 h-3.5" style={{ color: subCol }} />
              <input
                value={vorlageSearch}
                onChange={e => setVorlageSearch(e.target.value)}
                placeholder="Suchen..."
                className="bg-transparent text-xs outline-none flex-1"
                style={{ color: headingCol }}
              />
            </div>
          </div>

          {/* Liste */}
          <div className="flex-1 overflow-y-auto">

            {/* Gespeicherte Vorlagen */}
            {filteredVorlagen.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: subCol }}>
                    Gespeichert ({filteredVorlagen.length})
                  </span>
                </div>
                {filteredVorlagen.map(v => (
                  <div
                    key={v.id}
                    className="group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
                    style={{ borderBottom: `1px solid ${panelBorder}` }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHover}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                    onClick={() => loadVorlage(v)}
                  >
                    <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentLight }} />
                    <span className="text-xs flex-1 truncate" style={{ color: headingCol }}>{v.name}</span>
                    <button
                      onClick={e => { e.stopPropagation(); if (window.confirm(`Vorlage "${v.name}" löschen?`)) deleteMut.mutate(v.id); }}
                      className="flex-shrink-0 rounded p-0.5 transition-colors hover:bg-red-50"
                      style={{ color: "#d1d5db" }}
                      onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                      onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}
                      title="Vorlage löschen"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </>
            )}

            {/* Eingebaute Vorschläge */}
            {filteredPresets.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: subCol }}>
                    Vorschläge
                  </span>
                </div>
                {filteredPresets.map(p => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
                    style={{ borderBottom: `1px solid ${panelBorder}` }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHover}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                    onClick={() => loadVorlage(p)}
                  >
                    <Plus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: subCol }} />
                    <span className="text-xs" style={{ color: subCol }}>{p.name}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ──── Rechte Spalte: Brief-Editor ───────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div style={{ maxWidth: 700 }}>

            {/* Empfänger ─────────────────────────────────────────────────── */}
            <section className="mb-6">
              <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: subCol }}>
                Empfänger
              </label>

              {/* Modus-Tabs */}
              <div className="flex gap-1 mb-3 p-1 rounded-lg w-fit" style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}` }}>
                {[
                  { key: "kunden",   icon: Building2, label: "Kunden" },
                  { key: "personen", icon: User,      label: "Personen" },
                  { key: "frei",     icon: Edit3,     label: "Freie Eingabe" },
                ].map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    onClick={() => setEmpfMode(key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                    style={{
                      backgroundColor: empfMode === key ? (isArtis ? "#7a9b7f" : isLight ? "#4f6aab" : "#7c3aed") : "transparent",
                      color: empfMode === key ? "#fff" : subCol,
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>

              {/* Kunden-Dropdown */}
              {empfMode === "kunden" && (
                <div className="flex flex-col gap-2">
                  <select value={selectedKunde} onChange={e => { setSelectedKunde(e.target.value); setSelectedKontakt(""); }} style={inp}>
                    <option value="">– Kunden auswählen –</option>
                    {kunden.map(k => (
                      <option key={k.id} value={k.id}>{k.company_name}{k.ort ? ` – ${k.ort}` : ""}</option>
                    ))}
                  </select>
                  {kundeKontakte.length > 0 && (
                    <select value={selectedKontakt} onChange={e => setSelectedKontakt(e.target.value)} style={inp}>
                      <option value="">– Kontaktperson (optional) –</option>
                      {kundeKontakte.map((cp, i) => (
                        <option key={i} value={i}>
                          {[cp.anrede, cp.vorname, cp.name].filter(Boolean).join(" ")}{cp.role ? ` (${cp.role})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Personen-Dropdown */}
              {empfMode === "personen" && (
                <select value={selectedPerson} onChange={e => setSelectedPerson(e.target.value)} style={inp}>
                  <option value="">– Person auswählen –</option>
                  {personen.map(p => (
                    <option key={p.id} value={p.id}>
                      {[p.vorname, p.nachname].filter(Boolean).join(" ")}{p.ort ? ` – ${p.ort}` : ""}
                    </option>
                  ))}
                </select>
              )}

              {/* Freie Eingabe */}
              {empfMode === "frei" && (
                <div className="grid gap-2">
                  <input value={freiName}    onChange={e => setFreiName(e.target.value)}    placeholder="Name / Firma"  style={inp} />
                  <input value={freiStrasse} onChange={e => setFreiStrasse(e.target.value)} placeholder="Strasse Nr."   style={inp} />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={freiPlz} onChange={e => setFreiPlz(e.target.value)} placeholder="PLZ"  style={inp} />
                    <input value={freiOrt} onChange={e => setFreiOrt(e.target.value)} placeholder="Ort"  style={inp} />
                  </div>
                </div>
              )}

              {/* Adress-Vorschau */}
              {recipient && (
                <div className="mt-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: badgeBg, color: subCol }}>
                  <span className="font-medium" style={{ color: headingCol }}>{recipient.name}</span>
                  {recipient.strasse && <>, {recipient.strasse}</>}
                  {(recipient.plz || recipient.ort) && <>, {[recipient.plz, recipient.ort].filter(Boolean).join(" ")}</>}
                </div>
              )}
            </section>

            {/* Datum ────────────────────────────────────────────────────── */}
            <section className="mb-4">
              <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: subCol }}>
                Datum
              </label>
              <input value={datum} onChange={e => setDatum(e.target.value)} style={{ ...inp, maxWidth: 200 }} placeholder="TT.MM.JJJJ" />
            </section>

            {/* Betreff ─────────────────────────────────────────────────── */}
            <section className="mb-4">
              <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: subCol }}>
                Betreff
              </label>
              <input
                value={betreff}
                onChange={e => setBetreff(e.target.value)}
                placeholder="Betreff des Briefes"
                style={inp}
              />
            </section>

            {/* Brieftext ───────────────────────────────────────────────── */}
            <section className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: subCol }}>
                  Brieftext
                </label>
                <span className="text-xs" style={{ color: subCol }}>
                  {body.length} Zeichen · {body.split("\n").length} Zeilen
                </span>
              </div>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={18}
                placeholder={"Sehr geehrte Damen und Herren\n\n...\n\nFreundliche Grüsse\n\nArtis Treuhand GmbH"}
                style={{ ...inp, resize: "vertical", lineHeight: 1.7, fontFamily: "inherit" }}
              />
            </section>

            {/* Aktions-Leiste ──────────────────────────────────────────── */}
            <div className="flex items-center gap-3 pb-8">
              <button
                onClick={handlePrint}
                disabled={!canPrint}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
                style={{
                  backgroundColor: canPrint ? accent : panelBorder,
                  color: canPrint ? "#fff" : subCol,
                  cursor: canPrint ? "pointer" : "not-allowed",
                }}
              >
                <Printer className="w-4 h-4" /> Drucken / PDF
              </button>

              <button
                onClick={() => setSaveModal(true)}
                disabled={!betreff.trim() && !body.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: badgeBg,
                  color: betreff.trim() || body.trim() ? headingCol : subCol,
                  border: `1px solid ${panelBorder}`,
                  cursor: betreff.trim() || body.trim() ? "pointer" : "not-allowed",
                }}
              >
                <Save className="w-4 h-4" /> Als Vorlage speichern
              </button>

              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: badgeBg, color: headingCol, border: `1px solid ${panelBorder}` }}
              >
                <Eye className="w-4 h-4" /> {showPreview ? "Vorschau ausblenden" : "Vorschau"}
              </button>
            </div>

            {/* Brief-Vorschau ──────────────────────────────────────────── */}
            {showPreview && (
              <div className="mb-8 rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBorder}` }}>
                <div className="px-4 py-2 flex items-center gap-2" style={{ backgroundColor: badgeBg, borderBottom: `1px solid ${panelBorder}` }}>
                  <Eye className="w-3.5 h-3.5" style={{ color: subCol }} />
                  <span className="text-xs font-medium" style={{ color: subCol }}>Vorschau (vereinfacht)</span>
                </div>
                <div className="p-8 bg-white" style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 12, color: "#222", lineHeight: 1.7 }}>
                  {/* Absender */}
                  <div style={{ fontSize: 8, color: "#666", borderBottom: "0.5px solid #222", paddingBottom: 3, marginBottom: 16, display: "inline-block" }}>
                    {SENDER_NAME} · {SENDER_STREET} · {SENDER_CITY}
                  </div>
                  {/* Empfänger */}
                  {recipient && (
                    <div style={{ marginBottom: 20 }}>
                      <div>{recipient.name}</div>
                      {recipient.firma && <div>{recipient.firma}</div>}
                      {recipient.strasse && <div>{recipient.strasse}</div>}
                      {(recipient.plz || recipient.ort) && <div>{[recipient.plz, recipient.ort].filter(Boolean).join(" ")}</div>}
                    </div>
                  )}
                  {/* Datum */}
                  <div style={{ marginBottom: 20, marginTop: 20 }}>{LETTER_CITY}, {datum}</div>
                  {/* Betreff */}
                  {betreff && <div style={{ fontWeight: "bold", marginBottom: 16 }}>{betreff}</div>}
                  {/* Body */}
                  <div>
                    {body.split("\n").map((line, i) =>
                      line === "" ? <br key={i} /> : <p key={i} style={{ margin: "0 0 2px 0" }}>{line}</p>
                    )}
                  </div>
                  {/* Signatur */}
                  {signer?.name && (
                    <div style={{ marginTop: 8 }}>
                      <div>{signer.name}</div>
                      {signer.titel && <div style={{ fontSize: 10, color: "#555" }}>{signer.titel}</div>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Vorlage-Speichern Modal ───────────────────────────────────────── */}
      {saveModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="rounded-xl p-6" style={{ background: panelBg, border: `1px solid ${panelBorder}`, width: 360 }}>
            <h4 className="font-semibold mb-4" style={{ color: headingCol }}>Vorlage speichern</h4>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Name der Vorlage (z.B. Mahnung Steuern)"
              onKeyDown={e => {
                if (e.key === "Enter" && newName.trim()) saveMut.mutate({ name: newName.trim(), betreff, body, subject: betreff, sort_order: vorlagen.length });
                if (e.key === "Escape") setSaveModal(false);
              }}
              style={inp}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setSaveModal(false); setNewName(""); }}
                className="px-4 py-2 rounded-lg text-sm" style={{ backgroundColor: badgeBg, color: subCol }}>
                Abbrechen
              </button>
              <button
                disabled={!newName.trim()}
                onClick={() => saveMut.mutate({ name: newName.trim(), betreff, body, subject: betreff, sort_order: vorlagen.length })}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: accent, color: "#fff", opacity: newName.trim() ? 1 : 0.5 }}
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
