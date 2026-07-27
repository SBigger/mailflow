// ===========================================================================
// useMarkieren – gemeinsam auf dem geteilten Bildschirm markieren.
//
// Jede Person hat einen Stift in ihrer Farbe und kann auf dem geteilten
// Inhalt zeichnen; alle sehen es sofort. Gedacht für den Normalfall im
// Treuhand: gemeinsam auf eine Bilanz schauen und sagen "diese Zahl hier"
// – und dabei wirklich darauf zeigen.
//
// ── Warum KEINE Fernsteuerung der Maus ───────────────────────────────────
// Der naheliegendere Wunsch wäre, dem Gegenüber die Maus zu überlassen.
// Das kann ein Browser nicht, und zwar grundsätzlich: getDisplayMedia
// liefert ein Videobild, mehr nicht. Wer eine fremde Maus bewegen will,
// braucht ein installiertes Programm mit Systemrechten (TeamViewer & Co.).
// Genau das wollten wir Kunden ersparen. Markieren löst denselben Zweck
// – zeigen, worüber man spricht – ohne irgendetwas zu installieren.
//
// ── Übertragung ──────────────────────────────────────────────────────────
// Über den Datenkanal von LiveKit, denselben, den Chat und Handheben schon
// benutzen. Kein zusätzlicher Dienst, keine Datenbank: Markierungen sind
// eine Geste im Gespräch, kein Dokument.
//
// Koordinaten sind IMMER auf 0..1 des Videobildes normiert, nie Pixel.
// Sonst läge die Markierung bei jedem Gegenüber woanders – dessen Fenster
// ist ja anders gross und der geteilte Bildschirm hat ein eigenes
// Seitenverhältnis. Die Umrechnung macht ZeichenFlaeche.
//
// Bewusste Grenze: Wer später dazukommt, sieht vorher gezeichnete Striche
// nicht. Ein Nachliefern des Standes bräuchte eine Abstimmung darüber, wer
// ihn schickt (sonst antworten alle gleichzeitig) – der Aufwand lohnt für
// eine Geste nicht, die ohnehin zum gerade Gesagten gehört.
// ===========================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent } from "livekit-client";
import { stiftFarbe } from "../theme";

// Obergrenzen gegen Endlos-Gekritzel: Die Fläche wird bei jeder Änderung neu
// gezeichnet, und irgendwann kostet das spürbar. Ältestes fällt heraus.
const MAX_STRICHE = 250;
const MAX_PUNKTE = 2000;

// Punkte sammeln und gebündelt senden statt jeden einzeln: Eine Mausbewegung
// erzeugt leicht 60 Ereignisse pro Sekunde, das wären 60 Pakete.
const SENDE_TAKT_MS = 60;

export default function useMarkieren({ room, identity, verbunden, aktiv }) {
  const [striche, setStriche] = useState([]);
  const [stiftAn, setStiftAn] = useState(false);

  const laufendRef = useRef(null);   // id des Strichs, der gerade gezogen wird
  const pufferRef = useRef(null);    // { id, p: [[x,y], ...] } noch nicht gesendet
  const timerRef = useRef(null);
  const zaehlerRef = useRef(0);

  const meineFarbe = stiftFarbe(identity);

  const sende = useCallback(async (nachricht) => {
    const r = room?.current;
    if (!r?.localParticipant) return;
    try {
      await r.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ kind: "draw", ...nachricht })),
        { reliable: true },
      );
    } catch { /* ein verlorener Strich ist kein Grund für eine Fehlermeldung */ }
  }, [room]);

  // Eine Nachricht auf den Zustand anwenden. Absichtlich dieselbe Funktion für
  // eigene und fremde Striche: So kann der eigene Strich gar nicht anders
  // aussehen als bei den anderen.
  const anwenden = useCallback((von, d) => {
    setStriche((alt) => {
      if (d.art === "start") {
        const neu = [...alt, { id: d.id, von, farbe: d.farbe, punkte: [[d.x, d.y]] }];
        return neu.length > MAX_STRICHE ? neu.slice(neu.length - MAX_STRICHE) : neu;
      }
      if (d.art === "punkte") {
        return alt.map((s) => (
          s.id === d.id && s.punkte.length < MAX_PUNKTE
            ? { ...s, punkte: [...s.punkte, ...d.p] }
            : s
        ));
      }
      if (d.art === "weg") return alt.filter((s) => s.von !== von);
      if (d.art === "wegAlle") return [];
      return alt;
    });
  }, []);

  // ── Empfangen ──────────────────────────────────────────────────────────
  // Eigener Zuhörer neben dem für Chat/Hand in Raum.jsx – ein Room verträgt
  // mehrere, und so bleibt das Markieren in sich geschlossen.
  useEffect(() => {
    const r = room?.current;
    if (!r || !verbunden) return;
    const onData = (payload, participant) => {
      try {
        const d = JSON.parse(new TextDecoder().decode(payload));
        if (d?.kind === "draw") anwenden(participant?.identity || "?", d);
      } catch { /* fremde Pakete ignorieren */ }
    };
    r.on(RoomEvent.DataReceived, onData);
    return () => { r.off(RoomEvent.DataReceived, onData); };
  }, [room, verbunden, anwenden]);

  const abgeben = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const buf = pufferRef.current;
    pufferRef.current = null;
    if (buf?.p?.length) sende({ art: "punkte", id: buf.id, p: buf.p });
  }, [sende]);

  // ── Zeichnen ───────────────────────────────────────────────────────────
  const beginne = useCallback((x, y) => {
    if (!identity) return;
    const id = `${identity}#${zaehlerRef.current++}`;
    laufendRef.current = id;
    const d = { art: "start", id, farbe: meineFarbe, x, y };
    anwenden(identity, d);
    sende(d);
  }, [identity, meineFarbe, anwenden, sende]);

  const fuehre = useCallback((x, y) => {
    const id = laufendRef.current;
    if (!id) return;
    anwenden(identity, { art: "punkte", id, p: [[x, y]] });
    if (!pufferRef.current || pufferRef.current.id !== id) {
      abgeben();
      pufferRef.current = { id, p: [] };
    }
    pufferRef.current.p.push([x, y]);
    if (!timerRef.current) {
      timerRef.current = setTimeout(() => { timerRef.current = null; abgeben(); }, SENDE_TAKT_MS);
    }
  }, [identity, anwenden, abgeben]);

  const beende = useCallback(() => {
    abgeben();
    laufendRef.current = null;
  }, [abgeben]);

  const loescheMeine = useCallback(() => {
    anwenden(identity, { art: "weg" });
    sende({ art: "weg" });
  }, [identity, anwenden, sende]);

  const loescheAlle = useCallback(() => {
    anwenden(identity, { art: "wegAlle" });
    sende({ art: "wegAlle" });
  }, [identity, anwenden, sende]);

  // Endet die Freigabe, sind die Markierungen gegenstandslos – sie hingen ja
  // an einem Bild, das es nicht mehr gibt. Alle sehen das Ende gleichzeitig,
  // also räumt jeder für sich auf, ganz ohne Nachricht.
  useEffect(() => {
    if (aktiv) return;
    setStriche([]);
    setStiftAn(false);
    laufendRef.current = null;
    pufferRef.current = null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, [aktiv]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return {
    striche, stiftAn, setStiftAn, meineFarbe,
    beginne, fuehre, beende, loescheMeine, loescheAlle,
  };
}
