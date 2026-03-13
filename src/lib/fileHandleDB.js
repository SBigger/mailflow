// IndexedDB helper to persist FileSystemFileHandle across page reloads
// Used by the Dokumente checkout/checkin system

const DB_NAME = 'artis-filehandles';
const DB_VER  = 2;          // v2: added handle-meta store
const STORE   = 'handles';
const META    = 'handle-meta';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(META))  db.createObjectStore(META);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

export async function saveHandle(docId, handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, docId);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

export async function loadHandle(docId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(docId);
    req.onsuccess = (e) => resolve(e.target.result || null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

export async function deleteHandle(docId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(docId);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// Speichert lastModified-Zeitstempel der Datei beim Auschecken.
// Wird vom Auto-Checkin-Watcher verwendet um Aenderungen zu erkennen.
export async function saveHandleMeta(docId, originalLastModified) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put({ originalLastModified }, docId);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

export async function loadHandleMeta(docId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(META, 'readonly');
    const req = tx.objectStore(META).get(docId);
    req.onsuccess = (e) => resolve(e.target.result || null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

export async function deleteHandleMeta(docId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).delete(docId);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}
