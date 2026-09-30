# Спільне відео: Google Drive + Cloudflare Workers KV (без R2)

Відеофайл лежить у Google Drive. Cloudflare Worker зберігає лише маленький
публічний покажчик на актуальне відео в Workers KV і передає файл пристроям.
R2 не використовується, тож R2 subscription і його платіжний метод не потрібні.

Адміністратор авторизується в Google лише під час завантаження відео.
Відео автоматично відкривається для перегляду за посиланням, тому кіоски
Google-акаунт не потребують. Після першого завантаження PWA зберігає копію
в IndexedDB і відтворює її офлайн.

## Безоплатні ліміти

Workers KV Free має до 100 000 читань на добу, 1 000 записів на добу та
1 GB сховища; Worker у цьому проєкті зберігає в KV лише один невеликий JSON.
Якщо безкоштовні денні ліміти KV вичерпаються, операції KV перестануть
працювати до скидання ліміту — платний план не підключається автоматично.
Див. [ліміти KV](https://developers.cloudflare.com/kv/platform/limits/) та
[ціни Workers](https://developers.cloudflare.com/workers/platform/pricing/).

Відео займає місце у Google Drive та підпорядковується квотам Drive. Публічний
файл доступний будь-кому, хто має посилання. Поширення відео за посиланням
потрібне, щоб пристрої могли отримувати його без входу в Google.

## Одноразове налаштування Google

1. У Google Cloud Console створи або вибери проєкт та увімкни **Google Drive API**.
2. Створи API key і обмеж його лише Google Drive API. Він зберігається як
   секрет Worker, не в JavaScript.
3. Налаштуй OAuth consent screen та створи OAuth client для **Web application**.
   Додай Authorized JavaScript origin:
   `https://jade-gingersnap-2050c5.netlify.app`.
4. Встав OAuth Client ID у `js/google-drive-config.js`. Це публічний client ID;
   токен доступу видається Google лише адміністратору під час завантаження.
   Запитується вузький scope `drive.file`, а не доступ до всього Drive.

## Одноразове налаштування Cloudflare

Потрібні Node.js і Cloudflare account. R2 не вмикай.

1. Створи Workers KV namespace з назвою `store-screensaver-meta`.
2. Скопіюй ID namespace у `worker/wrangler.jsonc` замість
   `PASTE_KV_NAMESPACE_ID_HERE`.
3. У PowerShell з папки `worker/` виконай:

   ```powershell
   npm install
   npx wrangler login
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put DRIVE_API_KEY
   npx wrangler deploy
   ```

   Для `ADMIN_PASSWORD` задай довгий унікальний пароль. У Worker secret
   `DRIVE_API_KEY` встав API key з Google Cloud Console.
4. Скопіюй адресу Worker (наприклад, `https://store-screensaver-sync.<account>.workers.dev`)
   у поле `apiBaseUrl` файла `js/cloud-config.js`.
5. Зміни в `worker/wrangler.jsonc` та JavaScript мають бути задеплоєні разом із
   PWA на Netlify. Домен сайту вже заданий у `ALLOWED_ORIGIN`.

## Щоденне використання

1. Відкрий адмін-панель і вибери **Спільне відео**.
2. Для файла з пристрою натисни **Завантажити відео для всіх пристроїв**.
   Google попросить адміністратора увійти та дозволити застосунку керувати
   файлами, які воно створює. Цей вхід потрібен лише на пристрої адміністратора.
   Новий файл буде опублікований як доступний за посиланням.
3. Для вже завантаженого відео встав публічне посилання Google Drive і натисни
   **Імпортувати з Drive та синхронізувати**. Файл має бути доступний
   **Anyone with the link → Viewer**.
4. Інші пристрої перевіряють оновлення під час запуску, після повернення онлайн
   та кожні 10 хвилин. Після першого кешування вони грають відео офлайн.

Заміна вмісту файла Drive, який уже підключено як спільне відео, виявиться при
наступній перевірці. При завантаженні з пристрою застосунок оновлює свій
керований Drive-файл; якщо попереднє відео було підключене стороннім посиланням,
застосунок створить власний керований файл.
