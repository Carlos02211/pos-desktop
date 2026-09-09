import { CharacterSet, PrinterTypes, ThermalPrinter } from 'node-thermal-printer'
import type { PrintResult, SaleWithItems } from '../../shared/types'
import type { ConfigMap } from './config'

/**
 * Impresión de tickets ESC/POS (Xprinter XP-80T, emulación Epson).
 *
 * La interfaz se toma de `config.printer_interface`. Si está vacía o la impresora
 * no responde, `printTicket` NUNCA lanza: la venta ya está registrada y sólo se
 * informa al cliente que el ticket no salió.
 */

function fmtMoney(n: number, symbol: string): string {
  return `${symbol}${n.toFixed(2)}`
}

/** Cantidad legible en el ticket: piezas enteras tal cual, kg en gramos si es menos de 1 kg. */
function fmtQty(quantity: number, unit: 'PIEZA' | 'KG'): string {
  if (unit !== 'KG') return String(quantity)
  return quantity < 1 ? `${Math.round(quantity * 1000)}g` : `${quantity.toFixed(3)}kg`
}

/** Ticket en texto plano — puro y testeable, sin dependencia de la impresora. */
export function buildTicketLines(sale: SaleWithItems, config: ConfigMap): string[] {
  const symbol = config.currency_symbol || '$'
  const lines: string[] = []

  lines.push((config.business_name || 'Mi Negocio').toUpperCase())
  if (config.business_address) lines.push(config.business_address)
  if (config.business_phone) lines.push(`Tel: ${config.business_phone}`)
  lines.push('-'.repeat(32))
  lines.push(`Ticket #${sale.ticketNumber}`)
  lines.push(`Fecha: ${new Date(sale.createdAt * 1000).toLocaleString('es-MX')}`)
  lines.push(`Cobrador: ${sale.userName}`)
  if (sale.customerName) lines.push(`Cliente: ${sale.customerName}`)
  lines.push('-'.repeat(32))

  for (const item of sale.items) {
    lines.push(`${fmtQty(item.quantity, item.unit)} x ${item.name}`)
    lines.push(`${' '.repeat(10)}${fmtMoney(item.subtotal, symbol).padStart(22)}`)
  }

  lines.push('-'.repeat(32))
  lines.push(`TOTAL:${fmtMoney(sale.total, symbol).padStart(26)}`)
  lines.push(`Metodo: ${sale.paymentMethod}`)
  if (sale.paymentMethod === 'CASH') {
    lines.push(`Pago: ${fmtMoney(sale.amountPaid ?? 0, symbol)}`)
    lines.push(`Cambio: ${fmtMoney(sale.change ?? 0, symbol)}`)
  }
  lines.push('-'.repeat(32))
  lines.push(config.ticket_footer || '¡Gracias por su compra!')

  return lines
}

export async function printTicket(sale: SaleWithItems, config: ConfigMap): Promise<PrintResult> {
  const iface = config.printer_interface?.trim()
  if (!iface) {
    return { printed: false, error: 'Impresora no configurada' }
  }

  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: iface,
      characterSet: CharacterSet.PC858_EURO,
      removeSpecialCharacters: false,
      lineCharacter: '-'
    })

    const connected = await printer.isPrinterConnected()
    if (!connected) return { printed: false, error: 'Impresora no conectada' }

    const symbol = config.currency_symbol || '$'

    printer.alignCenter()
    printer.bold(true)
    printer.println((config.business_name || 'Mi Negocio').toUpperCase())
    printer.bold(false)
    if (config.business_address) printer.println(config.business_address)
    if (config.business_phone) printer.println(`Tel: ${config.business_phone}`)
    printer.drawLine()

    printer.alignLeft()
    printer.println(`Ticket #${sale.ticketNumber}`)
    printer.println(`Fecha: ${new Date(sale.createdAt * 1000).toLocaleString('es-MX')}`)
    printer.println(`Cobrador: ${sale.userName}`)
    printer.drawLine()

    for (const item of sale.items) {
      printer.tableCustom([
        { text: `${item.quantity}x ${item.name}`, align: 'LEFT', width: 0.65 },
        { text: fmtMoney(item.subtotal, symbol), align: 'RIGHT', width: 0.35 }
      ])
    }

    printer.drawLine()
    printer.bold(true)
    printer.tableCustom([
      { text: 'TOTAL', align: 'LEFT', width: 0.5 },
      { text: fmtMoney(sale.total, symbol), align: 'RIGHT', width: 0.5 }
    ])
    printer.bold(false)
    printer.println(`Metodo: ${sale.paymentMethod}`)
    if (sale.paymentMethod === 'CASH') {
      printer.println(`Pago: ${fmtMoney(sale.amountPaid ?? 0, symbol)}`)
      printer.println(`Cambio: ${fmtMoney(sale.change ?? 0, symbol)}`)
    }
    printer.drawLine()
    printer.alignCenter()
    printer.println(config.ticket_footer || '¡Gracias por su compra!')
    printer.cut()

    await printer.execute()
    return { printed: true }
  } catch (err) {
    return { printed: false, error: err instanceof Error ? err.message : 'Error de impresión' }
  }
}
