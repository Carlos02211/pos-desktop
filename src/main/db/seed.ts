import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { sql } from 'drizzle-orm'
import type { DB } from './index'
import { categories, config, customers, products, users } from './schema'

const BCRYPT_ROUNDS = 12

const DEFAULT_CONFIG: Record<string, string> = {
  business_name: 'Mi Negocio',
  business_address: '',
  business_phone: '',
  logo_path: '',
  ticket_footer: '¡Gracias por su compra!',
  currency_symbol: '$',
  // Minutos respecto de UTC para calcular "hoy" y los tramos de los reportes.
  // Vacío = usa el huso del servidor. Ej.: -360 (GMT-6, centro de México).
  business_utc_offset: '',
  // Descuento máximo (%) que un cobrador puede aplicar al editar el precio de una
  // línea. '100' = sin límite (comportamiento por defecto). '0' = no se puede editar.
  max_line_discount_pct: '100',
  // Interfaz de node-thermal-printer. Vacío = impresión deshabilitada.
  // Ejemplos: "printer:XP-80T" (driver de Windows), "tcp://192.168.1.100:9100", "/dev/usb/lp0".
  printer_interface: '',
  // Carpeta de respaldo. Vacío = <userData>/backups. En el cliente se apunta al SSD de respaldo.
  backup_dir: ''
}

export interface SeedOptions {
  /**
   * `production` = servidor standalone de Fase 2 expuesto en la LAN. En ese modo:
   *  - NO se crea el cajero de prueba ni los datos demo,
   *  - la contraseña del admin sale de `POS_ADMIN_PASSWORD` o se genera al azar
   *    y se imprime una sola vez (nunca se deja `admin123`).
   * Por defecto (Electron de escritorio / dev / tests) se usan las credenciales
   * conocidas `admin/admin123` y `cajero/cajero123` + datos demo.
   */
  production?: boolean
}

function generatePassword(): string {
  // 18 chars base64url — suficiente entropía, legible para dictárselo al dueño una vez.
  return randomBytes(14).toString('base64').replace(/[+/=]/g, '').slice(0, 18)
}

/**
 * Seed idempotente. Se ejecuta en cada arranque:
 *  - si no hay usuarios, crea el ADMIN (y en modo no-producción un COBRADOR de
 *    prueba, una categoría y un producto).
 *  - rellena las claves de configuración que falten sin pisar las existentes.
 */
export async function runSeed(db: DB, opts: SeedOptions = {}): Promise<void> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users)

  if (Number(count) === 0) {
    if (opts.production) {
      const provided = process.env.POS_ADMIN_PASSWORD?.trim()
      if (provided && provided.length < 8) {
        throw new Error('POS_ADMIN_PASSWORD debe tener al menos 8 caracteres.')
      }
      const adminPassword = provided || generatePassword()
      await db.insert(users).values({
        username: 'admin',
        password: await bcrypt.hash(adminPassword, BCRYPT_ROUNDS),
        role: 'ADMIN'
      })

      if (provided) {
        console.log('[seed] Usuario "admin" creado con la contraseña de POS_ADMIN_PASSWORD.')
      } else {
        console.log(
          '\n' +
            '========================================================================\n' +
            '  POS SpArTaN Tech — usuario administrador inicial\n' +
            `    usuario:     admin\n` +
            `    contraseña:  ${adminPassword}\n` +
            '  Anótala ahora y cámbiala desde el panel. No vuelve a mostrarse.\n' +
            '========================================================================\n'
        )
      }
    } else {
      const [adminHash, cobradorHash] = await Promise.all([
        bcrypt.hash('admin123', BCRYPT_ROUNDS),
        bcrypt.hash('cajero123', BCRYPT_ROUNDS)
      ])
      await db.insert(users).values([
        { username: 'admin', password: adminHash, role: 'ADMIN' },
        { username: 'cajero', password: cobradorHash, role: 'COBRADOR' }
      ])

      const [cat] = await db.insert(categories).values({ name: 'General' }).returning()
      // price en centavos: $25.00
      await db
        .insert(products)
        .values({ name: 'Producto de prueba', price: 2500, categoryId: cat.id })
      await db.insert(customers).values({ name: 'Cliente de prueba', phone: '' })

      console.log('[seed] Datos iniciales creados — admin/admin123 · cajero/cajero123')
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    await db.insert(config).values({ key, value }).onConflictDoNothing()
  }
}
