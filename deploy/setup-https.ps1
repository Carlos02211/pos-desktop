# HTTPS en la red local para el servidor POS SpArTaN Tech (mkcert). Idempotente.
#
# Crea una autoridad certificadora (CA) LOCAL propia de esta PC, emite con ella el
# certificado del servidor para su IP, activa HTTPS en el .env y reinicia el servidor.
# Las cajas/tabletas confían en esa CA una sola vez (se descarga de https://<IP>:3000/ca.crt).
#
# Requisitos: IP FIJA (.\ip-fija.ps1) — el certificado es para esa IP. Si la IP cambia,
# o para renovar el certificado (dura ~2 años), volver a correr este script.
#
# PowerShell COMO ADMINISTRADOR, en C:\pos-server:
#   .\setup-https.ps1                 # usa la IP actual de la PC
#   .\setup-https.ps1 -Ip <IP>
#
# La clave privada de la CA queda en la carpeta de mkcert del usuario que corre esto
# (mkcert -CAROOT), NO en C:\pos-server: quien la tenga podría emitir certificados en los
# que confían las tabletas. Renovar con el mismo usuario de Windows.

param(
  [string]$Ip,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

if (-not (Test-Path ".\.env")) { throw "No hay .env: corré primero .\setup-server.ps1." }

# --- IP --------------------------------------------------------------
Step "IP del servidor"
$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" |
  Sort-Object RouteMetric | Select-Object -First 1
$alias = $route.InterfaceAlias
if (-not $Ip) {
  $Ip = (Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 |
    Where-Object { $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
}
Write-Host "IP: $Ip  (adaptador '$alias')"
if ((Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4).Dhcp -eq "Enabled") {
  Write-Host "ATENCIÓN: '$alias' usa IP automática (DHCP). Si el router le cambia la IP, el" -ForegroundColor Yellow
  Write-Host "certificado deja de valer. Recomendado: .\ip-fija.ps1 antes de seguir." -ForegroundColor Yellow
  if ((Read-Host "¿Seguir igual con $Ip? (s/N)") -notmatch '^[sS]') { exit 1 }
}

# --- mkcert --------------------------------------------------------------
Step "mkcert"
if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  winget install -e --id FiloSottile.mkcert --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path","User")
  if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    throw "mkcert quedó instalado pero no está en el PATH: cerrá PowerShell, abrí otro como admin y volvé a correr."
  }
}

# mkcert escribe su progreso en stderr: se valida con $LASTEXITCODE (ver setup-server.ps1).
$ErrorActionPreference = "Continue"
# Instala la CA en el almacén de confianza de ESTA PC (Windows pide confirmar: "Sí").
mkcert -install
if ($LASTEXITCODE -ne 0) { throw "mkcert -install falló." }

New-Item -ItemType Directory -Force ".\certs" | Out-Null
$certFile = Join-Path $PSScriptRoot "certs\servidor.pem"
$keyFile  = Join-Path $PSScriptRoot "certs\servidor-key.pem"
$caFile   = Join-Path $PSScriptRoot "certs\CA-POS-SpArTaN.crt"
mkcert -cert-file $certFile -key-file $keyFile $Ip localhost 127.0.0.1 $env:COMPUTERNAME
if ($LASTEXITCODE -ne 0) { throw "mkcert no pudo generar el certificado." }
$caRoot = (mkcert -CAROOT).Trim()
$ErrorActionPreference = "Stop"
# Sólo el certificado PÚBLICO de la CA (rootCA.pem), nunca rootCA-key.pem.
Copy-Item (Join-Path $caRoot "rootCA.pem") $caFile -Force

# --- .env ------------------------------------------------------------------
Step ".env"
function Set-EnvValue([string[]]$lines, [string]$name, [string]$value) {
  $pattern = "^\s*#?\s*$name\s*="
  $found = $false
  $out = foreach ($l in $lines) {
    if (-not $found -and $l -match $pattern) { $found = $true; "$name=$value" }
    elseif ($found -and $l -match $pattern) { continue }  # duplicados
    else { $l }
  }
  if (-not $found) { $out += "$name=$value" }
  return ,$out
}
$lines = Get-Content ".\.env"
$lines = Set-EnvValue $lines "POS_TLS_KEY" $keyFile
$lines = Set-EnvValue $lines "POS_TLS_CERT" $certFile
$lines = Set-EnvValue $lines "POS_TLS_CA" $caFile
# UTF-8 sin BOM (Set-Content -Encoding UTF8 de PowerShell 5.1 agrega BOM).
[IO.File]::WriteAllLines((Join-Path $PSScriptRoot ".env"), $lines, (New-Object Text.UTF8Encoding $false))
Write-Host "POS_TLS_KEY / POS_TLS_CERT / POS_TLS_CA configurados."

# --- Reinicio + comprobación ----------------------------------------------------
Step "Reiniciar el servidor"
$ErrorActionPreference = "Continue"
pm2 restart pos-server
$ErrorActionPreference = "Stop"
Start-Sleep -Seconds 3
# PowerShell 5.1 negocia TLS 1.0 por defecto; Node exige 1.2+.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
  $ping = Invoke-RestMethod "https://localhost:$Port/api/ping" -TimeoutSec 5
  Write-Host "  https://localhost:$Port/api/ping → engine=$($ping.engine) db=$($ping.db)" -ForegroundColor Green
} catch {
  Write-Host "  No respondió por HTTPS — revisá 'pm2 logs pos-server'. ($($_.Exception.Message))" -ForegroundColor Yellow
}

$notAfter = (New-Object Security.Cryptography.X509Certificates.X509Certificate2 $certFile).NotAfter
Write-Host ""
Write-Host "Listo. Certificado válido hasta: $($notAfter.ToString('yyyy-MM-dd'))  (anotalo para renovarlo)" -ForegroundColor Green
Write-Host ""
Write-Host "Las cajas ahora entran por:   https://${Ip}:$Port/" -ForegroundColor Cyan
Write-Host "En CADA caja/tableta, una sola vez, instalar la CA:"
Write-Host "  1. Abrir https://${Ip}:$Port/ca.crt  (el navegador avisa 'no seguro': continuar)"
Write-Host "  2. Android: Ajustes > Seguridad > Más ajustes > Cifrado y credenciales >"
Write-Host "     Instalar un certificado > Certificado de CA > elegir CA-POS-SpArTaN.crt"
Write-Host "     iPhone/iPad: instalar el perfil descargado y luego Ajustes > General >"
Write-Host "     Información > Ajustes de confianza de certificados > activarlo"
Write-Host "     Windows: doble clic al .crt > Instalar certificado > Equipo local >"
Write-Host "     'Entidades de certificación raíz de confianza'"
Write-Host "  3. Cerrar y abrir el navegador: https://${Ip}:$Port/ sin avisos."
