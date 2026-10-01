import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  CartLineInput,
  Order,
  OrderType,
  PaymentMethod,
  ProductOption,
  ProductUnit,
  ProductWithCategory
} from '@shared/types'
import { randomId } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

export interface CartItem {
  /** Id del renglón: el productId, salvo en precio libre, donde cada cobro es su propio renglón. */
  key: string
  productId: number
  name: string
  price: number
  /** Precio de catálogo, para saber si `price` fue editado y poder restaurarlo. */
  originalPrice: number
  /** PIEZA = cantidad entera. KG = cantidad en kg, editable en gramos. */
  unit: ProductUnit
  quantity: number
  /** Precio libre ("Varios"): el importe lo escribe el cajero, sin tope de catálogo. */
  openPrice?: boolean
  /** Precio libre: descripción del cobro ("Engargolado"). Los demás: indicación para quien
   *  despacha ("sin chile"). Sale en el ticket. */
  note?: string
  /** Opciones elegidas ("Adobado"), una por grupo. */
  optionIds?: number[]
}

type CartProduct = Pick<ProductWithCategory, 'id' | 'name' | 'price' | 'unit'>

/** Encargo que se está entregando (o cuenta abierta que se cobra): al cobrar se descuenta su anticipo. */
export interface DeliveryTarget {
  orderId: number
  type: OrderType
  /** Versión cargada: si otra caja la cambia, el servidor rechaza cobrar/guardar esta copia. */
  version: number
  customerName: string
  deposit: number
}

/** Precio y nombre con las opciones elegidas: "Pollo entero (Al carbón)", base + extras. */
export function withOptions(
  product: CartProduct,
  options: ProductOption[]
): { name: string; price: number } {
  const extra = options.reduce((sum, o) => sum + o.price, 0)
  return {
    name: options.length
      ? `${product.name} (${options.map((o) => o.name).join(', ')})`
      : product.name,
    price: Math.round((product.price + extra + Number.EPSILON) * 100) / 100
  }
}

/** Venta ya cobrada a la que se le agregan productos olvidados (mismo folio). */
export interface AppendTarget {
  saleId: number
  ticketNumber: number
  paymentMethod: PaymentMethod
  total: number
  customerName: string | null
}

interface CartState {
  items: CartItem[]
  /** Si no es null, "Cobrar" agrega el carrito a esa venta en vez de crear una nueva. */
  appendTo: AppendTarget | null
  setAppendTo: (target: AppendTarget | null) => void
  /** Si no es null, "Cobrar" entrega ese encargo (descuenta el anticipo). */
  delivery: DeliveryTarget | null
  /** Pone en el carrito lo del encargo para entregarlo. Devuelve lo que ya no se vende. */
  loadOrder: (order: Order, catalog: ProductWithCategory[]) => string[]
  /** Con opciones o nota, cada combinación es su propio renglón ("2 adobados, 1 natural"). */
  addItem: (product: CartProduct, options?: ProductOption[], note?: string) => void
  setNote: (key: string, note: string) => void
  /** Cobro de precio libre: siempre es un renglón nuevo, con su importe y descripción. */
  addOpenItem: (product: CartProduct, price: number, note: string) => void
  setQty: (key: string, quantity: number) => void
  setPrice: (key: string, price: number) => void
  removeItem: (key: string) => void
  clear: () => void
}

/**
 * El carrito se guarda en sessionStorage (igual que la sesión): una recarga accidental a
 * mitad de una venta no pierde los productos; cerrar la pestaña sí lo vacía.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      appendTo: null,
      delivery: null,
      setAppendTo: (appendTo) => set({ appendTo, delivery: null }),

      loadOrder: (order, catalog) => {
        const missing: string[] = []
        const items: CartItem[] = []
        for (const line of order.items) {
          const product = catalog.find((p) => p.id === line.productId)
          if (!product) {
            missing.push(line.name)
            continue
          }
          if (product.openPrice === 1) {
            const price = line.price ?? line.unitPrice
            items.push({
              key: `${product.id}:${randomId()}`,
              productId: product.id,
              name: line.name,
              price,
              originalPrice: price,
              unit: product.unit,
              quantity: line.quantity,
              openPrice: true,
              note: line.note
            })
            continue
          }
          const options = product.options.filter((o) => line.optionIds?.includes(o.id))
          if (options.length !== (line.optionIds?.length ?? 0)) {
            missing.push(line.name)
            continue
          }
          const { name, price } = withOptions(product, options)
          items.push({
            key: `${product.id}:${randomId()}`,
            productId: product.id,
            name,
            // Si le rebajaron el precio al encargar, se respeta (nunca arriba del de hoy).
            price: line.price != null ? Math.min(line.price, price) : price,
            originalPrice: price,
            unit: product.unit,
            quantity: line.quantity,
            note: line.note,
            optionIds: line.optionIds
          })
        }
        set({
          items,
          appendTo: null,
          delivery: {
            orderId: order.id,
            type: order.type,
            version: order.version,
            customerName: order.customerName,
            deposit: order.deposit
          }
        })
        return missing
      },

      addItem: (product, options = [], note = '') =>
        set((state) => {
          const optionIds = options.map((o) => o.id)
          const cleanNote = note.trim().replace(/\s+/g, ' ')
          const key =
            optionIds.length || cleanNote
              ? `${product.id}|${optionIds.join(',')}|${cleanNote.toLowerCase()}`
              : String(product.id)
          const existing = state.items.find((i) => i.key === key)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.key === key ? { ...i, quantity: i.quantity + 1 } : i
              )
            }
          }
          const { name, price } = withOptions(product, options)
          return {
            items: [
              ...state.items,
              {
                key,
                productId: product.id,
                name,
                price,
                originalPrice: price,
                unit: product.unit,
                quantity: 1,
                ...(optionIds.length ? { optionIds } : {}),
                ...(cleanNote ? { note: cleanNote } : {})
              }
            ]
          }
        }),

      setNote: (key, note) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.key === key && !i.openPrice
              ? {
                  ...i,
                  // Clave propia: lo que se agregue después del mismo producto no hereda la nota.
                  key: `${i.productId}:${randomId()}`,
                  note: note.trim().replace(/\s+/g, ' ') || undefined
                }
              : i
          )
        })),

      addOpenItem: (product, price, note) =>
        set((state) => ({
          items: [
            ...state.items,
            {
              key: `${product.id}:${randomId()}`,
              productId: product.id,
              name: note ? `${product.name} - ${note}` : product.name,
              price,
              originalPrice: price,
              unit: product.unit,
              quantity: 1,
              openPrice: true,
              note: note || undefined
            }
          ]
        })),

      setQty: (key, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.key !== key)
              : state.items.map((i) => (i.key === key ? { ...i, quantity } : i))
        })),

      setPrice: (key, price) =>
        set((state) => ({
          items: state.items.map((i) => (i.key === key && price > 0 ? { ...i, price } : i))
        })),

      removeItem: (key) => set((state) => ({ items: state.items.filter((i) => i.key !== key) })),

      clear: () => set({ items: [], appendTo: null, delivery: null })
    }),
    {
      name: 'pos-cart',
      storage: createJSONStorage(() => sessionStorage),
      // v1: cada renglón lleva `key` (antes se identificaba por productId).
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Pick<CartState, 'items' | 'appendTo' | 'delivery'>
        if (version < 1) {
          state.items = state.items.map((i) => ({ ...i, key: String(i.productId) }))
        }
        return state as CartState
      },
      partialize: (state) => ({
        items: state.items,
        appendTo: state.appendTo,
        delivery: state.delivery
      })
    }
  )
)

// El carrito es de quien lo armó: al salir o al entrar otro usuario en la misma pestaña,
// se vacía (en un F5 el usuario no cambia, así que se conserva).
useAuthStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id) useCartStore.getState().clear()
})

/** Total del carrito, redondeado a 2 decimales. */
export function cartTotal(items: CartItem[]): number {
  const raw = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  return Math.round((raw + Number.EPSILON) * 100) / 100
}

/** Artículos: las piezas por su cantidad; cada producto por peso cuenta como 1 (no 0.35). */
export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + (i.unit === 'KG' ? 1 : i.quantity), 0)
}

/** Renglones como los recibe el servidor. `price` sólo si el cajero lo editó (o es precio libre). */
export function cartLines(items: CartItem[]): CartLineInput[] {
  return items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    price: i.openPrice || i.price !== i.originalPrice ? i.price : undefined,
    note: i.note,
    optionIds: i.optionIds
  }))
}
