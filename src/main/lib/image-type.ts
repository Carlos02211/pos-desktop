/**
 * Detecta el tipo real de una imagen por sus "magic bytes" — no se confía en el
 * `Content-Type` que declara el cliente (es manipulable).
 */
export type ImageKind = 'png' | 'jpeg' | 'webp'

const EXT: Record<ImageKind, string> = { png: '.png', jpeg: '.jpg', webp: '.webp' }

export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png'
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  // WebP: "RIFF" .... "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  return null
}

export function extForImage(kind: ImageKind): string {
  return EXT[kind]
}
