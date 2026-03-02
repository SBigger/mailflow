import React, { useState, useContext } from "react";
import { ThemeContext } from "@/Layout";
import { Search, X, ChevronRight, Plus, ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CustomerHeader from "./CustomerHeader";
import CustomerActivities from "./CustomerActivities";
import CustomerMailsTab from "./CustomerMailsTab";
import CustomerTasksTab from "./CustomerTasksTab";
import CustomerNotesTab from "./CustomerNotesTab";
import CustomerContactPersons from "./CustomerContactPersons";

export default function MobileCustomerView({
  customers,
  staff,
  selectedCustomer,
  onNew,
  onSelect,
  onUpdate,
  onDelete,
}) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';

  const [search, setSearch] = useState("");

  const bg = isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : '#2a2a2f';
  const cardBg = isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(30,30,35,0.9)';
  const borderColor = isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.5)';
  const titleColor = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#f4f4f5';
  const mutedColor = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a';
  const inputBg = isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(24,24,27,0.7)';

  const filtered = customers.filter(c =>
    c.company_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.ort?.toLowerCase().includes(search.toLowerCase())
  );

  // Sync current customer with latest data
  const current = selectedCustomer
    ? (customers.find(c => c.id === selectedCustomer.id) || selectedCustomer)
    : null;

  // ── DETAIL VIEW ──────────────────────────────────────────
  if (current) {
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: bg }}>
        {/* Detail Header */}
        <div className="flex items-center gap-2 px-3 py-3 border-b flex-shrink-0" style={{ borderColor, backgroundColor: bg }}>
          <button
            onClick={() => onSelect(null)}
            className="p-2 rounded-lg touch-manipulation flex-shrink-0"
            style={{ color: mutedColor }}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="flex-1 font-semibold text-sm truncate" style={{ color: titleColor }}>
            {current.company_name}
          </span>
          <button
            onClick={() => {
              if (confirm(`Kunden "${current.company_name}" wirklich löschen?`)) {
                onDelete(current.id);
              }
            }}
            className="p-2 rounded-lg touch-manipulation flex-shrink-0 hover:text-red-400"
            style={{ color: mutedColor }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Detail Content */}
        <div className="flex-1 overflow-y-auto pb-20">
          <CustomerHeader customer={current} staff={staff} onUpdate={onUpdate} />
          <Tabs defaultValue="activities" className="mt-2">
            <div className="px-3 border-b" style={{ borderColor }}>
              <TabsList className="flex gap-0 bg-transparent p-0 h-auto overflow-x-auto w-full" style={{ scrollbarWidth: 'none' }}>
                {[
                  { value: 'activities', label: '📋' },
                  { value: 'mails', label: '📧' },
                  { value: 'tasks', label: '✅' },
                  { value: 'contacts', label: '👤' },
                  { value: 'notes', label: '📝' },
                ].map(({ value, label }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="flex-1 text-sm py-2 px-1 rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:text-violet-500 data-[state=active]:shadow-none"
                    style={{ color: mutedColor }}
                  >
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="p-4">
              <TabsContent value="mails" className="mt-0"><CustomerMailsTab customer={current} /></TabsContent>
              <TabsContent value="tasks" className="mt-0"><CustomerTasksTab customer={current} /></TabsContent>
              <TabsContent value="activities" className="mt-0"><CustomerActivities customer={current} onUpdate={onUpdate} /></TabsContent>
              <TabsContent value="contacts" className="mt-0"><CustomerContactPersons customer={current} onUpdate={onUpdate} /></TabsContent>
              <TabsContent value="notes" className="mt-0"><CustomerNotesTab customer={current} onUpdate={onUpdate} /></TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    );
  }

  // ── LIST VIEW ─────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: bg }}>
      {/* Header + Search */}
      <div className="flex-shrink-0 px-3 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold" style={{ color: titleColor }}>Kunden</h1>
          <Button onClick={onNew} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white h-8 px-3 touch-manipulation">
            <Plus className="h-4 w-4 mr-1" /> Neu
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: mutedColor }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kunden suchen..."
            className="w-full pl-9 pr-8 py-2 text-sm border rounded-xl focus:outline-none"
            style={{ backgroundColor: inputBg, borderColor, color: titleColor }}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: mutedColor }}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-xs" style={{ color: mutedColor }}>{filtered.length} Kunden</p>
      </div>

      {/* Customer List */}
      <div className="flex-1 overflow-y-auto px-3 pb-24 space-y-2">
        {filtered.map(customer => {
          const ml = staff.find(s => s.id === customer.mandatsleiter_id);
          const completedActivities = (customer.activities || []).filter(a => a.completed).length;
          const totalActivities = (customer.activities || []).length;
          return (
            <button
              key={customer.id}
              onClick={() => onSelect(customer)}
              className="w-full text-left rounded-xl border p-3 flex items-center gap-3 touch-manipulation active:scale-[0.99] transition-transform"
              style={{ backgroundColor: cardBg, borderColor }}
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ backgroundColor: isArtis ? '#e6ede6' : isLight ? '#ebebf4' : 'rgba(63,63,70,0.6)', color: isArtis ? '#5f7d64' : isLight ? '#5a5a7a' : '#a1a1aa' }}>
                {customer.company_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: titleColor }}>{customer.company_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {customer.ort && <span className="text-xs truncate" style={{ color: mutedColor }}>{customer.ort}</span>}
                  {ml && <span className="text-xs" style={{ color: mutedColor }}>· {ml.name}</span>}
                </div>
                {totalActivities > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: isArtis ? '#e6ede6' : isLight ? '#ebebf4' : 'rgba(63,63,70,0.5)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(completedActivities / totalActivities) * 100}%`, backgroundColor: isArtis ? '#7a9b7f' : '#7c3aed' }} />
                    </div>
                    <span className="text-[10px]" style={{ color: mutedColor }}>{completedActivities}/{totalActivities}</span>
                  </div>
                )}
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: mutedColor }} />
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-3xl">🏢</span>
            <p className="text-sm" style={{ color: mutedColor }}>Keine Kunden gefunden</p>
          </div>
        )}
      </div>
    </div>
  );
}