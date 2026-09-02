import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { addTemplate, addTypeTemplate, addComponent, addComponentExports, useNuxt } from '@nuxt/kit'
import type { SpriteCollection } from '../types/types'

export interface TemplateHandles {
  /** Per-collection sprite template filenames, keyed by collection name. */
  spriteTemplateNames: Map<string, string>
  /** Filename of the icon-names.d.ts type declaration (for prepare:types). */
  typeTemplateName: string
  /**
   * Absolute path to the Use* components file — rebuild.ts rewrites this on every
   * rebuild when createUseComponents is on. Undefined when createUseComponents is
   * off (nothing to rewrite).
   */
  useComponentsFilePath?: string
}

/**
 * Generates the content of the single shared Use* components file: one named
 * export per icon, across every collection, consumed via addComponentExports.
 * Every icon's export name is unique by construction — componentName is a
 * deterministic function of the icon id, and ids are already guaranteed globally
 * unique (collection-builder.ts's collision passes run before this).
 */
export function buildUseComponentsFileContent(collections: SpriteCollection[]): string {
  const lines: string[] = ['import { h, defineComponent } from \'vue\'', '']
  for (const col of collections) {
    for (const icon of col.icons) {
      lines.push(
        `export const ${icon.componentName} = /* @__PURE__ */ defineComponent({`,
        `  name: ${JSON.stringify(icon.componentName)},`,
        `  inheritAttrs: false,`,
        `  setup(_props, { attrs }) {`,
        `    return () => h('svg', attrs, [h('use', { href: ${JSON.stringify(`#${icon.id}`)} })])`,
        `  },`,
        `})`,
        '',
      )
    }
  }
  return lines.join('\n')
}

/**
 * Writes the Use* components file synchronously — NOT via addTemplate's own write
 * cycle, deliberately. addComponentExports's first export-name resolution happens as
 * part of the very SAME `generateApp` pass that would otherwise write this file (app:
 * resolve → components:dirs fires BEFORE the template-writing loop that addTemplate
 * relies on) — by then it would already be too late. The file must exist on disk
 * before Nuxt's own dev-server bootstrap even starts its first pass.
 */
export function writeUseComponentsFileSync(filePath: string, collections: SpriteCollection[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, buildUseComponentsFileContent(collections), 'utf-8')
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
  // Read via closure on every components:dirs firing (see the Use* wrapper
  // components section below) — defaults to the static cold-build snapshot for
  // callers that never mutate their collections afterward (e.g. the
  // no-collections-found early-return path in module.ts).
  getCurrentCollections: () => SpriteCollection[] = () => collections,
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
  // addTypeTemplate (not addTemplate) also registers the prepare:types push itself —
  // callers no longer need their own `nuxt.hook('prepare:types', ...)`. It does NOT
  // remove the `@ts-ignore` in SvgUse.vue's `#build/...` import below: that comment
  // is for TS module resolution, while addTypeTemplate's `globalTypeFiles` mechanism
  // (a side effect of this call) is for Vue SFC macro type resolution — different
  // problems.
  const typeTemplateName = 'nuxt-svgo-sprite/icon-names.d.ts'
  addTypeTemplate({
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

  // ── Use* wrapper components ──────────────────────────────────────────────────
  // One shared file with a named export per icon, registered ONCE via
  // addComponentExports rather than one addTemplate+addComponent PER icon. Unlike
  // addComponent, addComponentExports re-reads this file's export names fresh on
  // every components:dirs firing — rewriting the file to drop a deleted icon and
  // calling updateTemplates() with no filter (rebuild.ts) actually unregisters its
  // component: a deleted icon's Use* component doesn't need a dev-server restart to
  // stop being resolvable (Kit itself has no direct removeComponent API).
  let useComponentsFilePath: string | undefined
  if (options.createUseComponents) {
    const nuxt = useNuxt()
    useComponentsFilePath = path.resolve(nuxt.options.buildDir, 'nuxt-svgo-sprite/use-components.ts')

    const rewrite = () => writeUseComponentsFileSync(useComponentsFilePath!, getCurrentCollections())
    rewrite()

    // Defensive, not just an optimization: `nuxi prepare` calls clearBuildDir()
    // AFTER modules' setup() runs but BEFORE the first generateApp pass — wiping the
    // synchronous write above before addComponentExports's OWN components:dirs
    // handler ever gets to read it (verified directly: reproduced against mlly in
    // isolation, then traced to @nuxt/cli's prepare command). Registering OUR OWN
    // components:dirs listener BEFORE calling addComponentExports (hookable fires
    // listeners in registration order) means the file gets rewritten fresh on every
    // firing, including the very first one — regardless of anything that may have
    // deleted it in between. A plain nuxt dev/build run doesn't hit this ordering
    // hazard at all (the file survives from the first, synchronous write), so this
    // is a no-op rewrite of identical content there.
    nuxt.hook('components:dirs', rewrite)

    addComponentExports({ filePath: useComponentsFilePath })
  }

  return { spriteTemplateNames, typeTemplateName, useComponentsFilePath }
}
