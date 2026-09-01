# Script untuk convert logo PNG ke ICO untuk icon aplikasi ExamBro
# Memerlukan .NET System.Drawing

Add-Type -AssemblyName System.Drawing

$pngPath = Join-Path $PSScriptRoot "assets\logo-sekolah.png"
$icoPath = Join-Path $PSScriptRoot "assets\icon.ico"

if (-not (Test-Path $pngPath)) {
    Write-Host "❌ File logo-sekolah.png tidak ditemukan!" -ForegroundColor Red
    exit 1
}

try {
    # Load PNG
    $png = [System.Drawing.Image]::FromFile($pngPath)
    
    # Buat bitmap dengan ukuran 256x256 (ukuran standar ICO)
    $size = 256
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    
    # Draw PNG ke bitmap
    $graphics.DrawImage($png, 0, 0, $size, $size)
    $graphics.Dispose()
    
    # Save sebagai ICO
    $ms = New-Object System.IO.MemoryStream
    $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Close()
    
    # ICO file format sederhana (single icon 256x256)
    $header = [byte[]](0, 0, 1, 0, 1, 0) # ICONDIR header
    $entry = [byte[]](
        0,      # width (256 ditulis sebagai 0 di ICO format)
        0,      # height (256 ditulis sebagai 0)
        0,      # color count
        0,      # reserved
        1, 0,   # color planes
        32, 0,  # bits per pixel
        ($bytes.Length -band 0xFF), ($bytes.Length -shr 8 -band 0xFF), 
        ($bytes.Length -shr 16 -band 0xFF), ($bytes.Length -shr 24 -band 0xFF), # image size
        22, 0, 0, 0  # image offset
    )
    
    [System.IO.File]::WriteAllBytes($icoPath, $header + $entry + $bytes)
    
    $png.Dispose()
    $bitmap.Dispose()
    
    Write-Host "✅ Icon berhasil dibuat: $icoPath" -ForegroundColor Green
    Write-Host "   Ukuran: $([Math]::Round((Get-Item $icoPath).Length / 1KB, 2)) KB" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Gagal convert logo ke ICO: $_" -ForegroundColor Red
    exit 1
}
