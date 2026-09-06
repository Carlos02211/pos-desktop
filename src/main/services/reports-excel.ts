import ExcelJS from 'exceljs'
import type { SalesReport } from '../../shared/types'
import type { ConfigMap } from './config'
import type { ReportSaleRow } from './reportes'

const TYPE_LABEL: Record<string, string> = {
  diario: 'Diario',
  semanal: 'Semanal',
  mensual: 'Mensual'
}

/** Genera el .xlsx de un reporte: hoja de resumen + hoja de detalle por venta. */
export async function generateReportExcel(
  report: SalesReport,
  detail: ReportSaleRow[],
  config: ConfigMap
): Promise<Buffer> {
  const currency = config.currency_symbol || '$'
  const money = `"${currency}"#,##0.00`

  const wb = new ExcelJS.Workbook()
  wb.creator = config.business_name || 'POS SpArTaN Tech'
  wb.created = new Date()

  /* --- Hoja Resumen --- */
  const resumen = wb.addWorksheet('Resumen')
  resumen.columns = [{ width: 28 }, { width: 18 }]
  resumen.addRow([config.business_name || 'Mi Negocio']).font = { bold: true, size: 14 }
  resumen.addRow([`Reporte ${TYPE_LABEL[report.type] ?? report.type}`])
  resumen.addRow([
    'Periodo',
    `${new Date(report.from * 1000).toLocaleString('es-MX')} — ${new Date(report.to * 1000).toLocaleString('es-MX')}`
  ])
  resumen.addRow([])

  resumen.addRow(['Total de ventas', report.totalSales]).getCell(2).numFmt = money
  resumen.addRow(['Transacciones', report.totalTransactions])
  resumen.addRow(['Efectivo', report.byPaymentMethod.CASH]).getCell(2).numFmt = money
  resumen.addRow(['Tarjeta', report.byPaymentMethod.CARD]).getCell(2).numFmt = money
  resumen.addRow(['Transferencia', report.byPaymentMethod.TRANSFER]).getCell(2).numFmt = money
  resumen.addRow([])

  resumen.addRow(['Top productos', 'Cantidad', 'Ingreso']).font = { bold: true }
  for (const p of report.topProducts) {
    resumen.addRow([p.name, p.quantity, p.revenue]).getCell(3).numFmt = money
  }

  /* --- Hoja Detalle --- */
  const det = wb.addWorksheet('Detalle')
  det.columns = [
    { header: 'Folio', key: 'ticket', width: 10 },
    { header: 'Fecha', key: 'fecha', width: 22 },
    { header: 'Cobrador', key: 'cobrador', width: 18 },
    { header: 'Método', key: 'metodo', width: 16 },
    { header: 'Artículos', key: 'items', width: 12 },
    { header: 'Total', key: 'total', width: 14, style: { numFmt: money } }
  ]
  det.getRow(1).font = { bold: true }
  for (const s of detail) {
    det.addRow({
      ticket: s.ticketNumber,
      fecha: new Date(s.createdAt * 1000),
      cobrador: s.userName,
      metodo: s.paymentMethod,
      items: s.itemCount,
      total: s.total
    })
  }
  det.getColumn('fecha').numFmt = 'yyyy-mm-dd hh:mm'

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out as ArrayBuffer)
}
