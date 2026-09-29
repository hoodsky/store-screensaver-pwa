// adminPanel.js — прихована адмін-панель: відкривається потрійним натисканням
// у правому верхньому куті, дозволяє керувати відео та налаштуваннями.
// Відео тепер завжди грає одразу, тому окремої "тестової" кнопки для
// запуску заставки більше немає — досить увімкнути показ і завантажити відео.
//
// Джерело відео: "local" (тільки цей пристрій, IndexedDB) або "synced"
// (спільне для всіх пристроїв через Firebase — див. sync.js/videoSource.js).

import * as DB from './db.js';
import * as Screensaver from './screensaver.js';
import * as Sync from './sync.js';
import * as VideoSource from './videoSource.js';

const TAP_COUNT_REQUIRED = 3;
const TAP_WINDOW_MS = 1500;

let tapTimestamps = [];
let panelEl;
let triggerZoneEl;
let fields = {};
let lastSavedSettings = {};
let currentSource = 'local';
let statusTimer = null;

export function init() {
  panelEl = document.getElementById('admin-panel');
  triggerZoneEl = document.getElementById('admin-trigger-zone');

  fields = {
    status: document.getElementById('admin-status'),
    sourceLocal: document.getElementById('admin-source-local'),
    sourceSynced: document.getElementById('admin-source-synced'),
    videoInput: document.getElementById('admin-video-input'),
    currentVideoName: document.getElementById('admin-current-video-name'),
    deleteVideoBtn: document.getElementById('admin-delete-video'),
    autoToggle: document.getElementById('admin-auto-toggle'),
    muteToggle: document.getElementById('admin-mute-toggle'),
    volumeSlider: document.getElementById('admin-volume-slider'),
    saveBtn: document.getElementById('admin-save-btn'),
    exitBtn: document.getElementById('admin-exit-btn'),
  };

  // Потрійне натискання у невидимій зоні відкриває панель.
  triggerZoneEl.addEventListener('pointerdown', registerTap);

  fields.sourceLocal.addEventListener('change', () => handleSourceChange('local'));
  fields.sourceSynced.addEventListener('change', () => handleSourceChange('synced'));
  fields.videoInput.addEventListener('change', handleVideoSelect);
  fields.deleteVideoBtn.addEventListener('click', handleDeleteVideo);
  fields.autoToggle.addEventListener('change', (e) => Screensaver.setAutoEnabled(e.target.checked));
  fields.muteToggle.addEventListener('change', (e) => {
    Screensaver.setMuted(e.target.checked);
    fields.volumeSlider.disabled = e.target.checked;
  });
  fields.volumeSlider.addEventListener('input', (e) => Screensaver.setVolume(Number(e.target.value)));
  fields.saveBtn.addEventListener('click', handleSave);
  fields.exitBtn.addEventListener('click', handleExit);
}

function registerTap() {
  const now = Date.now();
  tapTimestamps.push(now);
  tapTimestamps = tapTimestamps.filter((t) => now - t <= TAP_WINDOW_MS);

  if (tapTimestamps.length >= TAP_COUNT_REQUIRED) {
    tapTimestamps = [];
    openPanel();
  }
}

async function openPanel() {
  lastSavedSettings = {
    autoEnabled: await DB.getSetting('autoEnabled', true),
    muted: await DB.getSetting('muted', true),
    volume: await DB.getSetting('volume', 1),
  };
  currentSource = await DB.getSetting('videoSource', 'local');

  populateForm(lastSavedSettings);
  fields.sourceLocal.checked = currentSource === 'local';
  fields.sourceSynced.checked = currentSource === 'synced';
  await refreshVideoLabel();
  setStatus('');

  panelEl.classList.remove('hidden');
}

function closePanel() {
  panelEl.classList.add('hidden');
}

function populateForm(settings) {
  fields.autoToggle.checked = settings.autoEnabled;
  fields.muteToggle.checked = settings.muted;
  fields.volumeSlider.value = settings.volume;
  fields.volumeSlider.disabled = settings.muted;
}

async function refreshVideoLabel() {
  if (currentSource === 'synced') {
    const meta = await VideoSource.getCachedSyncedMeta();
    fields.currentVideoName.textContent = meta?.fileName
      ? `Синхронізоване відео: ${meta.fileName}`
      : 'Синхронізоване відео ще не завантажене';
  } else {
    const blob = await DB.getVideoBlob('local');
    fields.currentVideoName.textContent = blob ? 'Локальне відео завантажено' : 'Відео не вибрано';
  }
}

async function handleSourceChange(mode) {
  if (mode === currentSource) return;
  currentSource = mode;
  await DB.saveSetting('videoSource', mode);
  setStatus(mode === 'synced' ? 'Синхронізоване відео увімкнено' : 'Локальне відео увімкнено');

  try {
    await VideoSource.activate(mode);
  } catch (error) {
    console.warn('Не вдалося активувати джерело відео:', error);
  }
  await refreshVideoLabel();
}

async function handleVideoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (currentSource === 'synced') {
    setStatus('Завантаження на всі пристрої…');
    fields.videoInput.disabled = true;
    try {
      await Sync.uploadSyncedVideo(file);
      // Це саме пристрій теж підписаний і підхопить файл через onSnapshot,
      // але одразу показуємо його тут же — для миттєвого відгуку адміну.
      await Screensaver.loadVideo(file);
      setStatus('Відео завантажено на всі пристрої');
    } catch (error) {
      console.warn('Синхронізоване завантаження не вдалося:', error);
      setStatus('Помилка: перевірте налаштування Firebase (js/firebase-config.js) і мережу');
    } finally {
      fields.videoInput.disabled = false;
    }
  } else {
    await DB.saveVideoBlob(file, 'local');
    await Screensaver.loadVideo(file);
    setStatus('Відео збережено');
  }

  await refreshVideoLabel();
  e.target.value = '';
}

async function handleDeleteVideo() {
  if (currentSource === 'synced') {
    setStatus('Видалення на всіх пристроях…');
    try {
      await Sync.deleteSyncedVideo();
      setStatus('Синхронізоване відео видалено');
    } catch (error) {
      console.warn('Не вдалося видалити синхронізоване відео:', error);
      setStatus('Помилка: перевірте налаштування Firebase і мережу');
    }
  } else {
    await DB.deleteVideoBlob('local');
    await Screensaver.loadVideo(null);
    setStatus('Відео видалено');
  }
  await refreshVideoLabel();
}

async function handleSave() {
  const settings = {
    autoEnabled: fields.autoToggle.checked,
    muted: fields.muteToggle.checked,
    volume: Number(fields.volumeSlider.value),
  };

  await Promise.all([
    DB.saveSetting('autoEnabled', settings.autoEnabled),
    DB.saveSetting('muted', settings.muted),
    DB.saveSetting('volume', settings.volume),
  ]);

  lastSavedSettings = settings;
  setStatus('Налаштування збережено');
  closePanel();
}

function handleExit() {
  // Скасовуємо будь-яке "живе" попереднє налаштування (мʼют/гучність/показ),
  // повертаючи останні збережені значення. Джерело відео (local/synced) уже
  // збережене одразу при виборі, тому тут не відкочується.
  Screensaver.setAutoEnabled(lastSavedSettings.autoEnabled);
  Screensaver.setMuted(lastSavedSettings.muted);
  Screensaver.setVolume(lastSavedSettings.volume);
  closePanel();
}

function setStatus(message) {
  clearTimeout(statusTimer);
  fields.status.textContent = message;
  if (message) {
    statusTimer = setTimeout(() => {
      fields.status.textContent = '';
    }, 4000);
  }
}
