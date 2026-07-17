<#
.SYNOPSIS
    Install the IMDF Map Platform as an auto-starting Windows service (NSSM) on the host PC.

.DESCRIPTION
    One-shot deployment for a single always-on Windows PC serving the app to the LAN over
    plain HTTP. Idempotent: safe to re-run. Performs:
      1. Directory layout under -InstallRoot
      2. git clone (or pull) of the repo into <InstallRoot>\app
      3. pnpm install + build + build:server (via Corepack)
      4. NSSM acquisition (winget, else direct download from nssm.cc)
      5. Service registration + configuration (auto-start, auto-restart, logging)
      6. Inbound firewall rule for the LAN
      7. Copies OPERATIONS.md next to the install root

    The FIRST admin account is NOT created here (it needs a human-chosen password).
    After this script succeeds, run once (see OPERATIONS.md / step "Add user"):
        node server\dist\main.js add-user admin --role admin --data <InstallRoot>\data

    MUST be run from an ELEVATED (Administrator) PowerShell.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-windows-service.ps1 `
        -RepoUrl git@github.com:dmalmq/imdf-map-application.git -Branch feature/gdb-import
#>
[CmdletBinding()]
param(
    [string]$RepoUrl    = 'git@github.com:dmalmq/imdf-map-application.git',
    [string]$Branch     = 'feature/gdb-import',
    [string]$InstallRoot = 'C:\imdf-platform',
    [int]   $Port       = 8080,
    [string]$ServiceName = 'imdf-platform'
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
        throw 'This script must run in an elevated (Administrator) PowerShell.'
    }
}

function Get-Nssm {
    param([string]$NssmDir)
    # 1. already on PATH?
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # 2. already downloaded?
    $local = Join-Path $NssmDir 'nssm.exe'
    if (Test-Path $local) { return $local }
    # 3. try winget
    try {
        winget install --id NSSM.NSSM --source winget --accept-package-agreements --accept-source-agreements | Out-Null
        $cmd = Get-Command nssm -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    } catch { Write-Warning "winget install failed: $($_.Exception.Message)" }
    # 4. direct download from nssm.cc
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $zip = Join-Path $NssmDir 'nssm-2.24.zip'
    Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath (Join-Path $NssmDir 'extract') -Force
    Copy-Item (Join-Path $NssmDir 'extract\nssm-2.24\win64\nssm.exe') $local -Force
    return $local
}

Assert-Admin

$appDir  = Join-Path $InstallRoot 'app'
$dataDir = Join-Path $InstallRoot 'data'
$logDir  = Join-Path $InstallRoot 'logs'
$nssmDir = Join-Path $InstallRoot 'nssm'

Write-Host "==> 1. Directory layout under $InstallRoot"
New-Item -ItemType Directory -Force $dataDir, $logDir, $nssmDir | Out-Null

Write-Host "==> 2. Obtain code ($Branch)"
if (Test-Path (Join-Path $appDir '.git')) {
    git -C $appDir fetch origin $Branch
    git -C $appDir checkout $Branch
    git -C $appDir pull --ff-only origin $Branch
} else {
    git clone --branch $Branch $RepoUrl $appDir
}

Write-Host "==> 3. Build frontend + server"
Push-Location $appDir
try {
    corepack pnpm install
    corepack pnpm build
    corepack pnpm build:server
} finally { Pop-Location }

$indexOk = Test-Path (Join-Path $appDir 'dist\index.html')
$wasmOk  = @(Get-ChildItem (Join-Path $appDir 'dist\assets\gdal3WebAssembly-*.wasm') -ErrorAction SilentlyContinue).Count -ge 1
$mainOk  = Test-Path (Join-Path $appDir 'server\dist\main.js')
if (-not ($indexOk -and $wasmOk -and $mainOk)) {
    throw "Build incomplete: index=$indexOk wasm=$wasmOk main=$mainOk"
}

Write-Host "==> 4. Resolve node.exe + NSSM"
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$nssm    = Get-Nssm -NssmDir $nssmDir
Write-Host "    node = $nodeExe"
Write-Host "    nssm = $nssm"

Write-Host "==> 5. Register + configure service '$ServiceName'"
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    & $nssm stop $ServiceName | Out-Null
} else {
    & $nssm install $ServiceName $nodeExe
}
& $nssm set $ServiceName Application $nodeExe
& $nssm set $ServiceName AppDirectory $appDir
& $nssm set $ServiceName AppParameters "server\dist\main.js --app dist --data `"$dataDir`" --port $Port"
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppStdout (Join-Path $logDir 'out.log')
& $nssm set $ServiceName AppStderr (Join-Path $logDir 'err.log')
& $nssm set $ServiceName AppExit Default Restart
& $nssm set $ServiceName AppRestartDelay 3000

Write-Host "==> 6. Firewall rule (Domain,Private) for TCP $Port"
$ruleName = "IMDF Platform $Port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
        -LocalPort $Port -Action Allow -Profile Domain,Private | Out-Null
}

Write-Host "==> 7. Copy OPERATIONS.md"
$ops = Join-Path $appDir 'deploy\OPERATIONS.md'
if (Test-Path $ops) { Copy-Item $ops (Join-Path $InstallRoot 'OPERATIONS.md') -Force }

Write-Host "==> Start service"
& $nssm start $ServiceName | Out-Null
Start-Sleep -Seconds 3
& $nssm status $ServiceName

Write-Host ''
Write-Host "Done. Next steps:"
Write-Host "  1. Create the first admin (interactive password prompt):"
Write-Host "       cd $appDir"
Write-Host "       node server\dist\main.js add-user admin --role admin --data `"$dataDir`""
Write-Host "  2. Verify: curl.exe -s http://127.0.0.1:$Port/api/catalog"
Write-Host "  3. From another LAN PC: http://$env:COMPUTERNAME`:$Port/"
