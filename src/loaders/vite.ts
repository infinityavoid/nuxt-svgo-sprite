// modules/nuxt-svgo-sprite/svg-sprite-loader.ts

import {readFile} from 'node:fs/promises';
import {basename, extname} from 'node:path';
import {Config, optimize as optimizeSvg} from 'svgo';

export interface SvgSpriteLoaderOptions {
    svgo?: boolean;
    svgoConfig?: Config;
    spriteName?: string;
}

export async function svgSpriteLoader(
    svgFiles: string[],
    options: SvgSpriteLoaderOptions = {}
): Promise<string> {
    const { svgoConfig, svgo = true, spriteName = 'sprite' } = options;
    let symbols = '';

    for (const svgFile of svgFiles) {
        try {
            let svg = await readFile(svgFile, 'utf-8');

            if (svgo) {
                svg = optimizeSvg(svg, {
                    ...svgoConfig,
                    path: svgFile,
                }).data;
            }

            const svgName = basename(svgFile, extname(svgFile));
            const id = `${spriteName}-${svgName}`;
            const viewBoxMatch = svg.match(/viewBox="([^"]*)"/);
            const viewBox = viewBoxMatch ? `viewBox="${viewBoxMatch[1]}"` : '';

            symbols += `<symbol id="${id}"${viewBox}>${svg.replace(/<svg.*?>|<\/svg>/g, '')}</symbol>`;
        } catch (error) {
            console.error(`Error processing ${svgFile}:`, error);
        }
    }

    const svgSprite = `<svg xmlns="http://www.w3.org/2000/svg" style="position: absolute; width: 0; height: 0; overflow: hidden;">${symbols}</svg>`;

    return `
    import { defineComponent } from 'vue';

    export default defineComponent({
      name: 'SvgSprite',
      template: \`${svgSprite}\`
    });
  `;
}