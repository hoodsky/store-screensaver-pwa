// Hidden admin panel: choose a local-only video or upload one shared video.
import * as DB from './db.js';
import * as Screensaver from './screensaver.js';
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
    sourceCloud: document.getElementById('admin-source-synced'),
    videoInput: document.getElementById('admin-video-input'),
    videoLabel: document.getElementById('admin-video-label'),
    currentVideoName: document.getElementById('admin-current-video-name'),
    driveLink: document.getElementById('admin-drive-link'),
    sharedOptions: document.getElementById('admin-shared-options'),
    syncPassword: document.getElementById('admin-sync-password'),
    driveImportBtn: document.getElementById('admin-import-drive'),
    driveRefreshBtn: document.getElementById('admin-refresh-drive'),
    deleteVideoBtn: document.getElementById('admin-delete-video'),
    autoToggle: document.getElementById('admin-auto-toggle'),
    muteToggle: document.getElementById('admin-mute-toggle'),
    volumeSlider: document.getElementById('admin-volume-slider'),
    saveBtn: document.getElementById('admin-save-btn'),
    exitBtn: document.getElementById('admin-exit-btn'),
  };

  triggerZoneEl.addEventListener('pointerdown', registerTap);
  fields.sourceLocal.addEventListener('change', () => handleSourceChange('local'));
  fields.sourceCloud.addEventListener('change', () => handleSourceChange('cloud'));
  fields.videoInput.addEventListener('change', handleVideoSelect);
  fields.driveImportBtn.addEventListener('click', handleDriveImport);
  fields.driveRefreshBtn.addEventListener('click', handleDriveRefresh);
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
  tapTimestamps = tapTimestamps.filter((time) => now - time <= TAP_WINDOW_MS);
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
  if (currentSource === 'synced' || currentSource === 'drive') currentSource = 'cloud';
  populateForm(lastSavedSettings);
  fields.sourceLocal.checked = currentSource === 'local';
  fields.sourceCloud.checked = currentSource === 'cloud';
  updateVideoControls();
  await refreshVideoLabel();
  setStatus('');
  panelEl.classList.remove('hidden');
}

function updateVideoControls() {
  const isCloud = currentSource === 'cloud';
  fields.sharedOptions.classList.toggle('hidden', !isCloud);
  fields.driveRefreshBtn.classList.toggle('hidden', !isCloud);
  fields.deleteVideoBtn.classList.toggle('hidden', isCloud);
  fields.videoLabel.textContent = isCloud ? 'Завантажити відео для всіх пристроїв' : 'Обрати відеофайл';
}

function closePanel() {
  fields.syncPassword.value = '';
  panelEl.classList.add('hidden');
}

function populateForm(settings) {
  fields.autoToggle.checked = settings.autoEnabled;
  fields.muteToggle.checked = settings.muted;
  fields.volumeSlider.value = settings.volume;
  fields.volumeSlider.disabled = settings.muted;
}

async function refreshVideoLabel() {
  if (currentSource === 'cloud') {
    const meta = await VideoSource.getSharedMeta();
    fields.currentVideoName.textContent = meta?.fileName
      ? `Спільне відео: ${meta.fileName}`
      : (VideoSource.isCloudConfigured() ? 'Спільне відео ще не кешоване' : 'Потрібно налаштувати Worker — див. CLOUDFLARE_SETUP.md');
  } else {
    const blob = await DB.getVideoBlob('local');
    fields.currentVideoName.textContent = blob ? 'Локальне відео завантажено' : 'Відео не вибрано';
  }
}

async function handleSourceChange(mode) {
  if (mode === currentSource) return;
  currentSource = mode;
  await DB.saveSetting('videoSource', mode);
  updateVideoControls();
  setStatus(mode === 'cloud' ? 'Спільний режим: завантажене відео з’явиться на всіх пристроях' : 'Локальне відео увімкнено');
  try {
    await VideoSource.activate(mode);
  } catch (error) {
    console.warn('Не вдалося активувати джерело відео:', error);
  }
  await refreshVideoLabel();
}

async function handleVideoSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (currentSource === 'cloud') {
    fields.videoInput.disabled = true;
    setStatus('Завантажую відео в Google Drive…');
    try {
      const result = await VideoSource.uploadSharedVideo(file, fields.syncPassword.value);
      setStatus(`Відео «${result.fileName}» синхронізовано`);
      await refreshVideoLabel();
    } catch (error) {
      console.warn('Не вдалося завантажити спільне відео:', error);
      setStatus(`Помилка: ${error.message}`);
    } finally {
      fields.videoInput.disabled = false;
      event.target.value = '';
      fields.syncPassword.value = '';
    }
    return;
  }
  await DB.saveVideoBlob(file, 'local');
  await Screensaver.loadVideo(file);
  setStatus('Відео збережено лише на цьому пристрої');
  await refreshVideoLabel();
  event.target.value = '';
}

async function handleDriveImport() {
  const link = fields.driveLink.value.trim();
  if (!link) {
    setStatus('Вставте публічне посилання Google Drive');
    return;
  }
  fields.driveImportBtn.disabled = true;
  setStatus('Підключаю спільне відео з Google Drive…');
  try {
    const result = await VideoSource.importDriveLink(link, fields.syncPassword.value);
    setStatus(`Відео «${result.fileName}» синхронізовано`);
    fields.driveLink.value = '';
    await refreshVideoLabel();
  } catch (error) {
    console.warn('Не вдалося імпортувати відео з Google Drive:', error);
    setStatus(`Помилка: ${error.message}`);
  } finally {
    fields.driveImportBtn.disabled = false;
    fields.syncPassword.value = '';
  }
}

async function handleDriveRefresh() {
  fields.driveRefreshBtn.disabled = true;
  setStatus('Перевіряю спільне відео…');
  try {
    const result = await VideoSource.refreshSharedVideo();
    setStatus((result.updated ? 'Оновлено: ' : 'Уже актуальне: ') + result.fileName);
    await refreshVideoLabel();
  } catch (error) {
    console.warn('Не вдалося перевірити спільне відео:', error);
    setStatus(`Помилка: ${error.message}`);
  } finally {
    fields.driveRefreshBtn.disabled = false;
  }
}

async function handleDeleteVideo() {
  await DB.deleteVideoBlob('local');
  await Screensaver.loadVideo(null);
  setStatus('Локальне відео видалено');
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
  Screensaver.setAutoEnabled(lastSavedSettings.autoEnabled);
  Screensaver.setMuted(lastSavedSettings.muted);
  Screensaver.setVolume(lastSavedSettings.volume);
  closePanel();
}

function setStatus(message) {
  clearTimeout(statusTimer);
  fields.status.textContent = message;
  if (message) statusTimer = setTimeout(() => { fields.status.textContent = ''; }, 7000);
}
