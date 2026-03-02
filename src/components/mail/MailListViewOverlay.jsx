import React, { useState, useRef } from "react";
import { X, ArrowLeft, CheckCircle2, Mail, Clock, Tag, GripVertical, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { de } from "date-fns/locale";

const DEFAULT_COLUMNS = [
  { key: "subject", label: "Betreff" },
  { key: "sender_name", label: "Absender" },
  { key: "received_date", label: "Datum" },
  { key: "priority", label: "Priorität" },
  { key: "tags", label: "Tags" },
  { key: "body_preview", label: "Vorschau" },
];

const STORAGE_KEY = "maillistview-col-order";

function loadColOrder() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_COLUMNS.map(c => c.key);
}

function saveColOrder(order) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {}
}

const PRIORITY_CONFIG = {
  high: { label: "Hoch", color: "#ef4444" },
  normal: { label: "Normal", color: "#6b7280" },
  low: { label: "Niedrig", color: "#3b82f6" },
};

function renderCell(key, mail) {
  switch (key) {
    case "subject":
      return (
        <div className="flex items-center gap-2">
          {!mail.is_read && <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 flex-shrink-0" />}
          <span className={`text-sm ${mail.is_read ? "text-zinc-400" : "text-zinc-100 font-medium"} truncate max-w-[300px]`}>
            {mail.subject}
          </span>
        </div>
      );
    case "sender_name":
      return (
        <div className="flex items-center gap-1.5">
          <div className="h-6 w-6 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 text-xs font-medium flex-shrink-0">
            {(mail.sender_name || mail.sender_email || "?").charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-xs text-zinc-300 whitespace-nowrap">{mail.sender_name}</div>
            <div className="text-xs text-zinc-600 whitespace-nowrap">{mail.sender_email}</div>
          </div>
        </div>
      );
    case "received_date":
      return mail.received_date ? (
        <div className="flex items-center gap-1 text-xs text-zinc-400 whitespace-nowrap">
          <Clock className="h-3 w-3" />
          {format(new Date(mail.received_date), "dd.MM.yyyy HH:mm", { locale: de })}
        </div>
      ) : <span className="text-zinc-600 text-xs">—</span>;
    case "priority": {
      const p = PRIORITY_CONFIG[mail.priority] || PRIORITY_CONFIG.normal;
      return (
        <span
          className="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap"
          style={{ color: p.color, borderColor: `${p.color}50`, backgroundColor: `${p.color}15` }}
        >
          {p.label}
        </span>
      );
    }
    case "tags":
      return mail.tags?.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {mail.tags.map(tag => (
            <span key={tag} className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
      ) : <span className="text-zinc-600 text-xs">—</span>;
    case "body_preview":
      return <span className="text-xs text-zinc-500 line-clamp-1 max-w-[250px]">{mail.body_preview || "—"}</span>;
    default:
      return null;
  }
}

export default function MailListViewOverlay({ column, mails, onClose, onMailClick }) {
  const [sortField, setSortField] = useState("received_date");
  const [sortDir, setSortDir] = useState(-1);
  const [colOrder, setColOrder] = useState(() => loadColOrder());
  const dragColRef = useRef(null);
  const dragOverColRef = useRef(null);

  const handleColDragStart = (key) => { dragColRef.current = key; };
  const handleColDragOver = (e, key) => { e.preventDefault(); dragOverColRef.current = key; };
  const handleColDrop = () => {
    if (!dragColRef.current || dragColRef.current === dragOverColRef.current) return;
    const newOrder = [...colOrder];
    const fromIdx = newOrder.indexOf(dragColRef.current);
    const toIdx = newOrder.indexOf(dragOverColRef.current);
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, dragColRef.current);
    setColOrder(newOrder);
    saveColOrder(newOrder);
    dragColRef.current = null;
    dragOverColRef.current = null;
  };

  const orderedCols = colOrder
    .map(key => DEFAULT_COLUMNS.find(c => c.key === key))
    .filter(Boolean);

  const activeMails = mails.filter(m => !m.is_completed);
  const completedMails = mails.filter(m => m.is_completed);

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d * -1);
    else { setSortField(field); setSortDir(1); }
  };

  const sortMails = (list) => {
    if (!sortField) return list;
    return [...list].sort((a, b) => {
      let va = a[sortField] ?? "";
      let vb = b[sortField] ?? "";
      if (sortField === "received_date") {
        va = new Date(va).getTime();
        vb = new Date(vb).getTime();
      }
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    });
  };

  const sortedActive = sortMails(activeMails);
  const sortedCompleted = sortMails(completedMails);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-4 border-b border-zinc-800/60 flex items-center gap-4"
        style={{ borderTopColor: column.color || '#6366f1', borderTopWidth: '3px' }}
      >
        <Button variant="ghost" size="sm" onClick={onClose} className="text-zinc-400 hover:text-zinc-200 gap-2">
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Kanban-Ansicht
        </Button>
        <div className="h-5 w-px bg-zinc-700" />
        <div>
          <h2 className="text-lg font-bold text-zinc-100">{column.name}</h2>
          <p className="text-xs text-zinc-500">{activeMails.length} offen · {completedMails.length} erledigt</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200">
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur z-10">
            <tr className="border-b border-zinc-800">
              {orderedCols.map(col => (
                <th
                  key={col.key}
                  draggable
                  onDragStart={() => handleColDragStart(col.key)}
                  onDragOver={(e) => handleColDragOver(e, col.key)}
                  onDrop={handleColDrop}
                  onClick={() => ["subject","sender_name","received_date","priority"].includes(col.key) && handleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-zinc-200 select-none group"
                >
                  <div className="flex items-center gap-1">
                    <GripVertical className="h-3 w-3 text-zinc-700 group-hover:text-zinc-500" />
                    {col.label}
                    {sortField === col.key ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedActive.map((mail) => (
              <tr
                key={mail.id}
                onClick={() => onMailClick(mail)}
                className="cursor-pointer transition-colors hover:bg-zinc-800/40 border-b border-zinc-800/50"
              >
                {orderedCols.map(col => (
                  <td key={col.key} className="px-4 py-3">
                    {renderCell(col.key, mail)}
                  </td>
                ))}
              </tr>
            ))}

            {/* Separator */}
            {sortedCompleted.length > 0 && (
              <tr>
                <td colSpan={orderedCols.length} className="px-4 pt-6 pb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-zinc-700/60" />
                    <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      Erledigt ({sortedCompleted.length})
                    </span>
                    <div className="flex-1 h-px bg-zinc-700/60" />
                  </div>
                </td>
              </tr>
            )}

            {sortedCompleted.map((mail) => (
              <tr
                key={mail.id}
                onClick={() => onMailClick(mail)}
                className="cursor-pointer transition-colors hover:bg-zinc-800/40 border-b border-zinc-800/30 opacity-50"
              >
                {orderedCols.map(col => (
                  <td key={col.key} className="px-4 py-3">
                    {col.key === "subject"
                      ? <span className="text-sm line-through text-zinc-500">{mail.subject}</span>
                      : renderCell(col.key, mail)
                    }
                  </td>
                ))}
              </tr>
            ))}

            {mails.length === 0 && (
              <tr>
                <td colSpan={orderedCols.length} className="px-4 py-16 text-center text-zinc-600 text-sm">
                  Keine Mails in dieser Spalte
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}