import { basename } from 'path';
import { ModuleOptions } from './types';

interface OptimizedSvgs {
  [key: string]: string;
}

export function createSvgSprite(optimizedSvgs: OptimizedSvgs, options: ModuleOptions): string {
  let spriteContent = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="position: absolute; width: 0; height: 0; overflow: hidden;">\n`;

  for (const filePath in optimizedSvgs) {
    if (optimizedSvgs.hasOwnProperty(filePath)) {
      const svgContent = optimizedSvgs[filePath];
      const fileName = basename(filePath, '.svg');
      const id = `${options.spriteName}-${fileName}`;
      spriteContent += `<symbol id="${id}" viewBox="0 0 24 24"> \n${svgContent}</symbol>\n`;
    }
  }

  spriteContent += '</svg>';
  return spriteContent;
}