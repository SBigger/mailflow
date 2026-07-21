// Offline-Warteschlange für die Weinregistrierung: ein Foto + Anzahl wird sofort
// lokal (IndexedDB) gespeichert, damit im Keller ohne Internet nichts verloren geht.
// Sobald wieder online, wird die KI-Erkennung nachgeholt, das Foto hochgeladen und
// der Eintrag in die `wines`-Tabelle geschrieben.
import { supabase, entities, uploadWinePhoto } from "@/api/supabaseClient";

const DB_NAME = "wine-offline-queue";
const DB_VER = 1;
const STORE = "pending";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function addPending(entry) {
  const row = { ...entry, id: entry.id || crypto.randomUUID(), status: "pending" };
  await withStore("readwrite", (store) => store.put(row));
  return row;
}

export async function updatePending(id, patch) {
  await withStore("readwrite", (store) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) store.put({ ...cur, ...patch });
    };
  });
}

export async function removePending(id) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function getAllPending() {
  return withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

export function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ""));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Verarbeitet einen einzelnen Warteschlangen-Eintrag: KI-Erkennung (falls noch
// nicht geschehen) → Foto-Upload → Datenbank-Zeile anlegen → aus Queue entfernen.
export async function processPendingEntry(entry) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Nicht angemeldet");

  let fields = entry.identified || null;
  if (!fields) {
    try {
      const b64 = await fileToBase64(entry.photoBlob);
      const { data, error } = await supabase.functions.invoke("identify-wine", {
        body: { image: b64, mimeType: entry.mimeType || "image/jpeg" },
      });
      if (!error && data?.ok) fields = data;
    } catch (_) {
      // KI-Erkennung optional – Eintrag wird trotzdem mit Anzahl gespeichert
    }
  }

  const photoUrl = await uploadWinePhoto(entry.photoBlob, user.id);

  await entities.Wine.create({
    name: fields?.name || "",
    winzer: fields?.winzer || "",
    jahrgang: fields?.jahrgang || null,
    rebsorte: fields?.rebsorte || "",
    region: fields?.region || "",
    land: fields?.land || "",
    ai_erkannt: !!fields?.name,
    quantity: entry.quantity,
    notizen: entry.notizen || "",
    photo_url: photoUrl,
  });

  await removePending(entry.id);
}

// Verarbeitet alle offenen Einträge; still-scheiternde Einträge bleiben in der
// Queue und werden beim nächsten Aufruf (z.B. 'online'-Event) erneut versucht.
export async function syncPendingQueue({ onProgress } = {}) {
  if (!navigator.onLine) return { synced: 0, remaining: (await getAllPending()).length };
  const pending = await getAllPending();
  let synced = 0;
  for (const entry of pending) {
    try {
      await updatePending(entry.id, { status: "syncing" });
      onProgress?.(entry.id, "syncing");
      await processPendingEntry(entry);
      synced++;
      onProgress?.(entry.id, "done");
    } catch (e) {
      await updatePending(entry.id, { status: "pending", lastError: String(e?.message || e) });
      onProgress?.(entry.id, "error");
    }
  }
  const remaining = await getAllPending();
  return { synced, remaining: remaining.length };
}
