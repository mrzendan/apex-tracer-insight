# Поиск точных кадров cut'ов камеры обсервера.
# Использование:
#   powershell -ExecutionPolicy Bypass -File scripts/tracking/cuts.ps1 -Video scripts/tracking/video.mp4
#
# Параметры:
#   -Video      путь к mp4 (обязательно)
#   -Coarse     грубый шаг в кадрах (по умолчанию 600)
#   -Fine       шаг отката для уточнения (по умолчанию 10)
#   -Threshold  порог Δpan в канонических пикселях (по умолчанию 150)
#   -Start      старт в секундах (по умолчанию 0)
#   -End        конец в секундах (-1 = до конца)
#   -Config     путь к конфигу
#   -Out        папка вывода
#   -NoPush     не пушить, только локальный коммит

param(
  [Parameter(Mandatory=$true)][string]$Video,
  [int]$Coarse = 300,
  [int]$Fine = 10,
  [double]$Threshold = 90,
  [double]$Start = 0,
  [double]$End = -1,
  [string]$Config = "scripts/tracking/config.example.yaml",
  [string]$Out = "scripts/tracking/cuts_out",
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"
chcp 65001 > $null
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repo = (git rev-parse --show-toplevel).Trim()
if (-not $repo) { throw "Не вижу git-репозитория." }
Set-Location $repo

if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }

Write-Host "[cuts] запускаю find_cuts.py (coarse=$Coarse, fine=$Fine, threshold=$Threshold)..." -ForegroundColor Cyan
python scripts/tracking/find_cuts.py `
  --video $Video --config $Config --out $Out `
  --coarse $Coarse --fine $Fine --threshold $Threshold `
  --start $Start --end $End
if ($LASTEXITCODE -ne 0) { throw "find_cuts.py упал" }

$size = (Get-ChildItem $Out -Recurse | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("[cuts] cuts_out весит {0:N1} MB" -f $size) -ForegroundColor Cyan
if ($size -gt 50) {
  Write-Warning "cuts_out больше 50 MB. Не коммичу."
  return
}

git add $Out
$msg = "cuts: scan $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git commit -m $msg | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[cuts] нечего коммитить" -ForegroundColor Yellow
  return
}

if (-not $NoPush) {
  Write-Host "[cuts] git push..." -ForegroundColor Cyan
  git push
}

Write-Host "[ok] готово. Скажи агенту: 'посмотри scripts/tracking/cuts_out/cuts.txt'" -ForegroundColor Green