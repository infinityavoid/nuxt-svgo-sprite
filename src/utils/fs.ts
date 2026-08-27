import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { relative, normalize as normalizePath } from 'pathe'
import { glob } from 'tinyglobby'

export interface WalkerEntry {
  /** folder path segments relative to inputDir root */
  segments: string[]
  /** absolute paths to .svg files directly in this collection's folder */
  files: string[]
}

export interface WalkerLogger {
  warn(msg: string): void
}

const IGNORE_DIR_NAMES = ['node_modules', 'dist', 'build', 'coverage', 'test', 'tests']
// Match these dir names at ANY depth, not just directly under inputDir —
// a nested folder named e.g. "test/" was previously excluded only at the top level.
const IGNORE_DIRS = IGNORE_DIR_NAMES.flatMap(d => [`${d}/**`, `**/${d}/**`])

/**
 * Walks inputDir and groups .svg files by their collection (parent folder segments).
 * Returns one WalkerEntry per distinct collection; entries with no files are omitted.
 * Symlinks and node_modules/dist/build/coverage/test dirs are excluded.
 */
export async function walkInputDir(inputDir: string, logger?: WalkerLogger): Promise<WalkerEntry[]> {
  try {
    await fsp.access(inputDir)
  }
  catch (err: unknown) {
    logger?.warn(`Cannot read directory "${inputDir}": ${(err as Error).message}`)
    return []
  }

  const files = (await glob(['**/*.svg'], {
    cwd: inputDir,
    onlyFiles: true,
    absolute: true,
    followSymbolicLinks: false,
    caseSensitiveMatch: false,
    ignore: IGNORE_DIRS,
  })).sort() // deterministic symbol/collection order across platforms and filesystems

  const result = new Map<string, WalkerEntry>()

  const normalizedInputDir = normalizePath(inputDir)

  for (const absPath of files) {
    const rel = relative(normalizedInputDir, absPath) // always forward-slashes via pathe
    const parts = rel.split('/')
    parts.pop() // remove filename

    let segments: string[]
    // Case-insensitive: on case-insensitive filesystems (Windows, default macOS)
    // "default" and "Default" are literally the same directory, and even where
    // they aren't (case-sensitive Linux), treating both as the merge folder avoids
    // a name collision between two folders whose sanitized name is identical.
    if (parts.length > 0 && parts[0]!.toLowerCase() === 'default') {
      // 'default/' at root merges direct files into the default collection;
      // deeper subdirs under 'default/' become named collections (without the 'default' prefix).
      segments = parts.slice(1)
    }
    else {
      segments = parts
    }

    const key = segments.length === 0 ? '\0' : segments.join('\0')

    if (!result.has(key)) {
      result.set(key, { segments: segments.slice(), files: [] })
    }
    // Normalize to platform-native separator so callers can compare against
    // paths obtained from node:path (which uses backslashes on Windows).
    result.get(key)!.files.push(path.normalize(absPath))
  }

  // A named collection's files should all live in exactly one real directory. The
  // default/-prefix-stripping rule above can make two DIFFERENT physical folders
  // (e.g. "nested/" and "default/nested/") key to the same segments — silently
  // merging them here would leave collection-builder.ts's `inputDir` pointing at
  // only one of the two directories, so the watcher/rebuild path can only ever see
  // that one and would silently drop the other's icons on the next rebuild. This
  // check is scoped to named collections only (segments.length > 0) — the actual
  // default collection legitimately spans two directories (inputDir root and its
  // own `default/` subfolder) by design; that merge is handled deliberately by
  // collection-builder.ts's rebuildSingleCollection, not by this generic check.
  for (const entry of result.values()) {
    if (entry.segments.length === 0) continue
    const dirs = new Set(entry.files.map(f => path.dirname(f)))
    if (dirs.size > 1) {
      logger?.warn(
        `Collection "${entry.segments.join('/')}" maps to more than one real folder `
        + `(${[...dirs].join(', ')}) — likely because a "default/" prefix was stripped `
        + `from one of them. Rename one of these folders; only one will be watched reliably.`,
      )
    }
  }

  return Array.from(result.values())
}

/**
 * Reads the .svg files directly inside `dir` (no recursion into subfolders).
 * Used by the HMR rebuild path, which only ever wants one collection's own direct
 * files — walkInputDir's recursive glob plus its `default/`-prefix-stripping rule is
 * only meaningful relative to the true `inputDir` root; reusing it against an
 * arbitrary collection subtree misclassifies a nested folder that happens to be
 * named "default" (see collection-builder.ts's rebuildSingleCollection).
 * Missing directory → empty array, matching walkInputDir's behavior.
 */
export async function readDirectSvgFiles(dir: string, logger?: WalkerLogger): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  }
  catch (err: unknown) {
    logger?.warn(`Cannot read directory "${dir}": ${(err as Error).message}`)
    return []
  }

  return entries
    // isFile() is false for symlinks (readdir with withFileTypes doesn't follow them),
    // matching walkInputDir's followSymbolicLinks: false.
    .filter(e => e.isFile() && /\.svg$/i.test(e.name))
    .map(e => path.normalize(path.join(dir, e.name)))
    .sort()
}
