import React, { useState, useContext } from "react";
import { functions, auth, supabase, uploadAvatar } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Mail, UserPlus, Trash2, Shield, User as UserIcon, CheckSquare, Pencil, Check, X, KeyRound, Eye, EyeOff, Phone, Camera, ImageOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import DeleteUserDialog from "@/components/settings/DeleteUserDialog";

// Einheitliches Zugriffsrollen-Modell (getrennt von der Tarifgruppe).
// Muss zum profiles_role_check-Constraint in der DB passen.
const ROLE_STYLE = {
  admin:          { label: 'Administrator',       icon: Shield,      bg: 'rgba(99,102,241,0.15)', fg: '#818cf8', desc: 'Voller Zugriff + Benutzerverwaltung' },
  mandatsleiter:  { label: 'Mandatsleiter',       icon: Users,       bg: 'rgba(56,132,255,0.15)', fg: '#5b9bff', desc: 'Volle Fachrechte: freigeben, fakturieren, buchen, Stammdaten' },
  sachbearbeiter: { label: 'Sachbearbeiter',      icon: UserIcon,    bg: 'rgba(113,113,122,0.2)', fg: '#a1a1aa', desc: 'Erfassen & buchen; keine Selbst-Freigabe, keine Stammdaten' },
  readonly:       { label: 'Nur-Lesen / Revisor', icon: Eye,         bg: 'rgba(180,120,20,0.18)', fg: '#c08a3e', desc: 'Alles lesen, nichts schreiben' },
  task_user:      { label: 'Task-Mitarbeiter',    icon: CheckSquare, bg: 'rgba(122,155,127,0.15)', fg: '#7a9b7f', desc: 'Nur Task-Board' },
};

const ROLES = Object.entries(ROLE_STYLE).map(([value, s]) => ({ value, label: s.label, icon: s.icon, desc: s.desc }));

function RoleBadge({ role }) {
  const s = ROLE_STYLE[role] || ROLE_STYLE.sachbearbeiter;
  const Icon = s.icon;
  return (
    <span className="text-xs px-2 py-1 rounded-md flex items-center gap-1" style={{ backgroundColor: s.bg, color: s.fg }}>
      <Icon className="h-3 w-3" /> {s.label}
    </span>
  );
}

export default function UserManagement() {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("sachbearbeiter");
  const [inviting, setInviting] = useState(false);
  const [resetPassword, setResetPassword] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);

  // Inline rename state
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingName,   setEditingName]   = useState("");
  const [savingName,    setSavingName]    = useState(false);

  // Inline password state
  const [pwEditUserId, setPwEditUserId] = useState(null);
  const [pwEditValue,  setPwEditValue]  = useState("");
  const [pwShowValue,  setPwShowValue]  = useState(false);
  const [pwSaving,     setPwSaving]     = useState(false);

  // Inline phone state
  const [phoneEditUserId, setPhoneEditUserId] = useState(null);
  const [phoneEditValue,  setPhoneEditValue]  = useState("");
  const [phoneSaving,     setPhoneSaving]     = useState(false);

  // Avatar/Foto upload state
  const [avatarTargetUserId, setAvatarTargetUserId] = useState(null);
  const [avatarUploadingId,  setAvatarUploadingId]  = useState(null);
  const avatarInputRef = React.useRef(null);

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      const res = await functions.invoke('getAllUsers');
      const users = res.data?.users || []
      const interUsers = users.filter(u=> u.role !== 'extern')
      return interUsers;
    },
  });

  // Mitarbeitergruppen = Gruppen mit hinterlegter Rolle. Reine Kundengruppen
  // (staff_role NULL) gehören ins Kundenportal, nicht hierher.
  const { data: staffGroups = [] } = useQuery({
    queryKey: ["access_groups_staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('access_groups')
        .select('id, name, staff_role, aktiv, access_group_staff(user_id)')
        .not('staff_role', 'is', null)
        .order('name');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const groupsOf = (userId) =>
    staffGroups.filter(g => (g.access_group_staff || []).some(m => m.user_id === userId));

  // Gruppenzugehörigkeit umschalten. Die Rolle wird weiterhin über die
  // bestehende Edge Function gesetzt — profiles.role ist per Trigger gegen
  // direkte Client-Änderungen gesperrt, das umgehen wir hier nicht.
  const toggleGroup = async (user, group) => {
    const isIn = (group.access_group_staff || []).some(m => m.user_id === user.id);
    try {
      if (isIn) {
        const { error } = await supabase.from('access_group_staff')
          .delete().eq('group_id', group.id).eq('user_id', user.id);
        if (error) throw error;
        toast.success(`Aus „${group.name}" entfernt (Rolle bleibt unverändert)`);
      } else {
        const { error } = await supabase.from('access_group_staff')
          .insert({ group_id: group.id, user_id: user.id });
        if (error) throw error;
        if (group.staff_role && group.staff_role !== user.role) {
          await functions.invoke('makeAdmin', { user_id: user.id, role: group.staff_role });
          toast.success(`Zu „${group.name}" hinzugefügt · Rolle: ${ROLE_STYLE[group.staff_role]?.label || group.staff_role}`);
        } else {
          toast.success(`Zu „${group.name}" hinzugefügt`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["access_groups_staff"] });
      queryClient.invalidateQueries({ queryKey: ["allUsers"] });
    } catch (e) {
      toast.error("Fehler: " + (e?.message || e));
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) { toast.error("Bitte E-Mail eingeben"); return; }
    setInviting(true);
    try {
      const {data} = await functions.invoke('inviteUser', {
        email: inviteEmail,
        role: inviteRole,
        appUrl: window.env.HOSTNAME,
      });
      toast.success(`Einladung an ${inviteEmail} gesendet`);
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["allUsers"] });
    } catch (error) {
      toast.error("Fehler: " + error.message);
    } finally {
      setInviting(false);
    }
  };

  const handleResetPassword = async (email) => {
    setResetPassword(email);
    try {
      const {error} = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password'
      });
      if (error) throw error;
      toast.success(`Passwort-Reset E-Mail an ${email} gesendet`);
    } catch (e) {
      toast.error('Fehler: ' + e.message);
    } finally {
      setResetPassword(null);
    }
  };

  const handleSetRole = async (userId, role) => {
    try {
      await functions.invoke('makeAdmin', { user_id: userId, role });
      toast.success(`Rolle geändert: ${ROLE_STYLE[role]?.label || role}`);
      queryClient.invalidateQueries({ queryKey: ["allUsers"] });
    } catch (e) {
      toast.error("Fehler: " + (e?.message || e));
    }
  };

  const handleDeleteSuccess = () => {
    setUserToDelete(null);
    queryClient.invalidateQueries({ queryKey: ["allUsers"] });
  };

  const startEdit = (user) => {
    setEditingUserId(user.id);
    setEditingName(user.full_name || "");
  };

  const cancelEdit = () => {
    setEditingUserId(null);
    setEditingName("");
  };

  const saveEdit = async (userId) => {
    if (!editingName.trim()) { toast.error("Name darf nicht leer sein"); return; }
    setSavingName(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: editingName.trim() })
        .eq('id', userId);
      if (error) throw error;
      toast.success("Name gespeichert");
      setEditingUserId(null);
      queryClient.invalidateQueries({ queryKey: ["allUsers"] });
      // Refresh current user if editing self
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setSavingName(false);
    }
  };

  const handleSavePhone = async (userId) => {
    setPhoneSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ phone: phoneEditValue.trim() || null })
        .eq('id', userId);
      if (error) throw error;
      toast.success("Telefonnummer gespeichert");
      setPhoneEditUserId(null);
      setPhoneEditValue("");
      queryClient.invalidateQueries({ queryKey: ["allUsers"] });
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setPhoneSaving(false);
    }
  };

  // Foto-Upload auslösen (verstecktes File-Input klicken)
  const triggerAvatarUpload = (userId) => {
    setAvatarTargetUserId(userId);
    requestAnimationFrame(() => avatarInputRef.current?.click());
  };

  const handleAvatarFile = async (e) => {
    const file = e.target.files?.[0];
    const userId = avatarTargetUserId;
    e.target.value = ''; // Reset → gleiches File kann erneut gewählt werden
    if (!file || !userId) return;
    if (!file.type.startsWith('image/')) { toast.error('Bitte ein Bild auswählen'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Bild zu gross (max. 5 MB)'); return; }
    setAvatarUploadingId(userId);
    try {
      const url = await uploadAvatar(file, userId);
      await functions.invoke('updateUserProfile', { user_id: userId, avatar_url: url });
      toast.success('Foto gespeichert');
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    } catch (err) {
      toast.error('Fehler: ' + err.message);
    } finally {
      setAvatarUploadingId(null);
      setAvatarTargetUserId(null);
    }
  };

  const handleRemoveAvatar = async (userId) => {
    setAvatarUploadingId(userId);
    try {
      await functions.invoke('updateUserProfile', { user_id: userId, avatar_url: null });
      toast.success('Foto entfernt');
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    } catch (err) {
      toast.error('Fehler: ' + err.message);
    } finally {
      setAvatarUploadingId(null);
    }
  };

  const bg = isArtis ? '#f2f5f2' : isLight ? '#f4f4f8' : '#09090b';
  const cardBg = isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(24,24,27,0.8)';
  const cardBorder = isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : '#27272a';
  const textPrimary = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7';
  const textSecondary = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a';
  const accentBg = isArtis ? '#7a9b7f' : '#6366f1';

  if (currentUser?.role !== "admin") {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: bg }}>
        <div className="rounded-2xl border p-8 text-center" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
          <Shield className="h-16 w-16 mx-auto mb-4" style={{ color: '#ef4444' }} />
          <h2 className="text-xl font-bold mb-2" style={{ color: textPrimary }}>Zugriff verweigert</h2>
          <p style={{ color: textSecondary }}>Nur Administratoren können auf die Benutzerverwaltung zugreifen.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full" style={{ backgroundColor: bg }}>
      {/* Verstecktes File-Input für Foto-Upload (für alle Benutzerzeilen) */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarFile}
      />
      <div className="mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: accentBg }}>
            <Users className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: textPrimary }}>Benutzerverwaltung</h1>
            <p className="text-sm" style={{ color: textSecondary }}>Mitarbeiter einladen und verwalten</p>
          </div>
        </div>

        {/* Invite Card */}
        <div className="rounded-2xl border p-6 mb-6 shadow-sm" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2" style={{ color: textPrimary }}>
            <UserPlus className="h-4 w-4" style={{ color: accentBg }} />
            Neuen Benutzer einladen
          </h2>
          <div className="flex gap-3 flex-wrap">
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@artis-treuhand.ch"
              className="flex-1 min-w-48"
              style={{ backgroundColor: isArtis ? '#f2f5f2' : isLight ? '#f4f4f8' : '#18181b', borderColor: cardBorder, color: textPrimary }}
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" style={{ borderColor: cardBorder, color: textSecondary, backgroundColor: 'transparent' }}>
                  {ROLES.find(r => r.value === inviteRole)?.label || 'Benutzer'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
                {ROLES.map(role => (
                  <DropdownMenuItem key={role.value} onClick={() => setInviteRole(role.value)} style={{ color: textPrimary }}>
                    <role.icon className="h-4 w-4 mr-2" />
                    <div>
                      <div className="font-medium">{role.label}</div>
                      <div className="text-xs" style={{ color: textSecondary }}>{role.desc}</div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={handleInvite} disabled={inviting} className="text-white hover:opacity-90" style={{ backgroundColor: accentBg }}>
              {inviting ? 'Lädt...' : 'Einladen'}
            </Button>
          </div>
        </div>

        {/* Users List */}
        <div className="rounded-2xl border shadow-sm overflow-hidden" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
          <div className="p-5 border-b" style={{ borderColor: cardBorder }}>
            <h2 className="font-semibold" style={{ color: textPrimary }}>
              Benutzer ({users.length})
            </h2>
          </div>
          {isLoading ? (
            <div className="p-8 text-center" style={{ color: textSecondary }}>Lädt...</div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center" style={{ color: textSecondary }}>Keine Benutzer vorhanden</div>
          ) : (
            <div>
              {users.map((user, i) => (
                <div key={user.id} style={{ borderBottom: i < users.length - 1 ? `1px solid ${cardBorder}` : 'none' }}>
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => triggerAvatarUpload(user.id)}
                      title="Foto ändern"
                      className="group/av w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 relative"
                      style={{ backgroundColor: accentBg }}
                    >
                      {user.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span>{(editingUserId === user.id ? editingName : user.full_name)?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase()}</span>
                      )}
                      <span className="absolute inset-0 bg-black/45 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center">
                        {avatarUploadingId === user.id
                          ? <Loader2 className="h-4 w-4 animate-spin text-white" />
                          : <Camera className="h-4 w-4 text-white" />}
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      {editingUserId === user.id ? (
                        /* ── Inline Edit Mode ── */
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(user.id); if (e.key === 'Escape') cancelEdit(); }}
                            autoFocus
                            className="h-7 text-sm py-0 px-2"
                            style={{ backgroundColor: isArtis ? '#f2f5f2' : isLight ? '#f4f4f8' : '#18181b', borderColor: accentBg, color: textPrimary, width: '180px' }}
                          />
                          <button
                            onClick={() => saveEdit(user.id)}
                            disabled={savingName}
                            className="p-1 rounded hover:bg-green-500/10 text-green-500 flex-shrink-0"
                            title="Speichern"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1 rounded hover:bg-red-500/10 text-red-400 flex-shrink-0"
                            title="Abbrechen"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        /* ── Display Mode ── */
                        <div className="flex items-center gap-1.5 group/name">
                          <span className="text-sm font-medium" style={{ color: textPrimary }}>
                            {user.full_name || 'Kein Name'}
                          </span>
                          {user.id === currentUser?.id && (
                            <span className="text-xs" style={{ color: textSecondary }}>(Sie)</span>
                          )}
                          <button
                            onClick={() => startEdit(user)}
                            className="p-0.5 rounded opacity-0 group/name:opacity-0 hover:opacity-100 group-hover/name:opacity-100 transition-opacity"
                            style={{ color: textSecondary }}
                            title="Namen bearbeiten"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: textSecondary }}>
                        <Mail className="h-3 w-3" />
                        {user.email}
                      </div>
                      <div className="text-xs flex items-center gap-1 mt-0.5">
                        <Phone className="h-3 w-3" style={{ color: textSecondary }} />
                        <span style={{ color: textSecondary }}>{user.phone || '—'}</span>
                        <button
                          onClick={() => { setPhoneEditUserId(user.id); setPhoneEditValue(user.phone || ''); }}
                          className="p-0.5 rounded hover:opacity-100 transition-opacity"
                          style={{ color: textSecondary, opacity: 0.4 }}
                          title="Direktnummer bearbeiten"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {groupsOf(user.id).map(g => (
                      <span key={g.id} className="text-xs px-2 py-1 rounded-md flex items-center gap-1"
                        style={{ backgroundColor: 'rgba(122,155,127,0.15)', color: '#7a9b7f', opacity: g.aktiv ? 1 : .5 }}
                        title={g.aktiv ? 'Gruppe' : 'Gruppe (deaktiviert)'}>
                        <Users className="h-3 w-3" /> {g.name}
                      </span>
                    ))}
                    <RoleBadge role={user.role} />
                    {user.id !== currentUser?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-lg" style={{ color: textSecondary }}>
                            ···
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
                          <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide" style={{ color: textSecondary }}>Rolle setzen</div>
                          {ROLES.map((r) => {
                            const RIcon = r.icon;
                            return (
                              <DropdownMenuItem
                                key={r.value}
                                disabled={user.role === r.value}
                                onClick={() => handleSetRole(user.id, r.value)}
                                style={{ color: user.role === r.value ? textSecondary : textPrimary }}
                              >
                                <RIcon className="h-4 w-4 mr-2" />
                                {r.label}{user.role === r.value ? ' ✓' : ''}
                              </DropdownMenuItem>
                            );
                          })}
                          {staffGroups.length > 0 && (
                            <>
                              <DropdownMenuSeparator style={{ backgroundColor: cardBorder }} />
                              <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide" style={{ color: textSecondary }}>Gruppe</div>
                              {staffGroups.map((g) => {
                                const isIn = (g.access_group_staff || []).some(m => m.user_id === user.id);
                                return (
                                  <DropdownMenuItem key={g.id} onClick={() => toggleGroup(user, g)} style={{ color: textPrimary }}>
                                    <Users className="h-4 w-4 mr-2" />
                                    <div>
                                      <div className="font-medium">{g.name}{isIn ? ' ✓' : ''}</div>
                                      <div className="text-xs" style={{ color: textSecondary }}>
                                        setzt Rolle: {ROLE_STYLE[g.staff_role]?.label || g.staff_role}
                                      </div>
                                    </div>
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          <DropdownMenuSeparator style={{ backgroundColor: cardBorder }} />
                          <DropdownMenuItem
                              onClick={() => { handleResetPassword(user.email); }}
                              style={{ color: textPrimary }}
                              disabled={resetPassword === user.email}
                          >
                            {resetPassword === user.email ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Wird zurückgesetzt...
                                </>
                            ) : (
                                <>
                                  <KeyRound className="h-4 w-4 mr-2" />
                                  Passwort zurücksetzen
                                </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => { setPhoneEditUserId(user.id); setPhoneEditValue(user.phone || ""); }}
                            style={{ color: textPrimary }}
                          >
                            <Phone className="h-4 w-4 mr-2" />
                            Direktnummer bearbeiten
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => triggerAvatarUpload(user.id)}
                            style={{ color: textPrimary }}
                          >
                            <Camera className="h-4 w-4 mr-2" />
                            Foto {user.avatar_url ? 'ändern' : 'hochladen'}
                          </DropdownMenuItem>
                          {user.avatar_url && (
                            <DropdownMenuItem
                              onClick={() => handleRemoveAvatar(user.id)}
                              style={{ color: textPrimary }}
                            >
                              <ImageOff className="h-4 w-4 mr-2" />
                              Foto entfernen
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator style={{ backgroundColor: cardBorder }} />
                          <DropdownMenuItem onClick={() => setUserToDelete(user)} style={{ color: '#ef4444' }}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Benutzer löschen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>

                {/* ── Passwort-Panel (inline) ── */}
                {pwEditUserId === user.id && (
                  <div
                    className="flex items-center gap-2 px-4 pb-3 pt-0"
                    style={{ backgroundColor: isArtis ? '#f5f8f5' : isLight ? '#f7f7fc' : 'rgba(24,24,27,0.9)' }}
                  >
                    <KeyRound className="h-3.5 w-3.5 flex-shrink-0" style={{ color: textSecondary }} />
                    <div className="relative flex-1">
                      <Input
                        type={pwShowValue ? "text" : "password"}
                        placeholder="Neues Passwort (min. 8 Zeichen)"
                        value={pwEditValue}
                        onChange={e => setPwEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSetPassword(user.id);
                          if (e.key === 'Escape') { setPwEditUserId(null); setPwEditValue(""); }
                        }}
                        autoFocus
                        className="h-8 text-sm pr-8"
                        style={{ backgroundColor: isArtis ? '#fff' : isLight ? '#fff' : '#18181b', borderColor: accentBg, color: textPrimary }}
                        autoComplete="new-password"
                      />
                      <button
                        onClick={() => setPwShowValue(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        style={{ color: textSecondary }}
                        tabIndex={-1}
                      >
                        {pwShowValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <button
                      onClick={() => handleSetPassword(user.id)}
                      disabled={pwSaving || !pwEditValue}
                      className="p-1.5 rounded bg-green-500/20 text-green-600 hover:bg-green-500/30 disabled:opacity-40 transition-colors flex-shrink-0"
                      title="Speichern"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { setPwEditUserId(null); setPwEditValue(""); }}
                      className="p-1.5 rounded hover:bg-red-500/10 text-red-400 flex-shrink-0"
                      title="Abbrechen"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {/* ── Telefon-Panel (inline) ── */}
                {phoneEditUserId === user.id && (
                  <div
                    className="flex items-center gap-2 px-4 pb-3 pt-0"
                    style={{ backgroundColor: isArtis ? '#f5f8f5' : isLight ? '#f7f7fc' : 'rgba(24,24,27,0.9)' }}
                  >
                    <Phone className="h-3.5 w-3.5 flex-shrink-0" style={{ color: textSecondary }} />
                    <Input
                      type="tel"
                      placeholder="+41 71 505 05 09"
                      value={phoneEditValue}
                      onChange={e => setPhoneEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSavePhone(user.id);
                        if (e.key === 'Escape') { setPhoneEditUserId(null); setPhoneEditValue(""); }
                      }}
                      autoFocus
                      className="h-8 text-sm flex-1"
                      style={{ backgroundColor: isArtis ? '#fff' : isLight ? '#fff' : '#18181b', borderColor: accentBg, color: textPrimary }}
                    />
                    <button
                      onClick={() => handleSavePhone(user.id)}
                      disabled={phoneSaving}
                      className="p-1.5 rounded bg-green-500/20 text-green-600 hover:bg-green-500/30 disabled:opacity-40 transition-colors flex-shrink-0"
                      title="Speichern"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { setPhoneEditUserId(null); setPhoneEditValue(""); }}
                      className="p-1.5 rounded hover:bg-red-500/10 text-red-400 flex-shrink-0"
                      title="Abbrechen"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DeleteUserDialog
        open={!!userToDelete}
        userToDelete={userToDelete}
        allUsers={users}
        onClose={() => setUserToDelete(null)}
        onDeleted={handleDeleteSuccess}
      />
    </div>
  );
}
