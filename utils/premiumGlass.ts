/** 浮動選單共用的材質；裡面的控制項維持不透明 */
export const PREMIUM_GLASS = {
  background: 'rgba(10,10,12,.94)',
  backdropFilter: 'blur(28px) saturate(110%)',
  WebkitBackdropFilter: 'blur(28px) saturate(110%)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06),0 12px 36px rgba(0,0,0,.35)',
} as const;

/** 儲存按鈕右邊「⋯」叫出來的匯出選項面板：沒有框線、深色毛玻璃（背後的畫面模糊、壓暗，透出一點點顏色） */
export const SAVE_MENU_GLASS = {
  background: 'rgba(0,0,0,.9)',
  backdropFilter: 'blur(30px) saturate(120%) brightness(.35)',
  WebkitBackdropFilter: 'blur(30px) saturate(120%) brightness(.35)',
  boxShadow: '0 16px 44px rgba(0,0,0,.5)',
  border: 'none',
} as const;
/** 匯出選項面板裡沒選中的按鈕：跟底板差不多深，只亮一點點分得出來 */
export const SAVE_MENU_BUTTON = 'bg-white/[0.07] text-white/85';
/** 「是否儲存為草稿」「要繼續上次的編輯嗎？」：真正的毛玻璃（透得出後面、模糊），比儲存選單淺一點、不浮誇 */
export const DIALOG_GLASS = {
  background: 'rgba(16,16,20,.66)',
  backdropFilter: 'blur(28px) saturate(140%)',
  WebkitBackdropFilter: 'blur(28px) saturate(140%)',
  boxShadow: '0 12px 36px rgba(0,0,0,.35)',
  border: 'none',
} as const;
