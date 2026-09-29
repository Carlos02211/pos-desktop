import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type {
  InventoryItem,
  StockAdjustInput,
  StockEntryInput,
  StockMovement,
  StockMovementType,
  StockStatus
} from '../../shared/types'
import type { DB } from '../db'
import type { ProductRow } from '../db/schema'
import { categories, products, sales, stockMovements, users } from '../db/schema'
import { lockRow, withTx } from '../db/tx'
import { HttpError } from '../lib/http-error'
import { round3 } from '../lib/money'

/**
 * Inventario opcional por producto (`products.track_stock`).
 *
 * Reglas:
 *  - Cada cambio de existencia deja un renglón en `stock_movements` (entrada, ajuste o venta)
 *    con la existencia resultante: el dueño puede ver qué pasó con cada producto.
 *  - La venta NUNCA se bloquea por inventario: si el sistema dice 0 pero el producto está en
 *    el mostrador, se vende y la existencia queda negativa hasta el siguiente conteo.
 *  - Las cantidades se redondean a 3 decimales (1 g) y la fila del producto se bloquea antes de
 *    leerla (PostgreSQL), así dos cajas vendiendo lo mismo no pierden un descuento.
 */

export function stockStatus(stock: number, minStock: number | null): StockStatus {
  if (stock <= 0) return 'OUT'
  if (minStock != null && stock <= minStock) return 'LOW'
  return 'OK'
}

/** Piezas: entero. Kg: hasta gramos. */
function checkQuantity(product: ProductRow, quantity: number, what: string): number {
  if (!Number.isFinite(quantity)) throw new HttpError(400, `${what} inválida.`)
  if (product.unit === 'PIEZA' && !Number.isInteger(quantity)) {
    throw new HttpError(400, `"${product.name}" se vende por pieza: ${what.toLowerCase()} entera.`)
  }
  return round3(quantity)
}

function cleanReason(reason: string | undefined): string | null {
  const r = reason?.trim().replace(/\s+/g, ' ')
  return r ? r : null
}

/** Bloquea y lee el producto (debe llevar inventario si `mustTrack`). */
async function lockProduct(tx: DB, productId: number, mustTrack = true): Promise<ProductRow> {
  await lockRow(tx, 'products', productId)
  const [product] = await tx.select().from(products).where(eq(products.id, productId)).limit(1)
  if (!product) throw new HttpError(404, 'Producto no encontrado.')
  if (mustTrack && product.trackStock !== 1) {
    throw new HttpError(409, `"${product.name}" no lleva inventario. Actívalo primero.`)
  }
  return product
}

/** Aplica un cambio de existencia ya validado y lo registra. Debe ir dentro de una transacción. */
async function moveStock(
  tx: DB,
  product: ProductRow,
  move: {
    type: StockMovementType
    quantity: number
    userId: number
    reason?: string | null
    saleId?: number | null
    /** ADJUST: existencia final exacta (evita arrastrar decimales). */
    setTo?: number
  }
): Promise<number> {
  const stockAfter = round3(move.setTo ?? product.stock + move.quantity)
  await tx.update(products).set({ stock: stockAfter }).where(eq(products.id, product.id))
  await tx.insert(stockMovements).values({
    productId: product.id,
    userId: move.userId,
    type: move.type,
    quantity: round3(move.quantity),
    stockAfter,
    reason: move.reason ?? null,
    saleId: move.saleId ?? null
  })
  return stockAfter
}

/**
 * Descuenta del inventario lo vendido (venta nueva o productos agregados a una venta).
 * Sólo toca productos con inventario; se llama dentro de la transacción de la venta.
 */
export async function discountSaleStock(
  tx: DB,
  userId: number,
  saleId: number,
  lines: { productId: number; quantity: number }[]
): Promise<void> {
  const byProduct = new Map<number, number>()
  for (const line of lines) {
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + line.quantity)
  }
  const tracked = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, [...byProduct.keys()]), eq(products.trackStock, 1)))
  // Orden fijo de bloqueo: dos ventas con los mismos productos no se esperan en cruz.
  for (const { id } of tracked.sort((a, b) => a.id - b.id)) {
    const product = await lockProduct(tx, id)
    await moveStock(tx, product, {
      type: 'SALE',
      quantity: -byProduct.get(id)!,
      userId,
      saleId
    })
  }
}

/** Llegó mercancía: suma a la existencia. */
export async function addStockEntry(
  db: DB,
  userId: number,
  productId: number,
  input: StockEntryInput
): Promise<InventoryItem> {
  return withTx(db, async (tx) => {
    const product = await lockProduct(tx, productId)
    const quantity = checkQuantity(product, input.quantity, 'La cantidad')
    if (quantity <= 0) throw new HttpError(400, 'La cantidad que entra debe ser mayor a 0.')
    await moveStock(tx, product, {
      type: 'ENTRY',
      quantity,
      userId,
      reason: cleanReason(input.reason)
    })
    return getInventoryItem(tx, productId)
  })
}

/** Conteo físico: la existencia pasa a ser lo contado y se registra la diferencia. */
export async function adjustStock(
  db: DB,
  userId: number,
  productId: number,
  input: StockAdjustInput
): Promise<InventoryItem> {
  return withTx(db, async (tx) => {
    const product = await lockProduct(tx, productId)
    const counted = checkQuantity(product, input.counted, 'La existencia')
    if (counted < 0) throw new HttpError(400, 'La existencia contada no puede ser negativa.')
    const delta = round3(counted - product.stock)
    if (delta !== 0) {
      await moveStock(tx, product, {
        type: 'ADJUST',
        quantity: delta,
        userId,
        reason: cleanReason(input.reason) ?? 'Conteo físico',
        setTo: counted
      })
    }
    return getInventoryItem(tx, productId)
  })
}

/**
 * Activa o desactiva el inventario de un producto desde su formulario. Al activarlo se puede
 * dar la existencia inicial (queda como ajuste "Existencia inicial"). Dentro de una transacción.
 */
export async function setProductTracking(
  tx: DB,
  userId: number,
  productId: number,
  track: boolean,
  initialStock?: number
): Promise<void> {
  const product = await lockProduct(tx, productId, false)
  if (!track) {
    if (product.trackStock === 1) {
      await tx.update(products).set({ trackStock: 0 }).where(eq(products.id, productId))
    }
    return
  }
  if (product.trackStock === 1) return // ya lo lleva: la existencia se cambia en Inventario
  await tx.update(products).set({ trackStock: 1 }).where(eq(products.id, productId))
  if (initialStock == null) return
  const counted = checkQuantity(product, initialStock, 'La existencia inicial')
  if (counted < 0) throw new HttpError(400, 'La existencia inicial no puede ser negativa.')
  if (round3(counted - product.stock) !== 0) {
    await moveStock(tx, product, {
      type: 'ADJUST',
      quantity: counted - product.stock,
      userId,
      reason: 'Existencia inicial',
      setTo: counted
    })
  }
}

/** Empieza a llevar inventario de varios productos a la vez (existencia actual, normalmente 0). */
export async function enableTracking(db: DB, productIds: number[]): Promise<number> {
  if (productIds.length === 0) return 0
  const rows = await db
    .update(products)
    .set({ trackStock: 1 })
    .where(and(inArray(products.id, productIds), eq(products.trackStock, 0)))
    .returning({ id: products.id })
  return rows.length
}

const itemSelection = {
  id: products.id,
  name: products.name,
  unit: products.unit,
  barcode: products.barcode,
  categoryName: categories.name,
  stock: products.stock,
  minStock: products.minStock
}

type ItemRow = Omit<InventoryItem, 'status'>

function toItem(row: ItemRow): InventoryItem {
  const stock = round3(Number(row.stock))
  const minStock = row.minStock == null ? null : Number(row.minStock)
  return { ...row, stock, minStock, status: stockStatus(stock, minStock) }
}

async function getInventoryItem(db: DB, productId: number): Promise<InventoryItem> {
  const [row] = await db
    .select(itemSelection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, productId))
    .limit(1)
  return toItem(row)
}

/** Productos activos que llevan inventario, los más urgentes primero. */
export async function listInventory(db: DB): Promise<InventoryItem[]> {
  const rows = await db
    .select(itemSelection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.active, 1), eq(products.trackStock, 1)))
  const rank: Record<StockStatus, number> = { OUT: 0, LOW: 1, OK: 2 }
  return rows
    .map(toItem)
    .sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name))
}

/** Cuántos productos activos están en su mínimo o debajo (incluye agotados). */
export async function countLowStock(db: DB): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(products)
    .where(
      and(
        eq(products.active, 1),
        eq(products.trackStock, 1),
        sql`(${products.stock} <= 0 or (${products.minStock} is not null and ${products.stock} <= ${products.minStock}))`
      )
    )
  return Number(row?.n ?? 0)
}

/** Últimos movimientos de un producto (más recientes primero). */
export async function listMovements(
  db: DB,
  productId: number,
  limit = 100
): Promise<StockMovement[]> {
  const rows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      stockAfter: stockMovements.stockAfter,
      reason: stockMovements.reason,
      saleId: stockMovements.saleId,
      ticketNumber: sales.ticketNumber,
      userName: users.username,
      createdAt: stockMovements.createdAt
    })
    .from(stockMovements)
    .innerJoin(users, eq(users.id, stockMovements.userId))
    .leftJoin(sales, eq(sales.id, stockMovements.saleId))
    .where(eq(stockMovements.productId, productId))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(limit)
  return rows.map((r) => ({
    ...r,
    quantity: round3(Number(r.quantity)),
    stockAfter: round3(Number(r.stockAfter))
  }))
}
