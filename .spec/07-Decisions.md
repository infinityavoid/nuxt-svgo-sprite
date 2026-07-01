> ⚠️ INTERNAL DOCUMENT
> This file is part of the internal design specification for nuxt-svgo-sprite v3.
> Must NOT be committed to the public repository. Add `.spec/` to `.gitignore`.

# 07 — Decisions Log (ADR)

Architecture Decision Records for nuxt-svgo-sprite v3. Each entry: the Decision, the
Reason, the Alternatives Considered, and what was Rejected and why. If you are about
to re-open a decision, read its entry first.

---

## ADR-001 — Folder-based collection auto-detection replaces explicit `collections` map

- **Decision:** Collections are discovered automatically from the `inputDir` folder
  tree. There is no `collections: Record<string, string>` config key. The user sets
  `inputDir` (like v2) and the folder structure defines the collections.
- **Reason:** The folder name IS the collection name — requiring the user to repeat it
  in config is redundant and error-prone. Auto-detection from folder structure is the
  same pattern Nuxt uses for `components/` and `pages/`. It is simpler, more
  predictable, and requires no config changes when adding a new icon group.
- **Alternatives Considered:** explicit `collections: Record<string, string>` map;
  `inputDir: string[]`; array of `{ name, dir }` objects.
- **Rejected:**
  - explicit map — repeats information already in the directory structure; was the
    original plan but owner confirmed folder-based detection is preferable.
  - `string[]` — no names, so no distinct sprites/types.
  - array of objects — works, but folder detection is strictly simpler.
- **Constraint:** All collections must live under a single `inputDir`. Icons from
  entirely separate directory trees are not supported in v3.
- **Status:** Accepted (v3, supersedes original plan).

---

## ADR-002 — Every folder is a collection boundary (no namespacing within a collection)

- **Decision:** Each folder under `inputDir` defines its own collection. There are no
  namespaces within a collection. A file's parent folder IS its collection. Sub-folders
  always create new collections with extended names, never namespaced paths within the
  parent collection.
- **Reason:** Namespacing (joining folder path into one id within one sprite) adds
  complexity for little gain: the user already organizes icons into folders. Treating
  each folder as a separate collection is simpler, more consistent, and aligns with the
  "one sprite per collection" model.
- **Id formula:** `id = segments.join('-') + '-' + sanitizedFilename` for non-default;
  `id = sanitizedFilename` for default. This makes ids globally unique across all
  sprites by construction.
- **Alternatives Considered:** nested folders = namespaces within a parent collection
  (original plan); flat ids (ignored folder entirely).
- **Rejected:**
  - namespacing — complicates collection lifecycle, watcher routing, and the `buildIconMeta`
    contract; owner confirmed every folder = its own collection.
  - flat ids — collide immediately when two collections have same filename.
- **Status:** Accepted (v3, supersedes ADR-002 original which described namespace strategy).

---

## ADR-003 — `buildIconMeta()` is the single source of truth

- **Decision:** Exactly one function maps (filename, pathSegments, absoluteFilePath,
  componentPrefix) to `IconMeta` (id, componentName, absolutePath). All other code
  calls it; no code re-derives ids or component names.
- **Reason:** v2 inlines `basename`/`toPascalCase` in multiple places that can drift.
  Centralizing makes identity provably consistent and exhaustively unit-testable.
- **Alternatives Considered:** derive inline where needed; a class with methods.
- **Rejected:** inline derivation (the v2 problem we are fixing); a class is
  unnecessary ceremony for a pure function.
- **Status:** Accepted (v3).

---

## ADR-004 — `default` collection → `Sprite.vue`; type name uses uniform formula

- **Decision:** The `default` collection generates `Sprite.vue` (not `DefaultSprite.vue`)
  for ergonomic reasons. However, the TypeScript type name follows the uniform formula:
  `toPascalCase(collectionName) + 'IconName'` → `DefaultIconName` (not `SvgIconName`).
- **Reason:** `Sprite` is the cleanest component name for the dominant single-collection
  use case. But `SvgIconName` as a special type name for `default` creates a collision
  risk if the user has a folder named `svg` (which would also produce `SvgIconName`).
  Using `DefaultIconName` for the type eliminates all special-casing in the type formula
  and removes the collision entirely.
- **Alternatives Considered:** uniform rule everywhere (`DefaultSprite` + `DefaultIconName`);
  keeping `SvgIconName` as special type for default.
- **Rejected:**
  - full uniform rule — worsens the common case for the component name (`DefaultSprite`
    is noisier than `Sprite`).
  - keeping `SvgIconName` — creates a collision with a `svg/` subfolder; requires a
    reserved folder name; worse than just renaming the type.
- **Breaking change from v2.2.0:** `SvgSprite` → `Sprite`; `SvgIconName` → `DefaultIconName`.
  Acceptable since v3 is a major version and the package has no established users yet.
- **Status:** Accepted (v3).

---

## ADR-005 — `autoInjectSprite` accepts boolean or string array

- **Decision:** `autoInjectSprite: false | true | string[]`. `false` = no injection
  (manual). `true` = inject all collections. `string[]` = inject only the listed
  collection names; others are placed manually by the user.
- **Reason:** With multiple collections, `true` (inject all) is often too coarse. A
  user may want their `admin` collection only on admin pages, injecting it manually
  there, while having the `default` collection injected everywhere. The array form
  enables this without giving up convenience for the rest.
- **Mechanism:** a generated Nuxt plugin adds the selected sprite components to the app
  root, ensuring SSR renders them before any `<use>` references.
- **Alternatives Considered:** boolean only; per-page/layout injection.
- **Rejected:**
  - boolean only — too coarse for multi-collection setups; owner confirmed array form.
  - per-page/layout injection — cannot be done automatically (module can't know which
    layout a page uses at build time). Users inject manually in their layouts/pages.
- **Status:** Accepted (v3, extends original boolean-only decision).

---

## ADR-006 — No accessibility logic in the component

- **Decision:** The generated `Use*` and `SvgUse` components add no `title` prop and
  no automatic `role`/`aria-*`. README documents correct patterns.
- **Reason:** A `<title>` inside a `<use>`-referenced symbol causes double announcement
  in some screen readers; correct `role`/`aria` depends on context only the consumer
  knows.
- **Status:** Accepted (v3). (Originally issue #25 — dropped.)

---

## ADR-007 — Keep svg-sprite, isolate it

- **Decision:** Continue using `svg-sprite` for sprite compilation; confine all of its
  usage to `builders/sprite-builder.ts`.
- **Reason:** It correctly handles SVGO integration, symbol mode, viewBox, and id
  handling. Isolation makes a future swap a single-file change.
- **Status:** Accepted (v3). (Originally issue #20 — declined.)

---

## ADR-008 — `typeName` and `relativePath` removed from `IconMeta`

- **Decision:** `IconMeta` has no `typeName` (the type member IS the `id`) and no
  `relativePath` (there is no sub-path within a collection; the file is always directly
  in its collection's folder). No `collection` back-pointer either.
- **Reason:** Fewer fields = fewer sources of truth. Each removed field is derivable
  from what remains, so keeping it would only invite drift.
- **Status:** Accepted (v3).

---

## ADR-009 — Collection name validation / sanitization

- **Decision:** Collection names are auto-derived from folder names; they are NOT
  validated against a regex. Instead, folder names are sanitized: non-alphanumeric
  characters (except hyphens) are normalized. Hyphens in folder names are treated as
  word boundaries (e.g., folder `admin-icons` → collection `adminIcons`).
  An empty result after sanitization → skip the folder with a warning.
- **Reason:** The original plan had users specify collection names explicitly and
  validated them with `/^[a-z][a-zA-Z0-9]*$/`. With folder-based auto-detection, the
  module must handle whatever folder names the user has. Sanitization is the right
  approach; fail-fast validation is not appropriate for auto-derived names.
- **Status:** Accepted (v3, replaces original regex-validation approach).

---

## ADR-010 — v2.2.0 as a separate maintenance release

- **Decision:** Ship a `2.2.0` maintenance release fixing 2.1.1 bugs without API
  changes, before building v3 separately. It is the last v2 release.
- **Status:** Accepted. Completed and merged to `main`. Tag `v2.2.0` pushed. Pending
  `npm publish`.

---

## ADR-011 — Deleted icons cannot unregister their components (warn only)

- **Decision:** On `unlink` under a collection's input dir, the watcher rebuilds sprite
  and types but cannot remove an already-registered `Use*` component. Logs in English:
  `"Icon 'X' removed from sprite. Restart dev server to unregister component UseX."`
- **Reason:** Nuxt Kit has no `removeComponent` API.
- **Status:** Accepted. (Originally issue #12.)

---

## ADR-012 — `defu` not needed in sprite-builder; Nuxt handles the merge

- **Decision:** `defaults.spriteOptions = defaultSpriteConfig` in `defineNuxtModule`.
  Nuxt's internal `defu` automatically deep-merges the user's partial `spriteOptions`
  with `defaultSpriteConfig` before `setup()` runs. No explicit `defu` call needed in
  `sprite-builder.ts`.
- **Reason:** `defineNuxtModule` uses `defu` internally. Because `defaults.spriteOptions`
  is the full `defaultSpriteConfig`, the user's partial override is already merged when
  `setup()` receives `options`. An explicit call would duplicate work.
- **Important:** `defaultSpriteConfig` lives in `builders/sprite-builder.ts` but is
  imported by `module.ts` for use in `defaults`. This is the required layout. Do NOT
  set `defaults.spriteOptions = {}` — that would break the implicit merge.
- **Status:** Accepted (confirmed for both v2.2.0 and v3).

---

## ADR-013 — Warning during `nuxt-module-build prepare` is expected; handle with comment

- **Decision:** Do not suppress the "Input directory not found" warning during
  `nuxt-module-build prepare`. Leave a code comment explaining the behaviour.
- **v3 note:** With folder-based detection, if `inputDir` doesn't exist during
  `nuxt-module-build prepare`, only ONE warning fires (the root check). This is
  manageable. Use `nuxt.options._prepare` to downgrade to `logger.debug` if the noise
  becomes unacceptable.
- **Status:** Accepted (2.2.0). Revisit in v3 Phase 2.

---

## ADR-014 — Filename sanitization: strip invalid chars, still register component

- **Decision:** When a filename contains characters that are not letters, digits, or
  hyphens, sanitize before deriving the id: replace invalid chars with hyphens,
  collapse consecutive hyphens, trim leading/trailing hyphens. The component is still
  registered with the sanitized name. Do not skip the file.
- **Reason:** Users may have files like `My Icon.svg` or `icon@2x.svg`. Skipping them
  silently is surprising. Sanitizing and registering is the more helpful behavior.
  Log a `logger.warn` noting the original filename and the derived id.
- **Example:** `My Icon.svg` → base `my-icon` → id `my-icon`, component `UseMyIcon`.
- **Collision after sanitization:** if two filenames in the same collection sanitize to
  the same base, warn and skip the second.
- **Status:** Accepted (v3).

---

## ADR-015 — Symbol id formula: collection-kebab-prefix + filename for non-default

- **Decision:** Symbol ids in the generated sprite are globally unique:
  - default collection: `id = sanitizedFilename`
  - named collection: `id = segments.join('-') + '-' + sanitizedFilename`
  This ensures that inlining multiple `<*Sprite>` components in one HTML document
  never produces conflicting `<symbol id>` values.
- **Reason:** SVG symbol ids are document-scoped. Without a prefix, two collections
  with an icon of the same filename would conflict in the DOM.
- **Status:** Accepted (v3).

---

## ADR-017 — Sprite component naming: uniform PascalCase(collectionName) + "Sprite"

- **Decision:** All sprite components follow the uniform formula
  `toPascalCase(collectionName) + 'Sprite'`. No special case for the default
  collection: `default` → `DefaultSprite`, `admin` → `AdminSprite`, etc.
- **Reason:** The spec initially proposed `Sprite` (no prefix) for the default
  collection. During Phase 3 implementation the owner rejected this: preserving `SvgSprite`
  (v2) would require a special-case in the formula, while `DefaultSprite` follows the
  same uniform rule as all named collections, needs no special-casing, and is clear.
  Abandoned `SvgSprite` (would preserve v2 compat but adds a special case);
  abandoned bare `Sprite` (spec original, but owner prefers explicit naming).
- **Constraint:** This IS a breaking change from v2 (`SvgSprite` → `DefaultSprite`).
  Acceptable for v3 major version. Migration guide must document it.
- **Status:** Accepted (v3 Phase 3).

---

## ADR-016 — `SvgUse` component kept; works across all collections via full id

- **Decision:** The `SvgUse` component (v2 name retained) remains in v3. It accepts a
  `name` prop typed as the union of ALL collection types (`DefaultIconName |
  AdminIconName | ...`). Users pass the full symbol id:
  `<SvgUse name="home" />` (default) or `<SvgUse name="admin-star" />` (admin).
  Since symbol ids already encode the collection path, no `collection` prop is needed.
- **Reason:** A single generic component is simpler than per-collection variants. The
  id already encodes the collection, making the `name` prop unambiguous.
- **Status:** Accepted (v3).
