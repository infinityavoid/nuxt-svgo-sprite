import type { Config as SvgoConfig } from 'svgo'

export interface IconMeta {
  /** globally unique symbol id, e.g. "admin-star" */
  id: string
  /** generated component name, e.g. "UseAdminStar" */
  componentName: string
  /** absolute filesystem path */
  absolutePath: string
  /** when true, SVGO optimization is skipped for this icon (file named *.raw.svg) */
  raw?: boolean
}

export interface SpriteCollection {
  /** camelCase name, e.g. "adminButtons" (or "default") */
  name: string
  /** folder path segments from inputDir root, e.g. ["admin", "buttons"] */
  segments: string[]
  /** absolute path to this collection's folder */
  inputDir: string
  /** sprite component name, e.g. "AdminButtonsSprite" (or "DefaultSprite" for default) */
  spriteComponentName: string
  /** TypeScript type name, e.g. "AdminButtonsIconName" (or "DefaultIconName") */
  typeName: string
  /** all icons discovered directly in inputDir */
  icons: IconMeta[]
}

export interface ModuleOptions {
  /**
   * Root directory for SVG files. Collections are discovered automatically from
   * the folder structure. Resolved via `resolvePath`, so `~` aliases work.
   * @default '~/assets/icons'
   */
  inputDir?: string

  /**
   * Run SVGO on every SVG file before adding it to the sprite.
   * @default true
   */
  optimizeFiles?: boolean

  /**
   * Auto-generate a thin wrapper component for each icon in every collection.
   * @default false
   */
  createUseComponents?: boolean

  /**
   * Prefix applied to the name of every generated per-icon component.
   * @default 'Use'
   */
  componentPrefix?: string

  /**
   * Controls automatic sprite injection into the app root:
   *   false      — user places sprite components manually (default)
   *   true       — all collection sprites injected app-wide
   *   string[]   — only the listed collection names are injected automatically
   * @default false
   */
  autoInjectSprite?: boolean | string[]

  /**
   * Custom SVGO configuration. When provided, `plugins` REPLACES the built-in
   * default plugin list entirely (it is not merged with it) — pass the full list
   * of plugins you want to run, in order. Structural plugins required for sprite
   * correctness (internal id prefixing, symbol conversion, etc.) always run
   * afterwards regardless of this option. When omitted, the built-in defaults run.
   */
  svgoConfig?: SvgoConfig
}
