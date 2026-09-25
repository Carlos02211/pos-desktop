import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { CharacterSet, PrinterTypes, ThermalPrinter } from 'node-thermal-printer'
import type { PrintResult, SaleWithItems, SystemPrinter } from '../../shared/types'
import type { ConfigMap } from './config'

const execFileAsync = promisify(execFile)

/**
 * Impresión de tickets ESC/POS (Xprinter XP-80T, emulación Epson).
 *
 * La interfaz se toma de `config.printer_interface`. Si está vacía o la impresora
 * no responde, `printTicket` NUNCA lanza: la venta ya está registrada y sólo se
 * informa al cliente que el ticket no salió.
 */

/** Tope de tiempo para hablar con la impresora — una impresora muerta no puede
 *  colgar la respuesta de la venta más de esto. */
const PRINTER_TIMEOUT_MS = 4000
/** Por la cola de Windows hay que levantar PowerShell y compilar el helper: más lento. */
const SPOOLER_TIMEOUT_MS = 20_000

/**
 * Formatos de `config.printer_interface`:
 *  - `tcp://<ip>:<puerto>`  impresora de red (Ethernet/WiFi), puerto RAW (normalmente 9100)
 *  - `windows:<nombre>`     impresora instalada en Windows (USB) en la PC del servidor: se
 *                           manda el ESC/POS en crudo a la cola de impresión (winspool)
 *  - cualquier otra cosa    ruta de archivo/dispositivo (p. ej. `/dev/usb/lp0`, `COM3`)
 */
const WINDOWS_PREFIX = 'windows:'

/**
 * Envío RAW a la cola de impresión de Windows sin módulos nativos: PowerShell compila un
 * helper mínimo sobre winspool.drv. Sirve también cuando el servidor corre como servicio
 * ("Servicio local"), que no puede usar impresoras compartidas por red (\\localhost\…).
 * Nombre y archivo van por variables de entorno: nada del usuario se interpola en el script.
 */
const RAW_PRINT_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr h, byte[] data, int count, out int written);
  static Exception Fail() { return new Win32Exception(Marshal.GetLastWin32Error()); }
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw Fail();
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "Ticket POS";
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw Fail();
      try {
        if (!StartPagePrinter(h)) throw Fail();
        int written;
        if (!WritePrinter(h, data, data.Length, out written) || written != data.Length) throw Fail();
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
[PosRawPrinter]::Send($env:POS_PRINTER_NAME, [IO.File]::ReadAllBytes($env:POS_PRINTER_FILE))
`

function encodePs(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function sendToWindowsSpooler(printerName: string, data: Buffer): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Las impresoras de Windows sólo funcionan con el servidor en Windows.')
  }
  const file = join(tmpdir(), `pos-ticket-${randomUUID()}.bin`)
  await writeFile(file, data)
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(RAW_PRINT_PS)],
      {
        timeout: SPOOLER_TIMEOUT_MS,
        windowsHide: true,
        env: { ...process.env, POS_PRINTER_NAME: printerName, POS_PRINTER_FILE: file }
      }
    )
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? '')
    // PowerShell envuelve la excepción: quedarse con el mensaje de Windows.
    const msg = /Exception[^:]*:\s*"?([^"\r\n]+)/.exec(stderr)?.[1] ?? stderr.split('\n')[0]
    throw new Error(`Windows no pudo imprimir en "${printerName}": ${msg.trim() || 'error'}`)
  } finally {
    await unlink(file).catch(() => {})
  }
}

/** Interfaz propia para node-thermal-printer (acepta un objeto con estos dos métodos). */
function windowsSpoolerInterface(printerName: string): object {
  return {
    isPrinterConnected: async () => true, // el error real lo da la cola al imprimir
    execute: async (buffer: Buffer) => sendToWindowsSpooler(printerName, buffer)
  }
}

function createPrinter(iface: string): { printer: ThermalPrinter; timeoutMs: number } {
  const windows = iface.startsWith(WINDOWS_PREFIX)
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    // La librería acepta un objeto-interfaz; sus tipos sólo declaran string.
    interface: (windows
      ? windowsSpoolerInterface(iface.slice(WINDOWS_PREFIX.length))
      : iface) as unknown as string,
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
    lineCharacter: '-',
    options: { timeout: PRINTER_TIMEOUT_MS }
  })
  return { printer, timeoutMs: windows ? SPOOLER_TIMEOUT_MS : PRINTER_TIMEOUT_MS }
}

async function connectOrFail(printer: ThermalPrinter, iface: string): Promise<void> {
  const connected = await withTimeout(printer.isPrinterConnected(), PRINTER_TIMEOUT_MS, 'impresora')
  if (connected) return
  const net = /^tcp:\/\/([^/:]+)(?::(\d+))?/i.exec(iface)
  throw new Error(
    net
      ? `La impresora no responde en ${net[1]}:${net[2] ?? '9100'}. Revisá que esté encendida, ` +
          'conectada a la misma red y que la IP sea la de su hoja de autoprueba.'
      : 'Impresora no conectada'
  )
}

/** Impresoras instaladas en Windows (en la PC del servidor). Fuera de Windows: []. */
export async function listSystemPrinters(): Promise<SystemPrinter[]> {
  if (process.platform !== 'win32') return []
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-Printer | Select-Object Name,DriverName,PortName | ConvertTo-Json -Compress'
    ],
    { timeout: 15_000, windowsHide: true }
  )
  if (!stdout.trim()) return []
  const parsed = JSON.parse(stdout) as
    | { Name: string; DriverName?: string; PortName?: string }
    | { Name: string; DriverName?: string; PortName?: string }[]
  return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({
    name: p.Name,
    driver: p.DriverName ?? '',
    port: p.PortName ?? ''
  }))
}

/** Hoja de prueba: confirma interfaz, conexión y corte de papel. */
export async function printTestPage(iface: string, config: ConfigMap): Promise<PrintResult> {
  if (!iface.trim()) return { printed: false, error: 'Elegí una impresora primero.' }
  try {
    const { printer, timeoutMs } = createPrinter(iface.trim())
    await connectOrFail(printer, iface.trim())
    printer.alignCenter()
    printer.bold(true)
    printer.println('PRUEBA DE IMPRESION')
    printer.bold(false)
    printer.println((config.business_name || 'Mi Negocio').toUpperCase())
    printer.drawLine()
    printer.alignLeft()
    printer.println(`Fecha: ${new Date().toLocaleString('es-MX')}`)
    printer.println('Si puede leer esto, la impresora')
    printer.println('esta bien configurada.')
    printer.drawLine()
    printer.cut()
    await withTimeout(printer.execute(), timeoutMs, 'impresora')
    return { printed: true }
  } catch (err) {
    return { printed: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: sin respuesta en ${ms} ms`)), ms).unref()
    )
  ])
}

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

/** ¿El negocio usa impresora? Sin `printer_enabled` (instalaciones previas): si hay interfaz. */
export function printerEnabled(config: ConfigMap): boolean {
  const flag = config.printer_enabled ?? ''
  return flag === '1' || (flag === '' && !!config.printer_interface?.trim())
}

export async function printTicket(sale: SaleWithItems, config: ConfigMap): Promise<PrintResult> {
  if (!printerEnabled(config)) return { printed: false, skipped: true }
  const iface = config.printer_interface?.trim()
  if (!iface) {
    return { printed: false, error: 'Falta elegir la impresora en Configuración' }
  }

  try {
    const { printer, timeoutMs } = createPrinter(iface)
    await connectOrFail(printer, iface)

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

    await withTimeout(printer.execute(), timeoutMs, 'impresora')
    return { printed: true }
  } catch (err) {
    return { printed: false, error: err instanceof Error ? err.message : String(err) }
  }
}
