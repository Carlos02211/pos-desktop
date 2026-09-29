import type { BarcodeLookup, CatalogInfo, CatalogItem, ProductUnit } from '../../shared/types'
import { HttpError } from '../lib/http-error'
import { normalizeOffProduct, type OffProduct } from '../lib/off-product'
import abarrotes from '../data/catalogo-abarrotes-mx.json'

/**
 * Catálogos base: listas de productos comunes para dar de alta rápido (el admin elige
 * cuáles vende y les pone precio). Van dentro del bundle: funcionan sin internet.
 *
 * Formato compacto del JSON: `items` = [código, nombre, marca, presentación, categoría, unidad].
 */
interface CatalogFile {
  info: Omit<CatalogInfo, 'count'>
  items: [string | null, string, string | null, string | null, string, ProductUnit][]
}

const CATALOGS: CatalogFile[] = [abarrotes as CatalogFile]

export function listCatalogs(): CatalogInfo[] {
  return CATALOGS.map((c) => ({ ...c.info, count: c.items.length }))
}

export function getCatalog(id: string): CatalogItem[] {
  const c = CATALOGS.find((x) => x.info.id === id)
  if (!c) throw new HttpError(404, 'Catálogo no encontrado.')
  return c.items.map(([barcode, name, brand, size, category, unit]) => ({
    barcode,
    name,
    brand,
    size,
    category,
    unit
  }))
}

/** Índice código → producto de todos los catálogos (se arma la primera vez que se usa). */
let byBarcode: Map<string, CatalogItem> | null = null

/**
 * Datos sugeridos para un código que no está dado de alta: primero el catálogo base (sin
 * internet); si no está y el servidor tiene internet, Open Food Facts (sólo se manda el
 * código; si tarda más de 4 s o no hay red, se sigue sin datos). null = no se encontró.
 */
export async function lookupBarcode(code: string): Promise<BarcodeLookup | null> {
  if (!byBarcode) {
    byBarcode = new Map()
    for (const c of CATALOGS)
      for (const it of getCatalog(c.info.id)) {
        if (it.barcode && !byBarcode.has(it.barcode)) byBarcode.set(it.barcode, it)
      }
  }
  const local = byBarcode.get(code)
  if (local) return { source: 'catalogo', item: local }

  try {
    const url =
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json` +
      '?fields=code,product_name,product_name_es,brands,quantity,categories_tags'
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpArTaN-POS/1.0 (alta de productos por codigo de barras)' },
      signal: AbortSignal.timeout(4000)
    })
    if (!res.ok) return null
    const body = (await res.json()) as { status?: number; product?: OffProduct }
    if (body.status !== 1 || !body.product) return null
    const p = normalizeOffProduct(body.product)
    if (!p) return null
    return {
      source: 'internet',
      item: {
        barcode: code,
        name: p.name,
        brand: p.brand,
        size: p.size,
        category: p.category,
        unit: 'PIEZA'
      }
    }
  } catch {
    return null // sin internet o Open Food Facts no respondió: el admin lo llena a mano
  }
}
