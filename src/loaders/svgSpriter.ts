import { readFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import SVGSpriter, { Config } from 'svg-sprite';

export interface SvgSpriteLoaderOptions {
    inputDir: string;
    spriteOutputPath: string;
    spriteConfig?: Config;
}

export async function svgSpriteLoader(options: SvgSpriteLoaderOptions) {
    const { inputDir, spriteOutputPath, spriteConfig } = options;
    const inputDirPath = path.resolve(process.cwd(), options.inputDir);
    const outputDirPath = path.dirname(path.resolve(process.cwd(), spriteOutputPath));
    const absoluteSpriteOutputPath = path.resolve(process.cwd(), spriteOutputPath);

    try {
        await fs.promises.access(inputDirPath);
    } catch (e) {
        console.warn(`[nuxt-svgo-sprite] Input directory "${inputDir}" does not exist. Skipping sprite generation.`);
        return '';
    }

    try {
        await fs.promises.access(outputDirPath);
    } catch (e) {
        console.log(`[nuxt-svgo-sprite] Output directory "${outputDirPath}" does not exist, creating...`);
        await fs.promises.mkdir(outputDirPath, { recursive: true });
    }

    const files = await fs.promises.readdir(inputDirPath);

    const spriterInstance = new SVGSpriter(spriteConfig);

    for (const file of files) {
        if (file.endsWith('.svg')) {
            const filePath = path.join(inputDirPath, file);
            const content = await readFile(filePath, 'utf-8');
            spriterInstance.add(filePath, null, content); // Используем экземпляр
        }
    }

    try {
        const { result } = await spriterInstance.compileAsync(); // Используем экземпляр
        let spriteContent = '';
        for (const mode in result) {
            for (const resource in result[mode]) {
                spriteContent = result[mode][resource].contents.toString();
            }
        }

        await fs.promises.writeFile(absoluteSpriteOutputPath, spriteContent);
        console.log(`[nuxt-svg-sprite] Sprite saved to ${absoluteSpriteOutputPath}`);
        return spriteContent;
    } catch (err) {
        console.error('[nuxt-svg-sprite] Error compiling sprite:', err);
        return '';
    }
}