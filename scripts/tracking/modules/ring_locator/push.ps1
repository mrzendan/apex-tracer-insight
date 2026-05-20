param(
  [Parameter(Mandatory=$true)][string]$Video,
  [Parameter(Mandatory=$true)][string]$Rings,
  [string]$Cuts = "",
  [string]$Minimap = "34,775,300,300",
  [string]$Out = "scripts/tracking/modules/ring_locator/reports",
  [switch]$SyncUI,
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
  "scripts/tracking/modules/ring_locator/ring_locator.py",
  "--video", $Video,
  "--rings", $Rings,
  "--minimap", $Minimap,
  "--out", $Out
)
if ($Cuts) { $argsList += @("--cuts", $Cuts) }
& python @argsList
if ($LASTEXITCODE -ne 0) { throw "ring_locator упал (rc=$LASTEXITCODE)" }
if ($SyncUI) {
  & python "scripts/tracking/modules/hud_read/sync_to_ui.py" `
    --ring-geometry "$Out/ring_geometry.json"
  if ($LASTEXITCODE -ne 0) { throw "sync_to_ui упал (rc=$LASTEXITCODE)" }
}
if ($NoPush) { return }
git add $Out
git commit -m "ring_locator: run $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
if ($LASTEXITCODE -eq 0) { git push }
