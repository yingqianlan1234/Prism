param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$OutIco,
  [Parameter(Mandatory=$true)][string]$PreviewDir
)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $PreviewDir)) { New-Item -ItemType Directory -Path $PreviewDir -Force | Out-Null }

$src = [System.Drawing.Image]::FromFile($Source)

function New-RoundIcon {
  param([int]$S, [double]$RadiusRatio, [double]$ZoomBoost, [double]$StrokePx)
  $bmp = [System.Drawing.Bitmap]::new($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $r = [float]([Math]::Max(1.0, $S * $RadiusRatio))
  $d = [float](2 * $r)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc([float]($S - $d), 0, $d, $d, 270, 90)
  $path.AddArc([float]($S - $d), [float]($S - $d), $d, $d, 0, 90)
  $path.AddArc(0, [float]($S - $d), $d, $d, 90, 90)
  $path.CloseFigure()

  $g.SetClip($path)
  $zoom = 1.0 + $ZoomBoost
  $w = [float]($src.Width * $zoom)
  $h = [float]($src.Height * $zoom)
  $x = [float](($S - $w) / 2.0)
  $y = [float](($S - $h) / 2.0)
  $dst = [System.Drawing.Rectangle]::new(0, 0, $S, $S)
  $srect = [System.Drawing.Rectangle]::new(0, 0, [int]$src.Width, [int]$src.Height)
  $g.DrawImage($src, $dst, $srect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.ResetClip()

  if ($StrokePx -gt 0) {
    $alpha = if ($S -le 24) { 90 } elseif ($S -le 48) { 70 } else { 52 }
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb($alpha, 242, 233, 226), [float]$StrokePx)
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($pen, $path)
    $pen.Dispose()
  }
  $g.Dispose()
  $path.Dispose()
  return $bmp
}

$plan = @(
  @{ s = 16;  rr = 0.30; zoom = 0.00; stroke = 0.8 },
  @{ s = 20;  rr = 0.30; zoom = 0.00; stroke = 0.9 },
  @{ s = 24;  rr = 0.29; zoom = 0.00; stroke = 1.0 },
  @{ s = 32;  rr = 0.29; zoom = 0.00; stroke = 1.0 },
  @{ s = 40;  rr = 0.28; zoom = 0.00; stroke = 1.2 },
  @{ s = 48;  rr = 0.28; zoom = 0.00; stroke = 1.4 },
  @{ s = 64;  rr = 0.27; zoom = 0.00; stroke = 1.6 },
  @{ s = 128; rr = 0.26; zoom = 0.00; stroke = 0.0 },
  @{ s = 256; rr = 0.25; zoom = 0.00; stroke = 0.0 }
)

$images = @()
foreach ($p in $plan) {
  $b = New-RoundIcon -S $p.s -RadiusRatio $p.rr -ZoomBoost $p.zoom -StrokePx $p.stroke
  $b.Save((Join-Path $PreviewDir ("icon-{0}.png" -f $p.s)), [System.Drawing.Imaging.ImageFormat]::Png)
  $ms = [System.IO.MemoryStream]::new()
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += [pscustomobject]@{ Size = [int]$p.s; Bytes = $ms.ToArray() }
  $ms.Dispose()
  $b.Dispose()
}

$out = [System.IO.MemoryStream]::new()
$bw = [System.IO.BinaryWriter]::new($out)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($img in $images) {
  $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$img.Bytes.Length)
  $bw.Write([UInt32]$offset)
  $offset += $img.Bytes.Length
}
foreach ($img in $images) { $bw.Write([byte[]]$img.Bytes) }
$bw.Flush()
$bytes = $out.ToArray()
$bw.Dispose()
$out.Dispose()
[System.IO.File]::WriteAllBytes($OutIco, $bytes)
$src.Dispose()

Write-Host ("ICO: {0} bytes, {1} entries" -f $bytes.Length, $images.Count)
for ($i = 0; $i -lt $images.Count; $i++) {
  $o = 6 + 16 * $i
  $dim = if ($bytes[$o] -eq 0) { 256 } else { $bytes[$o] }
  $len = [BitConverter]::ToUInt32($bytes, $o + 8)
  $off = [BitConverter]::ToUInt32($bytes, $o + 12)
  $sig = if ($len -gt 8) { [System.Text.Encoding]::ASCII.GetString($bytes, $off, 4) } else { '' }
  Write-Host ("  {0}x{0} bytes={1} sig={2}" -f $dim, $len, $sig)
}
