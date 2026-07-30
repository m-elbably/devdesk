declare module 'js-yaml' {
  export function load(text: string): unknown
  export function dump(value: unknown, options?: { noRefs?: boolean; lineWidth?: number }): string
}
