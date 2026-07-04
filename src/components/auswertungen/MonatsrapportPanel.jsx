// Auswertungen · Monatsrapport pro Mitarbeiter
// Nachbau des Abacus-Rapports "211-Standard": Matrix Projekte × Kalendertage
// mit Ist/Soll/Differenz pro Tag, darunter Kennzahlen (Über-/Unterzeit,
// Produktivität, bewerteter Umsatz). PDF-Export einzeln oder alle MA.
import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { FileDown, Files } from 'lucide-react';
import {
  leTimeEntry, leEmployee, leSollzeitProfile, leSollzeitTemplate, leHoliday, leAbsence, leCompany,
} from '@/lib/leApi';
import {
  Card, Select, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisGhostStyle, artisPrimaryStyle,
} from '@/components/leistungserfassung/shared';
import MonthPicker from './MonthPicker';
import {
  CAT, categoryOf, entryHours, entryValue, monthRange, MONTHS,
  WEEKDAYS_SHORT, sollForDay, calcSollHours, toHolidaySet, toIso, fmtDayHours,
} from './util';

// ---------------------------------------------------------------------------
// Aufbereitung: Matrix + Kennzahlen für EINEN Mitarbeiter
// ---------------------------------------------------------------------------

// Abwesenheits-Stunden im Monat: pro überlappendem Tag die Soll-Stunden des
// Profils (Halbtags-Flags halbieren Start-/Endtag). Liegt die Abwesenheit
// komplett im Monat und hat hours_total, gilt der erfasste Wert.
function absenceHoursInMonth(absences, templates, profiles, holidaySet, rangeFrom, rangeTo) {
  let total = 0;
  for (const a of absences) {
    if (a.status === 'abgelehnt') continue;
    const from = a.date_from < rangeFrom ? rangeFrom : a.date_from;
    const to = a.date_to > rangeTo ? rangeTo : a.date_to;
    if (from > to) continue;
    if (a.date_from >= rangeFrom && a.date_to <= rangeTo && a.hours_total != null) {
      total += Number(a.hours_total);
      continue;
    }
    const d = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    while (d <= end) {
      const iso = toIso(d);
      let h = sollForDay(templates, profiles, holidaySet, iso);
      if (iso === a.date_from && a.half_day_from) h /= 2;
      if (iso === a.date_to && a.half_day_to) h /= 2;
      total += h;
      d.setDate(d.getDate() + 1);
    }
  }
  return total;
}

// Baut Matrix + Kennzahlen für einen MA aus den Monats-Einträgen.
function buildReport({ emp, entries, templates, profiles, holidaySet, absences, year, month0 }) {
  const range = monthRange(year, month0);
  const days = range.days;

  const byProject = new Map();
  const dayTotals = Array(days).fill(0);
  let ist = 0;
  let internH = 0;
  let umsatzEff = 0;
  let umsatzPausch = 0;

  for (const e of entries) {
    if (e.employee_id !== emp.id || e.status === 'storniert') continue;
    const day = Number(e.entry_date.slice(8, 10)) - 1;
    if (day < 0 || day >= days) continue;
    const pid = e.project_id ?? 'none';
    if (!byProject.has(pid)) {
      byProject.set(pid, {
        no: e.project?.project_no || '',
        name: e.project?.name || '(ohne Projekt)',
        cat: categoryOf(e),
        days: Array(days).fill(0),
        total: 0,
      });
    }
    const row = byProject.get(pid);
    const h = entryHours(e);
    row.days[day] += h;
    row.total += h;
    dayTotals[day] += h;
    ist += h;
    const cat = categoryOf(e);
    if (cat === 'intern') internH += h;
    if (cat === 'effektiv') umsatzEff += entryValue(e);
    if (cat === 'pauschal') umsatzPausch += entryValue(e);
  }

  const projects = [...byProject.values()].sort((a, b) =>
    (a.no || '').localeCompare(b.no || '') || a.name.localeCompare(b.name));

  // Soll pro Tag + Total
  const sollDays = [];
  for (let i = 0; i < days; i++) {
    sollDays.push(sollForDay(templates, profiles, holidaySet, toIso(new Date(year, month0, i + 1))));
  }
  const soll = calcSollHours(templates, profiles, holidaySet, range.fromIso, range.toIso);
  const abs = absenceHoursInMonth(absences, templates, profiles, holidaySet, range.fromIso, range.toIso);

  const sollPraesenz = soll - abs;
  const ueberzeit = ist - sollPraesenz;
  const auftrag = ist - internH;
  const produktivitaet = ist > 0 ? (auftrag / ist) * 100 : 0;

  return {
    emp, days, projects, dayTotals, sollDays, ist, soll, abs,
    sollPraesenz, ueberzeit, internH, auftrag, produktivitaet,
    umsatzEff, umsatzPausch, umsatzTotal: umsatzEff + umsatzPausch,
    range,
  };
}

// ---------------------------------------------------------------------------
// PDF-Export (jspdf + autotable, quer A4, eine Seite pro MA)
// ---------------------------------------------------------------------------

async function exportPdf(reports, { year, month0, companyName }) {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const title = `Monatsrapport ${MONTHS[month0]} ${year}`;

  reports.forEach((rep, idx) => {
    if (idx > 0) doc.addPage();
    const days = rep.days;

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(`${companyName || 'Smartis'} · ${title}`, 10, 10);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.text(`${rep.emp.full_name}${rep.emp.short_code ? ` (${rep.emp.short_code})` : ''}`, 10, 15.5);

    const head = [['Projekt', ...Array.from({ length: days }, (_, i) => {
      const wd = WEEKDAYS_SHORT[new Date(year, month0, i + 1).getDay()];
      return `${i + 1}\n${wd}`;
    }), 'Total']];

    const body = rep.projects.map(p => [
      `${p.no ? p.no + ' ' : ''}${p.name}`,
      ...p.days.map(fmtDayHours),
      p.total.toFixed(2),
    ]);
    body.push(['Total Ist-Stunden', ...rep.dayTotals.map(fmtDayHours), rep.ist.toFixed(2)]);
    body.push(['Sollstunden', ...rep.sollDays.map(fmtDayHours), rep.soll.toFixed(2)]);
    body.push(['Differenz', ...rep.dayTotals.map((h, i) => {
      const diff = h - rep.sollDays[i];
      return diff === 0 ? '' : diff.toFixed(2);
    }), (rep.ist - rep.soll).toFixed(2)]);

    const summaryStartRow = rep.projects.length;
    autoTable(doc, {
      head,
      body,
      startY: 19,
      margin: { left: 10, right: 10 },
      theme: 'grid',
      styles: { fontSize: 5.6, cellPadding: 0.6, halign: 'right', valign: 'middle', lineColor: [220, 226, 220], lineWidth: 0.1, textColor: [45, 58, 45] },
      headStyles: { fillColor: [122, 155, 127], textColor: 255, fontSize: 5.2, halign: 'center' },
      columnStyles: {
        0: { halign: 'left', cellWidth: 52 },
        [days + 1]: { fontStyle: 'bold', cellWidth: 11 },
      },
      didParseCell: (data) => {
        // Wochenenden hinterlegen, Summenzeilen fett
        if (data.section === 'body' && data.column.index > 0 && data.column.index <= days) {
          const wd = new Date(year, month0, data.column.index).getDay();
          if (wd === 0 || wd === 6) data.cell.styles.fillColor = [238, 241, 238];
        }
        if (data.section === 'body' && data.row.index >= summaryStartRow) {
          data.cell.styles.fontStyle = 'bold';
          if (data.row.index === summaryStartRow) data.cell.styles.fillColor = [230, 237, 230];
        }
      },
    });

    // Kennzahlen-Block unterhalb der Matrix
    const y = (doc.lastAutoTable?.finalY ?? 100) + 4;
    autoTable(doc, {
      startY: y,
      margin: { left: 10, right: 10 },
      theme: 'plain',
      styles: { fontSize: 7, cellPadding: 0.7, textColor: [45, 58, 45] },
      body: [
        [
          'SOLL-Zeit:', rep.soll.toFixed(2),
          'IST-Zeit:', rep.ist.toFixed(2),
          'Auftragsbezogene Std:', rep.auftrag.toFixed(2),
          'Umsatz effektiv CHF:', fmt.chf(rep.umsatzEff),
        ],
        [
          './. Abwesenheiten:', rep.abs.toFixed(2),
          'Über-/Unterzeit:', rep.ueberzeit.toFixed(2),
          'Interne Std:', rep.internH.toFixed(2),
          'Umsatz pauschal CHF:', fmt.chf(rep.umsatzPausch),
        ],
        [
          '= SOLL-Präsenz-Zeit:', rep.sollPraesenz.toFixed(2),
          '', '',
          'Produktivität %:', rep.produktivitaet.toFixed(1),
          'Umsatz total CHF:', fmt.chf(rep.umsatzTotal),
        ],
      ],
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 34 }, 1: { halign: 'right', cellWidth: 20 },
        2: { fontStyle: 'bold', cellWidth: 30 }, 3: { halign: 'right', cellWidth: 20 },
        4: { fontStyle: 'bold', cellWidth: 40 }, 5: { halign: 'right', cellWidth: 20 },
        6: { fontStyle: 'bold', cellWidth: 42 }, 7: { halign: 'right', cellWidth: 26 },
      },
    });

    doc.setFontSize(6.5);
    doc.setTextColor(140);
    doc.text(`Erstellt am ${new Date().toLocaleDateString('de-CH')} · Seite ${idx + 1}/${reports.length}`, 10, 202);
    doc.setTextColor(0);
  });

  const mm = String(month0 + 1).padStart(2, '0');
  doc.save(`monatsrapport_${year}-${mm}.pdf`);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function MonatsrapportPanel() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month0, setMonth0] = useState(today.getMonth());
  const [employeeId, setEmployeeId] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const range = useMemo(() => monthRange(year, month0), [year, month0]);

  const employeesQ = useQuery({ queryKey: ['le', 'employees'], queryFn: leEmployee.list, staleTime: 5 * 60_000 });
  const entriesQ = useQuery({
    queryKey: ['ausw', 'rapport', 'entries', range.fromIso],
    queryFn: () => leTimeEntry.listForRangeAll(range.fromIso, range.toIso, {}),
    staleTime: 60_000,
  });
  const absencesQ = useQuery({ queryKey: ['le', 'absences', 'all'], queryFn: () => leAbsence.list({}), staleTime: 5 * 60_000 });
  const companyQ = useQuery({ queryKey: ['le', 'company'], queryFn: leCompany.get, staleTime: 30 * 60_000 });
  const templatesQ = useQuery({ queryKey: ['le', 'sollzeit-template'], queryFn: leSollzeitTemplate.list, staleTime: 10 * 60_000 });
  const holidaysQ = useQuery({
    queryKey: ['le', 'holiday', year],
    queryFn: () => leHoliday.list({ from: `${year}-01-01`, to: `${year}-12-31` }),
    staleTime: 10 * 60_000,
  });
  const holidaySet = useMemo(() => toHolidaySet(holidaysQ.data), [holidaysQ.data]);

  const employees = useMemo(
    () => (employeesQ.data ?? []).filter(e => e.active),
    [employeesQ.data],
  );
  const profileQueries = useQueries({
    queries: employees.map(emp => ({
      queryKey: ['le', 'sollzeit', emp.id],
      queryFn: () => leSollzeitProfile.listForEmployee(emp.id),
      staleTime: 5 * 60_000,
    })),
  });
  const profilesById = useMemo(() => {
    const map = new Map();
    employees.forEach((emp, idx) => map.set(emp.id, profileQueries[idx]?.data ?? []));
    return map;
  }, [employees, profileQueries]);

  // Default: erster aktiver MA
  const selectedId = employeeId || employees[0]?.id || '';
  const selectedEmp = employees.find(e => e.id === selectedId);

  const absencesFor = (empId) => (absencesQ.data ?? []).filter(a => a.employee_id === empId);

  const report = useMemo(() => {
    if (!selectedEmp || !entriesQ.data) return null;
    return buildReport({
      emp: selectedEmp,
      entries: entriesQ.data,
      templates: templatesQ.data || [],
      profiles: profilesById.get(selectedEmp.id) || [],
      holidaySet,
      absences: absencesFor(selectedEmp.id),
      year, month0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmp, entriesQ.data, absencesQ.data, profilesById, templatesQ.data, holidaySet, year, month0]);

  const handlePdf = async (all) => {
    if (!entriesQ.data) return;
    setPdfBusy(true);
    try {
      const list = all ? employees : (selectedEmp ? [selectedEmp] : []);
      const reports = list
        .map(emp => buildReport({
          emp,
          entries: entriesQ.data,
          templates: templatesQ.data || [],
          profiles: profilesById.get(emp.id) || [],
          holidaySet,
          absences: absencesFor(emp.id),
          year, month0,
        }))
        // "Alle": MA ohne Stunden UND ohne Soll weglassen (leere Seiten vermeiden)
        .filter(rep => !all || rep.ist > 0 || rep.soll > 0);
      await exportPdf(reports, { year, month0, companyName: companyQ.data?.company_name });
    } finally {
      setPdfBusy(false);
    }
  };

  const isLoading = employeesQ.isLoading || entriesQ.isLoading || absencesQ.isLoading || templatesQ.isLoading || holidaysQ.isLoading;
  const error = employeesQ.error || entriesQ.error || absencesQ.error || templatesQ.error || holidaysQ.error;

  return (
    <div>
      <PanelHeader
        title="Monatsrapport"
        subtitle="Rapportierte Stunden pro Projekt und Kalendertag – wie der Abacus-Rapport 211."
        right={(
          <>
            <button type="button" onClick={() => handlePdf(false)} disabled={pdfBusy || !report}
              className={artisBtn.ghost} style={artisGhostStyle}>
              <FileDown className="w-3.5 h-3.5" /> PDF
            </button>
            <button type="button" onClick={() => handlePdf(true)} disabled={pdfBusy || !entriesQ.data}
              className={`${artisBtn.primary}`} style={artisPrimaryStyle}>
              <Files className="w-3.5 h-3.5" /> PDF alle Mitarbeiter
            </button>
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg border" style={{ borderColor: '#e4e7e4', background: '#fafaf8' }}>
        <MonthPicker year={year} month0={month0} onChange={(y, m) => { setYear(y); setMonth0(m); }} />
        <div style={{ width: 240 }}>
          <Select value={selectedId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </Select>
        </div>
      </div>

      {error && <PanelError error={error} onRetry={() => { employeesQ.refetch(); entriesQ.refetch(); absencesQ.refetch(); templatesQ.refetch(); holidaysQ.refetch(); }} />}
      {!error && isLoading && <PanelLoader />}

      {!error && !isLoading && report && (
        <div className="space-y-4">
          {/* Matrix Projekte × Tage */}
          <Card>
            <div className="overflow-x-auto">
              <table className="text-xs" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                    <th className="px-2 py-1.5 text-left font-semibold sticky left-0 bg-white" style={{ minWidth: 200 }}>Projekt</th>
                    {Array.from({ length: report.days }, (_, i) => {
                      const wd = new Date(year, month0, i + 1).getDay();
                      const weekend = wd === 0 || wd === 6;
                      return (
                        <th key={i} className="px-1 py-1.5 text-center font-semibold" style={{ minWidth: 30, background: weekend ? '#f2f5f2' : undefined }}>
                          <div>{i + 1}</div>
                          <div className="text-[8px] font-normal">{WEEKDAYS_SHORT[wd]}</div>
                        </th>
                      );
                    })}
                    <th className="px-2 py-1.5 text-right font-semibold" style={{ minWidth: 48 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.projects.length === 0 && (
                    <tr><td colSpan={report.days + 2} className="px-3 py-4 text-zinc-400">Keine Rapporte in diesem Monat.</td></tr>
                  )}
                  {report.projects.map((p, i) => (
                    <tr key={i} className="border-b" style={{ borderColor: '#f0f0ec' }}>
                      <td className="px-2 py-1 sticky left-0 bg-white whitespace-nowrap">
                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: CAT[p.cat]?.color }} title={CAT[p.cat]?.label} />
                        {p.no && <span className="text-zinc-400 mr-1">{p.no}</span>}
                        {p.name}
                      </td>
                      {p.days.map((h, d) => {
                        const wd = new Date(year, month0, d + 1).getDay();
                        const weekend = wd === 0 || wd === 6;
                        return (
                          <td key={d} className="px-1 py-1 text-center tabular-nums" style={{ background: weekend ? '#f7faf7' : undefined }}>
                            {fmtDayHours(h)}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmt.hours(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold" style={{ borderColor: '#d9e0d9', background: '#e6ede6' }}>
                    <td className="px-2 py-1 sticky left-0" style={{ background: '#e6ede6' }}>Total Ist-Stunden</td>
                    {report.dayTotals.map((h, d) => (
                      <td key={d} className="px-1 py-1 text-center tabular-nums">{fmtDayHours(h)}</td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums">{fmt.hours(report.ist)}</td>
                  </tr>
                  <tr className="text-zinc-500" style={{ background: '#fafaf8' }}>
                    <td className="px-2 py-1 sticky left-0" style={{ background: '#fafaf8' }}>Sollstunden</td>
                    {report.sollDays.map((h, d) => (
                      <td key={d} className="px-1 py-1 text-center tabular-nums">{fmtDayHours(h)}</td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums">{fmt.hours(report.soll)}</td>
                  </tr>
                  <tr style={{ background: '#fafaf8' }}>
                    <td className="px-2 py-1 sticky left-0 text-zinc-500" style={{ background: '#fafaf8' }}>Differenz</td>
                    {report.dayTotals.map((h, d) => {
                      const diff = h - report.sollDays[d];
                      return (
                        <td key={d} className="px-1 py-1 text-center tabular-nums" style={{ color: diff < 0 ? '#c34141' : diff > 0 ? '#2d5a2d' : '#a0aca0' }}>
                          {diff === 0 ? '' : fmtDayHours(Math.round(diff * 100) / 100) || diff.toFixed(2)}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-right tabular-nums font-semibold" style={{ color: report.ist - report.soll < 0 ? '#c34141' : '#2d5a2d' }}>
                      {fmt.hours(report.ist - report.soll)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Kennzahlen */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Stunden Berichtsmonat</div>
              {[
                ['SOLL-Zeit', fmt.hours(report.soll)],
                ['./. Abwesenheiten', fmt.hours(report.abs)],
                ['= SOLL-Präsenz-Zeit', fmt.hours(report.sollPraesenz)],
                ['IST-Zeit', fmt.hours(report.ist)],
                ['Über-/Unterzeit', fmt.hours(report.ueberzeit)],
              ].map(([k, v], i) => (
                <div key={k} className={`flex justify-between text-sm py-0.5 ${i === 4 ? 'font-semibold border-t mt-1 pt-1' : ''}`} style={i === 4 ? { borderColor: '#e4e7e4', color: report.ueberzeit < 0 ? '#c34141' : '#2d5a2d' } : undefined}>
                  <span className="text-zinc-600">{k}</span>
                  <span className="tabular-nums">{v}</span>
                </div>
              ))}
            </Card>
            <Card className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Produktivität</div>
              {[
                ['Auftragsbezogene Std', fmt.hours(report.auftrag)],
                ['Interne Std', fmt.hours(report.internH)],
                ['Produktivität', `${report.produktivitaet.toFixed(1)} %`],
              ].map(([k, v], i) => (
                <div key={k} className={`flex justify-between text-sm py-0.5 ${i === 2 ? 'font-semibold border-t mt-1 pt-1' : ''}`} style={i === 2 ? { borderColor: '#e4e7e4' } : undefined}>
                  <span className="text-zinc-600">{k}</span>
                  <span className="tabular-nums">{v}</span>
                </div>
              ))}
            </Card>
            <Card className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Bewerteter Umsatz (CHF)</div>
              {[
                ['Effektiv-Projekte', fmt.chf(report.umsatzEff)],
                ['Pauschalprojekte', fmt.chf(report.umsatzPausch)],
                ['Total', fmt.chf(report.umsatzTotal)],
              ].map(([k, v], i) => (
                <div key={k} className={`flex justify-between text-sm py-0.5 ${i === 2 ? 'font-semibold border-t mt-1 pt-1' : ''}`} style={i === 2 ? { borderColor: '#e4e7e4' } : undefined}>
                  <span className="text-zinc-600">{k}</span>
                  <span className="tabular-nums">{v}</span>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
