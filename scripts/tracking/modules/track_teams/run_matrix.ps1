# Прогоняет 5 вариантов track_teams.py на одно видео и складывает
# tracks_<tag>.json + run_<tag>.log в reports/matrix/.
# По умолчанию — последовательно (на одной машине параллельный SIFT упрётся в CPU).
# Параметр -Parallel запускает все 5 одновременно через Start-Job.
param(
  [Parameter(Mandatory=$true)][string]$Video,
  [double]$Start = 0,
  [double]$End = -1,
  [int]$FrameStep = 0,
  [string]$Anchors = "scripts/tracking/modules/motion_detect/reports/motion_tracks.json",
  [string]$Eliminations = "scripts/tracking/modules/hud_read/reports/eliminations.json",
  [switch]$Parallel
)
$ErrorActionPreference = "Stop"
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8 = "1"
$repo = (git rev-parse --show-toplevel).Trim()
Set-Location $repo

$matrix = @(
  @{ tag = "baseline";          config = "scripts/tracking/modules/track_teams/configs/da.baseline.yaml" },
  @{ tag = "detect_first";      config = "scripts/tracking/modules/track_teams/configs/da.detect_first.yaml" },
  @{ tag = "color_first";       config = "scripts/tracking/modules/track_teams/configs/da.color_first.yaml" },
  @{ tag = "motion_first";      config = "scripts/tracking/modules/track_teams/configs/da.motion_first.yaml" },
  @{ tag = "strict_shape";      config = "scripts/tracking/modules/track_teams/configs/da.strict_shape.yaml" },
  @{ tag = "aggressive_retire"; config = "scripts/tracking/modules/track_teams/configs/da.aggressive_retire.yaml" }
)

$outDir = "scripts/tracking/modules/track_teams/reports/matrix"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Invoke-One($tag, $config) {
  $out = "$outDir/tracks_$tag.json"
  $log = "$outDir/run_$tag.log"
  $args = @("--video", $Video, "--config", $config, "--out", $out,
            "--start", $Start, "--end", $End,
            "--anchors", $Anchors, "--eliminations", $Eliminations)
  if ($FrameStep -gt 0) { $args += @("--frame-step", $FrameStep) }
  Write-Host "[matrix] $tag → $out" -ForegroundColor Cyan
  & python scripts/tracking/modules/track_teams/track_teams.py @args 2>&1 |
    Tee-Object -FilePath $log | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[matrix] $tag FAILED — см. $log" -ForegroundColor Red
  } else {
    Write-Host "[matrix] $tag OK" -ForegroundColor Green
  }
}

if ($Parallel) {
  $jobs = @()
  foreach ($m in $matrix) {
    $jobs += Start-Job -ScriptBlock {
      param($repo, $tag, $config, $Video, $Start, $End, $FrameStep, $Anchors, $Eliminations, $outDir)
      Set-Location $repo
      $env:PYTHONUTF8 = "1"
      $out = "$outDir/tracks_$tag.json"
      $log = "$outDir/run_$tag.log"
      $args = @("--video", $Video, "--config", $config, "--out", $out,
                "--start", $Start, "--end", $End,
                "--anchors", $Anchors, "--eliminations", $Eliminations)
      if ($FrameStep -gt 0) { $args += @("--frame-step", $FrameStep) }
      & python scripts/tracking/modules/track_teams/track_teams.py @args *>&1 > $log
    } -ArgumentList $repo, $m.tag, $m.config, $Video, $Start, $End, $FrameStep, $Anchors, $Eliminations, $outDir
  }
  Write-Host "[matrix] запущено $($jobs.Count) задач параллельно — жду..." -ForegroundColor Yellow
  $jobs | Wait-Job | Out-Null
  $jobs | Receive-Job
  $jobs | Remove-Job
} else {
  foreach ($m in $matrix) { Invoke-One $m.tag $m.config }
}

# Сводная таблица.
python scripts/tracking/modules/track_teams/compare_matrix.py --dir $outDir