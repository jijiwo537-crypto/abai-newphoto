// Development-only interaction audit using the actual mounted controls and encoders.
export async function auditMatchPanel() {
  const blobs: Blob[] = [];
  const original = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => { if (blob instanceof Blob) blobs.push(blob); return original(blob); };
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const waitFor = async (test: () => boolean) => {
    const deadline = performance.now() + 15000;
    while (!test()) { if (performance.now() > deadline) throw new Error('Match audit timeout'); await frame(); }
  };
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
  await waitFor(() => !!button('儲存') && !button('儲存').disabled);
  const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
  const geometry = {
    importBottom: box('[data-cm-pickref]').bottom,
    methodTop: box('[aria-label="仿色方法"]').top,
    methodBottom: box('[aria-label="仿色方法"]').bottom,
    sliderTop: box('[data-cm-slider]').top,
    saveHeight: box('header .rounded-full').height,
  };
  if (!(geometry.importBottom < geometry.methodTop && geometry.methodBottom < geometry.sliderTop && geometry.saveHeight === 32)) throw new Error('Match panel geometry failed');
  const exports: unknown[] = [];
  for (const format of ['JPG','PNG']) {
    document.querySelector<HTMLButtonElement>('[aria-label="匯出選項"]')!.click();
    await waitFor(() => !!button(format));
    button(format).click();
    await frame();
    const before = blobs.length;
    button('儲存').click();
    await waitFor(() => !!document.querySelector('img[alt="仿色結果"]') && ![...document.querySelectorAll('p')].some(p => p.textContent === '儲存中'));
    const mime = format === 'JPG' ? 'image/jpeg' : 'image/png';
    const blob = blobs.slice(before).find(b => b.type === mime);
    if (!blob) throw new Error(`Missing actual ${format} encoding`);
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width !== 1200 || bitmap.height !== 1600) throw new Error('Export resolution changed');
    exports.push({format,mime:blob.type,width:bitmap.width,height:bitmap.height});
    bitmap.close();
    button('繼續調整').click();
    await frame();
  }
  URL.createObjectURL = original;
  const report = {kind:'match-panel',passed:true,ua:navigator.userAgent,standalone:(navigator as any).standalone === true,geometry,exports};
  (window as any).__matchPanelAudit = report;
  await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
}
