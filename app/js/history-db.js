// Historial de diagnósticos guardado SOLO en el dispositivo (IndexedDB).
const DB_NAME = 'bioplant-ai';
const STORE = 'diagnosticos';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Guarda un diagnóstico y devuelve su id. */
export function addDiagnosis(record) {
  return tx('readwrite', (s) => s.add({ ...record, createdAt: record.createdAt ?? Date.now() }));
}

export function getDiagnosis(id) {
  return tx('readonly', (s) => s.get(id));
}

/** Todos los diagnósticos, del más reciente al más antiguo. */
export async function listDiagnoses() {
  const all = await tx('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteDiagnosis(id) {
  return tx('readwrite', (s) => s.delete(id));
}

/** Vuelve a insertar un registro borrado (para "Deshacer"). */
export function restoreDiagnosis(record) {
  return tx('readwrite', (s) => s.put(record));
}
