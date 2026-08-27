# nuxt-svgo-sprite

[![npm version][npm-version-src]][npm-version-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Nuxt 3 module that auto-discovers SVG collections from your folder structure, generates one inline SSR sprite per collection, and provides typed icon references.

## Features

- **Folder-based collections** — subfolders under `inputDir` become named collections automatically; no extra config needed
- **Per-collection sprite components** — `<DefaultSprite />`, `<AdminSprite />`, etc.
- **Universal `<SvgUse>` component** — reference any icon across all collections by name
- **`autoInjectSprite`** — optionally inject sprites into every SSR page without touching your templates
- **Typed icon names** — `DefaultIconName`, `AdminIconName`, `AllIconName` — generated from actual `.svg` filenames
- **SVGO v4 optimization** built in — direct pipeline, no extra dependencies
- **HMR support** — dev server rebuilds sprites on file add/change/remove
- **Optional per-icon wrapper components** — `<UseHome />`, `<IconAdminUser />`, etc.
- **SSR-friendly** — sprites are inlined into the HTML, no layout shift
- **Nuxt DevTools tab** — browse every discovered collection and icon, with live previews
- Nuxt 3 / Nuxt 4 compatible

## Install

```bash
npm install nuxt-svgo-sprite
```

## Quick start

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-svgo-sprite'],
})
```

Place your SVG icons under `assets/icons/` (Nuxt 3) or `app/assets/icons/` (Nuxt 4 — its default `srcDir` moved to `app/`):

```
assets/icons/
  home.svg
  star.svg
  admin/
    user.svg
    shield.svg
```

Use in your app:

```vue
<!-- app.vue -->
<template>
  <!-- Place once — in app.vue or a shared layout -->
  <DefaultSprite />
  <AdminSprite />

  <SvgUse name="home" width="24" height="24" />
  <SvgUse name="star" width="24" height="24" />
  <SvgUse name="admin-user" width="24" height="24" />
  <SvgUse name="admin-shield" width="24" height="24" />
</template>
```

## Folder structure → collections

Every folder under `inputDir` becomes a **collection** automatically:

```
assets/icons/
  home.svg           → default collection  →  id="home"
  star.svg           → default collection  →  id="star"
  default/
    extra.svg        → default collection  →  id="extra"   (merged into default)
  admin/
    user.svg         → admin collection    →  id="admin-user"
    shield.svg       → admin collection    →  id="admin-shield"
  payments/
    card.svg         → payments collection →  id="payments-card"
```

Root-level files and the optional `default/` subfolder both belong to the **default** collection.

Each discovered collection gets:
- **Sprite component** — `<DefaultSprite />`, `<AdminSprite />`, `<PaymentsSprite />`
- **TypeScript type** — `DefaultIconName`, `AdminIconName`, `PaymentsIconName`

**Every folder is its own collection — nesting doesn't merge upward.** `admin/nested/deep.svg` becomes its *own* `AdminNestedSprite` / `AdminNestedIconName`, not part of `admin`. There's no namespacing within a collection (see [Migrating from v2](#migrating-from-v2)) — if you use `autoInjectSprite` with an explicit collection list, remember a two-levels-deep folder needs its own entry in that list too.

A few more behaviors worth knowing before organizing a large icon set:
- **Unknown collection names** in `autoInjectSprite: [...]` are warned about and skipped, listing the collections that were actually found.
- **Duplicate symbol ids** (e.g. a root `admin-user.svg` alongside `admin/user.svg`) are warned about; the later one is dropped.
- **Filenames with spaces, capitals, or other non-standard characters** are normalized (`My Icon.svg` → id `my-icon`) with a warning naming the original file — useful to know before naming hundreds of files.
- **A malformed or empty SVG, or one whose root element isn't `<svg>`,** is logged as an error and excluded from that build — it does not fail the whole sprite, and it does not appear in the generated types or components.
- `inputDir` also accepts a plain relative path (e.g. `'assets/icons'`, resolved against `srcDir`) — `~` aliases are supported, not required.

## Components

### Sprite components

Each collection generates a component named `{Collection}Sprite`:

```vue
<DefaultSprite />   <!-- inlines symbols: home, star -->
<AdminSprite />     <!-- inlines symbols: admin-user, admin-shield -->
```

Place them once per page or in a shared layout. They are visually hidden (via inline `style`) and make their symbols available to every `<SvgUse>` on the same page.

If you prefer not to place these manually, use [`autoInjectSprite`](#autoinjectsprite).

### `<SvgUse>`

References any icon by id across all collections:

```vue
<!-- static name -->
<SvgUse name="home" width="24" height="24" />
<SvgUse name="admin-user" width="24" height="24" stroke="currentColor" />

<!-- dynamic name — works at runtime; TypeScript still checks AllIconName -->
<SvgUse :name="currentIcon" width="24" height="24" />
```

All standard SVG attributes are forwarded to the inner `<svg>` element. The `name` prop is typed as `AllIconName` (union of all collection types) — IDE autocomplete and typo detection work out of the box.

> **Mount order:** the sprite component (`<DefaultSprite />`, `<AdminSprite />`, etc.) must appear in the DOM **before** any `<SvgUse>` that references its symbols. Place sprite components in a shared layout or at the top of the page template. If you use `autoInjectSprite`, this is handled automatically.

### Per-icon wrapper components

Enable `createUseComponents` to generate a thin wrapper component per icon:

```ts
svgoSprite: {
  createUseComponents: true,
  componentPrefix: 'Icon',   // default: 'Use'
}
```

```vue
<IconHome width="24" height="24" />
<IconAdminUser width="24" height="24" stroke="currentColor" />
```

Component names follow the pattern `{prefix}{PascalCase(id)}`:

| File | id | Component |
|---|---|---|
| `home.svg` | `home` | `<IconHome />` |
| `arrow-right.svg` | `arrow-right` | `<IconArrowRight />` |
| `admin/user.svg` | `admin-user` | `<IconAdminUser />` |
| `admin/shield.svg` | `admin-shield` | `<IconAdminShield />` |

Components are auto-imported and accept all standard SVG attributes.

## `autoInjectSprite`

By default (`autoInjectSprite: false`) you place sprite components manually. Set `autoInjectSprite` to inject them via a Nitro server plugin instead:

```ts
svgoSprite: {
  // Inject all collection sprites into every SSR page:
  autoInjectSprite: true,

  // Or inject only specific collections:
  autoInjectSprite: ['admin', 'payments'],
}
```

Sprites are injected before `#__nuxt` in the rendered HTML, outside Vue's hydration scope — no hydration mismatch, and they persist across SPA navigation without any client-side work.

When `autoInjectSprite: false` (the default), a dev-mode notice lists the sprite component names you need to add.

## Nuxt DevTools

In dev mode, open Nuxt DevTools and look for the **SVG Sprite** tab. It lists every discovered collection with its icon count, an `auto-injected` badge where relevant, and a live preview image for each icon — the fastest way to check exactly what your folder structure produced without reading generated files by hand. It updates automatically as you add/edit/remove icons.

## SVGO opt-out per icon

Rename any icon file to `*.raw.svg` to include it in the sprite **without SVGO optimization**. This is useful for icons that rely on features SVGO's default preset removes (XML comments, certain attributes, animation data):

```
assets/icons/
  home.svg          ← optimized normally
  logo.raw.svg      ← included as-is, SVGO skipped
```

The generated id and component name are the same as for a regular `.svg` file — the `.raw` suffix is transparent to consumers:

```vue
<SvgUse name="logo" width="64" height="64" />
```

## Styling icons

Generated components emit a plain `<svg>` with no injected classes, inline styles, or wrapper elements. Size and color are controlled entirely by the consumer:

```vue
<!-- via HTML attributes -->
<SvgUse name="home" width="24" height="24" stroke="currentColor" />

<!-- via CSS -->
<SvgUse name="home" class="icon icon--lg" />
```

```css
.icon        { width: 1.5rem; height: 1.5rem; }
.icon--lg    { width: 2rem; height: 2rem; }
```

All standard SVG presentation attributes (`fill`, `stroke`, `stroke-width`, `color`, etc.) are forwarded directly to the inner `<svg>` element via Vue's `v-bind="$attrs"`.

## TypeScript types

The module generates `#build/nuxt-svgo-sprite/icon-names.d.ts` and registers it in your Nuxt `tsconfig` automatically (via `prepare:types`):

```ts
// Generated from your actual .svg files:
export type DefaultIconName = 'home' | 'star'
export type AdminIconName   = 'admin-user' | 'admin-shield'
export type AllIconName     = DefaultIconName | AdminIconName
```

`SvgUse`'s `name` prop is already typed as `AllIconName` — no import needed to get typo detection on `<SvgUse name="...">` itself. If you want one of the generated types yourself (e.g. to type a `ref`), import it explicitly, the same way the module's own `SvgUse` component does:

```ts
import type { AllIconName } from '#build/nuxt-svgo-sprite/icon-names'

const currentIcon = ref<AllIconName>('home')
```

## Configuration

```ts
export default defineNuxtConfig({
  svgoSprite: {
    inputDir: '~/assets/icons',
    optimizeFiles: true,
    createUseComponents: false,
    componentPrefix: 'Use',
    autoInjectSprite: false,
    svgoConfig: {},
  },
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `inputDir` | `string` | `'~/assets/icons'` | Root folder scanned for SVG files. `~` aliases are supported. |
| `optimizeFiles` | `boolean` | `true` | Pass each SVG through SVGO before adding it to the sprite. Set `false` to skip optimization globally. |
| `createUseComponents` | `boolean` | `false` | Generate a wrapper component per icon. |
| `componentPrefix` | `string` | `'Use'` | Prefix for generated wrapper components. |
| `autoInjectSprite` | `boolean \| string[]` | `false` | Inject sprite(s) into every SSR page automatically. |
| `svgoConfig` | `SvgoConfig` | internal defaults | When set, `plugins` REPLACES the built-in default plugin list (not merged) — pass the full list you want. See [SVGO docs](https://svgo.dev) for available plugins. |

## Migrating from v2

| v2 | v3 |
|---|---|
| `<SvgSprite />` | `<DefaultSprite />` (named collections: `<AdminSprite />`, etc.) |
| `SvgIconName` | `DefaultIconName` (or `AllIconName` to cover all collections) |
| `componentPrefix: 'use'` | `componentPrefix: 'Use'` (capital U is the new default) |
| `spriteOptions: SpriteConfig` | `svgoConfig: SvgoConfig` — direct SVGO config, no svg-sprite wrapper |
| `optimizeFiles: false` | Unchanged — still disables SVGO optimization globally |
| Root-level `*.svg` files | Unchanged — still the default collection |
| No subfolder support | Subfolders auto-create named collections |
| `icon.svg` → id `"icon"` | Root files unchanged; `admin/icon.svg` → id `"admin-icon"` |

There is no `collections: Record<string, string>` config key. Collections are discovered from the folder structure automatically.

**`spriteOptions` migration:** the `spriteOptions` key no longer exists (v3 removes `svg-sprite`). If you passed custom SVGO plugins via `spriteOptions.shape.transform`, move them directly to `svgoConfig.plugins`:

```ts
// v2
spriteOptions: {
  shape: { transform: [{ svgo: { plugins: [{ name: 'preset-default' }] } }] }
}

// v3
svgoConfig: {
  plugins: [{ name: 'preset-default' }]
}
```

> `viewBox` is preserved by default without any override — SVGO 4's `preset-default` doesn't include `removeViewBox` at all, so passing `overrides: { removeViewBox: false }` only produces a "not part of preset-default" warning, it doesn't do anything.

svg-sprite-specific keys (`mode`, `svg.rootAttributes`, `shape.*`) have no v3 equivalent — these are handled internally.

## Development

```bash
npm run dev:prepare
npm run dev
npm test
npm run test:types
```

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-svgo-sprite/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-svgo-sprite
[license-src]: https://img.shields.io/npm/l/nuxt-svgo-sprite.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/nuxt-svgo-sprite
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt
[nuxt-href]: https://nuxt.com
