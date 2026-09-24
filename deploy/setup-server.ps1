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
pm2 save
pm2 install pm2-logrotate *> $null
pm2 set pm2-logrotate:max_size 10M  | Out-Null
pm2 set pm2-logrotate:retain 14     | Out-Null
pm2 set pm2-logrotate:compress true | Out-Null
$ErrorActionPreference = "Stop"

# --- Firewall ---------------------------------------------------
Step "Regla de firewall TCP $Port (perfil Privado)"
if (-not (Get-NetFirewallRule -DisplayName "POS SpArTaN Tech" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "POS SpArTaN Tech" -Direction Inbound `
    -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
}

Step "Listo"
Start-Sleep -Seconds 2
try {
  $ping = Invoke-RestMethod "http://localhost:$Port/api/ping" -TimeoutSec 5
  Write-Host "  /api/ping → engine=$($ping.engine) db=$($ping.db)" -ForegroundColor Green
} catch {
  Write-Host "  No respondió /api/ping todavía — revisá 'pm2 logs pos-server'." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Contraseña de admin (sólo el primer arranque):  pm2 logs pos-server --lines 50"
Write-Host "Arranque automático al encender la PC (servicio de Windows):  ver 'pm2-installer' en el runbook."
