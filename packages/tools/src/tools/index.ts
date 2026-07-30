import type { ToolPlugin } from '@devdesk/shared'
import { jsonTools } from './json'
import { encodingTools } from './encoding'
import { cryptoTools } from './crypto'
import { webTools } from './web'
import { developmentTools } from './development'
import { dataFormatTools } from './data-formats'
import { dateTimeTools } from './date-time'
import { networkingTools } from './networking'
import { imageTools } from './images'
import { mathTools } from './math'

/** Every implemented core tool plugin. */
export const CORE_PLUGINS: ToolPlugin[] = [
  ...jsonTools,
  ...encodingTools,
  ...cryptoTools,
  ...webTools,
  ...developmentTools,
  ...dataFormatTools,
  ...dateTimeTools,
  ...networkingTools,
  ...imageTools,
  ...mathTools,
]

export * from './json'
export * from './encoding'
export * from './crypto'
export * from './web'
export * from './development'
export * from './data-formats'
export * from './date-time'
export * from './networking'
export * from './images'
export * from './math'
