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

  const files = await glob(['**/*.svg'], {
    cwd: inputDir,
    onlyFiles: true,
    absolute: true,
    followSymbolicLinks: false,
    caseSensitiveMatch: false,
    ignore: IGNORE_DIRS,
  })

  const result = new Map<string, WalkerEntry>()

  const normalizedInputDir = normalizePath(inputDir)

  for (const absPath of files) {
    const rel = relative(normalizedInputDir, absPath) // always forward-slashes via pathe
    const parts = rel.split('/')
    parts.pop() // remove filename

    let segments: string[]
    if (parts.length > 0 && parts[0] === 'default') {
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

  return Array.from(result.values())
}
