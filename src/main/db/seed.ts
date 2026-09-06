import bcrypt from 'bcryptjs'
import { sql } from 'drizzle-orm'
import type { DB } from './index'
import { categories, config, products, users } from './schema'

const BCRYPT_ROUNDS = 12

const DEFAULT_CONFIG: Record<string, string> = {
  business_name: 'Mi Negocio',
  business_address: '',
  business_phone: '',
  logo_path: '',
  ticket_footer: '¡Gracias por su compra!',
  currency_symbol: '$',
  // Interfaz de node-thermal-printer. Vacío = impresión deshabilitada.
  // Ejemplos: "printer:XP-80T" (driver de Windows), "tcp://192.168.1.100:9100", "/dev/usb/lp0".
  printer_interface: '',
  // Carpeta de respaldo. Vacío = <userData>/backups. En el cliente se apunta al SSD de respaldo.
  backup_dir: ''
}

/**
 * Seed idempotente. Se ejecuta en cada arranque del Main Process:
 *  - si no hay usuarios, crea el ADMIN por defecto (admin / admin123),
 *    un COBRADOR de prueba (cajero / cajero123), una categoría y un producto.
 *  - rellena las claves de configuración que falten sin pisar las existentes.
 */
export async function runSeed(db: DB): Promise<void> {
  const [{ count }] = db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .all()

  if (count === 0) {
    const [adminHash, cobradorHash] = await Promise.all([
      bcrypt.hash('admin123', BCRYPT_ROUNDS),
      bcrypt.hash('cajero123', BCRYPT_ROUNDS)
    ])
    db.insert(users)
      .values([
        { username: 'admin', password: adminHash, role: 'ADMIN' },
        { username: 'cajero', password: cobradorHash, role: 'COBRADOR' }
      ])
      .run()

    const [cat] = db.insert(categories).values({ name: 'General' }).returning().all()
    db.insert(products).values({ name: 'Producto de prueba', price: 25, categoryId: cat.id }).run()

    console.log('[seed] Datos iniciales creados — admin/admin123 · cajero/cajero123')
  }

  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    db.insert(config).values({ key, value }).onConflictDoNothing().run()
  }
}
