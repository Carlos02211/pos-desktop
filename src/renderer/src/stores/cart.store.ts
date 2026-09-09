import { create } from 'zustand'
import type { ProductUnit, ProductWithCategory } from '@shared/types'

export interface CartItem {
  productId: number
  name: string
  price: number
  /** Precio de catálogo, para saber si `price` fue editado y poder restaurarlo. */
  originalPrice: number
  /** PIEZA = cantidad entera. KG = cantidad en kg, editable en gramos. */
  unit: ProductUnit
  quantity: number
}

interface CartState {
  items: CartItem[]
  addItem: (product: Pick<ProductWithCategory, 'id' | 'name' | 'price' | 'unit'>) => void
  setQty: (productId: number, quantity: number) => void
  setPrice: (productId: number, price: number) => void
  removeItem: (productId: number) => void
  clear: () => void
}

export const useCartStore = create<CartState>((set) => ({
  items: [],

  addItem: (product) =>
    set((state) => {
      const existing = state.items.find((i) => i.productId === product.id)
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
          )
        }
      }
      return {
        items: [
          ...state.items,
          {
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

  setQty: (productId, quantity) =>
    set((state) => ({
      items:
        quantity <= 0
          ? state.items.filter((i) => i.productId !== productId)
          : state.items.map((i) => (i.productId === productId ? { ...i, quantity } : i))
    })),

  setPrice: (productId, price) =>
    set((state) => ({
      items: state.items.map((i) => (i.productId === productId && price > 0 ? { ...i, price } : i))
    })),

  removeItem: (productId) =>
    set((state) => ({ items: state.items.filter((i) => i.productId !== productId) })),

  clear: () => set({ items: [] })
}))

/** Total del carrito, redondeado a 2 decimales. */
export function cartTotal(items: CartItem[]): number {
  const raw = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  return Math.round((raw + Number.EPSILON) * 100) / 100
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0)
}
