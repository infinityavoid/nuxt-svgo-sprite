import { resolve } from 'path'
import { existsSync } from 'fs'
import { readFile, mkdir, writeFile, readdir } from 'fs/promises'
import { createResolver, Nuxt } from '@nuxt/kit'
import { optimize } from 'svgo'

export async function generateSvgSprite(options: any, resolver: ReturnType<typeof createResolver>, nuxt: Nuxt) { // Use Nuxt type
  const iconDir = options.iconDir || 'assets/icons' // Get iconDir
  const iconsDir = resolver.resolve(nuxt.options.srcDir, iconDir)
  const spriteDir = resolver.resolve(nuxt.options.buildDir, 'svg-sprite') // Use buildDir
  const spriteFile = resolve(spriteDir, 'icons.svg')

  if (!existsSync(iconsDir)) {
    console.warn(`[nuxt-svgo-sprite] Icon directory not found: ${iconsDir}`)
    return
  }

  const files = await readdir(iconsDir)

  const optimizedSvgs = await Promise.all(
    files
      .filter((file) => file.endsWith('.svg'))
      .map(async (file) => {
        const filePath = resolve(iconsDir, file)
        const svgContent = await readFile(filePath, 'utf8')
        const iconName = file.replace('.svg', '')

        try {
          const optimizedResult = await optimize(svgContent, {
            // Your SVGO config here
            plugins: [
              {
                name: 'preset-default',
                params: {
                  overrides: {
                    removeViewBox: false, // Важно сохранить viewBox!
                  },
                },
              },
            ],
          })

          const viewBoxMatch = optimizedResult.data.match(/viewBox="([^"]*)"/)
          const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24'

          const symbolContent = optimizedResult.data
            .replace(/<\?xml.*?\?>/, '')
            .replace(/<svg.*?>/, '')
            .replace(/<\/svg>/, '')
          return {
            iconName,
            symbolContent,
            viewBox
          }
        } catch (error: any) {
          console.error(`Error optimizing ${file}:`, error)
          return null; // or handle the error in another way
        }
      })
  );

  const symbols = optimizedSvgs.filter(Boolean).map((optimized) => {
    if (!optimized) {
      return '';
    }
    return `
      <symbol id="icon-${optimized.iconName}" viewBox="${optimized.viewBox}">
        ${optimized.symbolContent}
      </symbol>
    `;
  });

  const spriteContent = `
    <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position: absolute; width: 0; height: 0; overflow: hidden;">
      <defs>
        ${symbols.join('\n')}
      </defs>
    </svg>
  `;

  await mkdir(spriteDir, { recursive: true })
  await writeFile(spriteFile, spriteContent)
  console.log('SVG sprite generated successfully!')
}