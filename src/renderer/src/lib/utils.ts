import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Helper estándar de shadcn/ui para componer clases de Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
