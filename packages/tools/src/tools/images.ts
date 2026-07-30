import { z } from 'zod'
import QRCode from 'qrcode'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'

// QR generation is genuinely hard to get right (error correction, masking) — use the
// library. Output is an SVG string, so it stays DOM-free and portable.
type QrOptions = { errorCorrection?: 'L' | 'M' | 'Q' | 'H'; margin?: number; dark?: string; light?: string }
export async function qrSvg(text: string, opts: QrOptions = {}): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: opts.margin ?? 2,
    errorCorrectionLevel: opts.errorCorrection ?? 'M',
    color: { dark: opts.dark ?? '#000000', light: opts.light ?? '#ffffff' },
  })
}

// Error correction is the one QR setting worth exposing: H survives a logo punched
// through the middle or a scuffed print, at the cost of a denser code.
const qrSchema = z.object({
  text: z.string().min(1),
  errorCorrection: z.enum(['L', 'M', 'Q', 'H']).default('M'),
  margin: z.number().int().min(0).max(10).default(2),
  dark: z.string().default('#000000'),
  light: z.string().default('#ffffff'),
})
export const qrCode: ToolPlugin = {
  metadata: metaFor('qr-code'),
  schema: qrSchema,
  run: (input) => {
    const q = qrSchema.parse(input)
    return qrSvg(q.text, q)
  },
}

const wifiSchema = z.object({
  ssid: z.string().min(1),
  password: z.string().default(''),
  encryption: z.enum(['WPA', 'WEP', 'nopass']).default('WPA'),
  hidden: z.boolean().default(false),
})
// Escape per the WIFI: URI scheme (special chars \ ; , : " must be backslash-escaped).
const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')
export const wifiQr: ToolPlugin = {
  metadata: metaFor('wifi-qr'),
  schema: wifiSchema,
  run: (input) => {
    const w = wifiSchema.parse(input)
    const payload = `WIFI:T:${w.encryption};S:${wifiEscape(w.ssid)};P:${wifiEscape(w.password)};${w.hidden ? 'H:true;' : ''};`
    return qrSvg(payload)
  },
}

// The sizes you actually mock up against, so the common case is a dropdown pick
// rather than remembering that an Open Graph image is 1200×630.
export const PLACEHOLDER_PRESETS: Record<string, [number, number]> = {
  'Custom': [0, 0],
  'Square 512': [512, 512],
  'Avatar 128': [128, 128],
  'Thumbnail 320×180': [320, 180],
  'HD 1280×720': [1280, 720],
  'Full HD 1920×1080': [1920, 1080],
  'OG image 1200×630': [1200, 630],
  'Twitter card 1500×500': [1500, 500],
  'Mobile 375×812': [375, 812],
  'A4 portrait 595×842': [595, 842],
}

// XML-escape label text: a placeholder label is user input landing inside an SVG
// element, and an unescaped & or < produces a document that silently won't render.
const xmlEscape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

const placeholderSchema = z.object({
  size: z.string().default('Custom'),
  width: z.number().int().min(1).max(4000).default(300),
  height: z.number().int().min(1).max(4000).default(150),
  text: z.string().default(''),
  bg: z.string().default('#cccccc'),
  fg: z.string().default('#333333'),
  radius: z.number().int().min(0).max(500).default(0),
  pattern: z.enum(['none', 'grid', 'diagonal', 'cross']).default('none'),
})

// Patterns are <pattern> defs painted over the fill — they make a placeholder read
// as "deliberately not real content" instead of a flat block someone ships by accident.
function patternDef(kind: string, fg: string): { def: string; overlay: string } {
  if (kind === 'none') return { def: '', overlay: '' }
  const shapes: Record<string, string> = {
    grid: `<path d="M20 0H0V20" fill="none" stroke="${fg}" stroke-width="1" opacity=".25"/>`,
    diagonal: `<path d="M-4 4L4 -4M0 20L20 0M16 24L24 16" stroke="${fg}" stroke-width="2" opacity=".25"/>`,
    cross: `<path d="M10 6V14M6 10H14" stroke="${fg}" stroke-width="1.5" opacity=".3"/>`,
  }
  return {
    def: `<pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse">${shapes[kind]}</pattern>`,
    overlay: `<rect width="100%" height="100%" fill="url(#p)" rx="RX"/>`,
  }
}

export const svgPlaceholder: ToolPlugin = {
  metadata: metaFor('svg-placeholder'),
  schema: placeholderSchema,
  run: (input) => {
    const p = placeholderSchema.parse(input)
    const preset = PLACEHOLDER_PRESETS[p.size]
    const [width, height] = preset && preset[0] ? preset : [p.width, p.height]
    const label = p.text || `${width}×${height}`
    const fontSize = Math.max(12, Math.min(width, height) / 8)
    // Clamp the radius so a large value on a small box can't invert the corners.
    const rx = Math.min(p.radius, Math.min(width, height) / 2)
    const { def, overlay } = patternDef(p.pattern, p.fg)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(label)}">
${def ? `  <defs>${def}</defs>\n` : ''}  <rect width="100%" height="100%" fill="${p.bg}" rx="${rx}"/>
${overlay ? `  ${overlay.replace('RX', String(rx))}\n` : ''}  <text x="50%" y="50%" fill="${p.fg}" font-family="system-ui, sans-serif" font-size="${fontSize}" font-weight="600" text-anchor="middle" dominant-baseline="middle">${xmlEscape(label)}</text>
</svg>`
  },
}

// --- Color converter ---

// Accepts #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(), and the CSS
// named colors, in any of the notations you'd paste out of a design tool.
const CSS_NAMES: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', lime: '00ff00', blue: '0000ff',
  yellow: 'ffff00', cyan: '00ffff', magenta: 'ff00ff', silver: 'c0c0c0', gray: '808080',
  grey: '808080', maroon: '800000', olive: '808000', green: '008000', purple: '800080',
  teal: '008080', navy: '000080', orange: 'ffa500', pink: 'ffc0cb', brown: 'a52a2a',
  transparent: '00000000',
}

export type Rgba = { r: number; g: number; b: number; a: number }

const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n))

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export function parseColor(input: string): Rgba {
  const text = input.trim().toLowerCase()
  const hex = CSS_NAMES[text] ?? (text.startsWith('#') ? text.slice(1) : /^[0-9a-f]{3,8}$/.test(text) ? text : null)
  if (hex) {
    const full =
      hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join('') : hex
    if (full.length !== 6 && full.length !== 8) throw new Error('Hex colors need 3, 4, 6, or 8 digits')
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 }
  }

  const nums = [...text.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]))
  if (text.startsWith('rgb') && nums.length >= 3) {
    return { r: clamp(nums[0]!, 255), g: clamp(nums[1]!, 255), b: clamp(nums[2]!, 255), a: nums[3] ?? 1 }
  }
  if (text.startsWith('hsl') && nums.length >= 3) {
    const [r, g, b] = hslToRgb(((nums[0]! % 360) + 360) % 360, clamp(nums[1]!, 100) / 100, clamp(nums[2]!, 100) / 100)
    return { r, g, b, a: nums[3] ?? 1 }
  }
  throw new Error('Enter a color as hex (#3b82f6), rgb(), hsl(), or a CSS name')
}

export function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d === 0 ? 0
    : max === rn ? 60 * (((gn - bn) / d) % 6)
    : max === gn ? 60 * ((bn - rn) / d + 2)
    : 60 * ((rn - gn) / d + 4)
  return [Math.round(((h % 360) + 360) % 360), Math.round(s * 100), Math.round(l * 100)]
}

// WCAG relative luminance — the basis of every contrast ratio below.
export function luminance({ r, g, b }: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const hex2 = (n: number) => Math.round(clamp(n, 255)).toString(16).padStart(2, '0')
export const toHex = ({ r, g, b }: Rgba) => `#${hex2(r)}${hex2(g)}${hex2(b)}`
/** Same colour, shifted in HSL space — the basis of every harmony and ramp below. */
export function shift(c: Rgba, dh: number, ds = 0, dl = 0): Rgba {
  const [h, s, l] = rgbToHsl(c)
  const [r, g, b] = hslToRgb(((h + dh) % 360 + 360) % 360, clamp(s + ds, 100) / 100, clamp(l + dl, 100) / 100)
  return { r, g, b, a: c.a }
}

const colorSchema = z.object({ color: z.string() })
export const colorConverter: ToolPlugin = {
  metadata: metaFor('color-converter'),
  schema: colorSchema,
  run: (input) => {
    const c = parseColor(colorSchema.parse(input).color)
    const hex = toHex(c)
    const [h, s, l] = rgbToHsl(c)
    const max = Math.max(c.r, c.g, c.b)
    const min = Math.min(c.r, c.g, c.b)
    const v = Math.round((max / 255) * 100)
    const sv = Math.round((max === 0 ? 0 : (max - min) / max) * 100)
    const onWhite = contrastRatio(c, { r: 255, g: 255, b: 255, a: 1 })
    const onBlack = contrastRatio(c, { r: 0, g: 0, b: 0, a: 1 })
    const best = onWhite >= onBlack ? 'white' : 'black'
    const bestRatio = Math.max(onWhite, onBlack)
    return {
      Hex: hex,
      'Hex + alpha': `${hex}${hex2(c.a * 255)}`,
      RGB: `rgb(${c.r}, ${c.g}, ${c.b})`,
      RGBA: `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 100) / 100})`,
      HSL: `hsl(${h}, ${s}%, ${l}%)`,
      HSV: `hsv(${h}, ${sv}%, ${v}%)`,
      'CSS variable': `--color: ${hex};`,
      Luminance: luminance(c).toFixed(4),
      'Contrast on white': `${onWhite.toFixed(2)}:1`,
      'Contrast on black': `${onBlack.toFixed(2)}:1`,
      // WCAG 2: 4.5:1 passes AA for body text, 7:1 passes AAA.
      'Best text color': `${best} — ${bestRatio.toFixed(2)}:1 (${bestRatio >= 7 ? 'AAA' : bestRatio >= 4.5 ? 'AA' : 'fails AA'})`,
    }
  },
}

// --- Color palette ---

// Classic colour-wheel harmonies: each is a set of hue rotations off the base,
// which is why they're a rotation table and not one function per scheme.
const HARMONY_HUES: Record<string, { label: string; deg: number }[]> = {
  complementary: [{ label: 'Base', deg: 0 }, { label: 'Complement', deg: 180 }],
  'split-complementary': [{ label: 'Base', deg: 0 }, { label: 'Split 1', deg: 150 }, { label: 'Split 2', deg: 210 }],
  analogous: [{ label: 'Analogous −30', deg: -30 }, { label: 'Base', deg: 0 }, { label: 'Analogous +30', deg: 30 }],
  triadic: [{ label: 'Base', deg: 0 }, { label: 'Triad 2', deg: 120 }, { label: 'Triad 3', deg: 240 }],
  tetradic: [{ label: 'Base', deg: 0 }, { label: 'Tetrad 2', deg: 90 }, { label: 'Tetrad 3', deg: 180 }, { label: 'Tetrad 4', deg: 270 }],
}

const paletteSchema = z.object({
  color: z.string().default('#3b82f6'),
  harmony: z
    .enum(['complementary', 'split-complementary', 'analogous', 'triadic', 'tetradic', 'monochromatic', 'shades', 'tints', 'scale'])
    .default('complementary'),
})

// A Tailwind-style 50→950 ramp. Lightness targets are fixed rather than derived so
// the scale lands where a designer expects regardless of how light the base is;
// saturation eases off at the ends, which is what stops the tails looking neon.
const SCALE_STEPS: [string, number][] = [
  ['50', 97], ['100', 94], ['200', 86], ['300', 77], ['400', 66],
  ['500', 55], ['600', 47], ['700', 39], ['800', 32], ['900', 26], ['950', 16],
]

export const colorPalette: ToolPlugin = {
  metadata: metaFor('color-palette'),
  schema: paletteSchema,
  run: (input) => {
    const p = paletteSchema.parse(input)
    const base = parseColor(p.color)
    const [, s, l] = rgbToHsl(base)
    const out: Record<string, string> = {}

    if (p.harmony === 'scale') {
      for (const [name, target] of SCALE_STEPS) {
        // Pull saturation down at both ends of the ramp, hardest at 50/950.
        const fade = Math.abs(target - 55) / 45
        out[name] = toHex(shift(base, 0, -s * fade * 0.35, target - l))
      }
    } else if (p.harmony === 'monochromatic') {
      for (const step of [-30, -15, 0, 15, 30]) {
        out[step === 0 ? 'Base' : `Lightness ${step > 0 ? '+' : ''}${step}`] = toHex(shift(base, 0, 0, step))
      }
    } else if (p.harmony === 'shades' || p.harmony === 'tints') {
      const dir = p.harmony === 'shades' ? -1 : 1
      // Step toward black/white in even slices of the remaining lightness range,
      // so a very dark base doesn't produce five identical "shades".
      const room = p.harmony === 'shades' ? l : 100 - l
      for (let i = 0; i <= 5; i++) {
        out[i === 0 ? 'Base' : `${p.harmony === 'shades' ? 'Shade' : 'Tint'} ${i}`] =
          toHex(shift(base, 0, 0, dir * (room / 5) * i))
      }
    } else {
      for (const { label, deg } of HARMONY_HUES[p.harmony]!) out[label] = toHex(shift(base, deg))
    }
    return out
  },
}

// --- Contrast checker ---

const contrastSchema = z.object({
  foreground: z.string().default('#6b7280'),
  background: z.string().default('#ffffff'),
})

const pass = (ok: boolean) => (ok ? '✓ Pass' : '✗ Fail')

export const contrastChecker: ToolPlugin = {
  metadata: metaFor('contrast-checker'),
  schema: contrastSchema,
  run: (input) => {
    const c = contrastSchema.parse(input)
    const fg = parseColor(c.foreground)
    const bg = parseColor(c.background)
    const ratio = contrastRatio(fg, bg)

    // Walk the foreground's lightness toward whichever end increases contrast until
    // it clears AA. Reported only when the original fails, as the smallest edit that fixes it.
    let suggestion = ''
    if (ratio < 4.5) {
      const away = luminance(bg) > 0.5 ? -1 : 1
      const [, , l] = rgbToHsl(fg)
      for (let step = 1; step <= 100; step++) {
        const candidate = shift(fg, 0, 0, away * step)
        if (contrastRatio(candidate, bg) >= 4.5) {
          suggestion = `${toHex(candidate)} — lightness ${Math.round(l)}% → ${Math.round(l + away * step)}% gives ${contrastRatio(candidate, bg).toFixed(2)}:1`
          break
        }
      }
      if (!suggestion) suggestion = 'No lightness adjustment of this hue reaches 4.5:1 — change the background instead.'
    }

    return {
      'Contrast ratio': `${ratio.toFixed(2)}:1`,
      Foreground: toHex(fg),
      Background: toHex(bg),
      // WCAG 2.2: large text is 18pt / 14pt bold and up, hence the lower bar.
      'AA — normal text (4.5:1)': pass(ratio >= 4.5),
      'AAA — normal text (7:1)': pass(ratio >= 7),
      'AA — large text (3:1)': pass(ratio >= 3),
      'AAA — large text (4.5:1)': pass(ratio >= 4.5),
      'UI components & graphics (3:1)': pass(ratio >= 3),
      ...(suggestion ? { 'Suggested foreground': suggestion } : {}),
    }
  },
}

// --- SVG optimizer ---

const svgSchema = z.object({ svg: z.string().min(1) })

// Deliberately conservative: drop what is provably decoration (comments, editor
// namespaces, the XML prolog) and collapse whitespace. Anything that would need a
// path parser — number rounding, shape merging, transform collapsing — is SVGO's
// job, not ours; see the note in the UI spec.
export function optimizeSvg(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
    // Inkscape/Sketch/Illustrator leave editor-only namespaces and attributes behind.
    .replace(/\s(?:xmlns:(?:inkscape|sodipodi|sketch|serif|dc|cc|rdf)|(?:inkscape|sodipodi|sketch|serif):[\w-]+)="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const bytes = (s: string) => new TextEncoder().encode(s).length
// btoa only takes latin-1, and an SVG can carry any UTF-8 — go through the bytes.
// Built with a loop rather than spreading into fromCharCode, which overflows the
// call stack on a large icon set.
function b64(s: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(s)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const svgOptimizer: ToolPlugin = {
  metadata: metaFor('svg-optimizer'),
  schema: svgSchema,
  run: (input) => {
    const source = svgSchema.parse(input).svg
    if (!source.includes('<svg')) throw new Error('That does not look like an SVG — paste markup starting with <svg')
    const min = optimizeSvg(source)
    const before = bytes(source)
    const after = bytes(min)
    // Percent-encoding beats base64 for SVG in CSS: it stays human-readable and is
    // typically ~30% smaller, since base64 inflates while SVG text barely encodes.
    const encoded = encodeURIComponent(min).replace(/'/g, '%27').replace(/"/g, "'")
    const dataUri = `data:image/svg+xml,${encoded}`
    return {
      'Original size': `${before} bytes`,
      'Optimized size': `${after} bytes`,
      Saved: `${before - after} bytes (${before ? Math.round(((before - after) / before) * 100) : 0}%)`,
      Optimized: min,
      'Data URI': dataUri,
      'Data URI (base64)': `data:image/svg+xml;base64,${b64(min)}`,
      'CSS background': `background-image: url("${dataUri}");`,
      'JSX (dangerouslySetInnerHTML)': `<div dangerouslySetInnerHTML={{ __html: \`${min}\` }} />`,
    }
  },
}

// --- Gradient (shared with the interactive generator UI) ---

export type GradientStop = { color: string; position: number }
export type GradientSpec = {
  type: 'linear' | 'radial' | 'conic'
  angle: number
  stops: GradientStop[]
  repeating?: boolean
}

/** Build the CSS `background-image` value for a gradient spec. */
export function gradientCss(g: GradientSpec): string {
  const stops = [...g.stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${s.position}%`)
    .join(', ')
  const prefix = g.repeating ? 'repeating-' : ''
  if (g.type === 'linear') return `${prefix}linear-gradient(${g.angle}deg, ${stops})`
  if (g.type === 'conic') return `${prefix}conic-gradient(from ${g.angle}deg at 50% 50%, ${stops})`
  return `${prefix}radial-gradient(circle at 50% 50%, ${stops})`
}

// --- Dominant colours (used by the image converter's palette strip) ---

/**
 * Bucket RGBA pixels into a coarse 4-bits-per-channel grid and return the fullest
 * buckets. Not a median-cut quantizer — for "what colours is this image made of"
 * a histogram is within a shade of the real answer at a fraction of the code.
 */
export function dominantColors(pixels: Uint8ClampedArray, count = 6): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < pixels.length; i += 4) {
    // Skip mostly-transparent pixels — they'd otherwise vote as black.
    if (pixels[i + 3]! < 128) continue
    const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b
    buckets.set(key, bucket)
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((c) => toHex({ r: c.r / c.n, g: c.g / c.n, b: c.b / c.n, a: 1 }))
}

export const imageTools = [
  qrCode,
  wifiQr,
  svgPlaceholder,
  colorConverter,
  colorPalette,
  contrastChecker,
  svgOptimizer,
]
