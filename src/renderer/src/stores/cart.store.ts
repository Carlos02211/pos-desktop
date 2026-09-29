import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PaymentMethod, ProductUnit, ProductWithCategory } from '@shared/types'
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
  /** Descripción del cobro de precio libre ("Engargolado"); sale en el ticket. */
  note?: string
}

type CartProduct = Pick<ProductWithCategory, 'id' | 'name' | 'price' | 'unit'>

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
  addItem: (product: CartProduct) => void
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
      setAppendTo: (appendTo) => set({ appendTo }),

      addItem: (product) =>
        set((state) => {
          const key = String(product.id)
          const existing = state.items.find((i) => i.key === key)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.key === key ? { ...i, quantity: i.quantity + 1 } : i
              )
            }
          }
          return {
            items: [
              ...state.items,
              {
                key,
                productId: product.id,
                name: product.name,
                price: product.price,
                originalPrice: product.price,
                unit: product.unit,
                quantity: 1
              }
            ]
          }
        }),

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

      clear: () => set({ items: [], appendTo: null })
    }),
    {
      name: 'pos-cart',
      storage: createJSONStorage(() => sessionStorage),
      // v1: cada renglón lleva `key` (antes se identificaba por productId).
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Pick<CartState, 'items' | 'appendTo'>
        if (version < 1) {
          state.items = state.items.map((i) => ({ ...i, key: String(i.productId) }))
        }
        return state as CartState
      },
      partialize: (state) => ({ items: state.items, appendTo: state.appendTo })
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
