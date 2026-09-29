import type { CatalogInfo, CatalogItem, ProductUnit } from '../../shared/types'
import { HttpError } from '../lib/http-error'
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
