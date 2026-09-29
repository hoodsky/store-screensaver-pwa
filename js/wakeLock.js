// wakeLock.js — не дає екрану засинати/блокуватись, поки активно
// показується відео. Використовує ДВІ незалежні стратегії одночасно:
//
// 1) Screen Wake Lock API (navigator.wakeLock) — офіційний спосіб, працює
//    на Android (Chrome/Edge) і в звичайній вкладці Safari на iOS 16.4+.
//    АЛЕ: у ВСТАНОВЛЕНИХ на головний екран PWA на iOS це API офіційно
//    зламане аж до iOS 18.4 включно (підтверджений баг WebKit:
//    bugs.webkit.org/show_bug.cgi?id=254545) — API present, метод
//    відпрацьовує без помилки, але екран усе одно блокується.
// 2) Тому паралельно завжди запускається й друга, незалежна від цього
//    багу техніка: невидиме крихітне відео (приховане, muted), яке весь
//    час "активне" (постійна перемотка, а не пасивний loop) — це змушує
//    iOS вважати сторінку не-неактивною і не блокувати екран, і працює
//    навіть там, де офіційний API мовчки не спрацьовує. Техніка перевірена
//    спільнотою (бібліотека NoSleep.js).
//
// Обидві стратегії — best-effort: якщо жодна не спрацює на конкретному
// пристрої/версії ОС, застосунок все одно продовжує працювати штатно.

// Два формати того самого крихітного (2×2px, 2с, беззвучного) кліпу —
// браузер сам обере перший, який уміє декодувати. WebM — для Chrome/
// Firefox; MP4 (H.264) — обов'язково окремо, бо iOS Safari WebM не вміє.
const NOSLEEP_VIDEO_SOURCES = [
  { type: 'video/webm', src: 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAH7EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggHl7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECfQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYgE3fyotmWje5yBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhDuaygDgibCBArqBApqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYgE3fyotmWje2fIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDIuMDAwMDAwMDAwAB9DtnXB54EAo6KBAACAEAIAnQEqAgACAAvHCIWFiJmEiD+CAAwNYAD+5rUAo5iBA+gAsQEALxH8ABgAMD/0DAAAAP7mtQAcU7trkbuPs4EAt4r3gQHxggGf8IED' },
  { type: 'video/mp4', src: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMtbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAld0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHPbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABem1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATpzdGJsAAAAunN0c2QAAAAAAAAAAQAAAKphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAMGF2Y0MBQsAK/+EAGGdCwArZH4iIwEQAAAMABAAAAwAIPEiZIAEABWjLg8sgAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAACkAAAApAAAAAGHN0dHMAAAAAAAAAAQAAAAIAAEAAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAIAAAABAAAAHHN0c3oAAAAAAAAAAAAAAAIAAAKGAAAACgAAABRzdGNvAAAAAAAAAAEAAANdAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2MC4xNi4xMDAAAAAIZnJlZQAAAphtZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA5liIQFv///D0UAAU9/gAAAAAZBmjgK+oA=' },
];

const RECHECK_INTERVAL_MS = 20000;

let sentinel = null;
let shouldHold = false;
let recheckTimer = null;
let noSleepVideoEl = null;

const isWakeLockApiSupported = 'wakeLock' in navigator;

async function acquireNativeWakeLock() {
  if (!isWakeLockApiSupported || !shouldHold || sentinel) return;
  if (document.visibilityState !== 'visible') return; // request() відхилить це все одно

  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
      // Могло бути знято системою навіть без згортання застосунку —
      // одразу пробуємо повернути, якщо воно й далі потрібне.
      if (shouldHold) acquireNativeWakeLock();
    });
  } catch (error) {
    console.warn('Screen Wake Lock request failed:', error);
    sentinel = null;
  }
}

function ensureNoSleepVideo() {
  if (noSleepVideoEl) return noSleepVideoEl;

  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('title', 'keep-awake');
  video.muted = true;
  video.setAttribute('aria-hidden', 'true');
  Object.assign(video.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    opacity: '0.01',
    pointerEvents: 'none',
    zIndex: '-1',
  });

  NOSLEEP_VIDEO_SOURCES.forEach(({ type, src }) => {
    const source = document.createElement('source');
    source.type = type;
    source.src = src;
    video.appendChild(source);
  });

  // Ключова частина техніки: постійна "активність" відтворення (перемотка
  // замість пасивного loop) — саме це, а не сам факт відтворення, схоже,
  // і переконує iOS не присипляти екран.
  video.addEventListener('timeupdate', () => {
    if (video.currentTime > 1) {
      video.currentTime = Math.random();
    }
  });

  document.body.appendChild(video);
  noSleepVideoEl = video;
  return video;
}

async function startNoSleepVideo() {
  if (!shouldHold) return;
  const video = ensureNoSleepVideo();
  try {
    await video.play();
  } catch (error) {
    console.warn('Резервне відео для запобігання сну не запустилось:', error);
  }
}

function stopNoSleepVideo() {
  noSleepVideoEl?.pause();
}

function startRecheckLoop() {
  if (recheckTimer) return;
  recheckTimer = setInterval(() => {
    if (!shouldHold) return;
    if (!sentinel) acquireNativeWakeLock();
    if (noSleepVideoEl?.paused) startNoSleepVideo();
  }, RECHECK_INTERVAL_MS);
}

function stopRecheckLoop() {
  clearInterval(recheckTimer);
  recheckTimer = null;
}

export async function enableWakeLock() {
  shouldHold = true;
  startRecheckLoop();
  await Promise.all([acquireNativeWakeLock(), startNoSleepVideo()]);
}

export async function disableWakeLock() {
  shouldHold = false;
  stopRecheckLoop();
  stopNoSleepVideo();
  if (sentinel) {
    try {
      await sentinel.release();
    } catch (error) {
      // ігноруємо — блокування вже могло бути знято системою
    }
    sentinel = null;
  }
}

// Якщо блокування було втрачено через згортання застосунку/вимкнення екрана,
// намагаємось відновити обидві стратегії, коли сторінка знову стає видимою.
document.addEventListener('visibilitychange', () => {
  if (shouldHold && document.visibilityState === 'visible') {
    acquireNativeWakeLock();
    startNoSleepVideo();
  }
});
