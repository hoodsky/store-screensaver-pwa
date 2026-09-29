// firebase-config.js — конфігурація вашого Firebase-проєкту.
// Потрібна ТІЛЬКИ для режиму "Синхронізоване відео". Якщо ви користуєтесь
// лише локальним відео на кожному пристрої — цей файл можна не чіпати.
//
// Як заповнити (детальніше — у FIREBASE_SETUP.md):
// 1. https://console.firebase.google.com → Add project → безкоштовний план.
// 2. У проєкті: Build → Firestore Database → Create database.
// 3. У проєкті: Build → Storage → Get started.
// 4. Project settings (значок шестерні) → Your apps → Web (</>) → зареєструвати.
// 5. Firebase покаже об'єкт "firebaseConfig" — скопіюйте значення нижче.

export const FIREBASE_CONFIG = {
apiKey: "AIzaSyCSBYpVMfTnsc8ZZPWpgRdDFqNafb5pgt0",
  authDomain: "store-screensaver.firebaseapp.com",
  projectId: "store-screensaver",
  storageBucket: "store-screensaver.firebasestorage.app",
  messagingSenderId: "49972323428",
  appId: "1:49972323428:web:92dccc3adf43d71f8b6b71"
};
