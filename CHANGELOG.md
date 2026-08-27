# Changelog


## v2.2.0...3.0.0

[compare changes](https://github.com/infinityavoid/nuxt-svgo-sprite/compare/v2.2.0...3.0.0)

### 🚀 Enhancements

- **foundation:** Phase 0 — data model, icon-meta utils, folder walker, unit tests ([a42198f](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/a42198f))
- **sprite-builder:** Phase 1 — isolate svg-sprite behind sprite-builder ([bc36417](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/bc36417))
- **collections:** Phase 2 — collection builder, per-collection watcher, module integration ([692d28c](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/692d28c))
- Per-collection sprite/type templates, uniform component naming ([9f9c610](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/9f9c610))
- AutoInjectSprite — Nitro-based sprite injection into body ([edf23da](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/edf23da))
- Add Nuxt DevTools tab for SVG sprite collections ([4dbfd88](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/4dbfd88))
- Scanner hardening, per-icon SVGO opt-out, and type JSDoc ([469b28d](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/469b28d))
- Audit hardening — segment sanitization, tests, docs, and DX fixes ([32b9eeb](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/32b9eeb))
- Replace svg-sprite with SVGO-native pipeline ([ea9cccb](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/ea9cccb))

### 🩹 Fixes

- Prevent internal SVG id collisions in sprite output ([c03036b](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/c03036b))

### 💅 Refactors

- Thin module.ts to orchestration-only; add watcher cleanup ([e87c1bc](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/e87c1bc))
- Replace any cast in extractSprite with typed optional chain ([5825034](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/5825034))

### 📖 Documentation

- Rewrite README and playground for v3 collections ([d650065](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/d650065))
- Document dynamic :name usage and sprite mount order; add layers fixture ([78f48ff](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/78f48ff))
- Update README and playground for svgoConfig API ([95574f5](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/95574f5))

### 🏡 Chore

- Merge 2.2.0 into main ([def6341](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/def6341))
- Untrack internal spec file from git history ([828e4ae](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/828e4ae))
- Bump version to 3.0.0 ([1d5597d](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/1d5597d))

### ✅ Tests

- Remove unnecessary type casts and dead eslint-disable directives ([cc51054](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/cc51054))

### ❤️ Contributors

- Anton Ustinov <Anton.ustinov02@mail.ru>

## v2.1.1...2.2.0

[compare changes](https://github.com/infinityavoid/nuxt-svgo-sprite/compare/v2.1.1...2.2.0)

### 🩹 Fixes

- V2.2.0 maintenance fixes ([45c4cde](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/45c4cde))

### 📖 Documentation

- Document ~ alias support for inputDir and spriteOptions merge behavior ([f0c9257](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/f0c9257))

### ❤️ Contributors

- Anton Ustinov <Anton.ustinov02@mail.ru>

