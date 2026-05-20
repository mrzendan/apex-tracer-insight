# track_teams: run track_teams.py and (optionally) push reports/ to git.
param(
  [Parameter(Mandatory=$true)][string]$Video,
  [string]$Config = "scripts/tracking/modules/track_teams/config.example.yaml",
  [string]$Out = "scripts/tracking/modules/track_teams/reports/tracks.json",
  [string]$Anchors = "scripts/tracking/modules/motion_detect/reports/motion_tracks.json",
  [int]$FrameStep = 0,
  [double]$Start = 0,
  [double]$End = -1,
  [switch]$NoPush
)
$ErrorActionPreference = "Stop"
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8 = "1"
$repo = (git rev-parse --show-toplevel).Trim()
Set-Location $repo
$args = @("--video", $Video, "--config", $Config, "--out", $Out, "--start", $Start, "--end", $End)
if ($FrameStep -gt 0) { $args += @("--frame-step", $FrameStep) }
if ($Anchors -and (Test-Path $Anchors)) {
  $args += @("--anchors", $Anchors)
  Write-Host "[track_teams] using anchors: $Anchors" -ForegroundColor Cyan
} else {
  Write-Host "[track_teams] no anchors file (looked at: $Anchors) - starting without motion anchors" -ForegroundColor Yellow
}
$logPath = Join-Path (Split-Path $Out -Parent) "run.log"
New-Item -ItemType Directory -Force -Path (Split-Path $logPath -Parent) | Out-Null
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& python scripts/tracking/modules/track_teams/track_teams.py @args 2>&1 |
  ForEach-Object { "$_" } | Tee-Object -FilePath $logPath
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($code -ne 0) {
  Write-Host "[track_teams] failed (exit=$code). Log tail:" -ForegroundColor Red
  Get-Content $logPath -Tail 40
  throw "track_teams.py failed"
}
if ($NoPush) { return }
git add (Split-Path $Out -Parent)
git commit -m "track_teams: run $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
if ($LASTEXITCODE -eq 0) { git push }
