import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Search, Star, Users, Building2, Loader2, Check, Info } from "lucide-react";

// ── Zugriff eines Portal-Zugangs festlegen ─────────────────────────────────
// Zwei Wege, die sich addieren:
//   1. Gruppen  — wiederverwendbares Bündel (z.B. „Meier Holding + Töchter")
//   2. Häkchen  — einzelne Kunden direkt für diesen Zugang
// Der Hauptmandant (portal_users.customer_id) zählt IMMER dazu und lässt sich
// deshalb nicht abwählen — er wird stattdessen umgesetzt (Stern).
// Die effektive Liste berechnet die DB (portal_customer_ids); diese Oberfläche
// bildet sie nur ab, sie entscheidet nichts selbst.
// ---------------------------------------------------------------------------

export default function KundenZugriffDialog({ portalUser, customers, s, onClose }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [checked, setChecked] = useState(() => new Set());
  const [groupIds, setGroupIds] = useState(() => new Set());
  const [primary, setPrimary] = useState(portalUser?.customer_id || "");

  const { data: groups = [] } = useQuery({
    queryKey: ["access_groups_with_customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_groups")
        .select("id, name, beschreibung, staff_role, aktiv, access_group_customers(customer_id)")
        .order("name");
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: current, isLoading } = useQuery({
    queryKey: ["portal_access", portalUser?.id],
    enabled: !!portalUser?.id,
    queryFn: async () => {
      const [{ data: cust, error: e1 }, { data: grp, error: e2 }] = await Promise.all([
        supabase.from("portal_user_customers").select("customer_id").eq("portal_user_id", portalUser.id),
        supabase.from("access_group_portal").select("group_id").eq("portal_user_id", portalUser.id),
      ]);
      if (e1) throw new Error(e1.message);
      if (e2) throw new Error(e2.message);
      return {
        customerIds: (cust || []).map(r => r.customer_id),
        groupIds: (grp || []).map(r => r.group_id),
      };
    },
  });

  useEffect(() => {
    if (!current) return;
    const set = new Set(current.customerIds);
    if (portalUser?.customer_id) set.add(portalUser.customer_id);
    setChecked(set);
    setGroupIds(new Set(current.groupIds));
    setPrimary(portalUser?.customer_id || "");
  }, [current, portalUser?.customer_id]);

  const custById = useMemo(() => {
    const m = new Map();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  // Über Gruppen mitgelieferte Kunden — nur zur Anzeige, nicht abwählbar.
  const viaGroups = useMemo(() => {
    const m = new Map();
    for (const g of groups) {
      if (!groupIds.has(g.id) || !g.aktiv) continue;
      for (const row of g.access_group_customers || []) {
        if (!m.has(row.customer_id)) m.set(row.customer_id, []);
        m.get(row.customer_id).push(g.name);
      }
    }
    return m;
  }, [groups, groupIds]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.filter(c => c.company_name);
    const scored = q
      ? list.filter(c => c.company_name.toLowerCase().includes(q))
      : list.filter(c => checked.has(c.id) || viaGroups.has(c.id));
    return scored.slice(0, 200);
  }, [customers, search, checked, viaGroups]);

  const effectiveCount = useMemo(() => {
    const all = new Set(checked);
    for (const id of viaGroups.keys()) all.add(id);
    return all.size;
  }, [checked, viaGroups]);

  function toggle(id) {
    if (id === primary) {
      toast.info("Der Hauptmandant bleibt immer freigegeben. Setze zuerst einen anderen als Hauptmandant (Stern).");
      return;
    }
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleGroup(id) {
    setGroupIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function makePrimary(id) {
    setPrimary(id);
    setChecked(prev => new Set(prev).add(id));
  }

  async function save() {
    if (!primary) { toast.error("Bitte einen Hauptmandanten festlegen."); return; }
    setSaving(true);
    try {
      // Hauptmandant zuerst — die Häkchenliste muss ihn danach enthalten.
      if (primary !== portalUser.customer_id) {
        const { error } = await supabase.from("portal_users")
          .update({ customer_id: primary }).eq("id", portalUser.id);
        if (error) throw new Error(error.message);
      }

      const wantC = new Set(checked); wantC.add(primary);
      const haveC = new Set(current?.customerIds || []);
      const addC = [...wantC].filter(id => !haveC.has(id));
      const delC = [...haveC].filter(id => !wantC.has(id));

      if (delC.length) {
        const { error } = await supabase.from("portal_user_customers")
          .delete().eq("portal_user_id", portalUser.id).in("customer_id", delC);
        if (error) throw new Error(error.message);
      }
      if (addC.length) {
        const { error } = await supabase.from("portal_user_customers")
          .insert(addC.map(customer_id => ({ portal_user_id: portalUser.id, customer_id })));
        if (error) throw new Error(error.message);
      }

      const haveG = new Set(current?.groupIds || []);
      const addG = [...groupIds].filter(id => !haveG.has(id));
      const delG = [...haveG].filter(id => !groupIds.has(id));
      if (delG.length) {
        const { error } = await supabase.from("access_group_portal")
          .delete().eq("portal_user_id", portalUser.id).in("group_id", delG);
        if (error) throw new Error(error.message);
      }
      if (addG.length) {
        const { error } = await supabase.from("access_group_portal")
          .insert(addG.map(group_id => ({ portal_user_id: portalUser.id, group_id })));
        if (error) throw new Error(error.message);
      }

      toast.success("Zugriff gespeichert.");
      qc.invalidateQueries({ queryKey: ["portal_users"] });
      qc.invalidateQueries({ queryKey: ["portal_access", portalUser.id] });
      qc.invalidateQueries({ queryKey: ["portal_access_counts"] });
      onClose?.();
    } catch (e) {
      toast.error(e.message || "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  const kundengruppen = groups.filter(g => !g.staff_role);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.42)", zIndex: 60,
      display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 560, maxWidth: "100%", height: "100%",
        background: s.surface, borderLeft: `1px solid ${s.line}`, display: "flex", flexDirection: "column" }}>

        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: s.ink }}>Zugriff festlegen</h2>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: s.muted }}>
              {portalUser.vorname} {portalUser.nachname} · {portalUser.email}
            </p>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", border: 0, background: "transparent", color: s.muted, cursor: "pointer" }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: s.faint }}>
              <Loader2 size={20} className="animate-spin" style={{ display: "inline" }} /> Lädt…
            </div>
          ) : (
            <>
              {kundengruppen.length > 0 && (
                <section style={{ marginBottom: 22 }}>
                  <SectionTitle s={s} icon={Users} title="Gruppen"
                    hint="Ein Bündel von Mandanten, das für mehrere Zugänge wiederverwendet wird." />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {kundengruppen.map(g => {
                      const on = groupIds.has(g.id);
                      return (
                        <button key={g.id} onClick={() => toggleGroup(g.id)}
                          title={g.beschreibung || undefined}
                          style={{ border: `1px solid ${on ? s.accent : s.line}`, borderRadius: 20, padding: "6px 13px",
                            fontSize: 13, fontWeight: 600, cursor: "pointer",
                            background: on ? s.accentSoft : s.surface2, color: on ? s.accentInk : s.muted,
                            opacity: g.aktiv ? 1 : .5 }}>
                          {on && <Check size={13} style={{ display: "inline", marginRight: 5, marginTop: -2 }} />}
                          {g.name}
                          <span style={{ marginLeft: 6, fontWeight: 400, opacity: .75 }}>
                            {(g.access_group_customers || []).length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <SectionTitle s={s} icon={Building2} title="Einzelne Mandanten"
                hint="Zusätzlich zu den Gruppen. Der Stern markiert den Hauptmandanten (Vorauswahl für Upload und Nachrichten)." />

              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: s.faint }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Mandant suchen…"
                  style={{ width: "100%", border: `1px solid ${s.line}`, background: s.surface2, color: s.ink,
                    borderRadius: 9, padding: "9px 12px 9px 32px", fontSize: 14, outline: "none" }} />
              </div>

              {visible.length === 0 ? (
                <div style={{ padding: "22px 12px", color: s.faint, fontSize: 13.5, textAlign: "center" }}>
                  {search.trim() ? "Kein Mandant gefunden." : "Noch nichts freigegeben — oben suchen und anhaken."}
                </div>
              ) : (
                <div style={{ border: `1px solid ${s.line}`, borderRadius: 11, overflow: "hidden" }}>
                  {visible.map((c, i) => {
                    const on = checked.has(c.id);
                    const fromGroups = viaGroups.get(c.id);
                    const isPrimary = c.id === primary;
                    return (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px",
                        borderTop: i ? `1px solid ${s.line}` : "none",
                        background: on || fromGroups ? s.surface2 : "transparent" }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(c.id)}
                          style={{ width: 16, height: 16, accentColor: s.accent, cursor: "pointer" }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, color: s.ink, fontWeight: on ? 600 : 400 }}>
                            {c.company_name}
                          </div>
                          {fromGroups && (
                            <div style={{ fontSize: 11.5, color: s.faint, marginTop: 1 }}>
                              über Gruppe: {fromGroups.join(", ")}
                            </div>
                          )}
                        </div>
                        <button onClick={() => makePrimary(c.id)} title={isPrimary ? "Hauptmandant" : "Als Hauptmandant setzen"}
                          style={{ border: 0, background: "transparent", cursor: "pointer",
                            color: isPrimary ? s.accent : s.faint, opacity: isPrimary ? 1 : .45 }}>
                          <Star size={16} fill={isPrimary ? "currentColor" : "none"} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: s.muted }}>
            <strong style={{ color: s.ink }}>{effectiveCount}</strong> Mandant{effectiveCount === 1 ? "" : "en"} sichtbar
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

function SectionTitle({ s, icon: Icon, title, hint }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={15} style={{ color: s.accent }} />
        <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: 0, color: s.ink }}>{title}</h3>
      </div>
      {hint && (
        <p style={{ margin: "4px 0 0 23px", fontSize: 12, color: s.faint, lineHeight: 1.5,
          display: "flex", gap: 6 }}>
          <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />{hint}
        </p>
      )}
    </div>
  );
}
