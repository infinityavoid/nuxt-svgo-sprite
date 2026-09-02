import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      // F9: this project's dev-mode e2e suites (test/*.test.ts using
      // `setup({ dev: true })`) spawn a real `nuxi _dev` child. Nuxt CLI's own
      // dev-server lock (`@nuxt/cli`'s lockfile check) is turned ON automatically
      // whenever `std-env`'s `isAgent` detects an agent environment (Claude Code,
      // Cursor, Codex, …) — which a plain local `npm test` or CI run never trips,
      // but a coding-agent session running the SAME command does. Without this,
      // a dev-mode suite run from inside an agent session can throw
      // "Server process exited before becoming ready" on any run where a PRIOR
      // run's dev server didn't fully exit yet.
      //
      // This is a belt-and-braces stopgap, not the fix — the actual leak (an
      // orphaned `nuxi _dev` process surviving @nuxt/test-utils' own teardown on
      // Windows, because tinyexec routes the spawn through a `cmd.exe` wrapper that
      // `proc.kill()` doesn't reach through) is closed per-suite by
      // `test/utils/dev-server-cleanup.ts`'s `cleanupDevServerProcessTree()`,
      // called after every dev-mode `setup()`. Setting this alone, without that
      // cleanup, would only hide the symptom in agent environments while leaving
      // the orphan process running everywhere else. Keep both.
      NUXT_IGNORE_LOCK: '1',
    },
  },
})
