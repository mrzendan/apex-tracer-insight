# Прогнать motion_detect.py и запушить motion_out в git,
# чтобы Lovable-агент увидел свежий report.txt + overlays.
#
# Использование (из корня репо):
#   powershell -ExecutionPolicy Bypass -File scripts/tracking/motion.ps1 -Video scripts/tracking/game.mp4
#
# Параметры:
#   -Video         путь к mp4 (обязательно)
#   -Cuts          cuts.json (по умолчанию scripts/tracking/cuts_out/cuts.json)
#   -HsvPresets    HSV пресеты (по умолчанию scripts/tracking/configs/hsv_presets.worlds-edge.json)
#   -Zones         zones.vod.json (по умолчанию scripts/tracking/configs/zones.vod.json)
#   -ZoneTag       тег зоны (по умолчанию minimap)
#   -StartSec      с какой секунды (по умолчанию 60)
#   -Window        кадров в окне (по умолчанию 300)
#   -Step          шаг между кадрами (по умолчанию 10)
#   -StaticThresh  px ниже = статика (по умолчанию 3)
#   -LinkDist      px макс. сдвиг между выборками (по умолчанию 80)
#   -Out           папка вывода (по умолчанию scripts/tracking/motion_out)
#   -NoPush        не делать git push (только локальный коммит)

param(
  [Parameter(Mandatory=$true)][string]$Video,
  [string]$Cuts = "scripts/tracking/cuts_out/cuts.json",
  [string]$HsvPresets = "scripts/tracking/configs/hsv_presets.worlds-edge.json",
  [string]$Zones = "scripts/tracking/configs/zones.vod.json",
  [string]$ZoneTag = "minimap",
  [double]$StartSec = 60,
  [int]$Window = 300,
  [int]$Step = 10,
  [double]$StaticThresh = 3,
  [double]$LinkDist = 80,
  [string]$Out = "scripts/tracking/motion_out",
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"
chcp 65001 > $null
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

$repo = (git rev-parse --show-toplevel).Trim()
if (-not $repo) { throw "Не вижу git-репозитория." }
Set-Location $repo

# Чистим старый motion_out, но сохраняем .gitkeep'ы
if (Test-Path $Out) {
  Get-ChildItem $Out -Recurse -Force | Where-Object { $_.Name -ne ".gitkeep" } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $Out | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Out "overlays") | Out-Null

$logPath = Join-Path $Out "run.log"

Write-Host "[motion] запускаю motion_detect.py (window=$Window step=$Step static<$StaticThresh link=$LinkDist)..." -ForegroundColor Cyan
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& python scripts/tracking/motion_detect.py `
  --video $Video `
  --cuts $Cuts `
  --hsv-presets $HsvPresets `
  --zones $Zones `
  --zone-tag $ZoneTag `
  --start-sec $StartSec `
  --window $Window --step $Step `
  --static-thresh $StaticThresh --link-dist $LinkDist `
  --out-dir $Out 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $logPath
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($code -ne 0) {
  Write-Host "[motion] motion_detect.py упал (exit=$code). Последние строки лога:" -ForegroundColor Red
  Get-Content $logPath -Tail 40
  throw "motion_detect.py упал"
}

$size = (Get-ChildItem $Out -Recurse | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("[motion] motion_out весит {0:N1} MB" -f $size) -ForegroundColor Cyan
if ($size -gt 50) {
  Write-Warning "motion_out больше 50 MB. Не коммичу. Уменьши -Window или сожми overlays."
  return
}

git add $Out
$msg = "motion: scan $(Get-Date -Format 'yyyy-MM-dd HH:mm') (win=$Window step=$Step static<$StaticThresh link=$LinkDist)"
git commit -m $msg | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[motion] нечего коммитить" -ForegroundColor Yellow
  return
}

if (-not $NoPush) {
  Write-Host "[motion] git push..." -ForegroundColor Cyan
  git push
}

Write-Host "[ok] готово. Скажи агенту: 'посмотри scripts/tracking/motion_out/report.txt'" -ForegroundColor Green