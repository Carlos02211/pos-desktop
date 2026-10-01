# Generar licencias desde el celular (en el negocio del cliente)

La clave privada de licencias vive **sólo** en la PC de desarrollo
(`~/.config/spartan-pos/license-private.pem`) y no sale de ahí. Estando en el negocio, el
celular entra a esa PC por **SSH a través de Tailscale** (VPN privada: sin abrir puertos en
ningún módem) y corre `lic <ID>`.

**Requisito el día de la instalación:** la PC de desarrollo **encendida** y con Tailscale.

## Una sola vez — PC de desarrollo (Linux)

1. **Tailscale:** `sudo pacman -S tailscale && sudo systemctl enable --now tailscaled && sudo tailscale up`
   (abre un enlace para iniciar sesión con tu cuenta). Anota la IP `100.x.y.z` (`tailscale ip -4`).
2. **SSH sólo con llave:**
   ```bash
   sudo install -m 644 deploy/dev/10-spartan-ssh.conf /etc/ssh/sshd_config.d/
   sudo sshd -t && sudo systemctl enable --now sshd
   ```
3. **Firewall (ufw): SSH sólo por Tailscale**, no desde la red de la casa:
   ```bash
   sudo ufw allow in on tailscale0 to any port 22 proto tcp
   ```
4. **Comando `lic`:** `ln -sf "$PWD/scripts/lic" ~/.local/bin/lic`

## Una sola vez — celular

1. Instalar **Tailscale** e iniciar sesión con **la misma cuenta**.
2. Instalar **Termius** (Android/iPhone). En Keychain → **Generate key** (tipo ED25519).
   Copiar la **llave pública** (`ssh-ed25519 AAAA…`) y mandártela (WhatsApp/correo).
3. En la PC: `echo 'ssh-ed25519 AAAA… celular' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
4. En Termius: nuevo host → IP `100.x.y.z` de la PC, usuario `spartan`, la llave del paso 2.
   Probar la conexión **desde casa con datos móviles** (WiFi apagado).

## En el negocio

1. Con el celular en el **WiFi del negocio**, abrir `https://<IP del servidor>:3000/`
   → pantalla **Activar licencia** → **Copiar ID**. (O en la PC servidor, y mandártelo.)
2. Termius → conectar a la PC → `lic <pegar ID>` → copiar la clave que imprime.
3. Pegar la clave en **Clave de activación** → **Activar**.

Anotar ID, clave y fecha en la ficha del cliente.

## Si algo falla

- **Termius no conecta:** la PC está apagada o suspendida, o Tailscale está apagado en la
  PC o en el celular (`tailscale status` en la PC).
- **`lic` dice que no existe la clave privada:** se corre en otra PC/usuario; la privada
  sólo está en `~/.config/spartan-pos/`.
- **"Copiar ID" no hace nada:** mantener presionado el ID y copiarlo a mano.
- **Plan B sin PC:** pedirle al cliente que te mande el ID por WhatsApp y activar después
  por teléfono cuando llegues a casa (el sistema no vende hasta activarse).
