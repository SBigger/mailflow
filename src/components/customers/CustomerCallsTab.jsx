import React, { useContext, useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { PhoneIncoming, PhoneOutgoing, Phone, Clock, Pencil, Check, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";

/**
 * Telefonate-Tab im Kundenprofil.
 * Liest aus call_records (gefüllt von Edge Function sync-teams-calls).
 * Notizfeld pro Anruf inline editierbar.
 */
export default function CustomerCallsTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const muted    = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#a1a1aa";
  const subtle   = isArtis ? "#8aaa8f" : isLight ? "#9090b8" : "#52525b";
  const textMain = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const border   = isArtis ? "#e0e8e0" : isLight ? "#e4e4ea" : "rgba(63,63,70,0.6)";
  const hoverBg  = isArtis ? "#f2f5f2" : isLight ? "#ebebf4" : "rgba(63,63,70,0.4)";
  const inputBg  = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.6)";
  const accent   = isArtis ? "#4d6a50" : "#5b21b6";

  const queryClient = useQueryClient();
  const { data: calls = [], isLoading, error } = useQuery({
    queryKey: ["customer-calls", customer.id],
    queryFn:  () => entities.CallRecord.filter({ customer_id: customer.id }, "-start_time", 200),
    enabled:  !!customer.id,
  });

  const saveNoteMutation = useMutation({
    mutationFn: ({ id, notes }) => entities.CallRecord.update(id, { notes }),
    onSuccess: () => {
      toast.success("Notiz gespeichert");
      queryClient.invalidateQueries({ queryKey: ["customer-calls", customer.id] });
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  if (isLoading) return <div style={{ padding: 16, fontSize: 13, color: subtle }}>Lade Telefonate …</div>;
  if (error)     return <div style={{ padding: 16, fontSize: 13, color: "#b04040" }}>Fehler: {String(error?.message || error)}</div>;

  if (calls.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: subtle }}>
        Noch keine Telefonate zu diesem Kunden erfasst.<br />
        <span style={{ fontSize: 11.5, color: subtle }}>
          Telefonate werden einmal täglich automatisch aus Microsoft Teams synchronisiert.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 4 }}>
      {calls.map(call => (
        <CallRow
          key={call.id}
          call={call}
          onSaveNote={(notes) => saveNoteMutation.mutate({ id: call.id, notes })}
          saving={saveNoteMutation.isPending && saveNoteMutation.variables?.id === call.id}
          colors={{ muted, subtle, textMain, border, hoverBg, inputBg, accent }}
        />
      ))}
    </div>
  );
}

function CallRow({ call, onSaveNote, saving, colors }) {
  const { muted, subtle, textMain, border, hoverBg, inputBg, accent } = colors;
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(call.notes || "");
  const taRef = useRef(null);

  useEffect(() => { setDraft(call.notes || ""); }, [call.notes]);
  useEffect(() => { if (editing && taRef.current) { taRef.current.focus(); taRef.current.setSelectionRange(draft.length, draft.length); } }, [editing]); // eslint-disable-line

  const isIn  = call.direction === "incoming";
  const isOut = call.direction === "outgoing";
  const Icon  = isIn ? PhoneIncoming : isOut ? PhoneOutgoing : Phone;
  const iconColor = isIn ? "#2d6a4f" : isOut ? "#5b3fb8" : muted;

  const external     = isIn ? call.caller_number : call.callee_number;
  const externalName = isIn ? call.caller_name   : call.callee_name;

  const commit = () => { onSaveNote(draft.trim() || null); setEditing(false); };
  const cancel = () => { setDraft(call.notes || ""); setEditing(false); };

  return (
    <div
      style={{
        display: "flex", flexDirection: "column",
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${editing ? accent + "55" : "transparent"}`,
        background: editing ? hoverBg : undefined,
        transition: "background-color .12s, border-color .12s",
      }}
      onMouseEnter={e => { if (!editing) { e.currentTarget.style.backgroundColor = hoverBg; e.currentTarget.style.borderColor = border; } }}
      onMouseLeave={e => { if (!editing) { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.borderColor = "transparent"; } }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          flexShrink: 0, width: 32, height: 32, borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: iconColor + "22",
        }}>
          <Icon size={15} style={{ color: iconColor }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: textMain, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              {isIn ? "Eingehend" : isOut ? "Ausgehend" : "Anruf"}
              {external && <span style={{ color: muted, fontWeight: 400 }}> · {external}</span>}
            </span>
            {externalName && <span style={{ fontSize: 11.5, color: subtle, fontWeight: 400 }}>({externalName})</span>}
          </div>
          <div style={{ fontSize: 11.5, color: subtle, marginTop: 2, display: "flex", alignItems: "center", gap: 10 }}>
            {call.artis_user_name && <span>🧑 {call.artis_user_name}</span>}
            {call.call_type && (
              <span style={{ textTransform: "uppercase", letterSpacing: ".05em", fontSize: 9.5 }}>
                {call.call_type === "pstnCall" ? "Festnetz" : call.call_type}
              </span>
            )}
          </div>
        </div>

        <div style={{ flexShrink: 0, textAlign: "right", fontSize: 11.5, color: subtle }}>
          {call.start_time && (
            <div style={{ color: muted, fontSize: 12 }}>
              {format(new Date(call.start_time), "dd.MM.yyyy HH:mm", { locale: de })}
            </div>
          )}
          {typeof call.duration_seconds === "number" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 2 }}>
              <Clock size={10} />
              {formatDuration(call.duration_seconds)}
            </div>
          )}
        </div>
      </div>

      {/* Notizfeld */}
      <div style={{ marginTop: 8, marginLeft: 44 }}>
        {editing ? (
          <div>
            <textarea
              ref={taRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
                if (e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
              placeholder="Notizen zum Gespräch – Inhalt, Absprachen, ToDos … (Strg+Enter speichern, Esc abbrechen)"
              rows={3}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                border: `1px solid ${border}`,
                background: inputBg,
                color: textMain,
                fontSize: 12.5,
                resize: "vertical",
                fontFamily: "inherit",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
              <button
                onClick={cancel}
                disabled={saving}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 11.5, padding: "4px 10px", borderRadius: 6,
                  background: "transparent", color: subtle,
                  border: `1px solid ${border}`, cursor: "pointer",
                }}
              >
                <X size={12} /> Abbrechen
              </button>
              <button
                onClick={commit}
                disabled={saving}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 11.5, padding: "4px 10px", borderRadius: 6,
                  background: accent, color: "#fff",
                  border: `1px solid ${accent}`, cursor: "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Check size={12} /> {saving ? "Speichere…" : "Speichern"}
              </button>
            </div>
          </div>
        ) : call.notes ? (
          <div
            onClick={() => setEditing(true)}
            title="Klick zum Bearbeiten"
            style={{
              fontSize: 12.5, color: textMain, whiteSpace: "pre-wrap",
              padding: "6px 10px", borderRadius: 6,
              border: `1px dashed ${border}`,
              cursor: "pointer",
            }}
          >
            {call.notes}
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11.5, color: subtle,
              background: "transparent", border: "none", cursor: "pointer",
              padding: "2px 0",
            }}
          >
            <Pencil size={11} /> Notiz hinzufügen
          </button>
        )}
      </div>
    </div>
  );
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}:${String(s).padStart(2, "0")} min`;
}
