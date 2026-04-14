<template>
  <!-- SvgSprite must be rendered once (e.g. in a layout or app root).
       It is hidden from view but inlines the symbol definitions into the DOM,
       which makes them available to every <SvgUse> on the page – including
       during SSR, so there is no layout shift or flash of missing icons. -->
  <SvgSprite />

  <main style="font-family:sans-serif;padding:2rem">
    <h1>nuxt-svgo-sprite playground</h1>

    <section>
      <h2>Universal &lt;SvgUse&gt; component</h2>
      <p>Pass the icon name and any SVG attribute you need.</p>
      <div style="display:flex;gap:1rem;align-items:center">
        <SvgUse
          name="arrow-right"
          width="32"
          height="32"
          stroke="royalblue"
        />
        <SvgUse
          name="star"
          width="32"
          height="32"
          stroke="gold"
          fill="gold"
        />
        <SvgUse
          name="home"
          width="32"
          height="32"
          stroke="tomato"
        />
        <SvgUse
          name="check"
          width="32"
          height="32"
          stroke="seagreen"
        />
      </div>
    </section>

    <section style="margin-top:2rem">
      <h2>Per-icon wrapper components (createUseComponents: true)</h2>
      <p>Each SVG file gets its own auto-imported component with the chosen prefix.</p>
      <div style="display:flex;gap:1rem;align-items:center">
        <IconArrowRight
          width="32"
          height="32"
          stroke="royalblue"
        />
        <IconStar
          width="32"
          height="32"
          stroke="gold"
          fill="gold"
        />
        <IconHome
          width="32"
          height="32"
          stroke="tomato"
        />
        <IconCheck
          width="32"
          height="32"
          stroke="seagreen"
        />
      </div>
    </section>
  </main>
</template>
