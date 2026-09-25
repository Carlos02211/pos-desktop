/**
 * Convierte un logo a la versión que imprime una impresora térmica: blanco y negro puro,
 * al ancho de impresión, con tramado Floyd–Steinberg para que los grises y colores se vean
 * como puntos (si no, todo lo que no es casi negro sale en blanco y el logo desaparece).
 *
 * Se hace en el navegador (canvas) para que el servidor no necesite librerías de imagen
 * nativas. 384 px = ancho útil de una impresora de 58 mm; en una de 80 mm (576 px) sale
 * centrado.
 */
const MAX_WIDTH = 384
const MAX_HEIGHT = 200

export async function makeTicketLogo(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  const scale = Math.min(MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height, 1)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('El navegador no permite procesar la imagen.')
  // Fondo blanco: lo transparente del logo tiene que salir en blanco, no en negro.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const value = gray[i] < 128 ? 0 : 255
      const err = gray[i] - value
      gray[i] = value
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16
        gray[i + width] += (err * 5) / 16
        if (x + 1 < width) gray[i + width + 1] += err / 16
      }
    }
  }
  for (let i = 0; i < gray.length; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = gray[i]
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('No se pudo generar el logo del ticket.'))),
      'image/png'
    )
  )
}
