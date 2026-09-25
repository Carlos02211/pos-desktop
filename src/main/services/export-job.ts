import { existsSync } from 'fs'
import { Worker } from 'worker_threads'
import type { SalesReport } from '../../shared/types'
import type { ConfigMap } from './config'
import type { ReportSaleRow } from './reportes'
import { generateReportExcel } from './reports-excel'
import { generateReportPdf } from './reports-pdf'

export interface ExportJob {
  kind: 'pdf' | 'xlsx'
  report: SalesReport
  detail: ReportSaleRow[]
  config: ConfigMap
  uploadsDir: string
}

/** Genera el archivo en el hilo actual. */
export async function generateExport(job: ExportJob): Promise<Buffer> {
  return job.kind === 'pdf'
    ? generateReportPdf(job.report, job.detail, job.config, job.uploadsDir)
    : generateReportExcel(job.report, job.detail, job.config)
}

/**
 * Genera la exportación en un worker si el bundle lo trae (`POS_EXPORT_WORKER`, lo fija el
 * servidor standalone: dist-server/export-worker.cjs). Sin worker (desarrollo, app de
 * escritorio de Fase 1, tests) se genera en el hilo principal, como antes.
 */
export function runExport(job: ExportJob): Promise<Buffer> {
  const workerPath = process.env.POS_EXPORT_WORKER
  if (!workerPath || !existsSync(workerPath)) return generateExport(job)

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath)
    worker.once('message', (msg: { ok: boolean; data?: Uint8Array; error?: string }) => {
      void worker.terminate()
      if (msg.ok && msg.data) resolve(Buffer.from(msg.data))
      else reject(new Error(msg.error ?? 'No se pudo generar la exportación.'))
    })
    worker.once('error', reject)
    worker.postMessage(job)
  })
}
