# Runs N variants of track_teams.py on one video and stores
# tracks_<tag>.json + run_<tag>.log under reports/matrix/.
# Default is sequential. Use -Parallel to run all via Start-Job.
param(
  [Parameter(Mandatory=$true)][string]$Video,
  [double]$Start = 0,
  [double]$End = -1,
  [int]$FrameStep = 0,
  [string]$Anchors = "scripts/tracking/modules/motion_detect/reports/motion_tracks.json",
  [string]$Eliminations = "scripts/tracking/modules/hud_read/reports/eliminations.json",
  [switch]$Sequential
)
$ErrorActionPreference = "Stop"
# Параллельный режим по умолчанию; -Sequential форсирует последовательный.
$Parallel = -not $Sequential
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
  $extra = ""
  if ($FrameStep -gt 0) { $extra = " --frame-step $FrameStep" }
  # Запускаем через cmd /c, чтобы stderr был обычным текстом и PS не красил его в красное.
  $cmd = "python scripts/tracking/modules/track_teams/track_teams.py --video `"$Video`" --config `"$config`" --out `"$out`" --start $Start --end $End --anchors `"$Anchors`" --eliminations `"$Eliminations`"$extra 2>&1"
  Write-Host "[matrix] $tag -> $out" -ForegroundColor Cyan
  $ErrorActionPreference = "Continue"
  cmd /c $cmd | Tee-Object -FilePath $log
  $ErrorActionPreference = "Stop"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[matrix] $tag FAILED - see $log" -ForegroundColor Red
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
      $pyArgs = @("scripts/tracking/modules/track_teams/track_teams.py",
                  "--video", $Video, "--config", $config, "--out", $out,
                  "--start", $Start, "--end", $End,
                  "--anchors", $Anchors, "--eliminations", $Eliminations)
      if ($FrameStep -gt 0) { $pyArgs += @("--frame-step", $FrameStep) }
      $extra = ""
      if ($FrameStep -gt 0) { $extra = " --frame-step $FrameStep" }
      $cmd = "python scripts/tracking/modules/track_teams/track_teams.py --video `"$Video`" --config `"$config`" --out `"$out`" --start $Start --end $End --anchors `"$Anchors`" --eliminations `"$Eliminations`"$extra > `"$log`" 2>&1"
      cmd /c $cmd
    } -ArgumentList $repo, $m.tag, $m.config, $Video, $Start, $End, $FrameStep, $Anchors, $Eliminations, $outDir
  }
  Write-Host "[matrix] started $($jobs.Count) parallel jobs - waiting..." -ForegroundColor Yellow
  $jobs | Wait-Job | Out-Null
  $jobs | Receive-Job
  $jobs | Remove-Job
} else {
  foreach ($m in $matrix) { Invoke-One $m.tag $m.config }
}

# Summary table.
python scripts/tracking/modules/track_teams/compare_matrix.py --dir $outDir
