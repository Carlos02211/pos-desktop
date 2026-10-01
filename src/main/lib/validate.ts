import type { FastifyReply } from 'fastify'
import { z } from 'zod'

/**
 * Helpers de validación con Zod. Regla de desarrollo:
 * "Todo endpoint valida con Zod — nunca confiar en datos del cliente sin schema."
 *
 * Los mensajes llegan tal cual a la pantalla del cobrador/admin: van en español de México y
 * dicen qué campo está mal ("El precio debe ser mayor o igual a 0"), no el texto técnico de Zod.
 */

/** Nombre legible de cada campo que validan las rutas. */
const FIELD_LABELS: Record<string, string> = {
  name: 'El nombre',
  price: 'El precio',
  unit: 'La unidad',
  barcode: 'El código de barras',
  categoryId: 'La categoría',
  quantity: 'La cantidad',
  productId: 'El producto',
  items: 'Los productos',
  paymentMethod: 'El método de pago',
  amountPaid: 'El monto recibido',
  amount: 'El importe',
  reason: 'El motivo',
  type: 'El tipo',
  customerId: 'El cliente',
  openingAmount: 'El monto inicial',
  closingAmount: 'El efectivo contado',
  username: 'El usuario',
  password: 'La contraseña',
  role: 'El rol',
  active: 'El estado',
  phone: 'El teléfono',
  notes: 'Las notas',
  note: 'La descripción',
  openPrice: 'El precio libre',
  trackStock: 'Llevar inventario',
  minStock: 'La existencia mínima',
  initialStock: 'La existencia inicial',
  counted: 'La existencia contada',
  productIds: 'Los productos',
  key: 'La clave de licencia',
  from: 'La fecha inicial',
  to: 'La fecha final',
  fecha: 'La fecha',
  mes: 'El mes',
  anio: 'El año',
  page: 'La página',
  interface: 'La impresora',
  path: 'La carpeta'
}

function fieldLabel(path: PropertyKey[]): string {
  // En listas ("items.0.quantity") importa el campo final, no el índice.
  const key = [...path].reverse().find((p) => typeof p === 'string') as string | undefined
  if (!key) return 'El dato'
  return FIELD_LABELS[key] ?? `El campo "${key}"`
}

/** Mensajes en español para los errores que de verdad se ven en esta app. */
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'too_small': {
        const min = Number(iss.minimum)
        if (iss.origin === 'string') {
          return min <= 1 ? 'no puede ir vacío' : `debe tener al menos ${min} caracteres`
        }
        if (iss.origin === 'array') return min <= 1 ? 'no puede ir vacío' : `mínimo ${min}`
        return iss.inclusive ? `debe ser mayor o igual a ${min}` : `debe ser mayor que ${min}`
      }
      case 'too_big': {
        const max = Number(iss.maximum)
        if (iss.origin === 'string') return `no puede pasar de ${max} caracteres`
        if (iss.origin === 'array') return `máximo ${max}`
        return iss.inclusive ? `no puede ser mayor que ${max}` : `debe ser menor que ${max}`
      }
      case 'invalid_type':
        return iss.input === undefined ? 'es obligatorio' : 'no es válido'
      case 'invalid_value':
        return 'no es una opción válida'
      case 'invalid_format':
        return 'no tiene el formato correcto'
      case 'not_multiple_of':
        return 'no es válido'
      case 'unrecognized_keys':
        return 'trae datos que no se esperaban'
      default:
        return 'no es válido'
    }
  }
})

export class ValidationError extends Error {
  constructor(public readonly issues: z.core.$ZodIssue[]) {
    super(describeIssue(issues[0]))
    this.name = 'ValidationError'
  }
}

/** "El precio debe ser mayor o igual a 0" — la frase que ve el usuario. */
function describeIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return 'Revisa los datos.'
  return `${fieldLabel(issue.path)} ${issue.message}.`
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw new ValidationError(result.error.issues)
  return result.data
}

/** Envía una respuesta 400 homogénea a partir de un ValidationError. */
export function sendValidationError(reply: FastifyReply, err: ValidationError): FastifyReply {
  return reply.code(400).send({
    error: err.message,
    details: err.issues.map((i) => ({
      path: i.path.join('.'),
      message: `${fieldLabel(i.path)} ${i.message}.`
    }))
  })
}
