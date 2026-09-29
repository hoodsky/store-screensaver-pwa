// screensaver.js — постійний відеофон: відео показується одразу, щойно воно
// є і показ увімкнено, і грає в циклі без зупинки. Тут немає ані таймера
// бездіяльності, ані закриття на дотик — лише пряме керування через
// адмін-панель (показ увімк/вимк, звук, гучність) і саме відео.

import { enableWakeLock, disableWakeLock } from './wakeLock.js';

let videoEl = null;
let overlayEl = null;
let autoEnabled = true;
let visible = false;
let hasVideo = false;
let currentObjectUrl = null;

export function init({ video, overlay, autoEnabled: autoEnabledSetting, muted, volume }) {
  videoEl = video;
  overlayEl = overlay;
  autoEnabled = autoEnabledSetting;
  videoEl.muted = muted;
  videoEl.volume = volume;
  updateVisibility();
}

export function setAutoEnabled(value) {
  autoEnabled = value;
  updateVisibility();
}

export function setMuted(value) {
  if (videoEl) videoEl.muted = value;
}

export function setVolume(value) {
  if (videoEl) videoEl.volume = value;
}

// Приймає Blob (з IndexedDB) або File (з <input type="file">) — обидва
// підтримують створення object URL однаково.
export async function loadVideo(blobOrFile) {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  if (!blobOrFile) {
    videoEl.removeAttribute('src');
    videoEl.load();
    hasVideo = false;
    updateVisibility();
    return;
  }

  currentObjectUrl = URL.createObjectURL(blobOrFile);
  videoEl.src = currentObjectUrl;
  videoEl.load();
  hasVideo = true;
  updateVisibility();
}

export async function loadStoredVideo(getVideoBlobFn) {
  const blob = await getVideoBlobFn();
  if (blob) {
    await loadVideo(blob);
    return true;
  }
  return false;
}

// Єдине джерело істини: чи має відео зараз бути видимим і відтворюватись.
// Викликається після init, після завантаження/видалення відео і після
// перемикання "Показувати відео" в адмін-панелі.
async function updateVisibility() {
  if (autoEnabled && hasVideo) {
    await show();
  } else {
    hide();
  }
}

async function show() {
  if (visible) return;
  visible = true;
  overlayEl.classList.remove('hidden');
  overlayEl.setAttribute('aria-hidden', 'false');

  try {
    await videoEl.play();
  } catch (error) {
    // Автовідтворення може бути заблоковане браузером за певних умов —
    // застосунок не падає, відео просто чекає на явний play() пізніше
    // (наприклад, спрацює при поверненні вкладки на передній план).
    console.warn('Video autoplay failed:', error);
  }

  enableWakeLock();
}

function hide() {
  visible = false;
  overlayEl.classList.add('hidden');
  overlayEl.setAttribute('aria-hidden', 'true');
  videoEl.pause();
  disableWakeLock();
}

// Викликається при поверненні застосунку з фону/розблокуванні екрана, щоб
// гарантовано відновити відтворення, якщо відео мало б грати.
export function resumePlaybackIfVisible() {
  if (visible) {
    videoEl.play().catch(() => {});
  }
}

export function isVisible() {
  return visible;
}

export function hasVideoLoaded() {
  return hasVideo;
}
