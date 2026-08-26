/**
 * Verwaltung — Benutzer, Mandanten, Personen, Deklarationen.
 *
 * Alles lokal. «Benutzer» ist hier kein Login mit Passwort, sondern die
 * Angabe, wer gerade arbeitet: Sie landet im Protokoll und bei jeder
 * bestätigten Position. Wer die Datei hat, hat die Daten — der Schutz
 * liegt beim Laufwerk, nicht in der Anwendung. Das steht auch so da.
 */
import React, { useCallback, useEffect, useState } from "react";
import { UserRound, Building2, UserPlus, FilePlus2, ArrowRight, ShieldCheck, ShieldAlert, HardDrive } from "lucide-react";
import * as db from "@/lib/db";

const KANTONE = ["SG", "ZH", "TG"];
const ZIVILSTAND = ["ledig", "verheiratet", "eingetragen", "getrennt", "geschieden", "verwitwet"];

function Feld({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

export default function Verwaltung({ benutzer, mandant, onBenutzer, onMandant, onOeffnen }) {
  const [benutzerListe, setBenutzerListe] = useState([]);
  const [mandanten, setMandanten] = useState([]);
  const [personen, setPersonen] = useState([]);
  const [deklarationen, setDeklarationen] = useState([]);
  const [ort, setOrt] = useState("");
  const [fehler, setFehler] = useState(null);

  const [neuBenutzer, setNeuBenutzer] = useState("");
  const [neuMandant, setNeuMandant] = useState("");
  const [person, setPerson] = useState({ name: "", vorname: "", kanton: "SG", gemeinde: "", zivilstand: "ledig" });
  const [dekl, setDekl] = useState({ personId: "", periode: new Date().getFullYear() - 1 });

  const laden = useCallback(async () => {
    setBenutzerListe(await db.benutzerListe());
    setMandanten(await db.mandantenListe());
    setOrt(await db.speicherOrt());
    if (mandant) {
      setPersonen(await db.personenListe(mandant.id));
      setDeklarationen(await db.deklarationenListe(mandant.id));
    } else { setPersonen([]); setDeklarationen([]); }
  }, [mandant]);

  useEffect(() => { laden(); }, [laden]);

  const versuche = async (fn) => {
    setFehler(null);
    try { await fn(); await laden(); }
    catch (e) { setFehler(e.message || String(e)); }
  };

  return (
    <div style={{ padding: "24px 28px 64px", maxWidth: 1000 }}>
      <div style={{ borderBottom: "2px solid var(--ink)", paddingBottom: 12 }}>
        <p className="eyebrow" style={{ color: "var(--spot)" }}>Steuern nP · lokal</p>
        <h1 className="serif" style={{ fontSize: 30, fontWeight: 600, margin: "4px 0 0", lineHeight: 1.1 }}>
          Verwaltung
        </h1>
      </div>

      {fehler && (
        <div className="karte mt-4" style={{ padding: "9px 12px", fontSize: 13,
          borderLeft: "3px solid var(--stop)" }}>
          {fehler}
        </div>
      )}

      {/* ── Benutzer ───────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="eyebrow flex items-center gap-1.5">
          <UserRound className="w-3.5 h-3.5" /> Wer arbeitet gerade?
        </h2>
        <div className="flex flex-wrap items-end gap-2 mt-2">
          <select className="feld" style={{ maxWidth: 260 }} value={benutzer?.id || ""}
                  onChange={e => versuche(async () => {
                    await db.benutzerWaehlen(e.target.value);
                    onBenutzer(benutzerListe.find(b => b.id === e.target.value) || null);
                  })}>
            <option value="">— wählen —</option>
            {benutzerListe.map(b => <option key={b.id} value={b.id}>{b.name} ({b.rolle})</option>)}
          </select>
          <input className="feld" style={{ maxWidth: 200 }} placeholder="Neuer Benutzer"
                 value={neuBenutzer} onChange={e => setNeuBenutzer(e.target.value)} />
          <button className="knopf knopf-rand" disabled={!neuBenutzer.trim()}
                  onClick={() => versuche(async () => {
                    const b = await db.benutzerAnlegen({ name: neuBenutzer.trim(), rolle: "bearbeiter" });
                    setNeuBenutzer(""); await db.benutzerWaehlen(b.id); onBenutzer(b);
                  })}>
            Anlegen
          </button>
        </div>
        <p className="text-[11.5px] mt-1.5" style={{ color: "var(--ink-faint)" }}>
          Kein Passwortschutz: Der Name landet im Protokoll und bei jeder bestätigten Position.
          Wer Zugriff auf das Laufwerk hat, hat Zugriff auf die Daten — der Schutz liegt beim
          Laufwerk, nicht in der Anwendung.
        </p>
      </section>

      {/* ── Mandanten ──────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="eyebrow flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5" /> Mandant
        </h2>
        <div className="flex flex-wrap items-end gap-2 mt-2">
          <select className="feld" style={{ maxWidth: 260 }} value={mandant?.id || ""}
                  onChange={e => onMandant(mandanten.find(m => m.id === e.target.value) || null)}>
            <option value="">— wählen —</option>
            {mandanten.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input className="feld" style={{ maxWidth: 220 }} placeholder="Neues Treuhandmandat"
                 value={neuMandant} onChange={e => setNeuMandant(e.target.value)} />
          <button className="knopf knopf-rand" disabled={!neuMandant.trim()}
                  onClick={() => versuche(async () => {
                    const m = await db.mandantAnlegen({ name: neuMandant.trim() });
                    setNeuMandant(""); onMandant(m);
                  })}>
            Anlegen
          </button>
        </div>
      </section>

      {mandant && (
        <>
          {/* ── Personen ───────────────────────────────────────── */}
          <section className="mt-6">
            <h2 className="eyebrow flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5" /> Steuerpflichtige Personen ({personen.length})
            </h2>
            <div className="karte mt-2" style={{ padding: 13 }}>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                <Feld label="Name">
                  <input className="feld" value={person.name}
                         onChange={e => setPerson({ ...person, name: e.target.value })} />
                </Feld>
                <Feld label="Vorname">
                  <input className="feld" value={person.vorname}
                         onChange={e => setPerson({ ...person, vorname: e.target.value })} />
                </Feld>
                <Feld label="Kanton">
                  <select className="feld" value={person.kanton}
                          onChange={e => setPerson({ ...person, kanton: e.target.value })}>
                    {KANTONE.map(k => <option key={k}>{k}</option>)}
                  </select>
                </Feld>
                <Feld label="Gemeinde">
                  <input className="feld" value={person.gemeinde}
                         onChange={e => setPerson({ ...person, gemeinde: e.target.value })} />
                </Feld>
                <Feld label="Zivilstand">
                  <select className="feld" value={person.zivilstand}
                          onChange={e => setPerson({ ...person, zivilstand: e.target.value })}>
                    {ZIVILSTAND.map(z => <option key={z}>{z}</option>)}
                  </select>
                </Feld>
              </div>
              <button className="knopf knopf-rand mt-3" disabled={!person.name.trim()}
                      onClick={() => versuche(async () => {
                        await db.personAnlegen({ ...person, mandant_id: mandant.id });
                        setPerson({ name: "", vorname: "", kanton: "SG", gemeinde: "", zivilstand: "ledig" });
                      })}>
                Person anlegen
              </button>
            </div>
          </section>

          {/* ── Deklarationen ──────────────────────────────────── */}
          <section className="mt-6">
            <h2 className="eyebrow flex items-center gap-1.5">
              <FilePlus2 className="w-3.5 h-3.5" /> Steuererklärungen ({deklarationen.length})
            </h2>

            <div className="flex flex-wrap items-end gap-2 mt-2">
              <select className="feld" style={{ maxWidth: 260 }} value={dekl.personId}
                      onChange={e => setDekl({ ...dekl, personId: e.target.value })}>
                <option value="">— Person wählen —</option>
                {personen.map(p => (
                  <option key={p.id} value={p.id}>
                    {`${p.vorname || ""} ${p.name}`.trim()} ({p.kanton})
                  </option>
                ))}
              </select>
              <input type="number" className="feld zahl" style={{ width: 110 }} value={dekl.periode}
                     onChange={e => setDekl({ ...dekl, periode: e.target.value })} />
              <button className="knopf knopf-rand" disabled={!dekl.personId}
                      onClick={() => versuche(() => db.deklarationAnlegen({
                        mandantId: mandant.id, personId: dekl.personId, periode: dekl.periode,
                      }))}>
                Eröffnen
              </button>
            </div>

            <div className="karte mt-3">
              {deklarationen.length === 0 && (
                <p className="text-[13px]" style={{ padding: 13, color: "var(--ink-faint)" }}>
                  Noch keine Steuererklärung eröffnet.
                </p>
              )}
              {deklarationen.map((d, i) => {
                const p = personen.find(x => x.id === d.person_id);
                return (
                  <div key={d.id} className="flex items-center justify-between gap-3"
                       style={{ padding: "10px 13px",
                                borderTop: i ? "1px solid var(--rule-soft)" : "none" }}>
                    <div className="min-w-0">
                      <div className="truncate">
                        {p ? `${p.vorname || ""} ${p.name}`.trim() : "?"} · {d.periode} · {d.kanton}
                      </div>
                      <div className="text-[12px] flex items-center gap-2 mt-0.5"
                           style={{ color: "var(--ink-weak)" }}>
                        Status {d.status}
                        {d.vollmacht === "erteilt"
                          ? <span className="marke marke-relevant"><ShieldCheck className="w-3 h-3" /> Vollmacht</span>
                          : <span className="marke marke-unklar"><ShieldAlert className="w-3 h-3" /> Vollmacht {d.vollmacht}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button className="knopf knopf-still knopf-klein"
                              onClick={() => versuche(() => db.deklarationAendern(d.id, {
                                vollmacht: d.vollmacht === "erteilt" ? "offen" : "erteilt",
                              }))}>
                        {d.vollmacht === "erteilt" ? "Vollmacht zurücksetzen" : "Vollmacht erteilt"}
                      </button>
                      <button className="knopf knopf-primaer knopf-klein"
                              onClick={() => onOeffnen(d, p)}>
                        Öffnen <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      <p className="text-[12px] mt-8 flex items-center gap-1.5" style={{ color: "var(--ink-faint)" }}>
        <HardDrive className="w-3.5 h-3.5" /> Datenbestand: {ort}
      </p>
    </div>
  );
}
