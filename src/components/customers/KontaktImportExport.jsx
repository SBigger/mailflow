import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Download, CheckCircle2, AlertCircle, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { entities } from "@/api/supabaseClient";
import { toast } from "sonner";

// Kontaktpersonen-Import/-Export (Excel/CSV).
// Export: flache Liste je Kontaktperson (UID/Firma als Zuordnung).
// Import: matcht das Unternehmen per UID, sonst Firmenname, und MERGT die
// Kontaktpersonen (gleicher Vor-+Nachname -> aktualisieren, sonst anhaengen).
// Es werden KEINE neuen Firmen angelegt.

const COLS = ["UID", "Firma", "Anrede", "Vorname", "Name", "Funktion", "Telefon", "Telefon2", "E-Mail"];

function buildRows(customers, onlyId) {
  const out = [];
  for (const c of customers || []) {
    if (onlyId && c.id !== onlyId) continue;
    const cps = Array.isArray(c.contact_persons) ? c.contact_persons : [];
    for (const cp of cps) {
      out.push({
        UID: c.portal_uid || "",
        Firma: c.company_name || "",
        Anrede: cp.anrede || "",
        Vorname: cp.vorname || "",
        Name: cp.name || "",
        Funktion: cp.funktion || cp.rolle || "",
        Telefon: cp.phone || "",
        Telefon2: cp.phone2 || "",
        "E-Mail": cp.email || "",
      });
    }
  }
  return out;
}

export default function KontaktImportExport({ open, onClose, customers = [], scopeCustomer = null, onImported }) {
  const [onlyScope, setOnlyScope] = useState(false);
  const [status, setStatus] = useState(null); // null | 'loading' | 'done' | 'error'
  const [report, setReport] = useState(null);

  const handleExport = () => {
    const rows = buildRows(customers, onlyScope && scopeCustomer ? scopeCustomer.id : null);
    if (!rows.length) { toast.error("Keine Kontaktpersonen zum Exportieren."); return; }
    const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Kontaktpersonen");
    const base = (onlyScope && scopeCustomer)
      ? `kontakte_${(scopeCustomer.company_name || "firma").replace(/[^a-zA-Z0-9]/g, "_")}`
      : "kontaktpersonen_export";
    XLSX.writeFile(wb, `${base}.xlsx`);
  };

  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const normUid = (s) => String(s ?? "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("loading"); setReport(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!rows.length) { toast.error("Keine Zeilen gefunden."); setStatus(null); return; }

      const pick = (r, keys) => { for (const k of Object.keys(r)) { if (keys.includes(norm(k))) return r[k]; } return ""; };
      const getUID  = (r) => pick(r, ["uid"]);
      const getFirma= (r) => pick(r, ["firma", "firmenname", "unternehmen", "company", "company_name"]);
      const getAnr  = (r) => pick(r, ["anrede"]);
      const getVor  = (r) => pick(r, ["vorname"]);
      const getName = (r) => pick(r, ["name", "nachname"]);
      const getFunk = (r) => pick(r, ["funktion", "rolle", "position"]);
      const getTel  = (r) => pick(r, ["telefon", "phone", "tel", "telefon1"]);
      const getTel2 = (r) => pick(r, ["telefon2", "phone2", "tel2", "mobile", "mobil"]);
      const getMail = (r) => pick(r, ["e-mail", "email", "mail", "e_mail"]);

      const byUid = new Map(), byName = new Map();
      for (const c of customers) {
        if (c.portal_uid)   byUid.set(normUid(c.portal_uid), c);
        if (c.company_name) byName.set(norm(c.company_name), c);
      }

      const groups = new Map(); // customerId -> { customer, rows:[] }
      const unmatched = [];
      for (const r of rows) {
        const uid = getUID(r), firma = getFirma(r);
        const c = (uid && byUid.get(normUid(uid))) || (firma && byName.get(norm(firma))) || null;
        if (!c) { unmatched.push(String(firma || uid || "(leer)")); continue; }
        if (!groups.has(c.id)) groups.set(c.id, { customer: c, rows: [] });
        groups.get(c.id).rows.push(r);
      }

      let companiesUpdated = 0, added = 0, updated = 0;
      for (const { customer, rows: grows } of groups.values()) {
        const cps = Array.isArray(customer.contact_persons) ? [...customer.contact_persons] : [];
        for (const r of grows) {
          const cp = {
            anrede:  getAnr(r)  || "",
            vorname: getVor(r)  || "",
            name:    getName(r) || "",
            funktion:getFunk(r) || "",
            phone:   String(getTel(r)  || ""),
            phone2:  String(getTel2(r) || ""),
            email:   getMail(r) || "",
          };
          if (!cp.vorname && !cp.name && !cp.phone && !cp.email) continue; // leere Zeile
          const idx = (cp.vorname || cp.name)
            ? cps.findIndex(x => norm(x.vorname) === norm(cp.vorname) && norm(x.name) === norm(cp.name))
            : -1;
          if (idx >= 0) { cps[idx] = { ...cps[idx], ...cp }; updated++; }
          else { cps.push(cp); added++; }
        }
        await entities.Customer.update(customer.id, { contact_persons: cps });
        companiesUpdated++;
      }

      setReport({ companiesUpdated, added, updated, unmatched });
      setStatus("done");
      onImported?.();
    } catch (err) {
      setReport({ error: err.message }); setStatus("error");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setStatus(null); setReport(null); onClose(); } }}>
      <DialogContent className="bg-white border-gray-200 text-gray-800 max-w-lg">
        <DialogHeader><DialogTitle>Kontaktpersonen Import / Export</DialogTitle></DialogHeader>
        <div className="space-y-4">

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="text-sm font-medium flex items-center gap-2"><Download className="h-4 w-4" /> Export (Excel)</div>
            {scopeCustomer && (
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={onlyScope} onChange={e => setOnlyScope(e.target.checked)} />
                Nur „{scopeCustomer.company_name || "ausgewähltes Unternehmen"}"
              </label>
            )}
            <Button variant="outline" size="sm" className="w-full gap-2 border-gray-300" onClick={handleExport}>
              <FileSpreadsheet className="h-4 w-4" /> Kontaktpersonen exportieren
            </Button>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="text-sm font-medium flex items-center gap-2"><Upload className="h-4 w-4" /> Import (Excel/CSV)</div>
            <div className="text-xs text-gray-500">
              Spalten: UID, Firma, Anrede, Vorname, Name, Funktion, Telefon, Telefon2, E-Mail.
              Zuordnung per <b>UID</b>, sonst <b>Firma</b>. Gleicher Vor-+Nachname wird aktualisiert, sonst angehängt. Es werden keine neuen Firmen angelegt.
            </div>
            {status !== "loading" && (
              <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 cursor-pointer transition-colors">
                <Upload className="h-6 w-6 text-gray-400" />
                <span className="text-sm text-gray-500">Excel/CSV auswählen</span>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
              </label>
            )}
            {status === "loading" && <div className="text-center py-4 text-gray-500 text-sm">Importiere…</div>}
            {status === "done" && report && (
              <div className="text-sm bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">
                <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Import abgeschlossen</div>
                <div className="mt-1 text-xs">{report.companiesUpdated} Firmen · {report.added} neu · {report.updated} aktualisiert{report.unmatched?.length ? ` · ${report.unmatched.length} nicht zugeordnet` : ""}</div>
                {report.unmatched?.length > 0 && (
                  <div className="mt-1 text-xs text-amber-700">Nicht gefunden: {report.unmatched.slice(0, 10).join(", ")}{report.unmatched.length > 10 ? " …" : ""}</div>
                )}
              </div>
            )}
            {status === "error" && report?.error && (
              <div className="text-sm bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {report.error}</div>
            )}
          </div>

          <Button variant="ghost" className="w-full text-gray-500" onClick={() => { setStatus(null); setReport(null); onClose(); }}>Schließen</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
