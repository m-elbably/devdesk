// Declarative UI descriptor per tool. One generic <ToolRunner> renders these,
// so adding a tool means adding logic (in @devdesk/tools) + one entry here —
// no bespoke Vue component. Field `name`s must match the plugin's schema keys.

// Optional: only render this field when another field's value is one of `in`.
// `newRow` forces a line break in the toolbar before this field, for tools
// with too many controls to read as one crowded flex-wrap line.
type Visibility = { showWhen?: { field: string; in: string[] }; newRow?: boolean }

export type Field = Visibility &
  (
    // `presets` renders one-click chips that fill the field — for date tools,
    // where the useful values ("now", "+7d") are short, common, and awkward to type.
    // `datePicker`/`colorPicker` add a native datetime-local/color control next
    // to the text input: a point-and-click way to fill the same field the
    // presets and free typing do.
    | { kind: 'text' | 'textarea'; name: string; label: string; placeholder?: string; default?: string; nowrap?: boolean; wide?: boolean; copyPaste?: boolean; presets?: string[]; datePicker?: boolean; colorPicker?: boolean }
    | { kind: 'number'; name: string; label: string; default?: number; min?: number; max?: number; step?: number; fallback?: number }
    | { kind: 'select'; name: string; label: string; options: string[]; default?: string }
    | { kind: 'checkbox'; name: string; label: string; default?: boolean }
    // Searchable multi-select of IANA time zones. Bound to a comma-separated
    // string in the model, same shape a hand-typed zones list would be —
    // the plugin schema doesn't need to know this field has a picker.
    | { kind: 'timezones'; name: string; label: string; default?: string; presets?: { label: string; value: string }[] }
  )

export type OutputKind = 'text' | 'code' | 'json' | 'svg' | 'list' | 'keyvalue' | 'diff' | 'keypair' | 'otp' | 'jwt'

/**
 * An extra graphic shown above the output, derived from the result the tool
 * already returns — a key/value table is correct but makes you decode it, and
 * these are the tools where the answer is fundamentally spatial.
 */
export type VisualKind = 'timeline' | 'bits' | 'swatch' | 'chmod' | 'subnets' | 'histogram' | 'ratio'

export interface UiSpec {
  fields: Field[]
  output: OutputKind
  visual?: VisualKind
  language?: string
  /** Require a button press instead of running live (generators with randomness). */
  manual?: boolean
  actionLabel?: string
  /** Small assumptions/caveats note shown under the output (e.g. what a calculation ignores). */
  note?: string
  /** Show a visual password-strength meter below the output, analysing the raw text result. */
  strengthMeter?: boolean
  /** Re-run every second even without input changes (e.g. a TOTP code ticking over). */
  liveTick?: boolean
}

const modeField: Field = { kind: 'select', name: 'mode', label: 'Mode', options: ['encode', 'decode'] }

export const TOOL_UI: Record<string, UiSpec> = {
  // JSON
  'json-diff': { fields: [{ kind: 'textarea', name: 'left', label: 'Left' }, { kind: 'textarea', name: 'right', label: 'Right' }], output: 'diff' },
  'json-to-ts': { fields: [{ kind: 'textarea', name: 'text', label: 'JSON' }, { kind: 'text', name: 'rootName', label: '', placeholder: 'Root name', default: 'Root' }], output: 'code', language: 'typescript' },

  // Encoding
  base64: {
    fields: [
      { kind: 'textarea', name: 'text', label: 'Text' },
      modeField,
      { kind: 'select', name: 'variant', label: 'Alphabet', options: ['standard', 'url-safe'], default: 'standard', showWhen: { field: 'mode', in: ['encode'] } },
      { kind: 'checkbox', name: 'padding', label: 'Padding (=)', default: true, showWhen: { field: 'mode', in: ['encode'] } },
    ],
    output: 'text',
    note: 'Decoding accepts either alphabet, with or without padding, and ignores line breaks — no need to match the encoder. Base64 is an encoding, not encryption: anyone can decode it.',
  },
  'url-encoder': {
    fields: [
      { kind: 'textarea', name: 'text', label: 'Text' },
      modeField,
      { kind: 'select', name: 'variant', label: 'Target', options: ['component', 'full-uri', 'form'], default: 'component' },
    ],
    output: 'text',
    note: 'Component escapes a single value (query param, path segment). Full-uri keeps :/?#&= intact, for a whole URL. Form is application/x-www-form-urlencoded — spaces become +.',
  },
  'html-escape': {
    fields: [
      { kind: 'textarea', name: 'text', label: 'Text' },
      modeField,
      { kind: 'select', name: 'variant', label: 'Escape', options: ['minimal', 'non-ascii'], default: 'minimal', showWhen: { field: 'mode', in: ['encode'] } },
    ],
    output: 'text',
    note: 'Minimal escapes the five characters that matter for XSS; non-ascii additionally turns every character above U+007F into a numeric reference. Decoding handles named and numeric entities alike.',
  },
  'hex-converter': {
    fields: [
      { kind: 'textarea', name: 'text', label: 'Input' },
      { kind: 'select', name: 'from', label: 'Input is', options: ['text', 'hex', 'binary', 'decimal'], default: 'text' },
    ],
    output: 'keyvalue',
    note: 'Separators are ignored on input — "48 65 78", "48:65:78", "0x48,0x65" and "486578" all read the same. Bytes that are not valid UTF-8 are reported as such rather than shown as replacement characters.',
  },
  'unicode-inspector': {
    fields: [{ kind: 'textarea', name: 'text', label: 'Text' }],
    output: 'list',
    note: 'One row per code point, not per UTF-16 unit — an emoji is one row. Columns: code point, glyph, general category, UTF-8 bytes, JS escape, HTML entity. Character names are not included; no JS runtime ships the Unicode name database.',
  },
  'code-escape': {
    fields: [{ kind: 'textarea', name: 'text', label: 'Text' }],
    output: 'keyvalue',
    note: 'Escaping makes a string safe to embed as a literal — it is not a substitute for parameterised SQL queries or argument arrays, which avoid the problem instead of papering over it.',
  },

  // Crypto
  uuid: { fields: [
    { kind: 'number', name: 'count', label: 'How many', default: 5, min: 1, max: 100 },
    { kind: 'select', name: 'version', label: 'Version', options: ['v1', 'v3', 'v4', 'v5'], default: 'v4' },
    { kind: 'select', name: 'namespace', label: 'Namespace', options: ['DNS', 'URL', 'OID', 'X500'], default: 'DNS', showWhen: { field: 'version', in: ['v3', 'v5'] } },
    { kind: 'text', name: 'name', label: 'Name', placeholder: 'name to hash', default: '', showWhen: { field: 'version', in: ['v3', 'v5'] } },
  ], output: 'list', manual: true, actionLabel: 'Generate' },
  ulid: { fields: [{ kind: 'number', name: 'count', label: 'How many', default: 5, min: 1, max: 100 }], output: 'list', manual: true, actionLabel: 'Generate' },
  hash: { fields: [{ kind: 'textarea', name: 'text', label: 'Text' }, { kind: 'select', name: 'algorithm', label: 'Algorithm', options: ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'], default: 'SHA-256' }], output: 'text' },
  hmac: { fields: [
    { kind: 'textarea', name: 'text', label: 'Message' },
    { kind: 'text', name: 'secret', label: 'Secret key', nowrap: true },
    { kind: 'select', name: 'algorithm', label: 'Algorithm', options: ['MD5', 'SHA1', 'SHA224', 'SHA256', 'SHA384', 'SHA512', 'SHA3'], default: 'SHA256' },
    { kind: 'select', name: 'encoding', label: 'Output encoding', options: ['binary', 'hex', 'base64', 'base64url'], default: 'hex' },
  ], output: 'text' },
  'totp-hotp': {
    fields: [
      { kind: 'select', name: 'mode', label: 'Mode', options: ['TOTP', 'HOTP'], default: 'TOTP' },
      { kind: 'text', name: 'secret', label: 'Base32 secret', placeholder: 'JBSWY3DPEHPK3PXP', nowrap: true, wide: true, copyPaste: true },
      { kind: 'select', name: 'algorithm', label: 'Algorithm', options: ['SHA1', 'SHA256', 'SHA512'], default: 'SHA1', newRow: true },
      { kind: 'select', name: 'digits', label: 'Digits', options: ['6', '8'], default: '6' },
      { kind: 'number', name: 'period', label: 'Period (s)', default: 30, min: 5, max: 300, showWhen: { field: 'mode', in: ['TOTP'] }, newRow: true },
      { kind: 'number', name: 'counter', label: 'Counter', default: 0, min: 0, showWhen: { field: 'mode', in: ['HOTP'] }, newRow: true },
      // Label the enrolment QR so a scanning app shows "Example: you@example.com".
      { kind: 'text', name: 'issuer', label: 'Issuer', placeholder: 'Example Inc', default: '' },
      { kind: 'text', name: 'account', label: 'Account', placeholder: 'you@example.com', default: '' },
    ],
    output: 'otp',
    liveTick: true,
    note: 'Runs entirely in your browser — the secret never leaves this device. Paste the Base32 secret shown when an app enrolls you in 2FA (usually alongside its QR code), or scan the QR here to enroll a real authenticator app.',
  },
  token: { fields: [
    { kind: 'number', name: 'length', label: 'Length', default: 32, min: 4, max: 256 },
    { kind: 'select', name: 'charset', label: 'Charset', options: ['custom', 'hex', 'base64url', 'alphanumeric'], default: 'hex' },
    { kind: 'checkbox', name: 'uppercase', label: 'A-Z', default: true, showWhen: { field: 'charset', in: ['custom'] } },
    { kind: 'checkbox', name: 'lowercase', label: 'a-z', default: true, showWhen: { field: 'charset', in: ['custom'] } },
    { kind: 'checkbox', name: 'digits', label: '0-9', default: true, showWhen: { field: 'charset', in: ['custom'] } },
    { kind: 'checkbox', name: 'symbols', label: 'Symbols', default: false, showWhen: { field: 'charset', in: ['custom'] } },
  ], output: 'text', manual: true, actionLabel: 'Generate' },
  password: { fields: [{ kind: 'number', name: 'length', label: 'Length', default: 20, min: 6, max: 128 }, { kind: 'checkbox', name: 'uppercase', label: 'A-Z', default: true }, { kind: 'checkbox', name: 'lowercase', label: 'a-z', default: true }, { kind: 'checkbox', name: 'digits', label: '0-9', default: true }, { kind: 'checkbox', name: 'symbols', label: 'Symbols', default: true }], output: 'text', manual: true, actionLabel: 'Generate', strengthMeter: true },
  'password-strength': {
    fields: [{ kind: 'text', name: 'password', label: 'Password', placeholder: 'Enter a password', nowrap: true, wide: true, copyPaste: true }],
    output: 'keyvalue',
    note: 'Assumes a brute-force attack at 1 billion guesses/sec. Real attacks vary by hardware, and common/reused passwords fall in seconds to a dictionary attack regardless of length — see the info panel for details.',
  },
  'uuid-inspector': {
    fields: [{ kind: 'text', name: 'uuid', label: 'UUID', placeholder: '018f4e2a-7c3b-7000-8000-1234567890ab', wide: true, copyPaste: true }],
    output: 'keyvalue',
    note: 'Braced and urn:uuid: forms are accepted. Only v1, v6 and v7 embed a timestamp — a v4 UUID is random, so it carries no creation time to recover, and a node that is flagged random is not a real MAC address.',
  },
  'jwt-parser': { fields: [{ kind: 'textarea', name: 'token', label: 'JWT' }], output: 'jwt' },
  'jwt-signer': {
    fields: [
      { kind: 'textarea', name: 'payload', label: 'Payload (JSON)', placeholder: '{"sub":"123","name":"Ada"}' },
      { kind: 'text', name: 'secret', label: 'Secret', nowrap: true, copyPaste: true },
      { kind: 'select', name: 'algorithm', label: 'Algorithm', options: ['HS256', 'HS384', 'HS512'], default: 'HS256' },
      { kind: 'number', name: 'expiresIn', label: 'Expires in (s)', default: 3600, min: 0, step: 60 },
    ],
    output: 'text',
    note: 'Runs entirely in your browser — the secret never leaves this device. Signs with HMAC only (HS256/384/512); RS/ES algorithms need a private key. An `iat` claim is added, and `exp` when the expiry is above zero — a payload that sets either one keeps its own value.',
  },
  'cert-parser': {
    fields: [{ kind: 'textarea', name: 'pem', label: 'PEM certificate', placeholder: '-----BEGIN CERTIFICATE-----' }],
    output: 'keyvalue',
    visual: 'timeline',
    note: 'Runs entirely in your browser — the certificate never leaves this device. Reads the certificate only; it does not check the signature, the chain, or revocation.',
  },
  // fallback: boundary sizes (256, 16384) are unreliable across crypto engines — an
  // out-of-range value snaps to a known-good 4096 instead of the min/max edge.
  'rsa-keypair': { fields: [{ kind: 'number', name: 'bits', label: 'Bits', default: 2048, min: 256, max: 16384, step: 8, fallback: 4096 }], output: 'keypair', manual: true, actionLabel: 'Refresh key-pair' },
  encryption: { fields: [{ kind: 'textarea', name: 'text', label: 'Text' }, { kind: 'text', name: 'secret', label: 'Secret', placeholder: 'passphrase' }, { kind: 'select', name: 'algorithm', label: 'Algorithm', options: ['AES', 'TripleDES', 'Rabbit', 'RC4'], default: 'AES' }, { kind: 'select', name: 'mode', label: 'Mode', options: ['encrypt', 'decrypt'], default: 'encrypt' }], output: 'text' },

  // Web
  'url-parser': {
    fields: [{ kind: 'text', name: 'url', label: 'URL', placeholder: 'example.com/p?a=1&b=2#top', wide: true, copyPaste: true }],
    output: 'keyvalue',
    note: 'A missing scheme is assumed to be https. Query values are shown decoded, and repeated keys each get their own row.',
  },
  'basic-auth': {
    fields: [
      { kind: 'select', name: 'mode', label: 'Mode', options: ['encode', 'decode'] },
      { kind: 'text', name: 'username', label: 'Username', showWhen: { field: 'mode', in: ['encode'] } },
      { kind: 'text', name: 'password', label: 'Password', showWhen: { field: 'mode', in: ['encode'] } },
      { kind: 'text', name: 'header', label: 'Header or token', placeholder: 'Authorization: Basic dTpw', wide: true, copyPaste: true, showWhen: { field: 'mode', in: ['decode'] } },
    ],
    output: 'keyvalue',
    note: 'Base64 is not encryption — a Basic header is trivially reversible, as the decode mode here shows. Only send it over HTTPS.',
  },
  slugify: {
    fields: [
      { kind: 'text', name: 'text', label: 'Text', wide: true },
      { kind: 'text', name: 'separator', label: 'Separator', default: '-' },
      { kind: 'select', name: 'case', label: 'Case', options: ['lower', 'upper', 'preserve'], default: 'lower' },
      { kind: 'number', name: 'maxLength', label: 'Max length', default: 0, min: 0, max: 200 },
    ],
    output: 'text',
    note: 'Max length 0 means no limit. Truncation falls back to the last whole word so the slug never ends mid-word.',
  },
  'user-agent': {
    // Prefilled with this device's own UA — the string you most often want to
    // check first, and it saves a trip to a "what is my user agent" site.
    fields: [{ kind: 'textarea', name: 'ua', label: 'User-Agent', default: globalThis.navigator?.userAgent ?? '' }],
    output: 'keyvalue',
    note: 'Starts with this device’s own User-Agent. Parsing is best-effort: UA strings are freely spoofable and browsers impersonate each other, so never gate security or features on this.',
  },
  'http-status': {
    // `default` makes the search box auxiliary rather than required input, so an
    // empty query lists the whole reference instead of an empty panel.
    fields: [{ kind: 'text', name: 'query', label: 'Search', placeholder: '404, "not found", or 4xx', default: '', wide: true }],
    output: 'keyvalue',
  },
  'curl-converter': {
    fields: [
      { kind: 'textarea', name: 'command', label: 'curl command', placeholder: `curl -X POST https://api.example.com/users \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"Ada"}'` },
      { kind: 'select', name: 'target', label: 'Target', options: ['fetch', 'axios', 'httpie'], default: 'fetch' },
    ],
    output: 'code',
    // Two of the three targets are JavaScript; the HTTPie shell line falls back
    // to highlight.js auto-detection, which reads it fine.
    language: 'javascript',
    note: 'Paste straight from DevTools → Network → Copy as cURL. Quotes, line continuations and repeated -d flags are handled; -o, -m and other transfer-only flags are dropped because they have no equivalent in the generated code.',
  },
  'cookie-parser': {
    fields: [{ kind: 'textarea', name: 'cookie', label: 'Cookie header', placeholder: 'Set-Cookie: sid=abc123; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600' }],
    output: 'keyvalue',
    note: 'Accepts either direction: a Set-Cookie response header (one cookie plus its attributes) or a Cookie request header (many name=value pairs) — detected automatically. Rows starting with ⚠ are missing or contradictory security flags. Nothing is stored.',
  },
  'cache-control': {
    fields: [{ kind: 'text', name: 'value', label: 'Cache-Control', placeholder: 'public, max-age=3600, stale-while-revalidate=59', default: 'public, max-age=3600, stale-while-revalidate=59', wide: true, copyPaste: true }],
    output: 'keyvalue',
    note: 'Explains what each directive tells browsers and shared caches (CDNs, proxies) to do, and flags directives that contradict each other.',
  },

  // Development
  // regex-tester and cron-generator have bespoke components (see components.ts)
  // rather than a declarative spec.
  'random-port': { fields: [{ kind: 'number', name: 'min', label: 'Min', default: 1024 }, { kind: 'number', name: 'max', label: 'Max', default: 65535 }], output: 'text', manual: true, actionLabel: 'Pick port' },
  // Same as http-status: a reference list should show everything until filtered.
  'git-cheatsheet': { fields: [{ kind: 'text', name: 'query', label: 'Search', placeholder: 'rebase', default: '' }], output: 'list' },
  'email-normalizer': { fields: [{ kind: 'text', name: 'email', label: 'Email' }], output: 'text' },
  'case-converter': { fields: [{ kind: 'text', name: 'text', label: 'Text' }], output: 'keyvalue' },
  'chmod-calculator': {
    fields: [{ kind: 'text', name: 'mode', label: 'Mode', placeholder: '755 or rwxr-xr-x', default: '644', wide: true, copyPaste: true }],
    output: 'keyvalue',
    visual: 'chmod',
    note: 'Works in both directions — type an octal mode or a symbolic one. A 4-digit octal sets the special bits, which symbolic form shows in the execute slot: s/t mean the bit is set with execute on, S/T with execute off.',
  },

  // Data Formats
  'json-yaml': { fields: [{ kind: 'textarea', name: 'text', label: 'Input' }, { kind: 'select', name: 'direction', label: 'Direction', options: ['JSON → YAML', 'YAML → JSON'], default: 'JSON → YAML' }], output: 'code' },
  'json-csv': { fields: [{ kind: 'textarea', name: 'text', label: 'Input' }, { kind: 'select', name: 'direction', label: 'Direction', options: ['JSON → CSV', 'CSV → JSON'], default: 'JSON → CSV' }], output: 'code' },
  'json-lines': { fields: [{ kind: 'textarea', name: 'text', label: 'Input' }, { kind: 'select', name: 'direction', label: 'Direction', options: ['JSON → JSON Lines', 'JSON Lines → JSON'], default: 'JSON → JSON Lines' }], output: 'code' },
  'xml-json': {
    fields: [
      { kind: 'textarea', name: 'text', label: 'Input', placeholder: '<user id="1">\n  <name>Ada</name>\n</user>' },
      { kind: 'select', name: 'direction', label: 'Direction', options: ['XML → JSON', 'JSON → XML'], default: 'XML → JSON' },
    ],
    output: 'code',
    language: 'xml',
    note: 'Attributes become "@name" keys and mixed-in text a "#text" key, so the conversion round-trips. Repeated child elements collapse into an array. Namespace prefixes are kept verbatim rather than resolved, and DTD entity declarations are not expanded.',
  },
  'env-json': {
    fields: [
      { kind: 'textarea', name: 'text', label: 'Input', placeholder: '# comment\nDATABASE_URL="postgres://localhost/app"\nPORT=5432' },
      { kind: 'select', name: 'direction', label: 'Direction', options: ['.env → JSON', 'JSON → .env'], default: '.env → JSON' },
    ],
    output: 'code',
    language: 'ini',
    note: 'Comments and blank lines are dropped, an `export ` prefix is ignored, and only double-quoted values interpret \\n-style escapes — the same rules a shell applies. Nested JSON objects have no dotenv equivalent, so they are written back as JSON text.',
  },

  // Date & Time
  // Every date field takes the same vocabulary (see parseDate in date-time.ts),
  // so the presets are the same shortcuts everywhere.
  timestamp: {
    fields: [{ kind: 'text', name: 'value', label: 'Date or timestamp', placeholder: 'now, 1710000000, or ISO date', default: 'now', wide: true, copyPaste: true, datePicker: true, presets: ['now', 'today', 'tomorrow', 'yesterday', '+1h', '+7d'] }],
    output: 'keyvalue',
    // Keeps the "Relative" row and a "now" input honest instead of freezing at page load.
    liveTick: true,
    note: 'Accepts “now”, “today”/“tomorrow”/“yesterday”, an offset from now such as “+2d” or “-90m”, Unix seconds or milliseconds, an ISO date, or the calendar picker. Numbers below one trillion read as seconds. Local rows use this device’s time zone; include Z or an offset in an ISO date to avoid ambiguity.',
  },
  'timezone-converter': {
    fields: [
      { kind: 'text', name: 'value', label: 'Date or timestamp', placeholder: 'now or ISO date', default: 'now', wide: true, datePicker: true, presets: ['now', 'today', '+1d'] },
      {
        kind: 'timezones',
        name: 'zones',
        label: 'Time zones',
        default: 'UTC, America/New_York, Europe/London, Asia/Tokyo',
        presets: [
          { label: 'US ⇄ Europe ⇄ Asia', value: 'UTC, America/New_York, Europe/London, Asia/Tokyo' },
          { label: 'Gulf ⇄ India ⇄ Singapore', value: 'UTC, Asia/Dubai, Asia/Kolkata, Asia/Singapore' },
          { label: 'US coasts ⇄ Europe', value: 'America/Los_Angeles, America/New_York, Europe/Berlin' },
        ],
      },
    ],
    output: 'keyvalue',
    liveTick: true,
    note: 'Search and pick as many IANA zones as you like — handy for finding a meeting slot. Your own zone is always shown first. Offsets account for each zone’s daylight saving at that instant, so they shift across the year.',
  },
  'duration-calculator': {
    fields: [
      { kind: 'text', name: 'start', label: 'Start', placeholder: '2026-01-01T09:00:00Z', wide: true, datePicker: true, presets: ['now', 'today', 'yesterday'] },
      { kind: 'text', name: 'end', label: 'End', placeholder: '2026-01-02T10:30:00Z', wide: true, newRow: true, datePicker: true, presets: ['now', 'today', 'tomorrow', '+7d'] },
    ],
    output: 'keyvalue',
    visual: 'timeline',
    note: 'Duration is exact clock time; Calendar counts the way a person does (“1mo 3d”) and drops the leftover hours. Business days are whole Mon–Fri days — public holidays are jurisdiction-specific and not modelled.',
  },
  'date-calculator': {
    fields: [
      { kind: 'text', name: 'date', label: 'From', placeholder: 'now or ISO date', default: 'now', wide: true, datePicker: true, presets: ['now', 'today', 'tomorrow'] },
      { kind: 'select', name: 'direction', label: '', options: ['add', 'subtract'], default: 'add', newRow: true },
      { kind: 'number', name: 'amount', label: 'Amount', default: 7, min: 0, max: 100000 },
      { kind: 'select', name: 'unit', label: 'Unit', options: ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'business days'], default: 'days' },
    ],
    output: 'keyvalue',
    note: 'Month and year steps clamp to the last valid day, so one month after 31 Jan is 28 Feb rather than spilling into March. Day and larger steps keep the wall-clock time across a daylight-saving change. Business days skip weekends only.',
  },
  'iso-duration': {
    fields: [{ kind: 'text', name: 'value', label: 'Duration', placeholder: 'PT1H30M, 90m, or 5400', default: 'PT1H30M', wide: true, copyPaste: true, presets: ['PT30S', 'PT15M', 'PT1H30M', 'P1D', 'P1W', '90m'] }],
    output: 'keyvalue',
    note: 'Reads ISO 8601 (PT1H30M), shorthand (“1h 30m”), or a bare number of seconds. Years and months have no fixed length, so on input they are approximated as 365 and 30 days, and output never emits them.',
  },

  // Networking
  'cidr-calculator': {
    fields: [{ kind: 'text', name: 'cidr', label: 'IPv4 network', placeholder: '192.168.1.10/24', default: '192.168.1.10/24', wide: true, copyPaste: true, presets: ['10.0.0.0/8', '172.16.0.0/12', '192.168.1.10/24', '100.64.0.0/10', '10.0.0.4/30'] }],
    output: 'keyvalue',
    visual: 'bits',
    note: 'Also accepts a dotted netmask (10.0.0.1 255.255.255.0) or a bare address, which reads as /32. Scope tells you whether the address is routable on the internet — link-local usually means DHCP failed, and CGNAT means you are behind the ISP’s NAT as well as your own.',
  },
  'ip-converter': {
    fields: [{ kind: 'text', name: 'value', label: 'IPv4, IPv6, integer, or hex', placeholder: '192.168.1.1 or 2001:db8::1', default: '192.168.1.1', wide: true, copyPaste: true, presets: ['192.168.1.1', '2001:db8::1', 'fe80::1', '::ffff:192.0.2.1', '3232235777'] }],
    output: 'keyvalue',
    visual: 'bits',
    note: 'IPv6 input is detected by the colon and gets its own rows — expanded and RFC 5952 compressed forms, scope, and the ip6.arpa name. The bit ruler covers IPv4 only.',
  },
  'subnet-splitter': {
    fields: [
      { kind: 'text', name: 'cidr', label: 'Network to split', placeholder: '10.0.0.0/24', default: '10.0.0.0/24', wide: true, copyPaste: true, presets: ['10.0.0.0/16', '10.0.0.0/24', '192.168.0.0/22'] },
      { kind: 'number', name: 'newPrefix', label: 'Into /', default: 26, min: 0, max: 32, newRow: true },
    ],
    output: 'keyvalue',
    visual: 'subnets',
    note: 'Every subnet is the same size — the equal-split case that covers most VPC and VLAN planning. Usable hosts exclude the network and broadcast address, except on /31 and /32. The listing stops at 1024 subnets.',
  },
  'ip-range-cidr': {
    fields: [{ kind: 'text', name: 'value', label: 'Range or CIDR', placeholder: '192.168.1.5 - 192.168.1.100', default: '192.168.1.5 - 192.168.1.100', wide: true, copyPaste: true, presets: ['192.168.1.5 - 192.168.1.100', '10.0.0.0/22', '203.0.113.0 - 203.0.113.255'] }],
    output: 'keyvalue',
    visual: 'subnets',
    note: 'Both directions from one field: a dash means a range to summarise into blocks, anything else is a block to expand. An arbitrary range rarely maps to one CIDR — the block list is the shortest set that covers it exactly, with no addresses to spare.',
  },
  'cidr-matcher': {
    fields: [
      { kind: 'textarea', name: 'addresses', label: 'Addresses', placeholder: '10.0.5.20\n192.168.1.7\n8.8.8.8' },
      { kind: 'textarea', name: 'cidrs', label: 'CIDR blocks', placeholder: '10.0.0.0/8\n192.168.1.0/24\n10.0.5.0/24' },
    ],
    output: 'keyvalue',
    note: 'Answers the firewall/ACL question directly: does this address fall in this block? When several blocks match, the longest prefix is shown first — the one a routing table would pick. Overlapping blocks are flagged at the bottom, since they are the usual reason a rule fires in the wrong order.',
  },
  'mac-generator': {
    fields: [
      { kind: 'number', name: 'count', label: 'How many', default: 5, min: 1, max: 100 },
      { kind: 'select', name: 'separator', label: 'Format', options: [':', '-', 'cisco', 'none'], default: ':' },
      { kind: 'checkbox', name: 'uppercase', label: 'Uppercase', default: true },
      { kind: 'text', name: 'prefix', label: 'OUI prefix', placeholder: '00:1A:2B (optional)', default: '' },
    ],
    output: 'list',
    manual: true,
    actionLabel: 'Generate',
    note: 'With no prefix, addresses are marked locally administered and unicast, so they can never collide with a real vendor assignment. Give an OUI prefix to generate under a specific vendor — useful for testing an allowlist or DHCP reservation.',
  },
  'mac-inspector': {
    fields: [{ kind: 'text', name: 'mac', label: 'MAC address', placeholder: '00:1A:2B:3C:4D:5E', default: '00:1A:2B:3C:4D:5E', wide: true, copyPaste: true, presets: ['00:1A:2B:3C:4D:5E', 'FF:FF:FF:FF:FF:FF', '02:42:AC:11:00:02'] }],
    output: 'keyvalue',
    note: 'Any separator is accepted. “Locally administered” means the address was set by software rather than burned in by a vendor — modern phones and laptops randomise per network, so a randomised MAC is expected, not suspicious. Vendor names need an OUI database and are not looked up here.',
  },
  'port-reference': {
    // Same as http-status: a reference list should show everything until filtered.
    fields: [{ kind: 'text', name: 'query', label: 'Search', placeholder: '5432, postgres, or redis', default: '', wide: true }],
    output: 'keyvalue',
    note: 'Type a bare port number to also get its IANA range — which is the answer when a bind fails with “permission denied” below 1024, or when a connection picks an unexpected ephemeral source port.',
  },

  // Images
  'qr-code': { fields: [{ kind: 'textarea', name: 'text', label: 'Text or URL' }], output: 'svg' },
  'wifi-qr': { fields: [{ kind: 'text', name: 'ssid', label: 'Network (SSID)' }, { kind: 'text', name: 'password', label: 'Password' }, { kind: 'select', name: 'encryption', label: 'Encryption', options: ['WPA', 'WEP', 'nopass'] }, { kind: 'checkbox', name: 'hidden', label: 'Hidden network' }], output: 'svg' },
  'svg-placeholder': { fields: [{ kind: 'number', name: 'width', label: 'Width', default: 300 }, { kind: 'number', name: 'height', label: 'Height', default: 150 }, { kind: 'text', name: 'text', label: 'Label' }, { kind: 'text', name: 'bg', label: 'Background', default: '#cccccc' }, { kind: 'text', name: 'fg', label: 'Foreground', default: '#333333' }], output: 'svg' },
  'color-converter': {
    fields: [{ kind: 'text', name: 'color', label: 'Color', placeholder: '#3b82f6, rgb(59 130 246), hsl(217 91% 60%), tomato', default: '#3b82f6', wide: true, copyPaste: true, colorPicker: true }],
    output: 'keyvalue',
    visual: 'swatch',
    note: 'Takes hex (3/4/6/8 digits), rgb()/rgba(), hsl()/hsla(), or a CSS color name in any spacing. Contrast ratios follow WCAG 2: 4.5:1 passes AA for body text and 7:1 passes AAA. Alpha is carried through but ignored when computing contrast.',
  },
  'color-palette': {
    fields: [
      { kind: 'text', name: 'color', label: 'Base color', placeholder: '#3b82f6, tomato, hsl(217 91% 60%)', default: '#3b82f6', wide: true, copyPaste: true, colorPicker: true },
      { kind: 'select', name: 'harmony', label: 'Harmony', options: ['scale', 'complementary', 'split-complementary', 'analogous', 'triadic', 'tetradic', 'monochromatic', 'shades', 'tints'], default: 'scale' },
    ],
    output: 'keyvalue',
    note: 'Scale is a Tailwind-style 50–950 ramp; the harmonies rotate around the colour wheel; tints and shades step toward white and black. Every row is a copyable hex value with a preview chip — click one to copy it.',
  },
  'contrast-checker': {
    fields: [
      { kind: 'text', name: 'foreground', label: 'Text', placeholder: '#6b7280', default: '#6b7280', wide: true, copyPaste: true, colorPicker: true },
      { kind: 'text', name: 'background', label: 'Background', placeholder: '#ffffff', default: '#ffffff', wide: true, newRow: true, copyPaste: true, colorPicker: true },
    ],
    output: 'keyvalue',
    note: 'WCAG 2 thresholds: 4.5:1 passes AA for body text, 7:1 AAA, and 3:1 is the floor for large text and UI components. When the pair fails AA, the smallest lightness tweak to the text colour that fixes it is suggested.',
  },
  'svg-optimizer': {
    fields: [{ kind: 'textarea', name: 'svg', label: 'SVG', placeholder: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">…</svg>' }],
    output: 'keyvalue',
    note: 'Conservative minify: strips comments, the XML prolog, editor namespaces (Inkscape/Sketch/Illustrator) and redundant whitespace, then exports the result as a data URI, CSS background, and JSX. Path-level rewriting (number rounding, shape merging) is left to a full optimizer like SVGO.',
  },

  // Math
  percentage: {
    fields: [
      { kind: 'number', name: 'x', label: 'X (first number)', default: 25 },
      { kind: 'number', name: 'y', label: 'Y (second number)', default: 200 },
    ],
    output: 'keyvalue',
    note: 'Every row is computed from the same two numbers, so the one you want is always on screen — read the row label, not the order you typed them in. Percent change divides by X (the original), which is why 100 → 150 is +50% and 150 → 100 is −33.33%.',
  },
  eta: {
    fields: [
      { kind: 'number', name: 'total', label: 'Total work', default: 100, min: 0 },
      { kind: 'number', name: 'done', label: 'Done so far', default: 25, min: 0 },
      { kind: 'number', name: 'elapsed', label: 'Time spent', default: 10, min: 0 },
      { kind: 'select', name: 'elapsedUnit', label: '', options: ['seconds', 'minutes', 'hours', 'days'], default: 'minutes' },
    ],
    output: 'keyvalue',
    visual: 'timeline',
    // Keeps the bar's "now" marker and the finish time honest while a job runs.
    liveTick: true,
    note: 'Assumes the rate stays constant — fine for a steady import or upload, optimistic for work that slows down as it goes (indexing, backfills that grow). Re-enter the numbers as it progresses and the estimate tightens.',
  },
  'byte-converter': {
    fields: [
      { kind: 'number', name: 'value', label: 'Value', default: 1, min: 0 },
      { kind: 'select', name: 'unit', label: 'Unit', options: ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], default: 'MB' },
      { kind: 'select', name: 'base', label: 'Base', options: ['SI (1000)', 'IEC (1024)'], default: 'SI (1000)' },
    ],
    output: 'keyvalue',
    note: 'SI (1000) is what drive manufacturers and networks mean by GB; IEC (1024) is what RAM and most operating systems count in, spelled GiB. The two Human rows always show both — the gap between them is why a "500 GB" disk reports as 465 GB.',
  },
  stats: {
    fields: [{ kind: 'textarea', name: 'numbers', label: 'Numbers', placeholder: 'Paste values — spaces, commas, or one per line:\n120 135 118 990 122\n131, 127, 1450, 119' }],
    output: 'keyvalue',
    visual: 'histogram',
    note: 'Any text works — numbers are pulled out and everything else ignored, so a pasted column of latencies or a log excerpt both parse. Percentiles are linear-interpolated (the numpy/R-7 default), standard deviation is the sample form (n−1), and Outliers counts values beyond 1.5× the interquartile range.',
  },
  'sla-uptime': {
    fields: [
      { kind: 'number', name: 'uptime', label: 'Availability %', default: 99.9, min: 0, max: 100, step: 0.001 },
      { kind: 'select', name: 'budgetWindow', label: 'Budget window', options: ['24 hours', '7 days', '30 days', '90 days', '365 days'], default: '30 days' },
      { kind: 'number', name: 'downtimeMinutes', label: 'Downtime so far (min)', default: 0, min: 0 },
    ],
    output: 'keyvalue',
    note: 'Months are 30 days and years 365, the convention most SLAs use — a real contract may measure calendar months instead. The budget rows compare downtime you have already burned against what the target allows in the selected window.',
  },
  'base-converter': {
    fields: [
      { kind: 'text', name: 'value', label: 'Number', placeholder: '255, 0xFF, 0b1111_1111, 0o377', default: '255', wide: true, copyPaste: true },
      { kind: 'select', name: 'from', label: 'Input base', options: ['auto', '2', '8', '10', '16', '36'], default: 'auto' },
    ],
    output: 'keyvalue',
    note: 'Auto reads a 0x / 0b / 0o prefix and otherwise assumes decimal. Spaces, commas and underscores are ignored, so pasted masks and grouped literals work as typed. Integers only — above 2^53 JavaScript loses precision and the rows say so.',
  },
  'aspect-ratio': {
    fields: [
      { kind: 'number', name: 'width', label: 'Width', default: 1920, min: 1 },
      { kind: 'number', name: 'height', label: 'Height', default: 1080, min: 1 },
      { kind: 'number', name: 'targetWidth', label: 'Scale to width', default: 0, min: 0, newRow: true },
      { kind: 'number', name: 'targetHeight', label: 'Scale to height', default: 0, min: 0 },
    ],
    output: 'keyvalue',
    visual: 'ratio',
    note: 'Leave a scale field at 0 to skip it. Fill one to get the matching side; fill both and you also get contain (fits entirely inside the box) and cover (fills the box, crops the overflow) — the same two rules CSS object-fit uses.',
  },
  'transfer-time': {
    fields: [
      { kind: 'number', name: 'size', label: 'Size', default: 5, min: 0 },
      { kind: 'select', name: 'sizeUnit', label: '', options: ['KB', 'MB', 'GB', 'TB'], default: 'GB' },
      { kind: 'number', name: 'speed', label: 'Speed', default: 100, min: 0, newRow: true },
      { kind: 'select', name: 'speedUnit', label: '', options: ['Kbps', 'Mbps', 'Gbps', 'KB/s', 'MB/s'], default: 'Mbps' },
      { kind: 'number', name: 'efficiency', label: 'Efficiency %', default: 100, min: 1, max: 100 },
    ],
    output: 'keyvalue',
    note: 'Mind the b: 100 Mbps is 100 million *bits* per second — 12.5 MB/s, an eighth of what the number suggests. Real transfers rarely hit the line rate; set efficiency to 60–80% for a realistic figure over TCP with protocol overhead and shared links.',
  },
}
