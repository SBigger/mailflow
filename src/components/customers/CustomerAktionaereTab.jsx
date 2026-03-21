import React, { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { entities } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { BookOpen, ExternalLink, Users } from "lucide-react";

const AKTIENART_COLORS = {
  "Namenaktie":       { bg: "#dbeafe", text: "#1d4ed8" },
  "Stammaktie":       { bg: "#dcfce7", text: "#15803d" },
  "Vorzugsaktie":     { bg: "#fef9c3", text: "#854d0e" },
  "Stimmrechtsaktie": { bg: "#fae8ff", text: "#7e22ce" },
};

const fmtCHF = (v, d = 2) => v != null && !isNaN(v)
  ? Number(v).toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d })
  : "—";

export default function CustomerAktionaereTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const navigate = useNavigate();

  const headingC = isArtis ? "#1a3a1a" : isLight ? "#1e293b" : "#e4e4e7";
  const subC     = isArtis ? "#6b826b" : isLight ? "#64748b" : "#a1a1aa";
  const accent   = isArtis ? "#5b8a5b" : isLight ? "#5b8a5b" : "#22c55e";
  const rowBg    = isArtis ? "#f5f8f5" : isLight ? "#f8fafc" : "#2f2f35";
  const bdrC     = isArtis ? "#d4e4d4" : isLight ? "#e8e8f0" : "#3f3f46";

  const { data: eintraege = [], isLoading } = useQuery({
    queryKey: ["aktienbuch", customer.id],
    queryFn: () => entities.Aktienbuch.filter({ customer_id: customer.id, aktiv: true }, "-kaufdatum"),
  });

  const total = eintraege.reduce((s, e) => s + (e.anzahl || 0), 0);
  const totalNominal = eintraege.reduce((s, e) => s + (e.anzahl || 0) * (e.nominalwert || 0), 0);

  if (isLoading) {
    return <div className="py-8 text-sm text-center" style={{ color: subC }}>Lädt…</div>;
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: accent }} />
          <span className="text-sm font-semibold" style={{ color: headingC }}>
            Aktuelle Aktionäre
          </span>
          {eintraege.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: isArtis ? "#e8f2e8" : "#f1f5f9", color: subC }}>
              {eintraege.length} Einträge · {total.toLocaleString("de-CH")} Aktien
            </span>
          )}
        </div>
        <button
          onClick={() => navigate("/Aktienbuch")}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: accent, backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}
        >
          <BookOpen className="w-3 h-3" />
          Aktienbuch öffnen
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Keine Einträge */}
      {eintraege.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 rounded-xl text-center"
          style={{ border: `1px dashed ${bdrC}`, backgroundColor: rowBg }}>
          <BookOpen className="w-8 h-8 mb-2" style={{ color: bdrC }} />
          <div className="text-sm" style={{ color: subC }}>Noch keine Aktionäre erfasst</div>
          <button onClick={() => navigate("/Aktienbuch")}
            className="mt-2 text-xs font-medium" style={{ color: accent }}>
            Im Aktienbuch erfassen →
          </button>
        </div>
      )}

      {/* Aktionärs-Liste */}
      {eintraege.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${bdrC}` }}>
          {eintraege.map((e, idx) => {
            const anteil = total > 0 ? (e.anzahl / total * 100) : 0;
            const artC = AKTIENART_COLORS[e.aktienart] || { bg: "#f3f4f6", text: "#374151" };
            return (
              <div key={e.id}
                className="flex items-center gap-3 px-4 py-3 transition-colors"
                style={{
                  borderBottom: idx < eintraege.length - 1 ? `1px solid ${bdrC}` : "none",
                  backgroundColor: "transparent",
                }}
                onMouseEnter={ev => ev.currentTarget.style.backgroundColor = rowBg}
                onMouseLeave={ev => ev.currentTarget.style.backgroundColor = "transparent"}
              >
                {/* Name + Adresse */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold" style={{ color: headingC }}>
                      {e.aktionaer_name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: artC.bg, color: artC.text }}>
                      {e.aktienart}
                    </span>
                    {e.vinkuliert && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Vinkuliert</span>
                    )}
                  </div>
                  {e.aktionaer_adresse && (
                    <div className="text-xs mt-0.5" style={{ color: subC }}>{e.aktionaer_adresse}</div>
                  )}
                  {e.zertifikat_nr && (
                    <div className="text-xs font-mono" style={{ color: subC }}>
                      Zertifikat: {e.zertifikat_nr}
                      {e.aktien_nr_von && e.aktien_nr_bis && ` (Nr. ${e.aktien_nr_von}–${e.aktien_nr_bis})`}
                    </div>
                  )}
                </div>

                {/* Anzahl + Anteil */}
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold" style={{ color: headingC }}>
                    {(e.anzahl || 0).toLocaleString("de-CH")} Aktien
                  </div>
                  <div className="text-xs" style={{ color: subC }}>
                    CHF {fmtCHF(e.nominalwert)}/Stk.
                  </div>
                </div>

                {/* Anteil % mit Balken */}
                <div className="w-24 flex-shrink-0">
                  <div className="text-xs font-bold text-right mb-1" style={{ color: accent }}>
                    {anteil.toFixed(2)}%
                  </div>
                  <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: isArtis ? "#d4e4d4" : "#e2e8f0" }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${anteil}%`, backgroundColor: accent }} />
                  </div>
                </div>

                {/* Liberierungsgrad */}
                <div className="text-xs w-14 text-right flex-shrink-0"
                  style={{ color: (e.liberierungsgrad ?? 100) < 100 ? "#dc2626" : subC }}>
                  {e.liberierungsgrad ?? 100}% lib.
                </div>
              </div>
            );
          })}

          {/* Total-Zeile */}
          <div className="flex items-center justify-between px-4 py-2.5"
            style={{ backgroundColor: rowBg, borderTop: `1px solid ${bdrC}` }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: subC }}>Total</span>
            <span className="text-sm font-bold" style={{ color: accent }}>
              {total.toLocaleString("de-CH")} Aktien · CHF {fmtCHF(totalNominal)} Gesamtnominal
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
