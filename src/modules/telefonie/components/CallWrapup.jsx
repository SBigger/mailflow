import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X, ArrowRight, StickyNote, PhoneOutgoing, PhoneIncoming, AlertCircle } from "lucide-react";
import { entities } from "@/api/supabaseClient";
import {
  currentEmployee, leProject, leServiceType, leRateGroupRate,
  leServiceRateHistory, leTimeEntry, resolveRateFor,
} from "@/lib/leApi";
import { tele, formatPhone, useAppTheme } from "../theme";
import { matchCustomer } from "../useDossier";

const today = () => new Date().toISOString().slice(0, 10);
const roundHours = (sec) => Math.max(0.25, Math.round((sec / 3600) / 0.25) * 0.25);
const fmtDur = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };

// Panel zur Nachbearbeitung eines beendeten Anrufs → optional als Leistung buchen.
// Buttet einen echten le_time_entry (RLS: nur eigener Mitarbeiter). Degradiert
// sauber, wenn die Leistungserfassung (Mitarbeiter/Projekt/Leistungsart) fehlt.
export default function CallWrapup({ wrapup, onClose }) {
  const theme = useAppTheme();
  const t = tele(theme);

  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => entities.Customer.list("company_name"), staleTime: 5 * 60_000 });
  const { data: employee } = useQuery({ queryKey: ["le-current-employee"], queryFn: currentEmployee, staleTime: 5 * 60_000, retry: false });
  const { data: projects = [] } = useQuery({ queryKey: ["le-projects-offen"], queryFn: () => leProject.list({ status: "offen" }), staleTime: 2 * 60_000, retry: false });
  const { data: serviceTypes = [] } = useQuery({ queryKey: ["le-service-types"], queryFn: leServiceType.list, staleTime: 5 * 60_000, retry: false });
  const { data: rateGroupRates = [] } = useQuery({ queryKey: ["le-rgr"], queryFn: leRateGroupRate.listAll, staleTime: 5 * 60_000, retry: false });
  const { data: serviceRateHistory = [] } = useQuery({ queryKey: ["le-srh"], queryFn: leServiceRateHistory.listAll, staleTime: 5 * 60_000, retry: false });

  const match = useMemo(() => matchCustomer(wrapup.peerNumber, customers), [wrapup.peerNumber, customers]);
  const customer = wrapup.customer?.id ? wrapup.customer : match?.customer || null;
  const project = useMemo(() => projects.find((p) => p.customer_id === customer?.id) || null, [projects, customer]);

  const activeTypes = useMemo(() => serviceTypes.filter((s) => s.active !== false), [serviceTypes]);
  const defaultType = useMemo(() => activeTypes.find((s) => /telefon|beratung/i.test(s.name || "")) || activeTypes[0] || null, [activeTypes]);

  const [serviceTypeId, setServiceTypeId] = useState(null);
  useEffect(() => { if (!serviceTypeId && defaultType) setServiceTypeId(defaultType.id); }, [defaultType, serviceTypeId]);
  const [hours, setHours] = useState(() => roundHours(wrapup.durationSec || 0));
  const [desc, setDesc] = useState(() => "Telefonat" + (customer?.company_name || wrapup.peerName ? ` mit ${customer?.company_name || wrapup.peerName}` : ""));
  const selType = activeTypes.find((s) => s.id === serviceTypeId) || null;
  const [billable, setBillable] = useState(true);
  useEffect(() => { if (selType) setBillable(selType.billable !== false); }, [serviceTypeId]); // eslint-disable-line

  const [phase, setPhase] = useState("form"); // form | booking | done | error
  const [err, setErr] = useState("");

  const rate = useMemo(() => {
    if (!project || !employee || !serviceTypeId) return 0;
    try { return resolveRateFor({ project, employee, serviceTypeId, date: today(), rateGroupRates, serviceRateHistory }); }
    catch { return 0; }
  }, [project, employee, serviceTypeId, rateGroupRates, serviceRateHistory]);

  const blocker = !employee ? "Du bist (noch) nicht als Mitarbeiter in der Leistungserfassung erfasst."
    : !customer ? "Anrufer keinem Kunden zugeordnet — keine automatische Verbuchung möglich."
    : !project ? `Kein offenes Projekt für „${customer.company_name || "diesen Kunden"}".`
    : activeTypes.length === 0 ? "Keine Leistungsarten definiert."
    : null;

  const book = async () => {
    setPhase("booking"); setErr("");
    try {
      await leTimeEntry.create({
        project_id: project.id,
        employee_id: employee.id,
        service_type_id: serviceTypeId,
        entry_date: today(),
        hours_internal: hours,
        rate_snapshot: Number(rate) || 0,
        description: desc || "Telefonat",
        status: "erfasst",
      });
      setPhase("done");
    } catch (e) {
      setErr(e?.message || String(e)); setPhase("error");
    }
  };

  const name = customer?.company_name || wrapup.peerName || formatPhone(wrapup.peerNumber);
  const shell = {
    position: "fixed", right: 26, top: 24, bottom: "auto", width: 384, zIndex: 3000,
    maxHeight: "calc(100vh - 48px)", overflowY: "auto",
    background: t.raised, border: `1px solid ${t.borderStrong}`, borderRadius: 20,
    boxShadow: "0 24px 60px -18px rgba(15,40,25,.45), 0 2px 8px rgba(15,40,25,.14)",
    color: t.textPrimary,
  };

  // ── Gebucht ────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div style={shell} role="dialog" aria-label="Gebucht">
        <div style={{ padding: "26px 22px", textAlign: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: t.answer + "22", color: t.answer, display: "grid", placeItems: "center", margin: "0 auto 14px" }}><Check size={28} /></div>
          <h3 style={{ fontSize: 17, margin: "0 0 4px", fontWeight: 750 }}>Gebucht ✓</h3>
          <p style={{ fontSize: 12.5, color: t.textMuted, margin: "0 auto", maxWidth: 300, lineHeight: 1.5 }}>Leistungseintrag für {name} erstellt.</p>
          <div style={{ margin: "16px auto 0", maxWidth: 320, textAlign: "left", background: t.sunken, border: `1px solid ${t.borderSubtle}`, borderRadius: 12, overflow: "hidden", fontSize: 12 }}>
            <RRow t={t} k="Leistung" v={`${selType?.name || "—"} · ${hours.toFixed(2)} h`} />
            <RRow t={t} k="Mandant" v={project?.name || customer?.company_name || "—"} />
            <RRow t={t} k="Betrag" v={billable ? `CHF ${(Number(rate) * hours).toFixed(2)} · verrechenbar` : "nicht verrechenbar"} last />
          </div>
          <button onClick={onClose} style={{ ...primaryBtn(t), marginTop: 18, width: "auto", padding: "10px 20px" }}>Fertig</button>
        </div>
      </div>
    );
  }

  // ── Formular ───────────────────────────────────────────────────────────
  return (
    <div style={shell} role="dialog" aria-label="Anruf nachbearbeiten">
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "15px 18px 13px", borderBottom: `1px solid ${t.borderSubtle}` }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: t.accentSoft, color: t.accent, display: "grid", placeItems: "center", flexShrink: 0 }}><StickyNote size={17} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 750 }}>Anruf nachbearbeiten</div>
          <div style={{ fontSize: 11.5, color: t.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
            {wrapup.dir === "in" ? <PhoneIncoming size={12} /> : <PhoneOutgoing size={12} />}
            {name} · <span style={{ fontFamily: 'ui-monospace, monospace' }}>{fmtDur(wrapup.durationSec || 0)}</span>
          </div>
        </div>
        <button onClick={onClose} aria-label="Schliessen" style={{ border: "none", background: "transparent", cursor: "pointer", color: t.textMuted }}><X size={17} /></button>
      </div>

      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        {blocker ? (
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: t.textSecondary, background: t.sunken, border: `1px solid ${t.borderSubtle}`, borderRadius: 11, padding: "12px 13px", lineHeight: 1.5 }}>
            <AlertCircle size={16} style={{ color: t.presence.away, flexShrink: 0, marginTop: 1 }} />
            <span>{blocker} <br /><span style={{ color: t.textMuted }}>Du kannst den Anruf trotzdem protokollieren.</span></span>
          </div>
        ) : (
          <>
            <Field t={t} label="Mandant / Projekt">
              <div style={{ ...inp(t), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{project?.name || customer?.company_name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: t.in, background: t.in + "1e", padding: "2px 8px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 5 }}><Check size={11} /> erkannt</span>
              </div>
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field t={t} label="Dauer → Stunden">
                <div style={{ ...inp(t), display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", color: t.textMuted, fontSize: 12 }}>{fmtDur(wrapup.durationSec || 0)}</span>
                  <ArrowRight size={13} style={{ color: t.textMuted }} />
                  <input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(Math.max(0, Number(e.target.value) || 0))}
                    style={{ width: 54, border: "none", background: "transparent", color: t.textPrimary, font: "inherit", fontWeight: 700, fontFamily: "ui-monospace, monospace", outline: "none" }} />
                  <span style={{ fontSize: 12, color: t.textMuted }}>h</span>
                </div>
              </Field>
              <Field t={t} label="Leistungsart">
                <select value={serviceTypeId || ""} onChange={(e) => setServiceTypeId(e.target.value)} style={{ ...inp(t), cursor: "pointer" }}>
                  {activeTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>

            <Field t={t} label="Beschreibung">
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ ...inp(t), resize: "none", lineHeight: 1.5 }} />
            </Field>

            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <button onClick={() => setBillable((b) => !b)} aria-pressed={billable} aria-label="Verrechenbar"
                style={{ width: 42, height: 24, borderRadius: 999, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", background: billable ? t.accent : t.borderStrong }}>
                <span style={{ position: "absolute", top: 2, left: billable ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
              </button>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 650 }}>Verrechenbar</div>
                <div style={{ fontSize: 11, color: t.textMuted }}>{billable && rate > 0 ? `CHF ${Number(rate).toFixed(2)}/h · Betrag CHF ${(Number(rate) * hours).toFixed(2)}` : billable ? "Satz aus Projekt" : "nicht verrechenbar"}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {phase === "error" && (
        <div style={{ margin: "0 18px 12px", fontSize: 11.5, color: t.missed, background: t.missed + "14", border: `1px solid ${t.missed}44`, borderRadius: 9, padding: "9px 11px" }}>
          Buchung fehlgeschlagen: {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, padding: "14px 18px", borderTop: `1px solid ${t.borderSubtle}`, background: t.sunken }}>
        <button onClick={onClose} style={ghostBtn(t)}>Nur protokollieren</button>
        <button onClick={book} disabled={!!blocker || phase === "booking"} style={{ ...primaryBtn(t), opacity: blocker || phase === "booking" ? 0.5 : 1, cursor: blocker || phase === "booking" ? "default" : "pointer" }}>
          <Check size={15} /> {phase === "booking" ? "Buche…" : "Als Leistung buchen"}
        </button>
      </div>
    </div>
  );
}

function Field({ t, label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: t.textMuted }}>{label}</label>
      {children}
    </div>
  );
}
function RRow({ t, k, v, last }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "9px 13px", borderBottom: last ? "none" : `1px solid ${t.borderSubtle}` }}>
      <span style={{ color: t.textMuted, width: 78, flexShrink: 0 }}>{k}</span>
      <span style={{ fontWeight: 650 }}>{v}</span>
    </div>
  );
}
function inp(t) {
  return { width: "100%", border: `1px solid ${t.borderStrong}`, background: t.sunken, borderRadius: 10, padding: "10px 12px", font: "inherit", fontSize: 13, color: t.textPrimary, outline: "none" };
}
function primaryBtn(t) {
  return { flex: 1, border: "none", borderRadius: 11, cursor: "pointer", padding: 11, fontSize: 13, fontWeight: 750, color: t.accentInk || "#fff", background: t.accent, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };
}
function ghostBtn(t) {
  return { flex: 1, border: `1px solid ${t.borderStrong}`, borderRadius: 11, cursor: "pointer", padding: 11, fontSize: 13, fontWeight: 650, color: t.textSecondary, background: t.raised };
}
