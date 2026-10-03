/** UI range only: persisted/rendered texture dimensions stay in their original units. */
export const classicTextureSizeFromUi = (value: number) => 15 + Math.max(0, Math.min(100, value)) * 1.15;
export const classicTextureSizeToUi = (value: number) => Math.round(Math.max(0, Math.min(100, (value - 15) / 1.15)));
