import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll } from 'vitest'
import { useTestContext } from '@nuxt/test-utils/e2e'

/**
 * On Windows, @nuxt/test-utils' dev-mode `setup({ dev: true })` spawns `nuxi
 * _dev` through `tinyexec`, which on Windows resolves the `nuxi` binary to
 * `node_modules/.bin/nuxi.cmd` — not a `.exe` — and therefore has to route the spawn
 * through `cmd.exe /d /s /c "nuxi.cmd _dev"`. @nuxt/test-utils' own teardown
 * (`stopServer`) calls `proc.kill()`, which on Windows only terminates that `cmd.exe`
 * wrapper; the actual `node …/nuxi.mjs _dev` grandchild is not in a job object and
 * is never killed, orphaning a live dev server (still watching files, still holding
 * the fixture's `.nuxt` open) after every dev-mode test file. A second `npm test`
 * run then fails outright in an agent environment specifically (`std-env`'s
 * `isAgent` turns on Nuxt CLI's dev-server lock, which a live orphaned process trips
 * — see `vitest.config.ts`'s `NUXT_IGNORE_LOCK` for that other half); on a plain
 * developer machine or in CI, the same orphans instead leak silently, accumulating.
 *
 * Call this once, immediately after `await setup({ dev: true, ... })`, in every
 * dev-mode e2e suite. It force-kills the WHOLE process tree (`taskkill /T`, not just
 * the immediate child) rooted at the server process's pid before @nuxt/test-utils'
 * own `afterAll`→`stopServer()` runs — vitest's default hook order (`stack`) means a
 * `beforeAll`/`afterAll` registered AFTER `setup()`'s own runs after it on the way in
 * and before it on the way out, so `serverProcess` is guaranteed to exist here and
 * the tree is already gone by the time `stopServer()` tries (harmlessly no-ops
 * against an already-dead process).
 *
 * No-op on non-Windows platforms: without the `cmd.exe` wrapper, `proc.kill()`
 * already reaches the real process directly.
 *
 * Everything here is wrapped defensively — a missing pid, an already-exited
 * process, or `taskkill` itself failing must never fail an otherwise-green test
 * suite; this is best-effort cleanup, not a correctness requirement.
 */
export function cleanupDevServerProcessTree(): void {
  let pid: number | undefined

  beforeAll(() => {
    pid = useTestContext().serverProcess?.pid
  })

  afterAll(() => {
    if (process.platform !== 'win32') return
    if (typeof pid !== 'number') return
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    }
    catch {
      // Best-effort — see the function doc comment.
    }
  })
}
