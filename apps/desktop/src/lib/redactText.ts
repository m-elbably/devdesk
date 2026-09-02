const SECRET_VALUE = /((?:api[_-]?key|password|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi
const BEARER_VALUE = /(authorization\s*:\s*bearer\s+)[^\s,]+/gi

export function redactText(value: string): string {
  return value
    .replace(BEARER_VALUE, '$1[REDACTED]')
    .replace(SECRET_VALUE, '$1[REDACTED]')
}
