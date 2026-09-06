import { asc, eq } from 'drizzle-orm'
import type { ProductInput, ProductWithCategory } from '../../shared/types'
import type { ProductRow } from '../db/schema'
import { categories, products } from '../db/schema'
import type { DB } from '../db'
import { HttpError } from '../lib/http-error'
import { round2 } from '../lib/money'

const selection = {
  id: products.id,
  name: products.name,
  price: products.price,
  categoryId: products.categoryId,
  imagePath: products.imagePath,
  active: products.active,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
  categoryName: categories.name
}

/** Productos, con el nombre de su categoría, ordenados por nombre. */
export async function listProducts(
  db: DB,
  includeInactive = false
): Promise<ProductWithCategory[]> {
  const base = db
    .select(selection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
  const rows = includeInactive ? await base : await base.where(eq(products.active, 1))
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/** Compat: usado por el panel del cobrador (Sprint 2). */
export async function listActiveProducts(db: DB): Promise<ProductWithCategory[]> {
  return db
    .select(selection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.active, 1))
    .orderBy(asc(products.name))
}

export async function getProduct(db: DB, id: number): Promise<ProductRow> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1)
  if (!row) throw new HttpError(404, 'Producto no encontrado.')
  return row
}

async function validateCategory(db: DB, categoryId: number | null): Promise<void> {
  if (categoryId == null) return
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1)
  if (!cat) throw new HttpError(400, 'La categoría indicada no existe.')
}

export async function createProduct(db: DB, input: ProductInput): Promise<ProductRow> {
  if (input.price < 0) throw new HttpError(400, 'El precio no puede ser negativo.')
  await validateCategory(db, input.categoryId)
  const now = Math.floor(Date.now() / 1000)
  const [row] = await db
    .insert(products)
    .values({
      name: input.name.trim(),
      price: round2(input.price),
      categoryId: input.categoryId,
      active: input.active === false ? 0 : 1,
      createdAt: now,
      updatedAt: now
    })
    .returning()
  return row
}

export async function updateProduct(db: DB, id: number, input: ProductInput): Promise<ProductRow> {
  await getProduct(db, id)
  if (input.price < 0) throw new HttpError(400, 'El precio no puede ser negativo.')
  await validateCategory(db, input.categoryId)
  // El cambio de precio aplica a ventas futuras; `sale_items` conserva el snapshot histórico.
  const [row] = await db
    .update(products)
    .set({
      name: input.name.trim(),
      price: round2(input.price),
      categoryId: input.categoryId,
      active: input.active === false ? 0 : 1,
      updatedAt: Math.floor(Date.now() / 1000)
    })
    .where(eq(products.id, id))
    .returning()
  return row
}

/** Soft delete: nunca se borra un producto (el historial de ventas lo referencia). */
export async function deactivateProduct(db: DB, id: number): Promise<void> {
  await getProduct(db, id)
  await db
    .update(products)
    .set({ active: 0, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(products.id, id))
}

export async function setProductImage(
  db: DB,
  id: number,
  relativePath: string
): Promise<ProductRow> {
  await getProduct(db, id)
  const [row] = await db
    .update(products)
    .set({ imagePath: relativePath, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(products.id, id))
    .returning()
  return row
}
