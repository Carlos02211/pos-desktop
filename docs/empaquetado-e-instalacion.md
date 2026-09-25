# Empaquetado e instalación (Windows)

## Generar el instalador `.exe`

El instalador NSIS **debe generarse en Windows** (o en CI de Windows). electron-builder
no puede crear el `.exe` desde Linux/macOS sin Wine.

En un equipo Windows 10/11 x64 con Node **22** y pnpm:

```powershell
pnpm install
pnpm build:win        # = pnpm build + electron-builder --win
```

No hace falta ningún secreto para compilar: el `.exe` sólo lleva la clave **pública** de
licencias (`PRODUCTION_PUBLIC_KEY` en `src/main/services/license.ts`), que no permite
fabricar claves. La privada nunca sale de la máquina del proveedor.

Salida: `dist-electron/pos-spartan-tech-<versión>-setup.exe`

> El `.exe` **no está firmado con certificado** (decisión de coste para negocios chicos):
> SmartScreen mostrará una advertencia la primera vez. "Más información" → "Ejecutar de
> todas formas". Publicar el hash SHA-256 del `.exe` junto al instalador para que el cliente
> pueda verificarlo.

Validación multiplataforma (sin generar el `.exe`, sirve para revisar el empaquetado):

```bash
pnpm build && pnpm exec electron-builder --dir
```

Esto produce `dist-electron/<plataforma>-unpacked/`. Comprobado: arranca, aplica las
migraciones desde `resources/migrations` (empaquetadas como `extraResources`), carga
el binario nativo de `better-sqlite3` (`asarUnpack` de `**/*.node`) y ejecuta el seed.

## Instalación en el equipo del cliente

1. Copiar `pos-spartan-tech-<versión>-setup.exe` al equipo.
2. Ejecutar el instalador. NSIS pregunta la carpeta de instalación (no es "one-click").
3. Al primer arranque la app crea la base de datos en
   `%APPDATA%\pos-spartan-tech\pos.db` y muestra la **pantalla de activación**.
4. Copiar el **ID del equipo** que muestra la pantalla y generar la clave con
   `pnpm license:gen <ID>` en el equipo del proveedor (firma con la clave privada de
   `~/.config/spartan-pos/license-private.pem`).
5. Pegar la clave y activar. Entrar con `admin / admin123` y cambiar la contraseña
   desde **Admin → Usuarios**.
6. En **Admin → Configuración**: nombre del negocio, logo, pie de ticket, símbolo de
   moneda, **interfaz de la impresora** (p. ej. `printer:XP-80T`) y la **carpeta de
   respaldo** (apuntarla al SSD secundario).
7. Crear los usuarios cobradores y cargar el catálogo de productos.

## Desinstalación

Panel de Control → Programas → _POS SpArTaN Tech_ → Desinstalar. El desinstalador NSIS
quita la app y sus accesos directos. Los datos del negocio en `%APPDATA%\pos-spartan-tech`
**no se borran** (para no perder ventas por error); eliminarlos a mano si se desea.
