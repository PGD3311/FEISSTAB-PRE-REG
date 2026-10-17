/** A short, readable confirmation number for a paid order, e.g. FT-2026-7KQM. */
export function generateConfirmationNumber(): string {
  const year = new Date().getFullYear()
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // No 0/O, 1/I/L
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `FT-${year}-${code}`
}
