import React, { useState, useMemo, useEffect, useContext } from "react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Plus, RefreshCw, Search, Mail, Settings, Bell, CheckCircle2, Menu, ChevronDown, LayoutDashboard, CheckSquare, X, MoreHorizontal } from "lucide-react";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import MobileMailColumnNav from "@/components/mobile/MobileMailColumnNav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { startOfDay, endOfDay, isToday, isTomorrow, isThisWeek, addDays, addWeeks, format, isPast } from "date-fns";

import KanbanColumn from "../components/mail/KanbanColumn";
import TagColumn from "../components/mail/TagColumn";
import TimelineColumn from "../components/mail/TimelineColumn";
import MailDetailPanel from "../components/mail/MailDetailPanel";
import AddColumnDialog from "../components/mail/AddColumnDialog";
import ReplyDialog from "../components/mail/ReplyDialog";
import EditMailDialog from "../components/mail/EditMailDialog";
import MailFilters from "../components/mail/MailFilters";
import EditColumnColorDialog from "../components/mail/EditColumnColorDialog";
import MailSearchBar from "../components/mail/MailSearchBar";
import ReminderDialog from "../components/mail/ReminderDialog";
import DailyReminderPopup from "../components/mail/DailyReminderPopup";
import NewMailDialog from "../components/mail/NewMailDialog";
import { Tag as TagIcon } from "lucide-react";
import ConvertToTaskDialog from "../components/mail/ConvertToTaskDialog";


export default function MailKanban() {
   const { theme } = useContext(ThemeContext) || { theme: 'dark' };
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';

   const { data: currentUser, isLoading: userLoading } = useQuery({
     queryKey: ["currentUser"],
     queryFn: () => auth.me(),
   });

   const [selectedMail, setSelectedMail] = useState(null);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeFilters, setActiveFilters] = useState({ tags: [], project: null });
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [replyingToMail, setReplyingToMail] = useState(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingMail, setEditingMail] = useState(null);
  const [collapsedColumns, setCollapsedColumns] = useState(new Set());
  const [editingColumnColor, setEditingColumnColor] = useState(null);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [showDailyReminders, setShowDailyReminders] = useState(() => {
    const key = 'dailyReminderShown_' + new Date().toDateString();
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  });
  const [newMailDialogOpen, setNewMailDialogOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(480);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [viewMode, setViewMode] = useState('columns'); // 'columns', 'tags', or 'timeline'
  const [collapsedTags, setCollapsedTags] = useState(new Set());
  const [collapsedTimeline, setCollapsedTimeline] = useState(new Set());

  const [convertMailDialogOpen, setConvertMailDialogOpen] = useState(false);
  const [mailToConvert, setMailToConvert] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [isQuickSyncing, setIsQuickSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [globalDateCollapse, setGlobalDateCollapse] = useState(null);
  const [showDateGrouping, setShowDateGrouping] = useState(true);
  const [advancedSearch, setAdvancedSearch] = useState({ dateFrom: null, dateTo: null, searchField: 'all' });
  const [mobileActiveColumnId, setMobileActiveColumnId] = useState(null);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const isMobile = useIsMobile();
  // Mails sind strikt pro User - kein userFilter nötig
  const queryClient = useQueryClient();

  // Stiller Auto-Sync beim Seitenöffnen (max. alle 5 Minuten)
  useEffect(() => {
    if (!currentUser?.microsoft_access_token) return;
    const SYNC_KEY = 'mailKanban_lastAutoSync';
    const lastSync = parseInt(sessionStorage.getItem(SYNC_KEY) || '0', 10);
    if (Date.now() - lastSync < 5 * 60 * 1000) return;
    sessionStorage.setItem(SYNC_KEY, String(Date.now()));
    functions.invoke('sync-outlook-mails', {})
      .then(() => queryClient.invalidateQueries({ queryKey: ['mailItems'] }))
      .catch(() => {});
  }, [currentUser?.id]);

  // Helper: Update/Create Mapping for Mail
  const updateMailMapping = async (mail, updates) => {
    if (!mail.outlook_id || !currentUser?.id) return;

    const mappings = await entities.MailKanbanMapping.filter({ created_by: currentUser.id });
    const mappingsArray = Array.isArray(mappings) ? mappings : (mappings ? [mappings] : []);
    const existingMapping = mappingsArray.find(m => m.outlook_id === mail.outlook_id);
    
    const mappingData = {
      outlook_id: mail.outlook_id,
      column_id: updates.column_id ?? mail.column_id,
      tags: updates.tags ?? mail.tags ?? [],
      project: updates.project ?? mail.project,
      reminder_date: updates.reminder_date !== undefined ? updates.reminder_date : mail.reminder_date
    };
    
    if (existingMapping) {
      await entities.MailKanbanMapping.update(existingMapping.id, mappingData);
    } else {
      await entities.MailKanbanMapping.create(mappingData);
    }
  };



  // Mark mail as read locally + in Outlook when clicked
  const handleMailClick = async (mail) => {
    setSelectedMail(mail);
    if (!mail.is_read) {
      // Optimistic local update
      queryClient.setQueryData(["mailItems", currentUser?.id], (old) =>
        old ? old.map(m => m.id === mail.id ? { ...m, is_read: true } : m) : old
      );
      // Fire-and-forget to Outlook
      functions.invoke('markAsReadInOutlook', { mail_id: mail.id }).catch(() => {});
    }
  };

  // Check for Outlook connection success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('outlook_connected') === 'true') {
      toast.success('Erfolgreich mit Outlook verbunden!');
      // Clean URL
      window.history.replaceState({}, '', '/MailKanban');
    }
  }, []);

  // Auto-Sync alle 30 Minuten im Hintergrund (solange App offen)
  useEffect(() => {
    if (!currentUser) return;
    const SYNC_INTERVAL = 30 * 60 * 1000; // 30 Minuten
    const interval = setInterval(async () => {
      try {
        await functions.invoke('sync-outlook-mails', {});
        queryClient.invalidateQueries({ queryKey: ["mailItems"] });
        queryClient.invalidateQueries({ queryKey: ["kanbanColumns"] });
      } catch (e) {
        console.warn('[AUTO-SYNC] Fehler:', e.message);
      }
    }, SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  // Fetch columns - nur für aktuellen Benutzer
  const { data: columns = [], isLoading: colLoading } = useQuery({
    queryKey: ["kanbanColumns", currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      const allCols = await entities.KanbanColumn.filter({}, "order");
      // Zeige nur Spalten des aktuellen Users (created_by = UUID)
      let filtered = allCols.filter(col => col.created_by === currentUser.id);
      
      // Falls noch keine Spalten existieren, automatisch eine "Outlook" Standardspalte erstellen
      if (filtered.length === 0 && currentUser.microsoft_access_token) {
        const newCol = await entities.KanbanColumn.create({
          name: 'Outlook', order: 0, color: '#0078d4', mailbox: 'personal'
        });
        filtered = [newCol];
      }
      
      return filtered;
    },
    enabled: !!currentUser,
  });

  // Fetch mails - strikt nur für aktuellen Benutzer (created_by = user UUID)
  const { data: mails = [], isLoading: mailLoading } = useQuery({
    queryKey: ["mailItems", currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.microsoft_access_token) return [];
      let allMails = [];
      let skip = 0;
      const BATCH = 500;
      while (true) {
        const batch = await entities.MailItem.filter(
          { created_by: currentUser.id }, "-received_date", BATCH, skip
        );
        const arr = Array.isArray(batch) ? batch : (batch ? [batch] : []);
        allMails = allMails.concat(arr);
        if (arr.length < BATCH) break;
        skip += BATCH;
        if (skip >= 5000) break;
      }
      return allMails;
    },
    enabled: !!currentUser?.microsoft_access_token,
  });



  // Fetch task columns for ConvertToTaskDialog
  const { data: taskColumns = [] } = useQuery({
    queryKey: ["taskColumns", currentUser?.id],
    queryFn: () => entities.TaskColumn.filter({ created_by: currentUser?.id }, "order"),
    enabled: !!currentUser,
  });

  // Fetch tasks for tags view - strikt nur für aktuellen Benutzer
  const { data: allTasks = [] } = useQuery({
    queryKey: ["allTasks", currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.microsoft_access_token) return [];
      const tasks = await entities.Task.filter({ created_by: currentUser.id });
      return Array.isArray(tasks) ? tasks : (tasks ? [tasks] : []);
    },
    enabled: !!currentUser?.microsoft_access_token,
  });

  // Get reminders for today (exclude completed)
  const todayReminders = useMemo(() => {
    return mails.filter(mail => {
      if (!mail.reminder_date || mail.is_completed) return false;
      return isToday(new Date(mail.reminder_date));
    });
  }, [mails]);

  // Get all reminders (exclude completed and deleted)
  const allReminders = useMemo(() => {
    return mails
      .filter(mail => mail.reminder_date && !mail.is_completed)
      .sort((a, b) => new Date(a.reminder_date) - new Date(b.reminder_date));
  }, [mails]);

  // Filter by search and filters
  const filteredMails = useMemo(() => {
    let result = mails;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();

      if (advancedSearch.searchField === 'all') {
        result = result.filter(
          (m) =>
            m.subject?.toLowerCase().includes(q) ||
            m.sender_name?.toLowerCase().includes(q) ||
            m.sender_email?.toLowerCase().includes(q) ||
            m.to?.toLowerCase().includes(q) ||
            m.body_preview?.toLowerCase().includes(q)
        );
      } else if (advancedSearch.searchField === 'subject') {
        result = result.filter((m) => m.subject?.toLowerCase().includes(q));
      } else if (advancedSearch.searchField === 'sender') {
        result = result.filter(
          (m) =>
            m.sender_name?.toLowerCase().includes(q) ||
            m.sender_email?.toLowerCase().includes(q)
        );
      } else if (advancedSearch.searchField === 'recipient') {
        result = result.filter((m) => m.to?.toLowerCase().includes(q));
      }
    }

    // Date range filter
    if (advancedSearch.dateFrom) {
      const fromDate = new Date(advancedSearch.dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      result = result.filter((m) => new Date(m.received_date) >= fromDate);
    }

    if (advancedSearch.dateTo) {
      const toDate = new Date(advancedSearch.dateTo);
      toDate.setHours(23, 59, 59, 999);
      result = result.filter((m) => new Date(m.received_date) <= toDate);
    }

    // Apply tag & project filters
    if (activeFilters.tags.length > 0) {
      result = result.filter(mail =>
        activeFilters.tags.some(tag => (mail.tags || []).includes(tag))
      );
    }

    if (activeFilters.project) {
      result = result.filter(mail => mail.project === activeFilters.project);
    }

    // Filter mailbox
    result = result.filter(m => m.mailbox === 'personal');

    // Filter by completed status
    if (!showCompleted) {
      result = result.filter(m => !m.is_completed);
    }

    // Archivierte Mails (aus Outlook gelöscht) ausblenden
    result = result.filter(m => !m.is_archived);

    return result;
  }, [mails, searchQuery, activeFilters, advancedSearch, showCompleted]);

  // Mutations
  const addColumnMutation = useMutation({
    mutationFn: async (data) => {
      const maxOrder = columns.length > 0 ? Math.max(...columns.map(c => c.order || 0)) + 1 : 1;
      return entities.KanbanColumn.create({ ...data, order: maxOrder, mailbox: 'personal' });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["kanbanColumns", currentUser?.id] });
      await queryClient.refetchQueries({ queryKey: ["kanbanColumns", currentUser?.id] });
      toast.success('Spalte hinzugefügt');
      setShowAddColumn(false);
    },
    onError: (error) => toast.error('Fehler: ' + error.message),
  });

  const updateColumnMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return entities.KanbanColumn.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanbanColumns", currentUser?.id] });
    },
    onError: (error) => toast.error('Fehler: ' + error.message),
  });

  const updateMailMutation = useMutation({
    mutationFn: async ({ id, data, mail: mailObj }) => {
      await entities.MailItem.update(id, data);
      // Use provided mail object or find it from mails list for mapping update
      const resolvedMail = mailObj || mails.find(m => m.id === id);
      if (resolvedMail?.outlook_id) {
        await updateMailMapping(resolvedMail, data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailItems"] });
    },
    onError: (error) => toast.error('Fehler: ' + error.message),
  });

  const deleteColumnMutation = useMutation({
    mutationFn: async (columnId) => {
      return entities.KanbanColumn.delete(columnId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanbanColumns", currentUser?.id] });
      toast.success('Spalte gelöscht');
    },
    onError: (error) => toast.error('Fehler: ' + error.message),
  });

  // Sync Outlook
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await functions.invoke('sync-outlook-mails', {});
      queryClient.invalidateQueries({ queryKey: ["mailItems"] });
      toast.success('Sync abgeschlossen');
    } catch (error) {
      toast.error('Sync Fehler: ' + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFirstSync = async () => {
    if (!confirm('Alle Mails löschen und neu synchronisieren?')) return;
    setIsSyncing(true);
    try {
      await functions.invoke('reset-and-sync', {});
      queryClient.invalidateQueries({ queryKey: ["mailItems"] });
      toast.success('Reset und Sync abgeschlossen');
    } catch (error) {
      toast.error('Fehler: ' + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  // Drag & drop
  const handleDragEnd = (result) => {
    const { source, destination, type, draggableId } = result;
    if (!destination) return;

    if (type === 'COLUMN') {
      const newOrder = Array.from(columns);
      const [movedColumn] = newOrder.splice(source.index, 1);
      newOrder.splice(destination.index, 0, movedColumn);
      
      newOrder.forEach((col, idx) => {
        if (col.order !== idx) {
          updateColumnMutation.mutate({ id: col.id, data: { order: idx } });
        }
      });
    } else if (type === 'MAIL') {
      const mail = filteredMails.find(m => m.id === draggableId);
      if (mail && destination.droppableId !== source.droppableId) {
        updateMailMutation.mutate({
          id: mail.id,
          mail: mail,
          data: { column_id: destination.droppableId }
        });
      }
    }
  };

  // Set first column as active mobile column when columns load - MUST be before early return
  useEffect(() => {
    if (columns.length > 0 && !mobileActiveColumnId) {
      setMobileActiveColumnId(columns[0].id);
    }
  }, [columns]);

  const pageBg = isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : '#f2f5f2';
  const borderColor = isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(113,113,122,0.6)';
  const inputBg = isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(24,24,27,0.6)';
  const inputBorder = isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#3f3f46';
  const inputText = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7';
  const mutedText = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a';
  const titleText = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#f4f4f5';

  // Warte bis Profil geladen ist bevor wir "nicht verbunden" zeigen
  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: pageBg }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: mutedText }} />
      </div>
    );
  }

  if (!currentUser?.microsoft_access_token) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: pageBg }}>
        <div className="text-center">
          <Mail className="h-12 w-12 mx-auto mb-4" style={{ color: mutedText }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: titleText }}>Noch nicht mit Outlook verbunden</h2>
          <p className="text-sm mb-4" style={{ color: mutedText }}>Gehen Sie zu Einstellungen um Ihr Outlook-Konto zu verbinden</p>
          <a href="/Settings" className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: isArtis ? '#7a9b7f' : '#6366f1' }}>
            Zu den Einstellungen
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: pageBg }}>
      {/* Main Kanban Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        {isMobile ? (
          /* Mobile Top Bar */
          <div className="border-b px-3 py-2 flex-shrink-0" style={{ backgroundColor: pageBg, borderColor }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {[
                  { id: 'columns', label: 'Kanban', icon: LayoutDashboard },
                  { id: 'tags', label: 'Tags', icon: TagIcon },
                  { id: 'reminders', label: 'Remind.', icon: Bell },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setViewMode(id)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap touch-manipulation flex-shrink-0"
                    style={{
                      backgroundColor: viewMode === id ? '#7c3aed' : 'transparent',
                      color: viewMode === id ? '#ffffff' : mutedText,
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    {id === 'reminders' && todayReminders.length > 0 && (
                      <span className="bg-white text-violet-700 text-[9px] font-bold px-1 rounded-full">{todayReminders.length}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setShowMobileSearch(v => !v)} className="p-2 touch-manipulation" style={{ color: showMobileSearch ? '#7c3aed' : mutedText }}>
                  <Search className="h-4 w-4" />
                </button>
                <Button onClick={() => setNewMailDialogOpen(true)} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white touch-manipulation h-8 px-2">
                  <Plus className="h-4 w-4" />
                </Button>
                <button onClick={handleSync} disabled={isSyncing} className="p-2 touch-manipulation" style={{ color: mutedText }}>
                  <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
            {showMobileSearch && (
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: mutedText }} />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Mails suchen..."
                  style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputText }}
                  className="pl-9 pr-8 py-2 text-sm border rounded-lg w-full h-9 focus:outline-none" autoFocus />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: mutedText }}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Desktop Top Bar */
          <div className="border-b px-6 py-4" style={{ backgroundColor: pageBg, borderColor }}>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-bold" style={{ color: titleText }}>Mailverwaltung</h1>
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-lg p-1 gap-1" style={{ backgroundColor: isArtis ? '#e6ede6' : isLight ? '#e4e4f0' : 'rgba(63,63,70,0.6)' }}>
                  <Button variant="ghost" size="sm" onClick={() => setViewMode('columns')}
                    className={viewMode === 'columns' ? 'bg-violet-600 text-white hover:bg-violet-500' : ''} style={viewMode !== 'columns' ? { color: mutedText } : {}}>
                    <LayoutDashboard className="h-4 w-4 mr-1" />Kanban
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setViewMode('tags')}
                    className={viewMode === 'tags' ? 'bg-violet-600 text-white hover:bg-violet-500' : ''} style={viewMode !== 'tags' ? { color: mutedText } : {}}>
                    <TagIcon className="h-4 w-4 mr-1" />Tags
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setViewMode('timeline')}
                    className={viewMode === 'timeline' ? 'bg-violet-600 text-white hover:bg-violet-500' : ''} style={viewMode !== 'timeline' ? { color: mutedText } : {}}>
                    <CheckSquare className="h-4 w-4 mr-1" />Timeline
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setViewMode('reminders')}
                    className={viewMode === 'reminders' ? 'bg-violet-600 text-white hover:bg-violet-500' : ''} style={viewMode !== 'reminders' ? { color: mutedText } : {}}>
                    <Bell className="h-4 w-4 mr-1" />Reminder
                    {todayReminders.length > 0 && (
                      <span className="ml-2 text-xs font-semibold bg-violet-500 text-white px-2 py-0.5 rounded-full">{todayReminders.length}</span>
                    )}
                  </Button>
                </div>
                <Button onClick={handleSync} disabled={isSyncing} size="sm"
                  className="bg-violet-600 hover:bg-violet-500 text-white font-semibold">
                  <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Sync...' : 'Sync'}
                </Button>
                <Link to={createPageUrl('Settings')}>
                  <Button variant="outline" size="sm" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: isLight ? '#3a3a5a' : '#d4d4d8' }}>
                    <Settings className="h-4 w-4" />
                  </Button>
                </Link>
                <Button onClick={() => setNewMailDialogOpen(true)} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white">
                  <Plus className="h-4 w-4 mr-1" />Neue Mail
                </Button>
                {viewMode === 'columns' && (
                  <Button onClick={() => setShowAddColumn(true)} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white">
                    <Plus className="h-4 w-4 mr-1" />Spalte
                  </Button>
                )}
              </div>
            </div>
            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: mutedText }} />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Mails suchen..."
                  style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputText }}
                  className="pl-9 pr-8 py-2 text-sm border rounded-lg placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-lg h-9" />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: mutedText }}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {todayReminders.length > 0 && (
                <Button onClick={() => setViewMode('reminders')} variant="ghost" className="text-amber-400">
                  <Bell className="h-4 w-4 mr-2" />{todayReminders.length}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden relative flex flex-col">
          {colLoading || mailLoading ? (
            <div className="flex items-center justify-center h-full">
              <p style={{ color: mutedText }}>Laden...</p>
            </div>
          ) : viewMode === 'columns' ? (
            isMobile ? (
              /* Mobile: column nav + single column */
              <DragDropContext onDragEnd={handleDragEnd}>
                <div className="flex-1 flex flex-col overflow-hidden">
                  {columns.length > 0 && (mobileActiveColumnId || columns[0]?.id) && (
                    <>
                      {/* Mobile Column Tab Navigation */}
                      <MobileMailColumnNav
                        columns={columns}
                        activeId={mobileActiveColumnId || columns[0]?.id}
                        onChangeId={setMobileActiveColumnId}
                        getCount={(col) => filteredMails.filter(m => m.column_id === col.id).length}
                      />

                      {/* Mobile Mails List */}
                      <Droppable droppableId="mobile-column" type="MAIL">
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="flex-1 overflow-y-auto px-3 pt-3 pb-20"
                            style={{ backgroundColor: pageBg }}
                          >
                            {(() => {
                              const col = columns.find(c => c.id === (mobileActiveColumnId || columns[0]?.id));
                              if (!col) return null;
                              const mails = filteredMails.filter(m => m.column_id === col.id);
                              return mails.length === 0 ? (
                                <div className="flex items-center justify-center h-full">
                                  <p style={{ color: mutedText }}>Keine Mails</p>
                                </div>
                              ) : (
                                mails.map((mail, idx) => (
                                  <Draggable key={mail.id} draggableId={mail.id} index={idx}>
                                    {(provided) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className="mb-2"
                                      >
                                        <div
                                                        onClick={() => handleMailClick(mail)}
                                                        className="p-3 rounded-lg border cursor-pointer transition-colors"
                                                        style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}
                                        >
                                          <p className="text-sm font-medium truncate" style={{ color: titleText }}>{mail.subject}</p>
                                          <p className="text-xs mt-1" style={{ color: mutedText }}>{mail.sender_name}</p>
                                        </div>
                                      </div>
                                    )}
                                  </Draggable>
                                ))
                              );
                            })()}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </>
                  )}
                </div>
              </DragDropContext>
              ) : (
              <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="columns" type="COLUMN" direction="horizontal">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="flex gap-4 h-full overflow-x-auto pb-4 px-6 pt-4"
                  >
                    {columns.map((col, idx) => (
                       <Draggable key={col.id} draggableId={`col-${col.id}`} index={idx}>
                         {(provided) => (
                           <div
                             ref={provided.innerRef}
                             {...provided.draggableProps}
                             style={provided.draggableProps.style}
                             className="flex-shrink-0 h-full"
                           >
                             <KanbanColumn
                               column={col}
                               index={idx}
                               mails={filteredMails.filter(m => m.column_id === col.id)}
                               onMailClick={handleMailClick}
                               onRename={(id, name) => updateColumnMutation.mutate({ id, data: { name } })}
                               onDelete={(id) => deleteColumnMutation.mutate(id)}
                               onChangeColor={(id, color) => updateColumnMutation.mutate({ id, data: { color } })}
                               isCollapsed={collapsedColumns.has(col.id)}
                               onToggleCollapse={(id) => {
                                 const newSet = new Set(collapsedColumns);
                                 if (newSet.has(id)) newSet.delete(id);
                                 else newSet.add(id);
                                 setCollapsedColumns(newSet);
                               }}
                               showDateGrouping={showDateGrouping}
                               globalDateCollapse={globalDateCollapse}
                               columnDragHandleProps={provided.dragHandleProps}
                             />
                           </div>
                         )}
                       </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
              </DragDropContext>
              )
          ) : viewMode === 'tags' ? (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="flex gap-4 h-full overflow-x-auto pb-4 px-6 pt-4">
                {(() => {
                   const allTags = [...new Set(filteredMails.flatMap(m => m.tags || []))];
                   const untagged = filteredMails.filter(m => !m.tags || m.tags.length === 0);
                   return [
                     ...allTags.map((tag, idx) => (
                       <Droppable key={tag} droppableId={`tag-${tag}`} type="MAIL">
                         {(provided) => (
                           <div ref={provided.innerRef} {...provided.droppableProps}>
                             <TagColumn
                               tagName={tag}
                               index={idx}
                               mails={filteredMails.filter(m => (m.tags || []).includes(tag))}
                               tasks={allTasks.filter(t => (t.tags || []).includes(tag))}
                               onMailClick={setSelectedMail}
                               isCollapsed={collapsedTags.has(tag)}
                               onToggleCollapse={(t) => {
                                 const newSet = new Set(collapsedTags);
                                 if (newSet.has(t)) newSet.delete(t);
                                 else newSet.add(t);
                                 setCollapsedTags(newSet);
                               }}
                             />
                             {provided.placeholder}
                           </div>
                         )}
                       </Droppable>
                     )),
                     untagged.length > 0 && (
                       <Droppable key="__untagged__" droppableId="tag-__untagged__" type="MAIL">
                         {(provided) => (
                           <div ref={provided.innerRef} {...provided.droppableProps}>
                             <TagColumn
                               tagName="Ohne Tag"
                               index={allTags.length}
                               mails={untagged}
                               tasks={[]}
                               onMailClick={setSelectedMail}
                               isCollapsed={collapsedTags.has('__untagged__')}
                               onToggleCollapse={(t) => {
                                 const newSet = new Set(collapsedTags);
                                 const key = '__untagged__';
                                 if (newSet.has(key)) newSet.delete(key);
                                 else newSet.add(key);
                                 setCollapsedTags(newSet);
                               }}
                             />
                             {provided.placeholder}
                           </div>
                         )}
                       </Droppable>
                     )
                   ].filter(Boolean);
                 })()}
              </div>
            </DragDropContext>
          ) : viewMode === 'timeline' ? (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="flex gap-4 h-full overflow-x-auto pb-4 px-6 pt-4">
                {(() => {
                  const groups = {};
                  filteredMails.forEach(mail => {
                    const date = mail.received_date ? new Date(mail.received_date).toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' }) : 'Kein Datum';
                    if (!groups[date]) groups[date] = [];
                    groups[date].push(mail);
                  });
                  return Object.entries(groups).map(([date, mails], idx) => (
                    <Droppable key={date} droppableId={`timeline-${date}`} type="MAIL">
                      {(provided) => (
                        <div ref={provided.innerRef} {...provided.droppableProps}>
                          <TimelineColumn
                            columnId={`timeline-${date}`}
                            title={date}
                            mails={mails}
                            isCollapsed={collapsedTimeline.has(date)}
                            onToggleCollapse={(id) => {
                              const newSet = new Set(collapsedTimeline);
                              if (newSet.has(date)) newSet.delete(date);
                              else newSet.add(date);
                              setCollapsedTimeline(newSet);
                            }}
                            onMailClick={setSelectedMail}
                          />
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  ));
                })()}
              </div>
            </DragDropContext>
          ) : viewMode === 'reminders' ? (
            <div className="h-full overflow-y-auto px-6 py-4" style={{ backgroundColor: pageBg }}>
              <div className="max-w-3xl mx-auto space-y-8">
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setViewMode('columns')} style={{ color: mutedText }}>
                    ✕ Schliessen
                  </Button>
                </div>
                {(() => {
                  const now = new Date();
                  const reminders = filteredMails
                    .filter(m => m.reminder_date)
                    .sort((a, b) => new Date(a.reminder_date) - new Date(b.reminder_date));
                  if (reminders.length === 0) return (
                    <div className="flex items-center justify-center h-64" style={{ color: mutedText }}>
                      <div className="text-center">
                        <Bell className="h-12 w-12 mx-auto mb-3 opacity-40" />
                        <p>Keine Reminder gesetzt</p>
                      </div>
                    </div>
                  );
                  const overdue = reminders.filter(m => new Date(m.reminder_date) < now && !isToday(new Date(m.reminder_date)));
                  const today = reminders.filter(m => isToday(new Date(m.reminder_date)));
                  const upcoming = reminders.filter(m => new Date(m.reminder_date) > now && !isToday(new Date(m.reminder_date)));
                  const renderGroup = (title, items, color) => items.length === 0 ? null : (
                    <div className="space-y-3">
                      <h3 className={`text-sm font-bold uppercase tracking-wider ${color}`}>{title}
                        <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full" style={{ backgroundColor: isArtis ? '#e6ede6' : isLight ? '#d4f0d4' : '#4a7c5a', color: isArtis ? '#2d3a2d' : isLight ? '#2d5a2d' : '#a8d9a8' }}>{items.length}</span>
                      </h3>
                      <div className="space-y-2">
                        {items.map(mail => (
                          <div key={mail.id} className="rounded-xl p-4 border transition-colors"
                            style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedMail(mail)}>
                                <p className="text-sm font-medium truncate" style={{ color: titleText }}>{mail.subject}</p>
                                <p className="text-xs mt-0.5" style={{ color: mutedText }}>{mail.sender_name}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs" style={{ color: mutedText }}>{new Date(mail.reminder_date).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-red-400 hover:bg-red-400/10" style={{ color: mutedText }}
                                  onClick={async () => {
                                    try { await updateMailMutation.mutateAsync({ id: mail.id, data: { reminder_date: null } }); toast.success('Reminder gelöscht'); }
                                    catch (e) { toast.error('Fehler: ' + e.message); }
                                  }}>
                                  <span className="text-sm">✕</span>
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                  return [
                    renderGroup('🚨 Überfällig', overdue, 'text-red-400'),
                    renderGroup('📌 Heute', today, 'text-amber-400'),
                    renderGroup('📅 Demnächst', upcoming, 'text-blue-400'),
                  ];
                })()}
              </div>
            </div>
          ) : null}


        </div>
      </div>

      {/* Resizable Divider + Detail Panel */}
      {selectedMail && (
        <>
          {/* Drag Handle */}
          <div
            className="w-1.5 flex-shrink-0 hover:bg-violet-600 cursor-col-resize transition-colors active:bg-violet-500 relative group"
            style={{ backgroundColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : '#3f3f46', userSelect: 'none' }}
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = panelWidth;
              const onMove = (ev) => {
                const delta = startX - ev.clientX;
                const newWidth = Math.max(320, Math.min(900, startWidth + delta));
                setPanelWidth(newWidth);
              };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex flex-col gap-1">
                <div className="w-0.5 h-4 bg-violet-400 rounded-full" />
                <div className="w-0.5 h-4 bg-violet-400 rounded-full" />
                <div className="w-0.5 h-4 bg-violet-400 rounded-full" />
              </div>
            </div>
          </div>
          <div style={{ width: panelWidth, flexShrink: 0 }} className="flex flex-col overflow-hidden">
          <MailDetailPanel
          mail={selectedMail}
          onClose={() => setSelectedMail(null)}
          onReply={() => {
            setReplyingToMail(selectedMail);
            setReplyDialogOpen(true);
          }}
          onEdit={() => {
            setEditingMail(selectedMail);
            setEditDialogOpen(true);
          }}
          onToggleComplete={(mail) => {
            updateMailMutation.mutate({ id: mail.id, data: { is_completed: !mail.is_completed } });
            setSelectedMail({ ...mail, is_completed: !mail.is_completed });
          }}
          onConvertToTask={(mail) => {
            setMailToConvert(mail);
            setConvertMailDialogOpen(true);
          }}
          onDelete={async (mail) => {
            try {
              await functions.invoke('deleteOutlookMail', { mail_id: mail.id });
              await entities.MailItem.update(mail.id, { is_archived: true });
              queryClient.setQueryData(["mailItems", currentUser?.id], (old) =>
                old ? old.filter(m => m.id !== mail.id) : old
              );
              setSelectedMail(null);
              toast.success('E-Mail in Outlook-Papierkorb verschoben');
            } catch (e) {
              toast.error('Fehler: ' + e.message);
            }
          }}
          onDeleteLocal={async (mail) => {
            try {
              await entities.MailItem.update(mail.id, { is_archived: true });
              queryClient.setQueryData(["mailItems", currentUser?.id], (old) =>
                old ? old.filter(m => m.id !== mail.id) : old
              );
              setSelectedMail(null);
              toast.success('Aus Kanban entfernt');
            } catch (e) {
              toast.error('Fehler: ' + e.message);
            }
          }}
          />
          </div>
        </>
      )}

      {/* Dialogs */}
      {showAddColumn && (
        <AddColumnDialog
          open={showAddColumn}
          onClose={() => setShowAddColumn(false)}
          onAdd={(data) => addColumnMutation.mutate(data)}
        />
      )}

      {replyDialogOpen && replyingToMail && (
        <ReplyDialog
          open={replyDialogOpen}
          mail={replyingToMail}
          onClose={() => {
            setReplyDialogOpen(false);
            setReplyingToMail(null);
          }}
        />
      )}

      {editDialogOpen && editingMail && (
        <EditMailDialog
          open={editDialogOpen}
          mail={editingMail}
          onClose={() => {
            setEditDialogOpen(false);
            setEditingMail(null);
          }}
          onUpdate={(data) => {
            updateMailMutation.mutate({ id: editingMail.id, data });
            setEditingMail(null);
            setEditDialogOpen(false);
          }}
        />
      )}

      {newMailDialogOpen && (
        <NewMailDialog
          open={newMailDialogOpen}
          onClose={() => setNewMailDialogOpen(false)}
        />
      )}

      {convertMailDialogOpen && mailToConvert && (
        <ConvertToTaskDialog
          open={convertMailDialogOpen}
          mail={mailToConvert}
          columns={taskColumns}
          onClose={() => {
            setConvertMailDialogOpen(false);
            setMailToConvert(null);
          }}
          onConvert={async (taskData) => {
            try {
              await entities.Task.create(taskData);
              toast.success('Task erstellt');
              queryClient.invalidateQueries({ queryKey: ["allTasks"] });
            } catch (e) {
              toast.error('Fehler: ' + e.message);
            }
            setConvertMailDialogOpen(false);
            setMailToConvert(null);
          }}
        />
      )}

      {showDailyReminders && todayReminders.length > 0 && (
        <DailyReminderPopup
          reminders={todayReminders}
          onClose={() => setShowDailyReminders(false)}
        />
      )}
    </div>
  );
}