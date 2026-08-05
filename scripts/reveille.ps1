<#
.SYNOPSIS
  Start / stop / restart / status the Reveille control plane on this machine.

.DESCRIPTION
  The control plane is the always-on set: the orchestrator (the Discord bot) plus
  one agent per target — Palworld :8300, Satisfactory :8301 (games), and VLC :8302
  (media). This script only manages those node processes.

  It does NOT touch the TARGETS themselves — the game servers are started/stopped
  from Discord (/start <game>, /stop <game>), and VLC is opened by the operator and
  paused/resumed from Discord (/pause, /play). Stopping an agent never stops its
  target.

.EXAMPLE
  ./scripts/reveille.ps1 start      # launch all four, each in its own window
  ./scripts/reveille.ps1 status     # what's up
  ./scripts/reveille.ps1 stop       # stop all four (targets keep running)
  ./scripts/reveille.ps1 restart
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'restart', 'status')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
# scripts/ sits one level under the repo root; everything runs from the root so the
# relative --env-file paths resolve.
$root = Split-Path -Parent $PSScriptRoot

# The long-running services: label, its env file, its entry script, its port.
$services = @(
  [pscustomobject]@{ Name = 'palworld-agent';     Env = 'agent/.env.palworld';     Script = 'agent/src/index.ts';        Port = 8300 }
  [pscustomobject]@{ Name = 'satisfactory-agent'; Env = 'agent/.env.satisfactory'; Script = 'agent/src/index.ts';        Port = 8301 }
  [pscustomobject]@{ Name = 'vlc-agent';          Env = 'agent/.env.vlc';          Script = 'agent/src/index.ts';        Port = 8302 }
  [pscustomobject]@{ Name = 'orchestrator';       Env = 'orchestrator/.env';       Script = 'orchestrator/src/index.ts'; Port = $null }
)

# Match ONLY Reveille's own processes — both the node servers and the powershell
# windows hosting them — by their command line (entry script + one of our env
# files). Deliberately specific, so `stop` can never hit an unrelated node process.
function Find-ReveilleProcs {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'powershell.exe'" |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -match 'src/index\.ts' -and
      $_.CommandLine -match '(\.env\.palworld|\.env\.satisfactory|\.env\.vlc|orchestrator[\\/]\.env)'
    }
}

# Is this service already up? An agent by its listening port; the orchestrator (no
# port) by its running node process. Shared by `start` (skip) and `status` (report).
function Test-ServiceUp($s) {
  if ($null -ne $s.Port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $s.Port -ErrorAction SilentlyContinue)
  }
  return [bool](Find-ReveilleProcs | Where-Object {
      $_.Name -eq 'node.exe' -and $_.CommandLine -match 'orchestrator[\\/]\.env'
    })
}

function Start-All {
  foreach ($s in $services) {
    # Idempotent: never double-launch a service that is already up (that would just
    # race for its port and crash on EADDRINUSE). So `start` is safe to run anytime.
    if (Test-ServiceUp $s) { Write-Host ("skipped {0,-20} -> already up" -f $s.Name); continue }
    $cmd = "node --env-file=$($s.Env) $($s.Script)"
    Start-Process powershell -WorkingDirectory $root -ArgumentList '-NoExit', '-Command', $cmd | Out-Null
    Write-Host ("started {0,-20} -> {1}" -f $s.Name, $cmd)
  }
  Write-Host ''
  Write-Host 'Control plane up (one window each new launch). The targets stay as they are —'
  Write-Host 'start a game from Discord (/start <game>); open VLC yourself, then /pause · /play.'
}

function Stop-All {
  $procs = @(Find-ReveilleProcs)
  if ($procs.Count -eq 0) { Write-Host 'Nothing to stop — the control plane is not running.'; return }
  foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host ("stopped PID {0} ({1})" -f $p.ProcessId, $p.Name)
  }
  Write-Host 'Control plane stopped. Any running game servers and VLC are untouched.'
}

function Show-Status {
  $procs = @(Find-ReveilleProcs)
  foreach ($s in $services) {
    if ($null -ne $s.Port) {
      $up = [bool](Get-NetTCPConnection -State Listen -LocalPort $s.Port -ErrorAction SilentlyContinue)
      $where = ":$($s.Port)"
    }
    else {
      # the orchestrator has no inbound port — find its node process directly
      $up = [bool]($procs | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'orchestrator[\\/]\.env' })
      $where = '(no port; dials out)'
    }
    Write-Host ("{0,-20} {1,-5} {2}" -f $s.Name, $(if ($up) { 'UP' } else { 'down' }), $where)
  }
}

switch ($Action) {
  'start' { Start-All }
  'stop' { Stop-All }
  'restart' { Stop-All; Start-Sleep -Seconds 1; Start-All }
  'status' { Show-Status }
}
