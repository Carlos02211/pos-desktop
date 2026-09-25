# IP fija para la PC servidor del POS SpArTaN Tech.
#
# Las cajas/tabletas entran por http(s)://<IP>:3000 y el certificado HTTPS se emite para
# esa IP: si el router se la cambia (DHCP), el POS deja de estar donde lo buscan.
#
# Por defecto propone la configuración ACTUAL (la que dio el DHCP) como fija. Antes de
# confirmar, asegurate de que esa IP no la vaya a repartir el router a otro equipo:
#   - o reservala en el router para esta PC (reserva DHCP por MAC),
#   - o elegí una IP FUERA del rango DHCP del router (-Ip <IP>).
#   El rango depende del proveedor/router: ver la guía de instalación, B7.
#
# PowerShell COMO ADMINISTRADOR, en la consola de la PC (no por escritorio remoto: si algo
# sale mal se pierde la conexión):
#   .\ip-fija.ps1                          # usa la IP/puerta de enlace/DNS actuales
#   .\ip-fija.ps1 -Ip <IP>                 # otra IP (misma red, fuera del rango DHCP)
#   .\ip-fija.ps1 -Dns <DNS1>,<DNS2>       # otros DNS
#   .\ip-fija.ps1 -VolverADhcp             # deshace: vuelve a IP automática
#
# Después de cambiarla: si ya había HTTPS, correr de nuevo .\setup-https.ps1 (el
# certificado es para la IP).

param(
  [string]$Ip,
  [int]$PrefixLength,
  [string]$Gateway,
  [string[]]$Dns,
  [switch]$VolverADhcp
)

$ErrorActionPreference = "Stop"

# El adaptador que sale a la red es el que tiene la ruta por defecto.
$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" |
  Sort-Object RouteMetric | Select-Object -First 1
if ($route) {
  $alias = $route.InterfaceAlias
} elseif ($VolverADhcp) {
  # Sin ruta (p. ej. una IP fija mal puesta): usar el primer adaptador físico conectado.
  $alias = (Get-NetAdapter -Physical | Where-Object Status -eq "Up" | Select-Object -First 1).Name
  if (-not $alias) { throw "No hay ningún adaptador de red conectado." }
} else {
  throw "No hay ruta por defecto: esta PC no está conectada a la red."
}
$current = Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 |
  Where-Object { $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1
$dhcp = (Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4).Dhcp

function Clear-IPv4 {
  Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Remove-NetIPAddress -Confirm:$false
  Get-NetRoute -InterfaceAlias $alias -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
    Remove-NetRoute -Confirm:$false
}

if ($VolverADhcp) {
  Clear-IPv4
  Set-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -Dhcp Enabled
  Set-DnsClientServerAddress -InterfaceAlias $alias -ResetServerAddresses
  Write-Host "'$alias' volvió a IP automática (DHCP). Puede tardar unos segundos en tomar IP." -ForegroundColor Green
  exit 0
}

if (-not $Ip) { $Ip = $current.IPAddress }
if (-not $PrefixLength) { $PrefixLength = $current.PrefixLength }
if (-not $Gateway) { $Gateway = $route.NextHop }
if (-not $Dns) {
  $Dns = (Get-DnsClientServerAddress -InterfaceAlias $alias -AddressFamily IPv4).ServerAddresses
  if (-not $Dns) { $Dns = @($Gateway) }
}

Write-Host ""
Write-Host "Adaptador:        $alias   (DHCP: $dhcp)"
Write-Host "Actual:           $($current.IPAddress)/$($current.PrefixLength)  puerta $($route.NextHop)"
Write-Host ""
Write-Host "Se va a fijar:    $Ip/$PrefixLength" -ForegroundColor Cyan
Write-Host "Puerta de enlace: $Gateway" -ForegroundColor Cyan
Write-Host "DNS:              $($Dns -join ', ')" -ForegroundColor Cyan
Write-Host ""
Write-Host "Esa IP tiene que estar reservada en el router para esta PC, o fuera del rango DHCP." -ForegroundColor Yellow
$answer = Read-Host "¿Aplicar? (s/N)"
if ($answer -notmatch '^[sS]') { Write-Host "Sin cambios."; exit 0 }

# Quitar la IP y la ruta que dio el DHCP antes de poner las fijas (si no, quedan las dos).
Set-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -Dhcp Disabled
Clear-IPv4
New-NetIPAddress -InterfaceAlias $alias -IPAddress $Ip -PrefixLength $PrefixLength -DefaultGateway $Gateway | Out-Null
Set-DnsClientServerAddress -InterfaceAlias $alias -ServerAddresses $Dns

Start-Sleep -Seconds 3
if (Test-Connection -ComputerName $Gateway -Count 1 -Quiet) {
  Write-Host "IP fija aplicada: $Ip — la puerta de enlace responde." -ForegroundColor Green
} else {
  Write-Host "IP aplicada, pero la puerta de enlace $Gateway no responde al ping (algunos routers no contestan)." -ForegroundColor Yellow
  Write-Host "Comprobá que haya red. Para deshacer:  .\ip-fija.ps1 -VolverADhcp" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Las cajas entran por:  http://${Ip}:3000/   (https:// si ya corriste setup-https.ps1)"
Write-Host "Si ya había HTTPS y la IP cambió: correr de nuevo .\setup-https.ps1"
