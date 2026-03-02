import React, { useState } from "react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Users, Mail, UserPlus, Trash2, Shield, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function UserManagement() {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviting, setInviting] = useState(false);

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => entities.User.list(),
  });

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error("Bitte E-Mail eingeben");
      return;
    }

    setInviting(true);
    try {
      await auth.inviteUser(inviteEmail, inviteRole);
      toast.success("Einladung gesendet");
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (error) {
      toast.error("Fehler: " + error.message);
    } finally {
      setInviting(false);
    }
  };

  if (currentUser?.role !== "admin") {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <Card className="bg-zinc-900 border-zinc-800 p-8 text-center">
          <Shield className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-zinc-200 mb-2">Zugriff verweigert</h2>
          <p className="text-zinc-500">Nur Administratoren können auf die Benutzerverwaltung zugreifen.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Users className="h-8 w-8 text-indigo-400" />
          <div>
            <h1 className="text-3xl font-bold text-zinc-100">Benutzerverwaltung</h1>
            <p className="text-sm text-zinc-500">Mitarbeiter einladen und verwalten</p>
          </div>
        </div>

        {/* Invite Section */}
        <Card className="bg-zinc-900/50 border-zinc-800 p-6 mb-6">
          <h2 className="text-lg font-semibold text-zinc-200 mb-4 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-indigo-400" />
            Neuen Benutzer einladen
          </h2>
          <div className="flex gap-3">
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@firma.de"
              className="flex-1 bg-zinc-900 border-zinc-800 text-zinc-200"
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="border-zinc-700 text-zinc-300">
                  {inviteRole === 'admin' ? <Shield className="h-4 w-4 mr-2" /> : <UserIcon className="h-4 w-4 mr-2" />}
                  {inviteRole === 'admin' ? 'Admin' : 'Benutzer'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-zinc-900 border-zinc-800">
                <DropdownMenuItem onClick={() => setInviteRole('user')} className="text-zinc-300">
                  <UserIcon className="h-4 w-4 mr-2" />
                  Benutzer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setInviteRole('admin')} className="text-zinc-300">
                  <Shield className="h-4 w-4 mr-2" />
                  Admin
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              onClick={handleInvite}
              disabled={inviting}
              className="bg-indigo-600 hover:bg-indigo-500"
            >
              {inviting ? 'Lädt...' : 'Einladen'}
            </Button>
          </div>
        </Card>

        {/* Users List */}
        <Card className="bg-zinc-900/50 border-zinc-800 p-6">
          <h2 className="text-lg font-semibold text-zinc-200 mb-4">
            Benutzer ({users.length})
          </h2>
          {isLoading ? (
            <div className="text-zinc-500 text-center py-8">Lädt...</div>
          ) : users.length === 0 ? (
            <div className="text-zinc-500 text-center py-8">Keine Benutzer vorhanden</div>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-4 bg-zinc-900/60 rounded-lg border border-zinc-800/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 font-semibold">
                      {user.full_name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-zinc-200">{user.full_name || 'Unbekannt'}</div>
                      <div className="text-xs text-zinc-500 flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {user.email}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {user.role === 'admin' ? (
                      <span className="text-xs px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-md flex items-center gap-1">
                        <Shield className="h-3 w-3" />
                        Admin
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 bg-zinc-800/50 text-zinc-400 rounded-md flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        Benutzer
                      </span>
                    )}
                    {user.id === currentUser?.id && (
                      <span className="text-xs text-zinc-600">(Sie)</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}