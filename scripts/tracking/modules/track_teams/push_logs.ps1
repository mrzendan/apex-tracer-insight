# push_logs.ps1 — собрать артефакты track_teams + motion_detect и запушить
# их в git, чтобы Lovable-агент увидел свежие отчёты.
#
# Использование (из корня репо):
#   powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\track_teams\push_logs.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\track_teams\push_logs.ps1 -NoPush
#
# Что коммитим:
#   scripts/tracking/modules/track_teams/reports/tracks.json
#   scripts/tracking/modules/track_teams/reports/tracks.slots.json
#   scripts/tracking/modules/track_teams/reports/eval_id_switches.json
#   scripts/tracking/modules/track_teams/reports/eval_id_switches.txt
#   scripts/tracking/modules/track_teams/reports/run.log
#   scripts/tracking/modules/motion_detect/reports/report.txt
#   scripts/tracking/modules/motion_detect/reports/motion_tracks.json
#
# Тяжёлые overlay/*.png НЕ коммитим (слишком большие).

param(
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8 = "1"

$repo = (git rev-parse --show-toplevel).Trim()
if (-not $repo) { throw "Не вижу git-репозитория." }
Set-Location $repo

$paths = @(
  "scripts/tracking/modules/track_teams/reports/tracks.json",
  "scripts/tracking/modules/track_teams/reports/tracks.slots.json",
  "scripts/tracking/modules/track_teams/reports/eval_id_switches.json",
  "scripts/tracking/modules/track_teams/reports/eval_id_switches.txt",
  "scripts/tracking/modules/track_teams/reports/run.log",
  "scripts/tracking/modules/motion_detect/reports/report.txt",
  "scripts/tracking/modules/motion_detect/reports/motion_tracks.json"
)

$found = @()
$missing = @()
foreach ($p in $paths) {
  if (Test-Path $p) {
    $sz = (Get-Item $p).Length / 1KB
    Write-Host ("  + {0,-70} {1,8:N1} KB" -f $p, $sz) -ForegroundColor Green
    $found += $p
  } else {
    Write-Host ("  - {0,-70} (нет)" -f $p) -ForegroundColor DarkYellow
    $missing += $p
  }
}

if ($found.Count -eq 0) {
  throw "Нечего пушить — все ожидаемые отчёты отсутствуют. Запусти сначала push.ps1 трекеров."
}

# Сводный размер
$totalKb = 0
foreach ($p in $found) { $totalKb += (Get-Item $p).Length / 1KB }
Write-Host ("[push_logs] всего {0:N1} KB в {1} файлах" -f $totalKb, $found.Count) -ForegroundColor Cyan
if ($totalKb -gt 20480) {
  Write-Warning "Артефакты больше 20 MB — не коммичу, разбирайся почему так разрослось."
  return
}

if ($NoPush) {
  Write-Host "[ok] локально готово (no-push)." -ForegroundColor Green
  return
}

git add @found
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$msg = "track_teams: logs $stamp ($($found.Count) files, $([int]$totalKb) KB)"
git commit -m $msg | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[push_logs] нечего коммитить (нет изменений)" -ForegroundColor Yellow
  return
}

Write-Host "[push_logs] git push..." -ForegroundColor Cyan
git push

Write-Host "[ok] готово. Скажи агенту: 'посмотри scripts/tracking/modules/track_teams/reports/'" -ForegroundColor Green
if ($missing.Count -gt 0) {
  Write-Host "[note] не нашлись (это ок, если ещё не запускал eval):" -ForegroundColor DarkYellow
  foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor DarkYellow }
}