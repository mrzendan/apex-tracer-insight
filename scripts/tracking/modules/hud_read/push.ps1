# hud_read: скелет. Запустить hud_read.py и (опционально) запушить reports/.
param(
  [Parameter(Mandatory=$true)][string]$Video,
  [string]$Zones = "scripts/tracking/configs/zones.vod.json",
  [int]$FrameStep = 600,
  [double]$StartSec = 0,
  [double]$EndSec = 0,
  [string]$OcrLang = "eng",
  [string]$TessCmd = "",
  [int]$OverlayEvery = 1,
  [int]$CropFirstN = 3,
  [string]$Out = "scripts/tracking/modules/hud_read/reports",
  [switch]$NoPush
)
$ErrorActionPreference = "Stop"
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8 = "1"
$repo = (git rev-parse --show-toplevel).Trim()
Set-Location $repo
if (Test-Path $Out) {
  Get-ChildItem $Out -Recurse -Force | Where-Object { $_.Name -ne ".gitkeep" } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$argsList = @(
  "scripts/tracking/modules/hud_read/hud_read.py",
  "--video", $Video,
  "--zones", $Zones,
  "--frame-step", $FrameStep,
  "--start-sec", $StartSec,
  "--end-sec", $EndSec,
  "--ocr-lang", $OcrLang,
  "--overlay-every", $OverlayEvery,
  "--crop-first-n", $CropFirstN,
  "--out", $Out
)
if ($TessCmd) { $argsList += @("--tess-cmd", $TessCmd) }
& python @argsList
if ($LASTEXITCODE -ne 0) { throw "hud_read.py упал" }
if ($NoPush) { return }
git add $Out
git commit -m "hud_read: run $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
if ($LASTEXITCODE -eq 0) { git push }
