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

  /**
   * Log a warning when the total inlined sprite payload (summed across every
   * collection, at cold build) exceeds this size, in KB. Every inlined sprite ships
   * on every page, so an unbounded sprite is a real, easy-to-miss performance cost —
   * this is a diagnostic only; it never fails the build.
   * @default undefined (no limit checked)
   */
  sizeLimitKb?: number

  /**
   * Rewrite literal fill/stroke values (e.g. "#000", "black") to "currentColor", so
   * an icon's color can be controlled from outside — CSS `color`, or a `<SvgUse
   * fill="...">`/`stroke="..."` attribute forwarded onto the wrapping `<svg>` —
   * instead of being locked to whatever color the source file was authored/exported
   * with. Values that are already dynamic or aren't a literal color ("none",
   * "currentColor", "transparent", "inherit", `var(...)`, `url(#id)` gradient/pattern
   * references) are left untouched.
   * @default false
   */
  normalizeColors?: boolean

  /**
   * Icons whose id matches this pattern are excluded from `normalizeColors` — for
   * icons that intentionally keep multi-color fills (e.g. a colored logo). Tested
   * against the icon's symbol id (e.g. "admin-logo"). Only applies when
   * `normalizeColors` is enabled.
   */
  normalizeColorsExclude?: RegExp

  /**
   * Emit only icons detected as actually used in your source — a literal-string scan
   * for the icon id (`<SvgUse name="home">`) or its component name
   * (`<UseHome />`), across `.vue`/`.js`/`.ts`/etc. files under `srcDir`. Shrinks the
   * inlined SSR sprite payload; does NOT affect generated types, DevTools, or Use*
   * components, which always reflect the full discovered icon set. Applies to
   * production builds only (`nuxt build`/`nuxt generate`) — never to `nuxt dev`, so
   * every icon is always available while developing.
   *
   * Detection is literal-only, like `@nuxt/icon`'s `clientBundle.scan` and
   * `unplugin-svg-component`'s `treeShaking` — a dynamically-computed name
   * (`:name="someVar"`) is invisible to it. Use `treeShakingInclude` for icons a scan
   * can't see.
   * @default false
   */
  treeShaking?: boolean

  /**
   * Icon ids to always keep in the sprite when `treeShaking` is enabled, regardless
   * of scan results — the escape hatch for icons only referenced dynamically
   * (`:name="someVar"`), which a literal-string scan cannot detect.
   */
  treeShakingInclude?: string[]
}
