import React, { useState, useMemo, useContext } from "react";
import { supabase, entities, functions } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";
import {
  ShieldCheck, Mail, UserPlus, Search, Building2, Trash2, Ban,
  CheckCircle2, Send, Clock, Loader2, Lock, X, Link as LinkIcon,
} from "lucide-react";

// ── Kundenportal-Verwaltung ────────────────────────────────────────────────
// Interne Seite: Portal-Zugänge anlegen/sperren. Die E-Mail steuert den Zugang.
// Portal-Nutzer sind KEINE Supabase-Auth-User — Zugriff läuft über die Edge
// Function `portal-api` (service_role). Diese Seite pflegt nur `portal_users`.
// ---------------------------------------------------------------------------

const ACCENT = "#0e756a";

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function initials(v, n) {
  return ((v?.[0] || "") + (n?.[0] || "")).toUpperCase() || "?";
}

export default function Kundenportal() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light" || theme === "artis";
  const qc = useQueryClient();

  const s = useMemo(() => ({
    bg:        isLight ? "#f6f8f7" : "#0c1211",
    surface:   isLight ? "#ffffff" : "#141d1b",
    surface2:  isLight ? "#f6f8f7" : "#101816",
    ink:       isLight ? "#132420" : "#e9efed",
    muted:     isLight ? "#5c6c67" : "#93a39e",
    faint:     isLight ? "#8b9994" : "#6d7d78",
    line:      isLight ? "#e1e6e4" : "#232e2b",
    accent:    ACCENT,
    accentSoft:isLight ? "#dceeea" : "#153230",
    accentInk: isLight ? "#0a544c" : "#8fe0d4",
  }), [isLight]);

  const [vorname, setVorname]   = useState("");
  const [nachname, setNachname] = useState("");
  const [email, setEmail]       = useState("");
  const [custId, setCustId]     = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [saving, setSaving]     = useState(false);
  const [busyId, setBusyId]     = useState(null);
  const [search, setSearch]     = useState("");

  // Portal-Nutzer inkl. Kundenname (FK customer_id → customers)
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["portal_users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_users")
        .select("*, customer:customers(company_name)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers_for_portal"],
    queryFn: () => entities.Customer.list("company_name", 5000),
  });

  const custOptions = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    const list = customers.filter(c => c.company_name);
    if (!q) return list.slice(0, 50);
    return list.filter(c => c.company_name.toLowerCase().includes(q)).slice(0, 50);
  }, [customers, custSearch]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      `${u.vorname} ${u.nachname} ${u.email} ${u.customer?.company_name || ""}`.toLowerCase().includes(q)
    );
  }, [users, search]);

  const activeCount = users.filter(u => u.is_active).length;

  // Best-effort: Magic-Link-Mail über portal-api verschicken (falls deployt)
  async function sendInvite(emailAddr) {
    try {
      await functions.invoke("portal-api", {
        action: "request-link",
        email: emailAddr,
        appUrl: window.env.HOSTNAME
      });
      return true;
    } catch {
      return false;
    }
  }

  async function handleCreate() {
    const em = email.trim().toLowerCase();
    if (!vorname.trim() || !nachname.trim()) { toast.error("Vor- und Nachname sind Pflicht."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast.error("Bitte eine gültige E-Mail-Adresse eingeben."); return; }
    if (!custId) { toast.error("Bitte einen Mandanten wählen."); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("portal_users").insert({
        email: em, vorname: vorname.trim(), nachname: nachname.trim(),
        customer_id: custId, invited_by: user?.id, is_active: true,
      });
      if (error) {
        if (error.code === "23505") throw new Error("Für diese E-Mail existiert bereits ein Zugang.");
        throw new Error(error.message);
      }
      const mailed = await sendInvite(em);
      toast.success(mailed
        ? "Zugang angelegt — Einladungslink per E-Mail verschickt."
        : "Zugang angelegt. Einladungsmail folgt, sobald portal-api deployt ist.");
      setVorname(""); setNachname(""); setEmail(""); setCustId(""); setCustSearch("");
      qc.invalidateQueries({ queryKey: ["portal_users"] });
    } catch (e) {
      toast.error(e.message);
    } finally { setSaving(false); }
  }

  async function toggleActive(u) {
    setBusyId(u.id);
    try {
      const { error } = await supabase.from("portal_users").update({ is_active: !u.is_active }).eq("id", u.id);
      if (error) throw new Error(error.message);
      toast.success(u.is_active ? "Zugang gesperrt." : "Zugang wieder freigegeben.");
      qc.invalidateQueries({ queryKey: ["portal_users"] });
    } catch (e) { toast.error(e.message); } finally { setBusyId(null); }
  }

  async function removeUser(u) {
    if (!confirm(`Zugang von ${u.vorname} ${u.nachname} (${u.email}) wirklich entfernen?`)) return;
    setBusyId(u.id);
    try {
      const { error } = await supabase.from("portal_users").delete().eq("id", u.id);
      if (error) throw new Error(error.message);
      toast.success("Zugang entfernt.");
      qc.invalidateQueries({ queryKey: ["portal_users"] });
    } catch (e) { toast.error(e.message); } finally { setBusyId(null); }
  }

  async function resend(u) {
    setBusyId(u.id);
    const ok = await sendInvite(u.email);
    toast[ok ? "success" : "error"](ok
      ? `Anmeldelink an ${u.email} verschickt.`
      : "Versand fehlgeschlagen — portal-api noch nicht deployt?");
    setBusyId(null);
  }

  // Anmeldelink erzeugen und in die Zwischenablage kopieren (zum Weitergeben)
  async function copyLink(u) {
    setBusyId(u.id);
    try {
      const { data } = await functions.invoke("portal-api", { action: "create-link", portal_user_id: u.id });
      if (!data?.link) throw new Error(data?.error || "Kein Link erhalten.");
      try { await navigator.clipboard.writeText(data.link); toast.success("Anmeldelink kopiert (7 Tage gültig)."); }
      catch { window.prompt("Anmeldelink (7 Tage gültig) — kopieren mit Strg+C:", data.link); }
    } catch (e) {
      toast.error(e.message || "Link konnte nicht erstellt werden.");
    } finally { setBusyId(null); }
  }

  const inp = {
    width: "100%", border: `1px solid ${s.line}`, background: s.surface2, color: s.ink,
    borderRadius: 9, padding: "10px 12px", fontSize: 14, outline: "none",
  };
  const lbl = { fontSize: 12, fontWeight: 600, color: s.muted, display: "block", marginBottom: 5 };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: s.bg, minHeight: "100%", color: s.ink, padding: "26px 28px" }}>
      {/* Kopf */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 6 }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: s.accentSoft, color: s.accentInk,
          display: "grid", placeItems: "center" }}>
          <ShieldCheck size={22} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Kundenportal</h1>
          <p style={{ margin: "2px 0 0", color: s.muted, fontSize: 14 }}>
            Read-only-Zugänge für Kunden. Die E-Mail steuert den Zugang — jederzeit sperrbar.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 22, alignItems: "start", marginTop: 20 }}>
        {/* Liste */}
        <div style={{ background: s.surface, border: `1px solid ${s.line}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Portal-Zugänge</h2>
            <span style={{ fontSize: 12.5, color: s.faint }}>{activeCount} aktiv · {users.length} gesamt</span>
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: s.faint }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Suchen…"
                style={{ ...inp, padding: "7px 10px 7px 32px", width: 200, fontSize: 13 }} />
            </div>
          </div>

          {isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: s.faint }}>
              <Loader2 size={20} className="animate-spin" style={{ display: "inline" }} /> Lädt…
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ padding: 44, textAlign: "center", color: s.faint, fontSize: 14 }}>
              {users.length === 0 ? "Noch keine Portal-Zugänge. Rechts den ersten Kunden einladen." : "Keine Treffer."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: s.surface2 }}>
                    {["Person", "Mandant", "Status", "Letzter Login", ""].map((h, i) => (
                      <th key={i} style={{ fontSize: 11.5, letterSpacing: ".05em", textTransform: "uppercase",
                        color: s.faint, fontWeight: 600, textAlign: "left", padding: "11px 16px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id} style={{ borderTop: `1px solid ${s.line}` }}>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: s.accentSoft,
                            color: s.accentInk, display: "grid", placeItems: "center", fontWeight: 600, fontSize: 12 }}>
                            {initials(u.vorname, u.nachname)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{u.vorname} {u.nachname}</div>
                            <div style={{ color: s.faint, fontSize: 12.5 }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", color: s.muted, fontSize: 14 }}>
                        {u.customer?.company_name || <span style={{ color: s.faint }}>—</span>}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <StatusPill active={u.is_active} s={s} />
                      </td>
                      <td style={{ padding: "12px 16px", color: s.muted, fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>
                        {fmtDate(u.last_login_at)}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <IconBtn title="Anmeldelink kopieren" s={s} busy={busyId === u.id} onClick={() => copyLink(u)}><LinkIcon size={16} /></IconBtn>
                          <IconBtn title="Anmeldelink per E-Mail senden" s={s} busy={busyId === u.id} onClick={() => resend(u)}><Send size={16} /></IconBtn>
                          <IconBtn title={u.is_active ? "Sperren" : "Freigeben"} s={s} busy={busyId === u.id} onClick={() => toggleActive(u)}>
                            {u.is_active ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                          </IconBtn>
                          <IconBtn title="Entfernen" s={s} danger busy={busyId === u.id} onClick={() => removeUser(u)}><Trash2 size={16} /></IconBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Einladen */}
        <div style={{ background: s.surface, border: `1px solid ${s.line}`, borderRadius: 14 }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 9 }}>
            <UserPlus size={17} style={{ color: s.accent }} />
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Kunde einladen</h2>
          </div>
          <div style={{ padding: "16px 18px 20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={lbl}>Vorname</label><input style={inp} value={vorname} onChange={e => setVorname(e.target.value)} placeholder="Anna" /></div>
              <div><label style={lbl}>Nachname</label><input style={inp} value={nachname} onChange={e => setNachname(e.target.value)} placeholder="Muster" /></div>
            </div>
            <label style={{ ...lbl, marginTop: 14 }}>E-Mail — steuert den Zugang</label>
            <input style={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="anna.muster@firma.ch" type="email" />

            <label style={{ ...lbl, marginTop: 14 }}>Mandant</label>
            {custId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: s.accentSoft, border: `1px solid ${s.accent}`,
                borderRadius: 9, padding: "10px 12px" }}>
                <Building2 size={17} style={{ color: s.accentInk }} />
                <span style={{ color: s.accentInk, fontWeight: 600, fontSize: 14, flex: 1 }}>
                  {customers.find(c => c.id === custId)?.company_name}
                </span>
                <button onClick={() => { setCustId(""); setCustSearch(""); }} style={{ border: 0, background: "transparent", color: s.accentInk, cursor: "pointer" }}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                <div style={{ position: "relative" }}>
                  <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: s.faint }} />
                  <input style={{ ...inp, paddingLeft: 32 }} value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Mandant suchen…" />
                </div>
                {custSearch.trim() && (
                  <div style={{ border: `1px solid ${s.line}`, borderRadius: 9, marginTop: 6, maxHeight: 180, overflowY: "auto" }}>
                    {custOptions.length === 0 ? (
                      <div style={{ padding: "10px 12px", color: s.faint, fontSize: 13 }}>Kein Mandant gefunden.</div>
                    ) : custOptions.map(c => (
                      <button key={c.id} onClick={() => { setCustId(c.id); }}
                        style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderBottom: `1px solid ${s.line}`,
                          background: "transparent", color: s.ink, padding: "9px 12px", fontSize: 13.5, cursor: "pointer" }}>
                        {c.company_name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, background: s.surface2, border: `1px solid ${s.line}`,
              borderRadius: 9, padding: "10px 12px", marginTop: 10, fontSize: 13, color: s.muted }}>
              <Lock size={15} style={{ color: s.accent, flexShrink: 0 }} />
              Sieht read-only alle Dokumente dieses Mandanten.
            </div>

            <button onClick={handleCreate} disabled={saving}
              style={{ width: "100%", marginTop: 18, border: 0, borderRadius: 9, padding: "12px 16px", fontSize: 15, fontWeight: 600,
                background: s.accent, color: "#fff", cursor: saving ? "default" : "pointer", opacity: saving ? .7 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
              {saving ? <Loader2 size={17} className="animate-spin" /> : <Mail size={17} />}
              Einladung senden
            </button>
            <p style={{ marginTop: 12, fontSize: 12.5, color: s.faint, display: "flex", gap: 8, lineHeight: 1.5 }}>
              <Clock size={15} style={{ color: s.accent, flexShrink: 0, marginTop: 1 }} />
              Der Kunde erhält einen Anmeldelink (Magic-Link). Zugriff bleibt read-only und lässt sich hier jederzeit sperren.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ active, s }) {
  const cfg = active
    ? { bg: s.accentSoft, fg: s.accentInk, label: "Aktiv" }
    : { bg: s.surface2, fg: s.faint, label: "Gesperrt" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600,
      padding: "4px 10px", borderRadius: 20, background: cfg.bg, color: cfg.fg }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
      {cfg.label}
    </span>
  );
}

function IconBtn({ children, title, onClick, s, danger, busy }) {
  return (
    <button title={title} onClick={onClick} disabled={busy}
      style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${s.line}`, background: s.surface2,
        color: danger ? "#bb4438" : s.muted, display: "grid", placeItems: "center", cursor: busy ? "default" : "pointer", opacity: busy ? .5 : 1 }}>
      {children}
    </button>
  );
}
