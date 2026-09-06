import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { ReportType } from '../../shared/types'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { getConfigMap } from '../services/config'
import { buildReport, salesInPeriod, type ReportParams } from '../services/reportes'
import { generateReportExcel } from '../services/reports-excel'
import { generateReportPdf } from '../services/reports-pdf'

const paramsSchema = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  inicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
  anio: z.coerce.number().int().min(2000).max(2100).optional()
})

const exportSchema = paramsSchema.extend({
  tipo: z.enum(['diario', 'semanal', 'mensual'])
})

function readParams(request: FastifyRequest): ReportParams {
  return parse(paramsSchema, request.query)
}

function slug(type: ReportType, from: number): string {
  return `reporte-${type}-${new Date(from * 1000).toISOString().slice(0, 10)}`
}

export async function reportesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reportes/diario', { preHandler: requireRole('ADMIN') }, async (request) =>
    buildReport(getDb(), 'diario', readParams(request))
  )
  app.get('/api/reportes/semanal', { preHandler: requireRole('ADMIN') }, async (request) =>
    buildReport(getDb(), 'semanal', readParams(request))
  )
  app.get('/api/reportes/mensual', { preHandler: requireRole('ADMIN') }, async (request) =>
    buildReport(getDb(), 'mensual', readParams(request))
  )

  app.get(
    '/api/reportes/exportar/excel',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const { tipo, ...params } = parse(exportSchema, request.query)
      const db = getDb()
      const report = await buildReport(db, tipo, params)
      const detail = await salesInPeriod(db, report.from, report.to)
      const buffer = await generateReportExcel(report, detail, await getConfigMap(db))
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${slug(tipo, report.from)}.xlsx"`)
        .send(buffer)
    }
  )

  app.get(
    '/api/reportes/exportar/pdf',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const { tipo, ...params } = parse(exportSchema, request.query)
      const db = getDb()
      const report = await buildReport(db, tipo, params)
      const detail = await salesInPeriod(db, report.from, report.to)
      const buffer = generateReportPdf(
        report,
        detail,
        await getConfigMap(db),
        app.posContext.uploadsDir
      )
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${slug(tipo, report.from)}.pdf"`)
        .send(buffer)
    }
  )
}
