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

### Requisitos de red (explicárselos al cliente)

- **No necesita internet.** Ni la PC servidor ni las cajas. La licencia se valida en el mismo
  equipo. Si se cae el internet, se sigue vendiendo.
- **Sí necesita una red local**: el módem/router del proveedor (o uno propio) con WiFi o
  cable. El módem hace dos cosas: internet y la red interna; el POS sólo usa la red interna,
  que sigue funcionando **mientras el router tenga luz**, aunque no haya servicio.
- **Celulares, tabletas, laptops y otras PC** entran al POS conectados al **WiFi del
  negocio** (o por cable), en `https://<IP>:3000/`. Con **datos móviles (4G/5G) no
  entran**: están fuera de la red aunque tengan internet.
- **Red principal, no la de invitados**: la de invitados aísla a los equipos y no ven al
  servidor.
- **Certificado en cada equipo nuevo**, una sola vez (guía, parte HTTPS paso 4). Sin él
  sale "No es seguro" y no se puede instalar como app.
- **IP fija del servidor** reservada en el router. Si el proveedor cambia o resetea su
  módem, la reserva se pierde → recomendable un **router propio** barato detrás del módem
  del proveedor.
- **No-break** para la PC servidor **y** el router: sin router, las cajas no ven al
  servidor aunque la PC siga prendida.
- **Acceso desde fuera del negocio** (p. ej. el dueño desde su casa): ése sí necesita
  internet y **no viene configurado**. Si lo piden: VPN (Tailscale), **nunca** abrir el
  puerto 3000 en el módem.

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
| Carpeta de respaldos (otro disco / USB, **no** `Z:` ni unidad de red) |         |
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
- [ ] Con el internet **desconectado** (cable del proveedor fuera) se sigue vendiendo
- [ ] Venta de prueba desde dos cajas a la vez (folios correctos)
- [ ] Cierre de caja cuadra; aparece en Admin → Cortes de caja
- [ ] "Respaldar ahora" OK y **restauración probada** en `pos_restaurada`, código 0 y conteos iguales (guía B8)
- [ ] Hoja de prueba de la impresora (si tiene)
- [ ] Contraseña de `admin` cambiada y guardada en el gestor
- [ ] Capacitación: cobrador (venta, efectivo, cierre) y admin (productos, cortes, reportes)
