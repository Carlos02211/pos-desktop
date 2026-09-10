# Respaldo de la base PostgreSQL del POS (Fase 2).
#
# Programar como tarea diaria (ver docs/fase-2-migracion.md → "Respaldo de PostgreSQL"):
#   Register-ScheduledTask -TaskName "POS backup PostgreSQL" -RunLevel Highest `
#     -Action (New-ScheduledTaskAction -Execute "powershell.exe" `
#       -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\pos-server\deploy\backup-pg.ps1") `
#     -Trigger (New-ScheduledTaskTrigger -Daily -At 11:30PM)
#
# Ajustar las 4 variables de abajo.

$ErrorActionPreference = "Stop"

$PgBin       = "C:\Program Files\PostgreSQL\16\bin"
$DbName      = "pos"
$DbUser      = "pos"
$env:PGPASSWORD = "CAMBIAR-clave-de-pos"          # o usar %APPDATA%\postgresql\pgpass.conf
$BackupDir   = "C:\pos-server\backups"
$RetainDays  = 14
$OffsiteDir  = ""                                 # p. ej. "\\NAS\backups\pos" (vacío = no copiar)

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dump  = Join-Path $BackupDir "pos_$stamp.dump"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

Write-Host "→ pg_dump $DbName → $dump"
& "$PgBin\pg_dump.exe" -U $DbUser -Fc $DbName -f $dump

# Verifica que el dump se puede leer (detecta corrupción)
& "$PgBin\pg_restore.exe" --list $dump | Out-Null
Write-Host "✓ dump verificado ($([math]::Round((Get-Item $dump).Length / 1MB, 1)) MB)"

# Retención
Get-ChildItem "$BackupDir\pos_*.dump" |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-$RetainDays) |
  ForEach-Object { Write-Host "  borrando antiguo: $($_.Name)"; Remove-Item $_.FullName }

# Copia fuera del equipo
if ($OffsiteDir -and (Test-Path $OffsiteDir)) {
  Copy-Item $dump $OffsiteDir
  Write-Host "✓ copiado a $OffsiteDir"
}

Write-Host "Respaldo OK."
