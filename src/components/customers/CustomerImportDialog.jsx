import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { entities, functions, auth } from "@/api/supabaseClient";

export default function CustomerImportDialog({ open, onClose, staff = [], activityTemplates = [], onImported }) {
  const [status, setStatus] = useState(null); // null | 'loading' | 'done' | 'error'
  const [result, setResult] = useState(null);

  const parseCsvLine = (line, delimiter) => {
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current.trim());
    return cols;
  };

  const detectDelimiter = (firstLine) => {
    const commas = (firstLine.match(/,/g) || []).length;
    const semicolons = (firstLine.match(/;/g) || []).length;
    return semicolons > commas ? ';' : ',';
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("loading");
    try {
      const text = await file.text();
      const lines = text.replace(/^\uFEFF/, '').split("\n").filter(l => l.trim());
      if (lines.length < 2) throw new Error("Datei enthält keine Daten");

      const delimiter = detectDelimiter(lines[0]);

      // First line = header
      const headers = parseCsvLine(lines[0], delimiter);
      const fixedCount = 8; // Firmenname,Strasse,PLZ,Ort,Telefon,Budget,Mandatsleiter,Sachbearbeiter
      const activityNames = headers.slice(fixedCount);

      const records = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i], delimiter);
        const [company_name, strasse, plz, ort, phone_raw, budget_raw, mandatsleiter_raw, sachbearbeiter_raw] = cols;

        if (!company_name) continue;

        const ml = mandatsleiter_raw?.trim() || "";
        const sb = sachbearbeiter_raw?.trim() || "";
        // Match by name, or create new staff on-the-fly if not found
        let mandatsleiter = staff.find(s => s.name === ml || s.email === ml);
        if (!mandatsleiter && ml) {
          mandatsleiter = await entities.Staff.create({ name: ml });
          staff.push(mandatsleiter);
        }
        let sachbearbeiter = staff.find(s => s.name === sb || s.email === sb);
        if (!sachbearbeiter && sb) {
          sachbearbeiter = await entities.Staff.create({ name: sb });
          staff.push(sachbearbeiter);
        }

        // Each activity gets its own column with 1/0
        const activities = activityNames.map((name, idx) => ({
          name,
          completed: cols[fixedCount + idx] === "1",
          order: idx
        })).filter(a => a.name);

        records.push({
          company_name,
          strasse: strasse || "",
          plz: plz || "",
          ort: ort || "",
          phone: phone_raw?.trim() || null,
          budget: budget_raw ? parseFloat(budget_raw.replace(/[^0-9.,]/g, '').replace(',', '.')) || null : null,
          mandatsleiter_id: mandatsleiter?.id || null,
          sachbearbeiter_id: sachbearbeiter?.id || null,
          activities,
          contact_persons: [],
          tags: []
        });
      }

      let created = 0;
      for (const r of records) {
        await entities.Customer.create(r);
        created++;
      }

      setResult({ created, total: records.length });
      setStatus("done");
      onImported();
    } catch (err) {
      setResult({ error: err.message });
      setStatus("error");
    }
  };

  const downloadTemplate = () => {
    const actNames = activityTemplates.map(t => t.name);
    const staffExample = staff.length > 0 ? staff[0].name : "Max Muster";
    const header = ["Firmenname", "Strasse", "PLZ", "Ort", "Telefon", "Budget", "Mandatsleiter", "Sachbearbeiter", ...actNames].join(";");
    const actExample = actNames.map(() => "0").join(";");
    const example = `Musterfirma AG;Hauptstrasse 1;8000;Zürich;+41 71 511 50 00;50000;${staffExample};${staffExample};${actExample}`;
    const blob = new Blob(["\uFEFF" + header + "\n" + example], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kunden_import_vorlage.csv";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setStatus(null); setResult(null); onClose(); } }}>
      <DialogContent className="bg-white border-gray-200 text-gray-800 max-w-lg">
        <DialogHeader>
          <DialogTitle>Kunden importieren (CSV)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-xs text-gray-500 bg-gray-100 p-3 rounded-lg font-mono space-y-1">
            <div className="text-gray-600 font-semibold mb-1">CSV Spalten (semikolon- oder kommagetrennt, mit Header):</div>
            <div>1. Firmenname</div>
            <div>2. Strasse</div>
            <div>3. PLZ</div>
            <div>4. Ort</div>
            <div>5. Telefon</div>
            <div>6. Budget (Zahl)</div>
            <div>7. Mandatsleiter (Name oder E-Mail)</div>
            <div>8. Sachbearbeiter (Name oder E-Mail)</div>
            <div className="text-violet-400">9+. Eine Spalte pro Tätigkeit (1 = erledigt, 0 = offen)</div>
          </div>

          <Button variant="outline" size="sm" onClick={downloadTemplate} className="w-full border-gray-300 text-gray-700 hover:text-gray-900 gap-2">
            <Download className="h-4 w-4" /> CSV-Vorlage herunterladen
          </Button>

          {status === null && (
            <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 cursor-pointer transition-colors">
              <Upload className="h-8 w-8 text-gray-400" />
              <span className="text-sm text-gray-500">CSV-Datei auswählen und importieren</span>
              <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
            </label>
          )}

          {status === "loading" && (
            <div className="text-center py-6 text-gray-500 text-sm">
              <div className="h-6 w-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-2" />
              Importiere Kunden...
            </div>
          )}

          {status === "done" && (
            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-sm text-green-400">{result.created} von {result.total} Kunden importiert.</span>
            </div>
          )}

          {status === "error" && (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-400">{result.error}</span>
            </div>
          )}

          <Button variant="ghost" onClick={() => { setStatus(null); setResult(null); onClose(); }} className="w-full text-gray-500">
            Schließen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}