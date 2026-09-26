# Renueva el certificado HTTPS del servidor POS SpArTaN Tech si está por vencer.
#
# Lo corre SOLO una tarea programada de Windows (la registra setup-https.ps1): cada semana,
# como SYSTEM. Si faltan más de 60 días no hace nada; si faltan menos, emite un certificado
# nuevo con la MISMA CA local (las tabletas no hay que tocarlas) y reinicia el servidor.
# Deja constancia en data\logs\renovar-certificado.log.
#
# A mano (PowerShell como Administrador, en C:\pos-server):
#   .\renovar-certificado.ps1            # renueva sólo si hace falta
#   .\renovar-certificado.ps1 -Forzar    # renueva ya (para probar)

param(
  [switch]$Forzar,
  [int]$DiasAntes = 60
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$logDir = Join-Path $PSScriptRoot "data\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "renovar-certificado.log"
function Log([string]$m) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Host $line
}

try {
  $cfgPath = Join-Path $PSScriptRoot "certs\renovacion.json"
  if (-not (Test-Path $cfgPath)) { throw "Falta certs\renovacion.json: corré primero .\setup-https.ps1." }
  # Rutas guardadas por setup-https.ps1: SYSTEM no ve el PATH ni la carpeta de mkcert del admin.
  $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json

  $certFile = Join-Path $PSScriptRoot "certs\servidor.pem"
  $keyFile  = Join-Path $PSScriptRoot "certs\servidor-key.pem"
  $notAfter = (New-Object Security.Cryptography.X509Certificates.X509Certificate2 $certFile).NotAfter
  $dias = [int][Math]::Floor(($notAfter - (Get-Date)).TotalDays)

  if (-not $Forzar -and $dias -gt $DiasAntes) {
    Log "Certificado vigente hasta $($notAfter.ToString('yyyy-MM-dd')) ($dias días): no hace falta renovar."
    exit 0
  }

  Log "Renovando (vence $($notAfter.ToString('yyyy-MM-dd')), faltan $dias días)…"
  $env:CAROOT = $cfg.caRoot
  # mkcert y pm2 escriben su progreso en stderr: se valida con $LASTEXITCODE.
  $ErrorActionPreference = "Continue"
  & $cfg.mkcert -cert-file $certFile -key-file $keyFile @($cfg.names) 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "mkcert falló (código $LASTEXITCODE)." }
  & $cfg.pm2 restart pos-server 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "El certificado se renovó pero pm2 no pudo reiniciar el servidor." }
  $ErrorActionPreference = "Stop"

  $nuevo = (New-Object Security.Cryptography.X509Certificates.X509Certificate2 $certFile).NotAfter
  Log "Certificado renovado: válido hasta $($nuevo.ToString('yyyy-MM-dd')). Servidor reiniciado."
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
