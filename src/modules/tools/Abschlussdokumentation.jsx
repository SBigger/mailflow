import React, { useState, useContext, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../../Layout.jsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, supabase } from "../../api/supabaseClient.js";
import { toast } from "sonner";
import {
  BookCheck, FileSpreadsheet, Upload, Download, ChevronRight, Wrench,
  Lock, Unlock, CheckCircle2, AlertCircle, TrendingUp, TrendingDown,
  Search, ChevronDown, ChevronUp, X, FileText, BarChart2, RotateCcw,
  Plus, Trash2, Sparkles,
} from "lucide-react";
import DokUploadDialog from "../../components/dokumente/DokUploadDialog.jsx";

// ── Swiss Kontenrahmen KMU ────────────────────────────────────────────────────
const KONTENRAHMEN_POSITIONEN = [
  // BILANZ – AKTIVEN
  { id: "UV_FLUESSIG",      label: "Flüssige Mittel",                  typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1000, bis: 1059, level: 2 },
  { id: "UV_WERTSCHRIFTEN", label: "Wertschriften UV",                 typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1060, bis: 1099, level: 2 },
  { id: "UV_FORD_LL",         label: "Forderungen aus L+L",                    typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1100, bis: 1100, level: 2 },
  { id: "UV_FORD_LL_NAHE",   label: "Forderungen aus L+L Nahestehende",       typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1101, bis: 1109, level: 3 },
  { id: "UV_FORD_SONST",     label: "Übrige Forderungen",                      typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1110, bis: 1139, level: 2 },
  { id: "UV_FORD_SONST_NAHE",label: "Übrige Forderungen Nahestehende",         typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1140, bis: 1179, level: 3 },
  { id: "UV_VORRAETE",       label: "Warenvorräte",                            typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1200, bis: 1269, level: 2 },
  { id: "UV_ABGRENZUNG",     label: "Aktive Rechnungsabgrenzung",              typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1300, bis: 1309, level: 2 },
  { id: "AV_FINANZ",         label: "Finanzanlagen",                           typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1400, bis: 1459, level: 2 },
  { id: "AV_FINANZ_NAHE",    label: "Finanzanlagen Nahestehende",              typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1460, bis: 1479, level: 3 },
  { id: "AV_MOBIL",         label: "Mobile Sachanlagen",               typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1500, bis: 1599, level: 2 },
  { id: "AV_IMMOBIL",       label: "Immobile Sachanlagen",             typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1600, bis: 1699, level: 2 },
  { id: "AV_IMMATERIELL",   label: "Immaterielle Werte",               typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1700, bis: 1799, level: 2 },
  // BILANZ – PASSIVEN
  { id: "FK_KURZ_LL",          label: "Verbindlichkeiten aus L+L",                      typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",  von: 2000, bis: 2000, level: 2 },
  { id: "FK_KURZ_LL_NAHE",    label: "Verbindlichkeiten aus L+L Nahestehende",         typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",  von: 2001, bis: 2009, level: 3 },
  { id: "FK_KURZ_BANK",        label: "Kurzfristige Bankverbindlichkeiten",             typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",  von: 2010, bis: 2039, level: 2 },
  { id: "FK_KURZ_VERZ_NAHE",  label: "Kurzfristige verzinsliche Verbindl. Nahesteh.",  typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",  von: 2040, bis: 2069, level: 3 },
  { id: "FK_KURZ_SONST",       label: "Übrige kurzfristige Verbindlichkeiten",          typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",  von: 2070, bis: 2099, level: 2 },
  { id: "FK_KURZ_SONST_NAHE", label: "Übrige kurzfristige Verbindl. Nahestehende",     typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",  von: 2100, bis: 2299, level: 3 },
  { id: "FK_KURZ_ABGRENZUNG",  label: "Passive Rechnungsabgrenzung",                   typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",  von: 2300, bis: 2399, level: 2 },
  { id: "FK_LANG_BANK",        label: "Langfristige Bankverbindlichkeiten",             typ: "bilanz", seite: "passiven", gruppe: "Langfristiges FK",  von: 2400, bis: 2449, level: 2 },
  { id: "FK_LANG_VERZ_NAHE",  label: "Langfristige verzinsliche Verbindl. Nahesteh.",  typ: "bilanz", seite: "passiven", gruppe: "Langfristiges FK",  von: 2450, bis: 2499, level: 3 },
  { id: "FK_LANG_SONST",       label: "Übrige langfristige Verbindlichkeiten",          typ: "bilanz", seite: "passiven", gruppe: "Langfristiges FK",  von: 2500, bis: 2549, level: 2 },
  { id: "FK_LANG_SONST_NAHE", label: "Übrige langfristige Verbindl. Nahestehende",     typ: "bilanz", seite: "passiven", gruppe: "Langfristiges FK",  von: 2550, bis: 2599, level: 3 },
  { id: "FK_RUECKSTELLUNGEN",  label: "Rückstellungen",                                 typ: "bilanz", seite: "passiven", gruppe: "Langfristiges FK",  von: 2600, bis: 2799, level: 2 },
  // EIGENKAPITAL – Mindestgliederung OR 959a / Swiss KMU Kontenrahmen
  { id: "EK_KAPITAL",          label: "Aktien-/Stammkapital",               typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital", von: 2800, bis: 2809, level: 2 },
  { id: "EK_KAP_RESERVE",      label: "Gesetzliche Kapitalreserve",         typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital", von: 2810, bis: 2819, level: 2 },
  { id: "EK_GES_RESERVE",      label: "Gesetzliche Gewinnreserve",          typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital", von: 2820, bis: 2849, level: 2 },
  { id: "EK_FREIE_RESERVE",    label: "Freiwillige Gewinnreserven",         typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital", von: 2850, bis: 2879, level: 2 },
  { id: "EK_RESERVEN",         label: "Übrige Reserven",                    typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital", von: 2880, bis: 2889, level: 2 },
  { id: "EK_VORTRAG",          label: "Gewinn-/Verlustvortrag",             typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital", von: 2890, bis: 2969, level: 2 },
  { id: "EK_JAHRESERGEBNIS",   label: "Jahresergebnis",                     typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital", von: 2970, bis: 2999, level: 2 },
  // ERFOLGSRECHNUNG
  { id: "ER_UMSATZ",          label: "Nettoumsatzerlöse",               typ: "er", seite: "ertrag",  gruppe: "Betriebsertrag",   von: 3000, bis: 3699, level: 2 },
  { id: "ER_EIGENLEISTUNG",   label: "Eigenleistungen",                 typ: "er", seite: "ertrag",  gruppe: "Betriebsertrag",   von: 3700, bis: 3799, level: 2 },
  { id: "ER_BESTAND",         label: "Bestandesveränderungen",          typ: "er", seite: "ertrag",  gruppe: "Betriebsertrag",   von: 3800, bis: 3999, level: 2 },
  { id: "ER_MATERIAL",        label: "Materialaufwand",                 typ: "er", seite: "aufwand", gruppe: "Betriebsaufwand",  von: 4000, bis: 4999, level: 2 },
  { id: "ER_PERSONAL",        label: "Personalaufwand",                 typ: "er", seite: "aufwand", gruppe: "Betriebsaufwand",  von: 5000, bis: 5999, level: 2 },
  // Übriger Betriebsaufwand – Mindestgliederung KMU (6000–6699)
  { id: "ER_RAUM",            label: "Raumaufwand",                     typ: "er", seite: "aufwand", gruppe: "Betriebskosten",   von: 6000, bis: 6099, level: 2 },
  { id: "ER_UNTERHALT",       label: "Unterhalt & Reparaturen",         typ: "er", seite: "aufwand", gruppe: "Betriebskosten",   von: 6100, bis: 6199, level: 2 },
  { id: "ER_FAHRZEUG",        label: "Fahrzeug- & Transportaufwand",    typ: "er", seite: "aufwand", gruppe: "Betriebskosten",   von: 6200, bis: 6299, level: 2 },
  { id: "ER_VERSICHERUNG",    label: "Sachversicherungen & Abgaben",    typ: "er", seite: "aufwand", gruppe: "Betriebskosten",   von: 6300, bis: 6399, level: 2 },
  { id: "ER_ENERGIE",         label: "Energie & Entsorgung",            typ: "er", seite: "aufwand", gruppe: "Betriebskosten",   von: 6400, bis: 6499, level: 2 },
  { id: "ER_VERWALTUNG",      label: "Verwaltungs- & Informatikaufwand",typ: "er", seite: "aufwand", gruppe: "Betriebskosten",   von: 6500, bis: 6599, level: 2 },
  { id: "ER_WERBUNG",         label: "Werbe- & Akquisitionsaufwand",    typ: "er", seite: "aufwand", gruppe: "Betriebskosten",   von: 6600, bis: 6699, level: 2 },
  { id: "ER_BETRIEB",         label: "Übriger Betriebsaufwand",         typ: "er", seite: "aufwand", gruppe: "Betriebskosten",   von: 6900, bis: 6949, level: 2 }, // compat + Restbereich
  { id: "ER_ABSCHR",          label: "Abschreibungen & Wertberichtig.", typ: "er", seite: "aufwand", gruppe: "Betriebsaufwand",  von: 6700, bis: 6899, level: 2 },
  { id: "ER_FINANZ_ERTRAG",   label: "Finanzertrag",                    typ: "er", seite: "ertrag",  gruppe: "Finanzergebnis",   von: 7000, bis: 7099, level: 2 },
  { id: "ER_FINANZ_AUFW",     label: "Finanzaufwand",                   typ: "er", seite: "aufwand", gruppe: "Finanzergebnis",   von: 7100, bis: 7499, level: 2 },
  { id: "ER_LIEGENSCHAFTEN",  label: "Liegenschaftsertrag/-aufwand",    typ: "er", seite: "ertrag",  gruppe: "Finanzergebnis",   von: 7500, bis: 7999, level: 2 },
  { id: "ER_FREMD_ERTRAG",    label: "Betriebsfremder Ertrag",          typ: "er", seite: "ertrag",  gruppe: "Betriebsfremd",    von: 8000, bis: 8099, level: 2 },
  { id: "ER_FREMD_AUFW",      label: "Betriebsfremder Aufwand",         typ: "er", seite: "aufwand", gruppe: "Betriebsfremd",    von: 8100, bis: 8499, level: 2 },
  { id: "ER_AO_ERTRAG",       label: "Ausserordentlicher Ertrag",       typ: "er", seite: "ertrag",  gruppe: "Ausserordentlich", von: 8500, bis: 8599, level: 2 },
  { id: "ER_AO_AUFW",         label: "Ausserordentlicher Aufwand",      typ: "er", seite: "aufwand", gruppe: "Ausserordentlich", von: 8600, bis: 8899, level: 2 },
  { id: "ER_STEUERN",         label: "Ertragssteuern",                  typ: "er", seite: "aufwand", gruppe: "Steuern",          von: 8900, bis: 8999, level: 2 },
  { id: "ABSCHLUSS",          label: "Abschlusskonten",                 typ: "er", seite: "aufwand", gruppe: "Abschluss",        von: 9000, bis: 9999, level: 2 },
];

// Lookup-Map für schnellen Zugriff
const POSITION_MAP = Object.fromEntries(KONTENRAHMEN_POSITIONEN.map(p => [p.id, p]));

// Stichwörter je Bilanz-Position für die KI-/Volltext-Belegzuweisung.
// Steuern die Suche im indexierten Dokumenteninhalt der Dateiablage.
const AI_BELEG_KEYWORDS = {
  UV_FLUESSIG:       ["kontoauszug", "bankauszug", "saldobestätigung", "postfinance", "raiffeisen", "kasse", "bank", "saldo"],
  UV_WERTSCHRIFTEN:  ["depot", "wertschriften", "portfolio", "bankdepot", "kursliste"],
  UV_FORD_LL:        ["debitoren", "offene posten", "forderungen", "kundenrechnung", "op-liste"],
  UV_FORD_LL_NAHE:   ["debitoren", "forderung", "nahestehende", "kontokorrent"],
  UV_FORD_SONST:     ["verrechnungssteuer", "vorsteuer", "guthaben", "mwst", "kaution"],
  UV_VORRAETE:       ["inventar", "lagerliste", "warenbestand", "vorräte", "bestandesaufnahme", "lagerbestand"],
  UV_ABGRENZUNG:     ["abgrenzung", "transitorisch", "vorausbezahlt", "trakuap"],
  AV_FINANZ:         ["darlehen", "beteiligung", "finanzanlage", "bankbestätigung"],
  AV_MOBIL:          ["anlagespiegel", "anlageverzeichnis", "maschinen", "mobiliar", "fahrzeug", "abschreibung"],
  AV_IMMOBIL:        ["liegenschaft", "immobilie", "grundstück", "gebäude", "verkehrswert"],
  AV_IMMATERIELL:    ["goodwill", "software", "patent", "immateriell", "lizenz"],
  FK_KURZ_LL:        ["kreditoren", "lieferantenrechnung", "verbindlichkeiten", "op-liste kreditoren"],
  FK_KURZ_BANK:      ["kontokorrent", "bankkredit", "darlehen", "kontoauszug"],
  FK_KURZ_SONST:     ["mwst", "abrechnung", "verbindlichkeit", "quellensteuer", "sozialversicherung"],
  FK_KURZ_ABGRENZUNG:["abgrenzung", "transitorisch", "rückstellung"],
  FK_LANG_BANK:      ["hypothek", "darlehen", "bankkredit", "kreditvertrag", "amortisation"],
  FK_LANG_SONST:     ["darlehen", "kreditvertrag", "verbindlichkeit"],
  FK_RUECKSTELLUNGEN:["rückstellung", "garantie", "rückstellungsspiegel"],
  EK_KAPITAL:        ["aktienkapital", "stammkapital", "handelsregister", "statuten"],
  EK_KAP_RESERVE:    ["kapitalreserve", "agio", "reserve"],
  EK_GES_RESERVE:    ["gewinnreserve", "reserve", "generalversammlung"],
  EK_VORTRAG:        ["gewinnvortrag", "verlustvortrag", "gewinnverwendung", "protokoll", "generalversammlung"],
  EK_JAHRESERGEBNIS: ["jahresergebnis", "jahresgewinn", "jahresverlust", "erfolgsrechnung"],
};

// Dokument-Kategorien, die für eine Bilanzposition praktisch nie der richtige Beleg
// sind — ein Bankkonto darf nicht mit einer AHV-Abrechnung verknüpft werden, nur
// weil ein Stichwort zufällig trifft und sonst kein besserer Kandidat da ist.
// Ausnahme: Sozialversicherungs-Kreditoren (FK_KURZ_SONST) werden tatsächlich oft
// mit Personal-Dokumenten (AHV-/Quellensteuer-Abrechnung) belegt.
const AI_BLOCKED_CATEGORIES = { default: ["personal", "korrespondenz"], FK_KURZ_SONST: [] };

// Zahlen aus einem Text extrahieren und auf gerundete Beträge normalisieren.
// Erkennt CH/DE-Formate: 1'234.56 · 1’234.56 · 1.234,56 · 1234,56 · 1234.56 · 1234
function extractAmounts(text) {
  const out = new Set();
  if (!text) return out;
  const matches = text.match(/\d[\d'’.\s,]*\d|\d/g) || [];
  for (const m of matches) {
    let s = m.replace(/[\s'’]/g, ""); // Tausender-Apostrophe/Leerzeichen weg
    if (s.includes(".") && s.includes(",")) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")   // DE: 1.234,56
        : s.replace(/,/g, "");                       // 1,234.56
    } else if (s.includes(",")) {
      const p = s.split(",");
      s = p[p.length - 1].length <= 2 ? p.slice(0, -1).join("") + "." + p[p.length - 1] : p.join("");
    } else if (s.includes(".")) {
      const p = s.split(".");
      s = p[p.length - 1].length === 2 ? p.slice(0, -1).join("") + "." + p[p.length - 1] : p.join("");
    }
    const f = parseFloat(s);
    if (!isNaN(f)) out.add(Math.round(Math.abs(f) * 100) / 100);
  }
  return out;
}
// Kommt der Saldo-Betrag (2 Nachkommastellen ODER gerundet) im Zahlen-Set vor?
function amountAppears(amountSet, saldo) {
  const a = Math.abs(parseFloat(saldo) || 0);
  if (a < 1) return false; // triviale/0-Beträge ignorieren (zu viele Fehltreffer)
  return amountSet.has(Math.round(a * 100) / 100) || amountSet.has(Math.round(a));
}

// ── Auto-Mapping Funktion ─────────────────────────────────────────────────────
function autoMapKonto(kontonummer) {
  // Erste zusammenhängende Ziffernfolge nehmen (z.B. "1000.10" → "1000").
  const m = String(kontonummer ?? "").match(/\d+/);
  if (!m) return null;
  const digits = m[0];
  // 5- oder 6-stellige Kontonummern (Unterkonten zum KMU-Kontenrahmen): die
  // ersten 4 Stellen sind für die Zuordnung massgebend, z.B. 10000 / 100050 → 1000.
  const nr = parseInt(digits.length >= 5 ? digits.slice(0, 4) : digits, 10);
  if (isNaN(nr)) return null;
  return KONTENRAHMEN_POSITIONEN.find(p => nr >= p.von && nr <= p.bis)?.id || null;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
function fmtCHF(val, digits = 2) {
  if (val === null || val === undefined || isNaN(Number(val))) return "—";
  return Number(val).toLocaleString("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtCHFshort(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return "—";
  return "CHF\u00a0" + fmtCHF(val);
}

// ── Drei-Zustand-Status je Konto: offen / erledigt / pendent ─────────────────
// Liest weiterhin das alte boolesche `pendent`-Feld, falls ein Konto noch nie
// auf den neuen `status` migriert wurde (bestehende Kunden-Daten).
function statusOf(konto) {
  return konto?.arbeitspapier?.status || (konto?.arbeitspapier?.pendent ? "pendent" : "offen");
}
const STATUS_ORDER = ["offen", "erledigt", "pendent"];
const STATUS_LABEL = { offen: "Offen", erledigt: "Erledigt", pendent: "Pendent" };
const STATUS_DOT = { offen: "#b3ab98", erledigt: "#16a34a", pendent: "#dc2626" };

// ── Offene Prüfpunkte: automatisch erkannte Kontrollen ───────────────────────
// Ergänzen die manuelle Checkliste um zwei Prüfungen, die sich aus den Konten
// selbst ableiten lassen — nichts davon wird gespeichert, es wird bei jedem
// Render frisch aus `konten` berechnet, damit es nie veraltet.
const PP_UV_IDS      = ["UV_FLUESSIG","UV_WERTSCHRIFTEN","UV_FORD_LL","UV_FORD_LL_NAHE","UV_FORD_SONST","UV_FORD_SONST_NAHE","UV_VORRAETE","UV_ABGRENZUNG"];
const PP_AV_IDS      = ["AV_FINANZ","AV_FINANZ_NAHE","AV_MOBIL","AV_IMMOBIL","AV_IMMATERIELL"];
const PP_FK_KURZ_IDS = ["FK_KURZ_LL","FK_KURZ_LL_NAHE","FK_KURZ_BANK","FK_KURZ_VERZ_NAHE","FK_KURZ_SONST","FK_KURZ_SONST_NAHE","FK_KURZ_ABGRENZUNG"];
const PP_FK_LANG_IDS = ["FK_LANG_BANK","FK_LANG_VERZ_NAHE","FK_LANG_SONST","FK_LANG_SONST_NAHE","FK_RUECKSTELLUNGEN"];
const PP_EK_IDS      = ["EK_KAPITAL","EK_KAP_RESERVE","EK_GES_RESERVE","EK_FREIE_RESERVE","EK_RESERVEN","EK_VORTRAG","EK_JAHRESERGEBNIS"];

// Bilanzdifferenz: erscheint nur solange Aktiven≠Passiven, ist nicht manuell
// abhakbar (verschwindet erst, wenn die Zahlen wirklich stimmen).
function detectBilanzdifferenzPruefpunkt(konten, signFlipPassiven) {
  const pSign = signFlipPassiven ? -1 : 1;
  const sum = ids => konten.filter(k => ids.includes(k.position_id)).reduce((s, k) => s + (parseFloat(k.saldo_ist) || 0), 0);
  const aktivenTotal = sum(PP_UV_IDS) + sum(PP_AV_IDS);
  const passivenTotal = (sum(PP_FK_KURZ_IDS) + sum(PP_FK_LANG_IDS) + sum(PP_EK_IDS)) * pSign;
  const diff = aktivenTotal - passivenTotal;
  if (Math.abs(diff) < 0.005) return null;
  return {
    key: "bilanzdifferenz", title: "Bilanzdifferenz beheben",
    sub: `Aktiven ≠ Passiven · CHF ${fmtCHF(Math.abs(diff))}`,
    tag: "pflicht", auto: true, locked: true,
  };
}

// Varianz-Plausibilisierung: jedes Konto mit ≥20% UND ≥ CHF 500 Abweichung
// zum Vorjahr wird zur Prüfung vorgeschlagen — beides zusammen, damit weder
// kleine Konten mit zufällig grossem Prozentsprung noch grosse Konten mit
// trivialer Rundungsdifferenz die Liste zumüllen.
const PP_VARIANZ_PCT = 20;
const PP_VARIANZ_CHF = 500;
function detectVarianzPruefpunkte(konten) {
  return konten
    .map(k => {
      const ist = parseFloat(k.saldo_ist) || 0;
      const vj = parseFloat(k.saldo_vorjahr);
      if (!vj || Math.abs(vj) < 0.01) return null;
      const deltaAbs = Math.abs(ist - vj);
      if (deltaAbs < PP_VARIANZ_CHF) return null;
      const deltaPct = Math.round((ist - vj) / Math.abs(vj) * 100);
      if (Math.abs(deltaPct) < PP_VARIANZ_PCT) return null;
      return {
        key: `variance:${k.id}:${deltaPct}`,
        title: `${k.kontoname || k.kontonummer} ${deltaPct > 0 ? "+" : ""}${deltaPct}% plausibilisieren`,
        sub: `Konto ${k.kontonummer} · Veränderung gegenüber Vorjahr CHF ${fmtCHF(deltaAbs)}`,
        tag: "analyse", auto: true, locked: false,
      };
    })
    .filter(Boolean);
}

// Sicherer Formel-Evaluator: erlaubt nur Ziffern + - * / . ( ) '
function evalExpr(str) {
  if (str === null || str === undefined || str === "") return null;
  // Normalisieren: Leerzeichen, CH-Apostroph, Komma → Punkt
  const s = String(str).replace(/\s+/g, "").replace(/'/g, "").replace(/,/g, ".");
  if (!/^[-+*/.()\d]+$/.test(s)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const r = new Function("return (" + s + ")")();
    return typeof r === "number" && isFinite(r) ? Math.round(r * 100) / 100 : null;
  } catch { return null; }
}

// ── PDF Generator ─────────────────────────────────────────────────────────────
function safeFileName(name) {
  return (name || "").replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, "_").replace(/_+/g, "_");
}

function addAbschlussFooters(doc, customerName, selectedYear, label = "Jahresabschluss") {
  const GRAY = [120, 120, 130];
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7); doc.setTextColor(...GRAY);
    doc.setDrawColor(...GRAY); doc.setLineWidth(0.2);
    doc.line(14, 286, 196, 286);
    doc.text(`${customerName || ""}  ·  ${label} ${selectedYear}`, 14, 290);
    doc.text(`Seite ${i} / ${pageCount}`, 196, 290, { align: "right" });
  }
}

async function generateAbschlussPDF({ konten, einstellungen, customerName, selectedYear, returnDoc = false, mode = "mindest" }) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Farben — Treuhand-Grün-Palette (konsistent mit FiBu-Modul #3d6641)
  // BLUE/PINK/GREEN sind Aliase auf denselben Hauptton, damit die bestehende
  // Logik (Aktiven=BLUE, Passiven=PINK, ER=GREEN) erhalten bleibt, der Druck
  // aber durchgehend in Grüntönen kommt. Sub-Hintergründe variieren leicht.
  const DGRN  = [61, 102, 65];   // #3d6641 — Treuhand-Hauptton
  const MGRN  = [122, 155, 127]; // #7a9b7f — mittelgrün
  const LGRN_BG = [232, 240, 232]; // #e8f0e8 — heller Hintergrund
  const SAND  = [246, 248, 240]; // sehr helles Beige-Grün
  const BLUE  = DGRN;            const PINK  = DGRN;
  const GREEN = DGRN;            const RED   = [220, 38, 38];
  const GRAY  = [120, 120, 130]; const DARK  = [40, 40, 50];
  const LBLUE = LGRN_BG;         const LPINK = LGRN_BG;
  const LGRN  = LGRN_BG;         const LYEL  = SAND;
  const LGRAY = [245, 247, 250];

  const signFlipPassiven = einstellungen?.sign_flip_passiven ?? false;
  const signFlipER       = einstellungen?.sign_flip_er       ?? false;
  const pSign = signFlipPassiven ? -1 : 1;
  const eSign = signFlipER ? 1 : -1;

  const sumI  = (ids) => konten.filter(k => ids.includes(k.position_id))
    .reduce((s, k) => s + (parseFloat(k.saldo_ist)     || 0), 0);
  const sumVJ = (ids) => konten.filter(k => ids.includes(k.position_id))
    .reduce((s, k) => s + (parseFloat(k.saldo_vorjahr) || 0), 0);
  const sumER  = (ids) => sumI(ids) * eSign;
  const sumERV = (ids) => sumVJ(ids) * eSign;

  const N = (v) => v == null || isNaN(v) ? "—"
    : Number(v).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (ist, vj) => (!vj || Math.abs(vj) < 0.01) ? ""
    : ((ist - vj) / Math.abs(vj) * 100 > 0 ? "+" : "")
      + ((ist - vj) / Math.abs(vj) * 100).toFixed(1) + "%";
  const pctC = (p) => !p ? GRAY : p.startsWith("+") ? GREEN : RED;

  // ── Logo laden ──
  let logoData = null, logoW = 0, logoH = 0;
  if (einstellungen?.logo_url) {
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image(); i.crossOrigin = "anonymous";
        i.onload = () => res(i); i.onerror = rej; i.src = einstellungen.logo_url;
      });
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      cv.getContext("2d").drawImage(img, 0, 0);
      logoData = cv.toDataURL("image/png");
      const r = Math.min(44 / img.width, 16 / img.height);
      logoW = img.width * r; logoH = img.height * r;
    } catch { /* kein Logo */ }
  }

  // ── Seitenheader ──
  const addHeader = (title) => {
    if (logoData) doc.addImage(logoData, "PNG", 14, 9, logoW, logoH);
    const hx = logoData ? 14 + logoW + 4 : 14;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
    doc.text(customerName || "Jahresabschluss", hx, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text(`${title}  ·  Geschäftsjahr ${selectedYear}`, hx, 20);
    doc.text(new Date().toLocaleDateString("de-CH"), 196, 15, { align: "right" });
    doc.setDrawColor(...GRAY); doc.setLineWidth(0.25);
    doc.line(14, 23, 196, 23);
    return 26;
  };

  // ── Bilanz-Zeilen bauen ──
  // Eine Schriftgrösse für das ganze Dokument, Hierarchie nur über fett/normal.
  // Bilanz: Label | IST | VJ (kein Δ%, auf Wunsch entfernt) → 182mm
  // Erfolgsrechnung behält Δ% (erwünscht als Kennzahl, nicht als Layout-Zierde).
  const FS = 8;
  const CP = { top: 1.5, bottom: 1.5, left: 3, right: 2 };
  const CPT = { top: 3, bottom: 3, left: 3, right: 2 };

  const bSec = (label, fill, col) => [{
    content: label, colSpan: 3,
    styles: { fillColor: fill, textColor: col, fontStyle: "bold", fontSize: FS,
      cellPadding: { top: 3, bottom: 1, left: 4, right: 3 } }
  }];

  // Bilanzsumme/Totalzeilen bekommen zusätzlich zu fett eine Trennlinie darüber —
  // das klassische Buchhaltungs-Signal für "Ergebnis dieser Gruppe".
  const bRow = (label, ist, vj, { total = false, sub = false, indent = false } = {}) => {
    const fw = total || sub ? "bold" : "normal";
    const topLine = total ? { lineWidth: { top: 0.3 }, lineColor: DARK } : {};
    return [
      { content: label,    styles: { fontSize: FS, fontStyle: fw, textColor: DARK, ...topLine,
          cellPadding: { ...( total ? CPT : CP), left: indent ? 7 : 3 } } },
      { content: N(ist),   styles: { halign: "right", fontSize: FS, fontStyle: fw, textColor: DGRN, ...topLine } },
      { content: vj != null ? N(vj) : "", styles: { halign: "right", fontSize: FS, fontStyle: fw, textColor: DARK, ...topLine } },
    ];
  };

  const colHead = (title, fill, col, withPct = false) => {
    const cells = [
      { content: title,                  styles: { fillColor: fill, textColor: col, fontStyle: "bold", fontSize: FS, cellPadding: { top: 3, bottom: 3, left: 4, right: 2 } } },
      { content: String(selectedYear),   styles: { fillColor: fill, textColor: DGRN, fontStyle: "bold", halign: "right", fontSize: FS } },
      { content: String(selectedYear-1), styles: { fillColor: fill, textColor: col,  fontStyle: "bold", halign: "right", fontSize: FS } },
    ];
    if (withPct) cells.push({ content: "Δ%", styles: { fillColor: fill, textColor: col, fontStyle: "bold", halign: "right", fontSize: FS } });
    return [cells];
  };

  const COL_BILANZ = { 0: { cellWidth: 118 }, 1: { cellWidth: 32, halign: "right" },
                        2: { cellWidth: 32, halign: "right" } };
  const COL_ER = { 0: { cellWidth: 102 }, 1: { cellWidth: 28, halign: "right" },
                    2: { cellWidth: 28, halign: "right" }, 3: { cellWidth: 16, halign: "right" } };
  const MARG = { left: 14, right: 14 };

  // ── BILANZ IDs ──
  const UV_IDS      = ["UV_FLUESSIG","UV_WERTSCHRIFTEN","UV_FORD_LL","UV_FORD_LL_NAHE","UV_FORD_SONST","UV_FORD_SONST_NAHE","UV_VORRAETE","UV_ABGRENZUNG"];
  const AV_IDS      = ["AV_FINANZ","AV_FINANZ_NAHE","AV_MOBIL","AV_IMMOBIL","AV_IMMATERIELL"];
  const FK_KURZ_IDS = ["FK_KURZ_LL","FK_KURZ_LL_NAHE","FK_KURZ_BANK","FK_KURZ_VERZ_NAHE","FK_KURZ_SONST","FK_KURZ_SONST_NAHE","FK_KURZ_ABGRENZUNG"];
  const FK_LANG_IDS = ["FK_LANG_BANK","FK_LANG_VERZ_NAHE","FK_LANG_SONST","FK_LANG_SONST_NAHE","FK_RUECKSTELLUNGEN"];
  const EK_IDS      = ["EK_KAPITAL","EK_KAP_RESERVE","EK_GES_RESERVE","EK_FREIE_RESERVE","EK_RESERVEN","EK_VORTRAG","EK_JAHRESERGEBNIS"];

  // Hilfszelle: einzelne Konto-Zeile im Detail-Modus, eingerückt.
  // withPct steuert die 4. Spalte — Bilanz hat keine, Erfolgsrechnung schon.
  const kRow = (label, ist, vj, { withPct = true } = {}) => {
    const cells = [
      { content: label, styles: { fontSize: FS, fontStyle: "normal", textColor: DARK,
          cellPadding: { top: 0.8, bottom: 0.8, left: 12, right: 2 } } },
      { content: N(ist), styles: { halign: "right", fontSize: FS, fontStyle: "normal", textColor: DGRN } },
      { content: vj != null ? N(vj) : "", styles: { halign: "right", fontSize: FS, fontStyle: "normal", textColor: DARK } },
    ];
    if (withPct) {
      const p = pct(ist, vj);
      cells.push({ content: p, styles: { halign: "right", fontSize: FS, textColor: pctC(p) } });
    }
    return cells;
  };

  const posRows = (ids, flip = false) => ids.flatMap(id => {
    const pos = KONTENRAHMEN_POSITIONEN.find(p => p.id === id);
    const ist = sumI([id]) * (flip ? pSign : 1);
    const vj  = sumVJ([id]) * (flip ? pSign : 1);
    if (ist === 0 && vj === 0) return [];
    const lbl = "  " + (pos?.label || id);
    const out = [bRow(lbl, ist, vj, { indent: true })];
    if (mode === "detail") {
      // Einzelkonten dieser Position einrücken (vor dem Sub-Total)
      const kontenInPos = konten
        .filter(k => k.position_id === id)
        .sort((a, b) => (parseInt(a.kontonummer) || 0) - (parseInt(b.kontonummer) || 0));
      for (const k of kontenInPos) {
        const kIst = (parseFloat(k.saldo_ist) || 0) * (flip ? pSign : 1);
        const kVj  = (parseFloat(k.saldo_vorjahr) || 0) * (flip ? pSign : 1);
        if (kIst === 0 && kVj === 0) continue;
        const kLbl = `    ${k.kontonummer}  ${k.kontoname || ""}`;
        out.push(kRow(kLbl, kIst, kVj, { withPct: false }));
      }
    }
    return out;
  });

  const uvI = sumI(UV_IDS),  uvV = sumVJ(UV_IDS);
  const avI = sumI(AV_IDS),  avV = sumVJ(AV_IDS);
  const akI = uvI + avI,     akV = uvV + avV;
  const fkKI = sumI(FK_KURZ_IDS)*pSign, fkKV = sumVJ(FK_KURZ_IDS)*pSign;
  const fkLI = sumI(FK_LANG_IDS)*pSign, fkLV = sumVJ(FK_LANG_IDS)*pSign;
  const ekI  = sumI(EK_IDS)*pSign,      ekV  = sumVJ(EK_IDS)*pSign;
  const paI  = fkKI + fkLI + ekI,       paV  = fkKV + fkLV + ekV;

  // ── Seite 1: AKTIVEN ──
  let y = addHeader("Bilanz – Aktiven");
  autoTable(doc, {
    startY: y, head: colHead("AKTIVEN", LBLUE, BLUE), body: [
      ...bSec("UMLAUFVERMÖGEN", LBLUE, BLUE),
      ...posRows(UV_IDS),
      bRow("Total Umlaufvermögen", uvI, uvV, { sub: true }),
      ...bSec("ANLAGEVERMÖGEN", LBLUE, BLUE),
      ...posRows(AV_IDS),
      bRow("Total Anlagevermögen", avI, avV, { sub: true }),
      bRow("TOTAL AKTIVEN", akI, akV, { total: true }),
    ],
    columnStyles: COL_BILANZ, margin: MARG, styles: { fontSize: FS, cellPadding: CP }, theme: "plain",
  });

  // Nur bei echter Differenz einen Hinweis zeigen — ist die Bilanz ausgeglichen
  // (der Normalfall), bleibt es still, statt das extra zu bestätigen.
  const diff = akI - paI;
  if (Math.abs(diff) >= 0.01) {
    y = doc.lastAutoTable.finalY + 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS); doc.setTextColor(...RED);
    doc.text(`Differenz: CHF ${N(diff)}`, 14, y);
  }

  // ── Seite 2: PASSIVEN ──
  doc.addPage();
  y = addHeader("Bilanz – Passiven");
  autoTable(doc, {
    startY: y, head: colHead("PASSIVEN", LPINK, PINK), body: [
      ...bSec("KURZFRISTIGES FREMDKAPITAL", LPINK, PINK),
      ...posRows(FK_KURZ_IDS, true),
      bRow("Total Kurzfristiges FK", fkKI, fkKV, { sub: true }),
      ...bSec("LANGFRISTIGES FREMDKAPITAL", LPINK, PINK),
      ...posRows(FK_LANG_IDS, true),
      bRow("Total Langfristiges FK", fkLI, fkLV, { sub: true }),
      ...bSec("EIGENKAPITAL", LPINK, PINK),
      ...posRows(EK_IDS, true),
      bRow("Total Eigenkapital", ekI, ekV, { sub: true }),
      bRow("TOTAL PASSIVEN", paI, paV, { total: true }),
    ],
    columnStyles: COL_BILANZ, margin: MARG, styles: { fontSize: FS, cellPadding: CP }, theme: "plain",
  });

  // ── Seite 3: ERFOLGSRECHNUNG ──
  doc.addPage();
  y = addHeader("Erfolgsrechnung");

  const nuI = sumER(["ER_UMSATZ","ER_EIGENLEISTUNG","ER_BESTAND"]);
  const nuV = sumERV(["ER_UMSATZ","ER_EIGENLEISTUNG","ER_BESTAND"]);
  const matI = sumER(["ER_MATERIAL"]),  matV = sumERV(["ER_MATERIAL"]);
  const bgI_I = nuI + matI,             bgI_V = nuV + matV;
  const perI = sumER(["ER_PERSONAL"]),  perV = sumERV(["ER_PERSONAL"]);
  const bgII_I = bgI_I + perI,          bgII_V = bgI_V + perV;

  const betItems = [
    ["− Raumaufwand",                    "ER_RAUM"],
    ["− Unterhalt & Reparaturen",        "ER_UNTERHALT"],
    ["− Fahrzeug- & Transportaufwand",   "ER_FAHRZEUG"],
    ["− Sachversicherungen & Abgaben",   "ER_VERSICHERUNG"],
    ["− Energie & Entsorgung",           "ER_ENERGIE"],
    ["− Verwaltungs- & Informatikaufw.", "ER_VERWALTUNG"],
    ["− Werbe- & Akquisitionsaufw.",     "ER_WERBUNG"],
    ["− Übriger Betriebsaufwand",        "ER_BETRIEB"],
  ];
  const btI = betItems.reduce((s,[,id]) => s + sumER([id]), 0);
  const btV = betItems.reduce((s,[,id]) => s + sumERV([id]), 0);
  const edI = bgII_I + btI,  edV = bgII_V + btV;
  const abI = sumER(["ER_ABSCHR"]),  abV = sumERV(["ER_ABSCHR"]);
  const ebI = edI + abI,             ebV = edV + abV;
  const feI = sumER(["ER_FINANZ_ERTRAG","ER_LIEGENSCHAFTEN"]);
  const feV = sumERV(["ER_FINANZ_ERTRAG","ER_LIEGENSCHAFTEN"]);
  const faI = sumER(["ER_FINANZ_AUFW"]),  faV = sumERV(["ER_FINANZ_AUFW"]);
  const ebtI = ebI + feI + faI,           ebtV = ebV + feV + faV;
  const frEI = sumER(["ER_FREMD_ERTRAG","ER_AO_ERTRAG"]);
  const frEV = sumERV(["ER_FREMD_ERTRAG","ER_AO_ERTRAG"]);
  const frAI = sumER(["ER_FREMD_AUFW","ER_AO_AUFW"]);
  const frAV = sumERV(["ER_FREMD_AUFW","ER_AO_AUFW"]);
  const stI = sumER(["ER_STEUERN"]),  stV = sumERV(["ER_STEUERN"]);
  const jeI = ebtI + frEI + frAI + stI;
  const jeV = ebtV + frEV + frAV + stV;

  // ER-Zeile: 4 Spalten Label | IST | VJ | Δ% — Δ% bleibt hier (im Gegensatz zur
  // Bilanz), weil es in der Erfolgsrechnung eine echte Kennzahl ist, keine Zierde.
  const eRow = (lbl, ist, vj, { total = false, sub = false } = {}) => {
    const p = pct(ist, vj); const fw = total || sub ? "bold" : "normal";
    const topLine = total ? { lineWidth: { top: 0.3 }, lineColor: DARK } : {};
    return [
      { content: lbl, styles: { fontSize: FS, fontStyle: fw, textColor: DARK, ...topLine,
          cellPadding: { ...(total ? CPT : CP) } } },
      { content: N(ist), styles: { halign: "right", fontSize: FS, fontStyle: fw, ...topLine,
          textColor: total ? (ist >= 0 ? GREEN : RED) : DGRN } },
      { content: vj != null ? N(vj) : "", styles: { halign: "right", fontSize: FS, fontStyle: fw, textColor: DARK, ...topLine } },
      { content: p, styles: { halign: "right", fontSize: FS, textColor: pctC(p), ...topLine } },
    ];
  };
  const eSec = (lbl, fill, col) => [{
    content: lbl, colSpan: 4,
    styles: { fillColor: fill, textColor: col, fontStyle: "bold", fontSize: FS,
      cellPadding: { top: 3, bottom: 1, left: 4, right: 3 } }
  }];

  // Detail-Helper für ER: gibt die Position-Zeile + (wenn mode==="detail") die Einzelkonten zurück.
  // posIds = Array von position_id Strings, die zur gegebenen ER-Position gehören.
  const erWithDetail = (label, posIds, opts = {}) => {
    const ist = sumER(posIds), vj = sumERV(posIds);
    const out = [eRow(label, ist, vj, opts)];
    if (mode === "detail") {
      const kontenInPos = konten
        .filter(k => posIds.includes(k.position_id))
        .sort((a, b) => (parseInt(a.kontonummer) || 0) - (parseInt(b.kontonummer) || 0));
      for (const k of kontenInPos) {
        const kIst = (parseFloat(k.saldo_ist) || 0) * eSign;
        const kVj  = (parseFloat(k.saldo_vorjahr) || 0) * eSign;
        if (kIst === 0 && kVj === 0) continue;
        const kLbl = `      ${k.kontonummer}  ${k.kontoname || ""}`;
        out.push(kRow(kLbl, kIst, kVj));
      }
    }
    return out;
  };

  const erBody = [
    ...eSec("ERLÖS", LGRN, GREEN),
    ...erWithDetail("  Nettoumsatzerlöse", ["ER_UMSATZ"]),
    ...(sumER(["ER_EIGENLEISTUNG"]) || sumERV(["ER_EIGENLEISTUNG"])
      ? erWithDetail("  Eigenleistungen", ["ER_EIGENLEISTUNG"]) : []),
    ...(sumER(["ER_BESTAND"]) || sumERV(["ER_BESTAND"])
      ? erWithDetail("  Bestandesveränderungen", ["ER_BESTAND"]) : []),
    eRow("Nettoumsatz Total", nuI, nuV, { sub: true }),
    ...erWithDetail("  − Warenaufwand", ["ER_MATERIAL"]),
    eRow("= Bruttogewinn I (Rohergebnis)", bgI_I, bgI_V, { total: true }),
    ...erWithDetail("  − Personalaufwand", ["ER_PERSONAL"]),
    eRow("= Bruttogewinn II",  bgII_I, bgII_V, { total: true }),
    ...eSec("BETRIEBSKOSTEN", LYEL, MGRN),
    ...betItems.flatMap(([lbl, id]) =>
      (sumER([id]) || sumERV([id])) ? erWithDetail("  " + lbl, [id]) : []),
    eRow("= EBITDA", edI, edV, { total: true }),
    ...eSec("ABSCHREIBUNGEN", LGRAY, DARK),
    ...erWithDetail("  − Abschreibungen", ["ER_ABSCHR"]),
    eRow("= EBIT", ebI, ebV, { total: true }),
    ...eSec("FINANZERGEBNIS", LGRAY, DARK),
    ...erWithDetail("  + Finanzertrag", ["ER_FINANZ_ERTRAG", "ER_LIEGENSCHAFTEN"]),
    ...erWithDetail("  − Finanzaufwand", ["ER_FINANZ_AUFW"]),
    eRow("= EBT", ebtI, ebtV, { total: true }),
    ...eSec("SONDERERGEBNIS & STEUERN", LGRAY, DARK),
    ...(frEI || frEV ? erWithDetail("  + Betriebsfremder/AO Ertrag",  ["ER_FREMD_ERTRAG", "ER_AO_ERTRAG"]) : []),
    ...(frAI || frAV ? erWithDetail("  − Betriebsfremder/AO Aufwand", ["ER_FREMD_AUFW", "ER_AO_AUFW"]) : []),
    ...(stI  || stV  ? erWithDetail("  − Ertragssteuern",             ["ER_STEUERN"]) : []),
    eRow("JAHRESERGEBNIS", jeI, jeV, { total: true }),
  ];

  autoTable(doc, {
    startY: y, head: colHead("ERFOLGSRECHNUNG", LGRN, GREEN, true),
    body: erBody, columnStyles: COL_ER, margin: MARG,
    styles: { fontSize: FS, cellPadding: CP }, theme: "plain",
  });

  // Bei returnDoc: doc + autoTable an Aufrufer zurückgeben (für Revisions-Dossier)
  if (returnDoc) return { doc, autoTable };

  // ── Footer alle Seiten ──
  addAbschlussFooters(doc, customerName, selectedYear);
  doc.save(`Jahresabschluss_${safeFileName(customerName)}_${selectedYear}.pdf`);
}

// ── Revisions-Dossier (ZIP: Haupt-PDF + Belege pro Konto) ─────────────────────
async function generateRevisionsDossier({ konten, einstellungen, customerName, selectedYear, onProgress, mode = "mindest" }) {
  const log = (m) => { try { onProgress?.(m); } catch { /* noop */ } };
  // Treuhand-Grün-Palette (konsistent mit generateAbschlussPDF + FiBu-Modul)
  const DARK = [40, 40, 50], GRAY = [120, 120, 130];
  const BLUE = [61, 102, 65];                 // Section-Header in Kontenplan-Detail (war reines Blau, jetzt Treuhand-Grün)
  const GREEN = [61, 102, 65];                // Beleg-Ref-Akzent + Arbeitspapier-Header
  const LGRAY = [245, 247, 250], LGRN = [232, 240, 232];
  const N = (v) => v == null || isNaN(v) ? "—"
    : Number(v).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  log("Erstelle Bilanz, Erfolgsrechnung …");
  const { doc, autoTable } = await generateAbschlussPDF({
    konten, einstellungen, customerName, selectedYear, returnDoc: true, mode,
  });

  // ── Zusatz-Seitenkopf ──
  const pageHeader = (title) => {
    doc.addPage();
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
    doc.text(customerName || "Jahresabschluss", 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text(`${title}  ·  Geschäftsjahr ${selectedYear}`, 14, 20);
    doc.setDrawColor(...GRAY); doc.setLineWidth(0.25); doc.line(14, 23, 196, 23);
    return 29;
  };

  // ── Beleg-Nummerierung pro Konto ({Kontonr}-{lfd. Nr}) ──
  // filePath = relativer Pfad im ZIP — identisch mit dem Pfad, der unten beim
  // ZIP-Aufbau geschrieben wird. So zeigen Links im PDF auf die Datei nebenan.
  const sorted = [...konten].sort((a, b) =>
    (parseInt(a.kontonummer) || 0) - (parseInt(b.kontonummer) || 0));
  const belegList = [];          // { ref, kontonummer, kontoname, beleg, filePath }
  const belegRefByKonto = {};    // kontoId → ["1024-1", "1024-2"]
  for (const k of sorted) {
    const belege = k.arbeitspapier?.belege || [];
    const posLabel = k.position_id ? (POSITION_MAP[k.position_id]?.label || "") : "";
    belege.forEach((b, i) => {
      const ref = `${k.kontonummer}-${i + 1}`;
      const orig = b.filename || b.name || "beleg";
      const ext = orig.includes(".") ? orig.split(".").pop() : "pdf";
      const cleanBase = safeFileName(orig.replace(/\.[^.]+$/, "")).slice(0, 30);
      // Sprechender Dateiname: Kontonr_Kontoname_Position_lfdNr_Originalname
      const nameParts = [
        k.kontonummer,
        safeFileName(k.kontoname || "").slice(0, 40),
        safeFileName(posLabel).slice(0, 40),
        String(i + 1),
        cleanBase,
      ].filter(Boolean);
      const filePath = `Belege/${nameParts.join("_")}.${ext}`;
      belegList.push({ ref, kontonummer: k.kontonummer, kontoname: k.kontoname, positionLabel: posLabel, docId: b.id, beleg: b, filePath });
      (belegRefByKonto[k.id] = belegRefByKonto[k.id] || []).push(ref);
    });
  }

  // ── Anhang-Seiten ──
  const blocks = einstellungen?.anhang_blocks || [];
  if (blocks.length) {
    log("Anhang …");
    let y = pageHeader("Anhang zur Jahresrechnung");
    blocks.forEach((b, bi) => {
      if (y > 255) y = pageHeader("Anhang zur Jahresrechnung (Forts.)");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...DARK);
      const tl = doc.splitTextToSize(`${bi + 1}.  ${b.titel || "Anhangspunkt"}`, 182);
      doc.text(tl, 14, y); y += tl.length * 5 + 1.5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(60, 60, 70);
      const lines = doc.splitTextToSize(b.inhalt || "—", 182);
      for (const line of lines) {
        if (y > 282) y = pageHeader("Anhang zur Jahresrechnung (Forts.)");
        doc.text(line, 14, y); y += 4.6;
      }
      y += 7;
    });
  }

  // ── Kontenplan-Detail mit Notizen & Beleg-Referenzen ──
  log("Kontenplan-Detail …");
  const posOrder = KONTENRAHMEN_POSITIONEN.map(p => p.id);
  // Vom Export ausgeschlossene Positionen (technische Hilfsgruppen, nicht im Abschluss-PDF gewünscht)
  const EXCLUDED_POSITIONS = new Set(["ABSCHLUSS", "__KEIN_MAPPING__"]);
  const grouped = {};
  for (const k of sorted) {
    const key = k.position_id || "__KEIN_MAPPING__";
    if (EXCLUDED_POSITIONS.has(key)) continue; // OHNE MAPPING + Abschlusskonten überspringen
    (grouped[key] = grouped[key] || []).push(k);
  }
  const groupKeys = [
    ...posOrder.filter(id => grouped[id]),
    ...Object.keys(grouped).filter(k => !posOrder.includes(k)),
  ];

  const kpBody = [];
  for (const gk of groupKeys) {
    const rows = grouped[gk];
    const pos = POSITION_MAP[gk];
    const gLabel = pos?.label || "Ohne Mapping";
    kpBody.push([{
      content: gLabel.toUpperCase(), colSpan: 6,
      styles: { fillColor: LGRAY, textColor: BLUE, fontStyle: "bold", fontSize: 8,
        cellPadding: { top: 2.6, bottom: 2, left: 3, right: 2 } },
    }]);
    let gIst = 0, gVj = 0;
    for (const k of rows) {
      const ist = parseFloat(k.saldo_ist) || 0;
      const vj  = parseFloat(k.saldo_vorjahr) || 0;
      gIst += ist; gVj += vj;
      const refs = (belegRefByKonto[k.id] || []).join(", ");
      kpBody.push([
        { content: String(k.kontonummer || ""), styles: { fontStyle: "bold", textColor: DARK } },
        { content: k.kontoname || "", styles: { textColor: DARK } },
        { content: N(ist), styles: { halign: "right", textColor: DARK } },
        { content: N(vj),  styles: { halign: "right", textColor: GRAY } },
        { content: k.notiz || "", styles: { textColor: [70, 70, 80], fontSize: 7 } },
        { content: refs, styles: { halign: "center", textColor: GREEN, fontSize: 7, fontStyle: "bold" } },
      ]);
    }
    kpBody.push([
      { content: `Total ${gLabel}`, colSpan: 2,
        styles: { fontStyle: "bold", textColor: DARK, fontSize: 8 } },
      { content: N(gIst), styles: { halign: "right", fontStyle: "bold", textColor: DARK } },
      { content: N(gVj),  styles: { halign: "right", fontStyle: "bold", textColor: GRAY } },
      { content: "", colSpan: 2 },
    ]);
  }

  // Sammelt die Beleg-Zell-Positionen im Kontenplan-Detail (page/x/y/w/h + refs)
  // → werden später mit den Ziel-Positionen aus dem Beleg-Verzeichnis verlinkt.
  const linkSources = [];
  const linkTargets = {}; // ref → { page, y }

  let yk = pageHeader("Kontenplan-Detail mit Notizen & Belegen");
  autoTable(doc, {
    startY: yk,
    head: [[
      { content: "Konto-Nr", styles: { halign: "left" } },
      { content: "Kontoname" },
      { content: `Saldo ${selectedYear}`, styles: { halign: "right" } },
      { content: `Saldo ${selectedYear - 1}`, styles: { halign: "right" } },
      { content: "Notiz / Bemerkung" },
      { content: "Belege", styles: { halign: "center" } },
    ]],
    body: kpBody,
    columnStyles: {
      0: { cellWidth: 18 }, 1: { cellWidth: 52 }, 2: { cellWidth: 27 },
      3: { cellWidth: 27 }, 4: { cellWidth: 40 }, 5: { cellWidth: 18 },
    },
    margin: { left: 14, right: 14, top: 12 },
    styles: { fontSize: 7.5, cellPadding: { top: 1.6, bottom: 1.6, left: 3, right: 2 }, overflow: "linebreak" },
    headStyles: { fillColor: LGRN, textColor: DARK, fontStyle: "bold", fontSize: 7.5 },
    theme: "grid",
    didDrawCell: (data) => {
      // Belege-Spalte (Index 5) in Body-Zeilen: Position für späteren Hyperlink merken
      if (data.column.index === 5 && data.row.section === "body") {
        const raw = (data.cell.raw && data.cell.raw.content) || "";
        const refs = String(raw).split(",").map(s => s.trim()).filter(Boolean);
        if (refs.length === 0) return;
        linkSources.push({
          page: doc.internal.getCurrentPageInfo().pageNumber,
          x: data.cell.x, y: data.cell.y, w: data.cell.width, h: data.cell.height,
          refs,
        });
      }
    },
    didDrawPage: () => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
      doc.text(customerName || "Jahresabschluss", 14, 15);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
      doc.text(`Kontenplan-Detail mit Notizen & Belegen  ·  Geschäftsjahr ${selectedYear}`, 14, 20);
      doc.setDrawColor(...GRAY); doc.setLineWidth(0.25); doc.line(14, 23, 196, 23);
    },
  });

  // ── Arbeitspapiere (pro Konto mit nicht-leerem Arbeitspapier) ──
  const apKonten = sorted.filter(k => {
    const ap = k.arbeitspapier;
    return ap?.rows?.length && ap?.columns?.length
      && ap.rows.some(r => Object.values(r.cells || {}).some(v => String(v).trim()));
  });
  if (apKonten.length) {
    log("Arbeitspapiere …");
    let ya = pageHeader("Arbeitspapiere");
    for (const k of apKonten) {
      const ap = k.arbeitspapier;
      if (ya > 250) ya = pageHeader("Arbeitspapiere (Forts.)");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...DARK);
      doc.text(`Konto ${k.kontonummer}  ${k.kontoname || ""}`, 14, ya);
      ya += 2;
      autoTable(doc, {
        startY: ya + 1,
        head: [ap.columns.map(c => ({ content: c.label || "", styles: { halign: "left" } }))],
        body: ap.rows.map(r => ap.columns.map(c => {
          const raw = r.cells?.[c.id] ?? "";
          const expr = String(raw).startsWith("=") ? String(raw).slice(1) : null;
          const num = expr != null ? evalExpr(expr) : null;
          return num !== null ? fmtCHF(num) : String(raw);
        })),
        margin: { left: 14, right: 14 },
        styles: { fontSize: 7.5, cellPadding: 1.6, overflow: "linebreak" },
        headStyles: { fillColor: LGRN, textColor: GREEN, fontStyle: "bold", fontSize: 7.5 },
        theme: "grid",
      });
      ya = doc.lastAutoTable.finalY + 9;
    }
  }

  // Link-Ziel: bevorzugt direkter Link ins Online-Dokument (Dateiablage), sonst
  // relativer Datei-Pfad im ZIP. So führt „Link klicken" direkt aufs Dokument.
  const appOrigin = (typeof window !== "undefined" && window.location?.origin) || "";
  const docUrl = (item) => (appOrigin && item?.docId)
    ? `${appOrigin}/Dokumente?open=${item.docId}`
    : item?.filePath;

  // ── Beleg-Verzeichnis-Seite ──
  if (belegList.length) {
    let yv = pageHeader("Beleg-Verzeichnis");
    autoTable(doc, {
      startY: yv,
      head: [["Beleg-Nr", "Konto", "Dokument"]],
      body: belegList.map(b => [
        b.ref,
        `${b.kontonummer}  ${b.kontoname || ""}`,
        b.beleg.name || b.beleg.filename || "—",
      ]),
      columnStyles: { 0: { cellWidth: 24, fontStyle: "bold" }, 1: { cellWidth: 70 }, 2: { cellWidth: 88 } },
      margin: { left: 14, right: 14 },
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: LGRN, textColor: DARK, fontStyle: "bold" },
      theme: "grid",
      didDrawCell: (data) => {
        if (data.row.section !== "body") return;
        const item = belegList[data.row.index];
        if (!item) return;
        // Beleg-Nr-Spalte: Ziel-Position für interne Sprünge aus Kontenplan-Detail merken
        if (data.column.index === 0) {
          linkTargets[item.ref] = {
            page: doc.internal.getCurrentPageInfo().pageNumber,
            y: data.cell.y,
          };
        }
        // Dokumentname-Spalte: Link direkt aufs Online-Dokument (Fallback: Datei im ZIP)
        if (data.column.index === 2) {
          const url = docUrl(item);
          if (url) doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
        }
      },
    });

    // ── Hyperlinks setzen: Kontenplan-Detail-Belege-Zelle → Beleg-Datei oder Verzeichnis-Zeile ──
    // Bevorzugt File-Link (öffnet die Beleg-Datei direkt aus dem Belege/-Unterordner der ZIP).
    // Fallback: interner Sprung zum Beleg-Verzeichnis.
    const belegByRef = Object.fromEntries(belegList.map(b => [b.ref, b]));
    for (const src of linkSources) {
      const firstRef = src.refs[0];
      if (!firstRef) continue;
      doc.setPage(src.page);
      const url = docUrl(belegByRef[firstRef]);
      if (url) {
        doc.link(src.x, src.y, src.w, src.h, { url });
      } else {
        const target = linkTargets[firstRef];
        if (!target) continue;
        const topY = Math.max(0, target.y - 4);
        doc.link(src.x, src.y, src.w, src.h, { pageNumber: target.page, top: topY });
      }
    }
  }

  // ── Footer auf alle Seiten ──
  addAbschlussFooters(doc, customerName, selectedYear, "Revisions-Dossier");

  // ── ZIP zusammenstellen ──
  log("Belege werden geladen …");
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const baseName = `Revisions-Dossier_${safeFileName(customerName)}_${selectedYear}`;

  zip.file(`${baseName}.pdf`, doc.output("arraybuffer"));

  // Belege herunterladen und unter dem im belegList vorbereiteten filePath ablegen
  // (selber Pfad wie die Links im PDF — sonst funktionieren die nicht).
  const belegFolder = zip.folder("Belege");
  let okCount = 0;
  const failed = [];
  for (let i = 0; i < belegList.length; i++) {
    const item = belegList[i];
    log(`Beleg ${i + 1} / ${belegList.length} …`);
    // storage_path-Präfix "dokumente/" entfernen — sonst schlägt createSignedUrl fehl
    const path = (item.beleg.storage_path || "").replace(/^dokumente\//, "");
    const fail = (reason) => failed.push({
      kontonummer: item.kontonummer, kontoname: item.kontoname,
      name: item.beleg.name || item.beleg.filename || "Beleg",
      filename: item.beleg.filename || "", reason,
    });
    try {
      if (!path) { fail("kein Speicherpfad"); continue; }
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) { fail(error?.message || "Datei nicht gefunden"); continue; }
      const resp = await fetch(data.signedUrl);
      if (!resp.ok) { fail(`HTTP ${resp.status}`); continue; }
      const buf = await resp.arrayBuffer();
      // item.filePath beginnt mit "Belege/" — wir speichern den Rest im Sub-Folder
      const filename = item.filePath.replace(/^Belege\//, "");
      belegFolder.file(filename, buf);
      okCount++;
    } catch (e) { fail(e?.message || "Fehler beim Laden"); }
  }
  const failCount = failed.length;

  // Fehlende Belege für den Revisor dokumentieren (Textdatei im ZIP)
  if (failCount) {
    const txt = [
      `NICHT LADBARE BELEGE — ${failCount} von ${belegList.length}`,
      `Kunde: ${customerName}  ·  Geschäftsjahr: ${selectedYear}  ·  Erstellt: ${todayStr()}`,
      "",
      ...failed.map(f => `- Konto ${f.kontonummer || "—"} ${f.kontoname || ""} | ${f.name}${f.filename ? ` (${f.filename})` : ""} — ${f.reason}`),
    ].join("\r\n");
    belegFolder.file("_FEHLENDE_BELEGE.txt", txt);
  }

  log("ZIP wird gepackt …");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${baseName}.zip`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return { belegOk: okCount, belegFail: failCount, belegTotal: belegList.length, failed };
}

function todayStr() {
  return new Date().toLocaleDateString("de-CH");
}

function currentYear() {
  return new Date().getFullYear();
}

const YEARS = Array.from({ length: 11 }, (_, i) => 2020 + i);

const STATUS_CONFIG = {
  in_arbeit:    { label: "In Arbeit",    bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" },
  abgeschlossen:{ label: "Abgeschlossen",bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  genehmigt:    { label: "Genehmigt",   bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
};

// ── CSV Export ────────────────────────────────────────────────────────────────
function exportKontenCSV(konten, customerName, jahr) {
  const headers = ["Konto-Nr", "Kontoname", "Position", "Saldo IST", "Saldo VJ", "Notiz"];
  const rows = konten.map(k => {
    const pos = k.position_id;
    const posLabel = pos ? (POSITION_MAP[pos]?.label || pos) : "—";
    return [
      k.kontonummer, k.kontoname, posLabel,
      k.saldo_ist ?? "", k.saldo_vorjahr ?? "", k.notiz ?? "",
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";");
  });
  const bom = "\uFEFF";
  const csv = bom + [
    `"Abschlussdokumentation – ${customerName} – ${jahr}"`,
    `"Erstellt am: ${todayStr()}"`,
    "",
    headers.map(h => `"${h}"`).join(";"),
    ...rows,
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Abschluss_${customerName.replace(/[^a-zA-Z0-9]/g, "_")}_${jahr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Mandanten-Dropdown (wiederverwendet aus Fahrzeugliste-Pattern) ────────────
function MandantDropdown({ kunden, selectedCid, onChange, panelBg, panelBdr, headingC, subC, accent, withAbschlussSet }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const getLabel = (c) => c.person_type === "privatperson"
    ? [c.anrede, c.nachname, c.vorname].filter(Boolean).join(" ") + (c.ort ? ` · ${c.ort}` : "")
    : c.company_name + (c.ort ? ` · ${c.ort}` : "");

  const selected = kunden.find(c => c.id === selectedCid);

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= 320 ? rect.bottom + 4 : rect.top - 320 - 4;
    setDropPos({ top, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) { setSearch(""); setHighlightIdx(-1); return; }
    calcPos();
    setTimeout(() => inputRef.current?.focus(), 30);
    const onClose = (e) => { if (!triggerRef.current?.contains(e.target)) setOpen(false); };
    const onScroll = () => calcPos();
    document.addEventListener("mousedown", onClose);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", calcPos);
    return () => {
      document.removeEventListener("mousedown", onClose);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", calcPos);
    };
  }, [open, calcPos]);

  const q = search.trim().toLowerCase();
  const filtered = kunden.filter(c => !q || getLabel(c).toLowerCase().includes(q));
  const unternehmen = filtered.filter(c => c.person_type !== "privatperson");
  const privatpersonen = filtered.filter(c => c.person_type === "privatperson");
  // Flache Liste für Keyboard-Navigation (Unternehmen zuerst, dann Privatpersonen)
  const flatList = [...unternehmen, ...privatpersonen];

  const handleKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx(i => { const next = Math.min(i + 1, flatList.length - 1); scrollToItem(next); return next; });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(i => { const next = Math.max(i - 1, 0); scrollToItem(next); return next; });
    } else if (e.key === "Enter" && highlightIdx >= 0 && flatList[highlightIdx]) {
      onChange(flatList[highlightIdx].id); setOpen(false);
    }
  };

  const scrollToItem = (idx) => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  };

  const renderRow = (c, globalIdx) => {
    const hasAbschluss = withAbschlussSet?.has(c.id);
    const isActive = c.id === selectedCid;
    const isHighlighted = globalIdx === highlightIdx;
    return (
      <div key={c.id}
        data-idx={globalIdx}
        onMouseDown={e => e.stopPropagation()}
        onClick={() => { onChange(c.id); setOpen(false); }}
        onMouseEnter={() => setHighlightIdx(globalIdx)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", cursor: "pointer", fontSize: 13, color: headingC,
          backgroundColor: isHighlighted ? accent + "20" : isActive ? accent + "14" : "transparent",
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          backgroundColor: hasAbschluss ? "#22c55e" : "transparent",
          border: hasAbschluss ? "none" : `1.5px solid ${panelBdr}`,
          display: "inline-block",
        }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getLabel(c)}</span>
      </div>
    );
  };

  const dropdown = open && createPortal(
    <div onMouseDown={e => e.stopPropagation()} style={{
      position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width,
      backgroundColor: panelBg, border: `1px solid ${panelBdr}`, borderRadius: 10,
      boxShadow: "0 8px 28px rgba(0,0,0,0.16)", zIndex: 999999, overflow: "hidden",
    }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${panelBdr}`, display: "flex", alignItems: "center", gap: 6 }}>
        <Search size={13} style={{ color: subC, flexShrink: 0 }} />
        <input ref={inputRef} value={search}
          onChange={e => { setSearch(e.target.value); setHighlightIdx(-1); }}
          onKeyDown={handleKeyDown}
          placeholder="Mandant suchen…"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 13, background: "transparent", color: headingC }} />
        {search && <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 16, padding: 0 }}>&times;</button>}
      </div>
      <div ref={listRef} style={{ maxHeight: 300, overflowY: "auto" }}>
        {!q && (
          <div onClick={() => { onChange(""); setOpen(false); }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13, color: subC }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = accent + "14"}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
            <span style={{ width: 8, height: 8, display: "inline-block" }} />
            – Mandant auswählen –
          </div>
        )}
        {unternehmen.length > 0 && (
          <>
            <div style={{ padding: "5px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: subC, borderTop: `1px solid ${panelBdr}`, textTransform: "uppercase" }}>Unternehmen</div>
            {unternehmen.map((c, i) => renderRow(c, i))}
          </>
        )}
        {privatpersonen.length > 0 && (
          <>
            <div style={{ padding: "5px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: subC, borderTop: `1px solid ${panelBdr}`, textTransform: "uppercase" }}>Privatpersonen</div>
            {privatpersonen.map((c, i) => renderRow(c, unternehmen.length + i))}
          </>
        )}
        {filtered.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: subC, textAlign: "center" }}>Keine Treffer</div>
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={triggerRef} style={{ flex: 1, maxWidth: 380 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full rounded-lg border text-sm px-3 py-2 focus:outline-none text-left"
        style={{ backgroundColor: panelBg, borderColor: open ? accent : panelBdr, color: headingC, cursor: "pointer", transition: "border-color 0.15s" }}>
        {selected && (
          <span style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            backgroundColor: withAbschlussSet?.has(selectedCid) ? "#22c55e" : "transparent",
            border: withAbschlussSet?.has(selectedCid) ? "none" : `1.5px solid ${panelBdr}`,
            display: "inline-block",
          }} />
        )}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? getLabel(selected) : "– Mandant auswählen –"}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, color: subC, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

// ── Positions-Badge ───────────────────────────────────────────────────────────
const POSITION_BADGE_COLORS = {
  aktiven:  { bg: "#dbeafe", text: "#1d4ed8" },
  passiven: { bg: "#fce7f3", text: "#9d174d" },
  ertrag:   { bg: "#dcfce7", text: "#15803d" },
  aufwand:  { bg: "#fef3c7", text: "#92400e" },
};

function PositionBadge({ posId }) {
  if (!posId) return <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>;
  const pos = POSITION_MAP[posId];
  if (!pos) return <span style={{ fontSize: 11, color: "#9ca3af" }}>{posId}</span>;
  const colors = POSITION_BADGE_COLORS[pos.seite] || { bg: "#f3f4f6", text: "#374151" };
  return (
    <span style={{
      display: "inline-block", fontSize: 10, fontWeight: 600, padding: "2px 7px",
      borderRadius: 5, backgroundColor: colors.bg, color: colors.text,
      whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
    }} title={pos.label}>
      {pos.label}
    </span>
  );
}

// ── Inline-Positions-Selector ─────────────────────────────────────────────────
function PositionSelector({ value, onChange, subC, panelBg, panelBdr, headingC, accent }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 260 });
  const triggerRef = useRef(null);

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= 300 ? rect.bottom + 2 : rect.top - 300 - 2;
    setDropPos({ top, left: rect.left, width: Math.max(rect.width, 260) });
  }, []);

  useEffect(() => {
    if (!open) { setSearch(""); return; }
    calcPos();
    const onClose = (e) => { if (!triggerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClose);
    return () => document.removeEventListener("mousedown", onClose);
  }, [open, calcPos]);

  const filtered = KONTENRAHMEN_POSITIONEN.filter(p =>
    !search.trim() || p.label.toLowerCase().includes(search.trim().toLowerCase()) || p.id.toLowerCase().includes(search.trim().toLowerCase())
  );

  const dropdown = open && createPortal(
    <div onMouseDown={e => e.stopPropagation()} style={{
      position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width,
      backgroundColor: panelBg, border: `1px solid ${panelBdr}`, borderRadius: 8,
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)", zIndex: 999999, overflow: "hidden",
    }}>
      <div style={{ padding: "6px 8px", borderBottom: `1px solid ${panelBdr}`, display: "flex", alignItems: "center", gap: 5 }}>
        <Search size={11} style={{ color: subC }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          autoFocus placeholder="Position suchen…"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 12, background: "transparent", color: headingC }} />
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        <div onClick={() => { onChange(null); setOpen(false); }}
          style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12, color: subC }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = accent + "14"}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
          — Keine Position —
        </div>
        {filtered.map(p => {
          const colors = POSITION_BADGE_COLORS[p.seite] || { bg: "#f3f4f6", text: "#374151" };
          return (
            <div key={p.id}
              onClick={() => { onChange(p.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 10px", cursor: "pointer", fontSize: 12,
                backgroundColor: p.id === value ? accent + "18" : "transparent", color: headingC,
              }}
              onMouseEnter={e => { if (p.id !== value) e.currentTarget.style.backgroundColor = accent + "10"; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = p.id === value ? accent + "18" : "transparent"; }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, flexShrink: 0, backgroundColor: colors.bg, border: `1px solid ${colors.text}40` }} />
              <span style={{ flex: 1 }}>{p.label}</span>
              <span style={{ fontSize: 10, color: subC }}>{p.von}–{p.bis}</span>
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={triggerRef} style={{ display: "inline-block" }}>
      <button type="button" onClick={(e) => { e.stopPropagation(); calcPos(); setOpen(o => !o); }}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        <PositionBadge posId={value} />
      </button>
      {dropdown}
    </div>
  );
}

// ── Import Dialog ─────────────────────────────────────────────────────────────
function ImportDialog({ onClose, onImport, accent, theme, initialFlipPassiven = false, initialFlipER = false, customerId, selectedYear }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const panelBg  = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a";
  const panelBdr = isArtis ? "#ccd8cc" : isLight ? "#e2e2ec" : "#3f3f46";
  const headingC = isArtis ? "#1a3a1a" : isLight ? "#1e293b" : "#e4e4e7";
  const subC     = isArtis ? "#4a6a4a" : isLight ? "#64748b" : "#a1a1aa";
  const pageBg   = isArtis ? "#f2f5f2" : isLight ? "#f4f4f8" : "#2a2a2f";

  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [colMap, setColMap] = useState({ kontonummer: "", kontoname: "", saldo_ist: "", saldo_vorjahr: "" });
  const [preview, setPreview] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [flipPassiven, setFlipPassiven] = useState(initialFlipPassiven);
  const [flipER, setFlipER] = useState(initialFlipER);
  // Sheet-Picker: wenn Excel mehrere Blätter hat
  const [sheetPicker, setSheetPicker] = useState(null); // { wb, filename, sheetNames }
  const [selectedSheets, setSelectedSheets] = useState([]);
  const fileRef = useRef(null);
  const file2Ref = useRef(null);
  const pdfRef = useRef(null);

  // ── Aus E-Binder wählen: statt lokal suchen, direkt aus den schon
  //    hochgeladenen Dokumenten des Mandanten importieren ───────────────────
  const [showEBinderPicker, setShowEBinderPicker] = useState(false);
  const [eBinderDocs, setEBinderDocs] = useState([]);
  const [eBinderLoading, setEBinderLoading] = useState(false);
  const [eBinderSearch, setEBinderSearch] = useState("");
  const [eBinderSelected, setEBinderSelected] = useState([]); // bis zu 2 Dokumente
  const [eBinderImporting, setEBinderImporting] = useState(false);
  // Vorschau rechts daneben — unabhängig von der Auswahl fürs Importieren.
  const [eBinderPreview, setEBinderPreview] = useState(null);
  const [eBinderPreviewUrl, setEBinderPreviewUrl] = useState(null);
  const [eBinderPreviewLoading, setEBinderPreviewLoading] = useState(false);

  useEffect(() => {
    if (!eBinderPreview) { setEBinderPreviewUrl(null); return; }
    const path = (eBinderPreview.storage_path || "").replace(/^dokumente\//, "");
    if (!path) { setEBinderPreviewUrl(null); return; }
    let aktiv = true;
    setEBinderPreviewLoading(true);
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!aktiv) return;
      setEBinderPreviewLoading(false);
      if (data?.signedUrl) setEBinderPreviewUrl(data.signedUrl);
      else { setEBinderPreviewUrl(null); toast.error("Vorschau nicht verfügbar" + (error ? ": " + error.message : "")); }
    });
    return () => { aktiv = false; };
  }, [eBinderPreview]);

  useEffect(() => {
    if (!showEBinderPicker || !customerId || eBinderDocs.length > 0) return;
    setEBinderLoading(true);
    let q = supabase.from("dokumente")
      .select("id, name, filename, storage_path, category, year, file_type")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (selectedYear) q = q.eq("year", selectedYear);
    q.then(({ data, error }) => {
      setEBinderLoading(false);
      if (error) { toast.error("E-Binder konnte nicht geladen werden: " + error.message); return; }
      setEBinderDocs(data || []);
    });
  }, [showEBinderPicker, customerId, selectedYear]);

  const toggleEBinderDoc = (doc) => {
    setEBinderSelected(prev => {
      if (prev.some(d => d.id === doc.id)) return prev.filter(d => d.id !== doc.id);
      if (prev.length >= 2) { toast.error("Maximal 2 Dateien gleichzeitig (Bilanz + ER)"); return prev; }
      return [...prev, doc];
    });
  };

  async function importFromEBinder() {
    if (!eBinderSelected.length) return;
    setEBinderImporting(true);
    try {
      const files = [];
      for (const doc of eBinderSelected) {
        const path = (doc.storage_path || "").replace(/^dokumente\//, "");
        if (!path) throw new Error(`${doc.name}: kein Speicherpfad`);
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error || !data) throw new Error(`${doc.name}: ${error?.message || "Download fehlgeschlagen"}`);
        files.push(new File([data], doc.filename || doc.name, { type: data.type }));
      }
      setShowEBinderPicker(false);
      setEBinderSelected([]);
      const pdfs = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
      const others = files.filter(f => !f.name.toLowerCase().endsWith(".pdf"));
      if (pdfs.length > 0) parsePdfFiles(pdfs.slice(0, 2));
      else if (others.length > 1) parseMultipleFiles(others);
      else if (others[0]) parseFile(others[0]);
    } catch (e) {
      toast.error("Import aus E-Binder fehlgeschlagen: " + (e?.message || String(e)));
    } finally {
      setEBinderImporting(false);
    }
  }

  // Spalten-Erkennung: Muster in Prioritäts-Reihenfolge (erstes Muster gewinnt),
  // optional mit Ausschluss-Wörtern (verhindert z.B. "Kontoname" als Kontonummer).
  function detectColumn(headers, patterns, exclude = []) {
    for (const p of patterns) {
      for (const h of headers) {
        const lc = String(h).toLowerCase().trim();
        if (!lc || exclude.some(x => lc.includes(x))) continue;
        if (lc.includes(p)) return h;
      }
    }
    return "";
  }

  // ── CSV robust parsen: Separator über mehrere Zeilen erkennen, Anführungs-
  //    zeichen korrekt behandeln ("Bank; UBS" wird nicht zerrissen) ───────────
  function parseCsvText(text) {
    const sample = text.split("\n").slice(0, 20).join("\n");
    const count = (ch) => (sample.match(new RegExp(ch === "\t" ? "\t" : "\\" + ch, "g")) || []).length;
    const sep = count(";") >= count("\t") && count(";") >= count(",") ? ";"
      : count("\t") >= count(",") ? "\t" : ",";
    const rows = []; let row = [], cell = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim()));
  }

  // ── Kopfzeile finden: Exporte haben oft Titel-/Leerzeilen VOR dem Header ──
  const HDR_HINTS = ["konto", "nummer", "bezeichnung", "saldo", "betrag", "soll", "haben", "vorjahr", "name", "text"];
  function findHeaderRowIdx(rows) {
    const limit = Math.min(rows.length, 15);
    let best = -1, bestScore = 0;
    for (let i = 0; i < limit; i++) {
      const cells = rows[i].map(c => String(c).toLowerCase().trim());
      const hits = cells.filter(c => c && HDR_HINTS.some(h => c.includes(h))).length;
      // Zeilen, die selbst wie Kontodaten aussehen (Zelle = reine Kontonummer), abwerten
      const looksLikeData = cells.some(c => /^\d{3,6}$/.test(c));
      const score = hits * 2 - (looksLikeData ? 3 : 0);
      if (hits >= 1 && score > bestScore) { best = i; bestScore = score; }
    }
    return best >= 0 ? best : 0;
  }

  // ── Zahl robust parsen: 1'234.56 · 147’650.32 · 133 980.00 · 1.234,56 · -50 ──
  function parseNumSmart(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isNaN(v) ? null : v;
    let s = String(v).trim().replace(/CHF|EUR|USD/gi, "").trim();
    const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
    s = s.replace(/[()]/g, "").replace(/[\s'’]/g, "").replace(/^-/, "");
    if (s.includes(".") && s.includes(",")) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")   // DE: 1.234,56
        : s.replace(/,/g, "");                       // EN: 1,234.56
    } else if (s.includes(",")) {
      const p = s.split(",");
      s = p[p.length - 1].length <= 2 ? p.slice(0, -1).join("") + "." + p[p.length - 1] : p.join("");
    }
    const n = parseFloat(s);
    return isNaN(n) ? null : (neg ? -n : n);
  }

  // ── PDF Text-Extraktion ───────────────────────────────────────────────────
  async function extractPdfText(file) {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.js', import.meta.url
    ).toString();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Items nach y-Position gruppieren (gleiche Zeile), dann nach x sortieren
      const items = content.items.map(it => ({ x: it.transform[4], y: it.transform[5], text: it.str }));
      const lines = [];
      for (const item of items) {
        const y = Math.round(item.y);
        let line = lines.find(l => Math.abs(l.y - y) < 3);
        if (!line) { line = { y, parts: [] }; lines.push(line); }
        line.parts.push(item);
      }
      lines.sort((a, b) => b.y - a.y);
      for (const line of lines) {
        line.parts.sort((a, b) => a.x - b.x);
        fullText += line.parts.map(p => p.text).join(" ") + "\n";
      }
    }
    return fullText;
  }

  // ── PDF Zeilen parsen → Konten-Rows ──────────────────────────────────────
  function parsePdfText(text) {
    const parseNum = (s) => {
      const cleaned = s.replace(/'/g, "").replace(/\s/g, "").replace(",", ".");
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    };
    // Pattern: 4-stellige Kontonummer, dann Bezeichnung, dann Betrag(e)
    // Beispiel: "1000 Kasse 1'234.56" oder "1000 Kasse 1'234.56 987.65"
    const re = /^\s*(\d{3,4})\s{1,4}([A-Za-zÀ-öø-ÿ][^\d\-]{2,50?}?)\s+([-]?[\d']+[\d](?:[.,]\d{1,2})?)\s*(?:([-]?[\d']+[\d](?:[.,]\d{1,2})?))?/;
    const rows = [];
    for (const line of text.split("\n")) {
      const m = line.match(re);
      if (!m) continue;
      const nr = m[1];
      if (parseInt(nr) < 100) continue; // Überschriften-Nummern überspringen
      rows.push([nr, m[2].trim(), m[3].trim(), m[4]?.trim() || ""]);
    }
    return rows;
  }

  async function parsePdfFiles(files) {
    setPdfLoading(true);
    try {
      let allRows = [];
      const names = [];
      for (const file of files) {
        names.push(file.name);
        const text = await extractPdfText(file);
        const rows = parsePdfText(text);
        allRows = [...allRows, ...rows];
      }
      // Duplikate (gleiche Kontonummer) deduplizieren — erstes Vorkommen gewinnt
      const seen = new Set();
      allRows = allRows.filter(r => { if (seen.has(r[0])) return false; seen.add(r[0]); return true; });
      if (allRows.length === 0) { toast.error("Keine Konten im PDF gefunden — Format wird nicht erkannt"); setPdfLoading(false); return; }
      // In Standard-Format bringen: [Kontonr, Bezeichnung, Saldo IST, Saldo VJ]
      const hdrs = ["Kontonummer", "Bezeichnung", "Saldo IST", "Saldo VJ"];
      setHeaders(hdrs);
      setColMap({ kontonummer: "Kontonummer", kontoname: "Bezeichnung", saldo_ist: "Saldo IST", saldo_vorjahr: "Saldo VJ" });
      setParsed({ rows: allRows, filename: names.join(" + ") });
      setPreview(allRows.slice(0, 5));
    } catch (err) {
      toast.error("PDF konnte nicht gelesen werden: " + err.message);
    }
    setPdfLoading(false);
  }

  // ── Excel-Datei laden → Sheet-Picker wenn mehrere Blätter ───────────────
  async function loadExcel(file) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const XLSX = await import('xlsx');
      const wb = XLSX.read(data, { type: "array" });
      // Nur Blätter mit tatsächlichem Inhalt berücksichtigen (leere Blätter
      // sind ein häufiger Grund für "es passiert nichts").
      const nonEmpty = wb.SheetNames.filter(n => {
        const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" });
        return r.length >= 2 && r.some(row => Array.isArray(row) && row.some(c => String(c).trim()));
      });
      if (nonEmpty.length === 0) {
        toast.error("Excel-Datei enthält keine lesbaren Daten (leere Blätter oder unerwartetes Format).");
        return;
      }
      if (nonEmpty.length === 1) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[nonEmpty[0]], { header: 1, defval: "" });
        processRows(rows, file.name);
      } else {
        // Mehrere Blätter mit Inhalt → Sheet-Picker zeigen
        setSheetPicker({ wb, filename: file.name, sheetNames: nonEmpty });
        setSelectedSheets(nonEmpty); // alle vorselektiert
      }
    } catch (e) {
      console.error("[Excel-Import]", e);
      toast.error("Excel konnte nicht gelesen werden: " + (e?.message || String(e)));
    }
  }

  // ── Gewählte Sheets zusammenführen und parsen ─────────────────────────────
  async function importSelectedSheets() {
    if (!sheetPicker || selectedSheets.length === 0) return;
    const XLSX = await import('xlsx');
    const { wb, filename } = sheetPicker;
    let allRows = [];
    let hdrs = null;
    for (const name of selectedSheets) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
      if (rows.length < 2) continue;
      const hIdx = findHeaderRowIdx(rows);
      if (!hdrs) hdrs = rows[hIdx].map(String); // Spaltenköpfe vom ersten Blatt
      allRows = [...allRows, ...rows.slice(hIdx + 1).filter(r => r.some(c => String(c).trim()))];
    }
    if (!hdrs || allRows.length === 0) { toast.error("Keine Daten in gewählten Blättern"); return; }
    // Duplikate (gleiche Kontonummer) deduplizieren
    const seen = new Set();
    const col0 = hdrs.findIndex(h => /konto|nummer|nr/i.test(h));
    allRows = allRows.filter(r => {
      const nr = String(r[col0 >= 0 ? col0 : 0] ?? "").trim();
      if (!nr || seen.has(nr)) return false;
      seen.add(nr); return true;
    });
    setSheetPicker(null);
    processRows([hdrs, ...allRows], filename + " (" + selectedSheets.join(", ") + ")");
  }

  function parseFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      loadExcel(file);
    } else {
      // CSV – Zeichensatz automatisch erkennen (UTF-8 / Windows-1252), quote-sicher parsen
      readTextSmart(file).then(text => {
        processRows(parseCsvText(text), file.name);
      }).catch(e => {
        console.error("[CSV-Import]", e);
        toast.error("Datei konnte nicht gelesen werden: " + (e?.message || String(e)));
      });
    }
  }

  // ── Text robust lesen: Zeichensatz automatisch erkennen ───────────────────
  // CH-Buchhaltungs-Exporte (Abacus/Topal) sind oft Windows-1252/Latin-1, nicht
  // UTF-8 → sonst zerschossene ä/ö/ü. UTF-8-BOM beachten; gültiges UTF-8 nehmen,
  // sonst auf Windows-1252 zurückfallen.
  async function readTextSmart(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder("utf-8").decode(bytes.subarray(3));
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }

  // ── Rohzeilen einer Datei lesen (Excel: alle Blätter, CSV: geparst) ───────
  async function readFileRows(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const data = new Uint8Array(await file.arrayBuffer());
      const XLSX = await import('xlsx');
      const wb = XLSX.read(data, { type: "array" });
      let header = null;
      let dataRows = [];
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
        if (rows.length < 2) continue;
        const hIdx = findHeaderRowIdx(rows);
        if (!header) header = rows[hIdx].map(String);
        dataRows = [...dataRows, ...rows.slice(hIdx + 1).filter(r => r.some(c => String(c).trim()))];
      }
      return header ? [header, ...dataRows] : [];
    }
    // CSV – quote-sicher parsen, Kopfzeile suchen, ab dort zurückgeben
    const text = await readTextSmart(file);
    const rows = parseCsvText(text);
    const hIdx = findHeaderRowIdx(rows);
    return rows.slice(hIdx);
  }

  // ── Mehrere Excel/CSV gleichzeitig (Bilanz + ER) zusammenführen ───────────
  async function parseMultipleFiles(files) {
    let header = null;
    let allData = [];
    const names = [];
    try {
      for (const f of files) {
        const rows = await readFileRows(f);
        if (rows.length < 2) continue;
        names.push(f.name);
        if (!header) header = rows[0].map(String);
        allData = [...allData, ...rows.slice(1)];
      }
    } catch (e) {
      console.error("[Import mehrere Dateien]", e);
      toast.error("Datei konnte nicht gelesen werden: " + (e?.message || String(e)));
      return;
    }
    if (!header || allData.length === 0) { toast.error("Keine Daten in den Dateien gefunden"); return; }
    // Duplikate (gleiche Kontonummer) deduplizieren – erstes Vorkommen gewinnt
    const col0 = header.findIndex(h => /konto|nummer|nr/i.test(h));
    const seen = new Set();
    allData = allData.filter(r => {
      const nr = String(r[col0 >= 0 ? col0 : 0] ?? "").trim();
      if (!nr || seen.has(nr)) return false;
      seen.add(nr); return true;
    });
    processRows([header, ...allData], names.join(" + "));
  }

  // ── Zweite Datei mergen (für Bilanz+ER in separaten Files) ───────────────
  function handleSecondFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".pdf")) { parsePdfFiles([file]); return; }
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const data = new Uint8Array(ev.target.result);
        const XLSX = await import('xlsx');
        const wb = XLSX.read(data, { type: "array" });
        // Alle Sheets mergen mit bestehenden Daten (Kopfzeile je Blatt suchen)
        let extra = [];
        for (const name of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
          if (rows.length < 2) continue;
          const hIdx = findHeaderRowIdx(rows);
          extra = [...extra, ...rows.slice(hIdx + 1).filter(r => r.some(c => String(c).trim()))];
        }
        mergeExtraRows(extra, file.name);
      };
      reader.readAsArrayBuffer(file);
    } else {
      readTextSmart(file).then(text => {
        const rows = parseCsvText(text);
        const hIdx = findHeaderRowIdx(rows);
        mergeExtraRows(rows.slice(hIdx + 1), file.name);
      });
    }
  }

  function mergeExtraRows(extraRows, filename2) {
    if (!parsed) return;
    const colIdx = headers.indexOf(colMap.kontonummer);
    const existingNrs = new Set(parsed.rows.map(r => String(r[colIdx] ?? "").trim()));
    const newRows = extraRows.filter(r => {
      const nr = String(r[colIdx >= 0 ? colIdx : 0] ?? "").trim();
      return nr && !existingNrs.has(nr);
    });
    const merged = [...parsed.rows, ...newRows];
    setParsed(p => ({ ...p, rows: merged, filename: p.filename + " + " + filename2 }));
    setPreview(merged.slice(0, 5));
    toast.success(`${newRows.length} Konten aus zweiter Datei hinzugefügt`);
  }

  function processRows(rows, filename) {
    if (rows.length < 2) { toast.error("Datei enthält zu wenig Zeilen"); return; }
    // Kopfzeile suchen (Exporte haben oft Titel-/Leerzeilen davor)
    const hIdx = findHeaderRowIdx(rows);
    let hdrs = rows[hIdx].map(h => String(h).trim());
    let dataRows = rows.slice(hIdx + 1).filter(r => r.some(c => String(c).trim()));

    // Soll/Haben getrennt (typisch Fibu-Export) und kein Saldo? → Saldo-Spalte synthetisieren
    const lc = hdrs.map(h => h.toLowerCase());
    const sollIdx  = lc.findIndex(h => /\bsoll\b/.test(h));
    const habenIdx = lc.findIndex(h => /\bhaben\b/.test(h));
    const hasSaldo = lc.some(h => h.includes("saldo") || h.includes("betrag"));
    if (!hasSaldo && sollIdx >= 0 && habenIdx >= 0) {
      hdrs = [...hdrs, "Saldo (Soll−Haben)"];
      dataRows = dataRows.map(r => {
        const s = parseNumSmart(r[sollIdx]) ?? 0;
        const h = parseNumSmart(r[habenIdx]) ?? 0;
        return [...r, s - h];
      });
    }

    const detected = {
      kontonummer:   detectColumn(hdrs, ["kontonummer", "konto-nr", "kontonr", "konto nr", "kto", "nummer", "nr.", "konto"], ["name", "bezeich", "text"]),
      kontoname:     detectColumn(hdrs, ["kontobezeichnung", "bezeichnung", "kontoname", "name", "text", "beschreibung"], ["nummer", "nr"]),
      saldo_ist:     detectColumn(hdrs, ["saldo (soll−haben)", "schlusssaldo", "endsaldo", "saldo ist", "saldo chf", "saldo", "betrag", "aktuell"], ["vorjahr", "vj", "vorperiode"]),
      saldo_vorjahr: detectColumn(hdrs, ["saldo vorjahr", "vorjahr", "saldo vj", "vorperiode", "vorjahres"]),
    };
    setHeaders(hdrs);
    setColMap(detected);
    setParsed({ rows: dataRows, filename });
    setPreview(dataRows.slice(0, 5));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
    const others = files.filter(f => !f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length > 0) { parsePdfFiles(pdfs.slice(0, 2)); return; }
    if (others.length > 1) { parseMultipleFiles(others); return; }
    if (others[0]) parseFile(others[0]);
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
    const others = files.filter(f => !f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length > 0) { parsePdfFiles(pdfs.slice(0, 2)); return; }
    if (others.length > 1) { parseMultipleFiles(others); return; }
    if (others[0]) parseFile(others[0]);
  }

  function handlePdfChange(e) {
    const files = Array.from(e.target.files).slice(0, 2);
    if (files.length > 0) parsePdfFiles(files);
  }

  function doImport() {
    if (!parsed) return;
    const { rows } = parsed;
    const colIdx = (col) => headers.indexOf(col);
    const getCell = (row, col) => {
      const idx = colIdx(col);
      return idx >= 0 ? String(row[idx] ?? "").trim() : "";
    };
    const konten = rows
      // Nur echte Konto-Zeilen: Kontonummer muss Ziffern enthalten
      // (filtert "Total Aktiven"-/Gruppen-/Leerzeilen aus Exporten)
      .filter(row => {
        const nr = getCell(row, colMap.kontonummer);
        return nr && /\d/.test(nr);
      })
      .map(row => {
        const nr = getCell(row, colMap.kontonummer);
        return {
          kontonummer: nr,
          kontoname: colMap.kontoname ? getCell(row, colMap.kontoname) : "",
          saldo_ist: colMap.saldo_ist ? (parseNumSmart(getCell(row, colMap.saldo_ist)) ?? 0) : 0,
          saldo_vorjahr: colMap.saldo_vorjahr ? parseNumSmart(getCell(row, colMap.saldo_vorjahr)) : null,
          position_id: autoMapKonto(nr),   // DB-Spalte: auto-gemappte Position
          position_override: false,          // DB-Spalte: BOOLEAN, manuell überschrieben?
          notiz: "",
        };
      });

    if (konten.length === 0) { toast.error("Keine Konten gefunden – Spalten-Zuordnung prüfen"); return; }
    onImport(konten, { sign_flip_passiven: flipPassiven, sign_flip_er: flipER });
  }

  const iStyle = {
    width: "100%", fontSize: 12, padding: "5px 8px", borderRadius: 6,
    border: `1px solid ${panelBdr}`, outline: "none", backgroundColor: pageBg, color: headingC,
  };

  return (<>{createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        backgroundColor: panelBg, border: `1px solid ${panelBdr}`,
        width: 680, maxHeight: "90vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4" style={{ color: accent }} />
            <span className="text-sm font-bold" style={{ color: headingC }}>Kontenplan importieren</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X className="w-4 h-4" style={{ color: subC }} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Drop Zone */}
          {!parsed && (
            <div>
              {pdfLoading && (
                <div style={{ textAlign: "center", padding: 32, color: subC, fontSize: 13 }}>
                  ⏳ PDF wird gelesen…
                </div>
              )}
              {!pdfLoading && !sheetPicker && (
                <>
                  {/* Haupt-Dropzone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: `2px dashed ${dragging ? accent : panelBdr}`,
                      borderRadius: 12, padding: "36px 24px", textAlign: "center", cursor: "pointer",
                      backgroundColor: dragging ? accent + "0a" : pageBg, transition: "all 0.15s",
                    }}>
                    <FileSpreadsheet className="w-10 h-10 mx-auto mb-3" style={{ color: dragging ? accent : subC }} />
                    <div className="text-sm font-semibold mb-1" style={{ color: headingC }}>Datei(en) hier ablegen</div>
                    <div className="text-xs" style={{ color: subC }}>CSV, Excel oder PDF · eine oder zwei (Bilanz + ER) zusammen wählbar</div>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf" multiple className="hidden" onChange={handleFileChange} />
                  </div>
                  <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, border: `1px solid ${panelBdr}`, backgroundColor: pageBg, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: subC, flex: 1 }}>
                      📄 Zwei Dateien (Bilanz + ER)? Beide (Excel/CSV/PDF) oben gleichzeitig wählen bzw. ablegen — oder nacheinander.
                    </span>
                    <button onClick={() => pdfRef.current?.click()}
                      style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 6, cursor: "pointer", border: `1px solid ${accent}60`, color: accent, backgroundColor: accent + "10" }}>
                      2× PDF
                    </button>
                    <input ref={pdfRef} type="file" accept=".pdf" multiple className="hidden" onChange={handlePdfChange} />
                  </div>
                  {customerId && (
                    <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, border: `1px solid ${panelBdr}`, backgroundColor: pageBg, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, color: subC, flex: 1 }}>
                        📁 Bilanz/ER liegt schon im E-Binder dieses Mandanten?
                      </span>
                      <button onClick={() => setShowEBinderPicker(true)}
                        style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 6, cursor: "pointer", border: `1px solid ${accent}60`, color: accent, backgroundColor: accent + "10" }}>
                        Aus E-Binder wählen
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Sheet-Picker: mehrere Excel-Blätter */}
              {sheetPicker && (
                <div style={{ border: `1px solid ${panelBdr}`, borderRadius: 12, padding: 20, backgroundColor: pageBg }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: headingC, marginBottom: 4 }}>
                    📋 Mehrere Tabellenblätter gefunden
                  </div>
                  <div style={{ fontSize: 12, color: subC, marginBottom: 14 }}>
                    {sheetPicker.filename} · Wähle die Blätter die importiert werden sollen:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                    {sheetPicker.sheetNames.map(name => (
                      <label key={name} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: headingC }}>
                        <input type="checkbox" checked={selectedSheets.includes(name)}
                          onChange={e => setSelectedSheets(prev =>
                            e.target.checked ? [...prev, name] : prev.filter(s => s !== name)
                          )}
                          style={{ width: 16, height: 16, accentColor: accent }} />
                        <span style={{ fontWeight: selectedSheets.includes(name) ? 600 : 400 }}>{name}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={importSelectedSheets} disabled={selectedSheets.length === 0}
                      style={{ flex: 1, padding: "8px 0", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", backgroundColor: accent, color: "#fff", border: "none", opacity: selectedSheets.length === 0 ? 0.5 : 1 }}>
                      {selectedSheets.length} Blatt{selectedSheets.length !== 1 ? "·er" : ""} importieren
                    </button>
                    <button onClick={() => setSheetPicker(null)}
                      style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer", border: `1px solid ${panelBdr}`, backgroundColor: "transparent", color: subC }}>
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {parsed && (
            <>
              {/* Dateiname + Zweite Datei */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: accent + "10", border: `1px solid ${accent}30` }}>
                <FileText className="w-4 h-4" style={{ color: accent }} />
                <span className="text-sm font-medium" style={{ color: headingC }}>{parsed.filename}</span>
                <span className="text-xs ml-auto" style={{ color: subC }}>{parsed.rows.length} Konten</span>
                <button onClick={() => file2Ref.current?.click()}
                  title="Zweite Datei hinzufügen (Bilanz + ER)"
                  style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, cursor: "pointer", border: `1px solid ${accent}60`, color: accent, backgroundColor: accent + "10", whiteSpace: "nowrap" }}>
                  + Datei
                </button>
                <input ref={file2Ref} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden" onChange={handleSecondFile} />
                <button onClick={() => { setParsed(null); setHeaders([]); setPreview([]); }}
                  className="p-0.5 rounded hover:opacity-70"><RotateCcw className="w-3.5 h-3.5" style={{ color: subC }} /></button>
              </div>

              {/* Spalten-Zuordnung */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: subC }}>Spalten-Zuordnung</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "kontonummer",   label: "Kontonummer *" },
                    { key: "kontoname",     label: "Kontoname" },
                    { key: "saldo_ist",     label: "Saldo IST" },
                    { key: "saldo_vorjahr", label: "Saldo Vorjahr" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-xs font-semibold block mb-1" style={{ color: subC }}>{label}</label>
                      <select value={colMap[key]} onChange={e => setColMap(p => ({ ...p, [key]: e.target.value }))} style={iStyle}>
                        <option value="">— nicht zugeordnet —</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Vorzeichen-Optionen */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: subC }}>Vorzeichen beim Einlesen</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 8, border: `1px solid ${panelBdr}`, backgroundColor: pageBg }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 12.5, color: headingC }}>
                    <input type="checkbox" checked={flipPassiven}
                      onChange={e => setFlipPassiven(e.target.checked)}
                      style={{ width: 15, height: 15, accentColor: accent, flexShrink: 0 }} />
                    <span><strong>Passiven</strong> umkehren <span style={{ color: subC, fontWeight: 400 }}>— wenn Passiven im Export als negative Werte stehen</span></span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 12.5, color: headingC }}>
                    <input type="checkbox" checked={flipER}
                      onChange={e => setFlipER(e.target.checked)}
                      style={{ width: 15, height: 15, accentColor: accent, flexShrink: 0 }} />
                    <span><strong>Erfolgsrechnung</strong> umkehren <span style={{ color: subC, fontWeight: 400 }}>— wenn Erträge im Export negativ sind</span></span>
                  </label>
                  <div style={{ fontSize: 10.5, color: subC, marginTop: 2, fontStyle: "italic" }}>
                    Kann später auch in den Tabs Bilanz / Erfolgsrechnung über den ± Vorzeichen-Button geändert werden.
                  </div>
                </div>
              </div>

              {/* Preview */}
              {preview.length > 0 && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: subC }}>Vorschau (erste 5 Zeilen)</div>
                  <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${panelBdr}` }}>
                    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
                          {headers.slice(0, 6).map(h => (
                            <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: subC, borderBottom: `1px solid ${panelBdr}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${panelBdr}` }}>
                            {row.slice(0, 6).map((cell, j) => (
                              <td key={j} style={{ padding: "5px 10px", color: headingC }}>{String(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: `1px solid ${panelBdr}` }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ color: subC }}>Abbrechen</button>
          <button
            disabled={!parsed || !colMap.kontonummer}
            onClick={doImport}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity"
            style={{ backgroundColor: accent, opacity: parsed && colMap.kontonummer ? 1 : 0.4 }}>
            <Upload className="w-3.5 h-3.5" />
            {parsed ? `${parsed.rows.length} Zeilen importieren` : "Importieren"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )}
  {showEBinderPicker && createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) { setShowEBinderPicker(false); setEBinderPreview(null); } }}>
      <div className="flex" style={{ gap: 12 }}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        backgroundColor: panelBg, border: `1px solid ${panelBdr}`,
        width: 640, maxHeight: "80vh", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
          <span className="text-sm font-bold" style={{ color: headingC }}>📁 Aus E-Binder wählen</span>
          <button onClick={() => { setShowEBinderPicker(false); setEBinderPreview(null); }} className="p-1 rounded hover:opacity-70"><X className="w-4 h-4" style={{ color: subC }} /></button>
        </div>
        {/* Suche */}
        <div className="px-5 py-3" style={{ borderBottom: `1px solid ${panelBdr}` }}>
          <input autoFocus value={eBinderSearch} onChange={e => setEBinderSearch(e.target.value)}
            placeholder="Name oder Dateiname suchen…"
            style={{ width: "100%", fontSize: 13, padding: "7px 12px", borderRadius: 8, border: `1px solid ${panelBdr}`, outline: "none", boxSizing: "border-box", backgroundColor: pageBg, color: headingC }} />
          <div style={{ fontSize: 11, color: subC, marginTop: 5 }}>
            {selectedYear ? `Jahr ${selectedYear}` : "Alle Jahre"} · bis zu 2 Dateien wählbar (Bilanz + ER) · 👁 zeigt die Vorschau daneben
          </div>
        </div>
        {/* Liste */}
        <div className="overflow-y-auto" style={{ flex: 1 }}>
          {eBinderLoading
            ? <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: subC }}>Lädt…</div>
            : (() => {
                const q = eBinderSearch.trim().toLowerCase();
                const filtered = eBinderDocs.filter(d => !q ||
                  d.name?.toLowerCase().includes(q) || d.filename?.toLowerCase().includes(q));
                if (!filtered.length) return <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: subC }}>Keine Dokumente gefunden</div>;
                return filtered.map(doc => {
                  const checked = eBinderSelected.some(d => d.id === doc.id);
                  const previewed = eBinderPreview?.id === doc.id;
                  const ext = (doc.filename || "").split(".").pop()?.toUpperCase() || "DOC";
                  return (
                    <div key={doc.id} onClick={() => toggleEBinderDoc(doc)}
                      style={{ padding: "9px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                        borderBottom: `1px solid ${panelBdr}`, backgroundColor: checked ? accent + "12" : "transparent" }}>
                      <input type="checkbox" checked={checked} readOnly style={{ width: 15, height: 15, accentColor: accent, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                        backgroundColor: ext === "PDF" ? "#fee2e2" : "#dbeafe", color: ext === "PDF" ? "#dc2626" : "#1d4ed8", flexShrink: 0 }}>{ext}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: headingC, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                        <div style={{ fontSize: 11, color: subC, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.filename}</div>
                      </div>
                      {doc.year && <span style={{ fontSize: 11, color: subC, flexShrink: 0 }}>{doc.year}</span>}
                      <button onClick={e => { e.stopPropagation(); setEBinderPreview(previewed ? null : doc); }}
                        title="Vorschau"
                        style={{ background: previewed ? accent + "20" : "none", border: "none", borderRadius: 5, cursor: "pointer",
                          color: previewed ? accent : subC, fontSize: 14, padding: "3px 6px", flexShrink: 0, lineHeight: 1 }}>👁</button>
                    </div>
                  );
                });
              })()
          }
        </div>
        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: `1px solid ${panelBdr}` }}>
          <button onClick={() => { setShowEBinderPicker(false); setEBinderSelected([]); setEBinderPreview(null); }} className="px-4 py-2 rounded-lg text-sm" style={{ color: subC }}>Abbrechen</button>
          <button disabled={!eBinderSelected.length || eBinderImporting} onClick={importFromEBinder}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity"
            style={{ backgroundColor: accent, opacity: eBinderSelected.length && !eBinderImporting ? 1 : 0.4 }}>
            <Upload className="w-3.5 h-3.5" />
            {eBinderImporting ? "Lädt…" : eBinderSelected.length ? `${eBinderSelected.length} Datei${eBinderSelected.length > 1 ? "en" : ""} übernehmen` : "Übernehmen"}
          </button>
        </div>
      </div>
      {eBinderPreview && (() => {
        const ft = eBinderPreview.file_type || "";
        const istPdf = ft.includes("pdf") || (eBinderPreview.filename || "").toLowerCase().endsWith(".pdf");
        const istBild = ft.startsWith("image/");
        return (
          <div onMouseDown={e => e.stopPropagation()} className="rounded-2xl overflow-hidden flex flex-col" style={{
            width: 380, maxHeight: "80vh", backgroundColor: panelBg, border: `1px solid ${panelBdr}`, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: headingC, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={eBinderPreview.name}>{eBinderPreview.name}</span>
              <button onClick={() => setEBinderPreview(null)} className="p-1 rounded hover:opacity-70"><X className="w-3.5 h-3.5" style={{ color: subC }} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 400, backgroundColor: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {eBinderPreviewLoading
                ? <span style={{ fontSize: 12, color: subC }}>Lädt…</span>
                : !eBinderPreviewUrl
                  ? <span style={{ fontSize: 12, color: subC }}>Vorschau nicht verfügbar</span>
                  : istPdf
                    ? <iframe src={eBinderPreviewUrl} title={eBinderPreview.name} style={{ width: "100%", height: "100%", minHeight: 400, border: "none" }} />
                    : istBild
                      ? <img src={eBinderPreviewUrl} alt={eBinderPreview.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                      : <div style={{ textAlign: "center", padding: 16, fontSize: 12, color: subC }}>Keine Vorschau für diesen Dateityp</div>
              }
            </div>
          </div>
        );
      })()}
      </div>
    </div>,
    document.body
  )}</>);
}

// ── Export-Modus Dialog (Mindestgliederung / Detailliert) ────────────────────
function ExportModeDialog({ target, defaultMode, accent, headingC, subC, panelBg, panelBdr, onClose, onExport }) {
  const [mode, setMode] = useState(defaultMode === "detail" ? "detail" : "mindest");
  const [remember, setRemember] = useState(false);
  const isPdf = target === "pdf";
  const title = isPdf ? "PDF Export — Bilanz & Erfolgsrechnung" : "Revisions-Dossier (ZIP) — Bilanz, ER, Belege";

  const optionStyle = (active) => ({
    display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px",
    borderRadius: 10, cursor: "pointer",
    border: `2px solid ${active ? accent : panelBdr}`,
    backgroundColor: active ? accent + "12" : "transparent",
    transition: "all 0.12s",
  });

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ backgroundColor: panelBg, border: `1px solid ${panelBdr}`, borderRadius: 14,
        width: "min(540px, 94vw)", boxShadow: "0 24px 64px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${panelBdr}`,
          display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16 }}>{isPdf ? "📄" : "📦"}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: headingC, flex: 1 }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none",
            cursor: "pointer", fontSize: 20, color: subC, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: subC }}>
            Wie soll die Bilanz und Erfolgsrechnung dargestellt werden?
          </div>

          {/* Mindestgliederung */}
          <label style={optionStyle(mode === "mindest")} onClick={() => setMode("mindest")}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="radio" checked={mode === "mindest"} onChange={() => setMode("mindest")}
                style={{ accentColor: accent }} />
              <span style={{ fontWeight: 700, fontSize: 13.5, color: headingC }}>Mindestgliederung</span>
            </div>
            <div style={{ fontSize: 11.5, color: subC, marginLeft: 24, lineHeight: 1.5 }}>
              Nur Bilanz- und ER-Positionen mit Sub-Totalen. Kompakt, gut für Übersicht & Geschäftsbericht.
            </div>
          </label>

          {/* Detailliert */}
          <label style={optionStyle(mode === "detail")} onClick={() => setMode("detail")}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="radio" checked={mode === "detail"} onChange={() => setMode("detail")}
                style={{ accentColor: accent }} />
              <span style={{ fontWeight: 700, fontSize: 13.5, color: headingC }}>Detailliert</span>
            </div>
            <div style={{ fontSize: 11.5, color: subC, marginLeft: 24, lineHeight: 1.5 }}>
              Wie Jahresauswertung: zusätzlich unter jeder Position die Einzelkonten mit Kontonr., Name und Saldo.
            </div>
          </label>

          {/* Default merken */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4,
            fontSize: 12, color: subC, cursor: "pointer" }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
              style={{ accentColor: accent }} />
            Diese Wahl als Standard für diesen Abschluss merken
          </label>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px",
          borderTop: `1px solid ${panelBdr}` }}>
          <button onClick={onClose}
            style={{ padding: "8px 18px", fontSize: 13, borderRadius: 7, cursor: "pointer",
              border: `1px solid ${panelBdr}`, color: subC, backgroundColor: "transparent" }}>
            Abbrechen
          </button>
          <button onClick={() => onExport(target, mode, remember)}
            style={{ padding: "8px 20px", fontSize: 13, fontWeight: 700, borderRadius: 7,
              cursor: "pointer", border: "none", color: "#fff", backgroundColor: accent }}>
            {isPdf ? "PDF erstellen" : "Dossier erstellen"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── MiniExcel (Arbeitspapier pro Konto) ──────────────────────────────────────
const MINI_DEFAULT_COLS = [
  { id: "dc0", label: "Beschreibung", width: 220 },
  { id: "dc1", label: "Betrag CHF",   width: 130 },
  { id: "dc2", label: "Kommentar",    width: 200 },
];

function MiniExcel({ data, onSave, accent, headingC, subC, panelBdr }) {
  const init = data?.columns?.length ? data : { columns: MINI_DEFAULT_COLS, rows: [{ id: "dr0", cells: {} }] };
  const [cols, setCols] = useState(init.columns);
  const [rows, setRows] = useState(init.rows);
  const [editCell, setEditCell] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [editColId, setEditColId] = useState(null);
  const [editColLabel, setEditColLabel] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const stRef = useRef({ cols, rows });
  useEffect(() => { stRef.current = { cols, rows }; });

  const save = useCallback((c, r) => onSave({ columns: c, rows: r }), [onSave]);

  // ── Column resize ────────────────────────────────────────────────────────
  const startResize = (e, ci) => {
    e.preventDefault();
    const sx = e.clientX;
    const sw = stRef.current.cols[ci].width;
    const move = (me) => setCols(p => p.map((c, i) => i === ci ? { ...c, width: Math.max(60, sw + me.clientX - sx) } : c));
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      save(stRef.current.cols, stRef.current.rows);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  // ── Cell edit ────────────────────────────────────────────────────────────
  const commitCell = (nextCell) => {
    if (!editCell) return;
    const cleanVal = editVal.replace(/[\r\n]+/g, "");   // kein Enter-Zeichen speichern
    const newRows = rows.map(r => r.id === editCell.rowId
      ? { ...r, cells: { ...r.cells, [editCell.colId]: cleanVal } } : r);
    setRows(newRows); save(cols, newRows);
    if (nextCell) { setEditCell(nextCell); setEditVal(newRows.find(r => r.id === nextCell.rowId)?.cells?.[nextCell.colId] || ""); }
    else setEditCell(null);
  };

  // ── Tab-Navigation ───────────────────────────────────────────────────────
  const tabToNext = (e, shift) => {
    e.preventDefault();
    if (!editCell) return;
    const colIdx = cols.findIndex(c => c.id === editCell.colId);
    const rowIdx = rows.findIndex(r => r.id === editCell.rowId);
    let nextColIdx = shift ? colIdx - 1 : colIdx + 1;
    let nextRowIdx = rowIdx;
    if (nextColIdx >= cols.length) { nextColIdx = 0; nextRowIdx = rowIdx + 1; }
    if (nextColIdx < 0) { nextColIdx = cols.length - 1; nextRowIdx = rowIdx - 1; }
    if (nextRowIdx < 0 || nextRowIdx >= rows.length) return commitCell(null);
    commitCell({ rowId: rows[nextRowIdx].id, colId: cols[nextColIdx].id });
  };

  // ── Column label edit ────────────────────────────────────────────────────
  const commitCol = () => {
    if (!editColId) return;
    const newCols = cols.map(c => c.id === editColId ? { ...c, label: editColLabel } : c);
    setCols(newCols); setEditColId(null); save(newCols, rows);
  };

  // ── Add / Delete ─────────────────────────────────────────────────────────
  const addCol = () => {
    const nc = { id: `c${Date.now()}`, label: "Spalte", width: 150 };
    const nc2 = [...cols, nc]; setCols(nc2); save(nc2, rows);
  };
  const delCol = (id) => {
    const nc = cols.filter(c => c.id !== id);
    const nr = rows.map(r => { const cells = { ...r.cells }; delete cells[id]; return { ...r, cells }; });
    setCols(nc); setRows(nr); save(nc, nr);
  };
  const addRow = () => {
    const nr = [...rows, { id: `r${Date.now()}`, cells: {} }];
    setRows(nr); save(cols, nr);
  };
  const delRow = (id) => {
    const nr = rows.filter(r => r.id !== id); setRows(nr); save(cols, nr);
  };

  // ── Row drag-and-drop ────────────────────────────────────────────────────
  const onDrop = (e, ti) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === ti) { setDragIdx(null); setDragOverIdx(null); return; }
    const nr = [...rows];
    const [m] = nr.splice(dragIdx, 1);
    nr.splice(ti, 0, m);
    setRows(nr); setDragIdx(null); setDragOverIdx(null); save(cols, nr);
  };

  const bdr = panelBdr;
  return (
    <div style={{ padding: "0 8px 10px 32px", backgroundColor: accent + "05", borderTop: `1px solid ${bdr}` }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: accent + "14" }}>
              {/* drag-handle column */}
              <th style={{ width: 22, borderRight: `1px solid ${bdr}`, borderBottom: `1px solid ${bdr}` }} />
              {cols.map((col, ci) => (
                <th key={col.id} style={{
                  position: "relative", width: col.width, minWidth: col.width, maxWidth: col.width,
                  padding: "5px 24px 5px 8px", textAlign: "left", fontWeight: 700, color: headingC,
                  borderRight: `1px solid ${bdr}`, borderBottom: `1px solid ${bdr}`, whiteSpace: "nowrap",
                }}>
                  {editColId === col.id
                    ? <input autoFocus value={editColLabel}
                        onChange={e => setEditColLabel(e.target.value)}
                        onBlur={commitCol}
                        onKeyDown={e => { if (e.key === "Enter") commitCol(); if (e.key === "Escape") setEditColId(null); }}
                        style={{ width: "100%", fontSize: 11, fontWeight: 700, padding: "1px 4px", borderRadius: 3, border: `1px solid ${accent}`, outline: "none", color: headingC, backgroundColor: "white" }} />
                    : <span onDoubleClick={() => { setEditColId(col.id); setEditColLabel(col.label); }}
                        title="Doppelklick zum Umbenennen" style={{ cursor: "text" }}>{col.label}</span>
                  }
                  {/* Delete col button */}
                  {cols.length > 1 &&
                    <button onClick={() => delCol(col.id)} title="Spalte löschen"
                      style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 13, lineHeight: 1, opacity: 0.45, padding: 1 }}>×</button>
                  }
                  {/* Resize handle */}
                  <div onMouseDown={e => startResize(e, ci)} style={{
                    position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 2,
                  }} />
                </th>
              ))}
              {/* Add col */}
              <th style={{ width: 30, padding: "4px 6px", textAlign: "center", borderBottom: `1px solid ${bdr}` }}>
                <button onClick={addCol} title="Spalte hinzufügen"
                  style={{ background: "none", border: `1px solid ${accent}60`, borderRadius: 3, cursor: "pointer", color: accent, fontSize: 13, padding: "0 5px", fontWeight: 700, lineHeight: "18px" }}>+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.id} draggable
                onDragStart={e => { setDragIdx(ri); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={e => { e.preventDefault(); setDragOverIdx(ri); }}
                onDrop={e => onDrop(e, ri)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                style={{ borderTop: `1px solid ${bdr}`, backgroundColor: dragOverIdx === ri ? accent + "18" : "transparent" }}>
                {/* Drag handle */}
                <td style={{ padding: "2px 4px", cursor: "grab", color: subC, textAlign: "center", borderRight: `1px solid ${bdr}`, userSelect: "none", fontSize: 13 }} title="Zeile verschieben">⠿</td>
                {cols.map(col => {
                  const isEd = editCell?.rowId === row.id && editCell?.colId === col.id;
                  const val = row.cells[col.id] || "";
                  // Formel-Auswertung: startet mit = → evalExpr → fmtCHF
                  const displayVal = (() => {
                    if (!val) return "—";
                    const raw = val.startsWith("=") ? val.slice(1) : val;
                    const num = evalExpr(raw);
                    return num !== null ? fmtCHF(num) : val;
                  })();
                  const isFormula = val.startsWith("=") && displayVal !== val;
                  return (
                    <td key={col.id} style={{ padding: "1px 4px", borderRight: `1px solid ${bdr}`, width: col.width, maxWidth: col.width }}
                      onClick={() => !isEd && (setEditCell({ rowId: row.id, colId: col.id }), setEditVal(val))}>
                      {isEd
                        ? <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value.replace(/[\r\n]/g, ""))}
                            onBlur={() => commitCell(null)}
                            onKeyDown={e => {
                              if (e.key === "Tab") { tabToNext(e, e.shiftKey); }
                              else if (e.key === "Enter") commitCell(null);
                              else if (e.key === "Escape") setEditCell(null);
                            }}
                            style={{ width: "100%", fontSize: 12, padding: "3px 5px", border: `1px solid ${accent}`, borderRadius: 3, outline: "none", color: "#111" }} />
                        : <span style={{ display: "block", padding: "3px 5px", minHeight: 22,
                            color: val ? headingC : subC + "60", cursor: "text",
                            fontFamily: isFormula ? "monospace" : "inherit",
                            textAlign: isFormula ? "right" : "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                            title={isFormula ? val : undefined}>
                            {displayVal}
                          </span>}
                    </td>);
                })}
                {/* Delete row */}
                <td style={{ padding: "2px 4px", textAlign: "center" }}>
                  <button onClick={() => delRow(row.id)} title="Zeile löschen"
                    style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 14, opacity: 0.45 }}>×</button>
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${bdr}` }}>
              <td colSpan={cols.length + 2} style={{ padding: "4px 10px" }}>
                <button onClick={addRow}
                  style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 12, fontWeight: 600, padding: 0 }}>+ Zeile</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Belege-Verknüpfung pro Konto ─────────────────────────────────────────────
const BUCKET = "dokumente";

function BelegeSection({ arbeitspapier, onSave, customerId, selectedYear, accent, headingC, subC, panelBdr,
  kontonummer, kontoname, positionId }) {
  // Konto-Kontext für Upload-Vorbelegung (Notiz, Auto-Tag-Hinweis)
  const positionLabel = positionId ? (POSITION_MAP[positionId]?.label || "") : "";
  const uploadNotes = kontonummer
    ? `Beleg zu Konto ${kontonummer}${kontoname ? " – " + kontoname : ""} (Geschäftsjahr ${selectedYear || "—"})`
    : "";
  const uploadDetectText = [kontonummer, kontoname, positionLabel].filter(Boolean).join(" ");
  // selectedYear wird von KontenplanTab übergeben (= aktuelles Geschäftsjahr)
  const belege = arbeitspapier?.belege || [];
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  // Volltextsuche (RPC search_dokumente) – aktiv ab >=2 Zeichen
  const [ftResults, setFtResults] = useState(null);
  const [ftSearching, setFtSearching] = useState(false);
  // Upload-Dialog: wenn Beleg noch nicht in der Ablage. uploadFile = die zu uploadende Datei.
  const [uploadFile, setUploadFile] = useState(null);
  const fileInputRef = useRef(null);
  // Vorschau rechts neben den Beleg-Chips — welcher Beleg, welche signierte URL.
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Docs zurücksetzen wenn Kunde oder Jahr wechselt → erzwingt Neuladen
  useEffect(() => { setDocs([]); setFtResults(null); setPreview(null); }, [customerId, selectedYear]);

  // Signierte URL für die Vorschau laden, sobald ein Beleg ausgewählt ist.
  useEffect(() => {
    if (!preview) { setPreviewUrl(null); return; }
    const path = (preview.storage_path || "").replace(/^dokumente\//, "");
    if (!path) { setPreviewUrl(null); return; }
    let aktiv = true;
    setPreviewLoading(true);
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!aktiv) return;
      setPreviewLoading(false);
      if (data?.signedUrl) setPreviewUrl(data.signedUrl);
      else { setPreviewUrl(null); toast.error("Vorschau nicht verfügbar" + (error ? ": " + error.message : "")); }
    });
    return () => { aktiv = false; };
  }, [preview]);

  // Dokumente laden wenn Picker öffnet — nur das gewählte Geschäftsjahr
  useEffect(() => {
    if (!showPicker || !customerId || docs.length > 0) return;
    setLoading(true);
    let q = supabase.from("dokumente")
      .select("id, name, filename, storage_path, category, year, file_type, tag_ids")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (selectedYear) q = q.eq("year", selectedYear);
    q.then(({ data }) => { setDocs(data || []); setLoading(false); });
  }, [showPicker, customerId, selectedYear]);

  // Volltextsuche debouncen – greift ab 2 Zeichen, sucht im ganzen Kunden
  useEffect(() => {
    if (!showPicker) return;
    const q = search.trim();
    if (q.length < 2) { setFtResults(null); return; }
    const timer = setTimeout(async () => {
      setFtSearching(true);
      try {
        const { data, error } = await supabase.rpc("search_dokumente", {
          p_query: q,
          p_customer_id: customerId || null,
          p_limit: 100,
        });
        if (error) throw error;
        setFtResults(data || []);
      } catch (e) {
        console.warn("Volltextsuche fehlgeschlagen", e);
        setFtResults([]);
      } finally {
        setFtSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, showPicker, customerId]);

  const linkedIds = new Set(belege.map(b => b.id));

  const addBeleg = (doc) => {
    if (linkedIds.has(doc.id)) return;
    const newBelege = [...belege, {
      id: doc.id, name: doc.name, filename: doc.filename,
      storage_path: doc.storage_path, year: doc.year,
      category: doc.category, file_type: doc.file_type,
    }];
    onSave({ ...(arbeitspapier || {}), belege: newBelege });
    setShowPicker(false); setSearch(""); setFtResults(null);
  };

  // Neu hochgeladen → sofort als Beleg verknüpfen, Caches leeren
  const handleUploaded = (newDoc) => {
    if (!newDoc?.id) return;
    addBeleg(newDoc);
    setDocs([]); // Liste neu laden beim nächsten Picker-Open
  };

  // Upload-Button geklickt → File-Picker öffnen
  const startUpload = () => {
    fileInputRef.current?.click();
  };
  const onFileChosen = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadFile(f);
    // Input zurücksetzen, damit dieselbe Datei nochmal gewählt werden kann
    e.target.value = "";
  };

  const removeBeleg = (id) => {
    onSave({ ...(arbeitspapier || {}), belege: belege.filter(b => b.id !== id) });
  };

  const openDoc = async (beleg) => {
    const path = (beleg.storage_path || "").replace(/^dokumente\//, "");
    if (!path) { toast.error("Beleg hat keinen Speicherpfad"); return; }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Dokument konnte nicht geöffnet werden" + (error ? ": " + error.message : ""));
  };

  // Anzeige-Liste: bei aktiver Volltextsuche → FTS-Ergebnisse (alle Jahre, ganze DB des Kunden);
  // sonst lokale Doc-Liste mit client-seitigem Filter über name+filename.
  const useFts = search.trim().length >= 2 && ftResults !== null;
  const filtered = useFts
    ? ftResults
    : docs.filter(d => !search ||
        d.name?.toLowerCase().includes(search.toLowerCase()) ||
        d.filename?.toLowerCase().includes(search.toLowerCase())
      );

  const fileLabel = (ft, fn) => {
    if (ft?.includes("pdf")) return { label: "PDF", bg: "#fee2e2", col: "#dc2626" };
    const ext = fn?.split(".").pop()?.toUpperCase() || "DOC";
    return { label: ext, bg: "#dbeafe", col: "#1d4ed8" };
  };

  const pickerModal = showPicker && createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={e => { if (e.target === e.currentTarget) setShowPicker(false); }}>
      <div style={{ backgroundColor: "white", borderRadius: 14, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", width: "min(820px, 94vw)", maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${panelBdr}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#111", flex: 1 }}>📎 Beleg verknüpfen</span>
          <button onClick={startUpload}
            title="Neue Datei in die Ablage hochladen (mit Tags + Volltext-Index) und direkt als Beleg verknüpfen"
            style={{ fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 6, cursor: "pointer",
              border: `1px solid ${accent}`, color: "#fff", backgroundColor: accent, display: "flex", alignItems: "center", gap: 5 }}>
            <Upload size={12} /> Neu hochladen
          </button>
          <span style={{ fontSize: 12, color: subC }}>
            {useFts
              ? `Volltext · ${ftSearching ? "…" : filtered.length} Treffer`
              : `${selectedYear ? `Jahr ${selectedYear}` : "Alle Jahre"} · ${filtered.length} Dokumente`}
          </span>
          <button onClick={() => setShowPicker(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: subC, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>
        {/* Suche */}
        <div style={{ padding: "10px 18px", borderBottom: `1px solid ${panelBdr}` }}>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Name, Dateiname oder Volltext suchen (ab 2 Zeichen)…"
            style={{ width: "100%", fontSize: 13, padding: "7px 12px", borderRadius: 8, border: `1px solid ${panelBdr}`, outline: "none", boxSizing: "border-box" }} />
          <div style={{ fontSize: 10.5, color: subC, marginTop: 5, fontStyle: "italic" }}>
            {useFts
              ? "🔍 Volltextsuche aktiv — durchsucht Inhalt aller Dokumente dieses Kunden (alle Jahre)."
              : `Lokale Suche auf den letzten 500 Dokumenten${selectedYear ? ` aus ${selectedYear}` : ""}. Tippe 2+ Zeichen für Volltextsuche im gesamten Bestand.`}
          </div>
        </div>
        {/* Liste */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {(loading || (useFts && ftSearching))
            ? <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: subC }}>{useFts ? "Volltextsuche läuft…" : "Lädt…"}</div>
            : filtered.length === 0
              ? <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: subC }}>
                  Keine Dokumente gefunden
                  {search.trim() && <div style={{ marginTop: 8, fontSize: 12 }}>
                    Tipp: Datei ist noch nicht in der Ablage? <button onClick={startUpload}
                      style={{ background: "none", border: "none", color: accent, fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: 12 }}>Jetzt hochladen →</button>
                  </div>}
                </div>
              : filtered.map(doc => {
                  const fl = fileLabel(doc.file_type, doc.filename);
                  const already = linkedIds.has(doc.id);
                  return (
                    <div key={doc.id} onClick={() => { if (!already) addBeleg(doc); }}
                      style={{ padding: "10px 18px", cursor: already ? "default" : "pointer", opacity: already ? 0.5 : 1, borderBottom: `1px solid ${panelBdr}`, display: "flex", alignItems: "center", gap: 12, transition: "background 0.1s" }}
                      onMouseEnter={e => { if (!already) e.currentTarget.style.backgroundColor = accent + "10"; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, backgroundColor: fl.bg, color: fl.col, flexShrink: 0, minWidth: 36, textAlign: "center" }}>{fl.label}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "#111", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                        <div style={{ fontSize: 11, color: subC, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {doc.filename}
                        </div>
                        {useFts && doc.headline && (
                          <div style={{ fontSize: 10.5, color: subC, marginTop: 3, fontStyle: "italic", lineHeight: 1.4 }}
                            dangerouslySetInnerHTML={{ __html: "…" + doc.headline + "…" }} />
                        )}
                      </div>
                      <div style={{ flexShrink: 0, textAlign: "right" }}>
                        {doc.year && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, backgroundColor: accent + "15", color: accent }}>{doc.year}</span>}
                        {doc.category && <div style={{ fontSize: 10, color: subC, marginTop: 3 }}>{doc.category}</div>}
                      </div>
                      {already
                        ? <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700, flexShrink: 0 }}>✓</span>
                        : <span style={{ fontSize: 12, color: accent, fontWeight: 700, flexShrink: 0 }}>+</span>}
                    </div>
                  );
                })
          }
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <div style={{ padding: "8px 8px 10px 32px", borderTop: `1px dashed ${panelBdr}` }}>
      {pickerModal}
      <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFileChosen} />
      {uploadFile && (
        <DokUploadDialog
          preFile={uploadFile}
          preCustomerId={customerId}
          preYear={selectedYear}
          preNotes={uploadNotes}
          extraDetectText={uploadDetectText}
          onClose={() => setUploadFile(null)}
          onUploaded={handleUploaded}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: subC, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          📎 Belege
        </span>
        <button onClick={() => setShowPicker(true)} style={{
            fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 5, cursor: "pointer",
            backgroundColor: accent + "14", border: `1px solid ${accent}40`, color: accent,
          }}>+ Beleg verknüpfen</button>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {belege.length === 0
          ? <span style={{ fontSize: 11, color: subC, fontStyle: "italic" }}>Noch keine Belege verknüpft</span>
          : <div style={{ display: "flex", flexWrap: "wrap", gap: 5, flex: 1, minWidth: 0 }}>
              {belege.map(b => {
                const fl = fileLabel(b.file_type, b.filename);
                const aktiv = preview?.id === b.id;
                return (
                  <div key={b.id} onClick={() => setPreview(aktiv ? null : b)}
                    title="Klicken für Vorschau" style={{
                    display: "flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 5px", cursor: "pointer",
                    borderRadius: 6, backgroundColor: aktiv ? (accent + "14") : (b.ki ? "#fefce8" : "#f8fafc"),
                    border: `1px solid ${aktiv ? accent : (b.ki ? "#fde68a" : panelBdr)}`, fontSize: 11,
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 4px", borderRadius: 3, backgroundColor: fl.bg, color: fl.col, flexShrink: 0 }}>{fl.label}</span>
                    {b.ki && <span title="KI-vorgeschlagen – bitte prüfen" style={{ fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 3, backgroundColor: "#fef08a", color: "#854d0e", flexShrink: 0 }}>KI</span>}
                    <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: headingC }} title={b.name}>{b.name}</span>
                    {b.year && <span style={{ color: subC, fontSize: 10, flexShrink: 0 }}>{b.year}</span>}
                    <button onClick={e => { e.stopPropagation(); openDoc(b); }} title="In neuem Tab öffnen"
                      style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 13, padding: "0 2px", lineHeight: 1 }}>↗</button>
                    <button onClick={e => { e.stopPropagation(); removeBeleg(b.id); if (aktiv) setPreview(null); }} title="Verknüpfung entfernen"
                      style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 14, padding: "0 1px", opacity: 0.55, lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
            </div>
        }

        {preview && (() => {
          const ft = preview.file_type || "";
          const istPdf = ft.includes("pdf");
          const istBild = ft.startsWith("image/");
          return (
            <div style={{ width: 320, flexShrink: 0, border: `1px solid ${panelBdr}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px 4px 8px", borderBottom: `1px solid ${panelBdr}`, backgroundColor: "#f8fafc" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: headingC, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={preview.name}>{preview.name}</span>
                <button onClick={() => openDoc(preview)} title="In neuem Tab öffnen"
                  style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 13, padding: "0 3px", lineHeight: 1 }}>↗</button>
                <button onClick={() => setPreview(null)} title="Vorschau schliessen"
                  style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 15, padding: "0 2px", opacity: 0.6, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ height: 260, backgroundColor: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {previewLoading
                  ? <span style={{ fontSize: 11, color: subC }}>Lädt…</span>
                  : !previewUrl
                    ? <span style={{ fontSize: 11, color: subC }}>Vorschau nicht verfügbar</span>
                    : istPdf
                      ? <iframe src={previewUrl} title={preview.name} style={{ width: "100%", height: "100%", border: "none" }} />
                      : istBild
                        ? <img src={previewUrl} alt={preview.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                        : <div style={{ textAlign: "center", padding: 12 }}>
                            <div style={{ fontSize: 11, color: subC, marginBottom: 8 }}>Keine Vorschau für diesen Dateityp</div>
                            <button onClick={() => openDoc(preview)} style={{
                              fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
                              backgroundColor: accent + "14", border: `1px solid ${accent}40`, color: accent,
                            }}>Öffnen ↗</button>
                          </div>
                }
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Notiz-Popup mit Formatierung ──────────────────────────────────────────────
function NotizPopup({ value, onChange, accent, headingC, subC, panelBg, panelBdr }) {
  const [open, setOpen] = useState(false);
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });
  const editorRef = useRef(null);
  const triggerRef = useRef(null);

  const plainText = value ? value.replace(/<[^>]*>/g, "").trim() : "";
  const hasContent = plainText.length > 0;

  const openPopup = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const top = rect.bottom + 6;
    const left = Math.min(rect.left, window.innerWidth - 310);
    setPopPos({ top: Math.min(top, window.innerHeight - 290), left });
    setOpen(true);
  };

  useEffect(() => {
    if (open && editorRef.current) {
      editorRef.current.innerHTML = value || "";
      // Cursor ans Ende
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      editorRef.current.focus();
    }
  }, [open]);

  const execCmd = (cmd) => {
    document.execCommand(cmd, false, null);
    editorRef.current?.focus();
  };

  const save = () => {
    const html = editorRef.current?.innerHTML || "";
    // Leerer Editor → leeren String speichern
    onChange(html.replace(/<br\s*\/?>/gi, "").trim() === "" ? "" : html);
    setOpen(false);
  };

  const TOOLS = [
    { label: "B", cmd: "bold",      style: { fontWeight: 700 } },
    { label: "I", cmd: "italic",    style: { fontStyle: "italic" } },
    { label: "U", cmd: "underline", style: { textDecoration: "underline" } },
  ];

  return (
    <>
      {/* Trigger – Klick öffnet Popup */}
      <div ref={triggerRef} onClick={openPopup}
        title={hasContent ? plainText : "Notiz hinzufügen…"}
        style={{ cursor: "pointer", minWidth: 100, maxWidth: 200, padding: "3px 7px", borderRadius: 5,
          border: `1px solid ${hasContent ? accent + "50" : "transparent"}`,
          fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: hasContent ? headingC : subC, fontStyle: hasContent ? "normal" : "italic",
          transition: "border-color 0.15s" }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.borderColor = accent + "40"; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor = hasContent ? accent + "50" : "transparent"; }}>
        {hasContent ? plainText.substring(0, 28) + (plainText.length > 28 ? "…" : "") : "Notiz…"}
      </div>

      {/* Popup Portal */}
      {open && createPortal(
        <>
          {/* Backdrop */}
          <div style={{ position: "fixed", inset: 0, zIndex: 99990 }} onMouseDown={save} />
          {/* Popup */}
          <div onMouseDown={e => e.stopPropagation()}
            style={{ position: "fixed", top: popPos.top, left: popPos.left, width: 300, zIndex: 99999,
              backgroundColor: panelBg, border: `1px solid ${panelBdr}`, borderRadius: 10,
              boxShadow: "0 8px 28px rgba(0,0,0,0.18)", overflow: "hidden" }}>
            {/* Toolbar */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px",
              borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBdr + "25" }}>
              {TOOLS.map(({ label, cmd, style }) => (
                <button key={cmd} onMouseDown={e => { e.preventDefault(); execCmd(cmd); }}
                  style={{ ...style, width: 26, height: 24, fontSize: 12, border: `1px solid ${panelBdr}`,
                    borderRadius: 4, cursor: "pointer", backgroundColor: panelBg, color: headingC }}>
                  {label}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: subC }}>Enter = neue Zeile</span>
            </div>
            {/* Contenteditable Editor */}
            <div ref={editorRef} contentEditable suppressContentEditableWarning
              onKeyDown={e => { if (e.key === "Escape") save(); }}
              style={{ minHeight: 80, maxHeight: 180, overflowY: "auto", padding: "8px 10px",
                fontSize: 13, color: headingC, outline: "none", lineHeight: 1.65 }} />
            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "6px 8px", borderTop: `1px solid ${panelBdr}` }}>
              <button onMouseDown={e => { e.stopPropagation(); onChange(""); setOpen(false); }}
                style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: `1px solid ${panelBdr}`,
                  cursor: "pointer", backgroundColor: "transparent", color: subC }}>
                Löschen
              </button>
              <button onMouseDown={e => { e.stopPropagation(); save(); }}
                style={{ fontSize: 11, fontWeight: 700, padding: "4px 14px", borderRadius: 5,
                  border: `1px solid ${accent}`, cursor: "pointer", backgroundColor: accent, color: "#fff" }}>
                OK
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ── Kontenplan Tab ────────────────────────────────────────────────────────────
function KontenplanTab({ konten, onUpdateKonto, onAddKonto, customerId, selectedYear, accent, theme, headingC, subC, panelBg, panelBdr, tableBdr, rowHover, diffAnpassungen, onSaveDiffAnpassungen }) {
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const [collapsed, setCollapsed] = useState({});
  const [expandedKonten, setExpandedKonten] = useState(new Set());
  // Inline-Edit für Saldo IST / Saldo VJ per Doppelklick
  const [editSaldo, setEditSaldo] = useState(null); // { kontoId, field: "saldo_ist"|"saldo_vorjahr", expr }
  // Neue Konto-Zeile (Inline-Erfassung oben in der Tabelle)
  const [newRow, setNewRow] = useState({ kontonummer: "", kontoname: "", saldo_ist: "", saldo_vorjahr: "", position_id: null });
  const submitNewRow = () => {
    if (!onAddKonto) return;
    const nr = String(newRow.kontonummer || "").trim();
    if (!nr) { toast.error("Konto-Nr. erforderlich"); return; }
    if (konten.some(k => String(k.kontonummer) === nr)) { toast.error("Konto-Nr. existiert bereits"); return; }
    const sIst = evalExpr(newRow.saldo_ist) ?? 0;
    const sVj  = evalExpr(newRow.saldo_vorjahr) ?? 0;
    onAddKonto({
      kontonummer: nr,
      kontoname: newRow.kontoname.trim(),
      saldo_ist: sIst,
      saldo_vorjahr: sVj,
      position_id: newRow.position_id,
    });
    setNewRow({ kontonummer: "", kontoname: "", saldo_ist: "", saldo_vorjahr: "", position_id: null });
  };
  // Anpassungszeilen-Edit
  const [editAnp, setEditAnp] = useState(null); // { idx, bezeichnung, betrag }
  // Resizable column widths: [Konto-Nr, Kontoname, Saldo IST, Saldo VJ, Abw., Position, Notiz, Pendent]
  const DEFAULT_COL_WIDTHS = [78, 200, 135, 135, 115, 160, 130, 84];
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);
  const colWidthsRef = useRef(DEFAULT_COL_WIDTHS);

  const startResize = (e, ci) => {
    e.preventDefault();
    const sx = e.clientX;
    const sw = colWidthsRef.current[ci];
    const minW = [50, 80, 80, 80, 60, 80, 80, 50][ci] ?? 60;
    const move = (me) => {
      const newW = Math.max(minW, sw + me.clientX - sx);
      const next = colWidthsRef.current.map((w, i) => i === ci ? newW : w);
      colWidthsRef.current = next;
      setColWidths([...next]);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const commitSaldo = (kontoId, field, expr, nextEdit) => {
    const result = evalExpr(expr);
    if (result !== null) onUpdateKonto(kontoId, { [field]: result });
    setEditSaldo(nextEdit || null);
  };
  const toggleKonto = (id) => setExpandedKonten(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const sortedKonten = useMemo(() =>
    [...konten].sort((a, b) => {
      const na = parseInt(a.kontonummer) || 0;
      const nb = parseInt(b.kontonummer) || 0;
      return na - nb;
    }), [konten]);

  // Group by effective position
  const grouped = useMemo(() => {
    const groups = {};
    for (const k of sortedKonten) {
      const pos = k.position_id;
      const key = pos || "__KEIN_MAPPING__";
      if (!groups[key]) groups[key] = [];
      groups[key].push(k);
    }
    return groups;
  }, [sortedKonten]);

  // Order groups by Kontenrahmen order, unmapped last
  const groupOrder = useMemo(() => {
    const posOrder = KONTENRAHMEN_POSITIONEN.map(p => p.id);
    const keys = Object.keys(grouped);
    return [
      ...posOrder.filter(id => keys.includes(id)),
      ...keys.filter(k => !posOrder.includes(k)),
    ];
  }, [grouped]);

  if (konten.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileSpreadsheet className="w-12 h-12 mb-3" style={{ color: isArtis ? "#ccd8cc" : "#d1d5db" }} />
        <div className="text-base font-medium mb-1" style={{ color: headingC }}>Noch keine Konten importiert</div>
        <div className="text-sm" style={{ color: subC }}>Verwenden Sie den Import-Button, um einen Kontenplan hochzuladen.</div>
      </div>
    );
  }

  const COL_HEADERS = ["Konto-Nr", "Kontoname", "Saldo IST", "Saldo VJ", "Abw.", "Position", "Notiz", "Status"];
  const COL_ALIGN = [false, false, true, true, true, false, false, false];
  // Rot für „pendent"-Zeilen – theme-abhängig, damit Text lesbar bleibt.
  // Light/Artis: helles Rot + dunkler Text · Dark: halbtransparenter Rot-Overlay + heller Text.
  const PENDENT_BG       = isArtis ? "#fef2f2" : isLight ? "#fef2f2" : "rgba(220,38,38,0.22)";
  const PENDENT_BG_HOVER = isArtis ? "#fee2e2" : isLight ? "#fee2e2" : "rgba(220,38,38,0.34)";

  const renderGroup = (groupKey) => {
            const rows = grouped[groupKey];
            if (!rows) return null;
            const pos = POSITION_MAP[groupKey];
            const isUnmapped = groupKey === "__KEIN_MAPPING__";
            const isOpen = !collapsed[groupKey];
            const groupTotal = rows.reduce((s, k) => s + (parseFloat(k.saldo_ist) || 0), 0);
            const groupTotalVJ = rows.reduce((s, k) => s + (parseFloat(k.saldo_vorjahr) || 0), 0);
            const groupColors = POSITION_BADGE_COLORS[pos?.seite] || { bg: "#f3f4f6", text: "#374151" };

            return (
              <React.Fragment key={groupKey}>
                {/* Group Header */}
                <tr
                  onClick={() => setCollapsed(p => ({ ...p, [groupKey]: !p[groupKey] }))}
                  style={{
                    backgroundColor: isUnmapped ? "#fef2f2" : (isArtis ? "#f0f5f0" : isLight ? "#f8fafc" : "#2c2c32"),
                    cursor: "pointer", borderTop: `2px solid ${isUnmapped ? "#fecaca" : tableBdr}`,
                  }}>
                  <td colSpan={2} style={{ padding: "8px 12px" }}>
                    <div className="flex items-center gap-2">
                      {isOpen
                        ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: subC }} />
                        : <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color: subC }} />}
                      {isUnmapped
                        ? <span style={{ fontWeight: 700, fontSize: 12, color: "#dc2626" }}>Ohne Mapping ({rows.length} Konten)</span>
                        : (
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, backgroundColor: groupColors.bg, border: `1px solid ${groupColors.text}40` }} />
                            <span style={{ fontWeight: 700, fontSize: 12, color: headingC }}>{pos?.label}</span>
                            <span style={{ fontSize: 10, color: subC }}>{pos?.von}–{pos?.bis} · {rows.length} Kto.</span>
                          </span>
                        )}
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, fontSize: 12, color: headingC, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {fmtCHF(groupTotal)}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, fontSize: 12, color: headingC, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {fmtCHF(groupTotalVJ)}
                  </td>
                  <td colSpan={4} style={{ padding: "8px 12px" }} />
                </tr>

                {/* Rows */}
                {isOpen && rows.map(konto => {
                  const effectivePos = konto.position_id;
                  const isOverridden = !!konto.position_override;
                  const abw = (parseFloat(konto.saldo_ist) || 0) - (parseFloat(konto.saldo_vorjahr) || 0);
                  const noMapping = !effectivePos && /^[1-8]/.test(String(konto.kontonummer));

                  const isExpanded = expandedKonten.has(konto.id);
                  const kontoStatus = statusOf(konto);
                  const isPendent = kontoStatus === "pendent";
                  return (
                    <React.Fragment key={konto.id}>
                    <tr style={{
                      borderBottom: isExpanded ? "none" : `1px solid ${tableBdr}`,
                      backgroundColor: isPendent ? PENDENT_BG : noMapping ? "#fef2f250" : "transparent",
                    }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = isPendent ? PENDENT_BG_HOVER : noMapping ? "#fef2f2" : rowHover}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = isPendent ? PENDENT_BG : isExpanded ? (accent + "08") : noMapping ? "#fef2f250" : "transparent"}>

                      {/* Konto-Nr + Expand Toggle */}
                      <td style={{ padding: "7px 8px 7px 12px", fontWeight: 600, color: headingC, whiteSpace: "nowrap", width: 90 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button onClick={() => toggleKonto(konto.id)} title={isExpanded ? "Arbeitspapier ausblenden" : "Arbeitspapier einblenden"}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 2px", color: isExpanded ? accent : subC, opacity: isExpanded ? 1 : 0.45, flexShrink: 0, lineHeight: 1, fontSize: 10 }}>
                            {isExpanded ? "▼" : "▶"}
                          </button>
                          {konto.kontonummer}
                        </div>
                      </td>
                      {/* Name */}
                      <td style={{ padding: "7px 12px", color: headingC }}>
                        {konto.kontoname || <span style={{ color: subC, fontStyle: "italic" }}>—</span>}
                      </td>
                      {/* Saldo IST – doppelklick editierbar */}
                      <td style={{ padding: editSaldo?.kontoId === konto.id && editSaldo?.field === "saldo_ist" ? "2px 4px" : "7px 12px", textAlign: "right", fontFamily: "monospace", color: headingC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        onDoubleClick={() => setEditSaldo({ kontoId: konto.id, field: "saldo_ist", expr: String(konto.saldo_ist ?? "") })}>
                        {editSaldo?.kontoId === konto.id && editSaldo?.field === "saldo_ist" ? (
                          <input autoFocus value={editSaldo.expr}
                            onChange={e => setEditSaldo(v => ({ ...v, expr: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === "Enter") { e.preventDefault(); commitSaldo(konto.id, "saldo_ist", editSaldo.expr); }
                              if (e.key === "Tab")   { e.preventDefault(); commitSaldo(konto.id, "saldo_ist", editSaldo.expr, { kontoId: konto.id, field: "saldo_vorjahr", expr: String(konto.saldo_vorjahr ?? "") }); }
                              if (e.key === "Escape") setEditSaldo(null);
                            }}
                            onBlur={() => commitSaldo(konto.id, "saldo_ist", editSaldo.expr)}
                            title="Rechnung möglich: z.B. 1000+500 oder 2*630.50"
                            style={{ width: "100%", textAlign: "right", fontFamily: "monospace", fontSize: 12, border: "1.5px solid #60a5fa", borderRadius: 4, padding: "3px 6px", outline: "none", backgroundColor: "#eff6ff" }} />
                        ) : (
                          <span title="Doppelklick zum Bearbeiten" style={{ cursor: "default" }}>{fmtCHF(konto.saldo_ist)}</span>
                        )}
                      </td>
                      {/* Saldo VJ – doppelklick editierbar */}
                      <td style={{ padding: editSaldo?.kontoId === konto.id && editSaldo?.field === "saldo_vorjahr" ? "2px 4px" : "7px 12px", textAlign: "right", fontFamily: "monospace", color: subC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        onDoubleClick={() => setEditSaldo({ kontoId: konto.id, field: "saldo_vorjahr", expr: String(konto.saldo_vorjahr ?? "") })}>
                        {editSaldo?.kontoId === konto.id && editSaldo?.field === "saldo_vorjahr" ? (
                          <input autoFocus value={editSaldo.expr}
                            onChange={e => setEditSaldo(v => ({ ...v, expr: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === "Enter")  { e.preventDefault(); commitSaldo(konto.id, "saldo_vorjahr", editSaldo.expr); }
                              if (e.key === "Tab")    { e.preventDefault(); commitSaldo(konto.id, "saldo_vorjahr", editSaldo.expr); }
                              if (e.key === "Escape") setEditSaldo(null);
                            }}
                            onBlur={() => commitSaldo(konto.id, "saldo_vorjahr", editSaldo.expr)}
                            title="Rechnung möglich: z.B. 1000+500 oder 2*630.50"
                            style={{ width: "100%", textAlign: "right", fontFamily: "monospace", fontSize: 12, border: "1.5px solid #a78bfa", borderRadius: 4, padding: "3px 6px", outline: "none", backgroundColor: "#f5f3ff" }} />
                        ) : (
                          <span title="Doppelklick zum Bearbeiten" style={{ cursor: "default" }}>{fmtCHF(konto.saldo_vorjahr)}</span>
                        )}
                      </td>
                      {/* Abweichung */}
                      <td style={{ padding: "7px 12px", textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {konto.saldo_ist !== null && konto.saldo_vorjahr !== null ? (
                          <span style={{ color: abw > 0 ? "#16a34a" : abw < 0 ? "#dc2626" : subC, fontSize: 12 }}>
                            {abw > 0 ? "+" : ""}{fmtCHF(abw)}
                          </span>
                        ) : <span style={{ color: subC }}>—</span>}
                      </td>
                      {/* Position */}
                      <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
                        <div className="flex items-center gap-1.5">
                          <PositionSelector
                            value={effectivePos}
                            onChange={(newPos) => onUpdateKonto(konto.id, {
                              position_id: newPos,
                              position_override: newPos !== null,
                            })}
                            subC={subC} panelBg={panelBg} panelBdr={panelBdr} headingC={headingC} accent={accent}
                          />
                          {isOverridden && (
                            <button
                              onClick={() => onUpdateKonto(konto.id, {
                                position_id: autoMapKonto(konto.kontonummer),
                                position_override: false,
                              })}
                              title="Manuelle Zuweisung zurücksetzen"
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                              <Lock className="w-3 h-3" style={{ color: accent }} />
                            </button>
                          )}
                        </div>
                      </td>
                      {/* Notiz */}
                      <td style={{ padding: "4px 12px", minWidth: 120 }}>
                        <NotizPopup
                          value={konto.notiz || ""}
                          onChange={val => onUpdateKonto(konto.id, { notiz: val })}
                          accent={accent} headingC={headingC} subC={subC}
                          panelBg={panelBg} panelBdr={panelBdr}
                        />
                      </td>
                      {/* Status: offen / erledigt / pendent */}
                      <td style={{ padding: "4px 12px", textAlign: "center" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          {STATUS_ORDER.map(s => (
                            <button key={s}
                              onClick={() => onUpdateKonto(konto.id, { arbeitspapier: { ...(konto.arbeitspapier || {}), status: s, pendent: s === "pendent" } })}
                              title={STATUS_LABEL[s]}
                              style={{
                                width: 14, height: 14, borderRadius: "50%", cursor: "pointer", padding: 0,
                                border: `2px solid ${STATUS_DOT[s]}`,
                                backgroundColor: kontoStatus === s ? STATUS_DOT[s] : "transparent",
                              }} />
                          ))}
                        </div>
                      </td>
                    </tr>
                    {/* ── Arbeitspapier (MiniExcel) + Belege ── */}
                    {isExpanded && (
                      <tr style={{ borderBottom: `1px solid ${tableBdr}`, backgroundColor: accent + "06" }}>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <MiniExcel
                            data={konto.arbeitspapier}
                            onSave={d => onUpdateKonto(konto.id, { arbeitspapier: { ...(konto.arbeitspapier || {}), ...d } })}
                            accent={accent} headingC={headingC} subC={subC} panelBdr={tableBdr}
                          />
                          <BelegeSection
                            arbeitspapier={konto.arbeitspapier}
                            onSave={d => onUpdateKonto(konto.id, { arbeitspapier: d })}
                            customerId={customerId}
                            selectedYear={selectedYear}
                            kontonummer={konto.kontonummer}
                            kontoname={konto.kontoname}
                            positionId={konto.position_id}
                            accent={accent} headingC={headingC} subC={subC} panelBdr={tableBdr}
                          />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}

                {/* Group Total Row */}
                {isOpen && (
                  <tr style={{ backgroundColor: isArtis ? "#f0f5f0" : isLight ? "#f8fafc" : "#2c2c32", borderBottom: `2px solid ${tableBdr}` }}>
                    <td colSpan={2} style={{ padding: "6px 12px 6px 32px", fontSize: 11, fontWeight: 600, color: subC }}>
                      Total {pos?.label || "Ohne Mapping"}
                    </td>
                    <td style={{ padding: "6px 12px", textAlign: "right", fontWeight: 700, fontSize: 12, color: headingC, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {fmtCHF(groupTotal)}
                    </td>
                    <td style={{ padding: "6px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: subC, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {fmtCHF(groupTotalVJ)}
                    </td>
                    <td colSpan={4} />
                  </tr>
                )}
              </React.Fragment>
            );
  };

  return (
    <div className="overflow-x-auto">
      <table style={{ tableLayout: "fixed", width: COL_HEADERS.reduce((s, _, i) => s + colWidths[i], 0) + "px", borderCollapse: "collapse", fontSize: 13 }}>
        <colgroup>
          {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
          <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
            {COL_HEADERS.map((h, ci) => (
              <th key={h} style={{
                position: "relative",
                padding: "9px 12px", textAlign: COL_ALIGN[ci] ? "right" : "left",
                fontWeight: 700, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase",
                color: subC, borderBottom: `2px solid ${tableBdr}`, whiteSpace: "nowrap",
                userSelect: "none", overflow: "hidden",
              }}>
                {h}
                {/* Resize handle */}
                <div onMouseDown={e => startResize(e, ci)} style={{
                  position: "absolute", right: 0, top: 0, bottom: 0, width: 5,
                  cursor: "col-resize", zIndex: 2,
                }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* ── Inline-Eingabezeile für manuelles Hinzufügen ── */}
          {onAddKonto && (
            <tr style={{ backgroundColor: accent + "0a", borderBottom: `2px solid ${accent}40` }}>
              <td style={{ padding: "4px 6px 4px 12px" }}>
                <input value={newRow.kontonummer}
                  onChange={e => setNewRow(v => ({ ...v, kontonummer: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") submitNewRow(); }}
                  placeholder="Nr."
                  style={{ width: "100%", fontSize: 12, fontFamily: "monospace", fontWeight: 600,
                    padding: "4px 6px", borderRadius: 4, border: `1px solid ${accent}40`,
                    outline: "none", backgroundColor: panelBg, color: headingC }} />
              </td>
              <td style={{ padding: "4px 6px" }}>
                <input value={newRow.kontoname}
                  onChange={e => setNewRow(v => ({ ...v, kontoname: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") submitNewRow(); }}
                  placeholder="Kontoname"
                  style={{ width: "100%", fontSize: 12, padding: "4px 8px", borderRadius: 4,
                    border: `1px solid ${accent}40`, outline: "none", backgroundColor: panelBg, color: headingC }} />
              </td>
              <td style={{ padding: "4px 12px", textAlign: "right" }}>
                <input value={newRow.saldo_ist}
                  onChange={e => setNewRow(v => ({ ...v, saldo_ist: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") submitNewRow(); }}
                  placeholder="0.00"
                  title="Rechnung möglich: 1000+500 oder 2*630.50"
                  style={{ width: "100%", fontSize: 12, fontFamily: "monospace", textAlign: "right",
                    padding: "4px 6px", borderRadius: 4, border: `1px solid ${accent}40`,
                    outline: "none", backgroundColor: panelBg, color: headingC }} />
              </td>
              <td style={{ padding: "4px 12px", textAlign: "right" }}>
                <input value={newRow.saldo_vorjahr}
                  onChange={e => setNewRow(v => ({ ...v, saldo_vorjahr: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") submitNewRow(); }}
                  placeholder="0.00"
                  title="Rechnung möglich: 1000+500"
                  style={{ width: "100%", fontSize: 12, fontFamily: "monospace", textAlign: "right",
                    padding: "4px 6px", borderRadius: 4, border: `1px solid ${accent}40`,
                    outline: "none", backgroundColor: panelBg, color: subC }} />
              </td>
              <td style={{ padding: "4px 6px", textAlign: "center" }}>
                <button onClick={submitNewRow}
                  title="Hinzufügen (Enter)"
                  style={{ fontSize: 14, fontWeight: 800, lineHeight: 1, padding: "4px 10px",
                    borderRadius: 5, border: "none", cursor: "pointer",
                    backgroundColor: accent, color: "#fff" }}>+</button>
              </td>
              <td style={{ padding: "4px 6px" }}>
                <PositionSelector
                  value={newRow.position_id}
                  onChange={(pid) => setNewRow(v => ({ ...v, position_id: pid }))}
                  subC={subC} panelBg={panelBg} panelBdr={panelBdr} headingC={headingC} accent={accent}
                />
              </td>
              <td style={{ padding: "4px 12px", fontSize: 11, color: subC, fontStyle: "italic" }}>
                Neue Zeile · Enter zum Hinzufügen
              </td>
              <td />
            </tr>
          )}
          {groupOrder.filter(k => k !== "__KEIN_MAPPING__").map(renderGroup)}

          {/* ── JAHRESERGEBNIS Summe (nur wenn ER-Konten vorhanden) ── */}
          {(() => {
            const erKonten = sortedKonten.filter(k => POSITION_MAP[k.position_id]?.typ === "er");
            if (erKonten.length === 0) return null;
            const jeIST = erKonten.reduce((s, k) => s + (parseFloat(k.saldo_ist)     || 0), 0);
            const jeVJ  = erKonten.reduce((s, k) => s + (parseFloat(k.saldo_vorjahr) || 0), 0);
            const abw   = jeIST - jeVJ;
            const isGewinn = jeIST >= 0;
            return (
              <tr style={{
                backgroundColor: isGewinn ? "#f0fdf4" : "#fef2f2",
                borderTop: `2px solid ${isGewinn ? "#16a34a" : "#dc2626"}`,
              }}>
                <td colSpan={2} style={{
                  padding: "10px 12px", fontWeight: 800, fontSize: 13,
                  color: isGewinn ? "#15803d" : "#dc2626", letterSpacing: "0.02em",
                }}>
                  JAHRESERGEBNIS
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, fontSize: 13,
                  fontFamily: "monospace", color: isGewinn ? "#15803d" : "#dc2626",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {fmtCHF(jeIST)}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, fontSize: 12,
                  fontFamily: "monospace", color: subC,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {fmtCHF(jeVJ)}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, fontSize: 11,
                  fontFamily: "monospace", color: abw > 0 ? "#16a34a" : abw < 0 ? "#dc2626" : subC,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {abw !== 0 ? (abw > 0 ? "+" : "") + fmtCHF(abw) : ""}
                </td>
                <td colSpan={3} />
              </tr>
            );
          })()}
          {grouped.__KEIN_MAPPING__ && renderGroup("__KEIN_MAPPING__")}
        </tbody>
      </table>

      {/* ── Anpassungszeilen ── */}
      {onSaveDiffAnpassungen && (
        <div style={{ borderTop: `2px solid ${panelBdr}`, marginTop: 4 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: headingC, letterSpacing: "0.03em" }}>
              Anpassungszeilen
              {(diffAnpassungen || []).length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: subC }}>
                  ({(diffAnpassungen || []).length} Zeilen · Total CHF {fmtCHF((diffAnpassungen || []).reduce((s, a) => s + (parseFloat(a.betrag) || 0), 0))})
                </span>
              )}
            </span>
            <button
              onClick={() => {
                const rows = [...(diffAnpassungen || []), { id: crypto.randomUUID(), bezeichnung: "", betrag: 0 }];
                onSaveDiffAnpassungen(rows);
                setEditAnp({ idx: rows.length - 1, bezeichnung: "", betrag: "" });
              }}
              style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, cursor: "pointer",
                backgroundColor: accent + "14", border: `1px solid ${accent}40`, color: accent }}>
              + Anpassungszeile
            </button>
          </div>
          {/* Zeilen-Tabelle */}
          {(diffAnpassungen || []).length > 0 && (
            <div style={{ padding: "0 14px 12px" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: subC, fontWeight: 700, fontSize: 11, borderBottom: `1px solid ${panelBdr}` }}>
                    <th style={{ textAlign: "left", padding: "4px 0", width: "55%" }}>Bezeichnung</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", width: "35%" }}>Betrag CHF</th>
                    <th style={{ width: "10%" }} />
                  </tr>
                </thead>
                <tbody>
                  {(diffAnpassungen || []).map((a, idx) => {
                    const isEditing = editAnp?.idx === idx;
                    const saveAnpRow = () => {
                      if (!editAnp || editAnp.idx !== idx) return;
                      const rows = (diffAnpassungen || []).map((r, i) =>
                        i === idx ? { ...r, bezeichnung: editAnp.bezeichnung, betrag: parseFloat(editAnp.betrag) || 0 } : r
                      );
                      onSaveDiffAnpassungen(rows);
                      setEditAnp(null);
                    };
                    return (
                      <tr key={a.id} style={{ borderBottom: `1px solid ${panelBdr}40` }}>
                        <td style={{ padding: "4px 0" }}>
                          {isEditing ? (
                            <input autoFocus value={editAnp.bezeichnung}
                              onChange={e => setEditAnp(v => ({ ...v, bezeichnung: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key === "Tab")    { e.preventDefault(); document.getElementById(`kanp-betrag-${idx}`)?.focus(); document.getElementById(`kanp-betrag-${idx}`)?.select(); }
                                if (e.key === "Escape") setEditAnp(null);
                                if (e.key === "Enter")  { document.getElementById(`kanp-betrag-${idx}`)?.focus(); document.getElementById(`kanp-betrag-${idx}`)?.select(); }
                              }}
                              style={{ width: "100%", fontSize: 12, padding: "3px 8px", borderRadius: 4, border: `1px solid ${accent}80`, outline: "none" }} />
                          ) : (
                            <span onClick={() => setEditAnp({ idx, bezeichnung: a.bezeichnung, betrag: String(a.betrag) })}
                              style={{ cursor: "text", color: a.bezeichnung ? headingC : subC, fontStyle: a.bezeichnung ? "normal" : "italic" }}>
                              {a.bezeichnung || "Bezeichnung eingeben…"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "4px 8px", textAlign: "right" }}>
                          {isEditing ? (
                            <input id={`kanp-betrag-${idx}`} value={editAnp.betrag} type="number" step="0.01"
                              onChange={e => setEditAnp(v => ({ ...v, betrag: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key === "Enter")  saveAnpRow();
                                if (e.key === "Escape") setEditAnp(null);
                                if (e.key === "Tab")    { e.preventDefault(); saveAnpRow(); }
                              }}
                              onBlur={saveAnpRow}
                              style={{ width: "100%", fontSize: 12, padding: "3px 8px", borderRadius: 4, border: `1px solid ${accent}80`, outline: "none", textAlign: "right" }} />
                          ) : (
                            <span onClick={() => setEditAnp({ idx, bezeichnung: a.bezeichnung, betrag: String(a.betrag) })}
                              style={{ cursor: "text", fontFamily: "monospace", color: headingC }}>
                              {fmtCHF(a.betrag)}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "right", padding: "4px 0" }}>
                          {isEditing
                            ? <button onMouseDown={e => { e.preventDefault(); saveAnpRow(); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#16a34a", fontSize: 16, lineHeight: 1, fontWeight: 700 }}>✓</button>
                            : <button onClick={() => onSaveDiffAnpassungen((diffAnpassungen || []).filter((_, i) => i !== idx))}
                                style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 14, lineHeight: 1, opacity: 0.5 }}>×</button>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(diffAnpassungen || []).length === 0 && (
            <div style={{ padding: "4px 14px 12px", fontSize: 12, color: subC, fontStyle: "italic" }}>
              Noch keine Anpassungszeilen erfasst.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bilanz Tab ────────────────────────────────────────────────────────────────
function BilanzkennzahlRow({ label, value, valueVJ, bilanzsumme, bilanzsummeVJ, isSubtotal, isTotal, accent, subC, headingC }) {
  const fontW = isTotal ? 800 : isSubtotal ? 700 : 400;
  const borderTop = isTotal ? `2px solid ${accent}40` : isSubtotal ? `1px solid ${accent}20` : "none";
  const bg = isTotal ? accent + "08" : "transparent";
  const pctIS = (bilanzsumme && Math.abs(bilanzsumme) > 0.01 && value != null && value !== 0)
    ? (value / bilanzsumme * 100) : null;
  const pctVJ = (bilanzsummeVJ && Math.abs(bilanzsummeVJ) > 0.01 && valueVJ != null && valueVJ !== 0)
    ? (valueVJ / bilanzsummeVJ * 100) : null;
  const fmtP = (p) => p === null ? "" : Math.abs(p).toFixed(1) + "%";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 95px 40px 95px 40px",
      alignItems: "center", padding: `${isTotal ? 8 : 5}px 12px`, borderTop, backgroundColor: bg }}>
      <span style={{ fontSize: isTotal ? 13 : 12, fontWeight: fontW, color: isTotal ? accent : headingC }}>
        {label}
      </span>
      <span style={{ fontSize: isTotal ? 13 : 12, fontWeight: fontW, fontFamily: "monospace",
        color: isTotal ? accent : headingC, textAlign: "right" }}>
        {value === null || value === undefined ? "—" : fmtCHF(value)}
      </span>
      <span style={{ fontSize: 10, color: subC + "cc", textAlign: "right", paddingRight: 2 }}>
        {fmtP(pctIS)}
      </span>
      <span style={{ fontSize: 11, fontFamily: "monospace", color: subC, textAlign: "right" }}>
        {valueVJ === null || valueVJ === undefined ? "" : fmtCHF(valueVJ)}
      </span>
      <span style={{ fontSize: 10, color: subC + "99", textAlign: "right", paddingRight: 4 }}>
        {fmtP(pctVJ)}
      </span>
    </div>
  );
}

function BilanzTab({ konten, accent, headingC, subC, panelBg, panelBdr, tableBdr,
                      signFlipPassiven, onFlipPassiven }) {
  const [showDetails, setShowDetails] = useState(false);

  const sumByIds = (ids) => konten
    .filter(k => ids.includes(k.position_id))
    .reduce((s, k) => s + (parseFloat(k.saldo_ist) || 0), 0);

  const sumVJByIds = (ids) => konten
    .filter(k => ids.includes(k.position_id))
    .reduce((s, k) => s + (parseFloat(k.saldo_vorjahr) || 0), 0);

  const pSign = signFlipPassiven ? -1 : 1;

  const UV_IDS = ["UV_FLUESSIG","UV_WERTSCHRIFTEN","UV_FORD_LL","UV_FORD_LL_NAHE","UV_FORD_SONST","UV_FORD_SONST_NAHE","UV_VORRAETE","UV_ABGRENZUNG"];
  const AV_IDS = ["AV_FINANZ","AV_FINANZ_NAHE","AV_MOBIL","AV_IMMOBIL","AV_IMMATERIELL"];
  const FK_KURZ_IDS = ["FK_KURZ_LL","FK_KURZ_LL_NAHE","FK_KURZ_BANK","FK_KURZ_VERZ_NAHE","FK_KURZ_SONST","FK_KURZ_SONST_NAHE","FK_KURZ_ABGRENZUNG"];
  const FK_LANG_IDS = ["FK_LANG_BANK","FK_LANG_VERZ_NAHE","FK_LANG_SONST","FK_LANG_SONST_NAHE","FK_RUECKSTELLUNGEN"];
  const EK_IDS = ["EK_KAPITAL","EK_KAP_RESERVE","EK_GES_RESERVE","EK_FREIE_RESERVE","EK_RESERVEN","EK_VORTRAG","EK_JAHRESERGEBNIS"];

  const uvTotal = sumByIds(UV_IDS);
  const avTotal = sumByIds(AV_IDS);
  const aktivenTotal = uvTotal + avTotal;

  const fkKurzTotal = sumByIds(FK_KURZ_IDS) * pSign;
  const fkLangTotal = sumByIds(FK_LANG_IDS) * pSign;
  const ekTotal = sumByIds(EK_IDS) * pSign;
  const passivenTotal = fkKurzTotal + fkLangTotal + ekTotal;

  const uvTotalVJ = sumVJByIds(UV_IDS);
  const avTotalVJ = sumVJByIds(AV_IDS);
  const aktivenTotalVJ = uvTotalVJ + avTotalVJ;
  const fkKurzTotalVJ = sumVJByIds(FK_KURZ_IDS) * pSign;
  const fkLangTotalVJ = sumVJByIds(FK_LANG_IDS) * pSign;
  const ekTotalVJ = sumVJByIds(EK_IDS) * pSign;
  const passivenTotalVJ = fkKurzTotalVJ + fkLangTotalVJ + ekTotalVJ;

  const makePos = (id, flip = false) => {
    const pos = POSITION_MAP[id];
    const val = sumByIds([id]) * (flip ? pSign : 1);
    const valVJ = sumVJByIds([id]) * (flip ? pSign : 1);
    return { label: pos?.label || id, val, valVJ };
  };

  const colHeader = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 95px 40px 95px 40px",
      padding: "3px 12px", borderBottom: `1px solid ${panelBdr}` }}>
      <span />
      <span style={{ fontSize: 9, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>IST</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>%</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>VORJAHR</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", paddingRight: 4 }}>%</span>
    </div>
  );

  const diff = aktivenTotal - passivenTotal;
  const balanced = Math.abs(diff) < 0.005;

  const flipBtn = (onClick, active) => (
    <button onClick={onClick} title="Vorzeichen umkehren" style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, cursor: "pointer",
      backgroundColor: active ? "#9d174d22" : "transparent",
      border: `1px solid ${active ? "#9d174d" : "#9d174d66"}`,
      color: active ? "#9d174d" : "#9d174d99",
    }}>± Vorzeichen</button>
  );

  // Hilfsfunktion: Position + optional Einzel-Konten
  const renderPos = (id, flip = false) => {
    const { label, val, valVJ } = makePos(id, flip);
    const pos = POSITION_MAP[id];
    const isNahe = pos?.level === 3; // Nahestehende = eingerückte Sub-Position
    const posKonten = konten.filter(k => k.position_id === id);
    if (val === 0 && posKonten.length === 0) return null;
    const displayVal = val !== 0 ? val : null;
    return (
      <React.Fragment key={id}>
        <BilanzkennzahlRow label={isNahe ? `↳ ${label}` : label} value={displayVal} valueVJ={valVJ !== 0 ? valVJ : null} bilanzsumme={aktivenTotal} bilanzsummeVJ={aktivenTotalVJ} headingC={isNahe ? subC : headingC} subC={subC} accent={accent} />
        {showDetails && posKonten.length > 0 && (
          <div>
            {posKonten.map((k, i) => {
              const kIst = parseFloat(k.saldo_ist) * (flip ? pSign : 1);
              const kVj  = parseFloat(k.saldo_vorjahr || 0) * (flip ? pSign : 1);
              return (
                <div key={k.id} style={{
                  // SELBES 5-Spalten-Grid wie BilanzkennzahlRow → Beträge richtig ausgerichtet
                  display: "grid", gridTemplateColumns: "1fr 95px 40px 95px 40px",
                  alignItems: "center", padding: "3px 12px",
                  fontSize: 11, color: subC,
                  borderBottom: i < posKonten.length - 1 ? `1px solid ${panelBdr}40` : `1px solid ${panelBdr}80`,
                  backgroundColor: panelBg,
                }}>
                  {/* Label: eingerückt, Kontonummer + Name */}
                  <span style={{ paddingLeft: 24, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 600, marginRight: 8, color: subC }}>{k.kontonummer}</span>
                    <span style={{ color: headingC }}>{k.kontoname}</span>
                  </span>
                  {/* IST */}
                  <span style={{ fontFamily: "monospace", textAlign: "right", color: headingC }}>
                    {kIst === 0 ? "" : fmtCHF(kIst)}
                  </span>
                  {/* % leer (Sub-Konten haben keinen eigenen Bilanzsumme-Anteil) */}
                  <span />
                  {/* Vorjahr */}
                  <span style={{ fontFamily: "monospace", textAlign: "right", color: subC }}>
                    {kVj === 0 ? "" : fmtCHF(kVj)}
                  </span>
                  <span />
                </div>
              );
            })}
          </div>
        )}
      </React.Fragment>
    );
  };

  if (konten.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BarChart2 className="w-12 h-12 mb-3" style={{ color: "#d1d5db" }} />
        <div className="text-sm font-medium" style={{ color: headingC }}>Noch keine Konten importiert</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1300 }}>
      {/* Toggle-Button */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setShowDetails(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
            backgroundColor: showDetails ? accent + "18" : "transparent",
            border: `1px solid ${showDetails ? accent : panelBdr}`,
            color: showDetails ? accent : headingC, transition: "all 0.15s" }}>
          {showDetails ? "▲ Einklappen" : "▼ Details anzeigen"}
        </button>
      </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {/* AKTIVEN */}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ padding: "12px 14px", backgroundColor: "#dbeafe", borderBottom: `1px solid ${panelBdr}` }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#1d4ed8", letterSpacing: "0.03em" }}>AKTIVEN</span>
        </div>
        {colHeader}
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC }}>
          Umlaufvermögen
        </div>
        {UV_IDS.map(id => renderPos(id))}
        <BilanzkennzahlRow label="Total Umlaufvermögen" value={uvTotal} valueVJ={uvTotalVJ} bilanzsumme={aktivenTotal} bilanzsummeVJ={aktivenTotalVJ} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC, marginTop: 4 }}>
          Anlagevermögen
        </div>
        {AV_IDS.map(id => renderPos(id))}
        <BilanzkennzahlRow label="Total Anlagevermögen" value={avTotal} valueVJ={avTotalVJ} bilanzsumme={aktivenTotal} bilanzsummeVJ={aktivenTotalVJ} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <BilanzkennzahlRow label="TOTAL AKTIVEN" value={aktivenTotal} valueVJ={aktivenTotalVJ} bilanzsumme={aktivenTotal} bilanzsummeVJ={aktivenTotalVJ} isTotal headingC={headingC} subC={subC} accent={accent} />
      </div>

      {/* PASSIVEN */}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", backgroundColor: "#fce7f3", borderBottom: `1px solid ${panelBdr}` }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#9d174d", letterSpacing: "0.03em" }}>PASSIVEN</span>
          {flipBtn(onFlipPassiven, signFlipPassiven)}
        </div>
        {colHeader}
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC }}>
          Kurzfristiges Fremdkapital
        </div>
        {FK_KURZ_IDS.map(id => renderPos(id, true))}
        <BilanzkennzahlRow label="Total Kurzfristiges FK" value={fkKurzTotal} valueVJ={fkKurzTotalVJ} bilanzsumme={aktivenTotal} bilanzsummeVJ={aktivenTotalVJ} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC, marginTop: 4 }}>
          Langfristiges Fremdkapital
        </div>
        {FK_LANG_IDS.map(id => renderPos(id, true))}
        <BilanzkennzahlRow label="Total Langfristiges FK" value={fkLangTotal} valueVJ={fkLangTotalVJ} bilanzsumme={aktivenTotal} bilanzsummeVJ={aktivenTotalVJ} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC, marginTop: 4 }}>
          Eigenkapital
        </div>
        {EK_IDS.map(id => renderPos(id, true))}
        <BilanzkennzahlRow label="Total Eigenkapital" value={ekTotal} valueVJ={ekTotalVJ} bilanzsumme={aktivenTotal} bilanzsummeVJ={aktivenTotalVJ} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <BilanzkennzahlRow label="TOTAL PASSIVEN" value={passivenTotal} valueVJ={passivenTotalVJ} bilanzsumme={aktivenTotal} bilanzsummeVJ={aktivenTotalVJ} isTotal headingC={headingC} subC={subC} accent={accent} />
      </div>
    </div>

      {/* Differenz */}
      {!balanced && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #fecaca", backgroundColor: "#fef2f2" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
            <AlertCircle className="w-4 h-4" style={{ color: "#dc2626" }} />
            <span className="text-sm font-semibold" style={{ color: "#dc2626" }}>
              Aktiven ≠ Passiven · Differenz: CHF {fmtCHF(Math.abs(diff))}
            </span>
          </div>
          <div style={{ padding: "0 14px 10px", fontSize: 12, color: "#dc2626aa" }}>
            Konten-Zuweisung prüfen.
          </div>
        </div>
      )}
      {balanced && konten.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#16a34a" }} />
          <span className="text-sm font-medium" style={{ color: "#16a34a" }}>Bilanz ausgeglichen</span>
        </div>
      )}
    </div>
  );
}

// ── Erfolgsrechnung Tab ───────────────────────────────────────────────────────
function ERRow({ label, value, valueVJ, nettoerloes, nettoerloesVJ, isSubtotal, isTotal, isNegative, accent, headingC, subC, highlightGreen, details }) {
  const fontW = isTotal ? 800 : isSubtotal ? 700 : 400;
  const color = isTotal && highlightGreen ? "#16a34a" : isTotal ? accent : isNegative && value < 0 ? "#dc2626" : headingC;
  const pctIS = (nettoerloes && Math.abs(nettoerloes) > 0.01 && value != null)
    ? (value / nettoerloes * 100) : null;
  const pctVJ = (nettoerloesVJ && Math.abs(nettoerloesVJ) > 0.01 && valueVJ != null)
    ? (valueVJ / nettoerloesVJ * 100) : null;
  const fmtP = (p) => p === null ? "" : p.toFixed(1) + "%";
  const mainRow = (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 95px 40px 95px 40px", alignItems: "center",
      padding: `${isTotal ? 9 : 5}px 12px`,
      borderTop: isTotal ? `2px solid ${highlightGreen ? "#bbf7d0" : accent + "40"}` : "none",
      backgroundColor: isTotal && highlightGreen ? "#f0fdf4" : isTotal ? accent + "06" : "transparent",
      borderRadius: isTotal ? 4 : 0,
    }}>
      <span style={{ fontSize: isTotal ? 13 : 12, fontWeight: fontW, color }}>{label}</span>
      <span style={{ fontSize: isTotal ? 13 : 12, fontWeight: fontW, fontFamily: "monospace", color, textAlign: "right" }}>
        {value === null || value === undefined ? "—" : fmtCHF(value)}
      </span>
      <span style={{ fontSize: 10, color: subC + "cc", textAlign: "right", paddingRight: 2 }}>{fmtP(pctIS)}</span>
      <span style={{ fontSize: 11, fontFamily: "monospace", color: subC, textAlign: "right" }}>
        {valueVJ === null || valueVJ === undefined ? "" : fmtCHF(valueVJ)}
      </span>
      <span style={{ fontSize: 10, color: subC + "99", textAlign: "right", paddingRight: 4 }}>{fmtP(pctVJ)}</span>
    </div>
  );
  if (!details || !details.length) return mainRow;
  return (
    <>
      {mainRow}
      <div style={{ padding: "1px 12px 5px" }}>
        {details.map((d, i) => (
          <div key={(d.nr || "") + "-" + i} style={{ display: "grid", gridTemplateColumns: "1fr 95px 40px 95px 40px", alignItems: "center", padding: "1px 0 1px 18px" }}>
            <span style={{ fontSize: 11, color: subC, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ fontFamily: "monospace", opacity: 0.75 }}>{d.nr}</span> {d.name}
            </span>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: subC, textAlign: "right" }}>{fmtCHF(d.ist)}</span>
            <span />
            <span style={{ fontSize: 10.5, fontFamily: "monospace", color: subC + "aa", textAlign: "right" }}>{fmtCHF(d.vj)}</span>
            <span />
          </div>
        ))}
      </div>
    </>
  );
}

function ERSeparator({ label, subC }) {
  return (
    <div style={{ padding: "6px 12px 2px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: subC, borderTop: "1px solid #e5e7eb", marginTop: 4 }}>
      {label}
    </div>
  );
}

function ErfolgsrechnungTab({ konten, accent, headingC, subC, panelBg, panelBdr, signFlipER, onFlipER }) {
  const rawSum = (ids) => konten
    .filter(k => ids.includes(k.position_id))
    .reduce((s, k) => s + (parseFloat(k.saldo_ist) || 0), 0);
  const rawSumVJ = (ids) => konten
    .filter(k => ids.includes(k.position_id))
    .reduce((s, k) => s + (parseFloat(k.saldo_vorjahr) || 0), 0);

  // Buchhalterische Standardkonvention: Umsatz = Haben = negativ, Aufwand = Soll = positiv
  // → Standard: Vorzeichen drehen (eSign = -1), damit ER korrekt positiv ist
  // → Flip-Button gedrückt: Rohdaten belassen (eSign = 1), für Exporte die bereits gedreht sind
  const eSign = signFlipER ? 1 : -1;
  const sumByIds   = (ids) => rawSum(ids) * eSign;
  const sumVJByIds = (ids) => rawSumVJ(ids) * eSign;

  // Details: einzelne Konten pro Position (Nr./Name/IST/VJ, vorzeichenkorrekt)
  const [showDetails, setShowDetails] = useState(false);
  const kontenForIds = (ids) => konten
    .filter(k => ids.includes(k.position_id))
    .map(k => ({
      nr: k.kontonummer, name: k.kontoname,
      ist: (parseFloat(k.saldo_ist) || 0) * eSign,
      vj:  (parseFloat(k.saldo_vorjahr) || 0) * eSign,
    }))
    .sort((a, b) => (parseInt(a.nr) || 0) - (parseInt(b.nr) || 0));
  const D = (ids) => showDetails ? kontenForIds(ids) : null;

  if (konten.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <TrendingUp className="w-12 h-12 mb-3" style={{ color: "#d1d5db" }} />
        <div className="text-sm font-medium" style={{ color: headingC }}>Noch keine Konten importiert</div>
      </div>
    );
  }

  // Algebraische Addition: nach dem Flip sind Ertrag + und Aufwand −
  const nettoumsatz    = sumByIds(["ER_UMSATZ","ER_EIGENLEISTUNG","ER_BESTAND"]);
  const material       = sumByIds(["ER_MATERIAL"]);
  const bruttogewinnI  = nettoumsatz + material;          // Erlös − Warenaufwand
  const personal       = sumByIds(["ER_PERSONAL"]);
  const bruttogewinnII = bruttogewinnI + personal;        // BGI − Personalaufwand
  const raum           = sumByIds(["ER_RAUM"]);
  const unterhalt      = sumByIds(["ER_UNTERHALT"]);
  const fahrzeug       = sumByIds(["ER_FAHRZEUG"]);
  const versicherung   = sumByIds(["ER_VERSICHERUNG"]);
  const energie        = sumByIds(["ER_ENERGIE"]);
  const verwaltung     = sumByIds(["ER_VERWALTUNG"]);
  const werbung        = sumByIds(["ER_WERBUNG"]);
  const betrieb        = sumByIds(["ER_BETRIEB"]); // compat / übrige
  const betriebTotal   = raum + unterhalt + fahrzeug + versicherung + energie + verwaltung + werbung + betrieb;
  const ebitda         = bruttogewinnII + betriebTotal;   // BGII − Betriebskosten
  const abschr         = sumByIds(["ER_ABSCHR"]);
  const ebit           = ebitda + abschr;
  const finErtrag      = sumByIds(["ER_FINANZ_ERTRAG","ER_LIEGENSCHAFTEN"]);
  const finAufw        = sumByIds(["ER_FINANZ_AUFW"]);
  const finanzergebnis = finErtrag + finAufw;
  const ebt            = ebit + finanzergebnis;
  const fremdErtrag    = sumByIds(["ER_FREMD_ERTRAG","ER_AO_ERTRAG"]);
  const fremdAufw      = sumByIds(["ER_FREMD_AUFW","ER_AO_AUFW"]);
  const steuern        = sumByIds(["ER_STEUERN"]);
  const jahresergebnis = ebt + fremdErtrag + fremdAufw + steuern;

  // VJ-Werte
  const nettoumsatzVJ    = sumVJByIds(["ER_UMSATZ","ER_EIGENLEISTUNG","ER_BESTAND"]);
  const materialVJ       = sumVJByIds(["ER_MATERIAL"]);
  const bruttogewinnIVJ  = nettoumsatzVJ + materialVJ;
  const personalVJ       = sumVJByIds(["ER_PERSONAL"]);
  const bruttogewinnIIVJ = bruttogewinnIVJ + personalVJ;
  const raumVJ           = sumVJByIds(["ER_RAUM"]);
  const unterhaltVJ      = sumVJByIds(["ER_UNTERHALT"]);
  const fahrzeugVJ       = sumVJByIds(["ER_FAHRZEUG"]);
  const versicherungVJ   = sumVJByIds(["ER_VERSICHERUNG"]);
  const energieVJ        = sumVJByIds(["ER_ENERGIE"]);
  const verwaltungVJ     = sumVJByIds(["ER_VERWALTUNG"]);
  const werbungVJ        = sumVJByIds(["ER_WERBUNG"]);
  const betriebVJ        = sumVJByIds(["ER_BETRIEB"]);
  const betriebTotalVJ   = raumVJ + unterhaltVJ + fahrzeugVJ + versicherungVJ + energieVJ + verwaltungVJ + werbungVJ + betriebVJ;
  const ebitdaVJ         = bruttogewinnIIVJ + betriebTotalVJ;
  const abschrVJ         = sumVJByIds(["ER_ABSCHR"]);
  const ebitVJ           = ebitdaVJ + abschrVJ;
  const finErtragVJ      = sumVJByIds(["ER_FINANZ_ERTRAG","ER_LIEGENSCHAFTEN"]);
  const finAufwVJ        = sumVJByIds(["ER_FINANZ_AUFW"]);
  const finanzergebnisVJ = finErtragVJ + finAufwVJ;
  const ebtVJ            = ebitVJ + finanzergebnisVJ;
  const fremdErtragVJ    = sumVJByIds(["ER_FREMD_ERTRAG","ER_AO_ERTRAG"]);
  const fremdAufwVJ      = sumVJByIds(["ER_FREMD_AUFW","ER_AO_AUFW"]);
  const steuernVJ        = sumVJByIds(["ER_STEUERN"]);
  const jahresergebnisVJ = ebtVJ + fremdErtragVJ + fremdAufwVJ + steuernVJ;

  const props = { accent, headingC, subC, nettoerloes: nettoumsatz, nettoerloesVJ: nettoumsatzVJ };

  const erColHeader = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 95px 40px 95px 40px",
      padding: "3px 12px", borderBottom: `1px solid ${panelBdr}` }}>
      <span />
      <span style={{ fontSize: 9, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>IST</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>%</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>VORJAHR</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", paddingRight: 4 }}>%</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 660 }}>
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", backgroundColor: "#dcfce7", borderBottom: `1px solid ${panelBdr}` }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#15803d", letterSpacing: "0.03em" }}>ERFOLGSRECHNUNG</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setShowDetails(v => !v)} title="Einzelne Konten je Position ein-/ausblenden" style={{
              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, cursor: "pointer",
              backgroundColor: showDetails ? "#15803d22" : "transparent",
              border: `1px solid ${showDetails ? "#15803d" : "#15803d66"}`,
              color: showDetails ? "#15803d" : "#15803d99",
            }}>{showDetails ? "Details ausblenden" : "Details einblenden"}</button>
            <button onClick={onFlipER} title="Vorzeichen umkehren" style={{
              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, cursor: "pointer",
              backgroundColor: signFlipER ? "#15803d22" : "transparent",
              border: `1px solid ${signFlipER ? "#15803d" : "#15803d66"}`,
              color: signFlipER ? "#15803d" : "#15803d99",
            }}>± Vorzeichen</button>
          </div>
        </div>
        {erColHeader}

        <ERSeparator label="Erlös" subC={subC} />
        <ERRow label="Nettoumsatzerlöse"      value={sumByIds(["ER_UMSATZ"])}        valueVJ={sumVJByIds(["ER_UMSATZ"])}        details={D(["ER_UMSATZ"])} {...props} />
        <ERRow label="Eigenleistungen"        value={sumByIds(["ER_EIGENLEISTUNG"])} valueVJ={sumVJByIds(["ER_EIGENLEISTUNG"])} details={D(["ER_EIGENLEISTUNG"])} {...props} />
        <ERRow label="Bestandesveränderungen" value={sumByIds(["ER_BESTAND"])}       valueVJ={sumVJByIds(["ER_BESTAND"])}       details={D(["ER_BESTAND"])} {...props} />
        <ERRow label="Nettoumsatz Total"      value={nettoumsatz}  valueVJ={nettoumsatzVJ}  isSubtotal {...props} />

        <ERRow label="− Warenaufwand"         value={material}     valueVJ={materialVJ}     isNegative details={D(["ER_MATERIAL"])} {...props} />
        <ERRow label="= Bruttogewinn I (Rohergebnis)" value={bruttogewinnI} valueVJ={bruttogewinnIVJ}
          isTotal highlightGreen={bruttogewinnI >= 0} {...props} />

        <ERRow label="− Personalaufwand"      value={personal}     valueVJ={personalVJ}     isNegative details={D(["ER_PERSONAL"])} {...props} />
        <ERRow label="= Bruttogewinn II"      value={bruttogewinnII} valueVJ={bruttogewinnIIVJ}
          isTotal highlightGreen={bruttogewinnII >= 0} {...props} />

        <ERSeparator label="Betriebskosten" subC={subC} />
        {(raum       !== 0 || raumVJ       !== 0) && <ERRow label="− Raumaufwand"                    value={raum}         valueVJ={raumVJ}         isNegative details={D(["ER_RAUM"])} {...props} />}
        {(unterhalt  !== 0 || unterhaltVJ  !== 0) && <ERRow label="− Unterhalt & Reparaturen"        value={unterhalt}    valueVJ={unterhaltVJ}    isNegative details={D(["ER_UNTERHALT"])} {...props} />}
        {(fahrzeug   !== 0 || fahrzeugVJ   !== 0) && <ERRow label="− Fahrzeug- & Transportaufwand"   value={fahrzeug}     valueVJ={fahrzeugVJ}     isNegative details={D(["ER_FAHRZEUG"])} {...props} />}
        {(versicherung!==0 || versicherungVJ!==0) && <ERRow label="− Sachversicherungen & Abgaben"   value={versicherung} valueVJ={versicherungVJ} isNegative details={D(["ER_VERSICHERUNG"])} {...props} />}
        {(energie    !== 0 || energieVJ    !== 0) && <ERRow label="− Energie & Entsorgung"           value={energie}      valueVJ={energieVJ}      isNegative details={D(["ER_ENERGIE"])} {...props} />}
        {(verwaltung !== 0 || verwaltungVJ !== 0) && <ERRow label="− Verwaltungs- & Informatikaufw." value={verwaltung}   valueVJ={verwaltungVJ}   isNegative details={D(["ER_VERWALTUNG"])} {...props} />}
        {(werbung    !== 0 || werbungVJ    !== 0) && <ERRow label="− Werbe- & Akquisitionsaufwand"   value={werbung}      valueVJ={werbungVJ}      isNegative details={D(["ER_WERBUNG"])} {...props} />}
        {(betrieb    !== 0 || betriebVJ    !== 0) && <ERRow label="− Übriger Betriebsaufwand"        value={betrieb}      valueVJ={betriebVJ}      isNegative details={D(["ER_BETRIEB"])} {...props} />}
        <ERRow label="= EBITDA" value={ebitda} valueVJ={ebitdaVJ} isTotal highlightGreen={ebitda >= 0} {...props} />

        <ERSeparator label="Abschreibungen" subC={subC} />
        <ERRow label="− Abschreibungen" value={abschr} valueVJ={abschrVJ} isNegative details={D(["ER_ABSCHR"])} {...props} />
        <ERRow label="= EBIT" value={ebit} valueVJ={ebitVJ} isTotal highlightGreen={ebit >= 0} {...props} />

        <ERSeparator label="Finanzergebnis" subC={subC} />
        <ERRow label="+ Finanzertrag"      value={finErtrag}      valueVJ={finErtragVJ}      details={D(["ER_FINANZ_ERTRAG","ER_LIEGENSCHAFTEN"])} {...props} />
        <ERRow label="− Finanzaufwand"     value={finAufw}        valueVJ={finAufwVJ}        isNegative details={D(["ER_FINANZ_AUFW"])} {...props} />
        <ERRow label="+/− Finanzergebnis"  value={finanzergebnis} valueVJ={finanzergebnisVJ} isSubtotal {...props} />
        <ERRow label="= EBT (vor Sonderergebnis)" value={ebt} valueVJ={ebtVJ} isTotal highlightGreen={ebt >= 0} {...props} />

        <ERSeparator label="Sonderergebnis & Steuern" subC={subC} />
        <ERRow label="+ Betriebsfremder/AO Ertrag" value={fremdErtrag} valueVJ={fremdErtragVJ} details={D(["ER_FREMD_ERTRAG","ER_AO_ERTRAG"])} {...props} />
        <ERRow label="− Betriebsfremder/AO Aufwand" value={fremdAufw}  valueVJ={fremdAufwVJ}  isNegative details={D(["ER_FREMD_AUFW","ER_AO_AUFW"])} {...props} />
        <ERRow label="− Ertragssteuern"             value={steuern}    valueVJ={steuernVJ}    isNegative details={D(["ER_STEUERN"])} {...props} />

        <div style={{ margin: "8px 8px 8px", borderRadius: 8, overflow: "hidden", border: `2px solid ${jahresergebnis >= 0 ? "#bbf7d0" : "#fecaca"}` }}>
          <ERRow label="JAHRESERGEBNIS" value={jahresergebnis} valueVJ={jahresergebnisVJ} isTotal highlightGreen={jahresergebnis >= 0}
            accent={jahresergebnis >= 0 ? "#16a34a" : "#dc2626"} headingC={headingC} subC={subC}
            nettoerloes={nettoumsatz} nettoerloesVJ={nettoumsatzVJ} />
        </div>
      </div>
    </div>
  );
}

// ── Anhang Tab ────────────────────────────────────────────────────────────────
// Vorlagen gemäss neuem schweizerischem Rechnungslegungsrecht (OR 957 ff., in Kraft seit 1.1.2015)
// Brandversicherungswert: war im alten OR Art. 663b, im neuen OR NICHT mehr gefordert → entfernt
const OR_VORLAGEN = [
  // ── PFLICHT für alle (Art. 959c Abs. 1) ─────────────────────────────────
  { id: "bewertung",
    titel: "1. Bewertungsgrundsätze (Art. 959c Abs. 1 Ziff. 1) ★ Pflicht",
    inhalt: "Die Jahresrechnung wurde in Übereinstimmung mit den Vorschriften des Schweizerischen Obligationenrechts (Art. 957–963b OR) erstellt.\n\nBewertungsgrundsätze:\n– Flüssige Mittel: zu Nominalwerten\n– Forderungen: zu Nominalwerten, abzüglich notwendiger Wertberichtigungen\n– Vorräte: zum niedrigeren Wert aus Anschaffungs-/Herstellungskosten und Nettoveräusserungswert\n– Sachanlagen: zu Anschaffungs- oder Herstellungskosten, abzüglich planmässiger Abschreibungen\n– Verbindlichkeiten: zu Nominalwerten\n– Fremdwährungen: Bilanzpositionen zum Tageskurs per Bilanzstichtag; Kursdifferenzen erfolgswirksam" },

  { id: "vollzeit",
    titel: "2. Vollzeitstellen (Art. 959c Abs. 1 Ziff. 6) ★ Pflicht",
    inhalt: "Im Jahresdurchschnitt waren folgende Vollzeitstellen beschäftigt:\n\nGeschäftsjahr __: __ Vollzeitstellen\nVorjahr __:       __ Vollzeitstellen\n\nHinweis: Bis 10 Vollzeitstellen im Jahresdurchschnitt ist eine vereinfachte Buchführung (nur Einnahmen-/Ausgabenrechnung und Vermögensnachweis) nach Art. 957 Abs. 2 OR zulässig." },

  { id: "anteilsinhaber",
    titel: "3. Anteilsinhaber > 5% Stimmrechte (Art. 959c Abs. 1 Ziff. 5) ★ Pflicht AG/GmbH",
    inhalt: "Folgende Personen oder Gesellschaften halten direkt oder indirekt mehr als 5% der Stimmrechte:\n\n[Name], [Ort]: __% der Stimmrechte (__  Aktien/Stammanteile à CHF __)\n[Name], [Ort]: __% der Stimmrechte (__ Aktien/Stammanteile à CHF __)\n\nAktienkapital/Stammkapital total: CHF __ (__ Aktien/Stammanteile à CHF __ Nennwert)\n\n(Falls keine: Es bestehen keine Aktionäre/Gesellschafter mit mehr als 5% der Stimmrechte.)" },

  { id: "beteiligungen",
    titel: "4. Beteiligungen ≥ 10% (Art. 959c Abs. 1 Ziff. 4) ★ Pflicht wenn vorhanden",
    inhalt: "Die Gesellschaft hält folgende wesentliche Beteiligungen (≥ 10% des Kapitals oder der Stimmen):\n\nFirma:           [Name der Beteiligungsgesellschaft]\nRechtsform:      [AG / GmbH / Genossenschaft / …]\nSitz:            [Ort, Land]\nKapitalanteil:   __% | Stimmrechte: __%\nEigenkapital per 31.12.__: CHF __\nJahresergebnis __:          CHF __\n\n(Falls keine: Die Gesellschaft hält keine direkten oder indirekten Beteiligungen von mindestens 10% des Kapitals oder der Stimmen an anderen Unternehmen.)" },

  { id: "stille_reserven",
    titel: "5. Stille Reserven (Art. 959c Abs. 1 Ziff. 3) ★ Pflicht wenn relevant",
    inhalt: "Im Geschäftsjahr __ wurden stille Reserven in folgendem Ausmass aufgelöst bzw. neu gebildet:\n\nAuflösung stiller Reserven: CHF __\nNeubildung stiller Reserven: CHF __\nNettoveränderung (Auflösung ./. Neubildung): CHF __\n\nDie Nettoauflösung stiller Reserven hat den Jahresgewinn um mehr als 5% erhöht.\n\n(Dieser Anhangspunkt ist nur erforderlich, wenn die Auflösung oder Bildung stiller Reserven das Jahresergebnis um mehr als 5% beeinflusst hat. Andernfalls entfällt dieser Punkt.)" },

  // ── PFLICHT für grössere Unternehmen (Art. 961 / ordentliche Revision) ──
  { id: "buergschaft",
    titel: "6. Bürgschaften, Garantien & Pfandbestellungen (Art. 961a Abs. 1 Ziff. 1)",
    inhalt: "Per Bilanzstichtag bestehen folgende Bürgschaften, Garantieverpflichtungen und Pfandbestellungen zugunsten Dritter:\n\n[Art der Verpflichtung]: CHF __ (Begünstigte/r: [Name])\n\nTotal: CHF __\n\n(Falls keine: Es bestehen per Bilanzstichtag keine Bürgschaften, Garantieverpflichtungen oder Pfandbestellungen zugunsten Dritter.)" },

  { id: "pensionskasse",
    titel: "7. Verbindlichkeiten gegenüber Vorsorgeeinrichtungen (Art. 961a Abs. 1 Ziff. 2)",
    inhalt: "Die Verbindlichkeiten gegenüber den Vorsorgeeinrichtungen (Pensionskasse) betragen per Bilanzstichtag:\n\n[Name der Vorsorgeeinrichtung]: CHF __\n\nTotal Verbindlichkeiten gegenüber Vorsorgeeinrichtungen: CHF __\n\n(Falls keine: Es bestehen per Bilanzstichtag keine offenen Verbindlichkeiten gegenüber Vorsorgeeinrichtungen.)" },

  { id: "nahestehende",
    titel: "8. Forderungen/Verbindl. gegenüber Nahestehenden (Art. 961a Abs. 1 Ziff. 3)",
    inhalt: "Forderungen und Verbindlichkeiten gegenüber direkten und indirekten Beteiligungen sowie gegenüber Organen, soweit nicht gesondert in der Bilanz ausgewiesen:\n\nForderungen gegenüber Organen (VR/GL): CHF __\nVerbindlichkeiten gegenüber Organen (VR/GL): CHF __\nForderungen gegenüber Beteiligungen: CHF __\nVerbindlichkeiten gegenüber Beteiligungen: CHF __\n\nAlle Transaktionen mit nahestehenden Personen und Gesellschaften erfolgten zu marktüblichen Konditionen (at arm's length)." },

  { id: "schulden_lang",
    titel: "9. Langfristige verzinsliche Verbindlichkeiten (Art. 959c Abs. 2 Ziff. 1)",
    inhalt: "Langfristige verzinsliche Verbindlichkeiten per Bilanzstichtag:\n\nFällig innerhalb 1–5 Jahren:        CHF __\nFällig nach mehr als 5 Jahren:      CHF __\n\nDinglich gesicherte Verbindlichkeiten: CHF __ (Sicherungsart: [Grundpfand / Faustpfand / …])\n\nWesentliche Einzelverbindlichkeit:\n– Gläubiger: [Bank / Person]\n– Betrag: CHF __ | Zinssatz: __% p.a. | Fälligkeit: __.__.__" },

  { id: "leasing",
    titel: "10. Leasingverbindlichkeiten (Art. 959c Abs. 2)",
    inhalt: "Nicht aktivierte Verbindlichkeiten aus Operating-Leasingverträgen (nicht in der Bilanz enthalten):\n\nFällig innerhalb 1 Jahr:      CHF __\nFällig in 1–5 Jahren:         CHF __\nFällig nach mehr als 5 Jahren: CHF __\n\nTotal Leasingverbindlichkeiten: CHF __\n\nWesentliche Leasingverträge betreffen: [Fahrzeuge / Maschinen / IT-Infrastruktur / Liegenschaften]" },

  { id: "revisionshonorar",
    titel: "11. Revisionshonorar (Art. 959c Abs. 2 Ziff. 2)",
    inhalt: "Honorar der Revisionsstelle im Geschäftsjahr __:\n\nOrdentliche Revision:                    CHF __\nWeitere Prüfungsleistungen:              CHF __\nSteuer- und Beratungsleistungen:         CHF __\n\nTotal Honorare Revisionsstelle:          CHF __\n\nRevisionsstelle: [Firma, Ort]" },

  // ── Empfohlen / Best Practice ────────────────────────────────────────────
  { id: "ereignisse",
    titel: "12. Ereignisse nach dem Bilanzstichtag",
    inhalt: "Nach dem Bilanzstichtag sind keine wesentlichen Ereignisse eingetreten, welche die Vermögens-, Finanz- und Ertragslage der Gesellschaft wesentlich beeinflussen oder zusätzliche Angaben erfordern würden.\n\n(Falls vorhanden: [Beschreibung des Ereignisses und dessen finanzielle Auswirkung auf die Gesellschaft])" },

  { id: "eventualverb",
    titel: "13. Eventualverbindlichkeiten",
    inhalt: "Per Bilanzstichtag bestehen folgende Eventualverbindlichkeiten:\n\n[Art der Verpflichtung, z.B. laufende Rechtsstreitigkeiten, Garantiezusagen]: CHF __\n\nTotal Eventualverbindlichkeiten: CHF __\n\n(Falls keine: Es bestehen per Bilanzstichtag keine wesentlichen Eventualverbindlichkeiten.)" },

  { id: "eigenkapital",
    titel: "14. Entwicklung Eigenkapital",
    inhalt: "Entwicklung des Eigenkapitals im Geschäftsjahr __:\n\nStand 1. Januar __:                CHF __\n+ Jahresergebnis:                  CHF __\n− Dividenden / Kapitalrückzahlung: CHF __\n+/− Kapitalveränderungen:          CHF __\n\nStand 31. Dezember __:            CHF __\n\nDavon: Aktienkapital/Stammkapital: CHF __\n       Gesetzliche Reserven:        CHF __\n       Gewinnvortrag:               CHF __" },

  { id: "freitext",
    titel: "Freier Anhangspunkt",
    inhalt: "" },
];

function AnhangTab({ einstellungen, onSaveEinstellungen, accent, headingC, subC, panelBg, panelBdr, selectedYear, customerName }) {
  const blocks = einstellungen?.anhang_blocks || [];
  const [editId, setEditId] = useState(null);
  const [editTitel, setEditTitel] = useState("");
  const [editInhalt, setEditInhalt] = useState("");
  const [showVorlagen, setShowVorlagen] = useState(false);

  const saveBlocks = (newBlocks) => onSaveEinstellungen({ anhang_blocks: newBlocks });

  const selectBlock = (b) => { setEditId(b.id); setEditTitel(b.titel); setEditInhalt(b.inhalt); };

  const commitEdit = () => {
    if (!editId) return;
    saveBlocks(blocks.map(b => b.id === editId ? { ...b, titel: editTitel, inhalt: editInhalt } : b));
  };

  const addVorlage = (v) => {
    const newBlock = { id: crypto.randomUUID(), vorlagenId: v.id, titel: v.titel, inhalt: v.inhalt };
    const newBlocks = [...blocks, newBlock];
    saveBlocks(newBlocks);
    selectBlock(newBlock);
    setShowVorlagen(false);
  };

  const moveBlock = (idx, dir) => {
    const arr = [...blocks];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    saveBlocks(arr);
  };

  const deleteBlock = (id) => {
    if (editId === id) { setEditId(null); }
    saveBlocks(blocks.filter(b => b.id !== id));
  };

  const selectedBlock = blocks.find(b => b.id === editId);

  return (
    <div style={{ display: "flex", gap: 20, minHeight: 600 }}>
      {/* Left: Block-Liste */}
      <div style={{ width: 300, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: headingC }}>Anhangspunkte</span>
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowVorlagen(v => !v)}
              style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                backgroundColor: accent + "18", border: `1px solid ${accent}`, color: accent }}>
              + Vorlage
            </button>
            {showVorlagen && (
              <div style={{ position: "absolute", right: 0, top: "110%", width: 320, backgroundColor: panelBg,
                border: `1px solid ${panelBdr}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.14)", zIndex: 9999, overflow: "hidden" }}>
                <div style={{ padding: "8px 12px", borderBottom: `1px solid ${panelBdr}`, fontSize: 11, fontWeight: 700, color: subC, textTransform: "uppercase" }}>
                  OR-Vorlagen auswählen
                </div>
                <div style={{ maxHeight: 380, overflowY: "auto" }}>
                  {OR_VORLAGEN.map(v => (
                    <div key={v.id} onClick={() => addVorlage(v)}
                      style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, color: headingC,
                        borderBottom: `1px solid ${panelBdr}20` }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = accent + "12"}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
                      {v.titel}
                    </div>
                  ))}
                </div>
                <div style={{ padding: 6, borderTop: `1px solid ${panelBdr}` }}>
                  <button onClick={() => setShowVorlagen(false)}
                    style={{ width: "100%", fontSize: 11, padding: "4px", border: "none", background: "none", cursor: "pointer", color: subC }}>
                    Schliessen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {blocks.length === 0 ? (
          <div style={{ padding: "20px 12px", border: `2px dashed ${panelBdr}`, borderRadius: 8, textAlign: "center", fontSize: 12, color: subC }}>
            Noch keine Anhangspunkte.<br />Vorlage hinzufügen ↑
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {blocks.map((b, idx) => (
              <div key={b.id}
                onClick={() => selectBlock(b)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 7, cursor: "pointer",
                  border: `1px solid ${b.id === editId ? accent : panelBdr}`,
                  backgroundColor: b.id === editId ? accent + "10" : panelBg }}>
                <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: b.id === editId ? accent : headingC,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {b.titel || "(Ohne Titel)"}
                </span>
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  <button onClick={e => { e.stopPropagation(); moveBlock(idx, -1); }}
                    disabled={idx === 0}
                    style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", color: subC, fontSize: 12, opacity: idx === 0 ? 0.3 : 1, padding: "1px 3px" }}>↑</button>
                  <button onClick={e => { e.stopPropagation(); moveBlock(idx, 1); }}
                    disabled={idx === blocks.length - 1}
                    style={{ background: "none", border: "none", cursor: idx === blocks.length - 1 ? "default" : "pointer", color: subC, fontSize: 12, opacity: idx === blocks.length - 1 ? 0.3 : 1, padding: "1px 3px" }}>↓</button>
                  <button onClick={e => { e.stopPropagation(); deleteBlock(b.id); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#fca5a5", fontSize: 14, padding: "1px 3px", lineHeight: 1 }}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: Editor */}
      <div style={{ flex: 1 }}>
        {!editId ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: subC, fontSize: 13 }}>
            <FileText className="w-10 h-10 mb-3" style={{ opacity: 0.3 }} />
            Anhangspunkt auswählen oder Vorlage hinzufügen
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
            <input value={editTitel}
              onChange={e => setEditTitel(e.target.value)}
              onBlur={commitEdit}
              placeholder="Titel des Anhangspunktes…"
              style={{ fontSize: 14, fontWeight: 700, color: headingC, border: `1px solid ${panelBdr}`,
                borderRadius: 7, padding: "8px 12px", outline: "none", backgroundColor: panelBg, width: "100%" }} />
            <textarea value={editInhalt}
              onChange={e => setEditInhalt(e.target.value)}
              onBlur={commitEdit}
              placeholder="Inhalt des Anhangspunktes… (Platzhalter mit __ ersetzen)"
              rows={20}
              style={{ fontSize: 13, color: headingC, border: `1px solid ${panelBdr}`, borderRadius: 7,
                padding: "10px 12px", outline: "none", backgroundColor: panelBg, resize: "vertical",
                lineHeight: 1.7, fontFamily: "inherit", flex: 1, width: "100%" }} />
            <div style={{ fontSize: 11, color: subC }}>
              Tipp: Platzhalter wie <code style={{ backgroundColor: panelBdr + "40", borderRadius: 3, padding: "1px 4px" }}>__</code> oder <code style={{ backgroundColor: panelBdr + "40", borderRadius: 3, padding: "1px 4px" }}>[Name]</code> durch effektive Werte ersetzen.
              Änderungen werden beim Verlassen des Feldes automatisch gespeichert.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pendenzen-Review: dreispaltige Ansicht statt einer zweiten Tabelle ───────
// Liste links, Beleg-Vorschau permanent gross in der Mitte, Status/Notiz/
// Weiter rechts. Für das Abarbeiten offener Posten — der Kontenplan bleibt
// für die Übersicht über alle Konten unverändert.
function PendenzenReview({ konten, onUpdateKonto, accent, headingC, subC, panelBg, panelBdr, theme, onClose, einstellungen, onSaveEinstellungen, signFlipPassiven }) {
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const pageBg = isArtis ? "#f2f5f2" : isLight ? "#f4f4f8" : "#1c1c20";
  const cardBg = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a";

  const [ppTab, setPpTab] = useState("konten"); // konten | pruefpunkte
  const [filter, setFilter] = useState("pendent"); // alle | offen | erledigt | pendent
  const [selectedId, setSelectedId] = useState(null);
  const [notizDraft, setNotizDraft] = useState("");
  const [preview, setPreview] = useState(null);   // { url, loading }
  const [newPpTitle, setNewPpTitle] = useState("");
  const [newPpTag, setNewPpTag] = useState("nachweis");

  const manualPruefpunkte = einstellungen?.pruefpunkte ?? [];
  const ackKeys = useMemo(() => new Set(einstellungen?.pruefpunkte_ack ?? []), [einstellungen?.pruefpunkte_ack]);
  const bilanzItem = useMemo(() => detectBilanzdifferenzPruefpunkt(konten, signFlipPassiven), [konten, signFlipPassiven]);
  const varianzItems = useMemo(() => detectVarianzPruefpunkte(konten), [konten]);
  const allPruefpunkte = useMemo(() => {
    const auto = [bilanzItem, ...varianzItems].filter(Boolean).map(it => ({ ...it, done: it.locked ? false : ackKeys.has(it.key) }));
    return [...manualPruefpunkte.map(p => ({ ...p, auto: false })), ...auto];
  }, [manualPruefpunkte, bilanzItem, varianzItems, ackKeys]);
  const ppOpenCount = allPruefpunkte.filter(p => !p.done).length;

  const togglePruefpunkt = (item) => {
    if (item.locked) return;
    if (item.auto) {
      const next = new Set(ackKeys);
      next.has(item.key) ? next.delete(item.key) : next.add(item.key);
      onSaveEinstellungen({ pruefpunkte_ack: [...next] });
    } else {
      onSaveEinstellungen({ pruefpunkte: manualPruefpunkte.map(p => p.id === item.id ? { ...p, done: !p.done } : p) });
    }
  };
  const addPruefpunkt = () => {
    const title = newPpTitle.trim();
    if (!title) return;
    onSaveEinstellungen({ pruefpunkte: [...manualPruefpunkte, { id: crypto.randomUUID(), title, sub: "", tag: newPpTag, done: false }] });
    setNewPpTitle("");
  };
  const deletePruefpunkt = (id) => onSaveEinstellungen({ pruefpunkte: manualPruefpunkte.filter(p => p.id !== id) });

  const relevant = useMemo(() =>
    konten.filter(k => Math.abs(parseFloat(k.saldo_ist) || 0) > 0.005), [konten]);

  const filtered = useMemo(() => {
    const list = filter === "alle" ? relevant : relevant.filter(k => statusOf(k) === filter);
    return [...list].sort((a, b) => (parseInt(a.kontonummer) || 0) - (parseInt(b.kontonummer) || 0));
  }, [relevant, filter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedId(null); return; }
    if (!filtered.some(k => k.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = filtered.find(k => k.id === selectedId) || null;
  const belege = selected?.arbeitspapier?.belege || [];
  const erstBeleg = belege[0] || null;

  useEffect(() => { setNotizDraft(selected?.notiz || ""); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!erstBeleg) { setPreview(null); return; }
    const path = (erstBeleg.storage_path || "").replace(/^dokumente\//, "");
    if (!path) { setPreview(null); return; }
    let aktiv = true;
    setPreview({ url: null, loading: true });
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (!aktiv) return;
      setPreview({ url: data?.signedUrl || null, loading: false });
    });
    return () => { aktiv = false; };
  }, [erstBeleg?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = { alle: relevant.length, offen: 0, erledigt: 0, pendent: 0 };
    relevant.forEach(k => { c[statusOf(k)]++; });
    return c;
  }, [relevant]);

  const geprueft = counts.erledigt + counts.pendent;
  const idx = filtered.findIndex(k => k.id === selectedId);

  const goto = (delta) => {
    if (idx < 0 || !filtered.length) return;
    const next = filtered[(idx + delta + filtered.length) % filtered.length];
    setSelectedId(next.id);
  };

  const setStatus = (s) => {
    if (!selected) return;
    // Nachbar VOR der Statusänderung merken: sobald das Konto aus dem aktuellen
    // Filter fällt, soll die Auswahl zum nächsten Posten weiterrücken statt an
    // den Listenanfang zu springen (sonst arbeitet man sich nie durch die Liste).
    const neighbor = filter !== "alle" && s !== filter ? (filtered[idx + 1] || filtered[idx - 1] || null) : null;
    onUpdateKonto(selected.id, { arbeitspapier: { ...(selected.arbeitspapier || {}), status: s, pendent: s === "pendent" } });
    if (neighbor) setSelectedId(neighbor.id);
  };

  const saveNotiz = () => {
    if (!selected || notizDraft === (selected.notiz || "")) return;
    onUpdateKonto(selected.id, { notiz: notizDraft });
  };

  const FILTERS = [
    { key: "pendent", label: "Pendent" }, { key: "offen", label: "Offen" },
    { key: "erledigt", label: "Erledigt" }, { key: "alle", label: "Alle" },
  ];

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: pageBg, display: "flex", flexDirection: "column" }}>
      {/* Kopfzeile */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: `1px solid ${panelBdr}`, backgroundColor: cardBg, flexShrink: 0, flexWrap: "wrap", rowGap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: headingC }}>📋 Pendenzen-Review</span>
        <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 9, backgroundColor: pageBg, border: `1px solid ${panelBdr}` }}>
          <button onClick={() => setPpTab("konten")}
            style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 6, cursor: "pointer", border: "none",
              backgroundColor: ppTab === "konten" ? headingC : "transparent", color: ppTab === "konten" ? cardBg : subC }}>
            Konten-Pendenzen
          </button>
          <button onClick={() => setPpTab("pruefpunkte")}
            style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 6, cursor: "pointer", border: "none",
              backgroundColor: ppTab === "pruefpunkte" ? headingC : "transparent", color: ppTab === "pruefpunkte" ? cardBg : subC }}>
            Offene Prüfpunkte <span style={{ opacity: 0.7 }}>({ppOpenCount})</span>
          </button>
        </div>
        {ppTab === "konten" && (
          <div style={{ display: "flex", gap: 6 }}>
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{
                  fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${filter === f.key ? accent : panelBdr}`,
                  backgroundColor: filter === f.key ? accent + "18" : "transparent",
                  color: filter === f.key ? accent : subC,
                }}>
                {f.label} <span style={{ opacity: 0.7 }}>({counts[f.key]})</span>
              </button>
            ))}
          </div>
        )}
        {ppTab === "konten" && <span style={{ fontSize: 12, color: subC, marginLeft: 4 }}>{geprueft} von {counts.alle} geprüft</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 20, lineHeight: 1 }}>×</button>
      </div>

      {ppTab === "pruefpunkte" ? (
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <div style={{ backgroundColor: cardBg, border: `1px solid ${panelBdr}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${panelBdr}`, display: "flex", gap: 8 }}>
                <input value={newPpTitle} onChange={e => setNewPpTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addPruefpunkt(); }}
                  placeholder="Neuer Prüfpunkt…"
                  style={{ flex: 1, fontSize: 12.5, padding: "7px 10px", borderRadius: 7, border: `1px solid ${panelBdr}`, outline: "none", color: headingC, backgroundColor: pageBg }} />
                <select value={newPpTag} onChange={e => setNewPpTag(e.target.value)}
                  style={{ fontSize: 12, padding: "7px 8px", borderRadius: 7, border: `1px solid ${panelBdr}`, color: headingC, backgroundColor: pageBg }}>
                  <option value="nachweis">Nachweis</option>
                  <option value="pflicht">Pflicht</option>
                  <option value="analyse">Analyse</option>
                </select>
                <button onClick={addPruefpunkt} style={{ padding: "7px 14px", borderRadius: 7, border: "none", backgroundColor: accent, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  + Hinzufügen
                </button>
              </div>
              {!allPruefpunkte.length ? (
                <div style={{ padding: "22px 18px", textAlign: "center", color: subC, fontSize: 12.5 }}>Keine offenen Prüfpunkte.</div>
              ) : allPruefpunkte.map((p, i) => {
                const tagColors = {
                  nachweis: { bg: "#fdecd6", fg: "#b5590a" }, pflicht: { bg: "#fdecd6", fg: "#b5590a" },
                  analyse: { bg: "#e4e9f5", fg: "#3d5789" }, erledigt: { bg: pageBg, fg: subC },
                }[p.done ? "erledigt" : p.tag] || { bg: pageBg, fg: subC };
                return (
                  <div key={p.auto ? p.key : p.id}
                    style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "13px 18px",
                      borderBottom: i < allPruefpunkte.length - 1 ? `1px solid ${panelBdr}` : "none",
                      backgroundColor: p.done ? accent + "0a" : "transparent" }}>
                    <div onClick={() => togglePruefpunkt(p)}
                      title={p.locked ? "Wird automatisch aktualisiert" : undefined}
                      style={{
                        width: 19, height: 19, borderRadius: 6, flexShrink: 0, marginTop: 1,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: p.locked ? "default" : "pointer", fontSize: 12, fontWeight: 700, color: "#fff",
                        border: `1.5px solid ${p.done ? "#16a34a" : panelBdr}`,
                        backgroundColor: p.done ? "#16a34a" : "transparent",
                      }}>
                      {p.done ? "✓" : ""}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: headingC }}>{p.title}</div>
                      {(p.sub || p.done) && <div style={{ fontSize: 11.5, color: subC, marginTop: 2 }}>{p.sub}</div>}
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, padding: "4px 12px", borderRadius: 20, backgroundColor: tagColors.bg, color: tagColors.fg }}>
                      {p.done ? "Erledigt" : (p.tag === "nachweis" ? "Nachweis" : p.tag === "pflicht" ? "Pflicht" : "Analyse")}
                    </span>
                    {!p.auto && (
                      <button onClick={() => deletePruefpunkt(p.id)} title="Löschen"
                        style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 14, opacity: 0.5, flexShrink: 0 }}>×</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : !filtered.length ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: subC, fontSize: 13 }}>
          Keine Konten in dieser Ansicht.
        </div>
      ) : (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "280px 1fr 260px", gap: 14, padding: 14, minHeight: 0 }}>
          {/* Liste */}
          <div style={{ backgroundColor: cardBg, border: `1px solid ${panelBdr}`, borderRadius: 12, overflowY: "auto" }}>
            {filtered.map(k => {
              const st = statusOf(k);
              const active = k.id === selectedId;
              return (
                <div key={k.id} onClick={() => setSelectedId(k.id)}
                  style={{
                    padding: "10px 14px", cursor: "pointer",
                    borderLeft: `3px solid ${active ? accent : "transparent"}`,
                    backgroundColor: active ? accent + "14" : "transparent",
                    borderBottom: `1px solid ${panelBdr}`,
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: STATUS_DOT[st], flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 600, color: headingC, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {k.kontonummer} · {k.kontoname}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: subC, marginTop: 2, paddingLeft: 14 }}>{fmtCHF(k.saldo_ist)} CHF</div>
                </div>
              );
            })}
          </div>

          {/* Beleg-Vorschau */}
          <div style={{ backgroundColor: cardBg, border: `1px solid ${panelBdr}`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflow: "hidden" }}>
            {!erstBeleg ? (
              <div style={{ textAlign: "center", color: subC, fontSize: 13 }}>
                Noch kein Beleg verknüpft.<br />
                <span style={{ fontSize: 11.5 }}>Im Kontenplan bei diesem Konto „Beleg verknüpfen" nutzen.</span>
              </div>
            ) : preview?.loading ? (
              <span style={{ fontSize: 12, color: subC }}>Lädt…</span>
            ) : !preview?.url ? (
              <span style={{ fontSize: 12, color: subC }}>Vorschau nicht verfügbar</span>
            ) : (erstBeleg.file_type || "").includes("pdf") ? (
              <iframe src={preview.url} title={erstBeleg.name} style={{ width: "100%", height: "100%", border: "none" }} />
            ) : (erstBeleg.file_type || "").startsWith("image/") ? (
              <img src={preview.url} alt={erstBeleg.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ textAlign: "center", color: subC, fontSize: 12 }}>
                {erstBeleg.name}<br />Keine Vorschau für diesen Dateityp.
              </div>
            )}
          </div>

          {/* Aktion */}
          <div style={{ backgroundColor: cardBg, border: `1px solid ${panelBdr}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            {selected && (
              <>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: headingC }}>{selected.kontonummer} · {selected.kontoname}</div>
                  <div style={{ fontSize: 11.5, color: subC, marginTop: 2 }}>Saldo {fmtCHF(selected.saldo_ist)} CHF</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Status setzen</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {STATUS_ORDER.map(s => {
                      const active = statusOf(selected) === s;
                      return (
                        <button key={s} onClick={() => setStatus(s)}
                          style={{
                            textAlign: "left", padding: "7px 10px", borderRadius: 7, cursor: "pointer",
                            border: `1.5px solid ${active ? STATUS_DOT[s] : panelBdr}`,
                            backgroundColor: active ? STATUS_DOT[s] + "18" : "transparent",
                            color: active ? STATUS_DOT[s] : headingC,
                            fontWeight: active ? 700 : 400, fontSize: 12.5,
                          }}>
                          {STATUS_LABEL[s]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Notiz</div>
                  <textarea value={notizDraft} onChange={e => setNotizDraft(e.target.value)} onBlur={saveNotiz}
                    placeholder="Kurze Bemerkung…"
                    style={{ width: "100%", height: 64, resize: "none", borderRadius: 7, border: `1px solid ${panelBdr}`, padding: "7px 9px", fontSize: 12, color: headingC, backgroundColor: pageBg, fontFamily: "inherit" }} />
                </div>
                <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
                  <button onClick={() => goto(-1)} disabled={filtered.length < 2}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${panelBdr}`, backgroundColor: "transparent", color: subC, fontSize: 12, cursor: filtered.length < 2 ? "default" : "pointer" }}>
                    ← Zurück
                  </button>
                  <button onClick={() => goto(1)} disabled={filtered.length < 2}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", backgroundColor: accent, color: "#fff", fontWeight: 700, fontSize: 12, cursor: filtered.length < 2 ? "default" : "pointer" }}>
                    Weiter →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function Abschlussdokumentation() {
  const navigate = useNavigate();
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const pageBg   = isLight ? "#f4f4f8"   : isArtis ? "#f2f5f2"   : "#2a2a2f";
  const panelBg  = isLight ? "#ffffff"   : isArtis ? "#ffffff"   : "#27272a";
  const panelBdr = isLight ? "#e2e2ec"   : isArtis ? "#ccd8cc"   : "#3f3f46";
  const headingC = isLight ? "#1e293b"   : isArtis ? "#1a3a1a"   : "#e4e4e7";
  const subC     = isLight ? "#64748b"   : isArtis ? "#4a6a4a"   : "#a1a1aa";
  const accent   = isArtis ? "#5b8a5b"   : isLight  ? "#3b6a8a"  : "#3b82f6";
  const accentL  = isArtis ? "#7a9b7a"   : isLight  ? "#5b8aaa"  : "#60a5fa";
  const rowHover = isLight ? "#f8f8fc"   : isArtis ? "#f0f5f0"   : "#2f2f35";
  const tableBdr = isLight ? "#e8e8f0"   : isArtis ? "#d4e4d4"   : "#3f3f46";

  const qc = useQueryClient();
  const [selectedCid, setSelectedCid] = useState("");
  const [selectedYear, setSelectedYear] = useState(currentYear());
  const [selectedVersion, setSelectedVersion] = useState(null); // null = neueste Version
  const [activeTab, setActiveTab] = useState("kontenplan");
  const [showImport, setShowImport] = useState(false);
  const [dossierStatus, setDossierStatus] = useState(null); // null | Fortschrittstext
  const [aiBusy, setAiBusy] = useState(null); // null | Fortschrittstext der KI-Zuweisung
  const [exportDialog, setExportDialog] = useState(null);   // null | "pdf" | "dossier"
  const [showPendenzen, setShowPendenzen] = useState(false);

  // ── Auto-Jahr: neuestes Jahr das wirklich Konten hat ────────────────────────
  useEffect(() => {
    if (!selectedCid) return;
    // 1. Alle abschluss des Mandanten, neuestes zuerst
    supabase.from("abschluss")
      .select("id, geschaeftsjahr")
      .eq("customer_id", selectedCid)
      .order("geschaeftsjahr", { ascending: false })
      .limit(10)
      .then(async ({ data: abs }) => {
        // Erstes mit mindestens einem Konto nehmen
        for (const ab of abs || []) {
          const { count } = await supabase.from("abschluss_konten")
            .select("*", { count: "exact", head: true })
            .eq("abschluss_id", ab.id);
          if (count > 0) { setSelectedYear(ab.geschaeftsjahr); return; }
        }
        // 2. Fallback: letztes Ablagejahr in Dokumente
        const { data: dData } = await supabase.from("dokumente")
          .select("year")
          .eq("customer_id", selectedCid)
          .order("year", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (dData?.year) setSelectedYear(dData.year);
        // 3. Sonst: aktuelles Jahr bleibt (currentYear())
      });
  }, [selectedCid]);

  // ── Kunden laden ─────────────────────────────────────────────────────────
  const { data: kunden = [] } = useQuery({
    queryKey: ["customers_all"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  const allKunden = kunden.filter(c => c.aktiv !== false);
  const unternehmen = allKunden.filter(c => c.person_type !== "privatperson");
  const privatpersonen = allKunden.filter(c => c.person_type === "privatperson");
  const sortedKunden = [...unternehmen, ...privatpersonen];

  const selectedCustomer = kunden.find(c => c.id === selectedCid);
  const customerName = selectedCustomer
    ? (selectedCustomer.person_type === "privatperson"
        ? [selectedCustomer.anrede, selectedCustomer.nachname, selectedCustomer.vorname].filter(Boolean).join(" ")
        : selectedCustomer.company_name)
    : "";

  // Welche Kunden haben bereits Abschlüsse?
  const { data: existingAbschlussIds = [] } = useQuery({
    queryKey: ["abschluss_cids"],
    queryFn: async () => {
      const { data, error } = await supabase.from("abschluss").select("customer_id");
      if (error) throw new Error(error.message);
      return [...new Set((data || []).map(r => r.customer_id))];
    },
  });
  const withAbschlussSet = new Set(existingAbschlussIds);

  // ── Abschluss-Versionen laden / erstellen ─────────────────────────────────
  const { data: versions = [], isLoading: abschlussLoading, refetch: refetchAbschluss } = useQuery({
    queryKey: ["abschluss_versions", selectedCid, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("abschluss")
        .select("*")
        .eq("customer_id", selectedCid)
        .eq("geschaeftsjahr", selectedYear)
        .order("version", { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!selectedCid,
  });

  // Gewählte Version (Default: neueste). selectedVersion = null → neueste.
  const abschluss = useMemo(() => {
    if (!versions.length) return null;
    if (selectedVersion != null) {
      return versions.find(v => v.version === selectedVersion) || versions[versions.length - 1];
    }
    return versions[versions.length - 1];
  }, [versions, selectedVersion]);

  // Beim Wechsel von Mandant/Jahr immer die neueste Version zeigen
  useEffect(() => { setSelectedVersion(null); }, [selectedCid, selectedYear]);

  // ── Abschluss erstellen falls nicht vorhanden ─────────────────────────────
  const createAbschlussMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("abschluss")
        .insert({ customer_id: selectedCid, geschaeftsjahr: selectedYear, status: "in_arbeit", version: 1 })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abschluss_versions", selectedCid, selectedYear] });
      qc.invalidateQueries({ queryKey: ["abschluss_cids"] });
    },
    onError: (e) => {
      // Zeile existiert bereits (Race mit Auto-Jahr-Effekt) → kein Fehler-Toast,
      // einfach neu laden. Greift bei altem wie neuem Unique-Constraint.
      if (/duplicate key|23505|already exists/i.test(e?.message || "")) {
        qc.invalidateQueries({ queryKey: ["abschluss_versions", selectedCid, selectedYear] });
        return;
      }
      toast.error("Fehler: " + e.message);
    },
  });

  // Auto-create erste Version, wenn für Kunde+Jahr noch keine existiert.
  // Guard pro (Kunde|Jahr) gegen Doppel-Anlage durch das überlappende
  // Auto-Jahr-Effekt-Timing (sonst "duplicate key"-Fehler, v.a. beim Default-Jahr).
  const autoCreateKeysRef = useRef(new Set());
  useEffect(() => {
    if (!selectedCid || abschlussLoading || versions.length > 0 || createAbschlussMut.isPending) return;
    const key = `${selectedCid}|${selectedYear}`;
    if (autoCreateKeysRef.current.has(key)) return;
    autoCreateKeysRef.current.add(key);
    createAbschlussMut.mutate();
  }, [selectedCid, selectedYear, versions.length, abschlussLoading]);

  const abschlussId = abschluss?.id;
  const gesperrt = !!abschluss?.gesperrt;

  // ── Konten laden ──────────────────────────────────────────────────────────
  const { data: konten = [], isLoading: kontenLoading } = useQuery({
    queryKey: ["abschluss_konten", abschlussId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("abschluss_konten")
        .select("*")
        .eq("abschluss_id", abschlussId)
        .order("kontonummer");
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!abschlussId,
  });

  // ── Einstellungen (sign_flip, diff_anpassungen) ───────────────────────────
  const einstellungen = abschluss?.einstellungen || {};
  const signFlipPassiven = einstellungen.sign_flip_passiven ?? false;
  const signFlipER       = einstellungen.sign_flip_er       ?? false;
  const diffAnpassungen  = einstellungen.differenz_anpassungen ?? [];

  const updateEinstellungenMut = useMutation({
    mutationFn: async (patch) => {
      if (gesperrt) { toast.error("Version ist gesperrt"); return; }
      const merged = { ...(abschluss?.einstellungen || {}), ...patch };
      const { error } = await supabase.from("abschluss").update({ einstellungen: merged }).eq("id", abschlussId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["abschluss_versions", selectedCid, selectedYear] }),
    onError: (e) => toast.error(e.message),
  });

  // ── Status aktualisieren ──────────────────────────────────────────────────
  const updateStatusMut = useMutation({
    mutationFn: async (newStatus) => {
      if (gesperrt) { toast.error("Version ist gesperrt"); return; }
      const { error } = await supabase.from("abschluss").update({ status: newStatus }).eq("id", abschlussId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abschluss_versions", selectedCid, selectedYear] });
      toast.success("Status aktualisiert");
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Neue (leere) Version anlegen ──────────────────────────────────────────
  const createVersionMut = useMutation({
    mutationFn: async () => {
      const nextV = versions.length ? Math.max(...versions.map(v => v.version || 1)) + 1 : 1;
      const { data, error } = await supabase
        .from("abschluss")
        .insert({ customer_id: selectedCid, geschaeftsjahr: selectedYear, status: "in_arbeit", version: nextV })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => {
      setSelectedVersion(data.version);
      qc.invalidateQueries({ queryKey: ["abschluss_versions", selectedCid, selectedYear] });
      toast.success(`Version ${data.version} angelegt – leer, bitte Bilanz/ER importieren`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Version sperren / entsperren ──────────────────────────────────────────
  const toggleLockMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("abschluss").update({ gesperrt: !gesperrt }).eq("id", abschlussId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abschluss_versions", selectedCid, selectedYear] });
      toast.success(gesperrt ? "Version entsperrt" : "Version gesperrt");
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Version löschen (Konten via FK ON DELETE CASCADE) ─────────────────────
  const deleteVersionMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("abschluss").delete().eq("id", abschlussId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setSelectedVersion(null);
      // Guard freigeben, damit beim Löschen der letzten Version wieder
      // automatisch eine leere V1 angelegt werden kann.
      autoCreateKeysRef.current.delete(`${selectedCid}|${selectedYear}`);
      qc.invalidateQueries({ queryKey: ["abschluss_versions", selectedCid, selectedYear] });
      qc.invalidateQueries({ queryKey: ["abschluss_cids"] });
      toast.success("Version gelöscht");
    },
    onError: (e) => toast.error(e.message),
  });

  function handleDeleteVersion() {
    if (!abschlussId) return;
    if (gesperrt) { toast.error("Gesperrte Version – zuerst entsperren"); return; }
    if (!window.confirm(`Version ${abschluss?.version} wirklich löschen?\nAlle Konten und Notizen dieser Version gehen verloren.`)) return;
    deleteVersionMut.mutate();
  }

  // ── Versions-Kommentar (Feld "notizen") ───────────────────────────────────
  const updateNotizenMut = useMutation({
    mutationFn: async (text) => {
      if (gesperrt) { toast.error("Version ist gesperrt"); return; }
      const { error } = await supabase.from("abschluss").update({ notizen: text }).eq("id", abschlussId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["abschluss_versions", selectedCid, selectedYear] }),
    onError: (e) => toast.error(e.message),
  });

  // ── Konto aktualisieren ───────────────────────────────────────────────────
  const updateKontoMut = useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const { error } = await supabase.from("abschluss_konten").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["abschluss_konten", abschlussId] }),
    onError: (e) => toast.error(e.message),
  });

  function handleUpdateKonto(id, fields) {
    if (gesperrt) { toast.error("Version ist gesperrt"); return; }
    updateKontoMut.mutate({ id, ...fields });
  }

  // ── Manuelles Konto hinzufügen (Inline-Eingabe im Kontenplan) ──────────────
  const addKontoMut = useMutation({
    mutationFn: async ({ kontonummer, kontoname, saldo_ist, saldo_vorjahr, position_id }) => {
      const { error } = await supabase.from("abschluss_konten").insert({
        abschluss_id: abschlussId,
        kontonummer: String(kontonummer),
        kontoname: kontoname || "",
        saldo_ist: saldo_ist ?? 0,
        saldo_vorjahr: saldo_vorjahr ?? 0,
        position_id: position_id || autoMapKonto(kontonummer),
        position_override: !!position_id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abschluss_konten", abschlussId] });
      toast.success("Konto hinzugefügt");
    },
    onError: (e) => toast.error(e.message),
  });
  function handleAddKonto(data) {
    if (!abschlussId) return;
    if (gesperrt) { toast.error("Version ist gesperrt"); return; }
    addKontoMut.mutate(data);
  }

  // ── Revisions-Dossier (ZIP) erstellen ─────────────────────────────────────
  async function handleRevisionsDossier(mode) {
    if (!konten.length) { toast.error("Keine Konten vorhanden"); return; }
    if (dossierStatus) return; // läuft bereits
    setDossierStatus("Wird vorbereitet …");
    try {
      const res = await generateRevisionsDossier({
        konten, einstellungen, customerName, selectedYear,
        onProgress: (m) => setDossierStatus(m),
        mode,
      });
      toast.success(
        `Revisions-Dossier erstellt — ${res.belegOk}/${res.belegTotal} Belege beigelegt`
        + (res.belegFail ? ` · ${res.belegFail} nicht ladbar` : "")
      );
      if (res.belegFail && res.failed?.length) {
        const list = res.failed
          .map(f => `• Konto ${f.kontonummer || "—"}: ${f.name}${f.reason ? ` — ${f.reason}` : ""}`)
          .join("\n");
        toast.error(
          <div style={{ whiteSpace: "pre-line", fontSize: 12, lineHeight: 1.5 }}>
            <strong>{res.belegFail} Beleg(e) nicht ladbar:</strong>{"\n"}{list}
            {"\n"}<span style={{ opacity: 0.75 }}>(auch in Belege/_FEHLENDE_BELEGE.txt im ZIP)</span>
          </div>,
          { duration: 15000 }
        );
      }
    } catch (e) {
      toast.error("Dossier fehlgeschlagen: " + (e?.message || e));
    } finally {
      setDossierStatus(null);
    }
  }

  // ── Export starten (nach Modus-Wahl im Dialog) ────────────────────────────
  function runExport(target, mode, rememberAsDefault) {
    if (rememberAsDefault) {
      updateEinstellungenMut.mutate({ export_mode: mode });
    }
    setExportDialog(null);
    if (target === "pdf") {
      generateAbschlussPDF({ konten, einstellungen, customerName, selectedYear, mode });
    } else if (target === "dossier") {
      handleRevisionsDossier(mode);
    }
  }

  // ── Konten importieren (Merge: Salden aktualisieren, manuelle Daten behalten) ──
  const importKontenMut = useMutation({
    mutationFn: async (newKonten) => {
      // 1. Bestehende Konten laden (position_id, notiz, arbeitspapier bleiben erhalten)
      const { data: existing, error: fetchErr } = await supabase
        .from("abschluss_konten")
        .select("id, kontonummer, position_id, notiz, arbeitspapier")
        .eq("abschluss_id", abschlussId);
      if (fetchErr) throw new Error(fetchErr.message);

      const existingMap = new Map((existing || []).map(k => [String(k.kontonummer), k]));
      const newNrSet    = new Set(newKonten.map(k => String(k.kontonummer)));

      // 2. Bestehende Konten: NUR Salden aktualisieren – Kontoname und alle
      //    manuellen Daten (position_id, notiz, arbeitspapier) bleiben unberührt
      const toUpdate = newKonten.filter(k => existingMap.has(String(k.kontonummer)));
      for (const k of toUpdate) {
        const ex = existingMap.get(String(k.kontonummer));
        const { error } = await supabase.from("abschluss_konten").update({
          saldo_ist:     k.saldo_ist,
          saldo_vorjahr: k.saldo_vorjahr,
          // kontoname bewusst NICHT aktualisiert → manuelle Umbenennungen bleiben
        }).eq("id", ex.id);
        if (error) throw new Error(error.message);
      }

      // 3. Neue Konten einfügen (bisher nicht vorhanden)
      const toInsert = newKonten
        .filter(k => !existingMap.has(String(k.kontonummer)))
        .map(k => ({ ...k, abschluss_id: abschlussId }));
      for (let i = 0; i < toInsert.length; i += 100) {
        const { error } = await supabase.from("abschluss_konten").insert(toInsert.slice(i, i + 100));
        if (error) throw new Error(error.message);
      }

      // 4. Weggefallene Konten: nur löschen wenn KEINE manuellen Daten vorhanden
      //    (mit Zuweisung/Notiz/Arbeitspapier → Saldo auf 0 setzen statt löschen)
      const removed = (existing || []).filter(ex => !newNrSet.has(String(ex.kontonummer)));
      const hasManual = (ex) => ex.position_id ||
        ex.notiz ||
        (ex.arbeitspapier?.rows?.length > 0) ||
        (ex.arbeitspapier?.belege?.length > 0);

      const toDelete  = removed.filter(ex => !hasManual(ex));
      const toZero    = removed.filter(ex =>  hasManual(ex));

      if (toDelete.length > 0) {
        const { error } = await supabase.from("abschluss_konten")
          .delete().in("id", toDelete.map(k => k.id));
        if (error) throw new Error(error.message);
      }
      for (const ex of toZero) {
        // Konto hat manuelle Daten → Saldo nullen, aber Zuweisung/Notiz/AP behalten
        await supabase.from("abschluss_konten")
          .update({ saldo_ist: 0, saldo_vorjahr: 0 }).eq("id", ex.id);
      }

      return { updated: toUpdate.length, inserted: toInsert.length,
               deleted: toDelete.length, zeroed: toZero.length };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["abschluss_konten", abschlussId] });
      const parts = [];
      if (res.updated)  parts.push(`${res.updated} aktualisiert`);
      if (res.inserted) parts.push(`${res.inserted} neu`);
      if (res.zeroed)   parts.push(`${res.zeroed} auf 0 gesetzt (manuelle Daten behalten)`);
      if (res.deleted)  parts.push(`${res.deleted} gelöscht`);
      toast.success("Kontenplan neu eingelesen – " + parts.join(", "));
      setShowImport(false);
    },
    onError: (e) => toast.error("Import fehlgeschlagen: " + e.message),
  });

  function handleImport(kontenData, flipFlags) {
    if (!abschlussId) { toast.error("Abschluss nicht bereit"); return; }
    if (gesperrt) { toast.error("Version ist gesperrt – zuerst entsperren"); return; }
    importKontenMut.mutate(kontenData);
    if (flipFlags && (
      flipFlags.sign_flip_passiven !== signFlipPassiven ||
      flipFlags.sign_flip_er       !== signFlipER
    )) {
      updateEinstellungenMut.mutate({
        sign_flip_passiven: !!flipFlags.sign_flip_passiven,
        sign_flip_er:       !!flipFlags.sign_flip_er,
      });
    }
  }

  // ── KI-Belegzuweisung: pro Bilanz-Konto passenden Beleg im Dokumenteninhalt
  //    (Dateiablage, gewähltes Jahr) suchen. Reihenfolge: (1) Betrags-Abgleich =
  //    sofortiger sicherer Treffer, (2) LLM-Rerank für die unsicheren Konten,
  //    (3) Fallback Stichwort-Heuristik, falls LLM nicht verfügbar. ────────────
  async function handleAiAssign() {
    if (!abschlussId || !selectedCid) return;
    if (gesperrt) { toast.error("Version ist gesperrt – zuerst entsperren"); return; }
    if (aiBusy) return;
    const targets = konten.filter(k => {
      const pos = POSITION_MAP[k.position_id];
      const hasSaldo = Math.abs(parseFloat(k.saldo_ist) || 0) > 0.005;
      const hasBeleg = ((k.arbeitspapier?.belege) || []).length > 0;
      return pos?.typ === "bilanz" && hasSaldo && !hasBeleg;
    });
    if (!targets.length) { toast.info("Keine offenen Bilanz-Konten (mit Saldo, ohne Beleg) gefunden."); return; }

    setAiBusy("Suche läuft …");
    const assignedList = [];
    const contentCache = new Map(); // docId → content_text
    const docMeta = new Map();      // docId → Kandidaten-Metadaten (für LLM/Link)
    const assignedKontoIds = new Set();

    const ensureContent = async (ids) => {
      const need = ids.filter(id => !contentCache.has(id));
      if (!need.length) return;
      const { data } = await supabase.from("dokumente").select("id, content_text").in("id", need);
      const byId = Object.fromEntries((data || []).map(r => [r.id, r.content_text || ""]));
      need.forEach(id => contentCache.set(id, byId[id] || ""));
    };
    const linkBeleg = async (k, d, reason) => {
      const newBeleg = {
        id: d.id, name: d.name, filename: d.filename, storage_path: d.storage_path,
        year: d.year, category: d.category, file_type: d.file_type, ki: true, ki_match: reason,
      };
      const ap = { ...(k.arbeitspapier || {}), belege: [...((k.arbeitspapier?.belege) || []), newBeleg] };
      const { error } = await supabase.from("abschluss_konten").update({ arbeitspapier: ap }).eq("id", k.id);
      if (!error) { assignedKontoIds.add(k.id); assignedList.push({ konto: `${k.kontonummer} ${k.kontoname}`, doc: d.name, reason }); return true; }
      return false;
    };

    try {
      // ── Phase 1: Kandidaten sammeln + Betrags-Treffer sofort verknüpfen ──
      const pending = []; // { k, cands: [doc…], best }
      for (let i = 0; i < targets.length; i++) {
        const k = targets[i];
        setAiBusy(`Analyse ${i + 1} / ${targets.length} …`);
        const pos = POSITION_MAP[k.position_id];
        const kw = AI_BELEG_KEYWORDS[k.position_id] || [];
        const query = [k.kontoname, ...kw.slice(0, 3)].filter(Boolean).join(" ") || (pos?.label || "");
        if (!query.trim()) continue;
        const { data, error } = await supabase.rpc("search_dokumente", { p_query: query, p_customer_id: selectedCid, p_limit: 8 });
        if (error || !data?.length) continue;
        // Budget/Reporting-Dokumente nie als Beleg-Kandidat: das sind interne
        // Planungsunterlagen, die praktisch jedes Stichwort einmal enthalten
        // (ein Jahresbudget nennt AHV, MWST, Leasing etc. alle in einer Datei) —
        // damit gewinnen sie sonst fast jede Suche, ob per Keyword oder LLM.
        const isPlanning = d => /\b(reporting|budget)\b/i.test(d.name || d.filename || "");
        const blockedCats = AI_BLOCKED_CATEGORIES[k.position_id] ?? AI_BLOCKED_CATEGORIES.default;
        const cands = data
          .filter(d => !selectedYear || d.year === selectedYear || d.year == null)
          .filter(d => !isPlanning(d))
          .filter(d => !blockedCats.includes(d.category))
          .slice(0, 5);
        if (!cands.length) continue;
        cands.forEach(d => docMeta.set(d.id, d));
        await ensureContent(cands.map(d => d.id));

        const terms = [String(k.kontoname || "").toLowerCase(), ...kw.map(s => s.toLowerCase())].filter(Boolean);
        const scored = cands.map(d => {
          const hay = `${d.name || ""} ${d.filename || ""} ${d.headline || ""}`.toLowerCase();
          const kwHits = terms.filter(t => hay.includes(t)).length;
          const yearBonus = (selectedYear && d.year === selectedYear) ? 1 : 0;
          const amtHit = amountAppears(extractAmounts(contentCache.get(d.id) || ""), k.saldo_ist);
          return { d, amtHit, kwHits, score: (d.rank || 0) * 4 + kwHits + yearBonus + (amtHit ? 6 : 0) };
        }).sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (best?.amtHit) { await linkBeleg(k, best.d, "Betrag"); continue; } // sehr zuverlässig
        pending.push({ k, cands, scored });
      }

      // ── Phase 2: LLM-Rerank für die unsicheren Konten ──
      const stillOpen = pending.filter(p => !assignedKontoIds.has(p.k.id));
      let llmAssigned = new Map(); // kontonummer → doc_id
      if (stillOpen.length) {
        setAiBusy("KI wertet aus …");
        const docIds = [...new Set(stillOpen.flatMap(p => p.cands.map(d => d.id)))];
        const documents = docIds.map(id => {
          const d = docMeta.get(id) || {};
          return { id, name: d.name, filename: d.filename, category: d.category, year: d.year, snippet: (contentCache.get(id) || "").slice(0, 500) };
        });
        const positions = stillOpen.map(p => ({
          kontonummer: p.k.kontonummer,
          kontoname: p.k.kontoname,
          position: POSITION_MAP[p.k.position_id]?.label || "",
          saldo: parseFloat(p.k.saldo_ist) || 0,
        }));
        try {
          const { data: llm, error: llmErr } = await supabase.functions.invoke("suggest-abschluss-belege", {
            body: { provider: "auto", positions, documents },
          });
          if (!llmErr && Array.isArray(llm?.assignments)) {
            for (const a of llm.assignments) {
              if (a.doc_id && (a.confidence ?? 0) >= 0.6) llmAssigned.set(String(a.kontonummer), a.doc_id);
            }
          }
        } catch (e) {
          console.warn("[KI-Zuweisung] LLM nicht verfügbar, Fallback auf Heuristik:", e?.message || e);
        }
      }

      // ── Phase 3: nur noch LLM-Treffer verknüpfen ──
      // Der frühere Stichwort-Fallback (Score >= 1.5 aus Volltext-Rank + Keyword-
      // Treffern) hat in der Praxis vor allem breite Dokumente wie ein Jahres-
      // budget gewonnen — die erwähnen fast jedes Stichwort einmal und wurden so
      // hunderten unpassenden Konten zugewiesen. Lieber ein Konto unbelegt lassen
      // als einen falschen Beleg stumm anhängen; ohne Kandidat bleibt es offen
      // und taucht in den Pendenzen auf.
      // Zusätzlich verlangen wir eine eigene Textbestätigung für den von der KI
      // gewählten Beleg (Kontoname/Stichwort-Treffer oder Betrag) — ohne das hat
      // die KI z.B. ein Bankkonto mit einer AHV-Abrechnung verknüpft, weil unter
      // den Kandidaten einfach kein besserer war. Lieber offen als blind vertraut.
      for (const p of stillOpen) {
        const llmDocId = llmAssigned.get(String(p.k.kontonummer));
        if (!llmDocId || !docMeta.has(llmDocId)) continue;
        const corroborated = p.scored.some(s => s.d.id === llmDocId && (s.kwHits > 0 || s.amtHit));
        if (corroborated) await linkBeleg(p.k, docMeta.get(llmDocId), "KI");
      }

      qc.invalidateQueries({ queryKey: ["abschluss_konten", abschlussId] });
      const assigned = assignedList.length;
      if (assigned) {
        toast.success(
          <div style={{ whiteSpace: "pre-line", fontSize: 12, lineHeight: 1.5 }}>
            <strong>KI-Zuweisung: {assigned} von {targets.length} Konten verknüpft</strong>{"\n"}
            {assignedList.slice(0, 12).map(a => `• ${a.konto} → ${a.doc} (${a.reason})`).join("\n")}
            {assignedList.length > 12 ? `\n… und ${assignedList.length - 12} weitere` : ""}
            {"\n"}<span style={{ opacity: 0.7 }}>Bitte prüfen (gelb „KI") und ggf. entfernen.</span>
          </div>,
          { duration: 15000 }
        );
      } else {
        toast.info(`KI-Zuweisung: kein sicherer Treffer bei ${targets.length} Konten. Bitte manuell verknüpfen.`);
      }
    } catch (e) {
      toast.error("KI-Zuweisung fehlgeschlagen: " + (e?.message || e));
    } finally {
      setAiBusy(null);
    }
  }

  const status = abschluss?.status || "in_arbeit";
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.in_arbeit;

  const tabs = [
    { id: "kontenplan",       label: "Kontenplan",         icon: FileSpreadsheet },
    { id: "bilanz",           label: "Bilanz",             icon: BarChart2 },
    { id: "erfolgsrechnung",  label: "Erfolgsrechnung",    icon: TrendingUp },
    { id: "anhang",           label: "Anhang",             icon: FileText },
  ];

  const tabProps = { konten, accent, headingC, subC, panelBg, panelBdr, tableBdr, rowHover, theme, customerId: selectedCid, selectedYear };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ backgroundColor: pageBg }}>
      <style>{`
        @media print {
          body > * { display: none !important; }
          body > div:last-child { display: block !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
        }
      `}</style>

      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 py-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
        <Wrench className="w-4 h-4" style={{ color: accentL }} />
        <button onClick={() => navigate("/ArtisTools")} className="text-sm hover:underline"
          style={{ color: subC, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          Artis Tools
        </button>
        <ChevronRight className="w-3 h-3" style={{ color: subC }} />
        <BookCheck className="w-4 h-4" style={{ color: accent }} />
        <span className="text-sm font-semibold" style={{ color: headingC }}>Abschlussdokumentation</span>
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 py-4" style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
        <div className="flex flex-wrap items-end gap-4">

          {/* Mandant */}
          <div className="flex-1" style={{ minWidth: 260, maxWidth: 380 }}>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
              Mandant
            </label>
            <MandantDropdown
              kunden={sortedKunden}
              selectedCid={selectedCid}
              onChange={setSelectedCid}
              panelBg={panelBg} panelBdr={panelBdr} headingC={headingC} subC={subC} accent={accent}
              withAbschlussSet={withAbschlussSet}
            />
          </div>

          {/* Jahr */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
              Geschäftsjahr
            </label>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              style={{
                height: 36, padding: "0 10px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC,
                outline: "none", cursor: "pointer", minWidth: 90,
              }}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Status Badge + Changer */}
          {abschluss && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
                Status
              </label>
              <div className="flex items-center gap-1.5">
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  backgroundColor: statusCfg.bg, color: statusCfg.text,
                  border: `1px solid ${statusCfg.border}`,
                }}>
                  {status === "abgeschlossen" && <CheckCircle2 className="w-3 h-3" />}
                  {status === "genehmigt" && <CheckCircle2 className="w-3 h-3" />}
                  {status === "in_arbeit" && <AlertCircle className="w-3 h-3" />}
                  {statusCfg.label}
                </span>
                <select
                  value={status}
                  disabled={gesperrt}
                  onChange={e => updateStatusMut.mutate(e.target.value)}
                  style={{
                    height: 30, padding: "0 6px", borderRadius: 6, fontSize: 11,
                    border: `1px solid ${panelBdr}`, backgroundColor: pageBg, color: subC,
                    outline: "none", cursor: gesperrt ? "not-allowed" : "pointer", opacity: gesperrt ? 0.5 : 1,
                  }}>
                  <option value="in_arbeit">In Arbeit</option>
                  <option value="abgeschlossen">Abgeschlossen</option>
                  <option value="genehmigt">Genehmigt</option>
                </select>
              </div>
            </div>
          )}

          {/* Version */}
          {abschluss && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
                Version
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  value={abschluss.version}
                  onChange={e => setSelectedVersion(Number(e.target.value))}
                  style={{
                    height: 36, padding: "0 10px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                    border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC,
                    outline: "none", cursor: "pointer", minWidth: 160,
                  }}>
                  {versions.map(v => (
                    <option key={v.id} value={v.version}>
                      {`V${v.version} · ${(STATUS_CONFIG[v.status] || STATUS_CONFIG.in_arbeit).label}${v.gesperrt ? " 🔒" : ""}`}
                    </option>
                  ))}
                </select>
                <button onClick={() => createVersionMut.mutate()} title="Neue (leere) Version anlegen"
                  style={{ height: 36, width: 36, display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 8, border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: accent, cursor: "pointer" }}>
                  <Plus className="w-4 h-4" />
                </button>
                <button onClick={() => toggleLockMut.mutate()} title={gesperrt ? "Version entsperren" : "Version sperren (schreibgeschützt)"}
                  style={{ height: 36, width: 36, display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 8, border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: gesperrt ? "#c2410c" : subC, cursor: "pointer" }}>
                  {gesperrt ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                </button>
                <button onClick={handleDeleteVersion} disabled={gesperrt} title="Version löschen"
                  style={{ height: 36, width: 36, display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 8, border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: "#b91c1c",
                    opacity: gesperrt ? 0.4 : 1, cursor: gesperrt ? "not-allowed" : "pointer" }}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Buttons */}
          <div className="flex items-end gap-2">
            <button
              disabled={!abschlussId || gesperrt}
              onClick={() => setShowImport(true)}
              title={gesperrt ? "Version ist gesperrt" : "Bilanz/ER importieren"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
              style={{
                backgroundColor: accent + "14", color: accent,
                border: `1px solid ${accent}40`,
                opacity: (abschlussId && !gesperrt) ? 1 : 0.4, cursor: (abschlussId && !gesperrt) ? "pointer" : "not-allowed",
              }}>
              <Upload className="w-3.5 h-3.5" />
              Importieren
            </button>
            <button
              disabled={!abschlussId || gesperrt || konten.length === 0 || !!aiBusy}
              onClick={handleAiAssign}
              title={gesperrt ? "Version ist gesperrt" : "Passende Belege aus der Dateiablage automatisch zuweisen (Inhaltssuche im gewählten Jahr)"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
              style={{
                backgroundColor: "#f5f3ff", color: "#7c3aed",
                border: "1px solid #c4b5fd",
                opacity: (abschlussId && !gesperrt && konten.length && !aiBusy) ? 1 : 0.5,
                cursor: (abschlussId && !gesperrt && konten.length && !aiBusy) ? "pointer" : "not-allowed",
              }}>
              <Sparkles className="w-3.5 h-3.5" />
              {aiBusy ? `KI-Zuweisung ${aiBusy}` : "KI-Zuweisung"}
            </button>
            <button
              disabled={konten.length === 0}
              onClick={() => setShowPendenzen(true)}
              title="Offene Posten der Reihe nach durchgehen: Beleg, Status, Notiz"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
              style={{
                backgroundColor: panelBg, color: headingC,
                border: `1px solid ${panelBdr}`,
                opacity: konten.length > 0 ? 1 : 0.4,
                cursor: konten.length > 0 ? "pointer" : "not-allowed",
              }}>
              📋 Pendenzen
            </button>
            <button
              disabled={konten.length === 0}
              onClick={() => exportKontenCSV(konten, customerName, selectedYear)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
              style={{
                backgroundColor: accent, color: "#ffffff",
                opacity: konten.length > 0 ? 1 : 0.4,
                cursor: konten.length > 0 ? "pointer" : "not-allowed",
              }}>
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>

            {/* Logo */}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
              padding: "4px 10px", borderRadius: 6, cursor: "pointer",
              border: `1px solid ${panelBdr}`, color: headingC, backgroundColor: panelBg }}>
              {einstellungen.logo_url
                ? <img src={einstellungen.logo_url} alt="Logo" style={{ height: 20, objectFit: "contain" }} />
                : <span>🖼 Logo</span>}
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const ext = file.name.split('.').pop();
                  const path = `${selectedCid}/logo.${ext}`;
                  await supabase.storage.from("abschluss-logos").upload(path, file, { upsert: true });
                  const { data } = supabase.storage.from("abschluss-logos").getPublicUrl(path);
                  updateEinstellungenMut.mutate({ logo_url: data.publicUrl });
                }} />
            </label>

            {/* PDF Download */}
            <button onClick={() => setExportDialog("pdf")}
              disabled={konten.length === 0}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
                padding: "4px 10px", borderRadius: 6,
                cursor: konten.length === 0 ? "not-allowed" : "pointer",
                opacity: konten.length === 0 ? 0.5 : 1,
                border: `1px solid ${accent}60`, color: accent, backgroundColor: accent + "15" }}>
              📄 PDF
            </button>

            {/* Revisions-Dossier (ZIP) */}
            <button onClick={() => setExportDialog("dossier")}
              disabled={!!dossierStatus || konten.length === 0}
              title="Komplettes Dossier für den Revisor: PDF (Bilanz, ER, Anhang, Kontenplan mit Notizen) + alle Belege als ZIP"
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700,
                padding: "4px 12px", borderRadius: 6,
                cursor: dossierStatus || konten.length === 0 ? "not-allowed" : "pointer",
                opacity: dossierStatus || konten.length === 0 ? 0.6 : 1,
                border: "none", color: "#ffffff", backgroundColor: accent }}>
              {dossierStatus
                ? <span style={{ fontSize: 11, fontWeight: 600 }}>⏳ {dossierStatus}</span>
                : <span>📦 Revisions-Dossier</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {gesperrt && selectedCid && (
          <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm"
            style={{ backgroundColor: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa" }}>
            <Lock className="w-4 h-4 flex-shrink-0" />
            <span><strong>Version {abschluss?.version} ist gesperrt</strong> – schreibgeschützt. Zum Bearbeiten oben entsperren oder eine neue Version anlegen.</span>
          </div>
        )}
        {abschluss && selectedCid && (
          <div className="mx-6 mt-4">
            <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
              Versions-Kommentar (V{abschluss.version})
            </label>
            <input
              key={abschlussId}
              defaultValue={abschluss.notizen || ""}
              disabled={gesperrt}
              placeholder="Was wurde in dieser Version gemacht / korrigiert?"
              onBlur={e => { const v = e.target.value; if (v !== (abschluss.notizen || "")) updateNotizenMut.mutate(v); }}
              style={{
                width: "100%", height: 36, padding: "0 12px", borderRadius: 8, fontSize: 13,
                border: `1px solid ${panelBdr}`, backgroundColor: gesperrt ? pageBg : panelBg, color: headingC,
                outline: "none", opacity: gesperrt ? 0.6 : 1,
              }}
            />
          </div>
        )}
        {!selectedCid ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <BookCheck className="w-14 h-14 mb-4" style={{ color: isArtis ? "#ccd8cc" : "#d1d5db" }} />
            <div className="text-lg font-semibold mb-2" style={{ color: headingC }}>Mandant auswählen</div>
            <div className="text-sm" style={{ color: subC }}>
              Wählen Sie einen Mandanten und ein Geschäftsjahr aus, um die Abschlussdokumentation anzuzeigen.
            </div>
          </div>
        ) : (
          <>
            {/* ── Tabs ─────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-0 px-6 pt-4 flex-shrink-0 border-b"
              style={{ borderColor: panelBdr, backgroundColor: panelBg }}>
              {tabs.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-colors relative"
                    style={{
                      color: isActive ? accent : subC,
                      background: "none", border: "none", cursor: "pointer",
                      borderBottom: isActive ? `2px solid ${accent}` : "2px solid transparent",
                      marginBottom: -1,
                    }}>
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {id === "kontenplan" && konten.length > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 10,
                        backgroundColor: isActive ? accent : subC + "30",
                        color: isActive ? "#fff" : subC,
                      }}>
                        {konten.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Tab Content ──────────────────────────────────────────────── */}
            <div className="p-6">
              {abschlussLoading || kontenLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin w-6 h-6 rounded-full border-2" style={{ borderColor: accent + "30", borderTopColor: accent }} />
                </div>
              ) : (
                <>
                  {activeTab === "kontenplan" && (
                    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}`, backgroundColor: panelBg, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                      <KontenplanTab {...tabProps} onUpdateKonto={handleUpdateKonto}
                        onAddKonto={gesperrt ? null : handleAddKonto}
                        diffAnpassungen={diffAnpassungen}
                        onSaveDiffAnpassungen={(rows) => updateEinstellungenMut.mutate({ differenz_anpassungen: rows })}
                      />
                    </div>
                  )}
                  {activeTab === "bilanz" && (
                    <BilanzTab {...tabProps}
                      signFlipPassiven={signFlipPassiven}
                      onFlipPassiven={() => updateEinstellungenMut.mutate({ sign_flip_passiven: !signFlipPassiven })}
                    />
                  )}
                  {activeTab === "erfolgsrechnung" && (
                    <ErfolgsrechnungTab {...tabProps}
                      signFlipER={signFlipER}
                      onFlipER={() => updateEinstellungenMut.mutate({ sign_flip_er: !signFlipER })}
                    />
                  )}
                  {activeTab === "anhang" && (
                    <AnhangTab
                      einstellungen={einstellungen}
                      onSaveEinstellungen={(patch) => updateEinstellungenMut.mutate(patch)}
                      accent={accent}
                      headingC={headingC}
                      subC={subC}
                      panelBg={panelBg}
                      panelBdr={panelBdr}
                      selectedYear={selectedYear}
                      customerName={selectedCustomer ? (selectedCustomer.company_name || [selectedCustomer.anrede, selectedCustomer.nachname, selectedCustomer.vorname].filter(Boolean).join(" ")) : ""}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Import Dialog ──────────────────────────────────────────────────── */}
      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImport={handleImport}
          accent={accent}
          theme={theme}
          initialFlipPassiven={signFlipPassiven}
          initialFlipER={signFlipER}
          customerId={selectedCid}
          selectedYear={selectedYear}
        />
      )}

      {/* ── Export Modus Dialog ──────────────────────────────────────────── */}
      {exportDialog && (
        <ExportModeDialog
          target={exportDialog}
          defaultMode={einstellungen.export_mode || "mindest"}
          accent={accent}
          headingC={headingC}
          subC={subC}
          panelBg={panelBg}
          panelBdr={panelBdr}
          onClose={() => setExportDialog(null)}
          onExport={runExport}
        />
      )}

      {/* ── Pendenzen-Review ────────────────────────────────────────────────── */}
      {showPendenzen && (
        <PendenzenReview
          konten={konten}
          onUpdateKonto={handleUpdateKonto}
          accent={accent}
          headingC={headingC}
          subC={subC}
          panelBg={panelBg}
          panelBdr={panelBdr}
          theme={theme}
          onClose={() => setShowPendenzen(false)}
          einstellungen={einstellungen}
          onSaveEinstellungen={(partial) => updateEinstellungenMut.mutate(partial)}
          signFlipPassiven={signFlipPassiven}
        />
      )}
    </div>
  );
}
