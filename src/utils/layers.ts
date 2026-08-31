import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { getLayerDirectories } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import type { CollectionRoot } from '../builders/collection-builder'

async function dirExists(dir: string): Promise<boolean> {
  try {
    await fsp.access(dir)
    return true
  }
  catch {
    return false
  }
}

/**
 * True when `dir` is NOT inside the app's own srcDir (e.g. `inputDir: '~~/icons'`
 * resolves under rootDir instead). Shared between `resolveLayerInputDirs` (below) and
 * module.ts's `nuxt.options.watch` push (item #4 — Nuxt's default dev watcher only
 * covers each layer's own srcDir tree, so a folder outside it needs to be watched
 * explicitly or HMR silently never fires for it).
 */
export function isOutsideSrcDir(nuxt: Nuxt, dir: string): boolean {
  const relativeToSrcDir = path.relative(nuxt.options.srcDir, dir)
  return relativeToSrcDir.startsWith('..') || path.isAbsolute(relativeToSrcDir)
}

/**
 * Resolves one CollectionRoot per Nuxt layer that has its own copy of the icon
 * folder, in layer-priority order (roots[0] is always the app itself).
 *
 * `inputDir` is resolved once against the app's own srcDir (module.ts, using Nuxt's
 * `~` alias). Nuxt's `~` alias is global — it always points at the APP's srcDir, not
 * a given layer's — so it can't be reused per layer. Instead this re-derives
 * `inputDir`'s path RELATIVE to the app's srcDir and joins that same relative path
 * onto each other layer's own srcDir (getLayerDirectories' `.app`), mirroring how
 * Nuxt itself merges `components/`, `pages/`, etc. across layers by folder
 * convention rather than by re-resolving aliases per layer.
 *
 * When `inputDir` resolves outside the app's srcDir (e.g. an explicit `~~/icons`),
 * that convention doesn't apply — there is nothing meaningful to mirror onto other
 * layers' srcDirs, so only the single already-resolved root is returned.
 *
 * Most layers won't ship any icons at all — that's the normal case, not a
 * misconfiguration — so a layer whose mirrored folder doesn't exist is silently
 * omitted rather than passed through to walkInputDir (which would otherwise warn
 * "Cannot read directory" for every icon-less layer on every build). The app's own
 * root is always included regardless: its existence was already verified by the
 * caller before this function runs.
 */
export async function resolveLayerInputDirs(nuxt: Nuxt, iconDir: string): Promise<CollectionRoot[]> {
  if (isOutsideSrcDir(nuxt, iconDir)) {
    return [{ dir: iconDir, label: '(root)' }]
  }

  const relativeToSrcDir = path.relative(nuxt.options.srcDir, iconDir)
  const layerDirs = getLayerDirectories(nuxt)
  const roots: CollectionRoot[] = []
  const seenDirs = new Set<string>()

  for (const [i, dirs] of layerDirs.entries()) {
    const layerRoot = path.normalize(path.join(dirs.app, relativeToSrcDir))
    if (seenDirs.has(layerRoot)) continue
    seenDirs.add(layerRoot)

    const isAppRoot = i === 0
    if (!isAppRoot && !(await dirExists(layerRoot))) continue

    const label = isAppRoot
      ? '(root)'
      : `layer "${path.basename(dirs.app.replace(/[/\\]+$/, ''))}"`
    roots.push({ dir: layerRoot, label })
  }

  return roots
}
