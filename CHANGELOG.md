# Changelog


## v3.2.0...v3.2.1

[compare changes](https://github.com/infinityavoid/nuxt-svgo-sprite/compare/v3.2.0...v3.2.1)

### 🩹 Fixes

- Migrate DevTools integration off deprecated devtools-kit v3 APIs ([440263e](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/440263e))

### 📖 Documentation

- Add a benchmarks section comparing against other icon approaches ([e73c9b8](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/e73c9b8))

### ❤️ Contributors

- Anton Ustinov <Anton.ustinov02@mail.ru>

## v3.1.1...3.2.0

[compare changes](https://github.com/infinityavoid/nuxt-svgo-sprite/compare/v3.1.1...v3.2.0)

### 🚀 Enhancements

- Tree-shaking, layer icon merging, color normalization, and HMR/DevTools fixes ([174c872](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/174c872))

### 🩹 Fixes

- Harden layers, tree-shaking, and color normalization ([eebc6ae](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/eebc6ae))

### 🏡 Chore

- Merge 3.1.1 into main ([a1cfdfb](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/a1cfdfb))

### ❤️ Contributors

- Anton Ustinov <Anton.ustinov02@mail.ru>

## v3.1.0...3.1.1

[compare changes](https://github.com/infinityavoid/nuxt-svgo-sprite/compare/v3.1.0...3.1.1)

### 🚀 Enhancements

- DevTools shows only real components, adapts to light theme ([1c62d2a](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/1c62d2a))

### 🔥 Performance

- Cache unchanged icons across HMR rebuilds ([3a00bd9](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/3a00bd9))

### 🏡 Chore

- Merge 3.1.0 into main ([16eb358](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/16eb358))

### ❤️ Contributors

- Anton Ustinov <Anton.ustinov02@mail.ru>

## v3.0.0...3.1.0

[compare changes](https://github.com/infinityavoid/nuxt-svgo-sprite/compare/v3.0.0...3.1.0)

### 🚀 Enhancements

- Warn in dev when a SvgUse target isn't in the DOM ([3e94bcb](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/3e94bcb))

### 🩹 Fixes

- Correctness and reliability fixes across the sprite pipeline ([00df8f4](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/00df8f4))
- DevTools hardening and remaining pipeline polish ([2f3ffe9](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/2f3ffe9))
- Correctness and performance fixes from a second review pass ([4686149](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/4686149))
- Bugs found by testing the module as a real consumer ([ee74b7e](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/ee74b7e))
- Correct and simplify fixes from the previous two rounds ([eb93cda](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/eb93cda))
- Warn on a silent folder merge the final release gate caught ([6ffbe9a](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/6ffbe9a))

### 📖 Documentation

- Close doc gaps found by testing the module as a real consumer ([8c416a6](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/8c416a6))
- Fix migration example that no longer demonstrated anything ([5072e3e](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/5072e3e))

### 🏡 Chore

- Merge 3.0.0 into main ([928a29b](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/928a29b))
- Merge dependency-refresh into main ([2227bfb](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/2227bfb))
- Add MIT LICENSE file ([1771742](https://github.com/infinityavoid/nuxt-svgo-sprite/commit/1771742))

### ❤️ Contributors

- Anton Ustinov <Anton.ustinov02@mail.ru>

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

