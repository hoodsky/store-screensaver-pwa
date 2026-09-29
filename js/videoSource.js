// videoSource.js — координує, яке відео зараз активне: локальне (тільки цей
// пристрій, IndexedDB) чи синхронізоване (спільне для всіх пристроїв, через
// Firebase — див. sync.js). Використовується і з main.js (при старті), і з
// adminPanel.js (при перемиканні режиму) — саме тому це окремий модуль, а не
// частина котроїсь із них.

import * as DB from './db.js';
import * as Screensaver from './screensaver.js';
import * as Sync from './sync.js';

export async function activate(mode) {
  Sync.stopSyncSubscription();
  if (mode === 'synced') {
    await activateSynced();
  } else {
    await activateLocal();
  }
}

async function activateLocal() {
  await Screensaver.loadStoredVideo(() => DB.getVideoBlob('local'));
}

async function activateSynced() {
  // Спершу показуємо закешовану локально копію синхронізованого відео —
  // застосунок стартує миттєво й працює офлайн, а свіжу версію (якщо вона
  // з'явиться) підхопимо нижче через підписку.
  await Screensaver.loadStoredVideo(() => DB.getVideoBlob('synced'));

  try {
    await Sync.subscribeSyncedVideo(async (meta) => {
      if (!meta || !meta.url) {
        // Відео видалили на іншому пристрої — прибираємо і тут.
        await DB.deleteVideoBlob('synced');
        await DB.saveSetting('syncedVideoMeta', null);
        await Screensaver.loadVideo(null);
        return;
      }

      const updatedAtMillis = meta.updatedAt?.toMillis ? meta.updatedAt.toMillis() : null;
      const cachedMeta = await DB.getSetting('syncedVideoMeta', null);
      if (cachedMeta && cachedMeta.updatedAtMillis === updatedAtMillis) {
        return; // те саме відео, яке вже закешоване — нічого качати
      }

      try {
        const response = await fetch(meta.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        await DB.saveVideoBlob(blob, 'synced');
        await DB.saveSetting('syncedVideoMeta', { fileName: meta.fileName || '', updatedAtMillis });
        await Screensaver.loadVideo(blob);
      } catch (fetchError) {
        console.warn('Не вдалося завантажити синхронізоване відео:', fetchError);
      }
    });
  } catch (error) {
    // Немає мережі або firebase-config.js не заповнено — лишаємось із тим,
    // що вже закешовано локально (або з порожнім екраном, якщо кешу немає).
    console.warn('Синхронізація недоступна:', error);
  }
}

export function getCachedSyncedMeta() {
  return DB.getSetting('syncedVideoMeta', null);
}
