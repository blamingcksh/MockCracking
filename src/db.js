export const DB_NAME = 'mockcracking';
export const DB_VERSION = 1;

export const STORES = {
  questions: { keyPath: 'id', indexes: ['subject', 'chapter', 'type', 'unit'] },
  papers: { keyPath: 'id', indexes: ['formatId'] },
  attempts: { keyPath: 'id', indexes: ['paperId', 'submittedAt'] },
  assets: { keyPath: 'tag', indexes: ['kind'] },
  profile: { keyPath: 'key', indexes: [] },
};

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, spec] of Object.entries(STORES)) {
        const store = db.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: spec.keyPath });
        for (const idx of spec.indexes) {
          if (!store.indexNames.contains(idx)) store.createIndex(idx, idx, { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}


export async function get(store, key) {
  const db = await openDb();
  return wrap(tx(db, store, 'readonly').get(key));
}

export async function getAll(store) {
  const db = await openDb();
  return wrap(tx(db, store, 'readonly').getAll());
}


export async function getAllByIndex(store, index, value) {
  const db = await openDb();
  return wrap(tx(db, store, 'readonly').index(index).getAll(value));
}

export async function put(store, value) {
  const db = await openDb();
  await wrap(tx(db, store, 'readwrite').put(value));
  return value;
}


export async function putMany(store, values) {
  if (!values.length) return values;
  const db = await openDb();
  const t = db.transaction(store, 'readwrite');
  const objectStore = t.objectStore(store);
  for (const value of values) objectStore.put(value);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(values);
    // An aborted transaction fires neither `complete` nor `error`; without
    // this the promise would never settle and the caller would hang forever.
    t.onerror = () => reject(t.error || new Error(`${store} write failed`));
    t.onabort = () => reject(t.error || new Error(`${store} write aborted`));
  });
}

export async function remove(store, key) {
  const db = await openDb();
  return wrap(tx(db, store, 'readwrite').delete(key));
}

export async function getProfile() {
  const row = await get('profile', 'me');
  if (row) return row;
  return {
    key: 'me',
    ability: 1200,
    chapterAbility: {},
    chapterWeightSum: {},
    totalAttempts: 0,
    updatedAt: 0,
  };
}

export async function saveProfile(row) {
  await put('profile', row);
  return row;
}