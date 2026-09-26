import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { getConfigMap } from '../services/config'
import { openCashDrawer } from '../services/printer'
import {
  addAbono,
  getCreditAccountDetail,
  listCreditAccounts,
  totalReceivable
} from '../services/cuentas'

const querySchema = z.object({
  status: z.enum(['OPEN', 'PAID', 'all']).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional()
})

const abonoSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER'])
})

const idParam = z.object({ id: z.coerce.number().int().positive() })

export async function cuentasRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cuentas', { preHandler: requireRole('COBRADOR') }, async (request) => {
    return listCreditAccounts(getDb(), parse(querySchema, request.query))
  })

  app.get('/api/cuentas/total', { preHandler: requireRole('COBRADOR') }, async () => ({
    total: await totalReceivable(getDb())
  }))

  app.get('/api/cuentas/:id', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const { id } = parse(idParam, request.params)
    return getCreditAccountDetail(getDb(), id)
  })

  app.post(
    '/api/cuentas/:id/abono',
    { preHandler: requireRole('COBRADOR') },
    async (request, reply) => {
      const { id } = parse(idParam, request.params)
      const input = parse(abonoSchema, request.body)
      const detail = await addAbono(getDb(), id, request.authUser!.id, input)
      if (input.paymentMethod === 'CASH') {
        const drawer = await openCashDrawer(await getConfigMap(getDb()))
        if (drawer.error) request.log.warn({ err: drawer.error }, 'cajón no abrió (abono)')
      }
      emit('cuenta:abono', {
        creditAccountId: detail.id,
        customerId: detail.customerId,
        balance: detail.balance,
        settled: detail.status === 'PAID'
      })
      return reply.code(201).send(detail)
    }
  )
}
