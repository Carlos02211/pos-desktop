import ExcelJS from 'exceljs'
import { eq } from 'drizzle-orm'
import type {
  ImportProductItem,
  ImportProductsResult,
  ParsedImportRow,
  ProductUnit
} from '../../shared/types'
import type { DB } from '../db'
import { categories, products } from '../db/schema'
import { withTx } from '../db/tx'
import { HttpError } from '../lib/http-error'
import { toCents } from '../lib/money'
import { getCatalog } from './catalogos'

/** Tope por importación: un catálogo de tiendita cabe de sobra y la petición no se dispara. */
export const MAX_IMPORT_ROWS = 5000

const BARCODE_RE = /^[\x21-\x7E]{1,64}$/

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * Da de alta varios productos de una vez (Excel o catálogo base).
 *
 * No se importa (y se explica por qué): nombre vacío o muy largo, precio inválido, código
 * con espacios, código que ya tiene otro producto (activo o no), nombre igual a un producto
 * activo, o repetido dentro de la misma lista. Las categorías se buscan por nombre sin
 * importar mayúsculas y se crean las que falten. Todo en una transacción: o entran todos
 * los válidos o ninguno. `dryRun` hace la misma revisión sin guardar (vista previa).
 */
export async function importProducts(
  db: DB,
  items: ImportProductItem[],
  dryRun: boolean
): Promise<ImportProductsResult> {
  if (items.length > MAX_IMPORT_ROWS) {
    throw new HttpError(400, `Se pueden importar hasta ${MAX_IMPORT_ROWS} productos a la vez.`)
  }

  const existing = await db
    .select({ name: products.name, barcode: products.barcode, active: products.active })
    .from(products)
  const takenBarcodes = new Map(
    existing.filter((p) => p.barcode).map((p) => [p.barcode as string, p.name])
  )
  const takenNames = new Set(
    existing.filter((p) => p.active === 1).map((p) => p.name.toLowerCase())
  )
  const catRows = await db.select().from(categories)
  const catByName = new Map(catRows.map((c) => [c.name.trim().toLowerCase(), c]))

  const skipped: ImportProductsResult['skipped'] = []
  const toInsert: { item: ImportProductItem; catKey: string | null }[] = []
  const newCats = new Map<string, string>() // clave en minúsculas → nombre como se escribió

  items.forEach((raw, index) => {
    const name = cleanName(raw.name ?? '')
    const skip = (reason: string): void => {
      skipped.push({ index, name: name || '(sin nombre)', reason })
    }
    if (!name) return skip('Falta el nombre.')
    if (name.length > 120) return skip('El nombre pasa de 120 caracteres.')
    if (typeof raw.price !== 'number' || !Number.isFinite(raw.price) || raw.price < 0) {
      return skip('Falta el precio o no es válido.')
    }
    if (raw.price > 1_000_000) return skip('El precio es demasiado alto.')
    const barcode = raw.barcode?.trim() || null
    if (barcode && !BARCODE_RE.test(barcode)) {
      return skip('El código de barras no puede llevar espacios ni acentos.')
    }
    if (barcode && takenBarcodes.has(barcode)) {
      return skip(`El código ${barcode} ya es del producto "${takenBarcodes.get(barcode)}".`)
    }
    if (takenNames.has(name.toLowerCase())) return skip('Ya existe un producto con ese nombre.')

    const catName = raw.category ? cleanName(raw.category).slice(0, 60) : ''
    const catKey = catName ? catName.toLowerCase() : null
    if (catKey && !catByName.has(catKey) && !newCats.has(catKey)) newCats.set(catKey, catName)

    // Lo que entra reserva su nombre y código: un repetido más abajo en la lista se salta.
    if (barcode) takenBarcodes.set(barcode, name)
    takenNames.add(name.toLowerCase())
    toInsert.push({
      item: { ...raw, name, barcode, unit: raw.unit === 'KG' ? 'KG' : 'PIEZA' },
      catKey
    })
  })

  // Sólo se crean las categorías que de verdad usa algún producto que entra.
  const usedNew = [...newCats].filter(([key]) => toInsert.some((t) => t.catKey === key))
  const result: ImportProductsResult = {
    created: toInsert.length,
    skipped,
    newCategories: usedNew.map(([, name]) => name)
  }
  if (dryRun || toInsert.length === 0) return result

  await withTx(db, async (tx) => {
    const catId = new Map([...catByName].map(([key, c]) => [key, c.id]))
    for (const [key, name] of usedNew) {
      const [row] = await tx.insert(categories).values({ name, active: 1 }).returning()
      catId.set(key, row.id)
    }
    // Una categoría desactivada que vuelve a usarse se reactiva (si no, sus productos
    // quedarían en una categoría que el admin no ve en la lista).
    for (const key of new Set(toInsert.map((t) => t.catKey))) {
      const c = key ? catByName.get(key) : undefined
      if (c && c.active !== 1) {
        await tx.update(categories).set({ active: 1 }).where(eq(categories.id, c.id))
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const rows = toInsert.map(({ item, catKey }) => ({
      name: item.name,
      price: toCents(item.price),
      unit: item.unit,
      categoryId: catKey ? (catId.get(catKey) ?? null) : null,
      barcode: item.barcode,
      active: 1,
      createdAt: now,
      updatedAt: now
    }))
    // En bloques: SQLite limita el número de parámetros por sentencia.
    for (let i = 0; i < rows.length; i += 100) {
      await tx.insert(products).values(rows.slice(i, i + 100))
    }
  })
  return result
}

// ── Lectura de Excel / CSV ────────────────────────────────────────────────────

type Field = 'name' | 'price' | 'unit' | 'category' | 'barcode'

/** Encabezados aceptados (sin acentos ni mayúsculas). */
const HEADERS: Record<string, Field> = {
  nombre: 'name',
  producto: 'name',
  descripcion: 'name',
  articulo: 'name',
  precio: 'price',
  'precio de venta': 'price',
  'precio venta': 'price',
  'precio publico': 'price',
  unidad: 'unit',
  'se vende por': 'unit',
  categoria: 'category',
  departamento: 'category',
  'codigo de barras': 'barcode',
  codigo: 'barcode',
  'codigo barras': 'barcode',
  ean: 'barcode',
  sku: 'barcode',
  upc: 'barcode'
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cellText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    if (o.result !== undefined) return cellText(o.result)
    if (o.text !== undefined) return cellText(o.text)
    return ''
  }
  return String(v).trim()
}

/** "$1,234.50" → 1234.5 · número de Excel tal cual · vacío/inválido → null. */
function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = cellText(v).replace(/[$\s]/g, '').replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseUnit(v: unknown): ProductUnit | 'invalid' {
  const t = norm(cellText(v))
  if (!t || ['pieza', 'piezas', 'pza', 'pz', 'pzas', 'unidad', 'pieza s'].includes(t))
    return 'PIEZA'
  if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'granel', 'peso'].includes(t)) return 'KG'
  return 'invalid'
}

/** Un código leído como número por Excel (7501055300075) vuelve a texto sin ".0" ni "E+". */
function parseBarcode(v: unknown): string | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v)
  const t = cellText(v).replace(/\s+/g, '')
  return t || null
}

/** CSV con comas o punto y coma (Excel en español guarda con ";"), comillas dobles y BOM. */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/**
 * Lee la primera hoja de un .xlsx (o un .csv) con encabezados en la primera fila.
 * Devuelve cada renglón interpretado o con el error que tiene, para que el admin lo corrija.
 * Los renglones con nombre pero **sin precio** se cuentan aparte y no se importan: así el
 * catálogo completo en Excel sirve de lista, y sólo entra lo que tiene precio.
 */
export async function parseProductSheet(
  buffer: Buffer
): Promise<{ rows: ParsedImportRow[]; withoutPrice: number }> {
  let table: unknown[][]
  const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50 // "PK\x03\x04"
  if (isZip) {
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    } catch {
      throw new HttpError(
        400,
        'No se pudo leer el archivo de Excel. Guárdalo como .xlsx y vuelve a intentar.'
      )
    }
    const ws = wb.worksheets[0]
    if (!ws) throw new HttpError(400, 'El archivo de Excel no tiene hojas.')
    table = []
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const values = (r.values as unknown[]).slice(1) // ExcelJS empieza en la columna 1
      table[n - 1] = values
    })
  } else {
    if (buffer.subarray(0, 1024).includes(0)) {
      throw new HttpError(400, 'El archivo debe ser Excel (.xlsx) o CSV.')
    }
    table = parseCsv(buffer.toString('utf8'))
  }

  const header = (table[0] ?? []).map((h) => HEADERS[norm(cellText(h))])
  const col = (f: Field): number => header.indexOf(f)
  if (col('name') < 0 || col('price') < 0) {
    throw new HttpError(
      400,
      'La primera fila debe tener los encabezados. Mínimo "Nombre" y "Precio" (usa la plantilla).'
    )
  }

  const out: ParsedImportRow[] = []
  let withoutPrice = 0
  for (let i = 1; i < table.length; i++) {
    const r = table[i] ?? []
    const get = (f: Field): unknown => (col(f) >= 0 ? r[col(f)] : undefined)
    const name = cleanName(cellText(get('name')))
    const priceRaw = get('price')
    const category = cleanName(cellText(get('category')))
    const barcode = parseBarcode(get('barcode'))
    // Renglón vacío (o sólo con espacios): se ignora sin error.
    if (!name && !cellText(priceRaw) && !category && !barcode) continue
    if (name && typeof priceRaw !== 'number' && !cellText(priceRaw)) {
      withoutPrice++
      continue
    }
    if (out.length >= MAX_IMPORT_ROWS) {
      throw new HttpError(
        400,
        `El archivo pasa de ${MAX_IMPORT_ROWS} productos. Divídelo en varios.`
      )
    }
    const row = i + 1
    const price = parsePrice(priceRaw)
    const unit = parseUnit(get('unit'))
    let error: string | undefined
    if (!name) error = 'Falta el nombre.'
    else if (price == null || price < 0) error = 'El precio no es un número válido.'
    else if (unit === 'invalid') error = 'Unidad no válida: usa "Pieza" o "Kg".'
    out.push(
      error
        ? { row, item: null, error }
        : {
            row,
            item: {
              name,
              price: Math.round(price! * 100) / 100,
              unit: unit as ProductUnit,
              category: category || null,
              barcode
            }
          }
    )
  }
  return { rows: out, withoutPrice }
}

/** Renglón para escribir en un Excel de productos (plantilla o catálogo). */
interface SheetRow {
  name: string
  price?: number
  unit: ProductUnit
  category: string | null
  barcode: string | null
  brand?: string | null
  size?: string | null
}

const HELP_LINES = [
  '• Nombre y Precio son obligatorios. Precio en pesos, sin signo (20 o 20.50).',
  '• Los renglones SIN precio no se importan (se ignoran sin marcar error).',
  '• Unidad: "Pieza" (se vende por pieza) o "Kg" (a granel, por peso). Vacío = Pieza.',
  '• Categoría: si no existe en el sistema, se crea sola. Vacío = sin categoría.',
  '• Código de barras: opcional. Escríbelo o escanéalo en la celda.',
  '• No se importan productos con un nombre o código que ya exista: se avisan en la vista previa.',
  '• Súbelo en Productos → Importar → Subir archivo.'
]

/** Hoja "Productos" con los encabezados que entiende `parseProductSheet` + hoja de ayuda. */
async function productWorkbook(
  rows: SheetRow[],
  withBrand: boolean,
  help: string[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Productos')
  ws.columns = [
    { header: 'Nombre', key: 'name', width: 45 },
    { header: 'Precio', key: 'price', width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: 'Unidad', key: 'unit', width: 10 },
    { header: 'Categoría', key: 'category', width: 26 },
    // Texto: si no, Excel convierte 7501055300075 en 7.50106E+12 y se pierden los ceros.
    { header: 'Código de barras', key: 'barcode', width: 18, style: { numFmt: '@' } },
    // Sólo informativas (la importación las ignora): ayudan a buscar y filtrar en Excel.
    ...(withBrand
      ? [
          { header: 'Marca', key: 'brand', width: 18 },
          { header: 'Presentación', key: 'size', width: 14 }
        ]
      : [])
  ]
  for (const r of rows) {
    ws.addRow({
      name: r.name,
      price: r.price,
      unit: r.unit === 'KG' ? 'Kg' : 'Pieza',
      category: r.category ?? '',
      barcode: r.barcode ?? '',
      brand: r.brand ?? '',
      size: r.size ?? ''
    })
  }
  const header = ws.getRow(1)
  header.font = { bold: true }
  // El precio resaltado: es lo que hay que llenar.
  header.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
  // Lista desplegable Pieza/Kg en la columna Unidad.
  const last = Math.max(rows.length + 1, 1000)
  for (let r = 2; r <= last; r++) {
    ws.getCell(`C${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Pieza,Kg"']
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  // Filtros en los encabezados: buscar por categoría o marca dentro de Excel.
  ws.autoFilter = { from: 'A1', to: withBrand ? 'G1' : 'E1' }

  const helpWs = wb.addWorksheet('Instrucciones')
  helpWs.getColumn(1).width = 110
  for (const line of help) helpWs.addRow([line])
  helpWs.getRow(1).font = { bold: true }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Plantilla .xlsx para llenar a mano (dos renglones de ejemplo). */
export async function buildImportTemplate(): Promise<Buffer> {
  return productWorkbook(
    [
      {
        name: 'Coca-Cola 600 ml',
        price: 20,
        unit: 'PIEZA',
        category: 'Refrescos',
        barcode: '7501055300075'
      },
      { name: 'Frijol negro a granel', price: 38.5, unit: 'KG', category: 'Granos', barcode: null }
    ],
    false,
    [
      'Cómo llenar la hoja "Productos":',
      '',
      ...HELP_LINES,
      '• Borra los dos renglones de ejemplo antes de importar.'
    ]
  )
}

/**
 * Catálogo base completo en Excel, con el precio vacío: se llena el precio de lo que vende el
 * negocio (con el teclado es mucho más rápido que en el navegador) y se sube el mismo archivo.
 */
export async function buildCatalogWorkbook(catalogId: string): Promise<Buffer> {
  const items = getCatalog(catalogId)
  return productWorkbook(
    items.map((it) => ({ ...it })),
    true,
    [
      'Catálogo base: pon precio a lo que vende tu negocio y sube este mismo archivo.',
      '',
      ...HELP_LINES,
      '• Usa los filtros de la fila de encabezados para ver una categoría o una marca.',
      '• Puedes corregir nombres y categorías antes de subirlo.',
      '• Datos de Open Food Facts (licencia ODbL).'
    ]
  )
}
