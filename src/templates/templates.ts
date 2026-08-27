import { addTemplate, addComponent } from '@nuxt/kit'
import type { SpriteCollection, IconMeta } from '../types/types'

export interface TemplateHandles {
  /** Per-collection sprite template filenames, keyed by collection name. */
  spriteTemplateNames: Map<string, string>
  /** Filename of the icon-names.d.ts type declaration (for prepare:types). */
  typeTemplateName: string
}

/**
 * Generates the content for icon-names.d.ts:
 *   - One named export per collection: export type {TypeName} = 'id1' | 'id2'
 *   - A combined AllIconName union across all collections
 */
export function buildIconTypesContent(collections: SpriteCollection[]): string {
  const lines: string[] = []
  const typeNames: string[] = []

  for (const col of collections) {
    const ids = col.icons.map(i => JSON.stringify(i.id))
    const typeValue = ids.length > 0 ? ids.join(' | ') : 'never'
    const exampleId = col.icons[0]?.id ?? `${col.name}-icon`
    lines.push(
      `/** Available icon ids in the "${col.name}" collection.\n`
      + ` * @example\n`
      + ` * \`\`\`vue\n`
      + ` * <${col.spriteComponentName} />\n`
      + ` * <svg><use href="#${exampleId}" /></svg>\n`
      + ` * \`\`\`\n`
      + ` */`,
    )
    lines.push(`export type ${col.typeName} = ${typeValue}`)
    typeNames.push(col.typeName)
  }

  const unionValue = typeNames.length > 0 ? typeNames.join(' | ') : 'never'
  lines.push(
    `/** Union of all icon ids across every collection.\n`
    + ` * @example\n`
    + ` * \`\`\`vue\n`
    + ` * <SvgUse name="home" width="24" height="24" />\n`
    + ` * \`\`\`\n`
    + ` */`,
  )
  lines.push(`export type AllIconName = ${unionValue}`)

  return lines.join('\n') + '\n'
}

/**
 * Registers all sprite components, the SvgUse component, the type declaration,
 * and (when createUseComponents) per-icon wrapper components.
 *
 * spriteContents is read via closure on every build/hot-reload; update it in
 * place before calling updateTemplates so getContents picks up new values.
 * getIconTypesContent is called the same way.
 */
export function setupTemplates(
  collections: SpriteCollection[],
  options: { createUseComponents?: boolean },
  spriteContents: Map<string, string>,
  getIconTypesContent: () => string,
): TemplateHandles {
  const spriteTemplateNames = new Map<string, string>()

  // ── Per-collection sprite components ──────────────────────────────────────
  for (const col of collections) {
    const filename = `nuxt-svgo-sprite/${col.spriteComponentName}.vue`
    spriteTemplateNames.set(col.name, filename)

    const tpl = addTemplate({
      filename,
      getContents: () => `<template>${spriteContents.get(col.name) ?? ''}</template>`,
      write: true,
    })
    addComponent({ name: col.spriteComponentName, filePath: tpl.dst })
  }

  // ── Type declaration ───────────────────────────────────────────────────────
  const typeTemplateName = 'nuxt-svgo-sprite/icon-names.d.ts'
  addTemplate({
    filename: typeTemplateName,
    getContents: getIconTypesContent,
    write: true,
  })

  // ── SvgUse generic component ───────────────────────────────────────────────
  const svgUseTpl = addTemplate({
    filename: 'nuxt-svgo-sprite/SvgUse.vue',
    getContents: () => `<template>
  <svg v-bind="$attrs">
    <use :href="\`#\${name}\`" />
  </svg>
</template>

<script setup lang="ts">
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Nuxt resolves this alias in consumer app context.
import type { AllIconName } from '#build/nuxt-svgo-sprite/icon-names'
import { onMounted, watch } from 'vue'

defineOptions({ inheritAttrs: false })

/**
 * @example
 * \`\`\`vue
 * <SvgUse name="home" width="24" height="24" />
 * \`\`\`
 */
const props = defineProps<{ name: AllIconName }>()

// Dev-only: a symbol whose sprite component isn't mounted (yet, or at all — e.g. an
// autoInjectSprite collection list that doesn't include this icon's collection)
// renders an empty <use> with no error anywhere. One console warning turns that into
// a one-line diagnosis instead of a silent blank icon. Stripped from production
// builds via import.meta.dev.
if (import.meta.dev) {
  const checkSymbolMounted = () => {
    if (!document.getElementById(props.name)) {
      console.warn(
        \`[nuxt-svgo-sprite] <SvgUse name="\${props.name}"> — no <symbol id="\${props.name}"> found in the DOM. \`
        + 'Make sure the sprite component that contains it is mounted before this <SvgUse> '
        + '(see "Mount order" in the README), or that its collection is covered by autoInjectSprite.',
      )
    }
  }
  onMounted(checkSymbolMounted)
  watch(() => props.name, checkSymbolMounted)
}
</script>
`,
    write: true,
  })
  addComponent({ name: 'SvgUse', filePath: svgUseTpl.dst })

  // ── Per-icon Use* wrapper components ────────────────────────────────────────
  if (options.createUseComponents) {
    for (const col of collections) {
      for (const icon of col.icons) {
        registerUseComponent(icon)
      }
    }
  }

  return { spriteTemplateNames, typeTemplateName }
}

/**
 * Registers a single Use* wrapper component.
 * Called during setup (via setupTemplates) and by the watcher on 'add' events.
 */
export function registerUseComponent(icon: IconMeta): void {
  const tpl = addTemplate({
    filename: `nuxt-svgo-sprite/icons/${icon.id}.vue`,
    // A newline is required between </template> and <script setup> — vue-tsc parses
    // this file as plain TypeScript when checking the <script> block, and a bare
    // `</template><script...>` on one line produces a `';' expected` syntax error in
    // the consumer's typecheck.
    getContents: () => `<template><svg v-bind="$attrs"><use href="#${icon.id}"/></svg></template>
<script setup lang="ts">defineOptions({inheritAttrs: false})</script>`,
    write: true,
  })
  addComponent({ name: icon.componentName, filePath: tpl.dst })
}
