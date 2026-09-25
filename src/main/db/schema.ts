import * as pgSchema from './schema.pg'
import * as sqliteSchema from './schema.sqlite'

/**
 * Dialecto activo de la base de datos.
 *
 * - Sin `DATABASE_URL`  → SQLite (Fase 1, Electron de escritorio).
 * - Con `DATABASE_URL`  → PostgreSQL (Fase 2, servidor en red local).
 *
 * Ambos esquemas declaran las MISMAS tablas y columnas, así que la lógica de
 * negocio (`services/`, `routes/`) importa siempre desde este barril y no sabe
 * en qué motor corre.
 */
// Se tipa contra el esquema de PostgreSQL (dialecto asíncrono, igual que `DB`).
// En tiempo de ejecución puede ser cualquiera de los dos: las columnas y sus
// tipos inferidos (`$inferSelect`) son idénticos entre ambos.
const active = (process.env.DATABASE_URL ? pgSchema : sqliteSchema) as unknown as typeof pgSchema

export const {
  users,
  categories,
  products,
  cashSessions,
  sales,
  saleItems,
  customers,
  creditAccounts,
  creditPayments,
  cashMovements,
  config,
  license
} = active

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
export type CategoryRow = typeof categories.$inferSelect
export type ProductRow = typeof products.$inferSelect
export type CashSessionRow = typeof cashSessions.$inferSelect
export type SaleRow = typeof sales.$inferSelect
export type SaleItemRow = typeof saleItems.$inferSelect
export type CustomerRow = typeof customers.$inferSelect
export type CreditAccountRow = typeof creditAccounts.$inferSelect
export type CreditPaymentRow = typeof creditPayments.$inferSelect
export type CashMovementRow = typeof cashMovements.$inferSelect
export type ConfigRow = typeof config.$inferSelect
export type LicenseRow = typeof license.$inferSelect
