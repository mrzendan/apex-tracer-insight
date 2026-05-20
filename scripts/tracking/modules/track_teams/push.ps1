# track_teams: запустить track_teams.py и (опционально) запушить reports/ в git.
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
  Write-Host "[track_teams] no anchors file (looked at: $Anchors) — стартую без motion-якорей" -ForegroundColor Yellow
}
& python scripts/tracking/modules/track_teams/track_teams.py @args
if ($LASTEXITCODE -ne 0) { throw "track_teams.py упал" }
if ($NoPush) { return }
git add (Split-Path $Out -Parent)
git commit -m "track_teams: run $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
if ($LASTEXITCODE -eq 0) { git push }
