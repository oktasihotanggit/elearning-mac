/**
 * ExamBro — BKN E-Learning Secure Browser v1.0.5 (macOS)
 * Diadaptasi dari main.js (Windows) untuk platform darwin.
 *
 * Perbedaan utama dari versi Windows:
 * - Tidak ada PowerShell / Win32 API (taskbar, WinKey blocker)
 * - Dock disembunyikan via app.dock.hide()
 * - Blokir Command (Cmd) key combo alih-alih Super/Win key
 * - setSimpleFullScreen() sebagai fallback kiosk macOS
 * - Icon menggunakan .icns (bukan .ico)
 * - User-Agent menyebut macOS agar bisa dibedakan di server
 * - Shortcut list disesuaikan dengan macOS (Cmd+Q, Cmd+H, Mission Control, dll)
 */

const {
  app, BrowserWindow, session, globalShortcut,
  dialog, powerSaveBlocker, ipcMain
} = require('electron');
const path = require('path');
const fs   = require('fs');

// ─── KONFIGURASI ─────────────────────────────────────────────────────────────
const CONFIG = {
  EXAM_URL:     'https://elearning.binakasihnusantara.sch.id',
  ACTIVATE_URL: 'https://elearning.binakasihnusantara.sch.id/exambro_activate.php',
  ALLOWED_DOMAINS: [
    'elearning.binakasihnusantara.sch.id',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'unpkg.com',
    'mozilla.github.io',
    'code.jquery.com',
    'cdn.mathjax.org',
  ],
  APP_TITLE:        'ExamBro — BKN E-Learning',
  APP_VERSION:      '1.0.5',
  MAX_VIOLATIONS:   3,
  FOCUS_CHECK_MS:   2000,
  LOADING_DELAY_MS: 1800,
};
// ─────────────────────────────────────────────────────────────────────────────

let mainWindow     = null;
let psBlockerId    = null;
let violationCount = 0;
let examActive     = false;
let isNavigating   = false;
let isFocusing     = false;

// ── Cegah multiple instance ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.setKiosk(true);
      mainWindow.setFullScreen(true);
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      mainWindow.moveTop();
    }
  });
}

// ── Sembunyikan Dock macOS ────────────────────────────────────────────────────
// Mencegah siswa Cmd+Tab ke app lain via Dock bounce
if (app.dock) {
  app.dock.hide();
}

// ── Disable DPI awareness & overlay hints ────────────────────────────────────
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// ── Custom User-Agent ─────────────────────────────────────────────────────────
// Hapus "Electron/x.x.x", tambahkan "ExamBro-SecureBrowser" + keterangan macOS
// PHP server mendeteksi: strpos($ua, 'ExamBro') !== false
app.userAgentFallback = app.userAgentFallback
  .replace(/Electron\/[\d.]+\s*/, '')
  + ` ExamBro-SecureBrowser/${CONFIG.APP_VERSION} (macOS)`;

// ── PERSIST COOKIES ANTAR SESI ────────────────────────────────────────────────
const COOKIE_FILE = path.join(app.getPath('userData'), 'exambro_cookies.json');

function saveCookies() {
  session.defaultSession.cookies.get({ url: CONFIG.EXAM_URL })
    .then(cookies => {
      try {
        fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies), 'utf8');
      } catch(e) {}
    }).catch(() => {});
}

function restoreCookies() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return;
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    if (!Array.isArray(cookies)) return;
    const now = Math.floor(Date.now() / 1000);
    for (const c of cookies) {
      if (c.expirationDate && c.expirationDate < now) continue;
      const details = {
        url:      CONFIG.EXAM_URL,
        name:     c.name,
        value:    c.value,
        domain:   c.domain,
        path:     c.path || '/',
        secure:   c.secure || false,
        httpOnly: c.httpOnly || false,
      };
      if (c.expirationDate) details.expirationDate = c.expirationDate;
      session.defaultSession.cookies.set(details).catch(() => {});
    }
  } catch(e) {}
}

// ── INJECT HEADER X-ExamBro ───────────────────────────────────────────────────
function setupExamBroHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    headers['X-ExamBro']         = '1';
    headers['X-ExamBro-Version'] = CONFIG.APP_VERSION;
    callback({ requestHeaders: headers });
  });
}

// ── BLOKIR DOMAIN LAIN ────────────────────────────────────────────────────────
function setupRequestFilter() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url   = new URL(details.url);
      const proto = url.protocol;
      if (['data:', 'blob:', 'about:', 'file:'].includes(proto)) return callback({ cancel: false });
      if (proto !== 'https:' && proto !== 'http:')               return callback({ cancel: false });
      const ok = CONFIG.ALLOWED_DOMAINS.some(d =>
        url.hostname === d || url.hostname.endsWith('.' + d)
      );
      callback({ cancel: !ok });
    } catch {
      callback({ cancel: false });
    }
  });
}

// ── Helper: cek URL diizinkan ─────────────────────────────────────────────────
function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return true;
    return CONFIG.ALLOWED_DOMAINS.some(d =>
      parsed.hostname === d || parsed.hostname.endsWith('.' + d)
    );
  } catch {
    return false;
  }
}

// ── BUAT WINDOW ───────────────────────────────────────────────────────────────
function createWindow() {
  // Tentukan path icon (.icns untuk macOS; fallback ke .png jika .icns belum ada)
  const icnsPath = path.join(__dirname, 'assets', 'icon.icns');
  const pngPath  = path.join(__dirname, 'assets', 'icon.png');
  const iconPath = fs.existsSync(icnsPath) ? icnsPath : pngPath;

  mainWindow = new BrowserWindow({
    width:       1280,
    height:      800,
    fullscreen:  true,
    kiosk:       true,
    frame:       false,
    alwaysOnTop: true,
    resizable:   false,
    movable:     false,
    minimizable: false,
    maximizable: false,
    closable:    false,     // macOS: tombol traffic light merah tetap nonaktif
    skipTaskbar: true,
    hasShadow:   false,
    title:       CONFIG.APP_TITLE,
    icon:        iconPath,
    autoHideMenuBar: true,
    menuBarVisible:  false,
    // macOS: sembunyikan title bar, gunakan overlay transparan
    titleBarStyle:         'hidden',
    trafficLightPosition:  { x: -100, y: -100 }, // sembunyikan tombol traffic light
    webPreferences: {
      preload:                     path.join(__dirname, 'preload.js'),
      nodeIntegration:             false,
      contextIsolation:            true,
      sandbox:                     true,
      devTools:                    false,
      webSecurity:                 true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.moveTop();

  // macOS: pastikan kiosk full dan tidak bisa di-escape via ESC
  mainWindow.setKiosk(true);
  mainWindow.setFullScreen(true);

  // Set User-Agent eksplisit
  const ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ExamBro-SecureBrowser/${CONFIG.APP_VERSION} (macOS)`;
  mainWindow.webContents.setUserAgent(ua);

  // ── Splash screen ──────────────────────────────────────────────────────────
  mainWindow.loadFile(path.join(__dirname, 'assets', 'loading.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(CONFIG.ACTIVATE_URL);
      }
    }, CONFIG.LOADING_DELAY_MS);
  });

  // ── Event navigasi ─────────────────────────────────────────────────────────
  mainWindow.webContents.on('did-start-navigation', () => { isNavigating = true; });
  mainWindow.webContents.on('did-finish-load',       () => { isNavigating = false; });

  mainWindow.webContents.on('will-redirect', (e, url) => {
    if (!isAllowedUrl(url)) {
      e.preventDefault();
    } else {
      isNavigating = true;
    }
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAllowedUrl(url)) {
      e.preventDefault();
      console.log('[ExamBro] Navigasi diblokir:', url);
    }
  });

  mainWindow.webContents.on('did-navigate', (e, url) => {
    isNavigating = false;
    const wasActive = examActive;
    examActive = url.includes('/materi/pretest/') || url.includes('/materi/posttest/');
    if (examActive && !wasActive) {
      violationCount = 0;
      console.log('[ExamBro] Ujian aktif:', url);
    }
    if (url.includes('concurrent=1') || url.includes('reason=concurrent')) {
      showConcurrentDialog();
    }
  });

  mainWindow.webContents.on('did-navigate-in-page', (e, url) => {
    isNavigating = false;
    examActive = url.includes('/materi/pretest/') || url.includes('/materi/posttest/');
  });

  // Retry otomatis saat gagal load
  mainWindow.webContents.on('did-fail-load', (e, code, desc, vurl) => {
    isNavigating = false;
    if (code !== -3 && vurl && isAllowedUrl(vurl)) {
      console.log('[ExamBro] Load gagal, retry dalam 2s:', vurl, code);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(vurl);
        }
      }, 2000);
    }
  });

  // ── Blokir window baru ─────────────────────────────────────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) mainWindow.loadURL(url);
    return { action: 'deny' };
  });

  // ── Set cookie exambro=1 setiap halaman selesai load ──────────────────────
  mainWindow.webContents.on('did-finish-load', () => {
    session.defaultSession.cookies.set({
      url:    CONFIG.EXAM_URL,
      name:   'exambro',
      value:  '1',
      domain: new URL(CONFIG.EXAM_URL).hostname,
      path:   '/',
      secure: true,
      httpOnly: false,
      expirationDate: Math.floor(Date.now() / 1000) + 86400,
    }).catch(() => {});
  });

  // ── Cegah minimize/hide ────────────────────────────────────────────────────
  mainWindow.on('minimize', () => {
    mainWindow.restore();
    mainWindow.setKiosk(true);
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.moveTop();
    if (examActive) handleViolation('minimize');
  });
  mainWindow.on('hide', () => {
    mainWindow.show();
    if (examActive) handleViolation('hide');
  });
  mainWindow.on('leave-full-screen', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setKiosk(true);
        mainWindow.setFullScreen(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.moveTop();
      }
    }, 50);
  });

  // ── Tangani blur ───────────────────────────────────────────────────────────
  mainWindow.on('blur', () => {
    if (isFocusing) return;
    isFocusing = true;
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.moveTop();
        if (examActive && !isNavigating) {
          mainWindow.webContents.send('exam-violation', 'window_blur');
        }
      }
      isFocusing = false;
    }, 80);
  });

  // ── Close → dialog konfirmasi ──────────────────────────────────────────────
  // macOS: Cmd+Q, tombol merah traffic light, dan app.on('before-quit') semua
  // berujung ke event 'close' karena closable:false. Handler ini mencegat semua.
  mainWindow.on('close', (e) => {
    e.preventDefault();
    if (examActive) {
      const c = dialog.showMessageBoxSync(mainWindow, {
        type:      'warning',
        buttons:   ['Lanjutkan Ujian', 'Keluar (Ujian Batal)'],
        defaultId: 0,
        cancelId:  0,
        title:     'Ujian Sedang Berlangsung',
        message:   'Anda sedang mengerjakan ujian!',
        detail:    'Keluar sekarang akan membatalkan ujian dan progress tidak tersimpan.\nPastikan sudah kumpulkan jawaban sebelum keluar.',
      });
      if (c === 1) {
        mainWindow.destroy();
        app.quit();
      }
    } else {
      const c = dialog.showMessageBoxSync(mainWindow, {
        type:      'question',
        buttons:   ['Tetap di Aplikasi', 'Keluar'],
        defaultId: 0,
        cancelId:  0,
        title:     'Konfirmasi Keluar',
        message:   'Keluar dari ExamBro?',
      });
      if (c === 1) {
        mainWindow.destroy();
        app.quit();
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC: Pelanggaran dari halaman web ─────────────────────────────────────────
ipcMain.on('exam-violation-report', (event, type) => {
  if (!examActive) return;
  violationCount++;
  console.log(`[ExamBro] Pelanggaran #${violationCount}: ${type}`);
  mainWindow.webContents.send('exam-violation-count', violationCount);
  if (violationCount >= CONFIG.MAX_VIOLATIONS) {
    mainWindow.webContents.send('exam-force-submit', 'Terlalu banyak pelanggaran');
  }
});

ipcMain.on('exam-status', (event, status) => {
  examActive = (status === 'active');
  if (!examActive) violationCount = 0;
  console.log('[ExamBro] Status ujian:', status);
});

function handleViolation(type) {
  if (!mainWindow) return;
  mainWindow.webContents.send('exam-violation', type);
}

// ── SHORTCUT BLOCKER (macOS) ──────────────────────────────────────────────────
function registerShortcuts() {
  const blocked = [
    // macOS system / Spotlight / Mission Control
    'Command+Space',          // Spotlight
    'Command+Tab',            // App Switcher
    'Command+Shift+Tab',      // App Switcher balik
    'Command+`',              // Switch window dalam satu app
    'Command+M',              // Minimize
    'Command+H',              // Hide app
    'Command+Option+H',       // Hide other apps
    'Command+W',              // Close window/tab
    'Command+Q',              // Quit app — ditangani lewat dialog, diblokir di sini
    'Command+Option+Escape',  // Force Quit dialog
    'Command+Shift+3',        // Screenshot full
    'Command+Shift+4',        // Screenshot selection
    'Command+Shift+5',        // Screenshot/Record UI
    'Command+Shift+6',        // Screenshot Touch Bar
    'Command+Control+Q',      // Lock screen
    'Command+Option+D',       // Show/hide Dock
    'Command+Control+F',      // Toggle fullscreen (interferes dengan kiosk)
    // Browser / DevTools
    'F11', 'F12', 'F5',
    'Command+R', 'Command+Shift+R',
    'Command+T', 'Command+N', 'Command+Shift+N',
    'Command+Option+I',       // DevTools
    'Command+Option+J',       // Console
    'Command+Option+C',       // Inspector
    'Command+U',              // View Source
    'Command+L',              // Address bar
    'Command+D',              // Bookmark
    'Command+P',              // Print
    'Command+S',              // Save page
    'Command+F',              // Find (bisa diizinkan, tapi blokir untuk keamanan)
    // Clipboard (di halaman ujian)
    'Command+C',
    'Command+V',
    'Command+X',
    // Mission Control / Expose
    'Control+Up',             // Mission Control
    'Control+Down',           // App Expose
    'Control+Left',           // Spaces kiri
    'Control+Right',          // Spaces kanan
    // Screenshot (PrintScreen tidak ada di Mac, pakai kombinasi di atas)
    'Shift+Command+3',
    'Shift+Command+4',
    'Shift+Command+5',
  ];

  blocked.forEach(sc => {
    try {
      globalShortcut.register(sc, () => {
        console.log('[ExamBro] Shortcut diblokir:', sc);
        if (examActive) handleViolation('shortcut_' + sc);
      });
    } catch (err) {
      // Beberapa shortcut OS level tidak bisa dicegat (Ctrl+Alt+Del equivalent)
      console.warn('[ExamBro] Tidak bisa blokir shortcut:', sc, err.message);
    }
  });
}

// ── Dialog concurrent session ─────────────────────────────────────────────────
function showConcurrentDialog() {
  if (!mainWindow) return;
  dialog.showMessageBox(mainWindow, {
    type:    'error',
    title:   'Sesi Dihentikan',
    message: 'Akun Anda login dari perangkat lain.',
    detail:  'Sesi ujian ini dihentikan karena akun digunakan di perangkat lain.\nHubungi pengawas jika ini bukan Anda.',
    buttons: ['OK'],
  });
}

// ── APP EVENTS ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  psBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  restoreCookies();
  setupExamBroHeaders();
  setupRequestFilter();
  createWindow();
  registerShortcuts();

  // macOS: sembunyikan Dock setelah app.whenReady agar efek lebih stabil
  if (app.dock) app.dock.hide();

  // Paksa fokus & kiosk — interval 2s
  const focusTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (isFocusing) return;
    if (!mainWindow.isFocused() || !mainWindow.isFullScreen()) {
      mainWindow.setKiosk(true);
      mainWindow.setFullScreen(true);
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      mainWindow.focus();
      mainWindow.moveTop();
    }
  }, CONFIG.FOCUS_CHECK_MS);

  mainWindow && mainWindow.on('closed', () => clearInterval(focusTimer));

  // macOS: recreate window jika semua tertutup dan app masih aktif
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS: jangan quit saat semua window ditutup — biarkan app tetap hidup di Dock
// (namun Dock sudah disembunyikan, jadi ini mostly untuk mencegah accidental quit)
app.on('window-all-closed', () => {
  saveCookies();
  if (psBlockerId !== null) powerSaveBlocker.stop(psBlockerId);
  globalShortcut.unregisterAll();
  // Di macOS, tidak panggil app.quit() — app tetap hidup sampai user konfirmasi
  // Tapi karena kiosk, seharusnya ini tidak pernah dipanggil dalam normal flow.
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  saveCookies();
  if (psBlockerId !== null) powerSaveBlocker.stop(psBlockerId);
  globalShortcut.unregisterAll();
  // Tampilkan Dock kembali saat app keluar agar sistem normal kembali
  if (app.dock) app.dock.show();
});

// macOS: before-quit dipanggil saat Cmd+Q atau app.quit()
// Jika ujian sedang berlangsung, dialog konfirmasi sudah ditangani di 'close' event.
// Ini hanya tambahan safety net.
app.on('before-quit', (e) => {
  // Jika mainWindow masih ada, biarkan 'close' event yang handle dialog
  // app.quit() setelah mainWindow.destroy() sudah aman → tidak perlu mencegat
});
