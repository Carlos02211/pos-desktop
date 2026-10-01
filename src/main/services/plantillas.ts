import { and, eq, sql } from 'drizzle-orm'
import type { ProductInput, TemplateResult } from '../../shared/types'
import type { DB } from '../db'
import { categories, products } from '../db/schema'
import { HttpError } from '../lib/http-error'
import { createProduct } from './productos'

/**
 * Plantillas de negocio: dan de alta un catálogo de ejemplo listo para vender (categorías,
 * productos, opciones y paquetes). Los precios son de ejemplo: el negocio los ajusta después.
 * Lo que ya existe (mismo nombre) se respeta y no se toca, así que se puede aplicar dos veces.
 */

interface TemplateProduct extends Omit<ProductInput, 'categoryId' | 'components'> {
  category: string
  /** Contenido por NOMBRE de producto de la misma plantilla (se resuelve al crearlos). */
  contains?: { name: string; quantity: number }[]
}

const TIPO_DE_POLLO = [
  { groupName: 'Tipo de pollo', name: 'Natural', price: 0 },
  { groupName: 'Tipo de pollo', name: 'Adobado', price: 0 },
  { groupName: 'Tipo de pollo', name: 'Al carbón', price: 10 }
]
const GUARNICION = [
  { groupName: 'Guarnición', name: 'Arroz', price: 0 },
  { groupName: 'Guarnición', name: 'Espagueti', price: 0 },
  { groupName: 'Guarnición', name: 'Ensalada de col', price: 0 }
]

/**
 * Pollería / rosticería. El inventario se lleva en "Pollo entero" (los pollos que se preparan
 * en el día); medio, cuarto y paquetes lo descuentan en fracciones.
 */
const POLLERIA: TemplateProduct[] = [
  {
    category: 'Pollos',
    name: 'Pollo entero',
    price: 180,
    options: TIPO_DE_POLLO,
    trackStock: true,
    initialStock: 0,
    minStock: 3
  },
  {
    category: 'Pollos',
    name: 'Medio pollo',
    price: 95,
    options: TIPO_DE_POLLO,
    contains: [{ name: 'Pollo entero', quantity: 0.5 }]
  },
  {
    category: 'Pollos',
    name: 'Cuarto de pollo',
    price: 50,
    options: TIPO_DE_POLLO,
    contains: [{ name: 'Pollo entero', quantity: 0.25 }]
  },
  {
    category: 'Paquetes',
    name: 'Paquete sencillo (pollo, tortillas y salsa)',
    price: 210,
    options: TIPO_DE_POLLO,
    contains: [
      { name: 'Pollo entero', quantity: 1 },
      { name: 'Tortillas 1/2 kg', quantity: 1 },
      { name: 'Salsa', quantity: 1 }
    ]
  },
  {
    category: 'Paquetes',
    name: 'Paquete familiar (pollo, guarnición, tortillas, salsa y refresco)',
    price: 275,
    options: [...TIPO_DE_POLLO, ...GUARNICION],
    contains: [
      { name: 'Pollo entero', quantity: 1 },
      { name: 'Tortillas 1/2 kg', quantity: 2 },
      { name: 'Salsa', quantity: 1 },
      { name: 'Refresco 2 L', quantity: 1 }
    ]
  },
  {
    category: 'Paquetes',
    name: 'Paquete medio pollo (guarnición y tortillas)',
    price: 125,
    options: [...TIPO_DE_POLLO, ...GUARNICION],
    contains: [
      { name: 'Pollo entero', quantity: 0.5 },
      { name: 'Tortillas 1/2 kg', quantity: 1 }
    ]
  },
  { category: 'Complementos', name: 'Tortillas 1/2 kg', price: 15 },
  { category: 'Complementos', name: 'Tortillas 1 kg', price: 28 },
  { category: 'Complementos', name: 'Salsa', price: 10 },
  { category: 'Complementos', name: 'Arroz', price: 25 },
  { category: 'Complementos', name: 'Espagueti', price: 30 },
  { category: 'Complementos', name: 'Ensalada de col', price: 25 },
  { category: 'Complementos', name: 'Frijoles charros', price: 30 },
  { category: 'Complementos', name: 'Papas a la francesa', price: 35 },
  { category: 'Complementos', name: 'Chiles toreados', price: 15 },
  { category: 'Complementos', name: 'Cebollitas asadas', price: 15 },
  { category: 'Bebidas', name: 'Refresco 600 ml', price: 22 },
  { category: 'Bebidas', name: 'Refresco 2 L', price: 45 },
  { category: 'Bebidas', name: 'Agua fresca 1 L', price: 25 },
  // El costo de envío cambia con la distancia: se escribe al cobrar (sugerido $20).
  { category: 'Servicio', name: 'Envío a domicilio', price: 20, openPrice: true }
]

const TEMPLATES: Record<string, TemplateProduct[]> = { polleria: POLLERIA }

export function templateExists(id: string): boolean {
  return id in TEMPLATES
}

async function categoryId(db: DB, name: string): Promise<number> {
  const [found] = await db
    .select({ id: categories.id, active: categories.active })
    .from(categories)
    .where(sql`lower(${categories.name}) = ${name.toLowerCase()}`)
    .limit(1)
  if (found) {
    if (found.active !== 1) {
      await db.update(categories).set({ active: 1 }).where(eq(categories.id, found.id))
    }
    return found.id
  }
  const [created] = await db.insert(categories).values({ name }).returning({ id: categories.id })
  return created.id
}

async function activeProductId(db: DB, name: string): Promise<number | null> {
  const [found] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        sql`lower(${products.name}) = ${name.toLowerCase()}`,
        eq(products.active, 1),
        eq(products.kind, 'NORMAL')
      )
    )
    .limit(1)
  return found?.id ?? null
}

export async function applyTemplate(db: DB, userId: number, id: string): Promise<TemplateResult> {
  const template = TEMPLATES[id]
  const result: TemplateResult = { created: [], existing: [], failed: [] }
  // Primero los que no llevan contenido: los paquetes los necesitan ya creados.
  const ordered = [...template].sort((a, b) => (a.contains ? 1 : 0) - (b.contains ? 1 : 0))
  for (const item of ordered) {
    if ((await activeProductId(db, item.name)) != null) {
      result.existing.push(item.name)
      continue
    }
    const components: { componentId: number; quantity: number }[] = []
    const { category, contains, ...input } = item
    for (const c of contains ?? []) {
      const componentId = await activeProductId(db, c.name)
      if (componentId != null) components.push({ componentId, quantity: c.quantity })
    }
    try {
      await createProduct(
        db,
        { ...input, categoryId: await categoryId(db, category), components },
        userId
      )
      result.created.push(item.name)
    } catch (err) {
      // Choca con algo que el negocio ya tenía (ej. su "Pollo entero" ya es paquete): se
      // reporta y se sigue con los demás.
      if (!(err instanceof HttpError)) throw err
      result.failed.push({ name: item.name, reason: err.message })
    }
  }
  return result
}
