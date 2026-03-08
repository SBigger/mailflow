import React, { useState, useContext } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThemeContext } from "@/Layout";
import { FileText, MessageSquare } from "lucide-react";

export default function AddTicketDialog({ open, onClose, defaultColumnId }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [fromEmail, setFromEmail]   = useState("");
  const [fromName, setFromName]     = useState("");
  const [title, setTitle]           = useState("");
  const [body, setBody]             = useState("");
  const [ticketType, setTicketType] = useState("regular");
  const [columnId, setColumnId]     = useState(defaultColumnId || "");
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading]       = useState(false);

  const { data: columns = [] } = useQuery({
    queryKey: ["ticketColumns"],
    queryFn: () => entities.TicketColumn.list("order"),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  const labelColor  = isArtis ? "#4a5e4a" : isLight ? "#4b4b80" : "#a1a1aa";
  const inputBg     = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.6)";
  const inputBorder = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.6)";

  const handleCreate = async () => {
    if (!fromEmail.trim() || !title.trim()) return;
    setLoading(true);
    try {
      // Erste Spalte als Default wenn nichts gewählt
      const targetColumn = columnId || columns[0]?.id;
      await entities.Ticket.create({
        from_email: fromEmail.trim(),
        from_name: fromName.trim() || null,
        title: title.trim(),
        body: body.trim() || null,
        ticket_type: ticketType,
        column_id: targetColumn,
        customer_id: (customerId && customerId !== "__none__") ? customerId : null,
        is_read: true,
      });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      handleClose();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFromEmail("");
    setFromName("");
    setTitle("");
    setBody("");
    setTicketType("regular");
    setColumnId(defaultColumnId || "");
    setCustomerId("");
    onClose();
  };

  const LabelStyle = { fontSize: "0.75rem", fontWeight: 600, color: labelColor, marginBottom: "4px" };
  const inputStyle = { backgroundColor: inputBg, borderColor: inputBorder, fontSize: "0.875rem" };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" style={{
        backgroundColor: isArtis ? "#f8faf8" : isLight ? "#f8f8fc" : "#18181b",
      }}>
        <DialogHeader>
          <DialogTitle style={{ color: isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7" }}>
            Neues Ticket erstellen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Ticket-Typ */}
          <div>
            <div style={LabelStyle}>Ticket-Typ</div>
            <div className="flex gap-2">
              <button
                onClick={() => setTicketType("regular")}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-colors"
                style={{
                  backgroundColor: ticketType === "regular"
                    ? (isArtis ? "#7a9b7f" : "#6366f1") : inputBg,
                  color: ticketType === "regular" ? "#fff" : labelColor,
                  borderColor: ticketType === "regular"
                    ? (isArtis ? "#7a9b7f" : "#6366f1") : inputBorder,
                }}
              >
                <MessageSquare className="h-4 w-4" />
                Anfrage
              </button>
              <button
                onClick={() => setTicketType("documents_only")}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-colors"
                style={{
                  backgroundColor: ticketType === "documents_only" ? "#3b82f6" : inputBg,
                  color: ticketType === "documents_only" ? "#fff" : labelColor,
                  borderColor: ticketType === "documents_only" ? "#3b82f6" : inputBorder,
                }}
              >
                <FileText className="h-4 w-4" />
                Unterlagen
              </button>
            </div>
          </div>

          {/* Von */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={LabelStyle}>E-Mail Absender *</div>
              <Input
                placeholder="max@beispiel.ch"
                value={fromEmail}
                onChange={e => setFromEmail(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <div style={LabelStyle}>Name</div>
              <Input
                placeholder="Max Mustermann"
                value={fromName}
                onChange={e => setFromName(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Betreff */}
          <div>
            <div style={LabelStyle}>Betreff *</div>
            <Input
              placeholder="Betreff der Anfrage"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Nachricht */}
          <div>
            <div style={LabelStyle}>Nachricht</div>
            <Textarea
              placeholder="Inhalt der Anfrage..."
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={4}
              style={inputStyle}
            />
          </div>

          {/* Spalte + Kunde */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={LabelStyle}>Spalte</div>
              <Select value={columnId} onValueChange={setColumnId}>
                <SelectTrigger style={inputStyle}>
                  <SelectValue placeholder="Spalte wählen" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map(col => (
                    <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div style={LabelStyle}>Kunde (optional)</div>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger style={inputStyle}>
                  <SelectValue placeholder="Kunden zuordnen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Kein Kunde —</SelectItem>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company_name || `${c.vorname || ""} ${c.nachname || ""}`.trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} style={{ borderColor: inputBorder }}>
            Abbrechen
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!fromEmail.trim() || !title.trim() || loading}
            style={{
              backgroundColor: isArtis ? "#7a9b7f" : "#6366f1",
              color: "#fff",
              opacity: (!fromEmail.trim() || !title.trim() || loading) ? 0.5 : 1,
            }}
          >
            {loading ? "Erstelle…" : "Ticket erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
