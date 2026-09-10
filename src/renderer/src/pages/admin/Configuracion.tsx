import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ConfigResponse } from '@shared/types'
import { API_BASE_URL, ApiRequestError } from '@/api/client'
import { getConfig, subirLogo, updateConfig } from '@/api/admin'

type Form = Omit<ConfigResponse, 'logo_path'>

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
      await updateConfig(form)
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
      <h1 className="mb-4 text-xl font-bold">Configuración del negocio</h1>

      <div className="space-y-4">
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
        <Field label="Pie de ticket">
          <input
            value={form.ticket_footer}
            onChange={(e) => set('ticket_footer', e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Zona horaria (min. vs UTC, ej. -360)">
            <input
              value={form.business_utc_offset}
              onChange={(e) => set('business_utc_offset', e.target.value)}
              placeholder="Vacío = hora del servidor"
              inputMode="numeric"
              className={inputClass}
            />
          </Field>
          <Field label="Descuento máx. del cobrador (%)">
            <input
              value={form.max_line_discount_pct}
              onChange={(e) => set('max_line_discount_pct', e.target.value)}
              placeholder="100 = sin límite"
              inputMode="numeric"
              className={inputClass}
            />
          </Field>
        </div>

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

        <div className="border-t border-border pt-4">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Avanzado</h2>
          <Field
            label="Impresora (interfaz)"
            hint="Vacío = deshabilitada. Ej: printer:XP-80T, tcp://192.168.1.100:9100"
          >
            <input
              value={form.printer_interface}
              onChange={(e) => set('printer_interface', e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="mt-4" />
          <Field
            label="Carpeta de respaldo"
            hint="Vacío = carpeta de datos de la app. Apunta al SSD de respaldo."
          >
            <input
              value={form.backup_dir}
              onChange={(e) => set('backup_dir', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
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
