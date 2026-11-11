import { isNative } from './native';
import { nativePlugin, fileSrc } from './nativeBridge';
import { nativeImage } from './nativeImage';

type PickedItem = { path: string; name: string };
type PickResult = { items?: PickedItem[]; cancelled?: boolean };
type NativePhotosWithFiles = { pickLutFiles(): Promise<PickResult> };
export type LutFileSelection = { count: number; read(index: number): Promise<File> };

/** undefined = no native picker (web fallback); null = user cancelled. */
export async function pickCustomLutFiles(): Promise<LutFileSelection | null | undefined> {
  if (!isNative()) return undefined;
  const plugin = await nativePlugin<NativePhotosWithFiles>('NativePhotos');
  if (!plugin) return undefined;
  const picked = await plugin.pickLutFiles();
  if (picked.cancelled || !picked.items?.length) return null;
  return {
    count: picked.items.length,
    async read(index) {
      const item = picked.items![index];
      try {
        const response = await fetch(fileSrc(item.path));
        if (!response.ok) throw new Error(`無法讀取 ${item.name}`);
        const blob = await response.blob();
        return new File([blob], item.name || 'filter.cube', { type: blob.type, lastModified: Date.now() });
      } finally {
        // 原生暫存拷貝已讀取（或失敗）；逐筆清掉，不讓批量選檔累積磁碟占用。
        void nativeImage().then(p => p?.remove({ path: item.path })).catch(() => {});
      }
    },
  };
}
