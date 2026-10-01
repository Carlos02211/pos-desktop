import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type {
  ProductComponent,
  ProductInput,
  ProductOption,
  ProductOptionInput,
  ProductWithCategory
} from '../../shared/types'
import type { ProductRow } from '../db/schema'
import { categories, productComponents, productOptions, products } from '../db/schema'
import type { DB } from '../db'
import { withTx } from '../db/tx'
import { isUniqueViolation } from '../lib/db-errors'
import { HttpError } from '../lib/http-error'
import { fromCents, round3, toCents } from '../lib/money'
import { setProductTracking } from './inventario'

/** Fila de producto con el precio ya en pesos, lista para la API. */
function toApi<T extends { price: number; stock: number; minStock: number | null }>(row: T): T {
  return {
    ...row,
    price: fromCents(row.price),
    stock: round3(Number(row.stock)),
    minStock: row.minStock == null ? null : Number(row.minStock)
  }
}

/** Mínimo para el aviso "por agotarse": vacío/null = sin aviso. */
function checkMinStock(minStock: number | null | undefined): void {
  if (minStock != null && (!Number.isFinite(minStock) || minStock < 0)) {
    throw new HttpError(400, 'La existencia mínima no puede ser negativa.')
  }
}

const selection = {
  id: products.id,
  name: products.name,
  price: products.price,
  unit: products.unit,
  categoryId: products.categoryId,
  imagePath: products.imagePath,
  barcode: products.barcode,
  openPrice: products.openPrice,
  trackStock: products.trackStock,
  stock: products.stock,
  minStock: products.minStock,
  active: products.active,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
  categoryName: categories.name
}

/** Sólo los productos del catálogo: el interno de anticipos de encargos no se lista. */
const isCatalog = eq(products.kind, 'NORMAL')

/** Opciones (activas, en orden) y contenido de cada producto, para la API. */
type ProductListRow = Omit<ProductWithCategory, 'options' | 'components'>

async function withExtras(db: DB, rows: ProductListRow[]): Promise<ProductWithCategory[]> {
  const ids = rows.map((r) => r.id)
  const options = new Map<number, ProductOption[]>()
  const components = new Map<number, ProductComponent[]>()
  if (ids.length > 0) {
    const optionRows = await db
      .select()
      .from(productOptions)
      .where(and(inArray(productOptions.productId, ids), eq(productOptions.active, 1)))
      .orderBy(asc(productOptions.sortOrder), asc(productOptions.id))
    for (const o of optionRows) {
      const list = options.get(o.productId) ?? []
      list.push({
        id: o.id,
        groupName: o.groupName,
        name: o.name,
        price: fromCents(o.price),
        sortOrder: o.sortOrder
      })
      options.set(o.productId, list)
    }
    const componentRows = await db
      .select({
        productId: productComponents.productId,
        componentId: productComponents.componentId,
        quantity: productComponents.quantity,
        name: products.name,
        unit: products.unit
      })
      .from(productComponents)
      .innerJoin(products, eq(products.id, productComponents.componentId))
      .where(inArray(productComponents.productId, ids))
      .orderBy(asc(productComponents.id))
    for (const c of componentRows) {
      const list = components.get(c.productId) ?? []
      list.push({
        componentId: c.componentId,
        name: c.name,
        unit: c.unit,
        quantity: round3(Number(c.quantity))
      })
      components.set(c.productId, list)
    }
  }
  return rows.map((r) => ({
    ...toApi(r),
    options: options.get(r.id) ?? [],
    components: components.get(r.id) ?? []
  }))
}

function selectRows(db: DB, activeOnly: boolean): Promise<ProductListRow[]> {
  return db
    .select(selection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(activeOnly ? and(isCatalog, eq(products.active, 1)) : isCatalog)
    .orderBy(asc(products.name))
}

/** Productos, con el nombre de su categoría, ordenados por nombre. */
export async function listProducts(
  db: DB,
  includeInactive = false
): Promise<ProductWithCategory[]> {
  const rows = await selectRows(db, !includeInactive)
  return withExtras(
    db,
    rows.sort((a, b) => a.name.localeCompare(b.name))
  )
}

/** Compat: usado por el panel del cobrador (Sprint 2). */
export async function listActiveProducts(db: DB): Promise<ProductWithCategory[]> {
  return withExtras(db, await selectRows(db, true))
}

/** Un producto como lo devuelve la lista (con categoría, opciones y contenido). */
export async function getProductWithExtras(db: DB, id: number): Promise<ProductWithCategory> {
  const rows = await db
    .select(selection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id))
  if (rows.length === 0) throw new HttpError(404, 'Producto no encontrado.')
  return (await withExtras(db, rows))[0]
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

/** Nombre limpio: sin espacios de más ("Aguacate  Hass " → "Aguacate Hass"). */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * Dos productos ACTIVOS no pueden llamarse igual, sin importar mayúsculas: en el grid del
 * cobrador serían indistinguibles. Uno desactivado sí puede repetirse (se da de alta otro).
 */
async function assertNameFree(db: DB, name: string, exceptId?: number): Promise<void> {
  const sameName = and(sql`lower(${products.name}) = ${name.toLowerCase()}`, eq(products.active, 1))
  const [owner] = await db
    .select({ name: products.name })
    .from(products)
    .where(exceptId === undefined ? sameName : and(sameName, ne(products.id, exceptId)))
    .limit(1)
  if (owner) throw new HttpError(409, `Ya existe un producto llamado "${owner.name}".`)
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

export async function createProduct(
  db: DB,
  input: ProductInput,
  userId: number
): Promise<ProductWithCategory> {
  if (input.price < 0) throw new HttpError(400, 'El precio no puede ser negativo.')
  checkMinStock(input.minStock)
  checkOptions(input.options ?? [], input.openPrice === true)
  await validateCategory(db, input.categoryId)
  const barcode = normalizeBarcode(input.barcode)
  if (barcode) await assertBarcodeFree(db, barcode)
  const name = normalizeName(input.name)
  if (input.active !== false) await assertNameFree(db, name)
  const now = Math.floor(Date.now() / 1000)
  return withTx(db, async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        name,
        price: toCents(input.price),
        unit: input.unit === 'KG' ? 'KG' : 'PIEZA',
        categoryId: input.categoryId,
        barcode,
        openPrice: input.openPrice ? 1 : 0,
        minStock: input.minStock ?? null,
        active: input.active === false ? 0 : 1,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .catch((err: unknown) => barcodeClash(err, barcode))
    if (input.options?.length) await saveOptions(tx, row.id, input.options)
    if (input.components?.length) await saveComponents(tx, row.id, input.components)
    if (input.trackStock) await setProductTracking(tx, userId, row.id, true, input.initialStock)
    return getProductWithExtras(tx, row.id)
  })
}

export async function updateProduct(
  db: DB,
  id: number,
  input: ProductInput,
  userId: number
): Promise<ProductWithCategory> {
  const current = await getProduct(db, id)
  if (current.kind !== 'NORMAL') throw new HttpError(404, 'Producto no encontrado.')
  if (input.price < 0) throw new HttpError(400, 'El precio no puede ser negativo.')
  checkMinStock(input.minStock)
  if (input.options !== undefined) {
    checkOptions(input.options, input.openPrice ?? current.openPrice === 1)
  }
  await validateCategory(db, input.categoryId)
  // `barcode` omitido = se conserva (clientes que no conocen el campo no lo borran).
  const barcode = input.barcode === undefined ? undefined : normalizeBarcode(input.barcode)
  if (barcode) await assertBarcodeFree(db, barcode, id)
  const name = normalizeName(input.name)
  if (input.active !== false) await assertNameFree(db, name, id)
  // El cambio de precio aplica a ventas futuras; `sale_items` conserva el snapshot histórico.
  return withTx(db, async (tx) => {
    await tx
      .update(products)
      .set({
        name,
        price: toCents(input.price),
        unit: input.unit === 'KG' ? 'KG' : 'PIEZA',
        categoryId: input.categoryId,
        ...(barcode === undefined ? {} : { barcode }),
        ...(input.openPrice === undefined ? {} : { openPrice: input.openPrice ? 1 : 0 }),
        ...(input.minStock === undefined ? {} : { minStock: input.minStock }),
        active: input.active === false ? 0 : 1,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(products.id, id))
      .catch((err: unknown) => barcodeClash(err, barcode ?? null))
    if (input.options !== undefined) await saveOptions(tx, id, input.options)
    if (input.components !== undefined) await saveComponents(tx, id, input.components)
    if (input.trackStock !== undefined) {
      await setProductTracking(tx, userId, id, input.trackStock, input.initialStock)
    }
    return getProductWithExtras(tx, id)
  })
}

const MAX_OPTIONS = 40
const MAX_COMPONENTS = 30

/** Opciones válidas: nombre y grupo con texto, sin repetir dentro del grupo, extra >= 0. */
function checkOptions(options: ProductOptionInput[], openPrice: boolean): void {
  if (options.length === 0) return
  if (openPrice) {
    throw new HttpError(
      400,
      'Un producto de precio libre no lleva opciones: el importe se escribe.'
    )
  }
  if (options.length > MAX_OPTIONS) {
    throw new HttpError(400, `Máximo ${MAX_OPTIONS} opciones por producto.`)
  }
  const seen = new Set<string>()
  for (const o of options) {
    const group = normalizeName(o.groupName)
    const name = normalizeName(o.name)
    if (!group || !name) throw new HttpError(400, 'Cada opción necesita grupo y nombre.')
    if (!Number.isFinite(o.price) || o.price < 0) {
      throw new HttpError(400, `El precio extra de "${name}" no puede ser negativo.`)
    }
    const key = `${group.toLowerCase()}|${name.toLowerCase()}`
    if (seen.has(key)) throw new HttpError(400, `La opción "${name}" está repetida en "${group}".`)
    seen.add(key)
  }
}

/**
 * Deja las opciones del producto como vienen: las que traen `id` se editan, las nuevas se
 * crean y las que ya no vienen se desactivan (una opción vendida no se borra).
 */
async function saveOptions(
  tx: DB,
  productId: number,
  options: ProductOptionInput[]
): Promise<void> {
  const existing = await tx
    .select({ id: productOptions.id })
    .from(productOptions)
    .where(eq(productOptions.productId, productId))
  const ownIds = new Set(existing.map((o) => o.id))
  const kept = new Set<number>()
  for (const [i, o] of options.entries()) {
    const values = {
      groupName: normalizeName(o.groupName),
      name: normalizeName(o.name),
      price: toCents(o.price),
      sortOrder: i,
      active: 1
    }
    if (o.id != null) {
      if (!ownIds.has(o.id)) throw new HttpError(400, 'Una de las opciones no es de este producto.')
      kept.add(o.id)
      await tx.update(productOptions).set(values).where(eq(productOptions.id, o.id))
    } else {
      await tx.insert(productOptions).values({ productId, ...values })
    }
  }
  const removed = [...ownIds].filter((oid) => !kept.has(oid))
  if (removed.length > 0) {
    await tx.update(productOptions).set({ active: 0 }).where(inArray(productOptions.id, removed))
  }
}

/**
 * Contenido del paquete: reemplaza el anterior. Un componente no puede ser el mismo producto
 * ni otro paquete (así el inventario se descuenta en un solo nivel y no hay ciclos).
 */
async function saveComponents(
  tx: DB,
  productId: number,
  components: { componentId: number; quantity: number }[]
): Promise<void> {
  if (components.length > MAX_COMPONENTS) {
    throw new HttpError(400, `Un paquete lleva máximo ${MAX_COMPONENTS} productos.`)
  }
  const ids = components.map((c) => c.componentId)
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'Un producto está repetido en el contenido: súmale la cantidad.')
  }
  if (ids.includes(productId)) {
    throw new HttpError(400, 'Un paquete no puede contenerse a sí mismo.')
  }
  if (components.some((c) => !Number.isFinite(c.quantity) || c.quantity <= 0)) {
    throw new HttpError(400, 'Cada producto del contenido necesita una cantidad mayor a 0.')
  }
  if (ids.length > 0) {
    const found = await tx
      .select({ id: products.id, name: products.name, kind: products.kind })
      .from(products)
      .where(inArray(products.id, ids))
    if (found.length !== ids.length || found.some((p) => p.kind !== 'NORMAL')) {
      throw new HttpError(400, 'Uno de los productos del contenido no existe.')
    }
    const [nested] = await tx
      .select({ name: products.name })
      .from(productComponents)
      .innerJoin(products, eq(products.id, productComponents.productId))
      .where(inArray(productComponents.productId, ids))
      .limit(1)
    if (nested) {
      throw new HttpError(
        400,
        `"${nested.name}" ya es un paquete: agrega directamente los productos que lleva.`
      )
    }
    // Y al revés: si este producto ya va dentro de otro paquete, no puede volverse paquete.
    const [parent] = await tx
      .select({ name: products.name })
      .from(productComponents)
      .innerJoin(products, eq(products.id, productComponents.productId))
      .where(eq(productComponents.componentId, productId))
      .limit(1)
    if (parent) {
      throw new HttpError(
        400,
        `Este producto va dentro de "${parent.name}": no puede ser paquete también.`
      )
    }
  }
  await tx.delete(productComponents).where(eq(productComponents.productId, productId))
  if (components.length > 0) {
    await tx.insert(productComponents).values(
      components.map((c) => ({
        productId,
        componentId: c.componentId,
        quantity: round3(c.quantity)
      }))
    )
  }
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
): Promise<ProductWithCategory> {
  await getProduct(db, id)
  await db
    .update(products)
    .set({ imagePath: relativePath, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(products.id, id))
  return getProductWithExtras(db, id)
}
