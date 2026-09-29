// sync.js — синхронізація ОДНОГО відео між усіма пристроями через Firebase:
// Storage зберігає сам файл, Firestore — маленький документ-покажчик на
// нього ({ url, storagePath, fileName, updatedAt }), на який усі пристрої
// підписуються в реальному часі (onSnapshot), тому нове відео з'являється
// на інших пристроях без перезавантаження сторінки.
//
// Модуль навмисно нічого не робить, якщо js/firebase-config.js не заповнено
// або немає мережі — усі функції в такому разі відхиляють проміс (reject),
// і виклики цього модуля мають це очікувати й показувати відео з локального
// кешу замість падати. SDK Firebase підвантажується лениво (dynamic import),
// щоб відсутність мережі при першому запуску не ламала весь застосунок.

import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK_VERSION = '12.7.0';
const DOC_COLLECTION = 'screensaver';
const DOC_ID = 'current';
const STORAGE_PATH_PREFIX = 'videos/current';

let sdkPromise = null;
let unsubscribeFn = null;

function isConfigured() {
  return Boolean(FIREBASE_CONFIG.apiKey) && !FIREBASE_CONFIG.apiKey.startsWith('ВАШ_');
}

function loadSdk() {
  if (!isConfigured()) {
    return Promise.reject(
      new Error('Firebase не налаштовано: заповніть js/firebase-config.js своїми даними проєкту')
    );
  }

  if (!sdkPromise) {
    sdkPromise = (async () => {
      const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
      const [{ initializeApp }, firestoreMod, storageMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-firestore.js`),
        import(`${base}/firebase-storage.js`),
      ]);

      const app = initializeApp(FIREBASE_CONFIG);
      const db = firestoreMod.getFirestore(app);
      const storage = storageMod.getStorage(app);

      return { db, storage, firestoreMod, storageMod };
    })();
  }

  return sdkPromise;
}

// Завантажує файл як нове "поточне" синхронізоване відео (перезаписує
// попереднє на тому самому шляху в Storage) і оновлює документ у Firestore,
// на який підписані всі пристрої в режимі "Синхронізоване".
export async function uploadSyncedVideo(file) {
  const { storage, db, storageMod, firestoreMod } = await loadSdk();

  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const storagePath = `${STORAGE_PATH_PREFIX}.${ext}`;
  const fileRef = storageMod.ref(storage, storagePath);

  await storageMod.uploadBytes(fileRef, file, { contentType: file.type || 'video/mp4' });
  const url = await storageMod.getDownloadURL(fileRef);

  const docRef = firestoreMod.doc(db, DOC_COLLECTION, DOC_ID);
  await firestoreMod.setDoc(docRef, {
    url,
    storagePath,
    fileName: file.name,
    updatedAt: firestoreMod.serverTimestamp(),
  });

  return url;
}

// Видаляє синхронізоване відео для ВСІХ пристроїв (і файл зі Storage, і
// документ-покажчик у Firestore).
export async function deleteSyncedVideo() {
  const { storage, db, storageMod, firestoreMod } = await loadSdk();
  const docRef = firestoreMod.doc(db, DOC_COLLECTION, DOC_ID);
  const snapshot = await firestoreMod.getDoc(docRef);

  if (snapshot.exists()) {
    const data = snapshot.data();
    if (data.storagePath) {
      try {
        await storageMod.deleteObject(storageMod.ref(storage, data.storagePath));
      } catch (error) {
        console.warn('Не вдалося видалити файл зі Storage (можливо, вже видалений):', error);
      }
    }
  }

  await firestoreMod.deleteDoc(docRef);
}

// Підписується на зміни синхронізованого відео в реальному часі. onChange
// викликається одразу з поточним значенням (або null, якщо відео ще не
// завантажували/видалили), а потім щоразу, коли хтось завантажує нове відео
// на іншому пристрої. Повертає функцію відписки.
export async function subscribeSyncedVideo(onChange, onError) {
  const { db, firestoreMod } = await loadSdk();
  const docRef = firestoreMod.doc(db, DOC_COLLECTION, DOC_ID);

  stopSyncSubscription();

  unsubscribeFn = firestoreMod.onSnapshot(
    docRef,
    (snapshot) => onChange(snapshot.exists() ? snapshot.data() : null),
    (error) => {
      console.warn('Firestore listener error:', error);
      onError?.(error);
    }
  );

  return unsubscribeFn;
}

export function stopSyncSubscription() {
  unsubscribeFn?.();
  unsubscribeFn = null;
}
