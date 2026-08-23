<#
.SYNOPSIS
    Clears the two independent reasons the N8N service will not stay up: the
    unused community nodes, and a Hyper-V reservation sitting on port 5678.

.DESCRIPTION
    n8n-nodes-playwright runs scripts/setup-browsers.js at *import* time, not at
    node execution time, so every n8n start deletes and re-copies ~430 MB of
    Playwright browsers -- and calls process.exit(1) from inside the n8n process
    if any part of that fails. Under the N8N service the copy source is the
    LocalSystem profile's ms-playwright, the copy dies partway, and n8n restarts
    every ~15 seconds without ever staying bound to 5678.

    Neither this package nor n8n-nodes-browser-use-cloud is referenced by any
    workflow -- the browser automation in this project runs in the agent, not in
    n8n -- so both are removed rather than worked around.

    With those gone the next failure shows up: "n8n does not have permission to
    use port 5678". Nothing is listening on it. Hyper-V hands winnat a block of
    dynamic TCP ports at boot, that block is re-rolled on every reboot, and one
    of them landed on 5678 -- see `netsh interface ipv4 show excludedportrange
    protocol=tcp`. A persistent administered exclusion for the single port takes
    it out of the pool Hyper-V draws from, so the reboot lottery cannot claim it
    again, while an explicit bind to it still succeeds.

    Reversible: reinstall the nodes from the n8n UI under Settings > Community
    nodes, and drop the port reservation with `netsh int ipv4 delete
    excludedportrange protocol=tcp startport=5678 numberofports=1 store=persistent`.

.PARAMETER DataRoot
    Parent of the .n8n folder. Matches install-n8n-service.ps1's default.

.PARAMETER Port
    The port n8n listens on, reserved against the Hyper-V dynamic range.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\remove-community-nodes.ps1
#>

[CmdletBinding()]
param(
    [string] $DataRoot = "C:\ProgramData\n8n",
    [string[]] $Packages = @("n8n-nodes-playwright", "n8n-nodes-browser-use-cloud"),
    [string] $ServiceName = "N8N",
    [int] $Port = 5678
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this from an elevated PowerShell (Start > PowerShell > Run as administrator)."
}

$nodesDir = Join-Path $DataRoot ".n8n\nodes"
$database = Join-Path $DataRoot ".n8n\database.sqlite"

if (-not (Test-Path $database)) {
    throw "No n8n database at $database. Check -DataRoot."
}

# The service must be down before touching either the package folder or the
# database: the crash loop re-creates the browsers directory every restart, and
# sqlite is held open while n8n is up.
$service = Get-Service $ServiceName -ErrorAction SilentlyContinue

if ($service) {
    Write-Host "Stopping $ServiceName..."
    Stop-Service $ServiceName -Force
    # nssm reports Stopped before the node process tree has actually exited.
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 5678 })) {
        Start-Sleep -Milliseconds 500
    }
}

$backup = Join-Path $DataRoot ("backup-nodes-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item $database (Join-Path $backup "database.sqlite")
Write-Host "Database backed up to $backup"

foreach ($package in $Packages) {
    $path = Join-Path $nodesDir "node_modules\$package"

    if (Test-Path $path) {
        Write-Host "Removing $package..."
        Remove-Item $path -Recurse -Force
    }
    else {
        Write-Host "$package already gone from disk."
    }
}

# A non-elevated pass can rename a package out of n8n's load path -- enough to
# stop the crash loop -- but not delete the browser files SYSTEM wrote inside
# it. Those land here as _removing_<package> and need this script's rights.
$leftovers = Get-ChildItem (Join-Path $nodesDir "node_modules") -Directory -Filter "_removing_*" -ErrorAction SilentlyContinue

foreach ($leftover in $leftovers) {
    Write-Host "Removing leftover $($leftover.Name)..."
    Remove-Item $leftover.FullName -Recurse -Force
}

# nodes/package.json is n8n's own manifest of what it installed; leaving a
# dependency here that no longer exists on disk makes it reinstall the package
# on the next start, which would put the crash loop straight back.
$manifestPath = Join-Path $nodesDir "package.json"

if (Test-Path $manifestPath) {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

    foreach ($package in $Packages) {
        if ($manifest.dependencies.PSObject.Properties.Name -contains $package) {
            $manifest.dependencies.PSObject.Properties.Remove($package)
        }
    }

    # WriteAllText with a BOM-less encoding, not Out-File: PowerShell 5.1 writes a
    # BOM that n8n's JSON.parse of this file chokes on.
    $json = $manifest | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($manifestPath, $json, (New-Object Text.UTF8Encoding $false))
    Write-Host "Updated $manifestPath"
}

# installed_packages / installed_nodes are what the Community nodes settings
# page reads. Rows left behind without files produce load warnings on every
# start and a ghost entry in the UI.
$cleanup = Join-Path $env:TEMP "n8n-remove-packages.js"
$packageList = ($Packages | ForEach-Object { "'" + $_ + "'" }) -join ","

@"
const { DatabaseSync } = require('node:sqlite');
const packages = [$packageList];
const db = new DatabaseSync(String.raw``$database``);
const dropNodes = db.prepare('delete from installed_nodes where package = ?');
const dropPackage = db.prepare('delete from installed_packages where packageName = ?');
for (const name of packages) {
    const nodes = dropNodes.run(name).changes;
    const rows = dropPackage.run(name).changes;
    console.log('  ' + name + ': ' + rows + ' package row, ' + nodes + ' node rows');
}
db.exec('pragma wal_checkpoint(TRUNCATE)');
db.close();
"@ | Out-File $cleanup -Encoding utf8

Write-Host "Cleaning database rows..."
& node $cleanup
Remove-Item $cleanup -Force

# Hyper-V re-rolls winnat's dynamic TCP block on every boot, and this time it
# covered 5678 -- so n8n's bind() fails with a permission error while netstat
# shows nothing listening. Reserving the single port persistently takes it out
# of the pool that lottery draws from. winnat has to be down to change it: the
# ranges are held open while it runs.
$excluded = netsh interface ipv4 show excludedportrange protocol=tcp | Out-String

$blocked = [regex]::Matches($excluded, '(?m)^\s*(\d+)\s+(\d+)') | Where-Object {
    $Port -ge [int]$_.Groups[1].Value -and $Port -le [int]$_.Groups[2].Value
}

if ($blocked) {

    Write-Host "Port $Port sits inside a reserved range. Reserving it for n8n..."

    net stop winnat | Out-Null
    netsh int ipv4 add excludedportrange protocol=tcp startport=$Port numberofports=1 store=persistent | Out-Null
    net start winnat | Out-Null

    Write-Host "Reserved $Port (persistent, survives reboot)."

}
else {
    Write-Host "Port $Port is not inside a reserved range."
}

if ($service) {
    Write-Host "Starting $ServiceName..."
    Start-Service $ServiceName

    $deadline = (Get-Date).AddMinutes(2)
    $up = $false

    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:5678/healthz" -UseBasicParsing -TimeoutSec 5 | Out-Null
            $up = $true
            break
        }
        catch {
            Start-Sleep -Seconds 3
        }
    }

    if ($up) {
        Write-Host "$ServiceName is up on http://127.0.0.1:5678"
    }
    else {
        Write-Warning "$ServiceName did not answer /healthz within 2 minutes. Check $DataRoot\logs\n8n.log."
    }
}
