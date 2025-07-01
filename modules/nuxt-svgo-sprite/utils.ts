// modules/nuxt-svgo-sprite/utils.ts
import { basename } from 'path';
import { ModuleOptions } from './types';

interface OptimizedSvgs {
  [key: string]: string;
}

export function createSvgSprite(optimizedSvgs: OptimizedSvgs, options: ModuleOptions): string {
  let spriteContent = `<svg xmlns="http://www.w3.org/2000/svg" style="position: absolute; width: 0; height: 0; overflow: hidden;">`;

  for (const filePath in optimizedSvgs) {
    if (optimizedSvgs.hasOwnProperty(filePath)) {
      const svgContent = optimizedSvgs[filePath];
      const fileName = basename(filePath, '.svg');
      const id = `${options.spriteName}-${fileName}`;
      const viewBoxMatch = svgContent.match(/viewBox="([^"]*)"/);
      const viewBox = viewBoxMatch ? `viewBox="${viewBoxMatch[1]}"` : '';
      spriteContent += `<symbol id="${id}"${viewBox}>${svgContent.replace(/<svg.*?>|<\/svg>/g, '')}</symbol>`; // Правильно
    }
  }

  spriteContent += '</svg>';
  return spriteContent;
}