import type { ToolDefinition, ToolCategory, PrivacyLevel } from '@devdesk/shared'

type Seed = {
  id: string
  name: string
  description: string
  category: ToolCategory
  group?: string // optional sub-group within the category
  path: string // final route segment, e.g. "formatter" -> /tools/json/formatter
  icon: string
  privacy?: PrivacyLevel // default PUBLIC
  keywords?: string[]
  tags?: string[]
  order?: number // curated position within its category (default 0)
  // Tools whose work only exists in the browser (canvas pixels, drag-and-drop
  // files) have no headless plugin to register — their bespoke Vue component *is*
  // the implementation. Marks them live so the page renders the component
  // instead of "Coming soon". See UI_ONLY_TOOLS below.
  uiOnly?: boolean
}

/** Ids whose implementation is a Vue component rather than a headless plugin. */
export const UI_ONLY_TOOLS = new Set<string>()

// Turn a terse seed into a full ToolDefinition with sensible privacy-driven defaults.
// isImplemented is false here; Phase 6 flips it by registering a real plugin.
function def(s: Seed): ToolDefinition {
  const privacyLevel = s.privacy ?? 'PUBLIC'
  if (s.uiOnly) UI_ONLY_TOOLS.add(s.id)
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    group: s.group,
    route: `/tools/${s.category}/${s.path}`,
    icon: s.icon,
    tags: s.tags ?? [],
    keywords: s.keywords ?? [],
    privacyLevel,
    supportsHistory: privacyLevel !== 'NEVER_PERSIST',
    supportsFavorites: true,
    supportsNotes: true,
    supportsSnippets: true,
    isCore: true,
    isImplemented: false,
    order: s.order ?? 0,
  }
}

/** The initial core toolbox (requirements → "Initial Core Tools"). */
export const CORE_TOOLS: ToolDefinition[] = [
  // JSON
  def({ id: 'json-editor', name: 'JSON Editor', description: 'Edit, format, and validate JSON with a tree/text editor.', category: 'json', path: 'editor', icon: 'file-json', keywords: ['edit', 'tree', 'validate', 'format'] }),
  def({ id: 'json-diff', name: 'JSON Diff', description: 'Compare two JSON documents.', category: 'json', path: 'diff', icon: 'git-compare', keywords: ['compare', 'difference'] }),
  def({ id: 'json-to-ts', name: 'JSON → TypeScript', description: 'Generate TypeScript interfaces from JSON.', category: 'json', path: 'typescript', icon: 'file-code', keywords: ['interface', 'types', 'generate'] }),

  // Encoding
  def({ id: 'base64', name: 'Base64', description: 'Encode and decode Base64.', category: 'encoding', path: 'base64', icon: 'binary', keywords: ['encode', 'decode'] }),
  def({ id: 'url-encoder', name: 'URL Encoder', description: 'Encode and decode URL components.', category: 'encoding', path: 'url', icon: 'link', keywords: ['percent', 'escape'] }),
  def({ id: 'html-escape', name: 'HTML Escape', description: 'Escape and unescape HTML entities.', category: 'encoding', path: 'html', icon: 'code', keywords: ['entities', 'escape'] }),
  def({ id: 'hex-converter', name: 'Hex / Binary Converter', description: 'Convert between text, hex, binary, and decimal bytes.', category: 'encoding', path: 'hex', icon: 'binary', keywords: ['hex', 'binary', 'bytes', 'decimal', 'dump', 'hexadecimal'] }),
  def({ id: 'unicode-inspector', name: 'Unicode Inspector', description: 'Break text into code points with categories and UTF-8 bytes.', category: 'encoding', path: 'unicode', icon: 'type', keywords: ['unicode', 'codepoint', 'utf8', 'emoji', 'character', 'glyph'] }),
  def({ id: 'code-escape', name: 'Escape for Code', description: 'Escape a string for JavaScript, JSON, SQL, shell, and regex contexts.', category: 'encoding', path: 'code-escape', icon: 'code', keywords: ['escape', 'quote', 'injection', 'sql', 'shell', 'regex', 'javascript'] }),

  // Crypto
  def({ id: 'uuid', name: 'UUID Generator', description: 'Generate RFC 4122 UUIDs.', category: 'crypto', group: 'Generators', order: 1, path: 'uuid', icon: 'fingerprint', keywords: ['guid', 'id', 'v4'] }),
  def({ id: 'ulid', name: 'ULID Generator', description: 'Generate sortable ULIDs.', category: 'crypto', group: 'Generators', order: 2, path: 'ulid', icon: 'fingerprint', keywords: ['id', 'sortable'] }),
  def({ id: 'token', name: 'Token Generator', description: 'Generate secure random tokens.', category: 'crypto', group: 'Generators', order: 3, path: 'token', icon: 'key-round', privacy: 'LOCAL_ONLY', keywords: ['random', 'secret', 'apikey'] }),
  def({ id: 'password', name: 'Password Generator', description: 'Generate strong passwords.', category: 'crypto', group: 'Generators', order: 4, path: 'password', icon: 'lock', privacy: 'LOCAL_ONLY', keywords: ['secret', 'random', 'passphrase'] }),
  def({ id: 'password-strength', name: 'Password Strength Analyser', description: 'Estimate password entropy and brute-force crack time.', category: 'crypto', group: 'Generators', order: 4.5, path: 'password-strength', icon: 'shield-check', privacy: 'NEVER_PERSIST', keywords: ['entropy', 'strength', 'crack', 'security'] }),
  def({ id: 'rsa-keypair', name: 'RSA Key Pair Generator', description: 'Generate a random RSA public/private key pair (PEM).', category: 'crypto', group: 'Generators', order: 4.6, path: 'rsa-keypair', icon: 'key', privacy: 'NEVER_PERSIST', keywords: ['rsa', 'pem', 'public key', 'private key', 'keypair', 'openssl'] }),
  def({ id: 'hash', name: 'Hash Generator', description: 'SHA-1/256/384/512 hashes of text.', category: 'crypto', group: 'Hashing', order: 5, path: 'hash', icon: 'hash', privacy: 'LOCAL_ONLY', keywords: ['sha', 'digest', 'checksum'] }),
  def({ id: 'hmac', name: 'HMAC Generator', description: 'Hash-based message authentication codes (HMAC) using a secret key.', category: 'crypto', group: 'Hashing', order: 6, path: 'hmac', icon: 'hash', privacy: 'LOCAL_ONLY', keywords: ['hmac', 'mac', 'sha', 'md5', 'sign', 'authenticate'] }),
  def({ id: 'totp-hotp', name: 'TOTP / HOTP Generator', description: 'Generate time-based and counter-based one-time passcodes (2FA codes) from a shared secret.', category: 'crypto', group: 'Authentication', order: 6.5, path: 'totp-hotp', icon: 'shield-check', privacy: 'NEVER_PERSIST', keywords: ['2fa', 'mfa', 'otp', 'totp', 'hotp', 'authenticator', 'google authenticator'] }),
  def({ id: 'encryption', name: 'Encrypt / Decrypt Text', description: 'Encrypt and decrypt text with AES, TripleDES, Rabbit, or RC4.', category: 'crypto', group: 'Encryption', order: 6, path: 'encryption', icon: 'lock-keyhole', privacy: 'NEVER_PERSIST', keywords: ['aes', 'cipher', 'encrypt', 'decrypt', 'tripledes', 'rc4', 'rabbit'] }),
  def({ id: 'jwt-parser', name: 'JWT Parser', description: 'Decode and inspect JWT tokens.', category: 'crypto', group: 'Encryption', order: 7, path: 'jwt', icon: 'key-square', privacy: 'NEVER_PERSIST', keywords: ['token', 'decode', 'jwt'] }),
  def({ id: 'jwt-signer', name: 'JWT Signer', description: 'Mint and sign a JWT with an HMAC secret (HS256/384/512).', category: 'crypto', group: 'Encryption', order: 7.5, path: 'jwt-signer', icon: 'key-square', privacy: 'NEVER_PERSIST', keywords: ['jwt', 'sign', 'token', 'hs256', 'mint', 'generate'] }),
  def({ id: 'cert-parser', name: 'Certificate Inspector', description: 'Inspect an X.509 / PEM certificate — subject, issuer, validity, SANs, fingerprints.', category: 'crypto', group: 'Encryption', order: 8, path: 'certificate', icon: 'file-badge', privacy: 'NEVER_PERSIST', keywords: ['x509', 'ssl', 'tls', 'pem', 'cert', 'certificate', 'san', 'fingerprint', 'openssl'] }),

  def({ id: 'uuid-inspector', name: 'UUID Inspector', description: 'Decode a UUID — version, variant, and the timestamp v1/v6/v7 embed.', category: 'crypto', group: 'Inspectors', path: 'uuid-inspector', icon: 'search', keywords: ['uuid', 'guid', 'decode', 'version', 'variant', 'timestamp', 'inspect'] }),

  // Web
  def({ id: 'url-parser', name: 'URL Parser', description: 'Break a URL into its parts.', category: 'web', path: 'url-parser', icon: 'globe', keywords: ['query', 'params', 'host'] }),
  def({ id: 'basic-auth', name: 'Basic Auth Generator', description: 'Build a Basic Authorization header.', category: 'web', path: 'basic-auth', icon: 'shield', privacy: 'LOCAL_ONLY', keywords: ['authorization', 'header', 'credentials'] }),
  def({ id: 'slugify', name: 'Slugify', description: 'Turn text into URL-safe slugs.', category: 'web', path: 'slugify', icon: 'link-2', keywords: ['slug', 'url', 'kebab'] }),
  def({ id: 'user-agent', name: 'User-Agent Parser', description: 'Parse a User-Agent string.', category: 'web', path: 'user-agent', icon: 'monitor-smartphone', keywords: ['browser', 'os', 'device'] }),
  def({ id: 'http-status', name: 'HTTP Status Codes', description: 'Look up HTTP status codes.', category: 'web', path: 'http-status', icon: 'list', keywords: ['404', '500', 'reference'] }),
  def({ id: 'curl-converter', name: 'cURL Converter', description: 'Turn a curl command into fetch, axios, or HTTPie.', category: 'web', path: 'curl', icon: 'terminal', privacy: 'LOCAL_ONLY', keywords: ['curl', 'fetch', 'axios', 'httpie', 'request', 'convert', 'devtools'] }),
  def({ id: 'cookie-parser', name: 'Cookie Inspector', description: 'Break down Set-Cookie and Cookie headers and flag missing security flags.', category: 'web', path: 'cookie', icon: 'cookie', privacy: 'NEVER_PERSIST', keywords: ['cookie', 'set-cookie', 'samesite', 'httponly', 'secure', 'session'] }),
  def({ id: 'cache-control', name: 'Cache-Control Explainer', description: 'Explain a Cache-Control header directive by directive.', category: 'web', path: 'cache-control', icon: 'timer', keywords: ['cache', 'max-age', 'cdn', 'no-store', 'header', 'immutable'] }),

  // Development
  def({ id: 'regex-tester', name: 'Regex Tester', description: 'Test regular expressions against text.', category: 'development', path: 'regex', icon: 'regex', keywords: ['pattern', 'match', 'regexp'] }),
  def({ id: 'cron-generator', name: 'Cron Generator', description: 'Build and explain cron expressions.', category: 'development', path: 'cron', icon: 'clock', keywords: ['schedule', 'crontab'] }),
  def({ id: 'random-port', name: 'Random Port', description: 'Pick a random free-range TCP port.', category: 'development', path: 'port', icon: 'plug', keywords: ['tcp', 'localhost'] }),
  def({ id: 'git-cheatsheet', name: 'Git Cheatsheet', description: 'Common git commands reference.', category: 'development', path: 'git-cheatsheet', icon: 'git-branch', keywords: ['git', 'reference', 'commands'] }),
  def({ id: 'email-normalizer', name: 'Email Normalizer', description: 'Normalize email addresses.', category: 'development', path: 'email-normalizer', icon: 'mail', privacy: 'LOCAL_ONLY', keywords: ['gmail', 'dedupe'] }),
  def({ id: 'case-converter', name: 'Case Converter', description: 'Convert between naming cases.', category: 'development', path: 'case-converter', icon: 'case-sensitive', keywords: ['camel', 'snake', 'kebab', 'pascal'] }),
  def({ id: 'chmod-calculator', name: 'Chmod Calculator', description: 'Convert between octal and symbolic Unix file permissions.', category: 'development', path: 'chmod', icon: 'file-lock', keywords: ['chmod', 'permissions', 'octal', 'rwx', 'unix', 'setuid', 'sticky'] }),

  // Data Formats
  def({ id: 'json-yaml', name: 'JSON <-> YAML', description: 'Convert between JSON and YAML.', category: 'data-formats', path: 'json-yaml', icon: 'braces', keywords: ['json', 'yaml', 'convert', 'config'] }),
  def({ id: 'json-csv', name: 'JSON <-> CSV', description: 'Convert arrays of objects between JSON and CSV.', category: 'data-formats', path: 'json-csv', icon: 'table', keywords: ['json', 'csv', 'spreadsheet', 'convert'] }),
  def({ id: 'json-lines', name: 'JSON <-> JSON Lines', description: 'Convert JSON arrays to and from newline-delimited JSON.', category: 'data-formats', path: 'json-lines', icon: 'list', keywords: ['jsonl', 'ndjson', 'logs', 'stream'] }),
  def({ id: 'xml-json', name: 'XML <-> JSON', description: 'Convert between XML and JSON.', category: 'data-formats', path: 'xml-json', icon: 'code', keywords: ['xml', 'json', 'convert', 'soap', 'rss', 'parse'] }),
  def({ id: 'env-json', name: '.env <-> JSON', description: 'Convert between dotenv files and JSON.', category: 'data-formats', path: 'env-json', icon: 'file-cog', privacy: 'LOCAL_ONLY', keywords: ['env', 'dotenv', 'config', 'environment', 'variables'] }),

  // Date & Time
  def({ id: 'timestamp', name: 'Timestamp Converter', description: 'Convert dates and Unix timestamps, with calendar and relative detail.', category: 'date-time', path: 'timestamp', icon: 'clock', keywords: ['epoch', 'unix', 'iso', 'date', 'now', 'week', 'quarter'] }),
  def({ id: 'timezone-converter', name: 'Time Zone Converter', description: 'Compare one instant across several IANA time zones at once.', category: 'date-time', path: 'timezone', icon: 'globe', keywords: ['timezone', 'iana', 'utc', 'date', 'meeting', 'world clock', 'offset'] }),
  def({ id: 'duration-calculator', name: 'Duration Calculator', description: 'Elapsed time between two dates, in calendar and clock units.', category: 'date-time', path: 'duration', icon: 'timer', keywords: ['elapsed', 'difference', 'days', 'hours', 'age', 'business days'] }),
  def({ id: 'date-calculator', name: 'Date Calculator', description: 'Add or subtract time from a date, including business days.', category: 'date-time', path: 'date-calculator', icon: 'calendar-plus', keywords: ['add', 'subtract', 'deadline', 'due date', 'business days', 'working days', 'offset'] }),
  def({ id: 'iso-duration', name: 'ISO 8601 Duration', description: 'Convert between ISO 8601 durations, seconds, and plain English.', category: 'date-time', path: 'iso-duration', icon: 'hourglass', keywords: ['iso8601', 'duration', 'pt1h30m', 'period', 'ttl', 'timeout', 'kubernetes'] }),

  // Networking
  def({ id: 'cidr-calculator', name: 'CIDR Calculator', description: 'Inspect an IPv4 network — range, netmask, scope, and reverse DNS.', category: 'networking', group: 'Addressing', path: 'cidr', icon: 'network', keywords: ['ipv4', 'subnet', 'netmask', 'broadcast', 'range', 'rfc1918', 'private'] }),
  def({ id: 'ip-converter', name: 'IP Address Converter', description: 'Convert IPv4 and IPv6 addresses between every representation.', category: 'networking', group: 'Addressing', path: 'ip-converter', icon: 'binary', keywords: ['ipv4', 'ipv6', 'integer', 'hex', 'binary', 'expand', 'compress', 'arpa'] }),
  def({ id: 'subnet-splitter', name: 'Subnet Splitter', description: 'Carve a network into equal subnets and see how the space is used.', category: 'networking', group: 'Planning', path: 'subnet-splitter', icon: 'split', keywords: ['subnet', 'vlsm', 'split', 'divide', 'vpc', 'plan', 'allocate'] }),
  def({ id: 'ip-range-cidr', name: 'IP Range ⇄ CIDR', description: 'Turn an address range into the fewest CIDR blocks, or back again.', category: 'networking', group: 'Planning', path: 'range-cidr', icon: 'arrow-left-right', keywords: ['range', 'cidr', 'firewall', 'allowlist', 'summarize', 'aggregate'] }),
  def({ id: 'cidr-matcher', name: 'IP / CIDR Matcher', description: 'Check which CIDR blocks an address falls into, and flag overlaps.', category: 'networking', group: 'Planning', path: 'matcher', icon: 'target', keywords: ['contains', 'match', 'firewall', 'acl', 'security group', 'overlap', 'route'] }),
  def({ id: 'mac-generator', name: 'MAC Address Generator', description: 'Generate random MAC addresses, optionally under a fixed OUI.', category: 'networking', group: 'Hardware', path: 'mac-generator', icon: 'wifi', privacy: 'LOCAL_ONLY', keywords: ['mac', 'hardware', 'ethernet', 'random', 'oui'] }),
  def({ id: 'mac-inspector', name: 'MAC Address Inspector', description: 'Decode a MAC — OUI, address bits, EUI-64, and IPv6 link-local.', category: 'networking', group: 'Hardware', path: 'mac-inspector', icon: 'search', keywords: ['mac', 'oui', 'vendor', 'eui64', 'link-local', 'randomised', 'unicast'] }),
  def({ id: 'port-reference', name: 'Port Reference', description: 'Look up what runs on a TCP/UDP port, and which range it sits in.', category: 'networking', group: 'Reference', path: 'ports', icon: 'plug', keywords: ['port', 'tcp', 'udp', 'service', 'well-known', 'ephemeral', 'firewall'] }),

  // Images
  def({ id: 'qr-code', name: 'QR Code Generator', description: 'Generate a QR code from text, with error correction and colors.', category: 'images', group: 'Codes', order: 1, path: 'qr', icon: 'qr-code', keywords: ['qr', 'barcode'] }),
  def({ id: 'wifi-qr', name: 'WiFi QR Generator', description: 'Generate a WiFi join QR code.', category: 'images', group: 'Codes', order: 2, path: 'wifi-qr', icon: 'wifi', privacy: 'LOCAL_ONLY', keywords: ['wifi', 'network', 'qr'] }),
  def({ id: 'svg-placeholder', name: 'SVG Placeholder', description: 'Generate placeholder SVG images at any common size.', category: 'images', group: 'Assets', order: 4, path: 'svg-placeholder', icon: 'image', keywords: ['placeholder', 'svg', 'mock', 'dummy', 'og image'] }),
  def({ id: 'color-converter', name: 'Color Converter', description: 'Convert between hex, RGB, HSL, and HSV, with contrast ratios.', category: 'images', group: 'Color', order: 1, path: 'color-converter', icon: 'palette', keywords: ['hex', 'rgb', 'hsl', 'hsv', 'contrast', 'wcag', 'a11y', 'css'] }),
  def({ id: 'color-palette', name: 'Palette Generator', description: 'Build harmonies, tints, shades, and a Tailwind-style 50–950 scale from one color.', category: 'images', group: 'Color', order: 2, path: 'palette', icon: 'swatch-book', keywords: ['palette', 'harmony', 'complementary', 'analogous', 'triadic', 'scale', 'tints', 'shades', 'theme', 'tailwind'] }),
  def({ id: 'contrast-checker', name: 'Contrast Checker', description: 'Check a text/background pair against WCAG, with a fix when it fails.', category: 'images', group: 'Color', order: 3, path: 'contrast', icon: 'contrast', keywords: ['contrast', 'wcag', 'a11y', 'accessibility', 'aa', 'aaa', 'legibility'] }),
  def({ id: 'gradient-generator', name: 'Gradient Generator', description: 'Design linear, radial, and conic CSS gradients with draggable stops.', category: 'images', group: 'Color', order: 4, path: 'gradient', icon: 'blend', uiOnly: true, keywords: ['gradient', 'css', 'linear', 'radial', 'conic', 'background', 'mesh'] }),
  def({ id: 'image-converter', name: 'Image Converter', description: 'Resize, convert, and compress images on-device, with a size comparison.', category: 'images', group: 'Assets', order: 1, path: 'convert', icon: 'image-down', privacy: 'LOCAL_ONLY', uiOnly: true, keywords: ['resize', 'compress', 'convert', 'webp', 'png', 'jpeg', 'optimize', 'data uri', 'base64', 'exif'] }),
  def({ id: 'svg-optimizer', name: 'SVG Optimizer', description: 'Minify SVG markup and export it as a data URI, CSS background, or JSX.', category: 'images', group: 'Assets', order: 2, path: 'svg-optimizer', icon: 'file-code-2', keywords: ['svg', 'minify', 'optimize', 'data uri', 'css', 'background', 'icon'] }),

  // Math
  def({ id: 'percentage', name: 'Percentage Calculator', description: 'Common percentage calculations.', category: 'math', path: 'percentage', icon: 'percent', keywords: ['percent', 'change'] }),
  def({ id: 'eta', name: 'ETA Calculator', description: 'Estimate completion time.', category: 'math', path: 'eta', icon: 'timer', keywords: ['eta', 'rate', 'time'] }),
  def({ id: 'byte-converter', name: 'Byte Converter', description: 'Convert between byte units, SI and IEC side by side.', category: 'math', path: 'byte-converter', icon: 'database', keywords: ['kb', 'mb', 'gb', 'bytes', 'kib', 'mib', 'gib', 'iec', 'si'] }),
  def({ id: 'stats', name: 'Number Statistics', description: 'Mean, median, percentiles and spread for a pasted list of numbers.', category: 'math', path: 'stats', icon: 'bar-chart-3', keywords: ['statistics', 'percentile', 'p95', 'p99', 'median', 'average', 'mean', 'stddev', 'latency', 'histogram', 'distribution'] }),
  def({ id: 'sla-uptime', name: 'Uptime / SLA Calculator', description: 'Turn an availability target into a downtime budget, and track what is left.', category: 'math', path: 'sla', icon: 'activity', keywords: ['sla', 'slo', 'uptime', 'availability', 'downtime', 'nines', 'error budget', '99.9'] }),
  def({ id: 'base-converter', name: 'Number Base Converter', description: 'Convert a number between binary, octal, decimal, hex, and base 36.', category: 'math', path: 'base', icon: 'binary', keywords: ['binary', 'hex', 'octal', 'decimal', 'radix', 'base36', 'bitwise', 'convert'] }),
  def({ id: 'aspect-ratio', name: 'Aspect Ratio Calculator', description: 'Simplify a width × height ratio and scale it to a new size.', category: 'math', path: 'aspect-ratio', icon: 'ratio', keywords: ['aspect', 'ratio', 'resize', 'scale', '16:9', 'resolution', 'video', 'image', 'thumbnail'] }),
  def({ id: 'transfer-time', name: 'Transfer Time Calculator', description: 'How long a file takes to move at a given bandwidth.', category: 'math', path: 'transfer', icon: 'gauge', keywords: ['bandwidth', 'download', 'upload', 'mbps', 'throughput', 'transfer', 'speed', 'eta'] }),
]

// Curated order: position in CORE_TOOLS drives listing order (lower = first).
// json-editor is declared first, so it leads the JSON category.
CORE_TOOLS.forEach((t, i) => {
  t.order = i
})

const CORE_BY_ID = new Map(CORE_TOOLS.map((t) => [t.id, t]))

/** Metadata for a core tool by id. Throws if unknown — a plugin referenced a bad id. */
export function metaFor(id: string): ToolDefinition {
  const meta = CORE_BY_ID.get(id)
  if (!meta) throw new Error(`No catalog entry for tool: ${id}`)
  return meta
}

/**
 * Not-yet-built tools shown as disabled "Coming Soon" entries. Empty right now —
 * Color Converter shipped as a core tool and Text Diff was dropped. Keep the
 * export: bootstrap registers it, and it's where the next roadmap entry lands.
 */
export const COMING_SOON: ToolDefinition[] = []
