# Instalación / actualización del servidor POS SpArTaN Tech (Fase 2) en Windows.
#
# Se corre DENTRO de la carpeta del servidor (la que copiaste como C:\pos-server).
# Es idempotente: se puede volver a correr tras una actualización del bundle.
#
#   1. Copiá esta carpeta completa como  C:\pos-server
#   2. Corré setup-server.ps1: si no hay .env lo crea desde env-ejemplo.txt y lo abre;
#      completá DATABASE_URL, guardá y volvé a correrlo
#   3. PowerShell COMO ADMINISTRADOR:
#        cd C:\pos-server
#        Set-ExecutionPolicy -Scope Process Bypass
#        .\setup-server.ps1
#
# Requisitos previos (Días 1-2 del runbook): PostgreSQL 16 instalado, base `pos`
# creada y (si migrás datos de Fase 1) `pnpm migrate:sqlite-to-pg` ya ejecutado.

param([int]$Port = 3000)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# --- .env --------------------------------------------------------------
Step ".env"
if (-not (Test-Path ".\.env")) {
  $template = @(".\env-ejemplo.txt", ".\.env.example") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $template) { throw "No está env-ejemplo.txt: copiá de nuevo la carpeta completa del servidor." }
  Copy-Item $template ".\.env"
  Write-Host "Se creó .env desde $template. Completá DATABASE_URL, guardá y volvé a correr este script." -ForegroundColor Yellow
  Start-Process notepad.exe ".\.env"
  exit 1
}
$envText = Get-Content ".\.env" -Raw
if ($envText -notmatch "(?m)^\s*DATABASE_URL\s*=\s*postgres") {
  throw ".env: falta DATABASE_URL con una URL de PostgreSQL (postgres://...)."
}

# --- Node 22 ---------------------------------------------------------
Step "Node.js 22"
$hasNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $hasNode -or [int](& node -p "process.versions.node.split('.')[0]") -lt 22) {
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path","User")
}
Write-Host "node $(& node --version)  (el bundle no tiene módulos nativos → no hace falta Python ni VS Build Tools)"

# --- Dependencias de runtime --------------------------------------
Step "npm install --omit=dev"
npm install --omit=dev --no-audit --no-fund

# --- pm2 -----------------------------------------------------------
Step "pm2"
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { npm install -g pm2 }
# En Windows PowerShell 5.1, con ErrorActionPreference=Stop, cualquier stderr de un
# ejecutable redirigido (2>$null) se vuelve error terminante. pm2 escribe en stderr
# cosas normales (p. ej. "pos-server not found" al borrar un proceso que no existe),
# así que en este bloque se valida con $LASTEXITCODE en vez de con el stream de error.
$ErrorActionPreference = "Continue"
pm2 delete pos-server *> $null
pm2 start ecosystem.config.cjs
if ($LASTEXITCODE -ne 0) { throw "pm2 start falló (código $LASTEXITCODE). Revisá 'pm2 logs pos-server'." }
# pm2-installer (servicio de Windows) ya trae su propio rotador, @jessety/pm2-logrotate:
# instalar además pm2-logrotate deja dos rotadores peleándose por los mismos archivos.
$modules = (pm2 jlist 2>$null | Out-String | ConvertFrom-Json) | ForEach-Object { $_.name }
if ($modules -notcontains "@jessety/pm2-logrotate") {
  if ($modules -notcontains "pm2-logrotate") { pm2 install pm2-logrotate *> $null }
  pm2 set pm2-logrotate:max_size 10M  | Out-Null
  pm2 set pm2-logrotate:retain 14     | Out-Null
  pm2 set pm2-logrotate:compress true | Out-Null
}
pm2 save
$ErrorActionPreference = "Stop"

# --- Firewall ---------------------------------------------------
Step "Regla de firewall TCP $Port (perfil Privado)"
if (-not (Get-NetFirewallRule -DisplayName "POS SpArTaN Tech" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "POS SpArTaN Tech" -Direction Inbound `
    -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
}

Step "Listo"
Start-Sleep -Seconds 2
$tls = $envText -match "(?m)^\s*POS_TLS_CERT\s*=\s*\S"
$scheme = if ($tls) { "https" } else { "http" }
# PowerShell 5.1 negocia TLS 1.0 por defecto; Node exige 1.2+.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
  $ping = Invoke-RestMethod "${scheme}://localhost:$Port/api/ping" -TimeoutSec 5
  Write-Host "  /api/ping → engine=$($ping.engine) db=$($ping.db)" -ForegroundColor Green
} catch {
  Write-Host "  No respondió /api/ping todavía — revisá 'pm2 logs pos-server'." -ForegroundColor Yellow
}

# --- Red: lo que impide que las cajas lleguen aunque el servidor funcione ---------
Step "Red"
$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
  Sort-Object RouteMetric | Select-Object -First 1
if ($route) {
  $alias = $route.InterfaceAlias
  $ip = (Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 |
    Where-Object { $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
  Write-Host "  Las cajas entran por:  ${scheme}://${ip}:$Port/" -ForegroundColor Cyan

  # La regla del firewall es sólo para el perfil Privado: en una red "Pública" Windows
  # bloquea a las cajas aunque todo lo demás esté bien.
  $netProfile = Get-NetConnectionProfile -InterfaceAlias $alias -ErrorAction SilentlyContinue
  if ($netProfile -and $netProfile.NetworkCategory -eq "Public") {
    Write-Host "  ATENCIÓN: la red '$($netProfile.Name)' está como PÚBLICA — el firewall bloquea a las cajas." -ForegroundColor Yellow
    Write-Host "  Si es la red del negocio, marcala como privada:" -ForegroundColor Yellow
    Write-Host "    Set-NetConnectionProfile -InterfaceAlias '$alias' -NetworkCategory Private"
  } else {
    Write-Host "  Perfil de red: $($netProfile.NetworkCategory)"
  }

  if ((Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4).Dhcp -eq "Enabled") {
    Write-Host "  ATENCIÓN: IP automática (DHCP). Si el router la cambia, las cajas no encuentran" -ForegroundColor Yellow
    Write-Host "  el servidor. Fijala con:  .\ip-fija.ps1" -ForegroundColor Yellow
  } else {
    Write-Host "  IP fija: $ip"
  }
  if (-not $tls) {
    Write-Host "  HTTPS desactivado — recomendado si las cajas van por WiFi:  .\setup-https.ps1" -ForegroundColor Yellow
  }
} else {
  Write-Host "  Sin ruta por defecto: esta PC no parece estar conectada a la red." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Contraseña de admin (sólo el primer arranque):  pm2 logs pos-server --lines 50"
if (Get-Service -Name "pm2*" -ErrorAction SilentlyContinue) {
  Write-Host "Arranque automático: servicio de Windows 'pm2' instalado (pm2-installer)." -ForegroundColor Green
} else {
  Write-Host "Arranque automático: falta el servicio de Windows — ver 'B5. pm2-installer' en la guía." -ForegroundColor Yellow
}
