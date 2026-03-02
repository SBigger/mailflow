import React, { useState } from "react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function DeleteUserDialog({ open, onClose, userToDelete, allUsers, onDeleted }) {
  const [transferToId, setTransferToId] = useState('');
  const [loading, setLoading] = useState(false);

  const otherUsers = allUsers.filter(u => u.id !== userToDelete?.id);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await functions.invoke('deleteUser', {
        userId: userToDelete.id,
        transferToId: transferToId || null
      });

      if (res.data.success) {
        toast.success(`Benutzer ${userToDelete.email} gelöscht`);
        onDeleted?.();
        onClose();
      } else {
        toast.error(res.data.error || 'Fehler beim Löschen');
      }
    } catch (err) {
      toast.error("Fehler: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!userToDelete) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" /> Benutzer entfernen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-zinc-400">
            Benutzer <span className="text-white font-semibold">{userToDelete.full_name || userToDelete.email}</span> wird gelöscht.
          </p>

          {otherUsers.length > 0 && (
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">
                <span className="text-zinc-300 font-medium">Optional:</span> Daten übertragen auf
              </label>
              <select
                value={transferToId}
                onChange={e => setTransferToId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md px-3 py-2 text-sm"
              >
                <option value="">-- Daten nicht übertragen --</option>
                {otherUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
              <p className="text-xs text-zinc-500 mt-2">
                Falls gewählt: Tasks, Mandatsleiter- und Sachbearbeiter-Zuweisungen werden übertragen.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">Abbrechen</Button>
          <Button
            onClick={handleDelete}
            disabled={loading}
            className="bg-red-600 hover:bg-red-500 text-white"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}