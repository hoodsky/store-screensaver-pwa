// main.js — точка входу: завантажує налаштування, ініціалізує всі модулі.
// Відео грає одразу й безперервно (без таймера бездіяльності); дотик по
// екрану не ховає відео, а виходить із застосунку — див. exitApp.js.

import * as DB from './db.js';
import * as Screensaver from './screensaver.js';
import * as AdminPanel from './adminPanel.js';
import * as Install from './install.js';
import * as VideoSource from './videoSource.js';
import { setupExitOnTap } from './exitApp.js';
import { isRunningInstalled, requestFullscreen, onFullscreenExit, forceViewportRecalc } from './fullscreen.js';

const VIEWPORT_RECHECK_INTERVAL_MS = 5 * 60 * 1000; // кожні 5 хв про всяк випадок

const DEFAULT_SETTINGS = {
  autoEnabled: true,
  muted: true,
  volume: 1,
  videoSource: VideoSource.isCloudConfigured() ? 'cloud' : 'local',
};

async function loadSettings() {
  const [autoEnabled, muted, volume, videoSource] = await Promise.all([
    DB.getSetting('autoEnabled', DEFAULT_SETTINGS.autoEnabled),
    DB.getSetting('muted', DEFAULT_SETTINGS.muted),
    DB.getSetting('volume', DEFAULT_SETTINGS.volume),
    DB.getSetting('videoSource', DEFAULT_SETTINGS.videoSource),
  ]);
  return { autoEnabled, muted, volume, videoSource };
}

// Захист від випадкового виходу з повноекранного режиму: якщо застосунок
// відкрито у звичайній вкладці (не встановлено як PWA), запитуємо Fullscreen
// API на перший дотик, і намагаємось повторно увійти в нього, якщо його
// було залишено.
function setupFullscreenHandling() {
  const tryFullscreenOnce = () => {
    requestFullscreen();
    document.removeEventListener('pointerdown', tryFullscreenOnce);
  };

  if (!isRunningInstalled()) {
    document.addEventListener('pointerdown', tryFullscreenOnce);
  }

  onFullscreenExit(() => {
    document.addEventListener('pointerdown', tryFullscreenOnce, { once: true });
  });
}

// Якщо застосунок повертається з фону, розблоковується екран, тощо —
// переконуємось, що відео (якщо воно мало б бути видимим) продовжує грати,
// і примусово перераховуємо висоту вікна (обхід відомого бага iOS зі
// "застряглою" видимою областю — див. коментар у fullscreen.js). Плюс та
// сама перевірка періодично, бо на практиці баг іноді зʼявляється просто
// від тривалого сеансу, без згортання застосунку.
function setupVisibilityHandling() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      Screensaver.resumePlaybackIfVisible();
      forceViewportRecalc();
    }
  });

  setInterval(forceViewportRecalc, VIEWPORT_RECHECK_INTERVAL_MS);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}

async function main() {
  const videoEl = document.getElementById('screensaver-video');
  const overlayEl = document.getElementById('screensaver');

  let settings = DEFAULT_SETTINGS;
  try {
    settings = await loadSettings();
  } catch (error) {
    console.warn('Не вдалося завантажити налаштування, використовуються типові:', error);
  }

  Screensaver.init({
    video: videoEl,
    overlay: overlayEl,
    autoEnabled: settings.autoEnabled,
    muted: settings.muted,
    volume: settings.volume,
  });

  try {
    await VideoSource.activate(settings.videoSource);
  } catch (error) {
    console.warn('Не вдалося завантажити збережене відео:', error);
  }

  AdminPanel.init();
  Install.init();
  setupFullscreenHandling();
  setupVisibilityHandling();
  setupExitOnTap();
  registerServiceWorker();
}

main();
