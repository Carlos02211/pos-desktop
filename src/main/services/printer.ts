import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { CharacterSet, PrinterTypes, ThermalPrinter } from 'node-thermal-printer'
import type {
  DrawerResult,
  Order,
  PrintResult,
  SaleWithItems,
  SystemPrinter,
  TicketLine
} from '../../shared/types'
import { formatMoney } from '../../shared/money-format'
import { businessOffsetMinutes } from '../lib/timezone'
import type { ConfigMap } from './config'
import { errorMessage } from '../lib/error-message'

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
      ? `La impresora no responde en ${net[1]}:${net[2] ?? '9100'}. Revisa que esté encendida, ` +
          'conectada a la misma red y que la IP sea la de su hoja de autoprueba.'
      : 'La impresora no está conectada: revisa el cable y que esté encendida.'
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
  if (!iface.trim()) return { printed: false, error: 'Elige una impresora primero.' }
  try {
    const { printer, timeoutMs } = createPrinter(iface.trim())
    await connectOrFail(printer, iface.trim())
    printer.alignCenter()
    printer.bold(true)
    printer.println('PRUEBA DE IMPRESIÓN')
    printer.bold(false)
    printer.println((config.business_name || 'Mi Negocio').toUpperCase())
    printer.drawLine()
    printer.alignLeft()
    printer.println(`Fecha: ${ticketDate(Math.floor(Date.now() / 1000), config)}`)
    printer.println('Si puede leer esto, la impresora')
    printer.println('está bien configurada.')
    printer.drawLine()
    printer.cut()
    await withTimeout(printer.execute(), timeoutMs, 'impresora')
    return { printed: true }
  } catch (err) {
    return { printed: false, error: errorMessage(err, 'No se pudo usar la impresora.') }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`La ${label} no respondió a tiempo (${Math.round(ms / 1000)} s).`)),
        ms
      ).unref()
    )
  ])
}

function fmtMoney(n: number, symbol: string): string {
  return formatMoney(n, symbol).replace('−', '-')
}

/** Cantidad legible en el ticket: piezas enteras tal cual, kg en gramos si es menos de 1 kg. */
function fmtQty(quantity: number, unit: 'PIEZA' | 'KG'): string {
  if (unit !== 'KG') return String(quantity)
  return quantity < 1 ? `${Math.round(quantity * 1000)}g` : `${quantity.toFixed(3)}kg`
}

const METHOD_LABEL: Record<SaleWithItems['paymentMethod'], string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  CREDIT: 'Fiado'
}

/** Fecha y hora en la zona del negocio: el proceso (pm2 como servicio) puede correr en UTC. */
function ticketDate(unixSeconds: number, config: ConfigMap): string {
  const d = new Date((unixSeconds + businessOffsetMinutes(config) * 60) * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  )
}

/** Columnas de un ticket de 80 mm con la fuente normal. */
const TICKET_COLS = 48

/** ¿El negocio usa impresora? Sin `printer_enabled` (instalaciones previas): si hay interfaz. */
export function printerEnabled(config: ConfigMap): boolean {
  const flag = config.printer_enabled ?? ''
  return flag === '1' || (flag === '' && !!config.printer_interface?.trim())
}

/**
 * Pulso de apertura del cajón (va en el puerto RJ11 de la impresora): `ESC p m t1 t2`.
 * Se arma a mano porque `openCashDrawer()` de la librería manda sólo `ESC p m` (3 bytes) y
 * la impresora se come los 2 bytes siguientes del ticket como tiempos del pulso.
 * 50 ms encendido (25×2) y 500 ms de pausa, en el pin 2 y en el 5: cada cajón viene
 * cableado a uno de los dos y el otro pulso no hace nada.
 */
const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x70, 0x01, 0x19, 0xfa])

/** El cajón se abre por la impresora: sin impresora activa no hay cajón. */
export function cashDrawerEnabled(config: ConfigMap): boolean {
  return printerEnabled(config) && config.cash_drawer === '1'
}

/** ¿Hay billetes que guardar? Efectivo, o el enganche en efectivo de una venta fiada. */
function receivesCash(sale: SaleWithItems): boolean {
  return (
    sale.paymentMethod === 'CASH' || (sale.paymentMethod === 'CREDIT' && (sale.amountPaid ?? 0) > 0)
  )
}

/**
 * Abre el cajón sin imprimir nada (botón del cobrador, abonos y movimientos en efectivo).
 * Nunca lanza. Con `ifaceOverride` (prueba desde Configuración) no se mira si está activado.
 */
export async function openCashDrawer(
  config: ConfigMap,
  ifaceOverride?: string
): Promise<DrawerResult> {
  if (ifaceOverride === undefined && !cashDrawerEnabled(config)) {
    return { opened: false, skipped: true }
  }
  const iface = (ifaceOverride ?? config.printer_interface ?? '').trim()
  if (!iface) return { opened: false, error: 'Falta elegir la impresora en Configuración.' }
  try {
    const { printer, timeoutMs } = createPrinter(iface)
    await connectOrFail(printer, iface)
    printer.add(DRAWER_KICK)
    await withTimeout(printer.execute(), timeoutMs, 'impresora')
    return { opened: true }
  } catch (err) {
    return { opened: false, error: errorMessage(err, 'No se pudo usar la impresora.') }
  }
}

/**
 * Abre el cajón sin esperar a la impresora (abonos y movimientos): si está apagada, el
 * cobrador no se queda los segundos del timeout con la pantalla colgada.
 */
export function openCashDrawerInBackground(
  config: ConfigMap,
  onError: (error: string) => void
): void {
  void openCashDrawer(config).then((r) => {
    if (r.error) onError(r.error)
  })
}

/**
 * Ticket de venta: sólo texto (sin logo: una imagen por ticket gasta papel, cabezal y
 * tiempo de impresión). Negocio, folio y turno de caja, fecha/hora, cobrador, productos,
 * total y cómo se pagó.
 */
export interface TicketOptions {
  /** Abrir el cajón si entra efectivo (venta o productos agregados, no reimpresión). */
  openDrawer?: boolean
  /** Reimpresión: el ticket dice que es copia y cuándo se imprimió (unix s). */
  reprintAt?: number
  /** Se agregaron productos a la venta: este ticket reemplaza al que ya se entregó. */
  updated?: boolean
  /** Reimpresión de un fiado: lo que debe HOY (tras abonos), además de lo que quedó a deber. */
  creditBalance?: number
  /** Ticket armado con datos de ejemplo (vista previa / publicidad), no una venta real. */
  sample?: boolean
  /** Venta del anticipo de este encargo: el ticket lleva también el comprobante del encargo. */
  order?: Order
}

/** Parte un texto en renglones de 48 columnas, cortando en espacios cuando se puede. */
function wrap(text: string): string[] {
  const out: string[] = []
  let rest = text.trimEnd()
  while (rest.length > TICKET_COLS) {
    let cut = rest.lastIndexOf(' ', TICKET_COLS)
    if (cut <= 0) cut = TICKET_COLS
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  out.push(rest)
  return out
}

/**
 * Renglón con texto a la izquierda y valor a la derecha, exactamente de 48 columnas. Si no
 * caben juntos, el texto va en su renglón y el valor alineado a la derecha en el siguiente.
 */
function pairText(left: string, right: string, leftWidth = 0.6): string[] {
  const leftCols = Math.floor(TICKET_COLS * leftWidth)
  const rightCols = TICKET_COLS - leftCols
  if (left.length >= leftCols || right.length > rightCols) {
    return [...wrap(left), right.padStart(TICKET_COLS)]
  }
  return [left.padEnd(leftCols) + right.padStart(rightCols)]
}

/**
 * El ticket como renglones (texto + alineación + negritas). Lo usan la impresora térmica y
 * la vista previa del navegador (Imprimir → PDF), así la vista previa es idéntica al papel.
 */
export function ticketLines(
  sale: SaleWithItems,
  config: ConfigMap,
  { reprintAt, updated = false, creditBalance, sample = false, order }: TicketOptions = {}
): TicketLine[] {
  const lines: TicketLine[] = []
  const add = (text: string, align: TicketLine['align'] = 'left', bold = false): void => {
    for (const t of wrap(text)) lines.push({ text: t, align, bold })
  }
  const pair = (left: string, right: string, leftWidth?: number, bold = false): void => {
    for (const t of pairText(left, right, leftWidth)) lines.push({ text: t, align: 'left', bold })
  }
  const rule = (): void => {
    lines.push({ text: '-'.repeat(TICKET_COLS), align: 'left', bold: false })
  }
  const symbol = config.currency_symbol || '$'
  const money = (n: number): string => fmtMoney(n, symbol)

  add((config.business_name || 'Mi Negocio').toUpperCase(), 'center', true)
  if (config.business_address) add(config.business_address, 'center')
  if (config.business_phone) add(`Tel: ${config.business_phone}`, 'center')
  if (sample) {
    add('TICKET DE EJEMPLO', 'center', true)
  } else if (reprintAt != null) {
    // Una copia no debe pasar por el original (devoluciones, garantías dos veces).
    add('*** REIMPRESIÓN ***', 'center', true)
    add(`Reimpreso: ${ticketDate(reprintAt, config)}`, 'center')
  } else if (updated) {
    add('TICKET ACTUALIZADO', 'center', true)
    add('Reemplaza al ticket anterior', 'center')
  }
  rule()

  // El folio vuelve a 1 en cada turno: folio + turno identifican el ticket (reimpresiones).
  pair(`Folio: ${sale.ticketNumber}`, `Turno de caja: ${sale.cashSessionId}`, 0.4)
  add(`Fecha: ${ticketDate(sale.createdAt, config)}`)
  add(`Cobrador: ${sale.userName}`)
  if (sale.customerName) add(`Cliente: ${sale.customerName}`)
  rule()

  for (const item of sale.items) {
    const label = `${fmtQty(item.quantity, item.unit)} x ${item.name}`
    // Nombre largo en su propio renglón: dentro de la columna se parte a media palabra.
    if (label.length > 32) {
      add(label)
      pair('', money(item.subtotal), 0.7)
    } else {
      pair(label, money(item.subtotal), 0.7)
    }
    if (item.note) add(`   > ${item.note}`)
  }

  rule()
  pair('TOTAL', money(sale.total), 0.5, true)
  pair('Pago', METHOD_LABEL[sale.paymentMethod])
  if (sale.paymentMethod === 'CASH') {
    pair('Recibido', money(sale.amountPaid ?? 0))
    pair('Cambio', money(sale.change ?? 0))
  } else if (sale.paymentMethod === 'CREDIT') {
    const paid = sale.amountPaid ?? 0
    if (paid > 0) pair('Enganche', money(paid))
    pair('Queda a deber', money(Math.round((sale.total - paid) * 100) / 100))
    if (creditBalance != null) {
      pair('Saldo actual', creditBalance > 0 ? money(creditBalance) : 'Pagado')
    }
  }
  rule()
  if (order) {
    lines.push(...orderBlock(order, config))
    rule()
  }
  add(config.ticket_footer || '¡Gracias por su compra!', 'center')
  return lines
}

/**
 * Comprobante del encargo: para quién, cuándo pasa, qué lleva y cuánto resta. Va al pie del
 * ticket del anticipo, o solo (`orderTicketLines`) si no dejaron anticipo.
 */
function orderBlock(order: Order, config: ConfigMap): TicketLine[] {
  const lines: TicketLine[] = []
  const add = (text: string, align: TicketLine['align'] = 'left', bold = false): void => {
    for (const t of wrap(text)) lines.push({ text: t, align, bold })
  }
  const pair = (left: string, right: string, leftWidth?: number, bold = false): void => {
    for (const t of pairText(left, right, leftWidth)) lines.push({ text: t, align: 'left', bold })
  }
  const symbol = config.currency_symbol || '$'
  const money = (n: number): string => fmtMoney(n, symbol)

  add(`ENCARGO #${order.id}`, 'center', true)
  add(`Para: ${order.customerName}${order.phone ? ` - Tel. ${order.phone}` : ''}`)
  add(`Pasa por él: ${ticketDate(order.pickupAt, config)}`, 'left', true)
  for (const item of order.items) {
    add(`${fmtQty(item.quantity, item.unit)} x ${item.name}`)
    if (item.note) add(`   > ${item.note}`)
  }
  if (order.notes) add(`Nota: ${order.notes}`)
  pair('Total del encargo', money(order.total), 0.6)
  if (order.deposit > 0) {
    pair('Anticipo', money(order.deposit), 0.6)
    pair('Resta por pagar', money(Math.round((order.total - order.deposit) * 100) / 100), 0.6, true)
  }
  return lines
}

/** Comprobante de un encargo sin anticipo (no hay venta: sólo el pedido). */
export function orderTicketLines(order: Order, config: ConfigMap): TicketLine[] {
  const lines: TicketLine[] = []
  const add = (text: string, align: TicketLine['align'] = 'left', bold = false): void => {
    for (const t of wrap(text)) lines.push({ text: t, align, bold })
  }
  const rule = (): void => {
    lines.push({ text: '-'.repeat(TICKET_COLS), align: 'left', bold: false })
  }
  add((config.business_name || 'Mi Negocio').toUpperCase(), 'center', true)
  if (config.business_address) add(config.business_address, 'center')
  if (config.business_phone) add(`Tel: ${config.business_phone}`, 'center')
  rule()
  add(`Fecha: ${ticketDate(order.createdAt, config)}`)
  add(`Atendió: ${order.userName}`)
  rule()
  lines.push(...orderBlock(order, config))
  rule()
  add('Se paga al recogerlo', 'center')
  return lines
}

export async function printTicket(
  sale: SaleWithItems,
  config: ConfigMap,
  options: TicketOptions = {}
): Promise<PrintResult> {
  // Primero el cajón: se abre mientras sale el ticket, no al terminar. Sólo en la venta
  // (`openDrawer`): una reimpresión no mete ni saca dinero.
  const kick = !!options.openDrawer && cashDrawerEnabled(config) && receivesCash(sale)
  return printLines(ticketLines(sale, config, options), config, kick)
}

/** Imprime el comprobante de un encargo sin anticipo. Nunca lanza. */
export async function printOrderTicket(order: Order, config: ConfigMap): Promise<PrintResult> {
  return printLines(orderTicketLines(order, config), config, false)
}

async function printLines(
  lines: TicketLine[],
  config: ConfigMap,
  kick: boolean
): Promise<PrintResult> {
  if (!printerEnabled(config)) return { printed: false, skipped: true }
  const iface = config.printer_interface?.trim()
  if (!iface) {
    return { printed: false, error: 'Falta elegir la impresora en Configuración' }
  }

  try {
    const { printer, timeoutMs } = createPrinter(iface)
    await connectOrFail(printer, iface)

    if (kick) printer.add(DRAWER_KICK)
    for (const line of lines) {
      if (line.align === 'center') printer.alignCenter()
      else printer.alignLeft()
      printer.bold(line.bold)
      printer.println(line.text)
    }
    printer.bold(false)
    printer.alignLeft()
    printer.cut()

    await withTimeout(printer.execute(), timeoutMs, 'impresora')
    return { printed: true }
  } catch (err) {
    return { printed: false, error: errorMessage(err, 'No se pudo usar la impresora.') }
  }
}
