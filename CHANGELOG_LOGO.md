# Changelog: Logo Sekolah di ExamBro

## v1.0.5 - Update Logo Sekolah (31 Agustus 2026)

### ✅ Perubahan

1. **Splash Screen Loading**
   - Logo sekolah (SMA Bina Kasih Nusantara) sekarang ditampilkan di splash screen saat ExamBro pertama kali dibuka
   - Ukuran logo diperbesar (120x120px) dengan background putih lebih jelas
   - Logo sekarang menggunakan file: `assets/logo-sekolah.png`

2. **Icon Aplikasi**
   - Icon aplikasi (.ico) diupdate menggunakan logo sekolah
   - Icon muncul di:
     - Taskbar Windows saat aplikasi berjalan
     - File explorer (icon .exe)
     - Alt+Tab switcher
     - Window title bar (jika ada)

3. **File yang Ditambahkan/Diubah**
   - `assets/logo-sekolah.png` - Logo sekolah untuk splash screen
   - `assets/icon.png` - Logo sekolah versi PNG
   - `assets/icon.ico` - Logo sekolah versi ICO (untuk aplikasi Windows)
   - `assets/loading.html` - Diupdate untuk menampilkan logo sekolah
   - `convert_logo_to_ico.ps1` - Script PowerShell untuk convert PNG → ICO

### 📦 Build

```bash
# Rebuild ExamBro dengan logo baru
npm run build:win

# Buat ZIP untuk distribusi
npm run build:win:zip
```

### 🔄 Cara Update Logo di Masa Depan

Jika ingin mengganti logo sekolah:

1. Ganti file `assets/logo-sekolah.png` dengan logo baru
   - Format: PNG dengan background transparan
   - Ukuran recommended: 512x512px atau 1024x1024px
   - Ratio: 1:1 (persegi)

2. Jalankan script convert logo ke ICO:
   ```powershell
   powershell -ExecutionPolicy Bypass -File convert_logo_to_ico.ps1
   ```

3. Rebuild aplikasi:
   ```bash
   npm run build:win:zip
   ```

4. Distribusikan file ZIP baru ke siswa

### 🎨 Preview

**Splash Screen:**
- Background: Gradient biru (sesuai tema BKN)
- Logo: Putih dengan border, ukuran 120x120px
- Teks: "ExamBro" + "SMA Bina Kasih Nusantara"
- Loading bar: Animasi biru
- Security badge: "Secure Browser — Sesi Ujian Aktif"

**Durasi Splash:** 1.8 detik sebelum load halaman aktivasi

### 📝 Catatan

- Logo otomatis di-cache oleh Electron, jadi perubahan langsung terlihat di build baru
- Tidak perlu uninstall/reinstall jika hanya update logo
- Siswa cukup extract dan jalankan ExamBro.exe yang baru
