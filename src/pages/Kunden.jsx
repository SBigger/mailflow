import React, {useState, useContext, useRef} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Upload, Trash2, Download, PowerOff, ArrowLeft, Table2, UserSquare2,
  RefreshCw,
} from "lucide-react";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import CustomerMiniList from "../components/customers/CustomerMiniList";
import CustomerTable from "../components/customers/CustomerTable";
import CustomerHeader from "../components/customers/CustomerHeader";
import CustomerOverviewTab from "../components/customers/CustomerOverviewTab";
import CustomerActivities from "../components/customers/CustomerActivities";
import CustomerMailsTab from "../components/customers/CustomerMailsTab";
import CustomerCallsTab from "../components/customers/CustomerCallsTab";
import CustomerTasksTab from "../components/customers/CustomerTasksTab";
import CustomerNotesTab from "../components/customers/CustomerNotesTab";
import CustomerContactPersons from "../components/customers/CustomerContactPersons";
import CustomerImportDialog from "../components/customers/CustomerImportDialog";
import PrivatpersonImportDialog from "../components/customers/PrivatpersonImportDialog";
import CustomerFristenTab from "../components/customers/CustomerFristenTab";
import CustomerDokumenteTab from "../components/customers/CustomerDokumenteTab";
import CustomerAktionaereTab from "../components/customers/CustomerAktionaereTab";
import MobileCustomerView from "../components/customers/MobileCustomerView";
import Telefonliste from "./Telefonliste";
import {toast} from "sonner";

/**
 * Kunden-Seite
 * viewMode:
 *   'tabelle' → Volle Tabellenansicht (Grid) über die ganze Breite
 *   'profil'  → Links Mini-Liste (280 px), rechts Hero + Tabs
 * Klick auf eine Tabellenzeile wechselt automatisch zu 'profil'.
 */
export default function Kunden({ initialPersonTypeFilter = "alle" }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const isMobile = useIsMobile();
  const [selectedCustomer,  setSelectedCustomer]  = useState(null);
  const [showImport,        setShowImport]         = useState(false);
  const [showPersonImport,  setShowPersonImport]   = useState(false);
  const [personTypeFilter,  setPersonTypeFilter]   = useState(initialPersonTypeFilter); // 'alle' | 'unternehmen' | 'privatperson'
  const [viewMode,          setViewMode]           = useState("tabelle"); // 'tabelle' | 'profil'
  const [activeTab,         setActiveTab]          = useState("overview");
  const restoreInputRef = useRef(null);
  const [status, setStatus] = useState(null); // null | 'loading' | 'done' | 'error'

  const exportCustomers = async (customers) => {
    try {
      const backup = {
        version: "1.0",
        type: "kunden-backup",
        created_at: new Date().toISOString(),
        customers: customers,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kunden-backup-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${customers.length} Kunden gesichert`);
    } catch (e) {
      toast.error("Sichern fehlgeschlagen: " + e.message);
    }
  }

  const importCustomers = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("loading");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const items = Array.isArray(data) ? data : (data.customers || []);
        if (!Array.isArray(items) || items.length === 0) {
          toast.error("Ungültiges Backup-Format oder keine Kunden gefunden");
          return;
        }
        let created = 0;
        for (const rec of items) {
          await entities.Customer.create(rec);
          created++;
        }
        toast.success(`${created}, total: ${items.length}`);
        setStatus("done");
        queryClient.invalidateQueries({ queryKey: ["customers"] })
      } catch (err) {
        toast.error(err.message);
        setStatus("error");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
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
      setViewMode("profil");
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

  // Auswahl aus der Tabelle → direkt ins Profil wechseln
  const handleSelectFromTable = (c) => {
    setSelectedCustomer(c);
    setActiveTab("overview");
    setViewMode("profil");
  };
  // Auswahl aus der Mini-Liste (wir sind schon im Profil-Modus)
  const handleSelectFromMini = (c) => {
    setSelectedCustomer(c);
    setActiveTab(isNebendomizilOf(c) ? "fristen" : "overview");
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

  // ── Gemeinsamer Header (Filter + View-Toggle + New/Import) ──
  const Header = (
    <div
      className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
      style={{ backgroundColor: isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(24,24,27,0.4)', borderColor }}
    >
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold" style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}>
          Kunden
        </h1>

        {/* Typ-Filter */}
        <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: isArtis ? 'rgba(0,0,0,0.04)' : isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)' }}>
          {[
            { key: "alle",         label: "Alle" },
            { key: "unternehmen",  label: "Kunden" },
            { key: "privatperson", label: "Personen" },
            { key: "telefonliste", label: "Telefonliste" },
          ].map(({ key, label }) => (
            <button key={key} style={tabStyle(key)} onClick={() => setPersonTypeFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* View-Toggle */}
        <div className="flex items-center p-0.5 rounded-md border" style={{ borderColor }}>
          <button
            onClick={() => setViewMode("tabelle")}
            title="Tabellenansicht"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
            style={{
              backgroundColor: viewMode === "tabelle" ? (isArtis ? '#7a9b7f' : '#7c3aed') : "transparent",
              color: viewMode === "tabelle" ? "#fff" : textMuted,
              fontWeight: 500,
            }}
          >
            <Table2 className="h-3.5 w-3.5" /> Tabelle
          </button>
          <button
            onClick={() => {
              setViewMode("profil");
              if (!selectedCustomer && customers.length > 0) {
                const first = customers.find(c => !c.ist_nebensteuerdomizil);
                if (first) setSelectedCustomer(first);
              }
            }}
            title="Profilansicht"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
            style={{
              backgroundColor: viewMode === "profil" ? (isArtis ? '#7a9b7f' : '#7c3aed') : "transparent",
              color: viewMode === "profil" ? "#fff" : textMuted,
              fontWeight: 500,
            }}
          >
            <UserSquare2 className="h-3.5 w-3.5" /> Profil
          </button>
        </div>

        <Button variant="ghost" size="sm" onClick={() => exportCustomers(customers)}
          className="h-7 px-2" style={{ color: textMuted }} title="JSON exportieren">
          <Upload className="h-3.5 w-3.5" />
        </Button>
        <input
            ref={restoreInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={importCustomers}
        />
        <Button variant="ghost" size="sm" onClick={() => restoreInputRef.current?.click()}
            className="h-7 px-2" style={{ color: textMuted }} title="JSON importieren">
          {status === "loading"
              ? <RefreshCw className="h-4 w-4 animate-spin" />
              : <Download className="h-3.5 w-3.5" />}
        </Button>

        {/* Neu-Buttons */}
        <Button onClick={handleNew} size="sm" className="bg-violet-600 hover:bg-violet-500 h-7 text-xs">
          + Unternehmen
        </Button>
        <Button onClick={handleNewPrivatperson} size="sm" variant="outline" className="h-7 text-xs" style={{ borderColor, color: textMuted }}>
          + Person
        </Button>
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : '#f2f5f2' }}>
      {Header}

      {personTypeFilter === "telefonliste" ? (
        <div className="flex-1 overflow-hidden">
          <Telefonliste embedded />
        </div>
      ) : viewMode === "tabelle" ? (
        <div className="flex-1 overflow-hidden">
          <CustomerTable
            customers={customers}
            onSelect={handleSelectFromTable}
            personTypeFilter={personTypeFilter}
          />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Mini-Liste links */}
          <div className="flex-shrink-0" style={{ width: 280 }}>
            <CustomerMiniList
              customers={customers}
              selectedId={currentCustomer?.id}
              onSelect={handleSelectFromMini}
              personTypeFilter={personTypeFilter}
            />
          </div>

          {/* Profil rechts */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!currentCustomer ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl mb-3">{personTypeFilter === 'privatperson' ? '👤' : '🏢'}</div>
                  <div className="text-sm" style={{ color: isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#52525b' }}>
                    Eintrag auswählen
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Back-Button für Nebendomizile */}
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

                {/* Stammdaten oben (editierbar) + Aktionen (Inaktiv / Löschen) als Overlay-Icons oben rechts */}
                <div style={{ position: "relative" }}>
                  <CustomerHeader customer={currentCustomer} staff={appUsers} onUpdate={handleUpdate} />
                  <div style={{ position: "absolute", top: 12, right: 16, display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleUpdate({ aktiv: currentCustomer.aktiv === false ? true : false })}
                      title={currentCustomer.aktiv === false ? "Reaktivieren (aktuell inaktiv)" : "Als inaktiv markieren"}
                      className={`transition-colors rounded p-1 ${currentCustomer.aktiv === false ? 'text-red-400 hover:text-red-500' : 'hover:text-red-400'}`}
                      style={{ color: currentCustomer.aktiv === false ? undefined : (isArtis ? '#8aaa8f' : isLight ? '#b0b0cc' : '#52525b') }}
                    >
                      <PowerOff className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        const label = isNebendomizil
                          ? `Nebendomizil "${currentCustomer.company_name}" wirklich löschen?`
                          : isPrivatperson
                          ? `"${currentCustomer.company_name}" wirklich löschen?`
                          : `Firma "${currentCustomer.company_name}" wirklich löschen?`;
                        if (confirm(label)) deleteMutation.mutate(currentCustomer.id);
                      }}
                      className="transition-colors hover:text-red-400 rounded p-1"
                      style={{ color: isArtis ? '#8aaa8f' : isLight ? '#b0b0cc' : '#52525b' }}
                      title="Löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex-1 overflow-y-auto">
                  <Tabs key={currentCustomer.id} value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                    <div className="px-6 pt-4 border-b" style={{ borderColor }}>
                      <TabsList
                        style={{ backgroundColor: isArtis ? '#edf2ed' : isLight ? '#e8e8f0' : 'rgba(24,24,27,0.6)', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d0d0e0' : '#3f3f46' }}
                        className="border flex-wrap"
                      >
                        {isNebendomizil ? (
                          <TabsTrigger value="fristen" className="text-xs">📅 Fristen</TabsTrigger>
                        ) : (
                          <>
                            <TabsTrigger value="overview"   className="text-xs">🏠 Übersicht</TabsTrigger>
                            <TabsTrigger value="mails"      className="text-xs">📧 Mails</TabsTrigger>
                            <TabsTrigger value="telefonate" className="text-xs">📞 Telefonate</TabsTrigger>
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
                      {!isNebendomizil && (
                        <>
                          <TabsContent value="overview" className="mt-0">
                            <CustomerOverviewTab customer={currentCustomer} />
                          </TabsContent>

                          <TabsContent value="mails" className="mt-0">
                            <CustomerMailsTab customer={currentCustomer} />
                          </TabsContent>

                          <TabsContent value="telefonate" className="mt-0">
                            <CustomerCallsTab customer={currentCustomer} />
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
        </div>
      )}

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

// Helper — Nebendomizil prüfen (wird beim Wechsel Mini-List → Profil genutzt,
// damit wir sofort den richtigen Tab aktivieren).
function isNebendomizilOf(c) {
  return c?.ist_nebensteuerdomizil === true;
}
