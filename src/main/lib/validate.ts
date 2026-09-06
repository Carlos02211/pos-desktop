import type { FastifyReply } from 'fastify'
import { z } from 'zod'

/**
 * Helpers de validación con Zod. Regla de desarrollo:
 * "Todo endpoint valida con Zod — nunca confiar en datos del cliente sin schema."
 */

export class ValidationError extends Error {
  constructor(public readonly issues: z.core.$ZodIssue[]) {
    super('Datos inválidos')
    this.name = 'ValidationError'
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw new ValidationError(result.error.issues)
  return result.data
}

/** Envía una respuesta 400 homogénea a partir de un ValidationError. */
export function sendValidationError(reply: FastifyReply, err: ValidationError): FastifyReply {
  return reply.code(400).send({
    error: 'Datos inválidos',
    details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  })
}
