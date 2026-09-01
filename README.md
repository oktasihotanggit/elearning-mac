# ExamBro BKN — Safe Browser untuk Ujian

Aplikasi desktop berbasis Electron yang membuka elearning BKN dalam mode kiosk terkunci.
Backend tidak berubah sama sekali — ExamBro hanya wrapper browser aman.

## Fitur

- ✅ Fullscreen kiosk mode (tidak bisa minimize/resize)
- ✅ Blokir Alt+Tab, F12, Ctrl+Shift+I (DevTools)
- ✅ Blokir klik kanan & context menu
- ✅ Blokir PrintScreen, Ctrl+P, Ctrl+S, Ctrl+U
- ✅ Blokir navigasi ke domain lain
- ✅ Konfirmasi dialog saat coba keluar
- ✅ Single instance (tidak bisa buka 2 window)
- ✅ Elearning dapat deteksi ExamBro via `window.examBro.isExamBro`

## Prasyarat

- Node.js v16+ (https://nodejs.org)
- Koneksi internet (untuk akses elearning online)

## Cara Jalankan (Development)

```bash
cd exambro
npm install
npm start
```

## Cara Build Installer (.exe)

```bash
npm install
npm run build:win
```

Output di folder `dist/`:
- `ExamBro BKN Setup 1.0.0.exe` — installer
- `ExamBro BKN 1.0.0.exe` — portable (tidak perlu install)

## Konfigurasi

Edit bagian `CONFIG` di `main.js`:

```js
const CONFIG = {
  EXAM_URL: 'https://elearning.binakasihnusantara.sch.id', // URL elearning
  KIOSK_MODE: true,   // true = fullscreen kiosk, false = windowed (untuk testing)
  ALLOWED_DOMAINS: [  // Domain yang boleh diakses
    'elearning.binakasihnusantara.sch.id',
    'fonts.googleapis.com',
    ...
  ],
};
```

## Cara Distribusi ke Siswa

1. Build installer: `npm run build:win`
2. Copy file `dist/ExamBro BKN Setup 1.0.0.exe` ke flashdisk / share via jaringan
3. Siswa install di komputer masing-masing
4. Saat ujian: buka ExamBro → login → kerjakan soal

## Deteksi ExamBro di PHP/JavaScript

Di halaman PHP elearning, bisa cek apakah user pakai ExamBro:

```javascript
if (window.examBro && window.examBro.isExamBro) {
    // User pakai ExamBro — sembunyikan tombol tertentu, log ke server, dll
    document.body.classList.add('in-exambro');
}
```

Atau kirim flag ke server via AJAX saat login untuk mencatat bahwa siswa menggunakan ExamBro.

## Catatan Keamanan

- ExamBro **bukan solusi anti-cheat 100%** — siswa tetap bisa screenshot via kamera HP
- Untuk ujian yang sangat penting, tetap awasi secara fisik
- Blokir Ctrl+Alt+Del tidak bisa dari Electron (OS Windows yang handle)
- Mode kiosk bisa di-exit dengan Ctrl+Alt+Del → Task Manager → End Process (tapi butuh effort)
