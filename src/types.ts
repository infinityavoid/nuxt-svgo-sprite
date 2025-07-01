export interface ModuleOptionsType {
  inputDir: string;
  spriteName: string;
  svgoConfig?: any;
  watch?: boolean; // Добавлено: опция для включения/выключения watch
}