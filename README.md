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
- **SVGO optimization** built in via `svg-sprite`
- **HMR support** — dev server rebuilds sprites on file add/change/remove
- **Optional per-icon wrapper components** — `<UseHome />`, `<IconAdminUser />`, etc.
- **SSR-friendly** — sprites are inlined into the HTML, no layout shift
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

Place your SVG icons under `assets/icons/`:

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
<SvgUse name="home" width="24" height="24" />
<SvgUse name="admin-user" width="24" height="24" stroke="currentColor" />
```

All standard SVG attributes are forwarded to the inner `<svg>` element. The `name` prop is typed as `AllIconName` (union of all collection types) — IDE autocomplete and typo detection work out of the box.

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

## TypeScript types

The module generates `#build/nuxt-svgo-sprite/icon-names.d.ts` and registers it in your Nuxt `tsconfig` automatically (via `prepare:types`). No imports needed:

```ts
// Generated from your actual .svg files:
export type DefaultIconName = 'home' | 'star'
export type AdminIconName   = 'admin-user' | 'admin-shield'
export type AllIconName     = DefaultIconName | AdminIconName
```

`SvgUse`'s `name` prop is typed as `AllIconName`, so your IDE flags unknown icon names at development time.

## Configuration

```ts
export default defineNuxtConfig({
  svgoSprite: {
    inputDir: '~/assets/icons',
    optimizeFiles: true,
    createUseComponents: false,
    componentPrefix: 'Use',
    autoInjectSprite: false,
    spriteOptions: {},
  },
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `inputDir` | `string` | `'./assets/icons'` | Root folder scanned for SVG files. `~` aliases are supported. |
| `optimizeFiles` | `boolean` | `true` | Pass each SVG through SVGO before adding it to the sprite. |
| `createUseComponents` | `boolean` | `false` | Generate a wrapper component per icon. |
| `componentPrefix` | `string` | `'Use'` | Prefix for generated wrapper components. |
| `autoInjectSprite` | `boolean \| string[]` | `false` | Inject sprite(s) into every SSR page automatically. |
| `spriteOptions` | `SpriteConfig` | internal defaults | Deep-merged over the built-in `svg-sprite` configuration. |

## Migrating from v2

| v2 | v3 |
|---|---|
| `<SvgSprite />` | `<DefaultSprite />` (named collections: `<AdminSprite />`, etc.) |
| `SvgIconName` | `DefaultIconName` (or `AllIconName` to cover all collections) |
| `componentPrefix: 'use'` | `componentPrefix: 'Use'` (capital U is the new default) |
| Root-level `*.svg` files | Unchanged — still the default collection |
| No subfolder support | Subfolders auto-create named collections |
| `icon.svg` → id `"icon"` | Root files unchanged; `admin/icon.svg` → id `"admin-icon"` |

There is no `collections: Record<string, string>` config key. Collections are discovered from the folder structure automatically.

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
