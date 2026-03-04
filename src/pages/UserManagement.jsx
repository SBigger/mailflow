import React, { useState, useContext } from "react";
import { functions, auth } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Mail, UserPlus, Trash2, Shield, User as UserIcon, CheckSquare } from "lucide-react";
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

const ROLES = [
  { value: 'admin', label: 'Admin', icon: Shield, desc: 'Voller Zugriff + Benutzerverwaltung' },
  { value: 'user', label: 'Benutzer', icon: UserIcon, desc: 'Mails, Tasks, Kunden' },
  { value: 'task_user', label: 'Task-Mitarbeiter', icon: CheckSquare, desc: 'Nur Task-Board' },
];

function RoleBadge({ role }) {
  if (role === 'admin') return (
    <span className="text-xs px-2 py-1 rounded-md flex items-center gap-1" style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
      <Shield className="h-3 w-3" /> Admin
    </span>
  );
  if (role === 'task_user') return (
    <span className="text-xs px-2 py-1 rounded-md flex items-center gap-1" style={{ backgroundColor: 'rgba(122,155,127,0.15)', color: '#7a9b7f' }}>
      <CheckSquare className="h-3 w-3" /> Task-Mitarbeiter
    </span>
  );
  return (
    <span className="text-xs px-2 py-1 rounded-md flex items-center gap-1" style={{ backgroundColor: 'rgba(113,113,122,0.2)', color: '#a1a1aa' }}>
      <UserIcon className="h-3 w-3" /> Benutzer
    </span>
  );
}

export default function UserManagement() {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviting, setInviting] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      const res = await functions.invoke('getAllUsers');
      return res.data?.users || [];
    },
  });

  const handleInvite = async () => {
    if (!inviteEmail.trim()) { toast.error("Bitte E-Mail eingeben"); return; }
    setInviting(true);
    try {
      await functions.invoke('inviteUser', { email: inviteEmail, role: inviteRole });
      toast.success(`Einladung an ${inviteEmail} gesendet`);
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["allUsers"] });
    } catch (error) {
      toast.error("Fehler: " + error.message);
    } finally {
      setInviting(false);
    }
  };

  const handleMakeAdmin = async (userId) => {
    try {
      await functions.invoke('makeAdmin', { user_id: userId });
      toast.success("Rolle auf Admin geändert");
      queryClient.invalidateQueries({ queryKey: ["allUsers"] });
    } catch (e) {
      toast.error("Fehler: " + e.message);
    }
  };

  const handleDeleteSuccess = () => {
    setUserToDelete(null);
    queryClient.invalidateQueries({ queryKey: ["allUsers"] });
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
    <div className="min-h-screen p-6" style={{ backgroundColor: bg }}>
      <div className="max-w-3xl mx-auto">
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
                <div key={user.id} className="flex items-center justify-between p-4" style={{ borderBottom: i < users.length - 1 ? `1px solid ${cardBorder}` : 'none' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0" style={{ backgroundColor: accentBg }}>
                      {user.full_name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium" style={{ color: textPrimary }}>
                        {user.full_name || 'Kein Name'}
                        {user.id === currentUser?.id && <span className="ml-2 text-xs" style={{ color: textSecondary }}>(Sie)</span>}
                      </div>
                      <div className="text-xs flex items-center gap-1" style={{ color: textSecondary }}>
                        <Mail className="h-3 w-3" />
                        {user.email}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <RoleBadge role={user.role} />
                    {user.id !== currentUser?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-lg" style={{ color: textSecondary }}>
                            ···
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
                          {user.role !== 'admin' && (
                            <DropdownMenuItem onClick={() => handleMakeAdmin(user.id)} style={{ color: textPrimary }}>
                              <Shield className="h-4 w-4 mr-2" />
                              Zum Admin machen
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
              ))}
            </div>
          )}
        </div>
      </div>

      {userToDelete && (
        <DeleteUserDialog
          user={userToDelete}
          onClose={() => setUserToDelete(null)}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
}
