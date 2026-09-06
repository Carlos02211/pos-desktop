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
  currency_symbol: '$'
}

/**
 * Seed idempotente. Se ejecuta en cada arranque del Main Process:
 *  - si no hay usuarios, crea el ADMIN por defecto (admin / admin123),
 *    una categoría y un producto de prueba.
 *  - rellena las claves de configuración que falten sin pisar las existentes.
 */
export async function runSeed(db: DB): Promise<void> {
  const [{ count }] = db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .all()

  if (count === 0) {
    const passwordHash = await bcrypt.hash('admin123', BCRYPT_ROUNDS)
    db.insert(users).values({ username: 'admin', password: passwordHash, role: 'ADMIN' }).run()

    const [cat] = db.insert(categories).values({ name: 'General' }).returning().all()
    db.insert(products).values({ name: 'Producto de prueba', price: 25, categoryId: cat.id }).run()

    console.log('[seed] Datos iniciales creados — usuario: admin / admin123')
  }

  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    db.insert(config).values({ key, value }).onConflictDoNothing().run()
  }
}
