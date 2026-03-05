import React, { useState, useContext } from "react";
import { entities, functions, auth, supabase } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, MessageSquare, Link2, Tag as TagIcon, FolderOpen, Plus, Trash2, Save, Users, Send, Calendar, Menu, ChevronDown, LayoutDashboard, CheckSquare, RefreshCw, ClipboardList, GripVertical, UserMinus, Pencil, Check, X, Sun, Moon, KeyRound } from "lucide-react";
import { ThemeContext } from "@/Layout";
import DeleteUserDialog from "@/components/settings/DeleteUserDialog";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

export default function Settings() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useContext(ThemeContext);
  const [activeTab, setActiveTab] = useState('signature');
  const [emailSignature, setEmailSignature] = useState('');
  const [chatSignature, setChatSignature] = useState('');
  const [newTag, setNewTag] = useState({ name: '', color: '#6366f1' });
  const [editingTag, setEditingTag] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editLevel, setEditLevel] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [newLevel, setNewLevel] = useState(1);
  const [newProject, setNewProject] = useState({ name: '', color: '#8b5cf6', description: '' });
  const [newDomainRule, setNewDomainRule] = useState({ domain: '', tag: '', customer_id: '' });
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [syncDays, setSyncDays] = useState(60);
  const [newActivityName, setNewActivityName] = useState('');
  const [newStaff, setNewStaff] = useState({ name: '', email: '' });
  const [deleteUserDialogOpen, setDeleteUserDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUserRole, setEditingUserRole] = useState('');
  const [editingUserNameId, setEditingUserNameId] = useState(null);
  const [editingUserNameValue, setEditingUserNameValue] = useState('');
  const [invitingEmail, setInvitingEmail] = useState('');
  const [invitedUsers, setInvitedUsers] = useState(() => {
    const stored = localStorage.getItem('invitedUsers');
    return stored ? JSON.parse(stored) : [];
  });
  const [assigningTagToAll, setAssigningTagToAll] = useState({});

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const u = await auth.me();
      setEmailSignature(u.email_signature || '');
      setChatSignature(u.chat_signature || '');
      setSyncDays(u.sync_days || 60);
      return u;
    }
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ['priorities'],
    queryFn: () => entities.Priority.list("level"),
  });

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      if (!user) return [];
      return entities.Tag.filter({ created_by: user.id });
    },
    enabled: !!user
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => entities.Project.list()
  });

  const { data: domainRules = [] } = useQuery({
    queryKey: ['domainRules'],
    queryFn: async () => {
      if (!user) return [];
      return entities.DomainTagRule.filter({ created_by: user.id });
    },
    enabled: !!user
  });

  // Use getAllUsers edge function (bypasses RLS with service_role key)
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await functions.invoke('getAllUsers', {});
      return data?.users || [];
    },
    enabled: user?.role === 'admin'
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => entities.Customer.list("company_name"),
    enabled: activeTab === 'domain-rules',
  });

  const { data: activityTemplates = [] } = useQuery({
    queryKey: ['activityTemplates'],
    queryFn: () => entities.ActivityTemplate.list("order"),
  });

  const { data: staffList = [], refetch: refetchStaff } = useQuery({
    queryKey: ['staff'],
    queryFn: () => entities.Staff.list("order"),
  });

  const createStaffMutation = useMutation({
    mutationFn: (data) => entities.Staff.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      setNewStaff({ name: '', email: '' });
      toast.success('Mitarbeiter erstellt');
    }
  });

  const deleteStaffMutation = useMutation({
    mutationFn: (id) => entities.Staff.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Mitarbeiter gelöscht');
    }
  });

  const updateStaffUserMutation = useMutation({
    mutationFn: ({ id, user_id }) => entities.Staff.update(id, { user_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Login-User verknüpft');
    }
  });

  const createActivityTemplateMutation = useMutation({
    mutationFn: (data) => entities.ActivityTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activityTemplates'] });
      setNewActivityName('');
      toast.success('Tätigkeit erstellt');
    }
  });

  const deleteActivityTemplateMutation = useMutation({
    mutationFn: (id) => entities.ActivityTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activityTemplates'] });
      toast.success('Tätigkeit gelöscht');
    }
  });

  const reorderActivityTemplatesMutation = useMutation({
    mutationFn: async (reordered) => {
      for (const t of reordered) {
        await entities.ActivityTemplate.update(t.id, { order: t.order });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activityTemplates'] })
  });

  const handleActivityTemplateDragEnd = (result) => {
    if (!result.destination) return;
    const reordered = Array.from(activityTemplates);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    reorderActivityTemplatesMutation.mutate(reordered.map((a, i) => ({ ...a, order: i })));
  };

  const inviteUserMutation = useMutation({
    mutationFn: async ({ email, role }) => {
      console.log('Inviting user:', email, role);
      return await functions.invoke('inviteUser', { email, role });
    },
    onSuccess: (_, { email, role }) => {
      console.log('Invite successful:', email, role);
      const newInvited = [...invitedUsers, { email, role, invitedAt: new Date().toISOString() }];
      setInvitedUsers(newInvited);
      localStorage.setItem('invitedUsers', JSON.stringify(newInvited));
      toast.success(`Einladung versendet an ${email}`);
      setInviteEmail('');
      setInviteRole('user');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      console.error('Invite error:', error);
      toast.error('Fehler beim Einladen: ' + error.message);
    }
  });

  const updateSignatureMutation = useMutation({
    mutationFn: (data) => auth.updateMe(data),
    onSuccess: () => {
      toast.success('Signatur gespeichert');
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    }
  });

  const createTagMutation = useMutation({
    mutationFn: (data) => entities.Tag.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewTag({ name: '', color: '#6366f1' });
      toast.success('Tag erstellt');
    }
  });

  const deleteTagMutation = useMutation({
    mutationFn: (id) => entities.Tag.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      toast.success('Tag gelöscht');
    }
  });

  const updateTagMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Tag.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setEditingTag(null);
      toast.success('Tag aktualisiert');
    }
  });

  const createPriorityMutation = useMutation({
    mutationFn: (data) => entities.Priority.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["priorities"] });
      toast.success("Priorität erstellt");
      setIsAdding(false);
      setNewName('');
      setNewColor('#6366f1');
      setNewLevel(1);
    },
  });

  const updatePriorityMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Priority.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["priorities"] });
      toast.success("Priorität aktualisiert");
      setEditingId(null);
    },
  });

  const deletePriorityMutation = useMutation({
    mutationFn: (id) => entities.Priority.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["priorities"] });
      toast.success("Priorität gelöscht");
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: (data) => entities.Project.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setNewProject({ name: '', color: '#8b5cf6', description: '' });
      toast.success('Projekt erstellt');
    }
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (id) => entities.Project.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Projekt gelöscht');
    }
  });

  const createDomainRuleMutation = useMutation({
    mutationFn: (data) => entities.DomainTagRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domainRules'] });
      setNewDomainRule({ domain: '', tag: '', customer_id: '' });
      setCustomerSearch('');
      toast.success('Domain-Regel erstellt');
    },
    onError: (e) => toast.error('Fehler beim Erstellen: ' + e.message),
  });

  const deleteDomainRuleMutation = useMutation({
    mutationFn: (id) => entities.DomainTagRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domainRules'] });
      toast.success('Domain-Regel gelöscht');
    }
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ id, role }) => {
      const { data } = await functions.invoke('makeAdmin', { user_id: id, role });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUserId(null);
      toast.success('Rolle aktualisiert');
    },
    onError: () => toast.error('Fehler beim Aktualisieren der Rolle')
  });

  const updateUserNameMutation = useMutation({
    mutationFn: async ({ id, full_name }) => {
      // Direkt supabase schlägt wegen RLS fehl – Edge Function mit service_role nutzen
      await functions.invoke('updateUserProfile', { user_id: id, full_name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUserNameId(null);
      toast.success('Name aktualisiert');
    },
    onError: (e) => toast.error('Fehler: ' + e.message),
  });

  const handleResetPassword = async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password',
      });
      if (error) throw error;
      toast.success(`Passwort-Reset E-Mail an ${email} gesendet`);
    } catch (e) {
      toast.error('Fehler: ' + e.message);
    }
  };

  const handleOutlookConnect = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { toast.error('Nicht eingeloggt'); return; }
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/microsoft-auth?state=${session.access_token}`;
      window.location.href = fnUrl;
    } catch (error) {
      toast.error('Fehler: ' + error.message);
    }
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');

  const handleFirstSync = async () => {
    if (!confirm(`ACHTUNG: Alle deine Mails werden gelöscht und die letzten ${syncDays} Tage neu von Outlook synchronisiert.\n\nFortfahren?`)) return;
    setIsSyncing(true);
    setSyncProgress('');
    try {
      // Schritt 1: Reset (löschen + deltaLink zurücksetzen)
      setSyncProgress('Lösche bestehende Mails...');
      const resetRes = await functions.invoke('reset-and-sync', {});
      const deleted = resetRes.data?.deleted || 0;
      setSyncProgress(`${deleted} Mails gelöscht. Starte Sync...`);

      // Schritt 2: Sync in Schleife über sync-outlook-mails
      let totalInserted = 0;
      let hasMore = true;
      let batch = 0;
      const MAX_BATCHES = 200;
      while (hasMore && batch < MAX_BATCHES) {
        batch++;
        const { data } = await functions.invoke('sync-outlook-mails', { sync_days: syncDays });
        totalInserted += data.inserted || 0;
        hasMore = data.hasMore === true;
        setSyncProgress(`Synchronisiert: ${totalInserted} Mails (Batch ${batch})...`);
        if (hasMore) await new Promise(r => setTimeout(r, 200));
      }

      toast.success(`Fertig! ${deleted} gelöscht, ${totalInserted} Mails synchronisiert.`);
      setSyncProgress('');
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      queryClient.invalidateQueries({ queryKey: ['mailItems'] });
      queryClient.invalidateQueries({ queryKey: ['kanbanColumns'] });
    } catch (error) {
      toast.error('Fehler: ' + (error.response?.data?.error || error.message));
      setSyncProgress('');
    } finally {
      setIsSyncing(false);
    }
  };

  const startEdit = (priority) => {
    setEditingId(priority.id);
    setEditName(priority.name);
    setEditColor(priority.color);
    setEditLevel(priority.level);
  };

  const saveEdit = () => {
    if (!editName.trim()) return;
    updatePriorityMutation.mutate({
      id: editingId,
      data: { name: editName.trim(), color: editColor, level: editLevel }
    });
  };

  const handleAddPriority = () => {
    if (!newName.trim()) return;
    createPriorityMutation.mutate({
      name: newName.trim(),
      color: newColor,
      level: newLevel
    });
  };

  const predefinedColors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', 
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e'
  ];

  const quillModules = {
    toolbar: [
      ['bold', 'italic', 'underline'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'size': ['small', false, 'large', 'huge'] }],
      [{ 'align': [] }],
      ['link'],
      ['clean']
    ]
  };

  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const isDark = !isLight && !isArtis;
  const pageBg = isLight ? '#f2f2f7' : isArtis ? '#f2f5f2' : '#2a2a2f';
  const sidebarBg = isLight ? '#eaeaf2' : isArtis ? '#eaf0ea' : 'transparent';
  const sidebarBorder = isLight ? '#c8c8d8' : isArtis ? '#bfcfbf' : 'rgba(63,63,70,0.5)';
  const titleColor = isDark ? '#f4f4f5' : '#1c1c2e';
  const navActiveStyle = isArtis ? 'bg-[#7a9b7f] text-white' : 'bg-violet-600 text-white';
  const navInactiveStyle = (isLight || isArtis) ? 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900' : 'hover:bg-zinc-800/40 text-zinc-300';
  const cardBg = isDark ? 'rgba(24,24,27,0.4)' : '#ffffff';
  const cardBorder = isDark ? 'rgba(63,63,70,0.6)' : isArtis ? '#ccd8cc' : '#d4d4e8';
  const headingColor = isDark ? '#e4e4e7' : isArtis ? '#2d3a2d' : '#1a1a2e';
  const textMuted = isDark ? '#a1a1aa' : isArtis ? '#6b826b' : '#7a7a9a';
  const inputBg = isDark ? 'rgba(24,24,27,0.8)' : '#ffffff';
  const inputBorder = isDark ? '#3f3f46' : isArtis ? '#bfcfbf' : '#c8c8dc';
  const inputColor = isDark ? '#e4e4e7' : isArtis ? '#2d3a2d' : '#1a1a2e';
  const rowBg = isDark ? 'rgba(24,24,27,0.6)' : isArtis ? '#f5f8f5' : '#f7f7fc';
  const rowBorder = isDark ? '#3f3f46' : isArtis ? '#ccd8cc' : '#d4d4e8';

  return (
    <div className="h-screen flex overflow-hidden" style={{ backgroundColor: pageBg }}>
      {/* Left Sidebar Navigation */}
      <div className="w-64 flex-shrink-0 border-r p-6 overflow-y-auto" style={{ borderColor: sidebarBorder, backgroundColor: sidebarBg }}>
        <h1 className="text-2xl font-bold mb-8" style={{ color: titleColor }}>Einstellungen</h1>
        
        <div className="space-y-1">
          {user?.role !== 'task_user' && (
            <>
              <button
                onClick={() => setActiveTab('signature')}
                className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'signature' ? navActiveStyle : navInactiveStyle}`}
              >
                <Mail className="h-4 w-4" /> Signaturen
              </button>
              <button
                onClick={() => setActiveTab('outlook')}
                className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'outlook' ? navActiveStyle : navInactiveStyle}`}
              >
                <Link2 className="h-4 w-4" /> Outlook
              </button>
            </>
          )}
          <button
            onClick={() => setActiveTab('priorities')}
            className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'priorities' ? navActiveStyle : navInactiveStyle}`}
          >
            <TagIcon className="h-4 w-4" /> Task-Prioritäten
          </button>
          <button
            onClick={() => setActiveTab('tags')}
            className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'tags' ? navActiveStyle : navInactiveStyle}`}
          >
            <TagIcon className="h-4 w-4" /> Tags
          </button>
          <button
            onClick={() => setActiveTab('projects')}
            className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'projects' ? navActiveStyle : navInactiveStyle}`}
          >
            <FolderOpen className="h-4 w-4" /> Projekte
          </button>
          {user?.role !== 'task_user' && (
            <button
              onClick={() => setActiveTab('domain-rules')}
              className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'domain-rules' ? navActiveStyle : navInactiveStyle}`}
            >
              <Link2 className="h-4 w-4" /> Domain → Tags
            </button>
          )}
          <button
            onClick={() => setActiveTab('activities')}
            className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'activities' ? navActiveStyle : navInactiveStyle}`}
          >
            <ClipboardList className="h-4 w-4" /> Tätigkeiten
          </button>
          <button
            onClick={() => setActiveTab('appearance')}
            className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'appearance' ? navActiveStyle : navInactiveStyle}`}
          >
            {theme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} Darstellung
          </button>
          {user?.role === 'admin' && (
            <>
              <button
                onClick={() => setActiveTab('users')}
                className={`w-full justify-start flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'users' ? navActiveStyle : navInactiveStyle}`}
              >
                <Users className="h-4 w-4" /> Benutzer
              </button>

            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-8 overflow-y-auto">
        {/* Signaturen Tab */}
        {activeTab === 'signature' && (
          <div className="space-y-6">
            <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: headingColor }}>
                <Mail className="h-5 w-5" /> E-Mail Signatur
              </h3>
              <ReactQuill
                value={emailSignature}
                onChange={setEmailSignature}
                modules={quillModules}
                className="bg-white rounded-lg mb-4"
                theme="snow"
              />
              <Button
                onClick={() => updateSignatureMutation.mutate({ email_signature: emailSignature })}
                className="bg-indigo-600 hover:bg-indigo-500"
              >
                <Save className="h-4 w-4 mr-2" /> E-Mail Signatur speichern
              </Button>
            </div>

            <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: headingColor }}>
                <MessageSquare className="h-5 w-5" /> Chat Signatur
              </h3>
              <ReactQuill
                value={chatSignature}
                onChange={setChatSignature}
                modules={quillModules}
                className="bg-white rounded-lg mb-4"
                theme="snow"
              />
              <Button
                onClick={() => updateSignatureMutation.mutate({ chat_signature: chatSignature })}
                className="bg-indigo-600 hover:bg-indigo-500"
              >
                <Save className="h-4 w-4 mr-2" /> Chat Signatur speichern
              </Button>
            </div>
          </div>
        )}

        {/* Outlook Tab */}
         {activeTab === 'outlook' && (
           <div className="space-y-6">
             <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
               <h3 className="text-lg font-semibold mb-4" style={{ color: headingColor }}>Postfach-Konto</h3>
               
               {/* Current Mailbox Selection */}
               <div className="mb-6 p-4 rounded-lg border" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                 <label className="text-sm block mb-2" style={{ color: textMuted }}>
                   Aktuelles Postfach für gesendete Mails
                 </label>
                 <div className="flex gap-2">
                   <Input
                     type="email"
                     value={user?.current_mailbox || ''}
                     onChange={(e) => {}}
                     placeholder="z.B. sascha.bigger@artis-gmbh.ch"
                     style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }}
                     disabled
                   />
                   <Button
                     onClick={() => {
                       const email = prompt('Postfach-E-Mail-Adresse:', user?.current_mailbox || '');
                       if (email) {
                         updateSignatureMutation.mutate({ current_mailbox: email.trim() });
                       }
                     }}
                     className="bg-indigo-600 hover:bg-indigo-500 whitespace-nowrap"
                   >
                     Ändern
                   </Button>
                 </div>
                 {user?.current_mailbox && (
                   <p className="text-xs mt-2" style={{ color: textMuted }}>Aktuell: {user.current_mailbox}</p>
                 )}
               </div>
               <p className="mb-4" style={{ color: textMuted }}>
                 Verbinden oder wechseln Sie Ihr Microsoft Outlook-Konto.
               </p>
               <div className="space-y-3">
                 {user?.microsoft_access_token ? (
                   <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                     <p className="text-green-400 text-sm">✓ Mit Outlook verbunden als {user.microsoft_outlook_email || user.email}</p>
                   </div>
                 ) : (
                   <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                     <p className="text-yellow-400 text-sm">Noch nicht verbunden</p>
                   </div>
                 )}
                 <div className="flex gap-2">
                   <Button onClick={handleOutlookConnect} className="bg-blue-600 hover:bg-blue-500">
                     <Link2 className="h-4 w-4 mr-2" /> 
                     {user?.microsoft_access_token ? 'Neu verbinden' : 'Mit Outlook verbinden'}
                   </Button>
                   {user?.microsoft_access_token && (
                     <Button
                       onClick={async () => {
                         if (confirm('Microsoft-Verbindung trennen? Sie müssen sich danach erneut verbinden.')) {
                           try {
                             await auth.updateMe({ microsoft_access_token: null, microsoft_refresh_token: null, microsoft_delta_link: null });
                             toast.success('Verbindung getrennt');
                             queryClient.invalidateQueries({ queryKey: ['currentUser'] });
                           } catch (error) {
                             toast.error('Fehler: ' + error.message);
                           }
                         }
                       }}
                       variant="outline"
                       className="border-red-600/30 text-red-400 hover:bg-red-600/10 hover:text-red-300"
                     >
                       Disconnect
                     </Button>
                   )}
                   </div>
                   </div>
                   </div>

                   <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
                   <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: headingColor }}>
                     <Calendar className="h-5 w-5" /> Sync-Einstellungen
                   </h3>
                   <div className="space-y-4">
                     <div>
                       <label className="text-sm block mb-2" style={{ color: textMuted }}>
                         Sync-Tage (Standard: 60, Min: 1, Max: 365)
                       </label>
                       <div className="flex gap-2">
                         <Input
                           type="number"
                           min="1"
                           max="3650"
                           value={syncDays}
                           onChange={(e) => setSyncDays(Math.max(1, parseInt(e.target.value) || 60))}
                           style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }}
                           className="w-32"
                         />
                         <Button
                           onClick={() => updateSignatureMutation.mutate({ sync_days: syncDays })}
                           className="bg-indigo-600 hover:bg-indigo-500"
                         >
                           <Save className="h-4 w-4 mr-2" /> Speichern
                         </Button>
                       </div>
                     </div>
                   </div>
                   </div>

                   <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
                   <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: headingColor }}>
                     <RefreshCw className="h-5 w-5" /> Erster Sync / Reset
                   </h3>
                   <p className="mb-2" style={{ color: textMuted }}>
                     Löscht alle deine Mails und synchronisiert die letzten <strong style={{ color: headingColor }}>{syncDays} Tage</strong> neu von Outlook.
                   </p>
                   <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg mb-4">
                     <p className="text-red-400 text-sm">⚠️ Alle bestehenden E-Mails werden unwiderruflich gelöscht und neu synchronisiert!</p>
                   </div>
                   {!user?.microsoft_access_token && !user?.microsoft_refresh_token ? (
                     <p className="text-zinc-500 text-sm">Zuerst mit Outlook verbinden.</p>
                   ) : (
                     <Button onClick={handleFirstSync} disabled={isSyncing} className="bg-red-600 hover:bg-red-500">
                       <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                       {isSyncing ? 'Läuft...' : 'Erster Sync (Alles löschen & neu laden)'}
                     </Button>
                   )}
                   {syncProgress && (
                     <p className="text-sm mt-3" style={{ color: textMuted }}>{syncProgress}</p>
                   )}
                   {!syncProgress && <p className="text-xs mt-3" style={{ color: textMuted }}>Der Sync läuft vollständig durch – alle Batches werden automatisch geladen.</p>}
                   </div>
          </div>
        )}

        {/* Task-Prioritäten Tab */}
        {activeTab === 'priorities' && (
         <div>
           <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
             <h3 className="text-lg font-semibold mb-4" style={{ color: headingColor }}>Task-Prioritäten verwalten</h3>

             {/* Add New Priority */}
             {isAdding ? (
               <div className="rounded-lg p-4 mb-6 border" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                 <h4 className="text-sm font-semibold mb-4" style={{ color: headingColor }}>Neue Priorität</h4>
                 <div className="grid grid-cols-3 gap-4 mb-4">
                   <div className="space-y-2">
                     <label className="text-xs" style={{ color: textMuted }}>Name</label>
                     <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="z.B. Kritisch" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs" style={{ color: textMuted }}>Stufe (1 = höchste)</label>
                     <Input type="number" min="1" value={newLevel} onChange={(e) => setNewLevel(parseInt(e.target.value) || 1)} style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs" style={{ color: textMuted }}>Farbe</label>
                     <Input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-16 h-10" style={{ backgroundColor: inputBg, borderColor: inputBorder }} />
                   </div>
                 </div>
                 <div className="flex gap-2 flex-wrap mb-4">
                   {predefinedColors.map((color) => (
                     <button key={color} onClick={() => setNewColor(color)} className="w-6 h-6 rounded-lg border-2 hover:scale-110 transition-transform" style={{ backgroundColor: color, borderColor: rowBorder }} />
                   ))}
                 </div>
                  <div className="flex gap-2">
                    <Button onClick={handleAddPriority} className="bg-green-600 hover:bg-green-500"><Plus className="h-4 w-4 mr-2" /> Erstellen</Button>
                    <Button variant="ghost" onClick={() => setIsAdding(false)} style={{ color: textMuted }}>Abbrechen</Button>
                  </div>
                </div>
              ) : (
                <Button onClick={() => setIsAdding(true)} className="bg-indigo-600 hover:bg-indigo-500 mb-6"><Plus className="h-4 w-4 mr-2" /> Neue Priorität</Button>
              )}

              {/* Priority List */}
              <div className="space-y-3">
                {priorities.length === 0 ? (
                  <p className="text-sm py-4" style={{ color: textMuted }}>Noch keine Prioritäten definiert</p>
                ) : (
                  priorities.map((priority) => (
                    <div key={priority.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                      {editingId === priority.id ? (
                        <div className="flex-1 flex gap-2">
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
                          <Input type="number" min="1" value={editLevel} onChange={(e) => setEditLevel(parseInt(e.target.value) || 1)} className="w-20" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
                          <Input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="w-12 h-10" style={{ backgroundColor: inputBg, borderColor: inputBorder }} />
                          <Button size="sm" onClick={saveEdit} className="bg-green-600 hover:bg-green-500"><Save className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} style={{ color: textMuted }}>✕</Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: priority.color }} />
                            <div>
                              <div className="font-medium" style={{ color: headingColor }}>{priority.name}</div>
                              <div className="text-xs" style={{ color: textMuted }}>Stufe {priority.level}</div>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => startEdit(priority)} style={{ color: textMuted }}>
                              Bearbeiten
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm(`Priorität "${priority.name}" wirklich löschen?`)) {
                                  deletePriorityMutation.mutate(priority.id);
                                }
                              }}
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tags Tab */}
        {activeTab === 'tags' && (
         <div>
           <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
             <h3 className="text-lg font-semibold mb-4" style={{ color: headingColor }}>Tags verwalten</h3>

             <div className="flex gap-2 mb-6">
               <Input value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} placeholder="Neuer Tag-Name" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
               <input type="color" value={newTag.color} onChange={(e) => setNewTag({ ...newTag, color: e.target.value })} className="w-12 h-10 rounded" style={{ borderColor: inputBorder }} />
                <Button
                  onClick={() => newTag.name && createTagMutation.mutate(newTag)}
                  className="bg-indigo-600 hover:bg-indigo-500"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {tags.map((tag) => (
                  <div key={tag.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                    {editingTag?.id === tag.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input value={editingTag.name} onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })} className="flex-1" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
                        <input type="color" value={editingTag.color} onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })} className="w-12 h-10 rounded" style={{ borderColor: inputBorder }} />
                        <Button size="sm" onClick={() => updateTagMutation.mutate({ id: tag.id, data: { name: editingTag.name, color: editingTag.color } })} className="bg-green-600 hover:bg-green-500"><Save className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingTag(null)} style={{ color: textMuted }}>✕</Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded" style={{ backgroundColor: tag.color || '#6366f1' }} />
                          <span style={{ color: headingColor }}>{tag.name}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditingTag({ id: tag.id, name: tag.name, color: tag.color || '#6366f1' })} style={{ color: textMuted }}>
                            Bearbeiten
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteTagMutation.mutate(tag.id)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Projekte Tab */}
        {activeTab === 'projects' && (
         <div>
           <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
             <h3 className="text-lg font-semibold mb-4" style={{ color: headingColor }}>Projekte verwalten</h3>

             <div className="flex gap-2 mb-6">
               <Input value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} placeholder="Projekt-Name" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
               <Input value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} placeholder="Beschreibung" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
               <input type="color" value={newProject.color} onChange={(e) => setNewProject({ ...newProject, color: e.target.value })} className="w-12 h-10 rounded" style={{ borderColor: inputBorder }} />
                <Button
                  onClick={() => newProject.name && createProjectMutation.mutate(newProject)}
                  className="bg-indigo-600 hover:bg-indigo-500"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {projects.map((project) => (
                  <div key={project.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: project.color || '#8b5cf6' }} />
                      <div>
                        <div className="font-medium" style={{ color: headingColor }}>{project.name}</div>
                        {project.description && (
                          <div className="text-xs" style={{ color: textMuted }}>{project.description}</div>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteProjectMutation.mutate(project.id)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Domain → Tags Tab */}
        {activeTab === 'domain-rules' && (
         <div className="space-y-6">
           <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
             <div className="flex items-center justify-between mb-4">
               <div>
                 <h3 className="text-lg font-semibold" style={{ color: headingColor }}>Auto-Tagging nach Domain</h3>
                 <p className="text-sm mt-1" style={{ color: textMuted }}>
                   Emails von bestimmten Domains werden automatisch mit einem Tag versehen.
                 </p>
               </div>
             </div>

             <div className="flex gap-2 mb-6 flex-wrap">
               <Input value={newDomainRule.domain} onChange={(e) => setNewDomainRule({ ...newDomainRule, domain: e.target.value })} placeholder="Domain (z.B. @spluegen.ch)" className="flex-1 min-w-40" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
               <select value={newDomainRule.tag} onChange={(e) => setNewDomainRule({ ...newDomainRule, tag: e.target.value })} className="rounded-md px-3 py-2" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor, border: `1px solid ${inputBorder}` }}>
                  <option value="">Tag auswählen</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.name}>{tag.name}</option>
                  ))}
                </select>
                <div className="relative">
                  <Input
                    value={customerSearch}
                    onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); if (!e.target.value) setNewDomainRule({ ...newDomainRule, customer_id: '' }); }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                    placeholder="Kunde suchen..."
                    className="w-52"
                    style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }}
                  />
                  {showCustomerDropdown && (
                    <div className="absolute z-50 top-full left-0 mt-1 w-full rounded-md shadow-lg max-h-48 overflow-y-auto border" style={{ backgroundColor: cardBg, borderColor: rowBorder }}>
                      <div className="px-3 py-2 text-sm cursor-pointer" style={{ color: textMuted }} onMouseDown={() => { setNewDomainRule({ ...newDomainRule, customer_id: '' }); setCustomerSearch(''); setShowCustomerDropdown(false); }}>
                        Kein Kunde
                      </div>
                      {customers
                        .filter(c => c.company_name.toLowerCase().includes(customerSearch.toLowerCase()))
                        .map((c) => (
                          <div
                            key={c.id}
                            className="px-3 py-2 text-sm cursor-pointer hover:opacity-80"
                            style={{ color: headingColor }}
                            onMouseDown={() => {
                              setNewDomainRule({ ...newDomainRule, customer_id: c.id });
                              setCustomerSearch(c.company_name);
                              setShowCustomerDropdown(false);
                            }}
                          >
                            {c.company_name}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
                <Button
                  onClick={() => newDomainRule.domain && newDomainRule.tag && createDomainRuleMutation.mutate(newDomainRule)}
                  className="bg-indigo-600 hover:bg-indigo-500"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {domainRules.length === 0 ? (
                  <p className="text-sm py-4" style={{ color: textMuted }}>Keine Domain-Regeln definiert</p>
                ) : (
                  domainRules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                      <div className="flex items-center gap-3 flex-1">
                        <div className="flex-1">
                          <div className="font-medium" style={{ color: headingColor }}>{rule.domain}</div>
                          <div className="text-xs" style={{ color: textMuted }}>
                            → {rule.tag}
                            {rule.customer_id && customers.find(c => c.id === rule.customer_id) && (
                              <span className="ml-2 text-emerald-500">| {customers.find(c => c.id === rule.customer_id)?.company_name}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            setAssigningTagToAll(prev => ({ ...prev, [rule.id]: true }));
                            try {
                              const domain = rule.domain;
                              const tag = rule.tag;
                              const mails = await entities.MailItem.filter({ mailbox: 'personal' });
                              const mailsToUpdate = mails.filter(m => m.sender_email?.endsWith(domain));

                              for (const mail of mailsToUpdate) {
                                const existingTags = mail.tags || [];
                                if (!existingTags.includes(tag)) {
                                  await entities.MailItem.update(mail.id, {
                                    tags: [...existingTags, tag]
                                  });
                                }
                              }

                              queryClient.invalidateQueries({ queryKey: ['mails'] });
                              toast.success(`${mailsToUpdate.length} E-Mails mit Tag "${tag}" versehen`);
                            } catch (error) {
                              toast.error('Fehler beim Zuweisen der Tags');
                            } finally {
                              setAssigningTagToAll(prev => ({ ...prev, [rule.id]: false }));
                            }
                          }}
                          disabled={assigningTagToAll[rule.id]}
                          className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                        >
                          {assigningTagToAll[rule.id] ? '...' : 'Zuweisen'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteDomainRuleMutation.mutate(rule.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              </div>
              </div>
              )}



        {/* Tätigkeiten Tab */}
        {activeTab === 'activities' && (
         <div className="space-y-6">
           <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
             <h3 className="text-lg font-semibold mb-2 flex items-center gap-2" style={{ color: headingColor }}>
               <ClipboardList className="h-5 w-5" /> Tätigkeiten verwalten
             </h3>
             <p className="text-sm mb-6" style={{ color: textMuted }}>
                Diese Tätigkeiten stehen für alle Kunden zur Verfügung und können dort einzeln als erledigt markiert werden.
              </p>

              {/* Add new */}
              <div className="flex gap-2 mb-6">
                <input
                  value={newActivityName}
                  onChange={(e) => setNewActivityName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newActivityName.trim()) createActivityTemplateMutation.mutate({ name: newActivityName.trim(), order: activityTemplates.length }); }}
                  placeholder="Neue Tätigkeit (z.B. Steuererklärung)..."
                  className="flex-1 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor, border: `1px solid ${inputBorder}` }}
                />
                <Button
                  onClick={() => newActivityName.trim() && createActivityTemplateMutation.mutate({ name: newActivityName.trim(), order: activityTemplates.length })}
                  disabled={!newActivityName.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* List */}
              <DragDropContext onDragEnd={handleActivityTemplateDragEnd}>
                <Droppable droppableId="activity-templates">
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                      {activityTemplates.length === 0 ? (
                       <p className="text-sm py-4" style={{ color: textMuted }}>Noch keine Tätigkeiten definiert.</p>
                      ) : (
                       activityTemplates.map((activity, idx) => (
                         <Draggable key={activity.id} draggableId={activity.id} index={idx}>
                           {(provided) => (
                             <div ref={provided.innerRef} {...provided.draggableProps} className="flex items-center justify-between p-3 rounded-lg border group" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                               <div className="flex items-center gap-3 flex-1">
                                 <div {...provided.dragHandleProps} style={{ color: textMuted }} className="cursor-grab">
                                   <GripVertical className="h-4 w-4" />
                                 </div>
                                 <span className="text-sm" style={{ color: headingColor }}>{activity.name}</span>
                               </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm(`Tätigkeit "${activity.name}" wirklich löschen? Sie wird bei bestehenden Kunden NICHT entfernt.`)) {
                                      deleteActivityTemplateMutation.mutate(activity.id);
                                    }
                                  }}
                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </Draggable>
                        ))
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>
        )}


        {/* Benutzer Tab */}
        {activeTab === 'users' && user?.role === 'admin' && (
         <div>
             <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
               <h3 className="text-lg font-semibold mb-4" style={{ color: headingColor }}>Benutzer verwalten</h3>

               <div className="mb-8 p-4 rounded-lg border" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                 <h4 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: headingColor }}>
                   <Send className="h-4 w-4" /> Neuen Benutzer einladen
                 </h4>
                 <div className="flex gap-2">
                   <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="E-Mail-Adresse" className="flex-1" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }} />
                   <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="rounded-md px-3 py-2 h-9 text-sm" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor, border: `1px solid ${inputBorder}` }}>
                      <option value="admin">Admin (Voller Zugriff)</option>
                      <option value="user">Benutzer (Mail + Tasks)</option>
                      <option value="task_user">Task Benutzer (nur Tasks)</option>
                    </select>
                    <Button
                      onClick={async () => {
                        const emailToInvite = inviteEmail.trim();
                        
                        if (!emailToInvite) {
                          toast.error('Bitte E-Mail-Adresse eingeben');
                          return;
                        }
                        
                        setInvitingEmail(emailToInvite);
                        try {
                          const { data } = await functions.invoke('inviteUser', {
                            email: emailToInvite,
                            role: inviteRole
                          });
                          
                          if (data.success) {
                            toast.success(`Einladung versendet an ${emailToInvite}`);
                            setInviteEmail('');
                            setInviteRole('user');
                            queryClient.invalidateQueries({ queryKey: ['users'] });
                          } else {
                            toast.error(data.error || 'Einladung fehlgeschlagen');
                          }
                        } catch (error) {
                          toast.error('Fehler: ' + error.message);
                        } finally {
                          setInvitingEmail('');
                        }
                      }}
                      disabled={!!invitingEmail}
                      className="bg-green-600 hover:bg-green-500 disabled:opacity-50"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {invitingEmail ? 'Lädt...' : 'Einladen'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium mb-3" style={{ color: textMuted }}>Benutzer & Einladungen</h4>
                  {users.length === 0 && invitedUsers.length === 0 ? (
                    <p className="text-sm py-4" style={{ color: textMuted }}>Noch keine Benutzer</p>
                  ) : (
                    <>
                      {users.map((u) => (
                        <div key={u.id} className="rounded-lg border" style={{ backgroundColor: rowBg, borderColor: rowBorder }}>
                          <div className="flex items-center justify-between p-3 gap-3">
                            {/* Avatar */}
                            <div className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-sm font-semibold flex-shrink-0">
                              {(u.full_name || u.email || '?').charAt(0).toUpperCase()}
                            </div>

                            {/* Name / Email area */}
                            <div className="flex-1 min-w-0">
                              {editingUserNameId === u.id ? (
                                <div className="flex items-center gap-2">
                                  <Input
                                    autoFocus
                                    value={editingUserNameValue}
                                    onChange={(e) => setEditingUserNameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') updateUserNameMutation.mutate({ id: u.id, full_name: editingUserNameValue.trim() });
                                      if (e.key === 'Escape') setEditingUserNameId(null);
                                    }}
                                    placeholder="Vorname Nachname"
                                    className="h-7 text-sm flex-1"
                                    style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor }}
                                  />
                                  <Button
                                    variant="ghost" size="icon"
                                    onClick={() => updateUserNameMutation.mutate({ id: u.id, full_name: editingUserNameValue.trim() })}
                                    disabled={updateUserNameMutation.isPending}
                                    className="h-7 w-7 text-green-500 hover:text-green-400 hover:bg-green-500/10 flex-shrink-0"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => setEditingUserNameId(null)} className="h-7 w-7 flex-shrink-0" style={{ color: textMuted }}>
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <div className="font-semibold truncate" style={{ color: headingColor }}>{u.full_name || u.email}</div>
                                  <button
                                    onClick={() => { setEditingUserNameId(u.id); setEditingUserNameValue(u.full_name || ''); }}
                                    className="opacity-40 hover:opacity-100 transition-opacity flex-shrink-0"
                                    title="Name bearbeiten"
                                  >
                                    <Pencil className="h-3 w-3" style={{ color: textMuted }} />
                                  </button>
                                </div>
                              )}
                              {editingUserNameId !== u.id && (
                                <div className="text-xs truncate" style={{ color: textMuted }}>{u.email}</div>
                              )}
                            </div>

                            {/* Role + Actions */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {editingUserId === u.id ? (
                                <>
                                  <select value={editingUserRole} onChange={(e) => setEditingUserRole(e.target.value)} className="rounded-md px-2 py-1 text-xs h-7" style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputColor, border: `1px solid ${inputBorder}` }}>
                                    <option value="admin">Admin</option>
                                    <option value="user">Benutzer</option>
                                    <option value="task_user">Task Benutzer</option>
                                  </select>
                                  <Button
                                    variant="ghost" size="icon"
                                    onClick={() => updateUserRoleMutation.mutate({ id: u.id, role: editingUserRole })}
                                    disabled={updateUserRoleMutation.isPending}
                                    className="h-7 w-7 text-green-400 hover:text-green-300 hover:bg-green-500/10"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => setEditingUserId(null)} className="h-7 w-7" style={{ color: textMuted }}>
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <span className={`text-xs px-2 py-1 rounded-full ${
                                    u.role === 'admin'
                                      ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
                                      : u.role === 'task_user'
                                      ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                                  }`}>
                                    {u.role === 'admin' ? 'Admin' : u.role === 'task_user' ? 'Task Benutzer' : 'Benutzer'}
                                  </span>
                                  {u.id !== user?.id && (
                                    <>
                                      <Button
                                        variant="ghost" size="icon"
                                        title="Rolle bearbeiten"
                                        onClick={() => { setEditingUserId(u.id); setEditingUserRole(u.role || 'user'); }}
                                        className="h-7 w-7" style={{ color: textMuted }}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost" size="icon"
                                        title="Passwort zurücksetzen"
                                        onClick={() => handleResetPassword(u.email)}
                                        className="h-7 w-7 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                      >
                                        <KeyRound className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost" size="icon"
                                        title="Benutzer entfernen & Daten übertragen"
                                        onClick={() => { setUserToDelete(u); setDeleteUserDialogOpen(true); }}
                                        className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                      >
                                        <UserMinus className="h-4 w-4" />
                                      </Button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {/* Offene Einladungen */}
                      {invitedUsers.length > 0 && (
                        <>
                          <div className="text-xs font-medium uppercase tracking-wider mt-4 mb-2 px-1" style={{ color: textMuted }}>Pending Einladungen</div>
                          {invitedUsers.map((email) => (
                           <div key={email} className="flex items-center justify-between p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                             <div className="flex items-center gap-3">
                               <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-sm font-medium">
                                 {email?.charAt(0) || '?'}
                               </div>
                               <div>
                                 <div className="font-medium" style={{ color: headingColor }}>{email}</div>
                                 <div className="text-xs text-amber-500">Einladung ausstehend</div>
                               </div>
                             </div>
                             <span className="text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">Pending</span>
                           </div>
                          ))}
                        </>
                      )}
                    </>
                  )}
                  </div>
              </div>
          </div>
        )}
      </div>

        {/* Darstellung Tab */}
        {activeTab === 'appearance' && (
          <div className="space-y-6">
            <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
              <h3 className="text-lg font-semibold mb-1 flex items-center gap-2" style={{ color: headingColor }}>
                <Sun className="h-5 w-5" /> Darstellung
              </h3>
              <p className="text-sm mb-6" style={{ color: textMuted }}>Wähle dein bevorzugtes Design für die Anwendung.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-2xl">

                {/* ── Dark Theme Card ── */}
                <button
                  onClick={async () => { setTheme('dark'); await auth.updateMe({ theme: 'dark' }); }}
                  className="group relative text-left rounded-2xl border-2 overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-xl"
                  style={{
                    borderColor: theme === 'dark' ? '#7c3aed' : cardBorder,
                    boxShadow: theme === 'dark' ? '0 0 0 3px rgba(124,58,237,0.18)' : 'none',
                  }}
                >
                  {/* Mini UI Preview */}
                  <div className="w-full h-36 bg-zinc-950 flex overflow-hidden">
                    <div className="w-9 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-2.5 gap-2 flex-shrink-0">
                      <div className="w-4 h-4 rounded-md bg-violet-600/70" />
                      <div className="w-4 h-4 rounded-md bg-zinc-700" />
                      <div className="w-4 h-4 rounded-md bg-zinc-700" />
                      <div className="w-4 h-4 rounded-md bg-zinc-700" />
                    </div>
                    <div className="flex-1 p-2 flex flex-col gap-2">
                      <div className="h-4 w-20 rounded bg-zinc-800" />
                      <div className="flex gap-1.5 flex-1">
                        <div className="flex-1 rounded-lg bg-zinc-800/80 p-2 flex flex-col gap-1.5">
                          <div className="h-1.5 w-10 rounded-full bg-zinc-600" />
                          <div className="h-1.5 w-14 rounded-full bg-zinc-600" />
                          <div className="h-1.5 w-8 rounded-full bg-violet-500/60" />
                        </div>
                        <div className="flex-1 rounded-lg bg-zinc-800/80 p-2 flex flex-col gap-1.5">
                          <div className="h-1.5 w-12 rounded-full bg-zinc-600" />
                          <div className="h-1.5 w-8 rounded-full bg-zinc-600" />
                          <div className="h-1.5 w-10 rounded-full bg-zinc-600" />
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Card Footer */}
                  <div className="p-4 flex items-center justify-between" style={{ backgroundColor: theme === 'dark' ? 'rgba(124,58,237,0.08)' : cardBg }}>
                    <div>
                      <div className="flex items-center gap-2">
                        <Moon className="h-4 w-4 text-violet-400" />
                        <span className="font-semibold text-sm" style={{ color: headingColor }}>Dunkel</span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: textMuted }}>Augenschonend bei Nacht</p>
                    </div>
                    {theme === 'dark' ? (
                      <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-[10px] font-bold">✓</span>
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 flex-shrink-0" style={{ borderColor: cardBorder }} />
                    )}
                  </div>
                </button>

                {/* ── Light Theme Card ── */}
                <button
                  onClick={async () => { setTheme('light'); await auth.updateMe({ theme: 'light' }); }}
                  className="group relative text-left rounded-2xl border-2 overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-xl"
                  style={{
                    borderColor: theme === 'light' ? '#7c3aed' : cardBorder,
                    boxShadow: theme === 'light' ? '0 0 0 3px rgba(124,58,237,0.18)' : 'none',
                  }}
                >
                  {/* Mini UI Preview */}
                  <div className="w-full h-36 bg-slate-100 flex overflow-hidden">
                    <div className="w-9 bg-slate-200 border-r border-slate-300 flex flex-col items-center py-2.5 gap-2 flex-shrink-0">
                      <div className="w-4 h-4 rounded-md bg-violet-500/80" />
                      <div className="w-4 h-4 rounded-md bg-slate-300" />
                      <div className="w-4 h-4 rounded-md bg-slate-300" />
                      <div className="w-4 h-4 rounded-md bg-slate-300" />
                    </div>
                    <div className="flex-1 p-2 flex flex-col gap-2">
                      <div className="h-4 w-20 rounded bg-slate-200" />
                      <div className="flex gap-1.5 flex-1">
                        <div className="flex-1 rounded-lg bg-white border border-slate-200 p-2 flex flex-col gap-1.5">
                          <div className="h-1.5 w-10 rounded-full bg-slate-300" />
                          <div className="h-1.5 w-14 rounded-full bg-slate-300" />
                          <div className="h-1.5 w-8 rounded-full bg-violet-400/50" />
                        </div>
                        <div className="flex-1 rounded-lg bg-white border border-slate-200 p-2 flex flex-col gap-1.5">
                          <div className="h-1.5 w-12 rounded-full bg-slate-300" />
                          <div className="h-1.5 w-8 rounded-full bg-slate-300" />
                          <div className="h-1.5 w-10 rounded-full bg-slate-300" />
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Card Footer */}
                  <div className="p-4 flex items-center justify-between" style={{ backgroundColor: theme === 'light' ? 'rgba(124,58,237,0.06)' : cardBg }}>
                    <div>
                      <div className="flex items-center gap-2">
                        <Sun className="h-4 w-4 text-amber-500" />
                        <span className="font-semibold text-sm" style={{ color: headingColor }}>Hell</span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: textMuted }}>Klassisch & klar</p>
                    </div>
                    {theme === 'light' ? (
                      <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-[10px] font-bold">✓</span>
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 flex-shrink-0" style={{ borderColor: cardBorder }} />
                    )}
                  </div>
                </button>

                {/* ── Artis Theme Card ── */}
                <button
                  onClick={async () => { setTheme('artis'); await auth.updateMe({ theme: 'artis' }); }}
                  className="group relative text-left rounded-2xl border-2 overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-xl"
                  style={{
                    borderColor: theme === 'artis' ? '#7a9b7f' : cardBorder,
                    boxShadow: theme === 'artis' ? '0 0 0 3px rgba(122,155,127,0.22)' : 'none',
                  }}
                >
                  {/* Mini UI Preview */}
                  <div className="w-full h-36 flex overflow-hidden" style={{ backgroundColor: '#f2f5f2' }}>
                    <div className="w-9 flex flex-col items-center py-2.5 gap-2 flex-shrink-0 border-r" style={{ backgroundColor: '#e6ede6', borderColor: '#bfcfbf' }}>
                      <div className="w-4 h-4 rounded-md" style={{ backgroundColor: '#7a9b7f' }} />
                      <div className="w-4 h-4 rounded-md" style={{ backgroundColor: '#ccd8cc' }} />
                      <div className="w-4 h-4 rounded-md" style={{ backgroundColor: '#ccd8cc' }} />
                      <div className="w-4 h-4 rounded-md" style={{ backgroundColor: '#ccd8cc' }} />
                    </div>
                    <div className="flex-1 p-2 flex flex-col gap-2">
                      <div className="h-4 w-20 rounded" style={{ backgroundColor: '#dde8dd' }} />
                      <div className="flex gap-1.5 flex-1">
                        <div className="flex-1 rounded-lg p-2 flex flex-col gap-1.5 border" style={{ backgroundColor: 'rgba(255,255,255,0.75)', borderColor: '#ccd8cc' }}>
                          <div className="h-1.5 w-10 rounded-full" style={{ backgroundColor: '#bfcfbf' }} />
                          <div className="h-1.5 w-14 rounded-full" style={{ backgroundColor: '#bfcfbf' }} />
                          <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: '#7a9b7f80' }} />
                        </div>
                        <div className="flex-1 rounded-lg p-2 flex flex-col gap-1.5 border" style={{ backgroundColor: 'rgba(255,255,255,0.75)', borderColor: '#ccd8cc' }}>
                          <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: '#bfcfbf' }} />
                          <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: '#bfcfbf' }} />
                          <div className="h-1.5 w-10 rounded-full" style={{ backgroundColor: '#bfcfbf' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Card Footer */}
                  <div className="p-4 flex items-center justify-between" style={{ backgroundColor: theme === 'artis' ? 'rgba(122,155,127,0.1)' : cardBg }}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold leading-none" style={{ color: '#7a9b7f', fontFamily: 'serif' }}>A</span>
                        <span className="font-semibold text-sm" style={{ color: headingColor }}>Artis</span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: textMuted }}>Grün & natürlich</p>
                    </div>
                    {theme === 'artis' ? (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#7a9b7f' }}>
                        <span className="text-white text-[10px] font-bold">✓</span>
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 flex-shrink-0" style={{ borderColor: cardBorder }} />
                    )}
                  </div>
                </button>

              </div>
            </div>
          </div>
        )}

      <DeleteUserDialog
        open={deleteUserDialogOpen}
        onClose={() => {
          setDeleteUserDialogOpen(false);
          setUserToDelete(null);
        }}
        userToDelete={userToDelete}
        allUsers={users}
        onDeleted={() => {
          queryClient.invalidateQueries({ queryKey: ['users'] });
        }}
      />
    </div>
  );
}