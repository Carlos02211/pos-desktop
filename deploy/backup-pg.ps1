# Respaldo MANUAL de la base PostgreSQL del POS (herramienta de soporte).
#
# Normalmente NO hace falta: el servidor respalda solo al cerrar cada caja y una vez al día,
# en la carpeta elegida en Admin → Configuración → Respaldos. Este script sirve para sacar
# un respaldo a mano (p. ej. antes de actualizar) aunque el servidor esté detenido.
#
# No hay nada que editar: lee DATABASE_URL del .env y busca pg_dump en la instalación de
# PostgreSQL.
#
#   .\backup-pg.ps1                       # guarda en .\data\backups
#   .\backup-pg.ps1 -Destino "E:\Respaldos POS"

param([string]$Destino = (Join-Path $PSScriptRoot "data\backups"))

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# --- DATABASE_URL del .env ---------------------------------------------------
$line = Get-Content ".\.env" | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $line) { throw "El .env no tiene DATABASE_URL." }
$url = [Uri](($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"', "'"))
$userInfo = $url.UserInfo.Split(':', 2)
# La contraseña va por PGPASSWORD, no en la línea de comandos.
$env:PGPASSWORD = [Uri]::UnescapeDataString($userInfo[1])
$port = if ($url.Port -gt 0) { $url.Port } else { 5432 }
$db = $url.AbsolutePath.TrimStart('/')

# --- pg_dump de la versión más nueva instalada ------------------------------------
$pgBin = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
  Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending |
  Select-Object -First 1
if (-not $pgBin) { throw "No se encontró pg_dump.exe en $env:ProgramFiles\PostgreSQL." }
$pgRestore = Join-Path $pgBin.DirectoryName "pg_restore.exe"

New-Item -ItemType Directory -Force -Path $Destino | Out-Null
$dump = Join-Path $Destino ("pos_{0}.dump" -f (Get-Date -Format "yyyy-MM-ddTHH-mm-ss"))

Write-Host "→ pg_dump $db → $dump"
& $pgBin.FullName --format=custom "--file=$dump" --host=$($url.Host) --port=$port `
  "--username=$([Uri]::UnescapeDataString($userInfo[0]))" $db
if ($LASTEXITCODE -ne 0) { throw "pg_dump falló (código $LASTEXITCODE)." }

# Que el archivo se pueda leer (detecta un dump corrupto).
& $pgRestore --list $dump | Out-Null
if ($LASTEXITCODE -ne 0) { throw "El respaldo no se puede leer: $dump" }
Write-Host ("✓ Respaldo OK ({0:N1} MB)" -f ((Get-Item $dump).Length / 1MB)) -ForegroundColor Green
