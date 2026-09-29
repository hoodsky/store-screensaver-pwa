// install.js — пропозиція встановити PWA. На Android/Chrome перехоплюємо
// подію beforeinstallprompt і показуємо власну кнопку. На iOS ця подія не
// підтримується взагалі, тож показуємо текстову інструкцію (Поділитися →
// На екран Домівка).

let deferredPrompt = null;

function isRunningStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  const ua = navigator.userAgent;
  const isAppleTouchDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ видає User-Agent, як у macOS, тому додатково перевіряємо
  // наявність сенсорного вводу.
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isAppleTouchDevice || isIPadOS;
}

export function init() {
  const banner = document.getElementById('install-banner');
  const installBtn = document.getElementById('install-btn');
  const dismissBtn = document.getElementById('install-dismiss-btn');
  const iosHint = document.getElementById('install-ios-hint');
  const genericText = document.getElementById('install-text');

  if (!banner) return;
  if (isRunningStandalone()) return; // вже встановлено — нічого не показуємо
  if (localStorage.getItem('installPromptDismissed') === 'true') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    genericText.classList.remove('hidden');
    iosHint.classList.add('hidden');
    installBtn.classList.remove('hidden');
    banner.classList.remove('hidden');
  });

  if (isIOS()) {
    genericText.classList.remove('hidden');
    iosHint.classList.remove('hidden');
    installBtn.classList.add('hidden');
    banner.classList.remove('hidden');
  }

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    banner.classList.add('hidden');
    if (outcome === 'accepted') {
      localStorage.setItem('installPromptDismissed', 'true');
    }
  });

  dismissBtn.addEventListener('click', () => {
    banner.classList.add('hidden');
    localStorage.setItem('installPromptDismissed', 'true');
  });

  window.addEventListener('appinstalled', () => {
    localStorage.setItem('installPromptDismissed', 'true');
    banner.classList.add('hidden');
  });
}
