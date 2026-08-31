import { promises as fsp } from 'node:fs'
import { glob } from 'tinyglobby'
import type { IconMeta, SpriteCollection } from '../types/types'

export interface UsageScanLogger {
  info(msg: string): void
}

const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.output/**',
  '**/coverage/**',
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Scans `srcDir` for literal usages of known icons — as a quoted id string
 * (`<SvgUse name="home">`, `name: 'home'`) or as a bare componentName identifier/tag
 * (`<UseHome />`, `resolveComponent('UseHome')`) — and returns the set of icon ids
 * found. Production-build-only (module.ts gates this on `!nuxt.options.dev`);
 * literal-only detection is a known, documented limitation shared with `@nuxt/icon`'s
 * `clientBundle.scan` and `unplugin-svg-component`'s `treeShaking` precedent — a
 * dynamically-computed name (`:name="someVar"`) is invisible to a text scan by
 * construction. Deliberately errs toward false positives (an unused icon kept costs a
 * few bytes; a used icon dropped silently breaks a render): a match anywhere in a
 * scanned file counts, with no attempt to verify it's inside an actual icon-referencing
 * expression. `treeShakingInclude` (module.ts) is the explicit escape hatch for what
 * this can't see.
 *
 * excludeDirs (e.g. Nuxt's own buildDir) are skipped entirely — critical for the
 * module's own generated `use-components.ts`, which legitimately references every
 * icon's componentName as an export declaration and would otherwise make every icon
 * look "used" unconditionally, defeating tree-shaking outright.
 */
export async function scanUsedIconIds(
  srcDir: string,
  collections: SpriteCollection[],
  extensions: string[],
  excludeDirs: string[],
  logger?: UsageScanLogger,
): Promise<Set<string>> {
  const allIcons: IconMeta[] = collections.flatMap(c => c.icons)
  if (allIcons.length === 0) return new Set()

  const componentNameToId = new Map(allIcons.map(i => [i.componentName, i.id]))
  const idAlternation = allIcons.map(i => escapeRegExp(i.id)).join('|')
  const componentAlternation = allIcons.map(i => escapeRegExp(i.componentName)).join('|')
  const idRegex = new RegExp(`["'\`](${idAlternation})["'\`]`, 'g')
  const componentRegex = new RegExp(`\\b(${componentAlternation})\\b`, 'g')

  const normalizedExcludeDirs = excludeDirs.map(d => (d.endsWith('/') ? d : `${d}/`))

  const files = (await glob(
    extensions.map(ext => `**/*${ext.startsWith('.') ? ext : `.${ext}`}`),
    {
      cwd: srcDir,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: IGNORE_GLOBS,
    },
  )).filter(f => !normalizedExcludeDirs.some(dir => f.startsWith(dir)))

  const used = new Set<string>()
  await Promise.all(files.map(async (file) => {
    let content: string
    try {
      content = await fsp.readFile(file, 'utf-8')
    }
    catch {
      return
    }
    for (const match of content.matchAll(idRegex)) used.add(match[1]!)
    for (const match of content.matchAll(componentRegex)) {
      const id = componentNameToId.get(match[1]!)
      if (id) used.add(id)
    }
  }))

  logger?.info(
    `Tree-shaking: ${used.size}/${allIcons.length} icon(s) detected as used across `
    + `${files.length} source file${files.length !== 1 ? 's' : ''}.`,
  )

  return used
}
