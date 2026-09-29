// Selects a device-local video or one shared video stored in Cloudflare R2.
import * as DB from './db.js';
import * as Screensaver from './screensaver.js';
import * as CloudSync from './cloudSync.js';

CloudSync.startUpdateChecks();

export async function activate(mode) {
  CloudSync.stop();
  // Upgrade older installations that used a shared Firebase/Drive mode.
  if (mode === 'synced' || mode === 'drive') {
    mode = 'cloud';
    await DB.saveSetting('videoSource', mode);
  }
  if (mode === 'cloud') {
    await CloudSync.activate();
  } else {
    await Screensaver.loadStoredVideo(() => DB.getVideoBlob('local'));
  }
}

export function getSharedMeta() {
  return CloudSync.getCachedMeta();
}

export function refreshSharedVideo() {
  return CloudSync.refreshSharedVideo();
}

export function uploadSharedVideo(file, password) {
  return CloudSync.uploadLocalVideo(file, password);
}

export function importDriveLink(link, password) {
  return CloudSync.importDriveLink(link, password);
}

export function isCloudConfigured() {
  return CloudSync.isConfigured();
}
