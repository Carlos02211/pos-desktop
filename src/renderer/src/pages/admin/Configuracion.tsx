import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ConfigResponse } from '@shared/types'
import { API_BASE_URL, ApiRequestError } from '@/api/client'
import { getConfig, subirLogo, updateConfig } from '@/api/admin'
import { ImpresoraSection } from '@/components/admin/ImpresoraSection'
import { RespaldosSection } from '@/components/admin/RespaldosSection'

type Form = Omit<ConfigResponse, 'logo_path'>

/** Husos de México (sin horario de verano desde 2022, salvo la franja fronteriza). */
const TIMEZONES: { value: string; label: string }[] = [
  { value: '', label: 'La hora de la PC servidor' },
  { value: '-360', label: 'Centro — CDMX, Guadalajara, Monterrey (UTC−6)' },
  { value: '-300', label: 'Sureste — Quintana Roo (UTC−5)' },
  { value: '-420', label: 'Pacífico — Sinaloa, Sonora, BCS, Nayarit (UTC−7)' },
  { value: '-480', label: 'Noroeste — Baja California (UTC−8)' }
]

export default function Configuracion(): React.JSX.Element {
  const [form, setForm] = useState<Form | null>(null)
  const [logoPath, setLogoPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    getConfig()
      .then((c) => {
        if (cancelled) return
        const { logo_path, ...rest } = c
        setForm(rest)
        setLogoPath(logo_path)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof Form>(key: K, value: Form[K]): void {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }

  async function save(): Promise<void> {
    if (!form) return
    setSaving(true)
    try {
      // backup_dir lo guarda RespaldosSection al elegir la carpeta: no pisarlo con el
      // valor que se cargó al abrir la página.
      await updateConfig({ ...form, backup_dir: undefined })
      toast.success('Configuración guardada')
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  async function onLogo(file: File): Promise<void> {
    setUploading(true)
    try {
      const res = await subirLogo(file)
      setLogoPath(res.path)
      toast.success('Logo actualizado')
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo subir el logo')
    } finally {
      setUploading(false)
    }
  }

  if (!form) return <p className="text-sm text-muted-foreground">Cargando…</p>

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-xl font-bold">Configuración</h1>

      <div className="space-y-4">
        <section className="space-y-4 rounded-xl border border-border p-4">
          <h2 className="font-semibold">Negocio y ticket</h2>
          <Field label="Nombre del negocio">
            <input
              value={form.business_name}
              onChange={(e) => set('business_name', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Dirección">
            <input
              value={form.business_address}
              onChange={(e) => set('business_address', e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Teléfono">
              <input
                value={form.business_phone}
                onChange={(e) => set('business_phone', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Símbolo de moneda">
              <input
                value={form.currency_symbol}
                onChange={(e) => set('currency_symbol', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Mensaje al pie del ticket">
            <input
              value={form.ticket_footer}
              onChange={(e) => set('ticket_footer', e.target.value)}
              placeholder="¡Gracias por su compra!"
              className={inputClass}
            />
          </Field>
          <Field label="Logo (ticket y reportes PDF)">
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/40 text-xs text-muted-foreground">
                {logoPath ? (
                  <img
                    src={`${API_BASE_URL}/uploads/${logoPath}`}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                ) : (
                  'Sin logo'
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onLogo(f)
                }}
                disabled={uploading}
                className="text-xs"
              />
            </div>
          </Field>
        </section>

        <section className="space-y-4 rounded-xl border border-border p-4">
          <h2 className="font-semibold">Ventas</h2>
          <Field label="Zona horaria" hint="Define qué es “hoy” en el dashboard y los reportes.">
            <select
              value={form.business_utc_offset}
              onChange={(e) => set('business_utc_offset', e.target.value)}
              className={inputClass}
            >
              {!TIMEZONES.some((t) => t.value === form.business_utc_offset) && (
                <option value={form.business_utc_offset}>
                  Personalizada ({form.business_utc_offset} min)
                </option>
              )}
              {TIMEZONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Descuento máximo que puede hacer un cobrador (%)"
            hint="Al editar el precio de un producto en la venta. 100 = sin límite."
          >
            <input
              value={form.max_line_discount_pct}
              onChange={(e) => set('max_line_discount_pct', e.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </Field>
        </section>

        <ImpresoraSection
          value={form.printer_interface}
          onChange={(v) => set('printer_interface', v)}
        />

        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>

        <RespaldosSection />
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
