import React, { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { entities, functions } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, RefreshCw } from "lucide-react";

export const CATEGORIES = [
  "MWST",
  "Steuererklärung",
  "Lohnabrechnung",
  "AHV / IV / ALV",
  "Jahresabschluss",
  "Pensionskasse",
  "Unfallversicherung",
  "Behörden",
  "Verschiedenes",
];

const RECURRENCE_OPTIONS = [
  { value: "monthly",   label: "Monatlich" },
  { value: "quarterly", label: "Quartalsweise" },
  { value: "yearly",    label: "Jährlich" },
];

// Generate year range: 3 years back → 3 years ahead
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);

export default function AddFristDialog({ open, onClose, onSave, initial = null }) {
  const isEdit = !!(initial && initial.id);

  const [title,          setTitle]          = useState("");
  const [description,    setDescription]    = useState("");
  const [dueDate,        setDueDate]        = useState("");
  const [category,       setCategory]       = useState("Verschiedenes");
  const [jahr,           setJahr]           = useState(String(currentYear));
  const [customerId,     setCustomerId]     = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustDrop,   setShowCustDrop]   = useState(false);
  const [assignee,       setAssignee]       = useState("");
  const [recurring,      setRecurring]      = useState(false);
  const [recurrence,     setRecurrence]     = useState("yearly");
  const [saving,         setSaving]         = useState(false);

  // Pre-fill when editing
  useEffect(() => {
    if (open && initial) {
      setTitle(initial.title || "");
      setDescription(initial.description || "");
      setDueDate(initial.due_date || "");
      setCategory(initial.category || "Verschiedenes");
      setJahr(initial.jahr ? String(initial.jahr) : String(currentYear));
      setCustomerId(initial.customer_id || "");
      setAssignee(initial.assignee || "");
      setRecurring(initial.is_recurring || false);
      setRecurrence(initial.recurrence || "yearly");
      setCustomerSearch("");
    } else if (open && !initial) {
      setTitle(""); setDescription(""); setDueDate("");
      setCategory("Verschiedenes"); setJahr(String(currentYear));
      setCustomerId(""); setAssignee("");
      setCustomerSearch(""); setRecurring(false); setRecurrence("yearly");
    }
  }, [open, initial]);

  const { data: users = [] } = useQuery({
    queryKey: ["allUsers-fristen"],
    queryFn: async () => {
      const res = await functions.invoke("getAllUsers");
      return res.data?.users || [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  // Keep customerSearch in sync with selected customer
  useEffect(() => {
    if (customerId) {
      const c = customers.find(c => c.id === customerId);
      if (c) setCustomerSearch(c.company_name);
    }
  }, [customerId, customers]);

  const filteredCustomers = customers.filter(c =>
    c.company_name.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const handleSave = async () => {
    if (!title.trim() || !dueDate || !customerId) return;
    setSaving(true);
    try {
      await onSave({
        title:        title.trim(),
        description:  description.trim() || null,
        due_date:     dueDate,
        category,
        jahr:         parseInt(jahr, 10),
        customer_id:  customerId || null,
        assignee:     assignee || null,
        is_recurring: recurring,
        recurrence:   recurring ? recurrence : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-amber-400" />
            {isEdit ? "Frist bearbeiten" : "Neue Frist"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Bezeichnung *</Label>
            <Input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="z.B. MWST Q1"
              className="bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-500"
            />
          </div>

          {/* Category + Jahr + Due Date */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-1">
              <Label className="text-zinc-300">Kategorie</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c} className="text-zinc-200 text-sm">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 col-span-1">
              <Label className="text-zinc-300">Jahr *</Label>
              <Select value={jahr} onValueChange={setJahr}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {YEARS.map(y => (
                    <SelectItem key={y} value={String(y)} className="text-zinc-200">{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 col-span-1">
              <Label className="text-zinc-300">Fällig am *</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-zinc-200"
              />
            </div>
          </div>

          {/* Customer — Pflichtfeld */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Kunde *</Label>
            <div className="relative">
              <Input
                value={customerSearch}
                onChange={e => {
                  setCustomerSearch(e.target.value);
                  setShowCustDrop(true);
                  if (!e.target.value) setCustomerId("");
                }}
                onFocus={() => setShowCustDrop(true)}
                onBlur={() => setTimeout(() => setShowCustDrop(false), 150)}
                placeholder="Kunde suchen..."
                className={`bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-500 ${!customerId && customerSearch === "" ? "border-zinc-600" : ""}`}
                autoComplete="off"
              />
              {!customerId && customerSearch && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-amber-400">Auswählen</span>
              )}
              {showCustDrop && (
                <div className="absolute z-50 top-full left-0 mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {filteredCustomers.length === 0 && (
                    <div className="px-3 py-2 text-zinc-500 text-sm">Keine Kunden gefunden</div>
                  )}
                  {filteredCustomers.map(c => (
                    <div
                      key={c.id}
                      className="px-3 py-2 text-zinc-200 text-sm cursor-pointer hover:bg-zinc-800"
                      onMouseDown={() => { setCustomerId(c.id); setCustomerSearch(c.company_name); setShowCustDrop(false); }}
                    >
                      {c.company_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Assignee */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Zuständig (optional)</Label>
            <Select value={assignee || "none"} onValueChange={v => setAssignee(v === "none" ? "" : v)}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
                <SelectValue placeholder="Benutzer wählen..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="none" className="text-zinc-400">Niemand</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={u.email} className="text-zinc-200">
                    {u.full_name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300">Notiz (optional)</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Hinweise, Details..."
              className="bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-500 h-16 resize-none"
            />
          </div>

          {/* Recurring */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="recurring"
              checked={recurring}
              onChange={e => setRecurring(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <Label htmlFor="recurring" className="text-zinc-300 cursor-pointer flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 text-zinc-400" /> Wiederkehrend
            </Label>
            {recurring && (
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 h-8 text-sm ml-auto w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {RECURRENCE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value} className="text-zinc-200">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">Abbrechen</Button>
          <Button
            onClick={handleSave}
            disabled={!title.trim() || !dueDate || !customerId || saving}
            className="bg-amber-600 hover:bg-amber-500 text-white"
          >
            {saving ? "Speichern..." : isEdit ? "Speichern" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
