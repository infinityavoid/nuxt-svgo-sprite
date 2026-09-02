import { promises as fsp } from 'node:fs'
import { glob } from 'tinyglobby'
import { normalize } from 'pathe'
import { toKebabCase } from '../utils/icon-meta'
import type { IconMeta, SpriteCollection } from '../types/types'

export interface UsageScanLogger {
  info(msg: string): void
  warn(msg: string): void
}

const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.output/**',
  '**/coverage/**',
]

// Caps how many files are read concurrently. fsp.readFile resolves its open()
// in the threadpool and returns the fd to JS before queueing the read, so with N
// pending promises up to N fds can be held simultaneously — plausible EMFILE risk
// on a large project's worth of scanned source files with no cap at all. A small,
// local, dependency-free batcher (no p-limit/similar dependency exists in this
// codebase for a single use site).
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]!
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
const READ_CONCURRENCY = 32

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Scans `roots` for literal usages of known icons — as a quoted id string
 * (`<SvgUse name="home">`, `name: 'home'`), a bare PascalCase componentName
 * identifier/tag (`<UseHome />`, `resolveComponent('UseHome')`), or its kebab-case
 * auto-import tag/quoted-name form (`<use-home />`, `'use-home'` — the exact
 * form Nuxt renders an auto-imported component under, verified against Vue's own
 * `hyphenate`), each optionally prefixed with Nuxt's `Lazy`/`lazy-` — and returns
 * the set of icon ids found. Production-build-only (module.ts gates this on
 * `!nuxt.options.dev`);
 * literal-only detection is a known, documented limitation shared with `@nuxt/icon`'s
 * `clientBundle.scan` and `unplugin-svg-component`'s `treeShaking` precedent — a
 * dynamically-computed name (`:name="someVar"`) is invisible to a text scan by
 * construction. Deliberately errs toward false positives (an unused icon kept costs a
 * few bytes; a used icon dropped silently breaks a render): a match anywhere in a
 * scanned file counts, with no attempt to verify it's inside an actual icon-referencing
 * expression. `treeShakingInclude` (module.ts) is the explicit escape hatch for what
 * this can't see.
 *
 * `roots` is one or more directories to scan (module.ts passes `resolveScanRoots()` —
 * the app's srcDir plus every Nuxt layer's own app/shared/server dirs; a single
 * string is accepted for the (still-exercised-by-tests) single-root case).
 * Files found under more than one root (a nested/overlapping pair) are only read once.
 *
 * excludeDirs (e.g. Nuxt's own buildDir) are skipped entirely — critical for the
 * module's own generated `use-components.ts`, which legitimately references every
 * icon's componentName as an export declaration and would otherwise make every icon
 * look "used" unconditionally, defeating tree-shaking outright. Both sides of that
 * comparison are normalized with `pathe` first — tinyglobby always returns
 * forward-slash absolute paths, but a caller-supplied excludeDirs entry (e.g.
 * `nuxt.options.buildDir`) is not guaranteed to be, and a raw `startsWith` would
 * silently never match on Windows otherwise.
 */
export async function scanUsedIconIds(
  roots: string | string[],
  collections: SpriteCollection[],
  extensions: string[],
  excludeDirs: string[],
  logger?: UsageScanLogger,
): Promise<Set<string>> {
  const allIcons: IconMeta[] = collections.flatMap(c => c.icons)
  if (allIcons.length === 0) return new Set()

  const rootList = Array.isArray(roots) ? roots : [roots]

  const componentNameToId = new Map(allIcons.map(i => [i.componentName, i.id]))
  const idAlternation = allIcons.map(i => escapeRegExp(i.id)).join('|')
  const componentAlternation = allIcons.map(i => escapeRegExp(i.componentName)).join('|')
  const idRegex = new RegExp(`["'\`](${idAlternation})["'\`]`, 'g')
  // (?:Lazy)? — Nuxt auto-imports a lazy-hydration variant of every component under
  // the same name prefixed with "Lazy", equally invisible to a scan that only
  // looked for the bare PascalCase form.
  const componentRegex = new RegExp(`\\b(?:Lazy)?(${componentAlternation})\\b`, 'g')

  // Kebab-case auto-import tag/quoted-name form (<use-home />, 'use-home') —
  // the exact form Nuxt renders a PascalCase component under, per Vue's own
  // `hyphenate` (toKebabCase). A SEPARATE map/regex, not folded into
  // componentNameToId/componentRegex above: kebab strings are a different key space
  // from the PascalCase dictionary keys (merging risks one key silently overwriting
  // another), and `\b…\b` is the wrong anchor for a kebab string — unlike
  // "UseHome", "use-home" is not a valid JS identifier, so \b's word-boundary
  // semantics don't reliably bracket it the same way. Every legitimate reference is
  // either a tag (<use-home, </use-home>) or a quoted string (resolveComponent
  // ('use-home'), :is="'use-home'", components: { 'use-home': ... }) — anchored to
  // one of those delimiters instead, which loses no real usage (this scanner's
  // stated policy is to never miss a real one) while explicitly NOT matching a bare
  // kebab word in prose/comments/CSS class names/URL slugs, which a bare `\b…\b`
  // would have. The trailing (?![-\w]) (not \b) additionally stops "use-home"
  // matching inside "use-home-alt"/"use-homepage". (?:lazy-)? mirrors the PascalCase
  // Lazy-prefix handling above, for Nuxt's lazy-hydration kebab tag form.
  const kebabNameToIds = new Map<string, string[]>()
  for (const icon of allIcons) {
    const kebab = toKebabCase(icon.componentName)
    if (!kebab) continue
    const existing = kebabNameToIds.get(kebab)
    if (existing) existing.push(icon.id)
    else kebabNameToIds.set(kebab, [icon.id])
  }
  const kebabAlternation = [...kebabNameToIds.keys()].map(escapeRegExp).join('|')
  // Guarded: an empty alternation would produce `(?:...)()`, matching every
  // position in every file — kebabNameToIds can only be empty here if allIcons
  // were empty too, which already short-circuited above, but guard explicitly
  // rather than rely on that invariant silently holding.
  const kebabRegex = kebabAlternation
    ? new RegExp(`(?:<\\/?|["'\`])(?:lazy-)?(${kebabAlternation})(?![-\\w])`, 'g')
    : undefined

  const normalizedExcludeDirs = excludeDirs.map((d) => {
    const n = normalize(d)
    return n.endsWith('/') ? n : `${n}/`
  })

  const patterns = extensions.map(ext => `**/*${ext.startsWith('.') ? ext : `.${ext}`}`)
  const filesPerRoot = await Promise.all(rootList.map(root => glob(patterns, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: IGNORE_GLOBS,
  })))

  const files = [...new Set(filesPerRoot.flat())]
    .filter(f => !normalizedExcludeDirs.some(dir => normalize(f).startsWith(dir)))

  const used = new Set<string>()
  // A read failure (permissions, a symlink race, a file deleted between glob and
  // read, ENAMETOOLONG) would otherwise leave every icon referenced only in that
  // file looking "unused" with zero diagnostic. Collected here (not warned
  // per-file) and reported ONCE, aggregated, below — a single unreadable directory
  // tree must not produce a warning storm.
  const failures: { file: string, err: unknown }[] = []
  await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
    let content: string
    try {
      content = await fsp.readFile(file, 'utf-8')
    }
    catch (err) {
      failures.push({ file, err })
      return
    }
    for (const match of content.matchAll(idRegex)) used.add(match[1]!)
    for (const match of content.matchAll(componentRegex)) {
      const id = componentNameToId.get(match[1]!)
      if (id) used.add(id)
    }
    if (kebabRegex) {
      for (const match of content.matchAll(kebabRegex)) {
        for (const id of kebabNameToIds.get(match[1]!) ?? []) used.add(id)
      }
    }
  })

  const readableCount = files.length - failures.length
  if (failures.length > 0) {
    logger?.warn(
      `Tree-shaking: ${failures.length} source file(s) could not be read and were NOT scanned — `
      + `any icon referenced only in them will be dropped from the sprite. `
      + `Add those icon ids to \`treeShakingInclude\` if an icon goes missing:\n`
      + failures.slice(0, 5).map(f => `  - ${f.file}: ${String(f.err)}`).join('\n')
      + (failures.length > 5 ? `\n  …and ${failures.length - 5} more` : ''),
    )
  }

  logger?.info(
    `Tree-shaking: ${used.size}/${allIcons.length} icon(s) detected as used across `
    + `${readableCount} source file${readableCount !== 1 ? 's' : ''} in `
    + `${rootList.length} root${rootList.length !== 1 ? 's' : ''}.`,
  )

  return used
}
