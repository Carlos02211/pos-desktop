/**
 * Arma `src/main/data/catalogo-abarrotes-mx.json` a partir de Open Food Facts
 * (https://world.openfoodfacts.org, datos bajo licencia ODbL).
 *
 *   pnpm exec tsx scripts/build-catalogo-abarrotes.ts [carpeta-cache]
 *
 * Descarga (si no están en la carpeta cache) los productos vendidos en México con código
 * de barras mexicano (prefijo GS1 750), ordenados por popularidad, y los deja listos para
 * el POS: nombre legible con marca y presentación, categoría en español de tiendita, sin
 * códigos inválidos ni repetidos.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fold, normalizeOffProduct, validEan, type OffProduct } from '../src/main/lib/off-product'

interface Hit extends OffProduct {
  unique_scans_n?: number
}

const API = 'https://search.openfoodfacts.org/search'
const QUERY = 'countries_tags:"en:mexico" AND code:750*'
const FIELDS = 'code,product_name,product_name_es,brands,quantity,categories_tags,unique_scans_n'
const UA = 'SpArTaN-POS/1.0 (catalogo de abarrotes para punto de venta)'
const OUT = join(__dirname, '../src/main/data/catalogo-abarrotes-mx.json')

async function download(cache: string): Promise<Hit[]> {
  mkdirSync(cache, { recursive: true })
  const hits: Hit[] = []
  for (let page = 1; page < 200; page++) {
    const file = join(cache, `p${page}.json`)
    let data: { hits?: Hit[]; page_count?: number }
    if (existsSync(file)) {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } else {
      const url = new URL(API)
      url.search = new URLSearchParams({
        q: QUERY,
        page_size: '100',
        page: String(page),
        sort_by: '-unique_scans_n',
        fields: FIELDS
      }).toString()
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`Open Food Facts respondió ${res.status} en la página ${page}`)
      data = (await res.json()) as typeof data
      writeFileSync(file, JSON.stringify(data))
      await new Promise((r) => setTimeout(r, 1500)) // ser amables con su servidor
    }
    hits.push(...(data.hits ?? []))
    if (!data.hits?.length || page >= (data.page_count ?? 0)) break
  }
  return hits
}

async function main(): Promise<void> {
  const cache = process.argv[2] ?? join(__dirname, '../.cache/off-mx')
  const hits = await download(cache)

  const seenCodes = new Set<string>()
  const seenNames = new Set<string>()
  const items: [string, string, string | null, string | null, string, 'PIEZA'][] = []
  let invalid = 0

  for (const h of hits) {
    const code = (h.code ?? '').trim()
    if (!code.startsWith('750') || !validEan(code) || seenCodes.has(code)) {
      invalid++
      continue
    }
    const p = normalizeOffProduct(h)
    if (!p || seenNames.has(fold(p.name))) {
      invalid++
      continue
    }
    seenCodes.add(code)
    seenNames.add(fold(p.name))
    items.push([code, p.name, p.brand, p.size, p.category, 'PIEZA'])
  }

  const out = {
    info: {
      id: 'abarrotes-mx',
      name: 'Abarrotes de México',
      description:
        'Productos empacados con código de barras mexicano: refrescos, botanas, lácteos, galletas, abarrotes…',
      source: 'Open Food Facts (licencia ODbL)'
    },
    items
  }
  writeFileSync(OUT, JSON.stringify(out) + '\n')
  const byCat = new Map<string, number>()
  for (const it of items) byCat.set(it[4], (byCat.get(it[4]) ?? 0) + 1)
  console.log(`${items.length} productos (descartados ${invalid}) → ${OUT}`)
  console.log(
    [...byCat]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `  ${c}: ${n}`)
      .join('\n')
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
