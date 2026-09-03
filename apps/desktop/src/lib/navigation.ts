import type { Component } from 'vue'
import {
  LayoutDashboard,
  FolderKanban,
  KanbanSquare,
  Star,
  Clock,
  Braces,
  Binary,
  KeyRound,
  Key,
  Globe,
  Wrench,
  Image,
  Calculator,
  StickyNote,
  Settings,
  FileJson,
  GitCompare,
  FileCode,
  Link,
  Code,
  Fingerprint,
  Hash,
  KeyRound as KeyRoundIcon,
  KeySquare,
  Lock,
  LockKeyhole,
  Shield,
  Link2,
  MonitorSmartphone,
  List,
  Terminal,
  Cookie,
  Regex,
  Clock as ClockIcon,
  Plug,
  GitBranch,
  Mail,
  CaseSensitive,
  QrCode,
  Wifi,
  Percent,
  Timer,
  Database,
  Palette,
  Network,
  Table,
  CalendarClock,
  Type,
  BarChart3,
  Activity,
  Ratio,
  Gauge,
  SwatchBook,
  Contrast,
  FileCode2,
  Blend,
  ImageDown,
  Users,
} from 'lucide-vue-next'
import type { ToolCategory } from '@devdesk/shared'

/** Tool-specific icon (from catalog metadata) keyed by id, so each tool header
 *  shows its own glyph rather than the broad category icon. */
export const TOOL_ICONS: Record<string, Component> = {
  'json-editor': FileJson,
  'json-diff': GitCompare,
  'json-to-ts': FileCode,
  base64: Binary,
  'url-encoder': Link,
  'html-escape': Code,
  'hex-converter': Binary,
  'unicode-inspector': Type,
  'code-escape': Code,
  uuid: Fingerprint,
  ulid: Fingerprint,
  hash: Hash,
  token: KeyRoundIcon,
  'jwt-parser': KeySquare,
  'jwt-signer': KeySquare,
  password: Lock,
  encryption: LockKeyhole,
  'rsa-keypair': Key,
  'url-parser': Globe,
  'basic-auth': Shield,
  slugify: Link2,
  'user-agent': MonitorSmartphone,
  'http-status': List,
  'curl-converter': Terminal,
  'cookie-parser': Cookie,
  'cache-control': Timer,
  'regex-tester': Regex,
  'cron-generator': ClockIcon,
  'random-port': Plug,
  'git-cheatsheet': GitBranch,
  'email-normalizer': Mail,
  'case-converter': CaseSensitive,
  'qr-code': QrCode,
  'wifi-qr': Wifi,
  'svg-placeholder': Image,
  percentage: Percent,
  eta: Timer,
  'byte-converter': Database,
  stats: BarChart3,
  'sla-uptime': Activity,
  'base-converter': Binary,
  'aspect-ratio': Ratio,
  'transfer-time': Gauge,
  'color-converter': Palette,
  'color-palette': SwatchBook,
  'contrast-checker': Contrast,
  'gradient-generator': Blend,
  'svg-optimizer': FileCode2,
  'image-converter': ImageDown,
  'cidr-calculator': Network,
  'ip-converter': Binary,
  'mac-generator': Wifi,
  'json-yaml': Braces,
  'json-csv': Table,
  'json-lines': List,
  timestamp: ClockIcon,
  'timezone-converter': Globe,
  'duration-calculator': Timer,
}

export interface NavItem {
  label: string
  to: string
  icon: Component
}

export interface NavGroup {
  title?: string
  items: NavItem[]
}

/** Icon per tool category, so the sidebar and tool pages stay visually consistent. */
export const CATEGORY_ICONS: Record<ToolCategory, Component> = {
  json: Braces,
  encoding: Binary,
  crypto: KeyRound,
  web: Globe,
  development: Wrench,
  'data-formats': Table,
  'date-time': CalendarClock,
  networking: Network,
  images: Image,
  math: Calculator,
}

/** Static sidebar sections. Tool categories are appended from the registry at render time. */
export const PRIMARY_NAV: NavGroup = {
  items: [
    { label: 'Dashboard', to: '/', icon: LayoutDashboard },
    { label: 'Project home', to: '/workspace', icon: FolderKanban },
    { label: 'Tasks', to: '/board', icon: KanbanSquare },
    { label: 'Notes', to: '/notes', icon: StickyNote },
    { label: 'Favorites', to: '/favorites', icon: Star },
    { label: 'Recent', to: '/recent', icon: Clock },
  ],
}

/** Only rendered for an admin. The API enforces the same rule server-side. */
export const ADMIN_NAV: NavGroup = {
  title: 'Administration',
  items: [{ label: 'Users', to: '/admin/users', icon: Users }],
}

export const FOOTER_NAV: NavGroup = {
  items: [{ label: 'Settings', to: '/settings', icon: Settings }],
}
