// fullscreen.js — визначення режиму запуску PWA та (за можливості) утримання
// сторінки в повноекранному режимі Fullscreen API як додатковий захист,
// коли встановлений режим display даного пристрою/браузера цього не гарантує.
//
// Важливо розрізняти дві різні речі:
// 1. display-mode "fullscreen"/"standalone" у manifest.json — це те, як ОС/браузер
//    запускає ВСТАНОВЛЕНИЙ PWA (без адресного рядка). Підтримка "fullscreen"
//    (без системних панелей) залежить від конкретної ОС/браузера; якщо не
//    підтримується — застосунок автоматично використовує "standalone".
// 2. Fullscreen API (document.documentElement.requestFullscreen()) — це окремий,
//    програмний запит на повний екран для поточної сторінки. Він працює як
//    додатковий рівень захисту від випадкового виходу, коли сторінка відкрита
//    у звичайній вкладці браузера, і потребує жесту користувача (тап), тому
//    викликається у відповідь на перший дотик.

export function isRunningInstalled() {
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export async function requestFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request || getFullscreenElement()) return;
  try {
    await request.call(el);
  } catch (error) {
    // Наприклад: браузер не підтримує Fullscreen API для довільних елементів
    // (типово для деяких версій iOS Safari) — застосунок продовжує працювати
    // у звичайному вигляді сторінки.
    console.warn('Fullscreen request failed:', error);
  }
}

export function onFullscreenExit(callback) {
  const handler = () => {
    if (!getFullscreenElement()) callback();
  };
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
}

// Обхід відомого бага WebKit: у встановлених на головний екран PWA на iOS
// висота видимої області іноді "застрягає" зменшеною (наприклад, після
// повернення з фону чи тривалого сеансу) — 100dvh, безпечні зони тощо
// перестають відповідати справжньому розміру екрана, залишаючи чорну смугу
// знизу. Примусове видалення й повернення елемента в потік компоновки
// (display: none → назад, синхронно, без паузи для відмальовки — тому
// візуально непомітно) змушує WebKit перерахувати це наново.
// Джерела: bugs.webkit.org/show_bug.cgi?id=236445, схожі публічні звіти
// про "застряглий" visualViewport у standalone-режимі на iOS.
export function forceViewportRecalc() {
  const el = document.getElementById('app');
  if (!el) return;
  const previousDisplay = el.style.display;
  el.style.display = 'none';
  void el.offsetHeight; // синхронний reflow — без цього наступний рядок не подіє
  el.style.display = previousDisplay || '';
}
