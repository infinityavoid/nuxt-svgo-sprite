export interface ModuleOptions {
  inputDir: string;
  outputDir: string;
  spriteName: string;
  svgoConfig?: any;
  watch?: boolean; // Добавлено: опция для включения/выключения watch
}

export interface ModuleMeta {
  name: string;
  configKey: string;
  compatibility: {
    nuxt: string;
  };
}