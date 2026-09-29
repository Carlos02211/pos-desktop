import { parentPort } from 'worker_threads'
import { generateExport, type ExportJob } from './export-job'

/**
 * Hilo aparte para generar PDF / Excel de reportes. El PDF de un mes con miles de ventas
 * tarda segundos de CPU; en el hilo principal eso congelaba a TODAS las cajas (ventas,
 * socket) mientras tanto. Un trabajo por worker: recibe el job, responde y termina.
 */
parentPort?.once('message', async (job: ExportJob) => {
  try {
    const buffer = await generateExport(job)
    parentPort!.postMessage({ ok: true, data: new Uint8Array(buffer) })
  } catch (err) {
    parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
