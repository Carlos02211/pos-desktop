import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save, ShoppingCart, Store, Upload } from 'lucide-react'
import type { ConfigResponse } from '@shared/types'
import { API_BASE_URL, ApiRequestError } from '@/api/client'
import { getConfig, subirLogo, updateConfig } from '@/api/admin'
import { CashDrawerOption } from '@/components/admin/CashDrawerOption'
import { ImpresoraSection } from '@/components/admin/ImpresoraSection'
import { RespaldosSection } from '@/components/admin/RespaldosSection'
import { SettingsCard, actionButtonClass } from '@/components/admin/SettingsCard'
import { useBrandingStore } from '@/stores/branding.store'

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
  const setBranding = useBrandingStore((s) => s.set)
  const [form, setForm] = useState<Form | null>(null)
  // Lo último guardado, para saber si hay cambios pendientes.
  const [saved, setSaved] = useState<Form | null>(null)
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
        setSaved(rest)
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
      const res = await updateConfig({ ...form, backup_dir: undefined })
      setBranding({ businessName: res.business_name, logoPath: res.logo_path })
      setSaved(form)
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
      setBranding({ businessName: res.config.business_name, logoPath: res.config.logo_path })
      toast.success('Logo actualizado')
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo subir el logo')
    } finally {
      setUploading(false)
    }
  }

  if (!form) return <p className="text-sm text-muted-foreground">Cargando…</p>

  const dirty =
    saved != null &&
    (Object.keys(form) as (keyof Form)[]).some((k) => k !== 'backup_dir' && form[k] !== saved[k])

  return (
    <div className="max-w-2xl pb-4">
      <h1 className="text-xl font-bold">Configuración</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Los cambios de las primeras tres secciones se aplican al tocar{' '}
        <strong>Guardar cambios</strong>.
      </p>

      <div className="space-y-8">
        <SettingsCard
          icon={Store}
          title="Negocio y ticket"
          description="Datos que se imprimen en el ticket y aparecen en las pantallas."
        >
          <Field
            label="Nombre del negocio"
            hint="Aparece en la barra superior, el inicio de sesión, el ticket y los reportes."
          >
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
          <Field
            label="Logo"
            hint="Se muestra en la barra superior de todas las pantallas y en los reportes PDF."
          >
            <div className="flex items-center gap-4">
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
                  e.target.value = ''
                  if (f) void onLogo(f)
                }}
                disabled={uploading}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className={actionButtonClass}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploading ? 'Subiendo…' : logoPath ? 'Cambiar logo…' : 'Subir logo…'}
              </button>
              <span className="text-xs text-muted-foreground">
                PNG, JPG o WebP. Se guarda al instante.
              </span>
            </div>
          </Field>
        </SettingsCard>

        <SettingsCard
          icon={ShoppingCart}
          title="Ventas"
          description="Reglas para los cobradores y el horario de los reportes."
        >
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
        </SettingsCard>

        <ImpresoraSection
          enabled={
            form.printer_enabled === '1' ||
            (form.printer_enabled === '' && !!form.printer_interface.trim())
          }
          onEnabledChange={(on) => set('printer_enabled', on ? '1' : '0')}
          value={form.printer_interface}
          onChange={(v) => set('printer_interface', v)}
          extra={
            <CashDrawerOption
              enabled={form.cash_drawer === '1'}
              printerInterface={form.printer_interface}
              onEnabledChange={(on) => set('cash_drawer', on ? '1' : '0')}
            />
          }
        />

        {/* Barra fija abajo: el botón queda a la vista sin importar dónde esté el scroll. */}
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-5 py-3 shadow-lg backdrop-blur">
          <span
            className={
              dirty ? 'text-sm font-medium text-pos-warning' : 'text-sm text-muted-foreground'
            }
          >
            {dirty ? 'Tienes cambios sin guardar' : 'Todo guardado'}
          </span>
          <button
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>

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
