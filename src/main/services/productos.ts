import { and, asc, eq, ne } from 'drizzle-orm'
import type { ProductInput, ProductWithCategory } from '../../shared/types'
import type { ProductRow } from '../db/schema'
import { categories, products } from '../db/schema'
import type { DB } from '../db'
import { isUniqueViolation } from '../lib/db-errors'
import { HttpError } from '../lib/http-error'
import { fromCents, toCents } from '../lib/money'

/** Fila de producto con el precio ya en pesos, lista para la API. */
function toApi<T extends { price: number }>(row: T): T {
  return { ...row, price: fromCents(row.price) }
}

const selection = {
  id: products.id,
  name: products.name,
  price: products.price,
  unit: products.unit,
  categoryId: products.categoryId,
  imagePath: products.imagePath,
  barcode: products.barcode,
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
  return rows.sort((a, b) => a.name.localeCompare(b.name)).map(toApi)
}

/** Compat: usado por el panel del cobrador (Sprint 2). */
export async function listActiveProducts(db: DB): Promise<ProductWithCategory[]> {
  const rows = await db
    .select(selection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.active, 1))
    .orderBy(asc(products.name))
  return rows.map(toApi)
}

export async function getProduct(db: DB, id: number): Promise<ProductRow> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1)
  if (!row) throw new HttpError(404, 'Producto no encontrado.')
  return row
}

/** Vacío = sin código. El lector no manda espacios; los de los extremos se ignoran. */
function normalizeBarcode(barcode: string | null | undefined): string | null {
  const code = barcode?.trim()
  return code ? code : null
}

/** 409 con el nombre del dueño del código: el admin sabe cuál producto corregir. */
async function assertBarcodeFree(db: DB, barcode: string, exceptId?: number): Promise<void> {
  const where =
    exceptId === undefined
      ? eq(products.barcode, barcode)
      : and(eq(products.barcode, barcode), ne(products.id, exceptId))
  const [owner] = await db
    .select({ name: products.name, active: products.active })
    .from(products)
    .where(where)
    .limit(1)
  if (owner) {
    const inactive = owner.active === 1 ? '' : ' (desactivado)'
    throw new HttpError(409, `El código ${barcode} ya es del producto "${owner.name}"${inactive}.`)
  }
}

/** El índice único es la última palabra: dos altas simultáneas con el mismo código. */
function barcodeClash(err: unknown, barcode: string | null): never {
  if (barcode && isUniqueViolation(err)) {
    throw new HttpError(409, `El código ${barcode} ya es de otro producto.`)
  }
  throw err
}

async function validateCategory(db: DB, categoryId: number | null): Promise<void> {
  if (categoryId == null) return
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1)
  if (!cat) throw new HttpError(400, 'La categoría indicada no existe.')
}

export async function createProduct(db: DB, input: ProductInput): Promise<ProductRow> {
  if (input.price < 0) throw new HttpError(400, 'El precio no puede ser negativo.')
  await validateCategory(db, input.categoryId)
  const barcode = normalizeBarcode(input.barcode)
  if (barcode) await assertBarcodeFree(db, barcode)
  const now = Math.floor(Date.now() / 1000)
  const [row] = await db
    .insert(products)
    .values({
      name: input.name.trim(),
      price: toCents(input.price),
      unit: input.unit === 'KG' ? 'KG' : 'PIEZA',
      categoryId: input.categoryId,
      barcode,
      active: input.active === false ? 0 : 1,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .catch((err: unknown) => barcodeClash(err, barcode))
  return toApi(row)
}

export async function updateProduct(db: DB, id: number, input: ProductInput): Promise<ProductRow> {
  await getProduct(db, id)
  if (input.price < 0) throw new HttpError(400, 'El precio no puede ser negativo.')
  await validateCategory(db, input.categoryId)
  // `barcode` omitido = se conserva (clientes que no conocen el campo no lo borran).
  const barcode = input.barcode === undefined ? undefined : normalizeBarcode(input.barcode)
  if (barcode) await assertBarcodeFree(db, barcode, id)
  // El cambio de precio aplica a ventas futuras; `sale_items` conserva el snapshot histórico.
  const [row] = await db
    .update(products)
    .set({
      name: input.name.trim(),
      price: toCents(input.price),
      unit: input.unit === 'KG' ? 'KG' : 'PIEZA',
      categoryId: input.categoryId,
      ...(barcode === undefined ? {} : { barcode }),
      active: input.active === false ? 0 : 1,
      updatedAt: Math.floor(Date.now() / 1000)
    })
    .where(eq(products.id, id))
    .returning()
    .catch((err: unknown) => barcodeClash(err, barcode ?? null))
  return toApi(row)
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
  return toApi(row)
}
