import { readFileSync } from 'fs'
import { extname, isAbsolute, join } from 'path'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { SalesReport } from '../../shared/types'
import type { ConfigMap } from './config'
import type { ReportSaleRow } from './reportes'

const TYPE_LABEL: Record<string, string> = {
  diario: 'Diario',
  semanal: 'Semanal',
  mensual: 'Mensual'
}

function loadLogoDataUri(
  config: ConfigMap,
  uploadsDir: string
): { uri: string; fmt: string } | null {
  const rel = config.logo_path?.trim()
  if (!rel) return null
  try {
    const path = isAbsolute(rel) ? rel : join(uploadsDir, rel)
    const ext = extname(path).toLowerCase()
    const fmt = ext === '.png' ? 'PNG' : ext === '.webp' ? 'WEBP' : 'JPEG'
    const b64 = readFileSync(path).toString('base64')
    const mime = fmt === 'PNG' ? 'image/png' : fmt === 'WEBP' ? 'image/webp' : 'image/jpeg'
    return { uri: `data:${mime};base64,${b64}`, fmt }
  } catch {
    return null
  }
}

/** Genera el .pdf de un reporte con membrete del negocio. */
export function generateReportPdf(
  report: SalesReport,
  detail: ReportSaleRow[],
  config: ConfigMap,
  uploadsDir: string
): Buffer {
  const currency = config.currency_symbol || '$'
  const money = (n: number): string => `${currency}${n.toFixed(2)}`

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 40
  let y = margin

  const logo = loadLogoDataUri(config, uploadsDir)
  if (logo) {
    try {
      doc.addImage(logo.uri, logo.fmt, margin, y, 48, 48)
    } catch {
      /* logo con formato no soportado por jsPDF */
    }
  }

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(config.business_name || 'Mi Negocio', logo ? margin + 60 : margin, y + 16)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Reporte ${TYPE_LABEL[report.type] ?? report.type}`, logo ? margin + 60 : margin, y + 32)
  doc.text(
    `${new Date(report.from * 1000).toLocaleString('es-MX')} — ${new Date(report.to * 1000).toLocaleString('es-MX')}`,
    logo ? margin + 60 : margin,
    y + 46
  )
  y += 70

  autoTable(doc, {
    startY: y,
    head: [['Resumen', '']],
    body: [
      ['Total de ventas', money(report.totalSales)],
      ['Transacciones', String(report.totalTransactions)],
      ['Efectivo', money(report.byPaymentMethod.CASH)],
      ['Tarjeta', money(report.byPaymentMethod.CARD)],
      ['Transferencia', money(report.byPaymentMethod.TRANSFER)]
    ],
    theme: 'striped',
    headStyles: { fillColor: [15, 52, 96] }
  })
  // @ts-expect-error jspdf-autotable añade lastAutoTable en runtime
  y = (doc.lastAutoTable?.finalY ?? y) + 20

  if (report.topProducts.length) {
    autoTable(doc, {
      startY: y,
      head: [['Top productos', 'Cantidad', 'Ingreso']],
      body: report.topProducts.map((p) => [p.name, String(p.quantity), money(p.revenue)]),
      theme: 'striped',
      headStyles: { fillColor: [15, 52, 96] }
    })
    // @ts-expect-error ver arriba
    y = (doc.lastAutoTable?.finalY ?? y) + 20
  }

  autoTable(doc, {
    startY: y,
    head: [['Folio', 'Fecha', 'Cobrador', 'Método', 'Art.', 'Total']],
    body: detail.map((s) => [
      `#${s.ticketNumber}`,
      new Date(s.createdAt * 1000).toLocaleString('es-MX'),
      s.userName,
      s.paymentMethod,
      String(s.itemCount),
      money(s.total)
    ]),
    theme: 'grid',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [15, 52, 96] }
  })

  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(
    `Generado el ${new Date().toLocaleString('es-MX')}`,
    margin,
    doc.internal.pageSize.getHeight() - 20
  )

  return Buffer.from(doc.output('arraybuffer'))
}
