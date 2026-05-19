# Быстрый цикл отладки: прогнать debug_register.py и запушить результат в git,
# чтобы Lovable-агент увидел свежие картинки и report.txt.
#
# Использование (из корня репо):
#   powershell -ExecutionPolicy Bypass -File scripts/tracking/debug.ps1 -Video scripts/tracking/video.mp4
#
# Параметры:
#   -Video   путь к mp4 (обязательно)
#   -N       сколько кадров пробовать (по умолчанию 6)
#   -Config  путь к конфигу (по умолчанию scripts/tracking/config.example.yaml)
#   -Out     папка вывода (по умолчанию scripts/tracking/debug_out)
#   -NoPush  не делать git push (только локальный коммит)

param(
  [Parameter(Mandatory=$true)][string]$Video,
  [int]$N = 6,
  [string]$Config = "scripts/tracking/config.example.yaml",
  [string]$Out = "scripts/tracking/debug_out",
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

# UTF-8 вывод (иначе кириллица превращается в Р·Р°РїСѓСЃРєР°СЋ)
chcp 65001 > $null
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 1. Найти корень репо (там, где .git)
$repo = (git rev-parse --show-toplevel).Trim()
if (-not $repo) { throw "Не вижу git-репозитория. Сначала подключи проект к GitHub в Lovable." }
Set-Location $repo

# 2. Почистить старый debug_out, чтобы не таскать мусор
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }

# 3. Запустить отладку
Write-Host "[debug] запускаю debug_register.py..." -ForegroundColor Cyan
python scripts/tracking/debug_register.py --video $Video --config $Config --out $Out --n $N
if ($LASTEXITCODE -ne 0) { throw "debug_register.py упал" }

# 4. Размер на всякий случай — не пушим если вдруг гигабайты
$size = (Get-ChildItem $Out -Recurse | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("[debug] debug_out весит {0:N1} MB" -f $size) -ForegroundColor Cyan
if ($size -gt 50) {
  Write-Warning "debug_out больше 50 MB. Уменьши -N или сожми картинки перед коммитом."
  return
}

# 5. Коммит + пуш
git add $Out
$msg = "debug: tracking-lab run $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git commit -m $msg | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[debug] нечего коммитить (нет изменений)" -ForegroundColor Yellow
  return
}

if (-not $NoPush) {
  Write-Host "[debug] git push..." -ForegroundColor Cyan
  git push
}

Write-Host "[ok] готово. Скажи агенту в чате: 'посмотри scripts/tracking/debug_out/report.txt'" -ForegroundColor Green