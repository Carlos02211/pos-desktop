# Instalación / actualización del servidor POS SpArTaN Tech (Fase 2) en Windows.
#
# Idempotente: se puede correr varias veces. Cubre los Días 3-4 del runbook
# (docs/fase-2-migracion.md). PostgreSQL y la migración de datos (Días 1-2) van aparte.
#
# Uso (PowerShell como Administrador, en la carpeta que contiene `dist-server\`):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\deploy\setup-server.ps1 -Dest "C:\pos-server" -Port 3000
#
# Antes de correrlo: copiar `dist-server\` (de `pnpm build:server`) junto a este script,
# y tener listo el `.env` (o el script crea uno desde .env.example para que lo edites).

param(
  [string]$Dest = "C:\pos-server",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# --- Node 22 --------------------------------------------------------------
Step "Node.js 22"
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node -or [int](& node -p "process.versions.node.split('.')[0]") -lt 22) {
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User")
}
& node --version

# --- Copiar el bundle ---------------------------------------------------
Step "Copiar dist-server -> $Dest"
$src = Join-Path $PSScriptRoot "..\dist-server"
if (-not (Test-Path $src)) { $src = Join-Path (Get-Location) "dist-server" }
if (-not (Test-Path $src)) { throw "No encuentro dist-server\. Corré 'pnpm build:server' y copiá la carpeta aquí." }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item "$src\*" $Dest -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot "ecosystem.config.cjs") $Dest -Force
Copy-Item (Join-Path $PSScriptRoot "backup-pg.ps1") (Join-Path $Dest "deploy\") -Force -ErrorAction SilentlyContinue

# --- .env -------------------------------------------------------------
Step ".env"
$envFile = Join-Path $Dest ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $PSScriptRoot ".env.example") $envFile
  Write-Host "Se creó $envFile desde el ejemplo. EDITALO (DATABASE_URL, POS_VENDOR_SECRET) y volvé a correr." -ForegroundColor Yellow
  exit 1
}

# --- Dependencias de producción --------------------------------------
Step "npm install --omit=dev (recompila better-sqlite3 para este Node)"
Push-Location $Dest
npm install --omit=dev
Pop-Location

# --- pm2 ------------------------------------------------------------
Step "pm2"
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { npm install -g pm2 }
Push-Location $Dest
pm2 delete pos-server 2>$null | Out-Null
pm2 start ecosystem.config.cjs
pm2 save
Pop-Location

# pm2-logrotate (idempotente)
pm2 install pm2-logrotate 2>$null | Out-Null
pm2 set pm2-logrotate:max_size 10M    | Out-Null
pm2 set pm2-logrotate:retain 14       | Out-Null
pm2 set pm2-logrotate:compress true   | Out-Null

# --- Firewall -----------------------------------------------------
Step "Regla de firewall TCP $Port (perfil Privado)"
if (-not (Get-NetFirewallRule -DisplayName "POS SpArTaN Tech" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "POS SpArTaN Tech" -Direction Inbound `
    -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
}

Step "Listo"
Write-Host "Comprobá:  curl http://localhost:$Port/api/ping"
Write-Host "Contraseña de admin (primer arranque):  pm2 logs pos-server --lines 50"
Write-Host "Servicio de Windows (arranque automático):  ver 'pm2-installer' en el runbook."
