import path from 'node:path'
import { getLayerDirectories } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import type { CollectionRoot } from '../builders/collection-builder'
import { dirExists } from './fs'

/**
 * True when `dir` is NOT inside the app's own srcDir (e.g. `inputDir: '~~/icons'`
 * resolves under rootDir instead). Shared between `resolveLayerInputDirs` (below) and
 * module.ts's `nuxt.options.watch` push — Nuxt's default dev watcher only covers
 * each layer's own srcDir tree, so a folder outside it needs to be watched
 * explicitly or HMR silently never fires for it.
 */
export function isOutsideSrcDir(nuxt: Nuxt, dir: string): boolean {
  const relativeToSrcDir = path.relative(nuxt.options.srcDir, dir)
  return relativeToSrcDir.startsWith('..') || path.isAbsolute(relativeToSrcDir)
}

/**
 * The root list `setupWatcher` should treat as "known" — always including the
 * app's own `iconDir`, regardless of whether it exists yet. Deliberately a
 * DIFFERENT list from `layerRoots` (the one passed to `buildCollectionsFromDir`),
 * which stays existence-filtered so a missing `inputDir` doesn't produce a noisy
 * "Cannot read directory" warning on every rescan.
 *
 * Without this: a project that starts with icons ONLY from a layer (`inputDir`
 * doesn't exist yet, so `layerRoots` excludes the app root — collections still
 * build fine from the layer alone) gets a real, actively-running watcher, but one
 * that has never heard of the app's own not-yet-created folder. Creating it later,
 * mid dev-session, then does nothing at all: no rebuild (`findOwningCollection` has
 * no source to match) and no "restart the dev server" warning either (`setupWatcher`'s
 * own outside-known-roots check also only knows about `layerRoots`) — silence, with
 * an actively-watching dev server giving the false impression something WAS being
 * watched. With the app root always present here, that same case correctly falls
 * through to the existing "SVG changed outside known collections — restart"
 * warning instead — the same signal a genuinely new collection folder already gets.
 */
export function resolveWatcherRoots(
  iconDir: string,
  iconDirExists: boolean,
  layerRoots: CollectionRoot[],
): CollectionRoot[] {
  if (iconDirExists) return layerRoots
  return [{ dir: iconDir, label: '(root)' }, ...layerRoots]
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
 * root is included by default — pass `appRootExists: false` when the caller has
 * already determined `iconDir` itself doesn't exist yet (a fresh install that hasn't
 * created its icon folder), so a layer's icons aren't silently discarded just because
 * the app's own folder is missing.
 */
export async function resolveLayerInputDirs(
  nuxt: Nuxt,
  iconDir: string,
  appRootExists = true,
): Promise<CollectionRoot[]> {
  if (isOutsideSrcDir(nuxt, iconDir)) {
    return appRootExists ? [{ dir: iconDir, label: '(root)' }] : []
  }

  const relativeToSrcDir = path.relative(nuxt.options.srcDir, iconDir)
  const layerDirs = getLayerDirectories(nuxt)
  const roots: CollectionRoot[] = []
  const seenDirs = new Set<string>()

  for (const [i, dirs] of layerDirs.entries()) {
    const isAppRoot = i === 0
    if (isAppRoot && !appRootExists) continue

    const layerRoot = path.normalize(path.join(dirs.app, relativeToSrcDir))
    if (seenDirs.has(layerRoot)) continue
    seenDirs.add(layerRoot)

    if (!isAppRoot && !(await dirExists(layerRoot))) continue

    const label = isAppRoot
      ? '(root)'
      : `layer "${path.basename(dirs.app.replace(/[/\\]+$/, ''))}"`
    roots.push({ dir: layerRoot, label })
  }

  return roots
}

/**
 * True when `child` is `parent` itself, or nested inside it.
 */
function isSameOrContainedIn(parent: string, child: string): boolean {
  if (parent === child) return true
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Source roots for the tree-shaking usage scan: every Nuxt layer's own `app`
 * (srcDir-equivalent), `shared`, and `server` directory, in layer-priority order,
 * deduplicated, with any candidate nested inside an already-kept root dropped.
 *
 * `usage-scanner.ts`'s old single-root scan only ever covered the app's own
 * `srcDir` — a layer that ships icons AND references them only from its own
 * components (or a reference living in `shared/`/`server/`) was invisible to it,
 * silently dropping those icons from the production sprite. `getLayerDirectories`
 * already resolves exactly this per-layer directory set (used elsewhere in this
 * module for icon-folder merging, see `resolveLayerInputDirs` above) — this reuses
 * the same primitive for a different purpose (source-code scan roots, not
 * icon-folder roots), so it is deliberately NOT built on `resolveLayerInputDirs`:
 * that function answers "where is this layer's icon folder", omits layers with no
 * icon folder at all (whose components can still reference the app's icons), and
 * bails to a single root when `inputDir` resolves outside srcDir — none of which
 * apply here.
 *
 * `dirs.app`/`dirs.shared`/`dirs.server` come back trailing-slash and
 * forward-slash (`@nuxt/kit`'s `withTrailingSlash`) regardless of platform — each
 * is stripped and `path.normalize`d before the containment/dedupe pass so Windows
 * comparisons are exact.
 *
 * Not included: `dirs.root` itself (would sweep an entire monorepo/playground),
 * `dirs.modules`/`dirs.public`. A dynamically-named icon this still can't see is
 * exactly what `treeShakingInclude` is for.
 *
 * No filesystem access — a candidate that doesn't exist simply globs to no files.
 */
export function resolveScanRoots(nuxt: Nuxt): string[] {
  const layerDirs = getLayerDirectories(nuxt)
  const candidates = layerDirs.flatMap(dirs => [dirs.app, dirs.shared, dirs.server])

  const roots: string[] = []
  for (const raw of candidates) {
    const dir = path.normalize(raw.replace(/[/\\]+$/, ''))
    if (roots.some(r => isSameOrContainedIn(r, dir))) continue
    roots.push(dir)
  }
  return roots
}
