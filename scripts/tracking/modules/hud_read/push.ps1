# hud_read: скелет. Запустить hud_read.py и (опционально) запушить reports/.
param(
  [Parameter(Mandatory=$true)][string]$Video,
  [string]$Zones = "scripts/tracking/modules/hud_read/configs/zones.vod2.json",
  [int]$FrameStep = 600,
  [double]$StartSec = 0,
  [string]$OcrLang = "eng",
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
& python scripts/tracking/modules/hud_read/hud_read.py `
  --video $Video --zones $Zones --frame-step $FrameStep `
  --start-sec $StartSec --ocr-lang $OcrLang --out $Out
if ($LASTEXITCODE -ne 0) { throw "hud_read.py упал" }
if ($NoPush) { return }
git add $Out
git commit -m "hud_read: run $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
if ($LASTEXITCODE -eq 0) { git push }
