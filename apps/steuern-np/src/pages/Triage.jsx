/**
 * Steuern nP — Belegtriage und Review
 *
 * Die Vier-Augen-Ansicht aus §6.1 der Konzeptdokumentation: links der Beleg,
 * rechts was daraus gelesen wurde, mit Herkunft und Confidence pro Wert.
 *
 * Zwei Prinzipien, die die UI durchhält:
 *   1. Aussortierte Belege sind sichtbar und einklappbar, nie versteckt.
 *      Ein faelschlich aussortierter Beleg kostet den Mandanten bares Geld.
 *   2. Jeder Wert zeigt, woher er stammt. Ein Wert aus einem eSteuerauszug
 *      ist etwas anderes als ein Wert, den ein LLM aus einem Scan geraten hat.
 *
 * Konzept: docs/recherche-und-architektur.md
 */
import React, { useState, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText, CheckCircle2, AlertTriangle, EyeOff, Eye, ShieldCheck,
  Sparkles, FileCode2, ScanLine, Hand, RefreshCw, Landmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BELEGART_BY_KEY } from "@/lib/belegarten";
import { SCHWELLE_REVIEW } from "@/lib/triage";

// ──────────────────────────────────────────────────────────────
// Darstellung der Herkunft — der wichtigste Unterschied im UI
// ──────────────────────────────────────────────────────────────
const HERKUNFT = {
  ech0196: { label: "eSteuerauszug", icon: FileCode2,  klasse: "text-emerald-600", titel: "Strukturiert von der Bank geliefert — belegt, nicht geraten" },
  ech0270: { label: "Barcode",       icon: FileCode2,  klasse: "text-emerald-600", titel: "Aus dem 2D-Barcode des Belegs gelesen" },
  ech0275: { label: "Krankenkasse",  icon: FileCode2,  klasse: "text-emerald-600", titel: "Strukturierte Steuerbescheinigung" },
  ki:      { label: "KI",            icon: Sparkles,   klasse: "text-amber-600",   titel: "Von der KI aus dem Belegtext gelesen — bitte prüfen" },
  manuell: { label: "manuell",       icon: Hand,       klasse: "text-slate-600",   titel: "Von Hand erfasst" },
  vorjahr: { label: "Vorjahr",       icon: RefreshCw,  klasse: "text-slate-600",   titel: "Aus dem Vorjahr übernommen" },
};

const PARSE_LABEL = {
  ech0196: "eCH-0196", ech0270: "Barcode", ech0275: "eCH-0275",
  pdf_text: "PDF-Text", ocr: "OCR", manuell: "manuell",
};

function ConfidenceBadge({ wert }) {
  if (wert == null) return null;
  const prozent = Math.round(wert * 100);
  const stil = wert >= SCHWELLE_REVIEW
    ? "bg-emerald-100 text-emerald-700"
    : wert >= 0.5
      ? "bg-amber-100 text-amber-700"
      : "bg-rose-100 text-rose-700";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${stil}`}
          title="Sicherheit der Erkennung">
      {prozent}%
    </span>
  );
}

function HerkunftBadge({ herkunft }) {
  const h = HERKUNFT[herkunft] || HERKUNFT.manuell;
  const Icon = h.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${h.klasse}`} title={h.titel}>
      <Icon className="w-3 h-3" />
      {h.label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────
// Positionsliste eines Belegs
// ──────────────────────────────────────────────────────────────
function PositionenListe({ positionen, onBestaetigen }) {
  if (!positionen?.length) {
    return <p className="text-sm text-slate-500 italic">Keine Positionen erkannt.</p>;
  }
  return (
    <ul className="space-y-2">
      {positionen.map((p) => {
        const offen = p.wert_num != null && !p.bestaetigt_von
                   && (p.confidence ?? 0) < SCHWELLE_REVIEW;
        return (
          <li key={p.id}
              className={`rounded-md border p-2 ${offen ? "border-amber-300 bg-amber-50/50" : "border-slate-200"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{p.bezeichnung || p.ech_pfad}</div>
                <div className="text-[11px] text-slate-500 font-mono truncate" title="Zielfeld im eCH-0119-XML">
                  {p.ech_pfad}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold tabular-nums">
                  {p.wert_num != null
                    ? `${p.waehrung || "CHF"} ${Number(p.wert_num).toLocaleString("de-CH", { minimumFractionDigits: 2 })}`
                    : (p.wert_text || "—")}
                </div>
                <div className="flex items-center gap-2 justify-end mt-0.5">
                  <HerkunftBadge herkunft={p.herkunft} />
                  <ConfidenceBadge wert={p.confidence} />
                </div>
              </div>
            </div>

            {p.bestaetigt_von ? (
              <div className="mt-1.5 text-[11px] text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> bestätigt
              </div>
            ) : offen ? (
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[11px] text-amber-700">
                  Unter Schwellwert — Bestätigung nötig vor Einreichung
                </span>
                <Button size="sm" variant="outline" className="h-6 text-[11px]"
                        onClick={() => onBestaetigen(p)}>
                  Bestätigen
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ──────────────────────────────────────────────────────────────
// Beleg-Karte
// ──────────────────────────────────────────────────────────────
function BelegKarte({ beleg, positionen, onBestaetigen, onRelevanzAendern }) {
  const art = BELEGART_BY_KEY[beleg.belegart];
  const nichtRelevant = beleg.relevanz === "nicht_relevant";

  return (
    <div className={`rounded-lg border p-3 ${nichtRelevant ? "bg-slate-50 border-slate-200" : "bg-white border-slate-300"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <FileText className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{beleg.dateiname || "Beleg"}</div>
            <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
              <span>{art?.label || "unbekannte Belegart"}</span>
              {beleg.parse_methode && (
                <span className="inline-flex items-center gap-1">
                  <ScanLine className="w-3 h-3" />
                  {PARSE_LABEL[beleg.parse_methode] || beleg.parse_methode}
                </span>
              )}
              {beleg.periode_beleg && <span>Periode {beleg.periode_beleg}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ConfidenceBadge wert={beleg.confidence} />
          <Button size="sm" variant="ghost" className="h-6 text-[11px]"
                  onClick={() => onRelevanzAendern(beleg, nichtRelevant ? "relevant" : "nicht_relevant")}
                  title={nichtRelevant ? "Doch berücksichtigen" : "Nicht berücksichtigen"}>
            {nichtRelevant ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {beleg.relevanz_grund && (
        <div className="mt-1.5 text-[11px] text-slate-600">
          Grund: <span className="font-medium">{beleg.relevanz_grund}</span>
        </div>
      )}

      {!nichtRelevant && (
        <div className="mt-2.5">
          <PositionenListe positionen={positionen} onBestaetigen={onBestaetigen} />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Seite
// ──────────────────────────────────────────────────────────────
export default function SteuernNP() {
  const qc = useQueryClient();
  const [deklarationId, setDeklarationId] = useState(null);
  const [zeigeAussortierte, setZeigeAussortierte] = useState(false);

  const { data: deklarationen = [], isLoading: ladeDek } = useQuery({
    queryKey: ["deklarationen"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deklarationen")
        .select("*, np_personen(name, vorname, kanton)")
        .order("periode", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const aktuelle = useMemo(
    () => deklarationen.find(d => d.id === deklarationId) || deklarationen[0] || null,
    [deklarationen, deklarationId]
  );

  const { data: belege = [] } = useQuery({
    queryKey: ["belege", aktuelle?.id],
    enabled: !!aktuelle?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("belege")
        .select("*")
        .eq("deklaration_id", aktuelle.id)
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: positionen = [] } = useQuery({
    queryKey: ["positionen", aktuelle?.id],
    enabled: !!aktuelle?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positionen")
        .select("*")
        .eq("deklaration_id", aktuelle.id);
      if (error) throw error;
      return data || [];
    },
  });

  const positionenProBeleg = useMemo(() => {
    const map = {};
    for (const p of positionen) (map[p.beleg_id] ||= []).push(p);
    return map;
  }, [positionen]);

  const relevante    = belege.filter(b => b.relevanz === "relevant");
  const unklare      = belege.filter(b => b.relevanz === "unklar");
  const aussortierte = belege.filter(b => b.relevanz === "nicht_relevant");

  const offenePositionen = positionen.filter(
    p => p.wert_num != null && !p.bestaetigt_von && (p.confidence ?? 0) < SCHWELLE_REVIEW
  );
  const einreichbereit = aktuelle
    && offenePositionen.length === 0
    && unklare.length === 0
    && aktuelle.vollmacht_status === "erteilt";

  const bestaetigen = useMutation({
    mutationFn: async (position) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("positionen")
        .update({ bestaetigt_von: user?.id, bestaetigt_am: new Date().toISOString() })
        .eq("id", position.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positionen", aktuelle?.id] });
      toast.success("Position bestätigt");
    },
    onError: (e) => toast.error(`Bestätigen fehlgeschlagen: ${e.message}`),
  });

  const relevanzAendern = useMutation({
    mutationFn: async ({ beleg, relevanz }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("belege")
        .update({
          relevanz,
          relevanz_grund: relevanz === "relevant" ? null : "manuell_aussortiert",
          bestaetigt_von: user?.id,
          bestaetigt_am: new Date().toISOString(),
        })
        .eq("id", beleg.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["belege", aktuelle?.id] });
      toast.success("Relevanz geändert");
    },
    onError: (e) => toast.error(`Änderung fehlgeschlagen: ${e.message}`),
  });

  if (ladeDek) {
    return <div className="p-6 text-sm text-slate-500">Deklarationen werden geladen…</div>;
  }

  if (!aktuelle) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Landmark className="w-5 h-5 text-slate-400" />
          <h1 className="text-lg font-semibold">Steuern natürliche Personen</h1>
        </div>
        <p className="text-sm text-slate-600 max-w-xl">
          Noch keine Steuererklärung angelegt. Das Modul befindet sich im Aufbau —
          Beleg-Ingest und Triage stehen, der eCH-0119-Export wartet auf die
          Schema-Verifikation (siehe{" "}
          <code className="text-[11px]">docs/recherche-und-architektur.md</code>).
        </p>
      </div>
    );
  }

  const person = aktuelle.np_personen;

  return (
    <div className="p-6 space-y-4">
      {/* Kopf */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-slate-400" />
            <h1 className="text-lg font-semibold">Steuern natürliche Personen</h1>
          </div>
          <p className="text-sm text-slate-600 mt-0.5">
            {person ? `${person.vorname || ""} ${person.name}`.trim() : "—"}
            {" · "}Periode {aktuelle.periode}
            {" · "}Kanton {aktuelle.kanton}
            {" · "}Status {aktuelle.status}
          </p>
        </div>

        {deklarationen.length > 1 && (
          <select
            className="text-sm border rounded-md px-2 py-1"
            value={aktuelle.id}
            onChange={(e) => setDeklarationId(e.target.value)}
          >
            {deklarationen.map(d => (
              <option key={d.id} value={d.id}>
                {d.np_personen?.name || "?"} · {d.periode} · {d.kanton}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Einreichbereitschaft — bewusst prominent und ehrlich */}
      <div className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${
        einreichbereit ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
        {einreichbereit
          ? <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          : <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />}
        <div>
          <div className="font-medium">
            {einreichbereit ? "Bereit zur Freigabe" : "Noch nicht einreichbereit"}
          </div>
          <ul className="mt-1 space-y-0.5 text-[13px] text-slate-700">
            {offenePositionen.length > 0 && (
              <li>{offenePositionen.length} Position(en) unter Schwellwert nicht bestätigt</li>
            )}
            {unklare.length > 0 && <li>{unklare.length} Beleg(e) als «unklar» offen</li>}
            {aktuelle.vollmacht_status !== "erteilt" && (
              <li>Vollmacht nicht erteilt (Status: {aktuelle.vollmacht_status})</li>
            )}
            {einreichbereit && (
              <li>
                Alle Positionen belegt und bestätigt. Die Einreichung selbst ist noch nicht
                angebunden — der Kanal wird erst nach Klärung mit dem Kanton implementiert.
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Unklare zuerst — sie brauchen eine Entscheidung */}
      {unklare.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-amber-700 mb-2">
            Unklar — brauchen eine Entscheidung ({unklare.length})
          </h2>
          <div className="space-y-2">
            {unklare.map(b => (
              <BelegKarte key={b.id} beleg={b} positionen={positionenProBeleg[b.id]}
                onBestaetigen={(p) => bestaetigen.mutate(p)}
                onRelevanzAendern={(beleg, relevanz) => relevanzAendern.mutate({ beleg, relevanz })} />
            ))}
          </div>
        </section>
      )}

      {/* Relevante Belege */}
      <section>
        <h2 className="text-sm font-semibold mb-2">Berücksichtigt ({relevante.length})</h2>
        <div className="space-y-2">
          {relevante.length === 0 && (
            <p className="text-sm text-slate-500 italic">Noch keine Belege erfasst.</p>
          )}
          {relevante.map(b => (
            <BelegKarte key={b.id} beleg={b} positionen={positionenProBeleg[b.id]}
              onBestaetigen={(p) => bestaetigen.mutate(p)}
              onRelevanzAendern={(beleg, relevanz) => relevanzAendern.mutate({ beleg, relevanz })} />
          ))}
        </div>
      </section>

      {/* Aussortierte — einklappbar, aber nie versteckt */}
      <section>
        <button
          className="text-sm font-semibold text-slate-600 flex items-center gap-1.5 hover:text-slate-900"
          onClick={() => setZeigeAussortierte(v => !v)}
        >
          {zeigeAussortierte ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          Nicht berücksichtigt ({aussortierte.length})
        </button>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Aussortierte Belege werden nie gelöscht. Ein zu Unrecht aussortierter Beleg ist
          der teuerste Fehler im System — bitte durchsehen.
        </p>
        {zeigeAussortierte && (
          <div className="space-y-2 mt-2">
            {aussortierte.map(b => (
              <BelegKarte key={b.id} beleg={b} positionen={positionenProBeleg[b.id]}
                onBestaetigen={(p) => bestaetigen.mutate(p)}
                onRelevanzAendern={(beleg, relevanz) => relevanzAendern.mutate({ beleg, relevanz })} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
