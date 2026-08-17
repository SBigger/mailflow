import React, { useMemo, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Users, Plus, Trash2, Search, Loader2, X, Shield, Building2, Ban, CheckCircle2, Pencil,
} from "lucide-react";

// ── Gruppenverwaltung ──────────────────────────────────────────────────────
// Eine Gruppe ist ein wiederverwendbares Bündel:
//   · staff_role gesetzt  → Mitarbeitergruppe (gibt die Rolle vor)
//   · Kundenliste         → Mandanten-Bündel für Portal-Zugänge
// Beides kann kombiniert werden, muss aber nicht.
// ---------------------------------------------------------------------------

export const STAFF_ROLES = [
  { value: "",               label: "Kundengruppe (keine Rolle)" },
  { value: "admin",          label: "Administrator" },
  { value: "mandatsleiter",  label: "Mandatsleiter" },
  { value: "sachbearbeiter", label: "Sachbearbeiter" },
  { value: "readonly",       label: "Nur-Lesen / Revisor" },
  { value: "task_user",      label: "Task-Mitarbeiter" },
];

export default function GruppenVerwaltung({ s, customers, canManage }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [staffRole, setStaffRole] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["access_groups_full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_groups")
        .select("*, access_group_customers(customer_id), access_group_portal(portal_user_id), access_group_staff(user_id)")
        .order("name");
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  async function createGroup() {
    if (!name.trim()) { toast.error("Bitte einen Namen vergeben."); return; }
    setCreating(true);
    try {
      const { error } = await supabase.from("access_groups").insert({
        name: name.trim(),
        beschreibung: beschreibung.trim(),
        staff_role: staffRole || null,
      });
      if (error) {
        if (error.code === "23505") throw new Error("Eine Gruppe mit diesem Namen existiert bereits.");
        throw new Error(error.message);
      }
      toast.success("Gruppe angelegt.");
      setName(""); setBeschreibung(""); setStaffRole("");
      qc.invalidateQueries({ queryKey: ["access_groups_full"] });
      qc.invalidateQueries({ queryKey: ["access_groups_with_customers"] });
    } catch (e) { toast.error(e.message); } finally { setCreating(false); }
  }

  async function toggleAktiv(g) {
    const { error } = await supabase.from("access_groups").update({ aktiv: !g.aktiv }).eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success(g.aktiv ? "Gruppe deaktiviert." : "Gruppe aktiviert.");
    qc.invalidateQueries({ queryKey: ["access_groups_full"] });
    qc.invalidateQueries({ queryKey: ["access_groups_with_customers"] });
  }

  async function removeGroup(g) {
    const mitglieder = (g.access_group_portal?.length || 0) + (g.access_group_staff?.length || 0);
    const warn = mitglieder
      ? `\n\nAchtung: ${mitglieder} Mitglied(er) verlieren damit die über diese Gruppe erteilten Freigaben.`
      : "";
    if (!confirm(`Gruppe „${g.name}" wirklich löschen?${warn}`)) return;
    const { error } = await supabase.from("access_groups").delete().eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Gruppe gelöscht.");
    qc.invalidateQueries({ queryKey: ["access_groups_full"] });
    qc.invalidateQueries({ queryKey: ["access_groups_with_customers"] });
  }

  const inp = {
    width: "100%", border: `1px solid ${s.line}`, background: s.surface2, color: s.ink,
    borderRadius: 9, padding: "10px 12px", fontSize: 14, outline: "none",
  };
  const lbl = { fontSize: 12, fontWeight: 600, color: s.muted, display: "block", marginBottom: 5 };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 22, alignItems: "start" }}>
      <div style={{ background: s.surface, border: `1px solid ${s.line}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: s.ink }}>Gruppen</h2>
          <span style={{ fontSize: 12.5, color: s.faint }}>{groups.length} gesamt</span>
        </div>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: "center", color: s.faint }}>
            <Loader2 size={20} className="animate-spin" style={{ display: "inline" }} /> Lädt…
          </div>
        ) : groups.length === 0 ? (
          <div style={{ padding: 44, textAlign: "center", color: s.faint, fontSize: 14 }}>
            Noch keine Gruppen. Rechts die erste anlegen.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: s.surface2 }}>
                {["Gruppe", "Art", "Mandanten", "Mitglieder", ""].map((h, i) => (
                  <th key={i} style={{ fontSize: 11.5, letterSpacing: ".05em", textTransform: "uppercase",
                    color: s.faint, fontWeight: 600, textAlign: "left", padding: "11px 16px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id} style={{ borderTop: `1px solid ${s.line}`, opacity: g.aktiv ? 1 : .55 }}>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: s.ink }}>{g.name}</div>
                    {g.beschreibung && <div style={{ color: s.faint, fontSize: 12.5 }}>{g.beschreibung}</div>}
                    {!g.aktiv && <div style={{ color: s.faint, fontSize: 12 }}>deaktiviert — gibt keine Freigaben mehr</div>}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    {g.staff_role ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5,
                        fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: s.accentSoft, color: s.accentInk }}>
                        <Shield size={12} />
                        {STAFF_ROLES.find(r => r.value === g.staff_role)?.label || g.staff_role}
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: s.muted }}>Kundengruppe</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", color: s.muted, fontSize: 14 }}>
                    {g.access_group_customers?.length || 0}
                  </td>
                  <td style={{ padding: "12px 16px", color: s.muted, fontSize: 14 }}>
                    {(g.access_group_portal?.length || 0) + (g.access_group_staff?.length || 0)}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <IconBtn s={s} title="Mandanten der Gruppe" disabled={!canManage} onClick={() => setEditing(g)}>
                        <Pencil size={16} />
                      </IconBtn>
                      <IconBtn s={s} title={g.aktiv ? "Deaktivieren" : "Aktivieren"} disabled={!canManage} onClick={() => toggleAktiv(g)}>
                        {g.aktiv ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                      </IconBtn>
                      <IconBtn s={s} title="Löschen" danger disabled={!canManage} onClick={() => removeGroup(g)}>
                        <Trash2 size={16} />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ background: s.surface, border: `1px solid ${s.line}`, borderRadius: 14 }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 9 }}>
          <Plus size={17} style={{ color: s.accent }} />
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: s.ink }}>Neue Gruppe</h2>
        </div>
        <div style={{ padding: "16px 18px 20px" }}>
          <label style={lbl}>Name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)}
            placeholder="z.B. Meier Holding + Töchter" disabled={!canManage} />

          <label style={{ ...lbl, marginTop: 14 }}>Beschreibung</label>
          <input style={inp} value={beschreibung} onChange={e => setBeschreibung(e.target.value)}
            placeholder="optional" disabled={!canManage} />

          <label style={{ ...lbl, marginTop: 14 }}>Art</label>
          <select style={inp} value={staffRole} onChange={e => setStaffRole(e.target.value)} disabled={!canManage}>
            {STAFF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <p style={{ margin: "7px 0 0", fontSize: 12, color: s.faint, lineHeight: 1.5 }}>
            {staffRole
              ? "Mitarbeiter in dieser Gruppe erhalten diese Rolle. Mandanten lassen sich zusätzlich hinterlegen."
              : "Reines Mandanten-Bündel für Portal-Zugänge — ohne Wirkung auf Mitarbeiterrollen."}
          </p>

          <button onClick={createGroup} disabled={creating || !canManage}
            style={{ width: "100%", marginTop: 18, border: 0, borderRadius: 9, padding: "12px 16px", fontSize: 15,
              fontWeight: 600, background: s.accent, color: "#fff",
              cursor: creating || !canManage ? "default" : "pointer", opacity: creating || !canManage ? .6 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
            {creating ? <Loader2 size={17} className="animate-spin" /> : <Users size={17} />}
            Gruppe anlegen
          </button>
          {!canManage && (
            <p style={{ marginTop: 12, fontSize: 12.5, color: s.faint, lineHeight: 1.5 }}>
              Nur Administratoren und Mandatsleiter dürfen Gruppen ändern.
            </p>
          )}
        </div>
      </div>

      {editing && (
        <GruppenKundenDialog s={s} group={editing} customers={customers} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Mandanten einer Gruppe pflegen ─────────────────────────────────────────
function GruppenKundenDialog({ group, customers, s, onClose }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const initial = useMemo(
    () => new Set((group.access_group_customers || []).map(r => r.customer_id)),
    [group],
  );
  const [checked, setChecked] = useState(initial);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.filter(c => c.company_name);
    return (q ? list.filter(c => c.company_name.toLowerCase().includes(q)) : list.filter(c => checked.has(c.id)))
      .slice(0, 200);
  }, [customers, search, checked]);

  function toggle(id) {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const add = [...checked].filter(id => !initial.has(id));
      const del = [...initial].filter(id => !checked.has(id));
      if (del.length) {
        const { error } = await supabase.from("access_group_customers")
          .delete().eq("group_id", group.id).in("customer_id", del);
        if (error) throw new Error(error.message);
      }
      if (add.length) {
        const { error } = await supabase.from("access_group_customers")
          .insert(add.map(customer_id => ({ group_id: group.id, customer_id })));
        if (error) throw new Error(error.message);
      }
      toast.success("Mandanten der Gruppe gespeichert.");
      qc.invalidateQueries({ queryKey: ["access_groups_full"] });
      qc.invalidateQueries({ queryKey: ["access_groups_with_customers"] });
      onClose?.();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.42)", zIndex: 60,
      display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: "100%", height: "100%",
        background: s.surface, borderLeft: `1px solid ${s.line}`, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: s.ink }}>{group.name}</h2>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: s.muted }}>Mandanten dieser Gruppe</p>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", border: 0, background: "transparent", color: s.muted, cursor: "pointer" }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          <div style={{ position: "relative", marginBottom: 10 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: s.faint }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Mandant suchen…"
              style={{ width: "100%", border: `1px solid ${s.line}`, background: s.surface2, color: s.ink,
                borderRadius: 9, padding: "9px 12px 9px 32px", fontSize: 14, outline: "none" }} />
          </div>

          {visible.length === 0 ? (
            <div style={{ padding: "22px 12px", color: s.faint, fontSize: 13.5, textAlign: "center" }}>
              {search.trim() ? "Kein Mandant gefunden." : "Noch nichts zugeordnet — oben suchen und anhaken."}
            </div>
          ) : (
            <div style={{ border: `1px solid ${s.line}`, borderRadius: 11, overflow: "hidden" }}>
              {visible.map((c, i) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px",
                  borderTop: i ? `1px solid ${s.line}` : "none", cursor: "pointer",
                  background: checked.has(c.id) ? s.surface2 : "transparent" }}>
                  <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)}
                    style={{ width: 16, height: 16, accentColor: s.accent, cursor: "pointer" }} />
                  <Building2 size={14} style={{ color: s.faint }} />
                  <span style={{ fontSize: 13.5, color: s.ink, fontWeight: checked.has(c.id) ? 600 : 400 }}>
                    {c.company_name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: s.muted }}>
            <strong style={{ color: s.ink }}>{checked.size}</strong> Mandant{checked.size === 1 ? "" : "en"}
          </span>
          <button onClick={onClose} style={{ marginLeft: "auto", border: `1px solid ${s.line}`, background: s.surface2,
            color: s.muted, borderRadius: 9, padding: "9px 15px", fontSize: 14, cursor: "pointer" }}>
            Abbrechen
          </button>
          <button onClick={save} disabled={saving}
            style={{ border: 0, background: s.accent, color: "#fff", borderRadius: 9, padding: "9px 18px",
              fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? .7 : 1,
              display: "flex", alignItems: "center", gap: 8 }}>
            {saving && <Loader2 size={15} className="animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick, s, danger, disabled }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${s.line}`, background: s.surface2,
        color: danger ? "#bb4438" : s.muted, display: "grid", placeItems: "center",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? .4 : 1 }}>
      {children}
    </button>
  );
}
