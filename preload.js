/**
 * preload.js — ExamBro BKN v1.0.5
 * Diadaptasi dari BKN-CAT-Windows preload.js
 *
 * Berjalan di konteks renderer dengan akses terbatas.
 * Menghubungkan halaman web dengan main process via IPC yang aman.
 */

const { contextBridge, ipcRenderer } = require('electron');

// ── Expose API ke halaman web ─────────────────────────────────────────────────
contextBridge.exposeInMainWorld('examBro', {
  version:          '1.0.5',
  isExamBro:        true,
  isSecureBrowser:  true,   // kompatibel dengan cek BKN-CAT

  // Halaman ujian memanggil ini saat dimuat
  setExamActive: (active) => {
    ipcRenderer.send('exam-status', active ? 'active' : 'inactive');
  },

  // Halaman ujian memanggil ini saat terjadi pelanggaran
  reportViolation: (type) => {
    ipcRenderer.send('exam-violation-report', type);
  },

  // Daftarkan callback untuk menerima event dari main process
  onViolation: (cb) => {
    ipcRenderer.on('exam-violation', (_event, type) => cb(type));
  },
  onViolationCount: (cb) => {
    ipcRenderer.on('exam-violation-count', (_event, count) => cb(count));
  },
  onForceSubmit: (cb) => {
    ipcRenderer.on('exam-force-submit', (_event, reason) => cb(reason));
  },
});

// ── BLOKIR SAAT DOM SIAP ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {

  // ── FIX FULLSCREEN: Override 100vh dengan pixel aktual layar ─────────────
  // Di Electron kiosk mode, 100vh kadang tidak menutupi taskbar Windows.
  // Paksa semua elemen yang pakai 100vh/100vw menjadi screen.height/width px.
  function applyFullscreenFix() {
    const h = window.screen.height;
    const w = window.screen.width;
    const style = document.getElementById('__exambro_fullscreen_fix__')
                  || document.createElement('style');
    style.id = '__exambro_fullscreen_fix__';

    // Cek apakah ini halaman PDF ujian (punya .pdf-layout)
    const isPdfPage = document.querySelector('.pdf-layout') !== null;

    if (isPdfPage) {
      // Mode PDF: fullscreen ketat, tidak boleh scroll
      style.textContent = `
        html, body {
          width: ${w}px !important;
          height: ${h}px !important;
          max-width: ${w}px !important;
          max-height: ${h}px !important;
          overflow: hidden !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .pdf-layout {
          width: ${w}px !important;
          height: ${h}px !important;
          max-width: ${w}px !important;
          max-height: ${h}px !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          position: fixed !important;
        }
      `;
    } else {
      // Mode halaman biasa (login, dashboard, tugas, dll): bisa scroll vertikal
      // JANGAN set height atau overflow:hidden pada html/body
      style.textContent = `
        html, body {
          max-width: ${w}px !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          margin: 0 !important;
        }
      `;
    }
    document.head.appendChild(style);
  }

  applyFullscreenFix();

  // Re-apply setelah fully loaded (handle SPA navigation)
  // Gunakan setTimeout agar DOM benar-benar siap sebelum cek .pdf-layout
  window.addEventListener('load', () => {
    setTimeout(applyFullscreenFix, 100);
  });

  // 1. Blokir klik kanan (adopsi BKN-CAT)
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }, true);

  // 2. Blokir keyboard shortcut berbahaya
  //    FIX: Alt+F4 TIDAK diblokir di sini → dialog keluar di main.js yang handle
  document.addEventListener('keydown', (e) => {
    const blocked = [
      e.key === 'PrintScreen',
      e.key === 'F12',
      // F5 / Ctrl+R diblokir hanya saat soal tidak boleh di-refresh
      // (e.key === 'F5'),
      (e.ctrlKey && e.shiftKey && ['I','i','J','j','K','k','C','c'].includes(e.key)),
      (e.ctrlKey && ['U','u','P','p','W','w','T','t','N','n'].includes(e.key)),
      (e.metaKey),   // Windows/Super key
    ];
    if (blocked.some(Boolean)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  // 3. Blokir copy/cut di luar input
  document.addEventListener('copy', (e) => {
    if (!['INPUT', 'TEXTAREA'].includes(e.target.tagName)) e.preventDefault();
  }, true);
  document.addEventListener('cut', (e) => {
    if (!['INPUT', 'TEXTAREA'].includes(e.target.tagName)) e.preventDefault();
  }, true);

  // 4. Blokir drag & drop (adopsi BKN-CAT)
  document.addEventListener('dragover',  (e) => e.preventDefault(), true);
  document.addEventListener('drop',      (e) => e.preventDefault(), true);
  document.addEventListener('dragstart', (e) => e.preventDefault(), true);

  // 5. Blokir selection teks soal
  document.addEventListener('selectstart', (e) => {
    if (!['INPUT', 'TEXTAREA'].includes(e.target.tagName)) e.preventDefault();
  }, true);

  // 6. Tandai dokumen untuk PHP/CSS
  document.documentElement.setAttribute('data-exambro', 'true');

  // ── AUTO-FILL EMAIL dari localStorage (Remember Me) ───────────────────────
  (function() {
    try {
      const saved = localStorage.getItem('exambro_remember');
      if (!saved) return;
      const data = JSON.parse(saved);
      // Cek apakah belum expired (30 hari)
      if (data.expires && Date.now() > data.expires) {
        localStorage.removeItem('exambro_remember');
        return;
      }
      // Auto-fill form login jika ada
      const emailInput = document.querySelector('input[name="email"], input[type="email"]');
      const rememberCheck = document.querySelector('input[name="remember"]');
      if (emailInput && data.email) {
        emailInput.value = data.email;
        if (rememberCheck) rememberCheck.checked = true;
      }
    } catch(e) {}
  })();

  // ── SIMPAN email ke localStorage saat form login di-submit ────────────────
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form) return;
    const emailInput = form.querySelector('input[name="email"], input[type="email"]');
    const rememberCheck = form.querySelector('input[name="remember"]');
    const hasLoginBtn = form.querySelector('[name="login"], button[type="submit"]');
    if (!emailInput || !hasLoginBtn) return;

    if (rememberCheck && rememberCheck.checked && emailInput.value) {
      // Simpan email + expiry 30 hari
      localStorage.setItem('exambro_remember', JSON.stringify({
        email:   emailInput.value,
        expires: Date.now() + (30 * 24 * 60 * 60 * 1000),
      }));
    } else if (!rememberCheck || !rememberCheck.checked) {
      // Hapus jika tidak centang Remember Me
      localStorage.removeItem('exambro_remember');
    }
  }, true);

  // ── HAPUS saat logout (klik tombol/link logout) ───────────────────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a[href*="logout"], button.logout-btn, form[action*="logout"] button');
    if (el) {
      try { localStorage.removeItem('exambro_remember'); } catch(e2) {}
    }
  }, true);

  // 7. Deteksi visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      ipcRenderer.send('exam-violation-report', 'visibility_hidden');
    }
  });

  // 8. Deteksi window blur di level web
  window.addEventListener('blur', () => {
    ipcRenderer.send('exam-violation-report', 'window_blur_web');
  });
});
