/**
 * Stammdaten: Mandanten, steuerpflichtige Personen, Deklarationen.
 *
 * Ohne diese Seite lässt sich keine Deklaration eröffnen und die Triage
 * bleibt leer. Der Vollmachtsstatus wird hier gepflegt — er entscheidet,
 * ob eine Einreichung überhaupt zulässig ist (Trigger in der Datenbank).
 */
import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Building2, UserPlus, FilePlus2, ShieldCheck, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const KANTONE = ["ZH", "SG", "TG"];
const ZIVILSTAND = ["ledig", "verheiratet", "eingetragen", "getrennt", "geschieden", "verwitwet"];

function Feld({ label, children }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputKlasse = "w-full border border-slate-300 rounded-md px-2 h-8 text-sm";

export default function Stammdaten() {
  const qc = useQueryClient();
  const { mandant, mandantId, mandanten, setMandantId, ladeMandanten } = useAuth();

  const [neuerMandant, setNeuerMandant] = useState("");
  const [person, setPerson] = useState({ name: "", vorname: "", kanton: "ZH", gemeinde: "", zivilstand: "ledig" });
  const [dekl, setDekl] = useState({ person_id: "", periode: new Date().getFullYear() - 1 });

  // ─── Daten ──────────────────────────────────────────────────────
  const { data: personen = [] } = useQuery({
    queryKey: ["np_personen", mandantId],
    enabled: !!mandantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("np_personen").select("*").eq("mandant_id", mandantId).order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: deklarationen = [] } = useQuery({
    queryKey: ["deklarationen", mandantId],
    enabled: !!mandantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deklarationen")
        .select("*, np_personen(name, vorname)")
        .eq("mandant_id", mandantId)
        .order("periode", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // ─── Mutationen ─────────────────────────────────────────────────
  const mandantAnlegen = useMutation({
    mutationFn: async (name) => {
      // RPC, weil ein neuer Nutzer sonst weder Mandant noch Zugriffszeile
      // anlegen könnte — mandanten hat bewusst nur eine SELECT-Policy.
      const { data, error } = await supabase.rpc("mandant_anlegen", { p_name: name });
      if (error) throw error;
      return data;
    },
    onSuccess: async (id) => {
      setNeuerMandant("");
      await ladeMandanten();
      setMandantId(id);
      toast.success("Mandant angelegt");
    },
    onError: (e) => toast.error(`Anlegen fehlgeschlagen: ${e.message}`),
  });

  const personAnlegen = useMutation({
    mutationFn: async (p) => {
      const { error } = await supabase.from("np_personen").insert({ ...p, mandant_id: mandantId });
      if (error) throw error;
    },
    onSuccess: () => {
      setPerson({ name: "", vorname: "", kanton: "ZH", gemeinde: "", zivilstand: "ledig" });
      qc.invalidateQueries({ queryKey: ["np_personen", mandantId] });
      toast.success("Person angelegt");
    },
    onError: (e) => toast.error(`Anlegen fehlgeschlagen: ${e.message}`),
  });

  const deklarationAnlegen = useMutation({
    mutationFn: async ({ person_id, periode }) => {
      const p = personen.find(x => x.id === person_id);
      if (!p) throw new Error("Person nicht gefunden");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("deklarationen").insert({
        mandant_id: mandantId,
        person_id,
        periode: Number(periode),
        kanton: p.kanton,           // Kanton folgt der Person, nicht der Eingabe
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deklarationen", mandantId] });
      toast.success("Deklaration eröffnet");
    },
    onError: (e) => toast.error(
      /duplicate|unique/i.test(e.message)
        ? "Für diese Person und Periode existiert bereits eine Deklaration"
        : `Anlegen fehlgeschlagen: ${e.message}`
    ),
  });

  const vollmachtSetzen = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase
        .from("deklarationen").update({ vollmacht_status: status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deklarationen", mandantId] });
      toast.success("Vollmachtsstatus geändert");
    },
    onError: (e) => toast.error(`Änderung fehlgeschlagen: ${e.message}`),
  });

  // ─── Kein Mandant ───────────────────────────────────────────────
  if (!mandanten.length) {
    return (
      <div className="p-6 max-w-md">
        <h1 className="text-lg font-semibold mb-1">Erster Mandant</h1>
        <p className="text-sm text-slate-600 mb-3">
          Noch kein Mandat vorhanden. Lege eines an, um Personen und Deklarationen zu erfassen.
        </p>
        <div className="flex gap-2">
          <input className={inputKlasse} placeholder="Name des Treuhandmandats"
                 value={neuerMandant} onChange={e => setNeuerMandant(e.target.value)} />
          <Button disabled={!neuerMandant.trim() || mandantAnlegen.isPending}
                  onClick={() => mandantAnlegen.mutate(neuerMandant.trim())}>
            Anlegen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold">Stammdaten</h1>

      {/* Mandant */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Building2 className="w-4 h-4 text-slate-400" /> Mandant
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <select className={`${inputKlasse} max-w-xs`} value={mandantId || ""}
                  onChange={e => setMandantId(e.target.value)}>
            {mandanten.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input className={inputKlasse} placeholder="Neuer Mandant"
                   value={neuerMandant} onChange={e => setNeuerMandant(e.target.value)} />
            <Button variant="outline" size="sm"
                    disabled={!neuerMandant.trim() || mandantAnlegen.isPending}
                    onClick={() => mandantAnlegen.mutate(neuerMandant.trim())}>
              Anlegen
            </Button>
          </div>
        </div>
        {mandant && !mandant.th_id_zh && (
          <p className="text-[11px] text-amber-700">
            Keine TH-ID hinterlegt. Ohne Eintrag im Treuhänder-Register ist keine
            elektronische Einreichung in Zürich möglich.
          </p>
        )}
      </section>

      {/* Personen */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <UserPlus className="w-4 h-4 text-slate-400" /> Steuerpflichtige Personen ({personen.length})
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 bg-white border border-slate-200 rounded-lg p-3">
          <Feld label="Name">
            <input className={inputKlasse} value={person.name}
                   onChange={e => setPerson({ ...person, name: e.target.value })} />
          </Feld>
          <Feld label="Vorname">
            <input className={inputKlasse} value={person.vorname}
                   onChange={e => setPerson({ ...person, vorname: e.target.value })} />
          </Feld>
          <Feld label="Kanton">
            <select className={inputKlasse} value={person.kanton}
                    onChange={e => setPerson({ ...person, kanton: e.target.value })}>
              {KANTONE.map(k => <option key={k}>{k}</option>)}
            </select>
          </Feld>
          <Feld label="Gemeinde">
            <input className={inputKlasse} value={person.gemeinde}
                   onChange={e => setPerson({ ...person, gemeinde: e.target.value })} />
          </Feld>
          <Feld label="Zivilstand">
            <select className={inputKlasse} value={person.zivilstand}
                    onChange={e => setPerson({ ...person, zivilstand: e.target.value })}>
              {ZIVILSTAND.map(z => <option key={z}>{z}</option>)}
            </select>
          </Feld>
          <div className="col-span-2 md:col-span-5">
            <Button size="sm" disabled={!person.name.trim() || personAnlegen.isPending}
                    onClick={() => personAnlegen.mutate(person)}>
              Person anlegen
            </Button>
          </div>
        </div>

        {personen.length > 0 && (
          <ul className="text-sm divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg">
            {personen.map(p => (
              <li key={p.id} className="px-3 py-1.5 flex justify-between">
                <span>{`${p.vorname || ""} ${p.name}`.trim()}</span>
                <span className="text-slate-500 text-[12px]">
                  {p.kanton}{p.gemeinde ? ` · ${p.gemeinde}` : ""} · {p.zivilstand}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Deklarationen */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <FilePlus2 className="w-4 h-4 text-slate-400" /> Deklarationen ({deklarationen.length})
        </h2>

        <div className="flex flex-wrap items-end gap-2 bg-white border border-slate-200 rounded-lg p-3">
          <Feld label="Person">
            <select className={`${inputKlasse} min-w-56`} value={dekl.person_id}
                    onChange={e => setDekl({ ...dekl, person_id: e.target.value })}>
              <option value="">— wählen —</option>
              {personen.map(p => (
                <option key={p.id} value={p.id}>
                  {`${p.vorname || ""} ${p.name}`.trim()} ({p.kanton})
                </option>
              ))}
            </select>
          </Feld>
          <Feld label="Steuerperiode">
            <input type="number" className={`${inputKlasse} w-28`} value={dekl.periode}
                   onChange={e => setDekl({ ...dekl, periode: e.target.value })} />
          </Feld>
          <Button size="sm" disabled={!dekl.person_id || deklarationAnlegen.isPending}
                  onClick={() => deklarationAnlegen.mutate(dekl)}>
            Eröffnen
          </Button>
        </div>

        {deklarationen.length > 0 && (
          <ul className="text-sm divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg">
            {deklarationen.map(d => (
              <li key={d.id} className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate">
                    {`${d.np_personen?.vorname || ""} ${d.np_personen?.name || "?"}`.trim()}
                    {" · "}{d.periode}{" · "}{d.kanton}
                  </div>
                  <div className="text-[11px] text-slate-500">Status: {d.status}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {d.vollmacht_status === "erteilt" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                      <ShieldCheck className="w-3.5 h-3.5" /> Vollmacht erteilt
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                      <ShieldAlert className="w-3.5 h-3.5" /> Vollmacht {d.vollmacht_status}
                    </span>
                  )}
                  <Button size="sm" variant="outline"
                          onClick={() => vollmachtSetzen.mutate({
                            id: d.id,
                            status: d.vollmacht_status === "erteilt" ? "offen" : "erteilt",
                          })}>
                    {d.vollmacht_status === "erteilt" ? "zurücksetzen" : "als erteilt markieren"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-slate-500">
          Die Vollmacht ist ein Vorgang ausserhalb der Software: In Zürich entweder eine
          unterzeichnete Generalvollmacht beim Steueramt oder die Weitergabe des
          Zugangscode-Briefs. Hier wird nur festgehalten, dass sie vorliegt — ohne diesen
          Eintrag verweigert die Datenbank die Einreichung.
        </p>
      </section>
    </div>
  );
}
