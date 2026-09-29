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

interface Hit {
  code?: string
  product_name?: string
  product_name_es?: string
  brands?: string[] | string
  quantity?: string
  categories_tags?: string[]
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

/** Dígito verificador EAN-8 / EAN-13: descarta códigos mal capturados. */
function validEan(code: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return false
  const digits = [...code].map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

const SMALL = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'con',
  'sin',
  'en',
  'a',
  'al',
  'para',
  'por'
])

/** "COFFEE MATE AVELLANA" → "Coffee Mate Avellana" (sólo si viene todo en mayúsculas). */
function tidyCase(s: string): string {
  const letters = s.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '')
  if (letters.length < 3 || letters !== letters.toUpperCase()) return s
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

function clean(s: string | undefined): string {
  return (s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;-]+|[\s,.;-]+$/g, '')
    .trim()
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** "600ml" → "600 ml" · "33 cl / 330 ml" → "330 ml" · "1L" → "1 l". */
function tidySize(q: string | undefined): string | null {
  let s = clean(q)
  if (!s) return null
  if (s.includes('/')) s = s.split('/').pop()!.trim()
  s = s
    .replace(/(\d)\s*(ml|g|gr|kg|l|lt|lts|oz|pzas?|piezas?|cl)\b/gi, '$1 $2')
    .replace(/\b(ML|G|GR|KG|L|LT|LTS|OZ|CL)\b/g, (u) => u.toLowerCase())
    .replace(/\bgr\b/g, 'g')
    .replace(/\blts?\b/g, 'l')
  return s.length > 20 ? null : s
}

/**
 * Categoría de tiendita (ver `categoryOf`): 1) palabras del nombre, 2) etiquetas de OFF
 * comparadas una por una, de la más específica a la más general
 * ("plant-based-foods-and-beverages" no debe volver bebida a una galleta), 3) "Abarrotes".
 */
const TAG_RULES: [string, string[]][] = [
  ['Cervezas y vinos', ['alcoholic-beverages', 'beers', 'wines', 'spirits', 'tequilas', 'mezcals']],
  ['Aguas', ['waters', 'mineral-waters', 'spring-waters', 'flavored-waters', 'carbonated-waters']],
  ['Jugos y néctares', ['juices-and-nectars', 'fruit-juices', 'fruit-nectars', 'es:jugos']],
  ['Refrescos', ['sodas', 'colas', 'carbonated-drinks', 'es:refrescos']],
  [
    'Café, té y chocolate en polvo',
    [
      'coffees',
      'instant-coffees',
      'teas',
      'herbal-teas',
      'cocoa-and-chocolate-powders',
      'hot-beverages',
      'instant-beverages'
    ]
  ],
  ['Yogurt', ['yogurts', 'drinkable-yogurts', 'fermented-milk-drinks', 'fermented-dairy-desserts']],
  ['Leche', ['milks', 'plant-based-milk-alternatives', 'milk-substitutes', 'dairy-drinks']],
  ['Quesos y cremas', ['cheeses', 'creams', 'cream-cheeses']],
  [
    'Carnes frías y embutidos',
    ['prepared-meats', 'sausages', 'hams', 'meats-and-their-products', 'meats']
  ],
  [
    'Enlatados y conservas',
    [
      'canned-foods',
      'tunas',
      'fruit-and-vegetable-preserves',
      'canned-plant-based-foods',
      'fishes',
      'seafood'
    ]
  ],
  ['Galletas', ['biscuits', 'cookies', 'crackers', 'biscuits-and-cakes']],
  ['Cereales y avena', ['breakfast-cereals', 'cereal-bars', 'oat-flakes', 'extruded-cereals']],
  [
    'Botanas',
    ['salty-snacks', 'chips-and-fries', 'crisps', 'popcorn', 'nuts', 'appetizers', 'seeds']
  ],
  ['Dulces y chocolates', ['confectioneries', 'chocolates', 'candies', 'sweet-snacks', 'bars']],
  ['Pan y tortillas', ['breads', 'tortillas', 'pastries', 'cakes']],
  ['Salsas y condimentos', ['sauces', 'condiments', 'mayonnaises', 'spices', 'salts', 'vinegars']],
  ['Aceites y mantecas', ['vegetable-oils', 'fats', 'margarines', 'spreadable-fats']],
  [
    'Granos, pastas y harinas',
    ['pastas', 'legumes', 'flours', 'cereal-grains', 'rices', 'cereal-flours']
  ],
  ['Azúcar, mermeladas y miel', ['sweeteners', 'jams', 'honeys', 'sweet-spreads', 'sugars']],
  ['Postres y helados', ['ice-creams-and-sorbets', 'frozen-desserts', 'gelatins', 'desserts']],
  ['Sopas y comida instantánea', ['soups', 'dried-meals', 'meals', 'instant-noodles']],
  ['Alimentos para bebé', ['baby-foods']],
  ['Congelados', ['frozen-foods']],
  ['Bebidas', ['beverages', 'plant-based-beverages']],
  ['Lácteos', ['dairies']],
  ['Botanas', ['snacks']]
]

/** Palabras de TIPO de producto (sin acentos, minúsculas; plural opcional) → categoría. */
const TYPE_RULES: [string, string][] = [
  ['Cervezas y vinos', 'cerveza|beer|tequila|mezcal|vino|brandy|ron|whisky|vodka|licor'],
  ['Aguas', 'agua|water|agua mineral'],
  ['Jugos y néctares', 'jugo|nectar|juice'],
  ['Refrescos', 'refresco|soda|cola'],
  [
    'Café, té y chocolate en polvo',
    'cafe|coffee|te|tea|chocolate en polvo|cacao en polvo|capuchino|infusion'
  ],
  ['Yogurt', 'yogurt|yoghurt|yogur|bebible|lactobacilo'],
  ['Leche', 'leche|milk|bebida de almendra|bebida de soya|producto lacteo'],
  ['Quesos y cremas', 'queso|crema(?! de (cacahuate|avellana|mani))|cheese|panela|requeson'],
  [
    'Carnes frías y embutidos',
    'jamon|salchicha|chorizo|tocino|salami|pechuga de pavo|mortadela|pepperoni'
  ],
  [
    'Enlatados y conservas',
    'atun|sardina|chiles en|jalapeno|chipotle|elote|lata|verduras en|champinon|durazno en almibar|frijoles refritos'
  ],
  ['Galletas', 'galleta|cracker|barquillo|wafer|oblea'],
  ['Cereales y avena', 'cereal|avena|granola|barra de cereal|hojuela'],
  [
    'Botanas',
    'papa|papita|chicharron|cacahuate|palomita|botana|semilla|nuez|almendra|pistache|totopo|frituras?|chip'
  ],
  [
    'Dulces y chocolates',
    'chocolate|dulce|caramelo|chicle|paleta|gomita|mazapan|malvavisco|bombon|tamarindo|obleas?'
  ],
  ['Pan y tortillas', 'pan|tortilla|tostada|bollo|panque|mantecada|dona|concha|bisquet'],
  [
    'Salsas y condimentos',
    'salsa|catsup|ketchup|mayonesa|mostaza|consome|sal de mesa|sal yodatada|sal refinada|sal de grano|sal de mar|vinagre|pimienta|sazonador|aderezo|chamoy|especia|caldo de pollo|mole'
  ],
  ['Aceites y mantecas', 'aceite|manteca|margarina|mantequilla'],
  [
    'Granos, pastas y harinas',
    'arroz|frijol|lenteja|pasta|spaghetti|espagueti|fideo|harina|garbanzo|haba|codito|macarron'
  ],
  [
    'Azúcar, mermeladas y miel',
    'azucar|mermelada|miel|jarabe|cajeta|endulzante|piloncillo|crema de cacahuate'
  ],
  ['Postres y helados', 'gelatina|flan|helado|nieve|pudin|postre'],
  ['Sopas y comida instantánea', 'sopa|ramen|sopa instantanea|caldo'],
  ['Alimentos para bebé', 'papilla|formula infantil|colado'],
  ['Alimento para mascotas', 'croqueta|alimento para perro|alimento para gato']
].map(([cat, words]) => [cat, words])

/** Marcas → categoría: sólo si el nombre no dice qué producto es ("Sabritas 45 g"). */
const BRAND_RULES: [string, string][] = [
  [
    'Cervezas y vinos',
    'corona|coronita|modelo|tecate|indio|victoria|bohemia|carta blanca|pacifico|michelob|heineken|xx lager|dos equis|estrella|montejo'
  ],
  ['Aguas', 'bonafont|ciel|epura|e pura|santa maria|penafiel|topo chico|electrolit'],
  ['Jugos y néctares', 'jumex|del valle|boing|pascual|jugos del valle'],
  [
    'Refrescos',
    'coca|coca cola|pepsi|sprite|fanta|manzanita|sidral|squirt|jarritos|fresca|7up|mirinda|sangria|delaware|big cola|red cola|mundet|peñafiel|senorial|joya|fuzetea'
  ],
  [
    'Café, té y chocolate en polvo',
    'nescafe|nesquik|abuelita|ibarra|coffee mate|chocomilk|choco milk|cafe ole|legal|combate|la cabana'
  ],
  ['Yogurt', 'danone|activia|yakult|yoplait|danonino|vitalinea'],
  ['Leche', 'lala|alpura|santa clara|nutri leche|nutrileche|carnation|nido|nan'],
  ['Quesos y cremas', 'philadelphia|chen|esmeralda|noche buena|nochebuena'],
  ['Carnes frías y embutidos', 'fud|san rafael|zwan|bafar|chimex|kir|parma|sabori'],
  ['Enlatados y conservas', 'herdez|la costena|dolores|tuny|del monte|clemente jacques|san marcos'],
  [
    'Galletas',
    'gamesa|marias|emperador|chokis|oreo|triki trakes|saladitas|crackets|cuetara|mamut|arcoiris|florentinas|principe'
  ],
  [
    'Cereales y avena',
    'kellogg|kelloggs|quaker|zucaritas|choco krispis|corn flakes|froot loops|nestle fitness'
  ],
  [
    'Botanas',
    'sabritas|barcel|doritos|cheetos|ruffles|takis|tostitos|churrumais|fritos|rancheritos|runners|karate|japones|mafer|pake taxo|chip s'
  ],
  [
    'Dulces y chocolates',
    'de la rosa|ricolino|carlos v|kinder|bubulubu|pulparindo|lucas|mars|snickers|m&m|hersheys|hershey s|vero|canels|sonrics|milky way|ferrero|kit kat|crunch'
  ],
  [
    'Pan y tortillas',
    'bimbo|marinela|tia rosa|wonder|oroweat|gansito|pinguinos|milpa real|suandy|mission'
  ],
  [
    'Salsas y condimentos',
    'valentina|mccormick|knorr|maggi|tajin|la botanera|bufalo|guacamaya|huichol|embasa'
  ],
  ['Aceites y mantecas', 'nutrioli|capullo|1 2 3|patrona|kartamus|gloria|iberia'],
  [
    'Granos, pastas y harinas',
    'la moderna|maseca|verde valle|sos|minsa|barilla|la merced|schettino'
  ],
  ['Azúcar, mermeladas y miel', 'splenda|zulka|carlota|smuckers|mccormick mermelada|karo|coronado'],
  ['Postres y helados', 'd gari|jell o|holanda'],
  ['Sopas y comida instantánea', 'maruchan|nissin|cup noodles'],
  ['Alimentos para bebé', 'gerber'],
  ['Alimento para mascotas', 'pedigree|whiskas|dog chow|cat chow|purina|ganador']
]

function compile(rules: [string, string][]): [string, RegExp][] {
  return rules.map(([cat, words]) => [cat, new RegExp(`\\b(${words})(s|es)?\\b`)])
}
const TYPE_RE = compile(TYPE_RULES as [string, string][])
const BRAND_RE = compile(BRAND_RULES)

/** La regla cuya palabra aparece más al principio del texto. */
function earliest(rules: [string, RegExp][], text: string): string | null {
  let best: { cat: string; at: number } | null = null
  for (const [cat, re] of rules) {
    const m = re.exec(text)
    if (m && (!best || m.index < best.at)) best = { cat, at: m.index }
  }
  return best?.cat ?? null
}

function categoryOf(tags: string[] | undefined, name: string, brand: string | null): string {
  // El nombre manda (las etiquetas de OFF las pone cualquiera y a veces están mal: una
  // Coca-Cola etiquetada como agua). Primero el TIPO de producto, y de ésos gana el que
  // aparece más al principio ("Galletas con leche" → Galletas); si no dice qué es, la marca
  // ("Sabritas 45 g" → Botanas); si tampoco, las etiquetas de OFF.
  // "sabor chocolate", "limón y sal", "con chile": son sabores, no el tipo de producto.
  const text = fold2(`${name} ${brand ?? ''}`).replace(
    /\b(sabor(es)?|con|y|a la|al) (de )?[a-z]+/g,
    ' '
  )
  const byName = earliest(TYPE_RE, text) ?? earliest(BRAND_RE, text)
  if (byName) return byName
  const set = new Set((tags ?? []).map((t) => t.replace(/^en:/, '')))
  for (const [cat, list] of TAG_RULES) if (list.some((t) => set.has(t))) return cat
  return 'Abarrotes'
}

/** Sin acentos y en minúsculas, conservando espacios (para las palabras de NAME_RULES). */
function fold2(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, ' ')
}

async function main(): Promise<void> {
  const cache = process.argv[2] ?? join(__dirname, '../.cache/off-mx')
  const hits = await download(cache)

  const seenCodes = new Set<string>()
  const seenNames = new Set<string>()
  const items: [string, string, string | null, string | null, string, 'PIEZA'][] = []
  let invalid = 0

  for (const h of hits) {
    const code = clean(h.code)
    if (!code.startsWith('750') || !validEan(code) || seenCodes.has(code)) {
      invalid++
      continue
    }
    const rawName = tidyCase(clean(h.product_name_es) || clean(h.product_name))
    if (rawName.length < 3 || /^\d+$/.test(rawName)) {
      invalid++
      continue
    }
    const brandRaw = Array.isArray(h.brands) ? h.brands[0] : clean(h.brands).split(',')[0]
    const brand = brandRaw ? tidyCase(clean(brandRaw)) : null
    const size = tidySize(h.quantity)

    // Nombre para el POS: "Galletas Marías Gamesa 170 g" (marca y tamaño si no los trae).
    let name = rawName
    if (brand && !fold(name).includes(fold(brand))) name += ` ${brand}`
    if (size && !fold(name).includes(fold(size))) name += ` ${size}`
    name = name.slice(0, 120)
    if (seenNames.has(fold(name))) {
      invalid++
      continue
    }

    seenCodes.add(code)
    seenNames.add(fold(name))
    items.push([code, name, brand, size, categoryOf(h.categories_tags, rawName, brand), 'PIEZA'])
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
