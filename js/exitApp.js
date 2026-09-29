// exitApp.js — вихід із застосунку при дотику по екрану.
//
// Вебзастосунок може закритись сам лише через window.close(). У ВСТАНОВЛЕНОМУ
// PWA (Android, desktop) це закриває застосунок і повертає користувача на
// головний екран пристрою. iOS не дає вебзастосункам жодного способу
// закритись самостійно — там window.close() нічого не робить, тож дотик
// просто не має ефекту (відео продовжує грати), а вийти можна свайпом угору
// від нижнього краю екрана.
//
// Дотики, які НЕ повинні закривати застосунок:
//  - невидима зона у правому верхньому куті (потрійний тап відкриває адмінку);
//  - сама адмін-панель разом із затемненим тлом навколо неї;
//  - банер із пропозицією встановити застосунок.

const EXEMPT_SELECTOR = '#admin-trigger-zone, #admin-panel, #install-banner';

export function exitApp() {
  try {
    window.close();
  } catch (error) {
    console.warn('Не вдалося закрити застосунок:', error);
  }
}

export function setupExitOnTap() {
  // "click" (а не "pointerdown") — щоб системні жести на кшталт свайпу від
  // краю екрана, які браузер скасовує, не закривали застосунок випадково.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(EXEMPT_SELECTOR)) return;
    exitApp();
  });
}
