import React, { useEffect, useState } from "react";
import { Copy, Check, Mail, Users, ExternalLink } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { initials, personStyle } from "../theme";

// ===========================================================================
// EinladenPanel – intern UND extern einladen, direkt auf der Übersicht.
//
// Sascha: "hier auf dieser seite intern und extern einladen".
//
// Zwei Links, die man NICHT verwechseln darf – der häufigste Fehler beim
// ersten Test war genau das:
//   • Kunden brauchen /meet/… (kein Konto, Warteraum)
//   • Kolleginnen und Kollegen brauchen /besprechungen/raum/… (angemeldet,
//     kein Warteraum, sie sind ja schon im Haus)
// Deshalb stehen beide getrennt beschriftet nebeneinander, statt dass man
// raten muss.
//
// Der Mail-Knopf öffnet das Mailprogramm mit fertigem Text (mailto:). Das
// braucht keinen Server, funktioniert mit jedem Mailprogramm und lässt dem
// Absender die letzte Kontrolle über den Text. Der automatische Versand mit
// Outlook-Termin kommt in Phase 2, Schritt 2.
// ===========================================================================
export default function EinladenPanel({ t, roomName, titel = "Besprechung" }) {
  const [kollegen, setKollegen] = useState([]);
  const [kopiert, setKopiert] = useState(null);

  const gastLink = `${window.location.origin}/meet/${roomName}`;
  const internLink = `${window.location.origin}/besprechungen/raum/${roomName}`;

  useEffect(() => {
    let weg = false;
    (async () => {
      try {
        // Dieselbe sichere Mitarbeiterliste, die Chartis und Telefonie nutzen.
        const { data } = await supabase.rpc("chartis_list_staff");
        if (!weg && Array.isArray(data)) setKollegen(data.filter((k) => k.full_name));
      } catch { /* ohne Liste bleiben die Links trotzdem nutzbar */ }
    })();
    return () => { weg = true; };
  }, []);

  const kopieren = async (was, link) => {
    try {
      await navigator.clipboard.writeText(link);
      setKopiert(was);
      setTimeout(() => setKopiert(null), 2000);
    } catch { /* Zwischenablage gesperrt – Feld bleibt markierbar */ }
  };

  const mailAn = (adresse, link, intern) => {
    const betreff = encodeURIComponent(intern ? `Besprechung: ${titel}` : `Einladung: ${titel}`);
    const text = encodeURIComponent(
      intern
        ? `Hallo\n\nich bin in der Besprechung "${titel}".\n\nHier beitreten:\n${link}\n\nGruss`
        : `Guten Tag\n\nich lade Sie zu einer Videobesprechung ein.\n\nMit diesem Link nehmen Sie teil – Sie brauchen kein Konto und müssen nichts installieren:\n${link}\n\nBitte tragen Sie beim Öffnen Ihren Namen ein; ich lasse Sie dann herein.\n\nFreundliche Grüsse`
    );
    window.location.href = `mailto:${adresse || ""}?subject=${betreff}&body=${text}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <LinkZeile
        t={t}
        icon={ExternalLink}
        titel="Für Kunden"
        hinweis="Kein Konto nötig. Der Gast klopft an, Sie lassen ihn herein."
        link={gastLink}
        kopiert={kopiert === "gast"}
        onKopieren={() => kopieren("gast", gastLink)}
        onMail={() => mailAn("", gastLink, false)}
      />

      <LinkZeile
        t={t}
        icon={Users}
        titel="Für das Team"
        hinweis="Angemeldete Mitarbeitende kommen direkt herein, ohne Warteraum."
        link={internLink}
        kopiert={kopiert === "intern"}
        onKopieren={() => kopieren("intern", internLink)}
        onMail={() => mailAn("", internLink, true)}
      />

      {kollegen.length > 0 && (
        <div>
          <div style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: ".09em",
            textTransform: "uppercase", color: t.textMuted, marginBottom: 8,
          }}>
            Kolleginnen und Kollegen einladen
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {kollegen.map((k) => {
              const tone = personStyle(k);
              return (
                <button
                  key={k.id}
                  onClick={() => mailAn(k.email, internLink, true)}
                  title={`${k.full_name} per Mail einladen`}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
                    background: t.base, border: `1px solid ${t.borderSubtle}`,
                    borderRadius: 999, padding: "5px 12px 5px 5px",
                    fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, color: t.textPrimary,
                    transition: "border-color .12s, background .12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.accentFill; e.currentTarget.style.background = t.accentSoft; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.borderSubtle; e.currentTarget.style.background = t.base; }}
                >
                  {k.avatar_url ? (
                    <img src={k.avatar_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
                  ) : (
                    <span style={{
                      width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center",
                      fontSize: 10, fontWeight: 700, background: tone.bg, color: tone.text,
                    }}>{initials(k.full_name)}</span>
                  )}
                  {k.full_name.split(" ")[0]}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: t.textMuted, margin: "9px 0 0" }}>
            Öffnet Ihr Mailprogramm mit fertigem Text — Sie schicken ab.
          </p>
        </div>
      )}
    </div>
  );
}

function LinkZeile({ t, icon: Icon, titel, hinweis, link, kopiert, onKopieren, onMail }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <Icon size={14} style={{ color: t.accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: t.textPrimary }}>{titel}</span>
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        <input
          readOnly value={link} onFocus={(e) => e.target.select()}
          aria-label={`Link ${titel}`}
          style={{
            flex: 1, minWidth: 0, background: t.base, border: `1px solid ${t.borderSubtle}`,
            borderRadius: 10, padding: "9px 11px", color: t.textPrimary,
            fontFamily: 'ui-monospace, "Segoe UI Mono", Consolas, monospace',
            fontSize: 11.5, outline: "none",
          }}
        />
        <button onClick={onKopieren} aria-label="Link kopieren" title="Link kopieren"
          style={knopf(kopiert ? t.answer : t.accentFill)}>
          {kopiert ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <button onClick={onMail} aria-label="Per Mail einladen" title="Per Mail einladen"
          style={{ ...knopf("transparent"), color: t.textSecondary, border: `1px solid ${t.borderStrong}` }}>
          <Mail size={15} />
        </button>
      </div>
      <p style={{ fontSize: 11, color: t.textMuted, margin: "6px 0 0" }}>{hinweis}</p>
    </div>
  );
}

function knopf(bg) {
  return {
    flexShrink: 0, width: 42, border: "none", borderRadius: 10, cursor: "pointer",
    background: bg, color: "#fff", display: "grid", placeItems: "center",
    transition: "background .15s ease-out",
  };
}
