# Спільне відео через Cloudflare R2 (без входу на кіосках)

У спільному режимі адміністратор завантажує відео з пристрою або вставляє
публічне посилання Google Drive. Cloudflare Worker приймає команду, файл
зберігається в R2, а всі пристрої перевіряють версію й кешують її в IndexedDB.
Для звичайного відтворення та синхронізації кіоскам не потрібен акаунт Google.

## Вартість і доступ

На дату налаштування стандартний клас Cloudflare R2 включає 10 GB-місяць
сховища, 1 млн Class A та 10 млн Class B операцій на місяць; передавання
даних із R2 в інтернет безкоштовне. Cloudflare Workers Free включає 100 000
запитів на добу. Понад безкоштовні обсяги можуть застосовуватись тарифи
платформи, тому перевір актуальні [ціни R2](https://developers.cloudflare.com/r2/pricing/)
та [ліміти Workers](https://developers.cloudflare.com/workers/platform/limits/).

## Одноразове розгортання

Потрібні Node.js і безплатний Cloudflare account.

1. У Cloudflare Dashboard створи bucket `store-screensaver-media` у класі
   **Standard**.
2. У розділі **R2 → Manage R2 API Tokens** створи token з доступом Object
   Read & Write лише до цього bucket. Збережи Account ID, Access Key ID та
   Secret Access Key.
3. У `worker/wrangler.jsonc` вистав `ALLOWED_ORIGIN` на origin PWA (для
   GitHub Pages цього проєкту `https://hoodsky.github.io`; без `/repo-path`).
   Якщо потрібно, заміни ім'я bucket у `bucket_name` та `R2_BUCKET_NAME`.
4. З папки `worker/` виконай:

   ```sh
   npm install
   npx wrangler login
   npx wrangler secret put R2_ACCOUNT_ID
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put DRIVE_API_KEY
   npx wrangler deploy
   ```

   Для `ADMIN_PASSWORD` задай довгий випадковий пароль. Для `DRIVE_API_KEY`
   створи API key в Google Cloud Console, увімкни Google Drive API та обмеж
   ключ лише цим API. Цей ключ зберігається як Worker secret і не потрапляє
   в JavaScript чи на пристрої. Він потрібен лише для імпорту публічних
   файлів Drive.
5. Після деплою скопіюй адресу `*.workers.dev` у
   `js/cloud-config.js` в поле `apiBaseUrl` і задеплой PWA. Це одноразове
   з'єднання PWA зі сховищем.

### CORS для прямого завантаження

У Cloudflare R2 bucket відкрий **Settings → CORS Policy** і додай правило:

```json
[
  {
    "AllowedOrigins": ["https://hoodsky.github.io"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Якщо PWA розміщена на іншому origin, заміни origin і в цій політиці, і в
`ALLOWED_ORIGIN` у `worker/wrangler.jsonc`.

## Щоденне використання

1. На будь-якому пристрої відкрий адмін-панель і вибери **Спільне відео**.
2. Введи `ADMIN_PASSWORD`, який задав під час налаштування Worker.
3. Для файла з пристрою натисни **Обрати відеофайл**. Для Drive встав
   посилання з **Anyone with the link → Viewer** і натисни **Імпортувати з
   Drive та синхронізувати**. Приватний Drive-файл цей варіант не читає.
4. Інші пристрої побачать нову версію при старті, поверненні онлайн або
   автоматичній перевірці раз на 10 хвилин. Перевірити вручну можна з
   адмін-панелі.
5. Після першого успішного завантаження всі пристрої програють свою кешовану
   копію офлайн. Для отримання нової версії кожному пристрою потрібен інтернет.

Завантаження з пристрою й імпорт із Drive вимагають пароль адміністратора;
на інших пристроях він не потрібен для перегляду та отримання відео.
