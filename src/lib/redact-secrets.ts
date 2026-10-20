// Strips anything that looks like a key or token from text bound for logs or the database.
const REDACTED = '[redacted]'

// A pasted key can have spaces or newlines inside it, so the JWT and sb_secret_ patterns
// accept whitespace between pieces. Trailing pieces are kept only if they look like key
// material (mixed case or digits), so ordinary words after the key survive.
const JWT_LOOSE =
  /eyJ[\w-]+(?:\s+(?!eyJ)[\w-]+)*\.[\w-]+(?:\s+(?!eyJ)[\w-]+)*\.[\w-]+(?:\s+(?!eyJ)[\w-]+)*/g
const SB_SECRET_LOOSE = /sb_secret_[\w-]+(?:\s+(?!eyJ)[\w-]+)*/g

function looksLikeKeyPiece(piece: string): boolean {
  return piece.length >= 3 && /[A-Z0-9]/.test(piece) && !piece.startsWith('eyJ')
}

function redactLoose(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match) => {
    const pieces = match.split(/(\s+)/) // keeps the whitespace separators
    let keep = 1
    for (let i = 2; i < pieces.length; i += 2) {
      if (!looksLikeKeyPiece(pieces[i])) break
      keep = i + 1
    }
    return REDACTED + pieces.slice(keep).join('')
  })
}

const SIMPLE_PATTERNS: RegExp[] = [/(?:sk|rk)_(?:live|test)_\S+/g, /whsec_\S+/g]

/**
 * Pure. `knownSecrets` are exact values to remove wherever they appear (whitespace inside
 * them included, and also with the whitespace removed).
 */
export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let out = text
  for (const secret of knownSecrets) {
    if (secret.length < 8) continue
    out = out.split(secret).join(REDACTED)
    const squashed = secret.replace(/\s+/g, '')
    if (squashed !== secret) out = out.split(squashed).join(REDACTED)
  }
  out = out.replace(/(Headers\.set:\s*)"[^"]*"/g, `$1"${REDACTED}"`)
  out = redactLoose(out, JWT_LOOSE)
  out = redactLoose(out, SB_SECRET_LOOSE)
  return SIMPLE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, REDACTED), out)
}

/** Reads the current key values from the environment (not pure; keep redactSecrets pure). */
export function envSecrets(): string[] {
  return [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY]
    .map((v) => v?.trim() ?? '')
    .filter((v) => v !== '')
}

/** Redacts text with both the patterns and the live key values. */
export function redactWithEnv(text: string): string {
  return redactSecrets(text, envSecrets())
}

/** A safe-to-log message for any thrown value. */
export function safeErrorMessage(err: unknown): string {
  return redactWithEnv(err instanceof Error ? err.message : 'unknown error')
}
