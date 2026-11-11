import { isNative } from './native';
import { nativePlugin, fileSrc } from './nativeBridge';

type PickResult = { path?: string; name?: string; cancelled?: boolean };
type NativePhotosWithFiles = { pickLutFile(): Promise<PickResult> };

/** undefined = no native picker (web fallback); null = user cancelled. */
export async function pickCustomLutFile(): Promise<File | null | undefined> {
  if (!isNative()) return undefined;
  const plugin = await nativePlugin<NativePhotosWithFiles>('NativePhotos');
  if (!plugin) return undefined;
  const picked = await plugin.pickLutFile();
  if (picked.cancelled || !picked.path) return null;
  const response = await fetch(fileSrc(picked.path));
  if (!response.ok) throw new Error('無法讀取選取的濾鏡檔');
  const blob = await response.blob();
  return new File([blob], picked.name || 'filter.cube', { type: blob.type, lastModified: Date.now() });
}
