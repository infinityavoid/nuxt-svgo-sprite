# nuxt-svgo-sprite

[![npm version][npm-version-src]][npm-version-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Nuxt module that generates an inline SVG sprite (SSR-friendly) and typed icon usage.

## Features

- Inline SSR sprite via `<SvgSprite />`
- Icon usage via `<SvgUse name="..." />`
- Built-in optimization through `svg-sprite` + SVGO transform
- Optional per-icon wrappers (`<UseCheck />`, `<IconStar />`, etc.)
- Auto-generated icon name type for `SvgUse` (`#build/nuxt-svgo-sprite/icon-names`)
- Nuxt 3 / Nuxt 4 compatible

## Install

```bash
npm install nuxt-svgo-sprite
```

## Setup

```ts
export default defineNuxtConfig({
  modules: ['nuxt-svgo-sprite'],
  svgoSprite: {
    inputDir: './assets/icons',
  },
})
```

Add icons:

```text
assets/icons/check.svg
assets/icons/star.svg
```

Use in app/layout:

```vue
<template>
  <SvgSprite />
  <SvgUse name="check" width="24" height="24" />
</template>
```

## Configuration

```ts
export default defineNuxtConfig({
  svgoSprite: {
    inputDir: './assets/icons',
    optimizeFiles: true,
    createUseComponents: false,
    componentPrefix: 'use',
    spriteOptions: {},
  },
})
```

| Option | Type | Default |
|---|---|---|
| `inputDir` | `string` | `'./assets/icons'` |
| `optimizeFiles` | `boolean` | `true` |
| `createUseComponents` | `boolean` | `false` |
| `componentPrefix` | `string` | `'use'` |
| `spriteOptions` | `SpriteConfig` | internal defaults |

Notes:
- `optimizeFiles: false` disables sprite transforms.
- `spriteOptions` overrides default `svg-sprite` config.

## Typed `SvgUse.name`

During build/dev, the module generates:

- `#build/nuxt-svgo-sprite/icon-names.d.ts`
- a generated `SvgUse` component in Nuxt build templates (`.nuxt`)

`SvgUse` imports `SvgIconName` from this file, so IDE autocomplete is based on actual `.svg` filenames.

## Per-icon wrappers

Enable:

```ts
svgoSprite: {
  createUseComponents: true,
  componentPrefix: 'Icon',
}
```

Then `arrow-right.svg` becomes `<IconArrowRight />`.

Generated wrapper components are also emitted as Nuxt templates (`.nuxt`) and render a plain `<svg><use ... /></svg>` for each icon.

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
