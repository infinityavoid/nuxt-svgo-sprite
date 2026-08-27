<template>
  <!--
    Sprite components inline the SVG symbol definitions into the page.
    Place each one once — typically in app.vue or a shared layout.
    Alternatively, set `autoInjectSprite: true` in nuxt.config.ts
    and remove these components entirely.
  -->
  <DefaultSprite />
  <AdminSprite />

  <main style="font-family: sans-serif; padding: 2rem; max-width: 720px">
    <h1>nuxt-svgo-sprite v3</h1>

    <!-- ── Default collection ──────────────────────────────────────────── -->
    <section style="margin-top: 2rem">
      <h2>Default collection — <code>&lt;SvgUse&gt;</code></h2>
      <p>Root-level SVGs → default collection. Icon id = filename (no prefix).</p>
      <div style="display: flex; gap: 1rem; align-items: center">
        <SvgUse name="home" width="32" height="32" stroke="tomato" />
        <SvgUse name="star" width="32" height="32" stroke="gold" fill="gold" />
        <SvgUse name="arrow-right" width="32" height="32" stroke="royalblue" />
        <SvgUse name="check" width="32" height="32" stroke="seagreen" />
      </div>
    </section>

    <!-- ── Admin collection ────────────────────────────────────────────── -->
    <section style="margin-top: 2rem">
      <h2>Admin collection — <code>&lt;SvgUse&gt;</code></h2>
      <p>
        <code>admin/</code> subfolder → admin collection.
        Icon ids are prefixed: <code>admin-user</code>, <code>admin-shield</code>.
      </p>
      <div style="display: flex; gap: 1rem; align-items: center">
        <SvgUse name="admin-user" width="32" height="32" stroke="mediumpurple" />
        <SvgUse name="admin-shield" width="32" height="32" stroke="steelblue" />
      </div>
    </section>

    <!-- ── Raw icon opt-out ──────────────────────────────────────────── -->
    <section style="margin-top: 2rem">
      <h2>Raw icon (<code>logo.raw.svg</code>)</h2>
      <p>
        Renamed to <code>.raw.svg</code> — SVGO is skipped, original content preserved.
        The id and component name are the same as for a regular <code>.svg</code> file.
      </p>
      <div style="display: flex; gap: 1rem; align-items: center">
        <SvgUse name="logo" width="48" height="48" stroke="tomato" />
        <IconLogo width="48" height="48" stroke="royalblue" />
      </div>
    </section>

    <!-- ── Per-icon wrappers ───────────────────────────────────────────── -->
    <section style="margin-top: 2rem">
      <h2>Per-icon wrapper components (<code>createUseComponents: true</code>)</h2>
      <p>
        With <code>componentPrefix: 'Icon'</code>:
        <code>home.svg</code> → <code>&lt;IconHome /&gt;</code>,
        <code>admin/user.svg</code> → <code>&lt;IconAdminUser /&gt;</code>.
      </p>
      <div style="display: flex; gap: 1rem; align-items: center">
        <IconHome width="32" height="32" stroke="tomato" />
        <IconStar width="32" height="32" stroke="gold" fill="gold" />
        <IconAdminUser width="32" height="32" stroke="mediumpurple" />
        <IconAdminShield width="32" height="32" stroke="steelblue" />
      </div>
    </section>
  </main>
</template>
