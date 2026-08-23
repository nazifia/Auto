<#
    Runs src/server.js as a Windows service, so n8n's 07:00 UTC schedule has a
    /run endpoint whether or not anyone is logged in.

        powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
        powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -Session
        powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -Remove

    -Session is the opposite trade: the service is parked and the agent runs
    from the Startup folder in the logged-in user's session instead, which is
    the only way a headful browser is visible to anyone. Runs then need someone
    logged in - a schedule that fires at the login screen has no agent to call.

    Must be run elevated: creating a service and running it as LocalSystem both
    need admin. Re-running is safe — the service is reconfigured, not duplicated.

    Windows has no built-in way to supervise a plain console program as a
    service (sc.exe expects a binary that talks to the SCM, which node does
    not), so this leans on nssm as the wrapper and installs it via winget if
    it is missing.
#>

param(
    [switch] $Remove,
    [switch] $Session
)

$ErrorActionPreference = "Stop"

$serviceName = "N8NBrowserAgent"
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot "logs"

# The Startup-folder script does the same job at logon. Two of them would race
# for the port, and the loser dies with EADDRINUSE.
$startupScript = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\n8n-browser-agent.cmd"

function Assert-Elevated {

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()

    $principal = New-Object Security.Principal.WindowsPrincipal $identity

    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this from an elevated PowerShell (Start > PowerShell > Run as administrator)."
    }

}

function Get-Nssm {

    $found = Get-Command nssm -ErrorAction SilentlyContinue

    if ($found) {
        return $found.Source
    }

    Write-Host "nssm not found — installing it with winget..."

    # Out-Null matters: anything winget writes would otherwise ride out on the
    # pipeline as part of this function's return value, and the caller would
    # try to execute the banner text as the path to nssm.exe.
    winget install --id NSSM.NSSM --exact --silent --accept-package-agreements --accept-source-agreements | Out-Null

    # winget does not refresh this process's PATH, so look for the binary itself.
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")

    $env:Path = "$machinePath;$userPath"

    $found = Get-Command nssm -ErrorAction SilentlyContinue

    if ($found) {
        return $found.Source
    }

    $candidate = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter nssm.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "win64" } |
        Select-Object -First 1

    if (-not $candidate) {
        throw "nssm is still not on PATH after the winget install. Install it manually and re-run."
    }

    return $candidate.FullName

}

function Get-NodePath {

    $node = (Get-Command node -ErrorAction SilentlyContinue).Source

    if (-not $node) {
        throw "node is not on PATH."
    }

    # Under nvm4w, C:\nvm4w\nodejs is a symlink that moves every `nvm use`. The
    # service must not follow it, or switching node versions silently changes
    # what the service runs.
    $item = Get-Item $node

    if ($item.LinkType -and $item.Target) {
        return $item.Target
    }

    $parent = Get-Item (Split-Path -Parent $node)

    if ($parent.LinkType -and $parent.Target) {
        return Join-Path $parent.Target "node.exe"
    }

    return $node

}

Assert-Elevated

$existing = Get-Service $serviceName -ErrorAction SilentlyContinue

if ($Remove) {

    if (-not $existing) {

        Write-Host "$serviceName is not installed — nothing to remove."

        exit 0

    }

    $nssm = Get-Nssm

    & $nssm stop $serviceName | Out-Null

    & $nssm remove $serviceName confirm

    Write-Host "Removed $serviceName. The agent is no longer running at boot."

    exit 0

}

if ($Session) {

    # Session 0, where a service lives, has no desktop. A headful chromium
    # launched there is not drawn anywhere - it is simply invisible, and slower.
    # So visibility is not a flag on the browser, it is a decision about which
    # session the agent process sits in.
    if ($existing) {

        Stop-Service $serviceName -Force -ErrorAction SilentlyContinue

        Set-Service $serviceName -StartupType Manual

        Write-Host "Parked $serviceName (Manual). It no longer takes the port at boot."

    }

    if (-not (Test-Path $logDirectory)) {
        New-Item -ItemType Directory -Path $logDirectory | Out-Null
    }

    $agentLog = Join-Path $logDirectory "agent.log"

    @(
        "@echo off",
        "cd /d `"$projectRoot`"",
        "start `"n8n browser agent`" /min cmd /c `"node src\server.js >> logs\agent.log 2>&1`""
    ) | Set-Content -Path $startupScript -Encoding ASCII

    Write-Host "Wrote $startupScript - the agent starts in your session at logon."

    Start-Process -FilePath $startupScript -WindowStyle Hidden

    Start-Sleep -Seconds 3

    $port = 3001

    $line = Select-String -Path (Join-Path $projectRoot ".env") -Pattern "^PORT=(\d+)" -ErrorAction SilentlyContinue

    if ($line) {
        $port = [int] $line.Matches[0].Groups[1].Value
    }

    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 15

    Write-Host ""
    Write-Host "Agent running in session $((Get-Process -Id $PID).SessionId) - /health says $($health.Content)"
    Write-Host "Logs: $agentLog"
    Write-Host "Back to the service: powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1"

    exit 0

}

$nssm = Get-Nssm
$node = Get-NodePath

if (-not (Test-Path $logDirectory)) {
    New-Item -ItemType Directory -Path $logDirectory | Out-Null
}

if (Test-Path $startupScript) {

    Remove-Item $startupScript

    Write-Host "Removed the Startup-folder script — the service replaces it."

}

# A server already listening on the port would leave the service stuck in a
# restart loop against EADDRINUSE.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*src\server.js*" } |
    ForEach-Object {

        Write-Host "Stopping the agent already running as PID $($_.ProcessId)."

        Stop-Process -Id $_.ProcessId -Force

    }

if ($existing) {

    & $nssm stop $serviceName | Out-Null

} else {

    & $nssm install $serviceName $node "src\server.js"

}

& $nssm set $serviceName Application $node
& $nssm set $serviceName AppParameters "src\server.js"
& $nssm set $serviceName AppDirectory $projectRoot
& $nssm set $serviceName DisplayName "n8n browser agent"
& $nssm set $serviceName Description "Serves POST /run for the n8n browser-agent workflow."
& $nssm set $serviceName Start SERVICE_AUTO_START
& $nssm set $serviceName ObjectName LocalSystem

# LocalSystem has its own profile, so Playwright would look for browsers under
# C:\Windows\System32\config\systemprofile and find none. Point it at the set
# that is already downloaded for this user.
& $nssm set $serviceName AppEnvironmentExtra "PLAYWRIGHT_BROWSERS_PATH=$env:LOCALAPPDATA\ms-playwright"

& $nssm set $serviceName AppStdout (Join-Path $logDirectory "service.log")
& $nssm set $serviceName AppStderr (Join-Path $logDirectory "service.log")
& $nssm set $serviceName AppRotateFiles 1
& $nssm set $serviceName AppRotateBytes 10485760

& $nssm set $serviceName AppExit Default Restart
& $nssm set $serviceName AppRestartDelay 5000

& $nssm start $serviceName

Start-Sleep -Seconds 3

$port = 3001

$line = Select-String -Path (Join-Path $projectRoot ".env") -Pattern "^PORT=(\d+)" -ErrorAction SilentlyContinue

if ($line) {
    $port = [int] $line.Matches[0].Groups[1].Value
}

$health = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 10

Write-Host ""
Write-Host "$serviceName is $((Get-Service $serviceName).Status) — /health says $($health.Content)"
Write-Host "Logs: $logDirectory\service.log"
Write-Host "Remove it: powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -Remove"
