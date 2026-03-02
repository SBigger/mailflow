import React, { useState, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, Download } from "lucide-react";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import CustomerList from "../components/customers/CustomerList";
import CustomerHeader from "../components/customers/CustomerHeader";
import CustomerActivities from "../components/customers/CustomerActivities";
import CustomerMailsTab from "../components/customers/CustomerMailsTab";
import CustomerTasksTab from "../components/customers/CustomerTasksTab";
import CustomerNotesTab from "../components/customers/CustomerNotesTab";
import CustomerContactPersons from "../components/customers/CustomerContactPersons";
import CustomerImportDialog from "../components/customers/CustomerImportDialog";
import MobileCustomerView from "../components/customers/MobileCustomerView";

function escapeCsv(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function exportCustomers(customers, staff, activityTemplates) {
  // Collect all unique activity names (from templates, then any extra from customers)
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
    const ml = staff.find(s => s.id === c.mandatsleiter_id);
    const sb = staff.find(s => s.id === c.sachbearbeiter_id);
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
      ml ? ml.name : "",
      sb ? sb.name : "",
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

export default function Kunden() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const isMobile = useIsMobile();
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [leftWidth, setLeftWidth] = useState(288); // 72 * 4 = 288px
  const isResizing = React.useRef(false);

  const handleMouseDown = (e) => {
    isResizing.current = true;
    e.preventDefault();
    const onMouseMove = (e) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(180, Math.min(600, e.clientX - 56)); // 56 = sidebar width
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

  const { data: staff = [] } = useQuery({
    queryKey: ["staff"],
    queryFn: () => entities.Staff.list("order"),
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
    createMutation.mutate({ company_name: "Neuer Kunde", activities: [], contact_persons: [], tags: [] });
  };

  // Keep selected customer in sync with fresh data
  const currentCustomer = selectedCustomer
    ? (customers.find(c => c.id === selectedCustomer.id) || selectedCustomer)
    : null;

  const handleMobileUpdate = (data) => {
    if (!selectedCustomer) return;
    updateMutation.mutate({ id: selectedCustomer.id, data });
    setSelectedCustomer(prev => ({ ...prev, ...data }));
  };

  if (isMobile) {
    return (
      <div className="h-screen overflow-hidden" style={{ backgroundColor: isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : '#2a2a2f' }}>
        <MobileCustomerView
          customers={customers}
          staff={staff}
          selectedCustomer={selectedCustomer}
          onNew={handleNew}
          onSelect={setSelectedCustomer}
          onUpdate={handleMobileUpdate}
          onDelete={(id) => { deleteMutation.mutate(id); setSelectedCustomer(null); }}
        />
        <CustomerImportDialog
          open={showImport}
          onClose={() => setShowImport(false)}
          staff={staff}
          activityTemplates={activityTemplates}
          onImported={() => { refetch(); setShowImport(false); }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : '#f2f5f2' }}>
      {/* Left Panel - Customer List */}
      <div className="flex-shrink-0 flex flex-col" style={{ width: leftWidth }}>
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <h1 className="text-lg font-semibold" style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}>Kunden</h1>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportCustomers(customers, staff, activityTemplates)}
              className="h-7 px-2"
              style={{ color: isArtis ? '#6b826b' : isLight ? '#5a5a7a' : '#71717a' }}
              title="CSV exportieren"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowImport(true)}
              className="h-7 px-2"
              style={{ color: isArtis ? '#6b826b' : isLight ? '#5a5a7a' : '#71717a' }}
              title="CSV importieren"
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <CustomerList
            customers={customers}
            selectedId={currentCustomer?.id}
            onSelect={setSelectedCustomer}
            onNew={handleNew}
          />
        </div>
      </div>

      {/* Resize Handle */}
       <div
         onMouseDown={handleMouseDown}
         className="w-1.5 flex-shrink-0 cursor-col-resize transition-colors"
         style={{ backgroundColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}
         title="Ziehen zum Anpassen"
       />

      {/* Right Panel - Customer Detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!currentCustomer ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-3">🏢</div>
              <div className="text-sm" style={{ color: isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#52525b' }}>Kunden auswählen oder neu erstellen</div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 pr-4">
              <div className="flex-1">
                <CustomerHeader customer={currentCustomer} staff={staff} onUpdate={handleUpdate} />
              </div>
              <button
                onClick={() => { if (confirm(`Kunden "${currentCustomer.company_name}" wirklich löschen?`)) deleteMutation.mutate(currentCustomer.id); }}
                className="mt-6 transition-colors flex-shrink-0 hover:text-red-400"
                style={{ color: isArtis ? '#8aaa8f' : isLight ? '#b0b0cc' : '#52525b' }}
                title="Kunde löschen"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <Tabs defaultValue="activities" className="h-full flex flex-col">
                <div className="px-6 pt-4 border-b" style={{ borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
                   <TabsList style={{ backgroundColor: isArtis ? '#edf2ed' : isLight ? '#e8e8f0' : 'rgba(24,24,27,0.6)', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d0d0e0' : '#3f3f46' }} className="border">
                    <TabsTrigger value="mails" className="text-xs" style={{}} >📧 Mails</TabsTrigger>
                    <TabsTrigger value="tasks" className="text-xs">✅ Tasks</TabsTrigger>
                    <TabsTrigger value="activities" className="text-xs">📋 Tätigkeiten</TabsTrigger>
                    <TabsTrigger value="contacts" className="text-xs">👤 Kontakte</TabsTrigger>
                    <TabsTrigger value="notes" className="text-xs">📝 Notizen</TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
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
                </div>
              </Tabs>
            </div>
          </>
        )}
      </div>

      <CustomerImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        staff={staff}
        activityTemplates={activityTemplates}
        onImported={() => { refetch(); setShowImport(false); }}
      />
    </div>
  );
}