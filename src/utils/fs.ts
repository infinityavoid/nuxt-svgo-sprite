import { promises as fsp } from 'node:fs'
import path from 'node:path'

export interface WalkerEntry {
  /** folder path segments relative to inputDir root */
  segments: string[]
  /** absolute paths to .svg files directly in this collection's folder */
  files: string[]
}

async function walk(
  dir: string,
  segments: string[],
  result: Map<string, WalkerEntry>,
): Promise<void> {
  let entries: Awaited<ReturnType<typeof fsp.readdir>>
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  }
  catch {
    return
  }

  // Use null-byte separator to avoid collisions with folder names
  const key = segments.length === 0 ? '\0' : segments.join('\0')

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue

    const fullPath = path.join(dir, entry.name)

    if (entry.isFile() && entry.name.endsWith('.svg')) {
      if (!result.has(key)) {
        result.set(key, { segments: segments.slice(), files: [] })
      }
      result.get(key)!.files.push(fullPath)
    }
    else if (entry.isDirectory()) {
      // "default/" at the root level merges its direct SVGs into the default collection
      if (segments.length === 0 && entry.name === 'default') {
        await walk(fullPath, [], result)
      }
      else {
        await walk(fullPath, [...segments, entry.name], result)
      }
    }
  }
}

/**
 * Walks inputDir and groups .svg files by their collection (parent folder segments).
 * Returns one WalkerEntry per distinct collection; entries with no files are omitted.
 */
export async function walkInputDir(inputDir: string): Promise<WalkerEntry[]> {
  const result = new Map<string, WalkerEntry>()
  await walk(inputDir, [], result)
  return Array.from(result.values())
}
