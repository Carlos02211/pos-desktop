import { asc, eq } from 'drizzle-orm'
import type { ProductWithCategory } from '../../shared/types'
import type { DB } from '../db'
import { categories, products } from '../db/schema'

/** Productos activos, con el nombre de su categoría, ordenados por nombre. */
export function listActiveProducts(db: DB): ProductWithCategory[] {
  return db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      categoryId: products.categoryId,
      imagePath: products.imagePath,
      active: products.active,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      categoryName: categories.name
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.active, 1))
    .orderBy(asc(products.name))
    .all()
}
