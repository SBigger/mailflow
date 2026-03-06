import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { entities } from "@/api/supabaseClient";

export default function PrivatpersonImportDialog({ open, onClose, staff = [], onImported }) {
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
      const records = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i], delimiter);
        const [nachname_raw, vorname_raw, strasse, plz, ort, phone_raw, geburtsdatum_raw, ahv_raw, mandatsleiter_raw, sachbearbeiter_raw, kanton_raw] = cols;

        const nachname = nachname_raw?.trim() || "";
        const vorname  = vorname_raw?.trim() || "";
        if (!nachname && !vorname) continue;

        const ml = mandatsleiter_raw?.trim() || "";
        const sb = sachbearbeiter_raw?.trim() || "";

        let mandatsleiter = staff.find(s => s.name === ml || s.email === ml || s.full_name === ml);
        if (!mandatsleiter && ml) {
          mandatsleiter = await entities.Staff.create({ name: ml });
          staff.push(mandatsleiter);
        }
        let sachbearbeiter = staff.find(s => s.name === sb || s.email === sb || s.full_name === sb);
        if (!sachbearbeiter && sb) {
          sachbearbeiter = await entities.Staff.create({ name: sb });
          staff.push(sachbearbeiter);
        }

        // Parse Geburtsdatum: accept TT.MM.JJJJ or YYYY-MM-DD
        let geburtsdatum = null;
        if (geburtsdatum_raw?.trim()) {
          const g = geburtsdatum_raw.trim();
          if (/^\d{2}\.\d{2}\.\d{4}$/.test(g)) {
            const [d, m, y] = g.split(".");
            geburtsdatum = `${y}-${m}-${d}`;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(g)) {
            geburtsdatum = g;
          }
        }

        records.push({
          person_type:      'privatperson',
          company_name:     `${nachname} ${vorname}`.trim(),
          nachname,
          vorname,
          strasse:          strasse || "",
          plz:              plz || "",
          ort:              ort || "",
          phone:            phone_raw?.trim() || null,
          ahv_nummer:       ahv_raw?.trim() || null,
          geburtsdatum,
          kanton:           kanton_raw?.trim() || null,
          mandatsleiter_id: mandatsleiter?.id || null,
          sachbearbeiter_id: sachbearbeiter?.id || null,
          activities:       [],
          contact_persons:  [],
          tags:             [],
          steuer_zugaenge:  [],
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
    const header = "Nachname;Vorname;Strasse;PLZ;Ort;Telefon;Geburtsdatum;AHV-Nummer;Mandatsleiter;Sachbearbeiter;Kanton";
    const staffEx = staff.length > 0 ? (staff[0].full_name || staff[0].name || staff[0].email) : "Max Muster";
    const example = `Müller;Hans;Hauptstrasse 5;8000;Zürich;+41 71 511 50 00;15.03.1975;756.1234.5678.90;${staffEx};;SG`;
    const blob = new Blob(["\uFEFF" + header + "\n" + example], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "privatpersonen_import_vorlage.csv";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const handleClose = () => {
    setStatus(null);
    setResult(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="bg-white border-gray-200 text-gray-800 max-w-lg">
        <DialogHeader>
          <DialogTitle>Privatpersonen importieren (CSV)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-xs text-gray-500 bg-gray-100 p-3 rounded-lg font-mono space-y-1">
            <div className="text-gray-600 font-semibold mb-1">CSV Spalten (semikolon- oder kommagetrennt, mit Header):</div>
            <div>1. Nachname</div>
            <div>2. Vorname</div>
            <div>3. Strasse</div>
            <div>4. PLZ</div>
            <div>5. Ort</div>
            <div>6. Telefon</div>
            <div>7. Geburtsdatum (TT.MM.JJJJ)</div>
            <div>8. AHV-Nummer (756.XXXX.XXXX.XX)</div>
            <div>9. Mandatsleiter (Name oder E-Mail)</div>
            <div>10. Sachbearbeiter (Name oder E-Mail)</div>
            <div>11. Kanton (z.B. ZH, SG, BE)</div>
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
              Importiere Privatpersonen...
            </div>
          )}

          {status === "done" && (
            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-sm text-green-600">{result.created} von {result.total} Personen importiert.</span>
            </div>
          )}

          {status === "error" && (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-500">{result.error}</span>
            </div>
          )}

          <Button variant="ghost" onClick={handleClose} className="w-full text-gray-500">
            Schließen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
