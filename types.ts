
export interface CameraSettings {
  kelvin: number;
  focalLength: string;
  exposure: string;
}

/** 使用者離開編輯工具時對目前工作的處理方式。 */
export type ExitChoice = 'save' | 'discard' | 'cancel';
