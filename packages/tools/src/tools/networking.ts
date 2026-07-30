import { z } from 'zod'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'

const MAX_IPV4 = 0xffffffff

function parseIPv4(value: string): number {
  const parts = value.trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    throw new Error('Enter a valid IPv4 address')
  }
  return parts.reduce((ip, part) => ip * 256 + Number(part), 0)
}

function formatIPv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')
}

const maskFor = (prefix: number) => (prefix === 0 ? 0 : (MAX_IPV4 << (32 - prefix)) >>> 0)

/**
 * Special-use IPv4 blocks, most-specific first — the first hit wins, so
 * 255.255.255.255 is reported as broadcast rather than as reserved 240/4.
 * Knowing an address is CGNAT or link-local is usually the whole answer when
 * something "can't reach the internet".
 */
const IPV4_SCOPES: [string, number, string][] = [
  ['255.255.255.255', 32, 'Limited broadcast'],
  ['0.0.0.0', 8, 'This network (RFC 1122) — "any" when used as a bind address'],
  ['10.0.0.0', 8, 'Private (RFC 1918)'],
  ['100.64.0.0', 10, 'Carrier-grade NAT (RFC 6598) — not routable on the internet'],
  ['127.0.0.0', 8, 'Loopback'],
  ['169.254.0.0', 16, 'Link-local (APIPA) — usually means DHCP failed'],
  ['172.16.0.0', 12, 'Private (RFC 1918)'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'Documentation (TEST-NET-1)'],
  ['192.88.99.0', 24, '6to4 relay anycast (deprecated)'],
  ['192.168.0.0', 16, 'Private (RFC 1918)'],
  ['198.18.0.0', 15, 'Benchmarking (RFC 2544)'],
  ['198.51.100.0', 24, 'Documentation (TEST-NET-2)'],
  ['203.0.113.0', 24, 'Documentation (TEST-NET-3)'],
  ['224.0.0.0', 4, 'Multicast'],
  ['240.0.0.0', 4, 'Reserved for future use'],
]

function classifyIPv4(ip: number): string {
  for (const [base, prefix, label] of IPV4_SCOPES) {
    const mask = maskFor(prefix)
    if (((ip & mask) >>> 0) === ((parseIPv4(base) & mask) >>> 0)) return label
  }
  return 'Public (globally routable)'
}

const reverseIPv4 = (ip: number) =>
  `${[0, 8, 16, 24].map((shift) => (ip >>> shift) & 255).join('.')}.in-addr.arpa`

/** Accepts `10.0.0.1/24`, `10.0.0.1 255.255.255.0`, or a bare address (= /32). */
function parseCidr(text: string): { ip: number; prefix: number } {
  const input = text.trim()
  const [addressPart, maskPart, ...extra] = input.split(/[/\s]+/)
  if (extra.length || !addressPart) throw new Error('Enter a network such as 192.168.1.10/24')
  const ip = parseIPv4(addressPart)
  if (maskPart === undefined) return { ip, prefix: 32 }
  // A bare number is a prefix length; say so plainly when it is out of range,
  // rather than falling through and complaining about a malformed netmask.
  if (/^\d+$/.test(maskPart)) {
    const prefix = Number(maskPart)
    if (prefix > 32) throw new Error('An IPv4 CIDR prefix runs from /0 to /32')
    return { ip, prefix }
  }
  // Dotted netmask: valid only if its bits are one contiguous run of 1s.
  const mask = parseIPv4(maskPart)
  const prefix = 32 - Math.log2((~mask >>> 0) + 1)
  if (!Number.isInteger(prefix)) throw new Error(`${maskPart} is not a contiguous netmask`)
  return { ip, prefix }
}

export const cidrCalculator: ToolPlugin = {
  metadata: metaFor('cidr-calculator'),
  schema: z.object({ cidr: z.string() }),
  run: (input) => {
    const { cidr } = z.object({ cidr: z.string() }).parse(input)
    const { ip, prefix } = parseCidr(cidr)

    const mask = maskFor(prefix)
    const network = (ip & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    const total = 2 ** (32 - prefix)
    const first = prefix >= 31 ? network : network + 1
    const last = prefix >= 31 ? broadcast : broadcast - 1

    return {
      Address: formatIPv4(ip),
      Network: `${formatIPv4(network)}/${prefix}`,
      Netmask: formatIPv4(mask),
      Wildcard: formatIPv4(~mask >>> 0),
      Broadcast: formatIPv4(broadcast),
      'Usable range': `${formatIPv4(first)} – ${formatIPv4(last)}`,
      'Total addresses': total.toLocaleString('en-US'),
      'Usable hosts': (prefix >= 31 ? total : total - 2).toLocaleString('en-US'),
      Scope: classifyIPv4(ip),
      'Reverse DNS': reverseIPv4(ip),
      'IPv6-mapped': `::ffff:${formatIPv4(ip)}`,
      'Integer range': `${network} – ${broadcast}`,
    }
  },
}

// --- IPv6 ---

function parseIPv6(value: string): bigint {
  let text = value.trim().replace(/^\[/, '').replace(/\]$/, '').split('%')[0]!
  // A trailing dotted-quad (::ffff:192.0.2.1) is shorthand for two hextets.
  const embedded = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (embedded) {
    const v4 = parseIPv4(embedded[1]!)
    text = `${text.slice(0, embedded.index)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) throw new Error('An IPv6 address may contain :: only once')
  const head = halves[0] ? halves[0]!.split(':') : []
  const tail = halves[1] ? halves[1]!.split(':') : []
  const groups =
    halves.length === 1
      ? head
      : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
  if (groups.length !== 8 || groups.some((g) => !/^[\da-f]{1,4}$/i.test(g))) {
    throw new Error('Enter a valid IPv6 address')
  }
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(Number.parseInt(g, 16)), 0n)
}

const hextets = (ip: bigint) =>
  Array.from({ length: 8 }, (_, i) => Number((ip >> BigInt(112 - i * 16)) & 0xffffn))

const expandIPv6 = (ip: bigint) =>
  hextets(ip)
    .map((h) => h.toString(16).padStart(4, '0'))
    .join(':')

/** RFC 5952 canonical form: lowercase, no leading zeros, longest zero run as ::. */
function compressIPv6(ip: bigint): string {
  const groups = hextets(ip).map((h) => h.toString(16))
  let best = { start: -1, length: 0 }
  for (let i = 0; i < 8; i++) {
    if (groups[i] !== '0') continue
    let end = i
    while (end < 8 && groups[end] === '0') end++
    if (end - i > best.length) best = { start: i, length: end - i }
    i = end - 1
  }
  if (best.length < 2) return groups.join(':')
  return `${groups.slice(0, best.start).join(':')}::${groups.slice(best.start + best.length).join(':')}`
}

const IPV6_SCOPES: [string, number, string][] = [
  ['::', 128, 'Unspecified — "any" when used as a bind address'],
  ['::1', 128, 'Loopback'],
  ['::ffff:0:0', 96, 'IPv4-mapped'],
  ['64:ff9b::', 96, 'NAT64 / IPv4-IPv6 translation'],
  ['100::', 64, 'Discard-only (blackhole)'],
  ['2001:db8::', 32, 'Documentation'],
  ['2001::', 32, 'Teredo tunnelling'],
  ['2002::', 16, '6to4'],
  ['fc00::', 7, 'Unique local (ULA) — the IPv6 answer to RFC 1918'],
  ['fe80::', 10, 'Link-local'],
  ['ff00::', 8, 'Multicast'],
  ['2000::', 3, 'Global unicast (globally routable)'],
]

function classifyIPv6(ip: bigint): string {
  for (const [base, prefix, label] of IPV6_SCOPES) {
    const shift = BigInt(128 - prefix)
    if (ip >> shift === parseIPv6(base) >> shift) return label
  }
  return 'Reserved / unassigned'
}

const reverseIPv6 = (ip: bigint) =>
  `${expandIPv6(ip).replace(/:/g, '').split('').reverse().join('.')}.ip6.arpa`

export const ipConverter: ToolPlugin = {
  metadata: metaFor('ip-converter'),
  schema: z.object({ value: z.string() }),
  run: (input) => {
    const { value } = z.object({ value: z.string() }).parse(input)
    const text = value.trim()

    // IPv6 has its own set of representations; sharing one table would leave
    // half the rows blank whichever family you typed.
    if (text.includes(':')) {
      const ip = parseIPv6(text)
      const low32 = Number(ip & 0xffffffffn)
      const mapped = ip >> 32n === 0xffffn
      // RFC 5952 §5: the last 32 bits of an IPv4-mapped address are written as a
      // dotted quad. "::ffff:192.0.2.1" is both canonical and what people type;
      // "::ffff:c000:201" is the same address nobody recognises.
      const compressed = mapped ? `::ffff:${formatIPv4(low32)}` : compressIPv6(ip)
      return {
        Compressed: compressed,
        Expanded: expandIPv6(ip),
        Scope: classifyIPv6(ip),
        Integer: ip.toString(),
        Hexadecimal: `0x${ip.toString(16).padStart(32, '0').toUpperCase()}`,
        'Reverse DNS': reverseIPv6(ip),
        ...(mapped ? { 'Embedded IPv4': formatIPv4(low32) } : {}),
        'URL form': `[${compressed}]`,
      }
    }

    let ip: number
    if (text.includes('.')) ip = parseIPv4(text)
    else if (/^0x[\da-f]{1,8}$/i.test(text)) ip = Number.parseInt(text.slice(2), 16)
    else if (/^\d+$/.test(text) && Number(text) <= MAX_IPV4) ip = Number(text)
    else throw new Error('Enter an IPv4 or IPv6 address, integer, or hexadecimal value')

    return {
      IPv4: formatIPv4(ip),
      Integer: String(ip),
      Hexadecimal: `0x${ip.toString(16).padStart(8, '0').toUpperCase()}`,
      Binary: ip.toString(2).padStart(32, '0').match(/.{8}/g)!.join('.'),
      Octal: [24, 16, 8, 0].map((s) => ((ip >>> s) & 255).toString(8)).join('.'),
      Scope: classifyIPv4(ip),
      'Reverse DNS': reverseIPv4(ip),
      'IPv6-mapped': `::ffff:${formatIPv4(ip)}`,
    }
  },
}

// --- Subnetting ---

export const subnetSplitter: ToolPlugin = {
  metadata: metaFor('subnet-splitter'),
  schema: z.object({ cidr: z.string(), newPrefix: z.number().int().min(0).max(32) }),
  run: (input) => {
    const { cidr, newPrefix } = z
      .object({ cidr: z.string(), newPrefix: z.number().int().min(0).max(32).default(26) })
      .parse(input)
    const { ip, prefix } = parseCidr(cidr)
    if (newPrefix < prefix) {
      throw new Error(`/${newPrefix} is larger than the /${prefix} you are splitting — pick /${prefix} or longer`)
    }
    const count = 2 ** (newPrefix - prefix)
    // 1024 rows is already past the point of reading them; beyond that the table
    // is a hang, not an answer.
    if (count > 1024) {
      throw new Error(`Splitting /${prefix} into /${newPrefix} makes ${count.toLocaleString('en-US')} subnets — pick a shorter new prefix`)
    }

    const base = (ip & maskFor(prefix)) >>> 0
    const size = 2 ** (32 - newPrefix)
    const usable = newPrefix >= 31 ? size : size - 2
    const rows: Record<string, string> = {
      Summary: `${count.toLocaleString('en-US')} × /${newPrefix} — ${usable.toLocaleString('en-US')} usable hosts each`,
    }
    for (let i = 0; i < count; i++) {
      const network = base + i * size
      const broadcast = network + size - 1
      const first = newPrefix >= 31 ? network : network + 1
      const last = newPrefix >= 31 ? broadcast : broadcast - 1
      rows[`Subnet ${i + 1}`] = `${formatIPv4(network)}/${newPrefix}  ·  ${formatIPv4(first)} – ${formatIPv4(last)}`
    }
    return rows
  },
}

/**
 * Smallest set of CIDR blocks covering start..end. The greedy standard
 * algorithm: at each step take the largest block that both aligns on `start`
 * and fits inside what is left.
 */
function rangeToCidrs(start: number, end: number): string[] {
  const blocks: string[] = []
  let cursor = start
  while (cursor <= end) {
    let prefix = 32
    // Grow the block while it stays aligned on the cursor.
    while (prefix > 0 && ((cursor & maskFor(prefix - 1)) >>> 0) === cursor) prefix--
    // …but never past what remains.
    const fits = 32 - Math.floor(Math.log2(end - cursor + 1))
    blocks.push(`${formatIPv4(cursor)}/${Math.max(prefix, fits)}`)
    cursor += 2 ** (32 - Math.max(prefix, fits))
  }
  return blocks
}

export const ipRangeCidr: ToolPlugin = {
  metadata: metaFor('ip-range-cidr'),
  schema: z.object({ value: z.string() }),
  run: (input) => {
    const { value } = z.object({ value: z.string() }).parse(input)
    const text = value.trim()

    // A dash means a range to convert into blocks; anything else is a block to
    // expand into a range. One field, both directions — you always have one.
    if (text.includes('-')) {
      const [from, to] = text.split('-').map((s) => s.trim())
      const start = parseIPv4(from ?? '')
      const end = parseIPv4(to ?? '')
      if (end < start) throw new Error('The end address is lower than the start address')
      const blocks = rangeToCidrs(start, end)
      const rows: Record<string, string> = {
        Range: `${formatIPv4(start)} – ${formatIPv4(end)}`,
        'Total addresses': (end - start + 1).toLocaleString('en-US'),
        'Blocks needed': String(blocks.length),
      }
      blocks.forEach((block, i) => {
        const size = 2 ** (32 - Number(block.split('/')[1]))
        rows[`Block ${i + 1}`] = `${block}  ·  ${size.toLocaleString('en-US')} address${size === 1 ? '' : 'es'}`
      })
      return rows
    }

    const { ip, prefix } = parseCidr(text)
    const network = (ip & maskFor(prefix)) >>> 0
    const broadcast = (network | (~maskFor(prefix) >>> 0)) >>> 0
    return {
      Block: `${formatIPv4(network)}/${prefix}`,
      Range: `${formatIPv4(network)} – ${formatIPv4(broadcast)}`,
      'Total addresses': (2 ** (32 - prefix)).toLocaleString('en-US'),
      'Integer range': `${network} – ${broadcast}`,
      Scope: classifyIPv4(network),
    }
  },
}

export const cidrMatcher: ToolPlugin = {
  metadata: metaFor('cidr-matcher'),
  schema: z.object({ addresses: z.string(), cidrs: z.string() }),
  run: (input) => {
    const { addresses, cidrs } = z.object({ addresses: z.string(), cidrs: z.string() }).parse(input)
    const lines = (text: string) =>
      text
        .split(/[\n,]/)
        .map((line) => line.trim())
        .filter(Boolean)

    const rules = lines(cidrs).map((text) => {
      const { ip, prefix } = parseCidr(text)
      const network = (ip & maskFor(prefix)) >>> 0
      return { label: `${formatIPv4(network)}/${prefix}`, network, prefix, end: (network | (~maskFor(prefix) >>> 0)) >>> 0 }
    })
    if (!rules.length) throw new Error('Add at least one CIDR block to match against')

    const rows: Record<string, string> = {}
    for (const line of lines(addresses)) {
      const ip = parseIPv4(line)
      // Longest prefix wins, the way a routing table resolves it.
      const hits = rules.filter((r) => ip >= r.network && ip <= r.end).sort((a, b) => b.prefix - a.prefix)
      rows[formatIPv4(ip)] = hits.length
        ? `✓ ${hits[0]!.label}${hits.length > 1 ? ` (also ${hits.slice(1).map((h) => h.label).join(', ')})` : ''}`
        : '✗ no match'
    }
    if (!Object.keys(rows).length) throw new Error('Add at least one address to check')

    // Overlapping rules are the usual reason an ACL "works" in the wrong order.
    const overlaps = rules.flatMap((a, i) =>
      rules
        .slice(i + 1)
        .filter((b) => a.network <= b.end && b.network <= a.end)
        .map((b) => `⚠ ${a.label} overlaps ${b.label}`),
    )
    overlaps.forEach((text, i) => {
      rows[`Overlap ${i + 1}`] = text
    })
    return rows
  },
}

// --- MAC addresses ---

function parseMac(value: string): number[] {
  const hex = value.trim().toLowerCase().replace(/[^\da-f]/g, '')
  if (hex.length !== 12) throw new Error('Enter a 48-bit MAC address, e.g. 00:1A:2B:3C:4D:5E')
  return hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16))
}

const joinMac = (bytes: number[], joiner: string) =>
  bytes.map((b) => b.toString(16).padStart(2, '0')).join(joiner)

/** Cisco/HP style: three dotted groups of four hex digits. */
const ciscoMac = (bytes: number[]) =>
  joinMac(bytes, '').match(/.{4}/g)!.join('.')

export const macGenerator: ToolPlugin = {
  metadata: metaFor('mac-generator'),
  schema: z.object({
    count: z.number().int().min(1).max(100).default(5),
    separator: z.enum([':', '-', 'cisco', 'none']).default(':'),
    uppercase: z.boolean().default(true),
    prefix: z.string().default(''),
  }),
  run: (input) => {
    const { count, separator, uppercase, prefix } = z.object({
      count: z.number().int().min(1).max(100).default(5),
      separator: z.enum([':', '-', 'cisco', 'none']).default(':'),
      uppercase: z.boolean().default(true),
      prefix: z.string().default(''),
    }).parse(input)

    // An optional OUI prefix pins the first bytes — matching a vendor is what
    // makes a generated MAC usable against a real allowlist or DHCP reservation.
    const fixed = prefix.trim() ? prefix.trim().toLowerCase().replace(/[^\da-f]/g, '') : ''
    if (fixed.length > 12 || fixed.length % 2) throw new Error('Prefix must be whole hex bytes, e.g. 00:1A:2B')
    const fixedBytes = fixed ? fixed.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)) : []

    return Array.from({ length: count }, () => {
      const random = crypto.getRandomValues(new Uint8Array(6 - fixedBytes.length))
      const bytes = [...fixedBytes, ...random]
      // No prefix given: mark it locally administered and unicast, so a generated
      // address can never collide with a real vendor assignment.
      if (!fixedBytes.length) bytes[0] = (bytes[0]! | 0x02) & 0xfe
      const mac = separator === 'cisco' ? ciscoMac(bytes) : joinMac(bytes, separator === 'none' ? '' : separator)
      return uppercase ? mac.toUpperCase() : mac
    })
  },
}

export const macInspector: ToolPlugin = {
  metadata: metaFor('mac-inspector'),
  schema: z.object({ mac: z.string() }),
  run: (input) => {
    const { mac } = z.object({ mac: z.string() }).parse(input)
    const bytes = parseMac(mac)
    const first = bytes[0]!

    // EUI-64 (RFC 4291): insert FFFE mid-address and flip the U/L bit.
    const eui64 = [bytes[0]! ^ 0x02, bytes[1]!, bytes[2]!, 0xff, 0xfe, bytes[3]!, bytes[4]!, bytes[5]!]
    const interfaceId = eui64
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .match(/.{4}/g)!
      .join(':')

    return {
      Colon: joinMac(bytes, ':').toUpperCase(),
      Hyphen: joinMac(bytes, '-').toUpperCase(),
      Cisco: ciscoMac(bytes),
      Bare: joinMac(bytes, '').toUpperCase(),
      OUI: joinMac(bytes.slice(0, 3), ':').toUpperCase(),
      'Device ID': joinMac(bytes.slice(3), ':').toUpperCase(),
      Administration: first & 0x02 ? 'Locally administered (randomised or hand-set)' : 'Universally administered (vendor-assigned OUI)',
      Transmission: first & 0x01 ? 'Multicast / broadcast' : 'Unicast',
      ...(bytes.every((b) => b === 0xff) ? { Note: 'Broadcast address — reaches every host on the segment' } : {}),
      'EUI-64 interface ID': interfaceId,
      'IPv6 link-local': compressIPv6(parseIPv6(`fe80::${interfaceId}`)),
    }
  },
}

// --- Port reference ---

/** port, protocol, service, what you actually care about when it shows up. */
const PORTS: [number, string, string, string][] = [
  [20, 'TCP', 'ftp-data', 'FTP data channel'],
  [21, 'TCP', 'ftp', 'FTP control channel — plaintext'],
  [22, 'TCP', 'ssh', 'SSH, SCP, SFTP, and git over ssh'],
  [23, 'TCP', 'telnet', 'Telnet — plaintext, effectively obsolete'],
  [25, 'TCP', 'smtp', 'Mail transfer between servers; often blocked by ISPs'],
  [53, 'TCP/UDP', 'dns', 'DNS — UDP normally, TCP for large answers and zone transfers'],
  [67, 'UDP', 'dhcp', 'DHCP server'],
  [68, 'UDP', 'dhcp', 'DHCP client'],
  [69, 'UDP', 'tftp', 'Trivial FTP — PXE boot'],
  [80, 'TCP', 'http', 'Plain HTTP'],
  [110, 'TCP', 'pop3', 'POP3 mail retrieval'],
  [111, 'TCP/UDP', 'rpcbind', 'ONC RPC portmapper — NFS'],
  [123, 'UDP', 'ntp', 'Network Time Protocol'],
  [135, 'TCP', 'msrpc', 'Microsoft RPC endpoint mapper'],
  [137, 'UDP', 'netbios-ns', 'NetBIOS name service'],
  [139, 'TCP', 'netbios-ssn', 'NetBIOS session — legacy SMB'],
  [143, 'TCP', 'imap', 'IMAP mail retrieval'],
  [161, 'UDP', 'snmp', 'SNMP polling'],
  [162, 'UDP', 'snmptrap', 'SNMP traps'],
  [179, 'TCP', 'bgp', 'BGP routing sessions'],
  [389, 'TCP', 'ldap', 'LDAP directory — plaintext'],
  [443, 'TCP', 'https', 'HTTP over TLS; also QUIC/HTTP-3 over UDP'],
  [445, 'TCP', 'smb', 'SMB file sharing — never expose to the internet'],
  [465, 'TCP', 'smtps', 'SMTP submission over implicit TLS'],
  [500, 'UDP', 'isakmp', 'IPsec IKE key exchange'],
  [514, 'UDP', 'syslog', 'Syslog messages'],
  [587, 'TCP', 'submission', 'SMTP mail submission with STARTTLS — the modern default'],
  [631, 'TCP', 'ipp', 'Internet Printing Protocol / CUPS'],
  [636, 'TCP', 'ldaps', 'LDAP over TLS'],
  [873, 'TCP', 'rsync', 'rsync daemon'],
  [993, 'TCP', 'imaps', 'IMAP over TLS'],
  [995, 'TCP', 'pop3s', 'POP3 over TLS'],
  [1080, 'TCP', 'socks', 'SOCKS proxy'],
  [1194, 'UDP', 'openvpn', 'OpenVPN'],
  [1433, 'TCP', 'mssql', 'Microsoft SQL Server'],
  [1521, 'TCP', 'oracle', 'Oracle database listener'],
  [1723, 'TCP', 'pptp', 'PPTP VPN — cryptographically broken'],
  [1883, 'TCP', 'mqtt', 'MQTT message broker'],
  [2049, 'TCP', 'nfs', 'NFS file sharing'],
  [2375, 'TCP', 'docker', 'Docker daemon, unencrypted — remote root if exposed'],
  [2376, 'TCP', 'docker-tls', 'Docker daemon over TLS'],
  [3000, 'TCP', 'dev', 'Common dev server default (Next.js, Rails, Grafana)'],
  [3306, 'TCP', 'mysql', 'MySQL / MariaDB'],
  [3389, 'TCP', 'rdp', 'Windows Remote Desktop'],
  [4369, 'TCP', 'epmd', 'Erlang port mapper — RabbitMQ clustering'],
  [5000, 'TCP', 'dev', 'Flask default; also macOS AirPlay Receiver'],
  [5060, 'TCP/UDP', 'sip', 'SIP signalling — VoIP'],
  [5173, 'TCP', 'vite', 'Vite dev server default'],
  [5432, 'TCP', 'postgresql', 'PostgreSQL'],
  [5672, 'TCP', 'amqp', 'RabbitMQ / AMQP'],
  [5900, 'TCP', 'vnc', 'VNC remote desktop'],
  [6379, 'TCP', 'redis', 'Redis — unauthenticated by default'],
  [8000, 'TCP', 'dev', 'Django and python -m http.server default'],
  [8080, 'TCP', 'http-alt', 'Alternate HTTP — proxies, Tomcat, dev servers'],
  [8443, 'TCP', 'https-alt', 'Alternate HTTPS'],
  [8883, 'TCP', 'mqtts', 'MQTT over TLS'],
  [9000, 'TCP', 'misc', 'PHP-FPM, SonarQube, MinIO, Portainer'],
  [9090, 'TCP', 'prometheus', 'Prometheus'],
  [9092, 'TCP', 'kafka', 'Apache Kafka broker'],
  [9200, 'TCP', 'elasticsearch', 'Elasticsearch / OpenSearch HTTP API'],
  [11211, 'TCP/UDP', 'memcached', 'Memcached — a classic UDP amplification source'],
  [15672, 'TCP', 'rabbitmq', 'RabbitMQ management UI'],
  [27017, 'TCP', 'mongodb', 'MongoDB'],
]

/** Which IANA band a port falls in — why 8080 needs no root and 80 does. */
function portRange(port: number): string {
  if (port < 1024) return 'System / well-known (0–1023) — binding needs root on Unix'
  if (port < 49152) return 'User / registered (1024–49151)'
  return 'Dynamic / ephemeral (49152–65535) — outbound and passive ports land here'
}

export const portReference: ToolPlugin = {
  metadata: metaFor('port-reference'),
  schema: z.object({ query: z.string().default('') }),
  run: (input) => {
    const { query } = z.object({ query: z.string().default('') }).parse(input)
    const q = query.trim().toLowerCase()

    // An exact port number answers with the band too — "is this why bind failed?"
    // is the other half of "what is this port".
    if (/^\d+$/.test(q)) {
      const port = Number(q)
      if (port > 65535) throw new Error('Ports run from 0 to 65535')
      const hits = PORTS.filter((p) => p[0] === port)
      return {
        Port: String(port),
        Range: portRange(port),
        ...Object.fromEntries(hits.map(([, proto, service, note]) => [`${service} (${proto})`, note])),
        ...(hits.length ? {} : { Assignment: 'No well-known service — free for your own use' }),
      }
    }

    const matches = q ? PORTS.filter(([port, proto, service, note]) =>
      `${port} ${proto} ${service} ${note}`.toLowerCase().includes(q),
    ) : PORTS
    if (!matches.length) return { Result: `Nothing matches “${query.trim()}”` }
    return Object.fromEntries(
      matches.map(([port, proto, service, note]) => [`${port}/${proto}`, `${service} — ${note}`]),
    )
  },
}

export const networkingTools = [
  cidrCalculator,
  ipConverter,
  subnetSplitter,
  ipRangeCidr,
  cidrMatcher,
  macGenerator,
  macInspector,
  portReference,
]
