# Ficha del cliente — POS SpArTaN Tech

Una copia por instalación (guardarla en la carpeta del cliente, **fuera del repo**). Se
llena durante la instalación siguiendo [`fase-2-instalacion-windows.md`](fase-2-instalacion-windows.md).

> **Contraseñas NO van en esta ficha** (PostgreSQL, `admin`, router). Guardarlas en el
> gestor de contraseñas y anotar acá sólo **dónde** están.

## Cliente

| Dato                 | Valor                       |
| -------------------- | --------------------------- |
| Negocio              |                             |
| Contacto / teléfono  |                             |
| Dirección            |                             |
| Fecha de instalación |                             |
| Versión instalada    | (commit / fecha del bundle) |

## PC servidor

| Dato                                     | Valor                |
| ---------------------------------------- | -------------------- |
| Nombre del equipo (`hostname`)           |                      |
| Windows (versión)                        |                      |
| Adaptador de red / MAC (`ipconfig /all`) |                      |
| **IP fija**                              |                      |
| URL de las cajas                         | `https://<IP>:3000/` |
| No-break (UPS) para PC y módem           | sí / no              |

## Red (router del proveedor)

| Dato                                        | Valor                    |
| ------------------------------------------- | ------------------------ |
| Proveedor (izzi, Telmex, Totalplay, …)      |                          |
| Puerta de enlace (IP del router)            |                          |
| Rango DHCP del router                       |                          |
| IP reservada en el router / fuera de rango  | reserva / fuera de rango |
| Acceso al router (dónde está la contraseña) |                          |
| Tabletas en la red principal (no invitados) | sí / no                  |

## Licencia

| Dato                               | Valor |
| ---------------------------------- | ----- |
| ID del equipo                      |       |
| Clave emitida (`pnpm license:gen`) |       |
| Fecha de activación                |       |

Si cambian disco, placa de red o **nombre del equipo**, el ID cambia: emitir una clave nueva.

## HTTPS

| Dato                                                    | Valor   |
| ------------------------------------------------------- | ------- |
| Certificado válido hasta (lo muestra `setup-https.ps1`) |         |
| Tarea "renovar certificado" registrada                  | sí / no |
| Dispositivos con la CA instalada                        |         |

## Respaldos e impresora

| Dato                                    | Valor   |
| --------------------------------------- | ------- |
| Carpeta de respaldos (otro disco / USB) |         |
| `icacls` aplicado a esa carpeta         | sí / no |
| Impresora (modelo / USB o red / IP)     |         |

## Usuarios

| Usuario | Rol           | Dónde está la contraseña |
| ------- | ------------- | ------------------------ |
| admin   | Administrador |                          |
|         | Cobrador      |                          |

## Entrega — verificado

- [ ] `https://<IP>:3000/` abre con candado en cada caja/tableta
- [ ] Reinicio de la PC **sin iniciar sesión** → el POS responde solo
- [ ] Venta de prueba desde dos cajas a la vez (folios correctos)
- [ ] Cierre de caja cuadra; aparece en Admin → Cortes de caja
- [ ] "Respaldar ahora" OK y **restauración probada** (guía B8)
- [ ] Hoja de prueba de la impresora (si tiene)
- [ ] Contraseña de `admin` cambiada y guardada en el gestor
- [ ] Capacitación: cobrador (venta, efectivo, cierre) y admin (productos, cortes, reportes)
