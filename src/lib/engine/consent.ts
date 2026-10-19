/** The client's IP as the server sees it, from the proxy headers Vercel sets. */
export function clientIpFrom(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')?.trim()
  return real ? real : null
}
