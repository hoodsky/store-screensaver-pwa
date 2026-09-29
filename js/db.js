// db.js — тонка обгортка над IndexedDB.
// Два object store: "video" (Blob під ключами "local" і "synced" — окремо
// для локального відео цього пристрою і закешованої копії синхронізованого
// відео) та "settings" (key-value). Blob зберігається напряму в IndexedDB
// (без base64), щоб не роздувати розмір та підтримувати великі відеофайли
// офлайн.

const DB_NAME = 'screensaver-db';
const DB_VERSION = 1;
const STORE_VIDEO = 'video';
const STORE_SETTINGS = 'settings';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_VIDEO)) {
        db.createObjectStore(STORE_VIDEO);
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function runTransaction(storeName, mode, operation) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = operation(store);

        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

// key: 'local' (за замовчуванням) або 'synced' — див. коментар угорі файлу.
export function saveVideoBlob(blob, key = 'local') {
  return runTransaction(STORE_VIDEO, 'readwrite', (store) => store.put(blob, key));
}

export function getVideoBlob(key = 'local') {
  return runTransaction(STORE_VIDEO, 'readonly', (store) => store.get(key)).then(
    (result) => result || null
  );
}

export function deleteVideoBlob(key = 'local') {
  return runTransaction(STORE_VIDEO, 'readwrite', (store) => store.delete(key));
}

export function saveSetting(key, value) {
  return runTransaction(STORE_SETTINGS, 'readwrite', (store) => store.put(value, key));
}

export function getSetting(key, defaultValue) {
  return runTransaction(STORE_SETTINGS, 'readonly', (store) => store.get(key)).then((result) =>
    result === undefined ? defaultValue : result
  );
}
