import React, { useState, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, Download, Building2, UserRound, ChevronDown, PowerOff, ArrowLeft, LayoutList, LayoutGrid } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import CustomerList from "../components/customers/CustomerList";
import CustomerHeader from "../components/customers/CustomerHeader";
import CustomerActivities from "../components/customers/CustomerActivities";
import CustomerMailsTab from "../components/customers/CustomerMailsTab";
import CustomerTasksTab from "../components/customers/CustomerTasksTab";
import CustomerNotesTab from "../components/customers/CustomerNotesTab";
import CustomerContactPersons from "../components/customers/CustomerContactPersons";
import CustomerGrid from "../components/customers/CustomerGrid";
import CustomerImportDialog from "../components/customers/CustomerImportDialog";
import PrivatpersonImportDialog from "../components/customers/PrivatpersonImportDialog";
import CustomerFristenTab from "../components/customers/CustomerFristenTab";
import CustomerDokumenteTab from "../components/customers/CustomerDokumenteTab";
import CustomerAktionaereTab from "../components/customers/CustomerAktionaereTab";
import MobileCustomerView from "../components/customers/MobileCustomerView";

function escapeCsv(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function exportCustomers(customers, appUsers, activityTemplates) {
  const templateNames = activityTemplates.map(t => t.name);
  const allNames = [...templateNames];
  customers.forEach(c => {
    (c.activities || []).forEach(a => {
      if (!allNames.includes(a.name)) allNames.push(a.name);
    });
  });

  const fixedHeaders = ["Firmenname", "Strasse", "PLZ", "Ort", "Telefon", "Budget", "Mandatsleiter", "Sachbearbeiter"];
  const header = [...fixedHeaders, ...allNames];

  const rows = customers.map(c => {
    const ml = appUsers.find(u => u.id === c.mandatsleiter_id);
    const sb = appUsers.find(u => u.id === c.sachbearbeiter_id);
    const actMap = {};
    (c.activities || []).forEach(a => { actMap[a.name] = a.completed ? "1" : "0"; });
    const actCols = allNames.map(name => actMap[name] !== undefined ? actMap[name] : "");
    return [
      c.company_name || "",
      c.strasse || "",
      c.plz || "",
      c.ort || "",
      c.phone || "",
      c.budget !== null && c.budget !== undefined ? c.budget : "",
      ml ? (ml.full_name || ml.email) : "",
      sb ? (sb.full_name || sb.email) : "",
      ...actCols
    ].map(escapeCsv).join(",");
  });

  const csv = [header.map(escapeCsv).join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kunden_export.csv";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}

export default function Kunden({ initialPersonTypeFilter = "alle" }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const isMobile = useIsMobile();
  const [selectedCustomer,  setSelectedCustomer]  = useState(null);
  const [showImport,        setShowImport]         = useState(false);
  const [showPersonImport,  setShowPersonImport]   = useState(false);
  const [personTypeFilter,  setPersonTypeFilter]   = useState(initialPersonTypeFilter); // 'alle' | 'unternehmen' | 'privatperson'
  const [viewMode,          setViewMode]           = useState("liste"); // 'liste' | 'kacheln'
  const [leftWidth,         setLeftWidth]          = useState(288);
  const isResizing = React.useRef(false);

  const handleMouseDown = (e) => {
    isResizing.current = true;
    e.preventDefault();
    const onMouseMove = (e) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(180, Math.min(600, e.clientX - 56));
      setLeftWidth(newWidth);
    };
    const onMouseUp = () => {
      isResizing.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const queryClient = useQueryClient();

  const { data: customers = [], refetch } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  const { data: appUsers = [] } = useQuery({
    queryKey: ["appUsers"],
    queryFn: async () => {
      const res = await functions.invoke('getAllUsers', {});
      return res?.data?.users || [];
    },
  });

  const { data: activityTemplates = [] } = useQuery({
    queryKey: ["activityTemplates"],
    queryFn: () => entities.ActivityTemplate.list("order"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Customer.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });

  const createMutation = useMutation({
    mutationFn: (data) => entities.Customer.create(data),
    onSuccess: (newCustomer) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setSelectedCustomer(newCustomer);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => entities.Customer.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setSelectedCustomer(null);
    },
  });

  const handleUpdate = (data) => {
    updateMutation.mutate({ id: selectedCustomer.id, data });
    setSelectedCustomer(prev => ({ ...prev, ...data }));
  };

  const handleNew = () => {
    createMutation.mutate({
      company_name: "Neuer Kunde",
      person_type: 'unternehmen',
      activities: [], contact_persons: [], tags: [],
    });
  };

  const handleNewPrivatperson = () => {
    createMutation.mutate({
      company_name: "Neue Person",
      person_type: 'privatperson',
      vorname: '', nachname: '',
      activities: [], contact_persons: [], tags: [],
    });
  };

  const currentCustomer = selectedCustomer
    ? (customers.find(c => c.id === selectedCustomer.id) || selectedCustomer)
    : null;

  const handleMobileUpdate = (data) => {
    if (!selectedCustomer) return;
    updateMutation.mutate({ id: selectedCustomer.id, data });
    setSelectedCustomer(prev => ({ ...prev, ...data }));
  };

  const isPrivatperson  = currentCustomer?.person_type === 'privatperson';
  const isNebendomizil  = currentCustomer?.ist_nebensteuerdomizil === true;
  const hauptdomizil    = isNebendomizil
    ? customers.find(c => c.id === currentCustomer?.hauptdomizil_id) || null
    : null;

  // ── Theme colors ─────────────────────────────────────────────
  const textMuted   = isArtis ? '#6b826b' : isLight ? '#5a5a7a' : '#71717a';
  const borderColor = isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)';
  const accentBg    = isArtis ? '#7a9b7f' : '#7c3aed';

  // Type filter tab style helper
  const tabStyle = (key) => ({
    backgroundColor: personTypeFilter === key
      ? (isArtis ? '#7a9b7f' : '#7c3aed')
      : 'transparent',
    color: personTypeFilter === key ? '#fff' : textMuted,
    fontSize: '11px',
    padding: '3px 8px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'all 0.15s',
  });

  if (isMobile) {
    return (
      <div className="h-screen overflow-hidden" style={{ backgroundColor: isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : '#2a2a2f' }}>
        <MobileCustomerView
          customers={customers}
          staff={appUsers}
          selectedCustomer={selectedCustomer}
          onNew={handleNew}
          onSelect={setSelectedCustomer}
          onUpdate={handleMobileUpdate}
          onDelete={(id) => { deleteMutation.mutate(id); setSelectedCustomer(null); }}
        />
        <CustomerImportDialog
          open={showImport}
          onClose={() => setShowImport(false)}
          staff={appUsers}
          activityTemplates={activityTemplates}
          onImported={() => { refetch(); setShowImport(false); }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : '#f2f5f2' }}>

      {/* ── Left Panel ─────────────────────────────────────── */}
      <div className="flex-shrink-0 flex flex-col" style={{ width: leftWidth }}>

        {/* Header with title + type filter + import button */}
        <div className="px-4 pt-3 pb-2 space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold" style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}>Kunden</h1>
            <div className="flex gap-1">
              {/* View-Mode Toggle */}
              <Button
                variant="ghost" size="sm"
                onClick={() => setViewMode(v => v === "liste" ? "kacheln" : "liste")}
                className="h-7 px-2"
                style={{ color: viewMode === "kacheln" ? accentBg : textMuted }}
                title={viewMode === "liste" ? "Kachelansicht" : "Listenansicht"}
              >
                {viewMode === "liste"
                  ? <LayoutGrid className="h-3.5 w-3.5" />
                  : <LayoutList className="h-3.5 w-3.5" />}
              </Button>

              <Button
                variant="ghost" size="sm" onClick={() => exportCustomers(customers, appUsers, activityTemplates)}
                className="h-7 px-2" style={{ color: textMuted }} title="CSV exportieren"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>

              {/* Import dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2" style={{ color: textMuted }} title="Importieren">
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowImport(true)} className="gap-2 text-xs">
                    <Building2 className="h-3.5 w-3.5" /> Unternehmen importieren
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowPersonImport(true)} className="gap-2 text-xs">
                    <UserRound className="h-3.5 w-3.5" /> Privatpersonen importieren
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Type filter: Alle | Unternehmen | Personen */}
          <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: isArtis ? 'rgba(0,0,0,0.04)' : isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)' }}>
            {[
              { key: "alle",        label: "Alle" },
              { key: "unternehmen", label: "Kunden" },
              { key: "privatperson",label: "Personen" },
            ].map(({ key, label }) => (
              <button key={key} style={tabStyle(key)} onClick={() => setPersonTypeFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {viewMode === "liste" ? (
            <CustomerList
              customers={customers}
              selectedId={currentCustomer?.id}
              onSelect={setSelectedCustomer}
              onNew={handleNew}
              onNewPrivatperson={handleNewPrivatperson}
              personTypeFilter={personTypeFilter}
            />
          ) : (
            <CustomerGrid
              customers={customers}
              onSelect={setSelectedCustomer}
              personTypeFilter={personTypeFilter}
            />
          )}
        </div>
      </div>

      {/* ── Resize Handle ───────────────────────────────────── */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1.5 flex-shrink-0 cursor-col-resize transition-colors"
        style={{ backgroundColor: borderColor }}
        title="Ziehen zum Anpassen"
      />

      {/* ── Right Panel ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!currentCustomer ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-3">{personTypeFilter === 'privatperson' ? '👤' : '🏢'}</div>
              <div className="text-sm" style={{ color: isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#52525b' }}>
                Eintrag auswählen oder neu erstellen
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* ── Back-Button für Nebendomizile ─────────────── */}
            {isNebendomizil && (
              <div className="px-6 py-2 border-b" style={{ borderColor }}>
                <button
                  onClick={() => setSelectedCustomer(hauptdomizil)}
                  className="flex items-center gap-1.5 text-xs font-medium hover:underline transition-colors"
                  style={{ color: accentBg }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {hauptdomizil ? `Zurück zu ${hauptdomizil.company_name}` : 'Zum Hauptdomizil'}
                </button>
              </div>
            )}

            <div className="flex items-start gap-2 pr-4">
              <div className="flex-1">
                <CustomerHeader customer={currentCustomer} staff={appUsers} onUpdate={handleUpdate} />
              </div>
              <div className="flex flex-col gap-2 mt-6">
                {/* Inaktiv-Toggle */}
                <button
                  onClick={() => handleUpdate({ aktiv: currentCustomer.aktiv === false ? true : false })}
                  title={currentCustomer.aktiv === false ? "Reaktivieren (aktuell inaktiv)" : "Als inaktiv markieren"}
                  className={`flex-shrink-0 transition-colors rounded p-0.5 ${
                    currentCustomer.aktiv === false
                      ? 'text-red-400 hover:text-red-500'
                      : 'hover:text-red-400'
                  }`}
                  style={{ color: currentCustomer.aktiv === false ? undefined : (isArtis ? '#8aaa8f' : isLight ? '#b0b0cc' : '#52525b') }}
                >
                  <PowerOff className="h-4 w-4" />
                </button>
                {/* Löschen */}
                <button
                  onClick={() => {
                    const label = isNebendomizil
                      ? `Nebendomizil "${currentCustomer.company_name}" wirklich löschen?`
                      : isPrivatperson
                      ? `"${currentCustomer.company_name}" wirklich löschen?`
                      : `Firma "${currentCustomer.company_name}" wirklich löschen?`;
                    if (confirm(label)) deleteMutation.mutate(currentCustomer.id);
                  }}
                  className="flex-shrink-0 transition-colors hover:text-red-400"
                  style={{ color: isArtis ? '#8aaa8f' : isLight ? '#b0b0cc' : '#52525b' }}
                  title="Löschen"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <Tabs key={currentCustomer.id} defaultValue={isNebendomizil ? "fristen" : "activities"} className="h-full flex flex-col">
                <div className="px-6 pt-4 border-b" style={{ borderColor }}>
                  <TabsList
                    style={{ backgroundColor: isArtis ? '#edf2ed' : isLight ? '#e8e8f0' : 'rgba(24,24,27,0.6)', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d0d0e0' : '#3f3f46' }}
                    className="border flex-wrap"
                  >
                    {isNebendomizil ? (
                      /* Nebendomizil: nur Fristen */
                      <TabsTrigger value="fristen" className="text-xs">📅 Fristen</TabsTrigger>
                    ) : (
                      /* Normales Haupt-Domizil */
                      <>
                        <TabsTrigger value="mails"      className="text-xs">📧 Mails</TabsTrigger>
                        <TabsTrigger value="tasks"      className="text-xs">✅ Tasks</TabsTrigger>
                        <TabsTrigger value="fristen"    className="text-xs">📅 Fristen</TabsTrigger>
                        <TabsTrigger value="activities" className="text-xs">📋 Tätigkeiten</TabsTrigger>
                        <TabsTrigger value="contacts"   className="text-xs">👤 Kontakte</TabsTrigger>
                        <TabsTrigger value="notes"      className="text-xs">📝 Notizen</TabsTrigger>
          <TabsTrigger value="dokumente"  className="text-xs">📄 Dokumente</TabsTrigger>
                        {!isPrivatperson && (
                          <TabsTrigger value="aktionaere" className="text-xs">📗 Aktionäre</TabsTrigger>
                        )}
                      </>
                    )}
                  </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  {/* Tabs für alle Kunden (nicht Nebendomizil) */}
                  {!isNebendomizil && (
                    <>
                      <TabsContent value="mails" className="mt-0">
                        <CustomerMailsTab customer={currentCustomer} />
                      </TabsContent>

                      <TabsContent value="tasks" className="mt-0">
                        <CustomerTasksTab customer={currentCustomer} />
                      </TabsContent>

                      <TabsContent value="activities" className="mt-0">
                        <CustomerActivities customer={currentCustomer} onUpdate={handleUpdate} />
                      </TabsContent>

                      <TabsContent value="contacts" className="mt-0">
                        <CustomerContactPersons customer={currentCustomer} onUpdate={handleUpdate} />
                      </TabsContent>

                      <TabsContent value="notes" className="mt-0 h-full">
                        <CustomerNotesTab customer={currentCustomer} onUpdate={handleUpdate} />
                      </TabsContent>

        <TabsContent value="dokumente" className="mt-0">
          <CustomerDokumenteTab customerId={currentCustomer?.id} />
        </TabsContent>

                      {!isPrivatperson && (
                        <TabsContent value="aktionaere" className="mt-0">
                          <CustomerAktionaereTab customer={currentCustomer} />
                        </TabsContent>
                      )}
                    </>
                  )}

                  {/* Fristen: für alle (Haupt- und Nebendomizile) */}
                  <TabsContent value="fristen" className="mt-0">
                    <CustomerFristenTab customer={currentCustomer} />
                  </TabsContent>

                </div>
              </Tabs>
            </div>
          </>
        )}
      </div>

      {/* ── Import Dialogs ──────────────────────────────────── */}
      <CustomerImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        staff={appUsers}
        activityTemplates={activityTemplates}
        onImported={() => { refetch(); setShowImport(false); }}
      />
      <PrivatpersonImportDialog
        open={showPersonImport}
        onClose={() => setShowPersonImport(false)}
        staff={appUsers}
        onImported={() => { refetch(); setShowPersonImport(false); }}
      />
    </div>
  );
}
