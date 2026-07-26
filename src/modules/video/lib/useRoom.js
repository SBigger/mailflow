// ===========================================================================
// useRoom – React-Anbindung an livekit-client
//
// BEWUSST NUR DAS KERN-SDK (livekit-client), NICHT @livekit/components-react:
// die Komponentenbibliothek bringt eigenes CSS und eigene Kachel-Logik mit,
// die gegen unser Design arbeiten würde. Hier steuern wir das Room-Objekt
// selbst und geben nach oben eine einfache, React-freundliche Momentaufnahme.
//
// Prinzip: LiveKit meldet Änderungen über Events. Statt einzelne Felder zu
// pflegen, bauen wir bei jedem relevanten Event die komplette Teilnehmerliste
// neu auf (snapshot()). Das ist bei 2–10 Teilnehmenden billig und verhindert
// die klassischen Fehler, bei denen einzelne Zustände auseinanderlaufen.
// ===========================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, ConnectionState } from "livekit-client";

// livekit-client hat die Publikations-Abfrage zwischen Hauptversionen
// umbenannt (getTrack -> getTrackPublication). Beide Wege abdecken, damit ein
// späteres Paket-Update das Modul nicht lautlos zerlegt.
function publicationFor(participant, source) {
  try {
    if (typeof participant.getTrackPublication === "function") {
      return participant.getTrackPublication(source);
    }
    if (typeof participant.getTrack === "function") {
      return participant.getTrack(source);
    }
  } catch { /* defensiv: lieber keine Kachel als ein Absturz */ }
  return undefined;
}

function describe(participant, isLocal) {
  const cam = publicationFor(participant, Track.Source.Camera);
  const mic = publicationFor(participant, Track.Source.Microphone);
  const screen = publicationFor(participant, Track.Source.ScreenShare);

  // metadata trägt bei Gästen später { guest: true } – in Phase 1 sind alle
  // Teilnehmenden Mitarbeitende, der Zweig ist aber schon vorbereitet.
  let meta = {};
  try { meta = participant.metadata ? JSON.parse(participant.metadata) : {}; } catch { /* egal */ }

  return {
    sid: participant.sid,
    identity: participant.identity,
    name: participant.name || participant.identity,
    isLocal,
    isGuest: !!meta.guest,
    isSpeaking: !!participant.isSpeaking,
    audioLevel: participant.audioLevel || 0,
    micOn: !!mic && !mic.isMuted,
    camOn: !!cam && !cam.isMuted && !!cam.track,
    screenOn: !!screen && !!screen.track,
    videoTrack: cam?.track || null,
    screenTrack: screen?.track || null,
    audioTrack: isLocal ? null : mic?.track || null, // eigenes Audio nie lokal ausgeben (Rückkopplung)
    connectionQuality: participant.connectionQuality || "unknown",
  };
}

export function useRoom() {
  const roomRef = useRef(null);
  const [state, setState] = useState("idle"); // idle | connecting | connected | reconnecting | error
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [localFlags, setLocalFlags] = useState({ mic: false, cam: false, screen: false });

  const snapshot = useCallback(() => {
    const room = roomRef.current;
    if (!room || !room.localParticipant) return;
    const remotes = Array.from(room.remoteParticipants?.values?.() || []);
    const list = [
      describe(room.localParticipant, true),
      ...remotes.map((p) => describe(p, false)),
    ];
    setParticipants(list);
    setLocalFlags({
      mic: !!room.localParticipant.isMicrophoneEnabled,
      cam: !!room.localParticipant.isCameraEnabled,
      screen: !!room.localParticipant.isScreenShareEnabled,
    });
  }, []);

  const connect = useCallback(async ({ url, token, video = true, audio = true, videoDeviceId, audioDeviceId }) => {
    if (roomRef.current) return roomRef.current;
    setState("connecting");
    setError(null);

    const room = new Room({
      // adaptiveStream drosselt Auflösungen automatisch nach Kachelgrösse,
      // dynacast schaltet nicht angesehene Streams serverseitig ab – beides
      // spart Bandbreite bei den Kunden, ohne dass wir etwas tun müssen.
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: { width: 1280, height: 720 },
        ...(videoDeviceId ? { deviceId: videoDeviceId } : {}),
      },
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        ...(audioDeviceId ? { deviceId: audioDeviceId } : {}),
      },
    });
    roomRef.current = room;

    const refresh = () => snapshot();
    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.ConnectionQualityChanged, refresh)
      .on(RoomEvent.ParticipantMetadataChanged, refresh)
      .on(RoomEvent.Reconnecting, () => setState("reconnecting"))
      .on(RoomEvent.Reconnected, () => { setState("connected"); refresh(); })
      .on(RoomEvent.Disconnected, () => {
        setState("idle");
        setParticipants([]);
        roomRef.current = null;
      });

    try {
      await room.connect(url, token);
      // Erst nach dem Verbinden veröffentlichen – so sieht der Green Room
      // vorher nur die lokale Vorschau, ohne dass jemand mithört.
      if (audio) await room.localParticipant.setMicrophoneEnabled(true);
      if (video) await room.localParticipant.setCameraEnabled(true);
      setState("connected");
      snapshot();
      return room;
    } catch (e) {
      roomRef.current = null;
      setState("error");
      setError(e?.message || "Verbindung fehlgeschlagen");
      throw e;
    }
  }, [snapshot]);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    roomRef.current = null;
    try { await room.disconnect(); } catch { /* Trennen darf nie werfen */ }
    setState("idle");
    setParticipants([]);
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
    snapshot();
  }, [snapshot]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
    snapshot();
  }, [snapshot]);

  const toggleScreen = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const on = room.localParticipant.isScreenShareEnabled;
    try {
      // audio: true teilt Systemton mit (z.B. Video in einer Präsentation);
      // der Browser fragt selbst, ob der Nutzer das erlauben will.
      await room.localParticipant.setScreenShareEnabled(!on, { audio: true });
    } catch (e) {
      // Nutzer hat den Auswahldialog abgebrochen – kein Fehlerfall.
      if (e?.name !== "NotAllowedError") setError(e?.message || "Bildschirmfreigabe fehlgeschlagen");
    }
    snapshot();
  }, [snapshot]);

  const switchDevice = useCallback(async (kind, deviceId) => {
    const room = roomRef.current;
    if (!room) return;
    try { await room.switchActiveDevice(kind, deviceId); } catch (e) { setError(e?.message || "Gerätewechsel fehlgeschlagen"); }
  }, []);

  // Beim Verlassen der Seite sauber trennen – sonst bleibt man in der
  // Teilnehmerliste der anderen als Geist stehen, bis der Server aufräumt.
  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (room) { try { room.disconnect(); } catch { /* egal */ } }
    };
  }, []);

  return {
    state, error, participants,
    micOn: localFlags.mic, camOn: localFlags.cam, screenOn: localFlags.screen,
    connect, leave, toggleMic, toggleCam, toggleScreen, switchDevice,
    room: roomRef,
    isConnected: state === "connected" || state === "reconnecting",
  };
}

export { ConnectionState };
