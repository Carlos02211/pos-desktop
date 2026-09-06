import { asc, eq, sql } from 'drizzle-orm'
import type { CategoryInput, CategoryWithCount } from '../../shared/types'
import type { CategoryRow } from '../db/schema'
import { categories, products } from '../db/schema'
import type { DB } from '../db'
import { HttpError } from '../lib/http-error'

/** Lista de categorías con el conteo de productos. `includeInactive` sólo para admin. */
export async function listCategories(
  db: DB,
  includeInactive = false
): Promise<CategoryWithCount[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      active: categories.active,
      productCount: sql<number>`count(${products.id})`
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.name))
  return includeInactive ? rows : rows.filter((r) => r.active === 1)
}

function normalizeName(name: string): string {
  return name.trim()
}

export async function createCategory(db: DB, input: CategoryInput): Promise<CategoryRow> {
  const name = normalizeName(input.name)
  const [existing] = await db.select().from(categories).where(eq(categories.name, name)).limit(1)
  if (existing) throw new HttpError(409, 'Ya existe una categoría con ese nombre.')

  const [row] = await db
    .insert(categories)
    .values({ name, active: input.active === false ? 0 : 1 })
    .returning()
  return row
}

export async function updateCategory(
  db: DB,
  id: number,
  input: CategoryInput
): Promise<CategoryRow> {
  const [current] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  if (!current) throw new HttpError(404, 'Categoría no encontrada.')

  const name = normalizeName(input.name)
  const [clash] = await db.select().from(categories).where(eq(categories.name, name)).limit(1)
  if (clash && clash.id !== id) throw new HttpError(409, 'Ya existe una categoría con ese nombre.')

  const [row] = await db
    .update(categories)
    .set({ name, active: input.active === false ? 0 : 1 })
    .where(eq(categories.id, id))
    .returning()
  return row
}

/**
 * Baja de categoría = desactivación (soft delete). Nunca se borra: los productos
 * y el historial pueden seguir referenciándola.
 */
export async function deactivateCategory(db: DB, id: number): Promise<void> {
  const [current] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  if (!current) throw new HttpError(404, 'Categoría no encontrada.')
  await db.update(categories).set({ active: 0 }).where(eq(categories.id, id))
}
