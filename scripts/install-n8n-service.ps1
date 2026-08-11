<#
    Runs n8n itself as a Windows service, so the 07:00 UTC schedule survives a
    reboot with nobody logged in.

        powershell -ExecutionPolicy Bypass -File scripts\install-n8n-service.ps1
        powershell -ExecutionPolicy Bypass -File scripts\install-n8n-service.ps1 -Remove

    Must be run elevated.

    Why not Docker: the n8n container lives in Docker Desktop, and Docker
    Desktop starts at user *logon*. No logon, no container, no trigger — the
    agent sits there with nothing calling it. Running n8n from the npm package
    under a service takes Docker out of the chain entirely.

    The container's data (workflows, credentials, and the encryption key that
    decrypts them) has to be copied to $DataRoot\.n8n before this runs, with the
    container stopped so sqlite is not mid-write:

        docker stop <container>
        docker cp <container>:/home/node/.n8n <DataRoot>\.n8n
#>

param(
    [switch] $Remove,
    [string] $DataRoot = "C:\ProgramData\n8n",
    [int] $Port = 5678
)

$ErrorActionPreference = "Stop"

$serviceName = "N8N"
$logDirectory = Join-Path $DataRoot "logs"

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

    Write-Host "nssm not found - installing it with winget..."

    # Out-Null matters: anything winget writes would otherwise ride out on the
    # pipeline as part of this function's return value, and the caller would
    # try to execute the banner text as the path to nssm.exe.
    winget install --id NSSM.NSSM --exact --silent --accept-package-agreements --accept-source-agreements | Out-Null

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

Assert-Elevated

$existing = Get-Service $serviceName -ErrorAction SilentlyContinue

if ($Remove) {

    if (-not $existing) {

        Write-Host "$serviceName is not installed - nothing to remove."

        exit 0

    }

    $nssm = Get-Nssm

    & $nssm stop $serviceName | Out-Null

    & $nssm remove $serviceName confirm

    Write-Host "Removed $serviceName. Data is left untouched in $DataRoot."

    exit 0

}

$nssm = Get-Nssm

# node.exe runs the package's entry script directly. The .cmd shim in the npm
# bin folder would put an extra cmd.exe between the service and the process it
# is supposed to be supervising.
$node = (Get-Command node).Source

$item = Get-Item $node

if ($item.LinkType -and $item.Target) {

    $node = $item.Target

} else {

    $parent = Get-Item (Split-Path -Parent $node)

    if ($parent.LinkType -and $parent.Target) {
        $node = Join-Path $parent.Target "node.exe"
    }

}

$entry = Join-Path (npm root -g) "n8n\bin\n8n"

if (-not (Test-Path $entry)) {
    throw "n8n is not installed globally ($entry is missing). Run: npm install -g n8n"
}

if (-not (Test-Path (Join-Path $DataRoot ".n8n\database.sqlite"))) {
    throw "No database at $DataRoot\.n8n - copy it out of the container first (see the header of this script)."
}

if (-not (Test-Path $logDirectory)) {
    New-Item -ItemType Directory -Path $logDirectory | Out-Null
}

if ($existing) {

    & $nssm stop $serviceName | Out-Null

} else {

    & $nssm install $serviceName $node $entry "start"

}

& $nssm set $serviceName Application $node
& $nssm set $serviceName AppParameters "`"$entry`" start"
& $nssm set $serviceName AppDirectory $DataRoot
& $nssm set $serviceName DisplayName "n8n"
& $nssm set $serviceName Description "n8n workflow automation, serving the browser-agent flow."
& $nssm set $serviceName Start SERVICE_AUTO_START
& $nssm set $serviceName ObjectName LocalSystem

# N8N_USER_FOLDER is the *parent* of .n8n, not .n8n itself. Point it away from a
# user profile: LocalSystem's profile is not the one the data was copied into.
# No GENERIC_TIMEZONE on purpose - the container ran in UTC and the schedule
# node is named for UTC. Setting one here would silently move the trigger.
& $nssm set $serviceName AppEnvironmentExtra "N8N_USER_FOLDER=$DataRoot" "N8N_PORT=$Port" "N8N_DIAGNOSTICS_ENABLED=false"

& $nssm set $serviceName AppStdout (Join-Path $logDirectory "n8n.log")
& $nssm set $serviceName AppStderr (Join-Path $logDirectory "n8n.log")
& $nssm set $serviceName AppRotateFiles 1
& $nssm set $serviceName AppRotateBytes 10485760

& $nssm set $serviceName AppExit Default Restart
& $nssm set $serviceName AppRestartDelay 5000

& $nssm start $serviceName

# First boot runs database migrations against the copied sqlite file, which is
# slower than a warm start.
$deadline = (Get-Date).AddSeconds(180)

$ready = $false

while ((Get-Date) -lt $deadline) {

    try {

        $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/healthz" -UseBasicParsing -TimeoutSec 5

        if ($health.StatusCode -eq 200) {

            $ready = $true

            break

        }

    } catch {

        Start-Sleep -Seconds 5

    }

}

if (-not $ready) {
    throw "$serviceName did not answer /healthz within 3 minutes. See $logDirectory\n8n.log."
}

Write-Host ""
Write-Host "$serviceName is $((Get-Service $serviceName).Status) on http://127.0.0.1:$Port"
Write-Host "Data: $DataRoot\.n8n   Logs: $logDirectory\n8n.log"
Write-Host "Remove it: powershell -ExecutionPolicy Bypass -File scripts\install-n8n-service.ps1 -Remove"
