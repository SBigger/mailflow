import React, { useContext, useEffect, useRef, useState } from "react";
import { Phone, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { ThemeContext } from "@/Layout";

/**
 * Popup, das vor einem ausgehenden Anruf geöffnet wird.
 * - Speichern + Anrufen → legt eine Vorab-Notiz in `call_notes_pending` an
 *   und öffnet danach `tel:` (wird vom Desktop-Telefon/Teams aufgegriffen).
 * - Abbrechen (ESC oder X oder Abbrechen-Button) → KEIN Anruf, keine Notiz.
 *
 * Props:
 *   open:         boolean
 *   onClose:      () => void
 *   phone:        string (roh aus DB)
 *   customerId?:  string (wenn bekannt)
 *   customerName?: string (Anzeige im Kopf)
 *   contactLabel?: string (z.B. "Max Mustermann · CFO")
 */
export default function CallNotePopup({
  open,
  onClose,
  phone,
  customerId,
  customerName,
  contactLabel,
}) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const { user, profile } = useAuth();
  const [title, setTitle] = useState("");
  const [text,  setText]  = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setText("");
      // Focus beim Öffnen
      setTimeout(() => titleRef.current?.focus(), 30);
    }
  }, [open]);

  // ESC schließt (Abbrechen = kein Call)
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const panelBg   = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#1f1f24";
  const textMain  = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#5a5a7a" : "#9090b8";
  const subtle    = isArtis ? "#8aaa8f" : isLight ? "#9090b8" : "#71717a";
  const border    = isArtis ? "#d6e2d6" : isLight ? "#dcdcec" : "#3f3f46";
  const inputBg   = isArtis ? "#fafcfa" : isLight ? "#fafaff" : "rgba(24,24,27,0.6)";
  const accent    = isArtis ? "#4d6a50" : "#5b21b6";

  const normalizePhone = (raw) => {
    if (!raw) return null;
    let s = String(raw).replace(/[\s.\-()/]/g, "");
    if (s.startsWith("+41"))  return s;
    if (s.startsWith("0041")) return "+41" + s.slice(4);
    if (s.startsWith("00"))   return "+41" + s.slice(2);
    if (s.startsWith("0"))    return "+41" + s.slice(1);
    return s.startsWith("+") ? s : "+" + s;
  };

  const formatPhoneDisplay = (raw) => {
    if (!raw) return "";
    const n = normalizePhone(raw) || "";
    if (!n.startsWith("+41")) return raw;
    const rest = n.slice(3);
    if (rest.length === 9)
      return `+41 ${rest.slice(0,2)} ${rest.slice(2,5)} ${rest.slice(5,7)} ${rest.slice(7,9)}`;
    return n;
  };

  const cleanTel = normalizePhone(phone)?.replace(/[^+\d]/g, "") || "";
  const phoneSuffix = (norm) => {
    if (!norm) return null;
    const d = String(norm).replace(/\D/g, "");
    return d.length >= 7 ? d.slice(-9) : null;
  };

  const saveNote = async () => {
    setSaving(true);
    try {
      const normalized = normalizePhone(phone);
      const suf = phoneSuffix(normalized);
      const insertRow = {
        customer_id:      customerId || null,
        phone_number:     normalized || String(phone),
        phone_suffix:     suf,
        created_by:       user?.id || null,
        artis_user_name:  profile?.full_name || null,
        artis_user_email: user?.email || profile?.email || null,
        note_title:       title.trim() || null,
        note_text:        text.trim()  || null,
        clicked_at:       new Date().toISOString(),
      };
      const { error } = await supabase.from("call_notes_pending").insert(insertRow);
      if (error) throw error;
      toast.success("Notiz gespeichert");
      onClose();
    } catch (e) {
      toast.error(`Fehler beim Speichern: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveNote();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,15,25,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "92vw",
          background: panelBg,
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          border: `1px solid ${border}`,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px",
          borderBottom: `1px solid ${border}`,
          background: isArtis ? "#f2f7f2" : isLight ? "#f6f6fb" : "rgba(30,30,34,0.6)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: accent + "22",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Phone size={15} style={{ color: accent }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: textMain }}>
              Anruf notieren
            </div>
            <div style={{ fontSize: 11.5, color: subtle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {formatPhoneDisplay(phone) || phone}
              {customerName ? ` · ${customerName}` : ""}
              {contactLabel ? ` · ${contactLabel}` : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Abbrechen (ESC)"
            style={{
              border: "none", background: "transparent", cursor: "pointer",
              color: textMuted, padding: 4, borderRadius: 6,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: textMuted, marginBottom: 5 }}>
              Titel
            </label>
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="z.B. Rückruf zu Jahresrechnung 2025"
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 13,
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: inputBg,
                color: textMain,
                outline: "none",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: textMuted, marginBottom: 5 }}>
              Notiz
            </label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={5}
              placeholder="Was besprochen werden soll, offene Fragen, ToDos … (Strg+Enter = Speichern & Anrufen)"
              style={{
                width: "100%",
                padding: "10px",
                fontSize: 12.5,
                lineHeight: 1.45,
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: inputBg,
                color: textMain,
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ fontSize: 11, color: subtle, lineHeight: 1.5 }}>
            Die Notiz wird gespeichert und beim nächsten Teams-Sync automatisch
            mit dem passenden Anruf verknüpft (gleicher Mitarbeiter, gleiche
            Nummer, innerhalb ±30 Min).
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", gap: 8, justifyContent: "flex-end",
          padding: "12px 18px",
          borderTop: `1px solid ${border}`,
          background: isArtis ? "#fafcfa" : isLight ? "#fafaff" : "rgba(24,24,27,0.4)",
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "7px 14px",
              fontSize: 12.5,
              borderRadius: 7,
              border: `1px solid ${border}`,
              background: "transparent",
              color: textMuted,
              cursor: "pointer",
            }}
          >
            Abbrechen
          </button>
          <button
            onClick={saveNote}
            disabled={saving}
            style={{
              padding: "7px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 7,
              border: `1px solid ${accent}`,
              background: accent,
              color: "#fff",
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.6 : 1,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {saving ? "Speichere …" : "Notiz speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
