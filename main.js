/**
 * ExamBro — BKN E-Learning Secure Browser v1.0.5
 * Diadaptasi dari BKN-CAT-Windows v1.2.1
 *
 * Perbaikan kunci (adopsi dari BKN-CAT):
 * - Loading splash screen sebelum loadURL
 * - isNavigating flag → cegah white screen setelah login (FIX utama)
 * - Custom User-Agent → server mengenali ExamBro
 * - moveTop() agar window selalu di depan
 * - Retry otomatis saat did-fail-load
 * - Dialog concurrent session
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
    'unpkg.com',              // PDF.js worker fallback
    'mozilla.github.io',      // PDF.js CDN alternatif
    'cdn.jsdelivr.net',       // PDF.js, MathJax, Quill
    'code.jquery.com',        // jQuery jika dipakai
    'cdn.mathjax.org',        // MathJax
  ],
  APP_TITLE:        'ExamBro — BKN E-Learning',
  APP_VERSION:      '1.0.5',
  MAX_VIOLATIONS:   3,
  FOCUS_CHECK_MS:   2000,
  LOADING_DELAY_MS: 1800,  // durasi splash screen
};
// ─────────────────────────────────────────────────────────────────────────────

let mainWindow     = null;
let psBlockerId    = null;
let violationCount = 0;
let examActive     = false;
let isNavigating   = false;   // FIX BKN-CAT: cegah white screen saat redirect
let isFocusing     = false;   // guard cegah infinite focus loop

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

// ── Sembunyikan taskbar & nonaktifkan Windows key ────────────────────────────
const { exec } = require('child_process');

function hideTaskbar() {
  const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TB { [DllImport("user32.dll")] public static extern IntPtr FindWindow(string a, string b); [DllImport("user32.dll")] public static extern int ShowWindow(IntPtr h, int n); public static void Hide(){ ShowWindow(FindWindow("Shell_TrayWnd",null),0); } }'; [TB]::Hide()`;
  exec(`powershell -WindowStyle Hidden -NonInteractive -Command "${ps}"`, () => {});
}

function showTaskbar() {
  const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TB { [DllImport("user32.dll")] public static extern IntPtr FindWindow(string a, string b); [DllImport("user32.dll")] public static extern int ShowWindow(IntPtr h, int n); public static void Show(){ ShowWindow(FindWindow("Shell_TrayWnd",null),5); } }'; [TB]::Show()`;
  exec(`powershell -WindowStyle Hidden -NonInteractive -Command "${ps}"`, () => {});
}

// Nonaktifkan Windows key menggunakan low-level keyboard hook (berlaku di Windows 11)
let winKeyBlockerProcess = null;

function disableWindowsKey() {
  // PowerShell script yang berjalan di background dan intercept Win key
  const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class WinKeyBlocker {
    private static IntPtr _hookID = IntPtr.Zero;
    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelKeyboardProc _proc = HookCallback;
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public System.Drawing.Point pt; }
    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x0100;
    const int WM_SYSKEYDOWN = 0x0104;
    const uint VK_LWIN = 0x5B;
    const uint VK_RWIN = 0x5C;
    public static void Start() {
        using (var curProcess = Process.GetCurrentProcess())
        using (var curModule = curProcess.MainModule) {
            _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
        }
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) != 0) {}
    }
    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
            var kb = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if (kb.vkCode == VK_LWIN || kb.vkCode == VK_RWIN) return (IntPtr)1;
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }
}
'@ -ReferencedAssemblies 'System.Windows.Forms','System.Drawing'
[WinKeyBlocker]::Start()
`.trim();

  const { spawn } = require('child_process');
  winKeyBlockerProcess = spawn('powershell', [
    '-WindowStyle', 'Hidden',
    '-NonInteractive',
    '-Command', psScript
  ], { detached: false, stdio: 'ignore' });
}

function enableWindowsKey() {
  if (winKeyBlockerProcess) {
    try { winKeyBlockerProcess.kill(); } catch(e) {}
    winKeyBlockerProcess = null;
  }
}

// ── Blokir gestur touchpad (3 jari & 4 jari) ──────────────────────────────────
let touchpadBlockerProcess = null;

function disableTouchpadGestures() {
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad'
if (Test-Path $regPath) {
  Set-ItemProperty -Path $regPath -Name 'ThreeFingerSlideEnabled' -Value 0 -Type DWord
  Set-ItemProperty -Path $regPath -Name 'FourFingerSlideEnabled' -Value 0 -Type DWord
}
`.trim();

  const { spawn } = require('child_process');
  touchpadBlockerProcess = spawn('powershell', [
    '-WindowStyle', 'Hidden',
    '-NonInteractive',
    '-Command', psScript
  ], { detached: false, stdio: 'ignore' });
}

function enableTouchpadGestures() {
  if (touchpadBlockerProcess) {
    try { touchpadBlockerProcess.kill(); } catch(e) {}
    touchpadBlockerProcess = null;
  }
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad'
if (Test-Path $regPath) {
  Set-ItemProperty -Path $regPath -Name 'ThreeFingerSlideEnabled' -Value 1 -Type DWord
  Set-ItemProperty -Path $regPath -Name 'FourFingerSlideEnabled' -Value 1 -Type DWord
}
`.trim();

  const { spawn } = require('child_process');
  spawn('powershell', [
    '-WindowStyle', 'Hidden',
    '-NonInteractive',
    '-Command', psScript
  ], { detached: true, stdio: 'ignore' });
}

// Paksa window overlay penuh — cegah taskbar "mengintip"
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// Disable DPI awareness override agar pixel mapping akurat di semua resolusi
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// ── Custom User-Agent (adopsi BKN-CAT) ───────────────────────────────────────
// Hapus "Electron/x.x.x" dari UA lalu tambahkan identifier ExamBro
// Ini yang dibaca PHP: strpos(HTTP_USER_AGENT, 'ExamBro') !== false
app.userAgentFallback = app.userAgentFallback
  .replace(/Electron\/[\d.]+\s*/, '')
  + ` ExamBro-SecureBrowser/${CONFIG.APP_VERSION}`;

// ── PERSIST COOKIES ANTAR SESI (untuk Remember Me) ───────────────────────────
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
      // Skip cookie yang sudah expired
      if (c.expirationDate && c.expirationDate < now) continue;
      const details = {
        url:    CONFIG.EXAM_URL,
        name:   c.name,
        value:  c.value,
        domain: c.domain,
        path:   c.path || '/',
        secure: c.secure || false,
        httpOnly: c.httpOnly || false,
      };
      if (c.expirationDate) details.expirationDate = c.expirationDate;
      session.defaultSession.cookies.set(details).catch(() => {});
    }
  } catch(e) {}
}

// ── INJECT HEADER X-ExamBro KE SEMUA REQUEST ─────────────────────────────────
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

// ── BUAT WINDOW ───────────────────────────────────────────────────────────────
function createWindow() {
  // Sembunyikan taskbar SEBELUM window dibuat — persis seperti BKN-CAT
  if (process.platform === 'win32') {
    hideTaskbar();
    disableWindowsKey();
    disableTouchpadGestures();
  }

  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    fullscreen:   true,
    kiosk:        true,
    frame:        false,
    alwaysOnTop:  true,
    resizable:    false,
    movable:      false,
    minimizable:  false,
    maximizable:  false,
    closable:     false,
    skipTaskbar:  true,
    hasShadow:    false,
    title:        CONFIG.APP_TITLE,
    icon:         path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    menuBarVisible:  false,
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

  // Set User-Agent eksplisit di webContents agar PHP bisa deteksi ExamBro via HTTP_USER_AGENT
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ExamBro-SecureBrowser/${CONFIG.APP_VERSION}`;
  mainWindow.webContents.setUserAgent(ua);

  // ── SPLASH SCREEN (adopsi BKN-CAT) ─────────────────────────────────────────
  // Tampilkan loading.html dulu, baru load URL asli setelah LOADING_DELAY_MS
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

  // FIX: Server-side HTTP redirect (Location header dari PHP login → dashboard)
  mainWindow.webContents.on('will-redirect', (e, url) => {
    if (!isAllowedUrl(url)) {
      e.preventDefault();
    } else {
      isNavigating = true; // tandai sedang redirect agar blur tidak kirim Escape
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
    // Deteksi concurrent session (login dari perangkat lain)
    if (url.includes('concurrent=1') || url.includes('reason=concurrent')) {
      showConcurrentDialog();
    }
  });

  mainWindow.webContents.on('did-navigate-in-page', (e, url) => {
    isNavigating = false;
    examActive = url.includes('/materi/pretest/') || url.includes('/materi/posttest/');
  });

  // Retry otomatis saat gagal load (adopsi BKN-CAT)
  mainWindow.webContents.on('did-fail-load', (e, code, desc, vurl) => {
    isNavigating = false;
    // code -3 = ERR_ABORTED (cancel oleh redirect), abaikan
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
    // Paksa balik fullscreen + kiosk jika entah bagaimana keluar
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setKiosk(true);
        mainWindow.setFullScreen(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.moveTop();
      }
    }, 50);
  });

  // ── Tangani blur (adopsi BKN-CAT dengan perbaikan) ────────────────────────
  // FIX: JANGAN kirim Escape saat isNavigating — ini penyebab white screen!
  mainWindow.on('blur', () => {
    if (isFocusing) return;
    isFocusing = true;
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.moveTop();
        // Kirim Escape hanya saat ujian aktif DAN tidak sedang navigasi/redirect
        if (examActive && !isNavigating) {
          mainWindow.webContents.send('exam-violation', 'window_blur');
        }
      }
      isFocusing = false;
    }, 80);
  });

  // ── Close → dialog konfirmasi (Alt+F4 masuk sini) ─────────────────────────
  let closeInProgress = false;

  mainWindow.on('close', (e) => {
    if (closeInProgress) return;
    e.preventDefault();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop();

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      closeInProgress = true;
      try {
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
          if (c === 1) { mainWindow.destroy(); app.quit(); }
        } else {
          const c = dialog.showMessageBoxSync(mainWindow, {
            type:      'question',
            buttons:   ['Tetap di Aplikasi', 'Keluar'],
            defaultId: 0,
            cancelId:  0,
            title:     'Konfirmasi Keluar',
            message:   'Keluar dari ExamBro?',
          });
          if (c === 1) { mainWindow.destroy(); app.quit(); }
        }
      } catch (err) {
        console.error('[ExamBro] Close dialog error:', err);
      } finally {
        closeInProgress = false;
      }
    }, 50);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC: Pelanggaran dari halaman web ─────────────────────────────────────────
ipcMain.on('exam-violation-report', (event, type) => {
  if (!examActive) return;
  violationCount++;
  console.log(`[ExamBro] Pelanggaran #${violationCount}: ${type}`);
  if (mainWindow) {
    mainWindow.webContents.send('exam-violation-count', violationCount);
    if (violationCount >= CONFIG.MAX_VIOLATIONS) {
      mainWindow.webContents.send('exam-force-submit', 'Terlalu banyak pelanggaran');
    }
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

// ── SHORTCUT BLOCKER ──────────────────────────────────────────────────────────
function registerShortcuts() {
  // Adopsi list lengkap dari BKN-CAT + tambahan
  const blocked = [
    // Windows system
    'Super+D', 'Super+L', 'Super+Tab', 'Super+E', 'Super+R',
    'Super+X', 'Super+S', 'Super+A', 'Super+M', 'Super+H',
    'Super+Shift+S', 'Super+I', 'Super',
    // Task switch (Alt+F4 dibiarkan → dialog keluar)
    'Alt+Tab', 'Alt+Shift+Tab', 'Alt+Escape', 'Ctrl+Escape',
    // Browser / dev tools
    'F11', 'F12', 'F5',
    'Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+F5',
    'Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+N',
    'Ctrl+Tab', 'Ctrl+Shift+Tab',
    'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C', 'Ctrl+U',
    'Ctrl+L', 'Ctrl+D', 'Ctrl+H', 'Ctrl+J', 'Ctrl+K',
    'Ctrl+P', 'Ctrl+S',
    // Screenshot / recording
    'PrintScreen', 'Alt+PrintScreen',
    'Super+Shift+S', 'Super+PrintScreen',
    // Task Manager
    'Ctrl+Shift+Escape',
    // Clipboard
    'Ctrl+C', 'Ctrl+V', 'Ctrl+X',
  ];

  blocked.forEach(sc => {
    try {
      globalShortcut.register(sc, () => {
        console.log('[ExamBro] Shortcut diblokir:', sc);
        if (examActive) handleViolation('shortcut_' + sc);
      });
    } catch (err) {
      // Ctrl+Alt+Del, dll tidak bisa diblokir di level app
    }
  });
}

// ── Helper: cek domain diizinkan ──────────────────────────────────────────────
function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    // file:// selalu diizinkan (untuk loading.html)
    if (parsed.protocol === 'file:') return true;
    return CONFIG.ALLOWED_DOMAINS.some(d =>
      parsed.hostname === d || parsed.hostname.endsWith('.' + d)
    );
  } catch {
    return false;
  }
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

  // Restore cookies dari sesi sebelumnya (untuk Remember Me)
  restoreCookies();

  // Setup header & filter SEBELUM createWindow
  setupExamBroHeaders();
  setupRequestFilter();
  createWindow();
  registerShortcuts();

  // Paksa fokus & alwaysOnTop — interval 2s
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  saveCookies(); // Simpan cookies sebelum tutup
  if (psBlockerId !== null) powerSaveBlocker.stop(psBlockerId);
  globalShortcut.unregisterAll();
  if (process.platform === 'win32') {
    showTaskbar();
    enableWindowsKey();
    enableTouchpadGestures();
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  saveCookies(); // Simpan cookies saat quit
  if (psBlockerId !== null) powerSaveBlocker.stop(psBlockerId);
  globalShortcut.unregisterAll();
  if (process.platform === 'win32') {
    showTaskbar();
    enableWindowsKey();
    enableTouchpadGestures();
  }
});
