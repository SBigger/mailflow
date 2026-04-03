import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Search } from "lucide-react";

export default function AssignToCustomerDialog({ open, onClose, mail }) {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
    enabled: open,
  });

  const assignMutation = useMutation({
    mutationFn: async (customer) => {
      await entities.CustomerMail.create({
        customer_id: customer.id,
        subject: mail.subject || "(kein Betreff)",
        sender_name: mail.sender_name || "",
        sender_email: mail.sender_email || "",
        to: mail.to || mail.recipient_email || "",
        body: mail.body || mail.body_preview || "",
        received_date: mail.received_date || new Date().toISOString(),
      });
      return customer;
    },
    onSuccess: (customer) => {
      toast.success(`Mail wurde "${customer.company_name}" zugeordnet`);
      queryClient.invalidateQueries({ queryKey: ["customer-mails"] });
      onClose();
    },
    onError: (err) => {
      toast.error("Fehler: " + err.message);
    },
  });

  const filtered = customers.filter(c =>
    c.company_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <Building2 className="h-4 w-4" /> Firma zuweisen
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-zinc-400 mb-2 truncate">
          Mail: <span className="text-zinc-300">{mail?.subject}</span>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Firma suchen..."
            className="bg-zinc-800 border-zinc-700 text-zinc-200 pl-8 h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.length === 0 && (
            <p className="text-zinc-600 text-sm text-center py-4">Keine Firmen gefunden</p>
          )}
          {filtered.map(customer => (
            <button
              key={customer.id}
              onClick={() => assignMutation.mutate(customer)}
              disabled={assignMutation.isPending}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-sm text-zinc-200 disabled:opacity-50"
            >
              <div className="font-medium">{customer.company_name}</div>
              {(customer.ort || customer.plz) && (
                <div className="text-xs text-zinc-500">{[customer.plz, customer.ort].filter(Boolean).join(" ")}</div>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}