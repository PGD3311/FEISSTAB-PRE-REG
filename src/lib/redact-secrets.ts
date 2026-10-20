// Strips anything that looks like a key or token from text bound for logs or the database.
const SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /sb_secret_\S+/g,
  /sk_(?:live|test)_\S+/g
]

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, '[redacted]'), text)
}

/** A safe-to-log message for any thrown value. */
export function safeErrorMessage(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : 'unknown error')
}
