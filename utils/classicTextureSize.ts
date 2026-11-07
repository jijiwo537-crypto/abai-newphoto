/** 只是介面上的範圍：存檔和繪製的材質尺寸維持原本的單位 */
export const classicTextureSizeFromUi = (value: number) => 15 + Math.max(0, Math.min(100, value)) * 1.15;
export const classicTextureSizeToUi = (value: number) => Math.round(Math.max(0, Math.min(100, (value - 15) / 1.15)));
