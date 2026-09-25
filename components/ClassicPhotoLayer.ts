const NS = 'http://www.w3.org/2000/svg';
let nextId = 0;
const edgeSources = new WeakMap<HTMLImageElement, { src: string; urls: string[] }>();
function originalEdgeSources(source: HTMLImageElement) {
  const old = edgeSources.get(source); if (old?.src === source.src) return old.urls;
  const sw = source.naturalWidth, sh = source.naturalHeight;
  const urls = [[0,0,1,sh],[sw-1,0,1,sh],[0,0,sw,1],[0,sh-1,sw,1]].map(([x,y,w,h]) => {
    try {
      const canvas = document.createElement('canvas'); canvas.width=w;canvas.height=h;
      canvas.getContext('2d')!.drawImage(source,x,y,w,h,0,0,w,h);
      const url=canvas.toDataURL('image/png');canvas.width=canvas.height=1;return url;
    } catch { return ''; }
  });
  edgeSources.set(source,{src:source.src,urls});return urls;
}
export type PhotoClip = { x: number; y: number; width: number; height: number } | null;
export type PhotoPaint = { source: HTMLImageElement; width: number; height: number;
  radius: number; pad: number; edgePads?: number[]; edges: boolean[]; clip: PhotoClip; dim: number };

/** A photo keeps its original decoded texture. SVG coordinates, unlike nested
 * HTML layout boxes, retain fractional geometry throughout native zoom. No
 * readback, thumbnail substitution or per-frame photo-sized raster is involved. */
export class ClassicPhotoLayer {
  readonly root = document.createElementNS(NS, 'svg');
  private clipRect = document.createElementNS(NS, 'rect');
  private roundRect = document.createElementNS(NS, 'rect');
  private clipped = document.createElementNS(NS, 'g');
  private content = document.createElementNS(NS, 'g');
  private image = document.createElementNS(NS, 'image');
  private shade = document.createElementNS(NS, 'rect');
  private strips: SVGSVGElement[] = [];
  private images: SVGImageElement[] = [];
  private src = '';
  private clipId = `classic-photo-clip-${++nextId}`;
  private roundId = `classic-photo-round-${nextId}`;
  constructor(host: HTMLElement) {
    this.root.dataset.classicPhoto = '1';
    this.root.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;max-width:none;';
    const defs = document.createElementNS(NS, 'defs');
    for (const [id, rect] of [[this.clipId, this.clipRect], [this.roundId, this.roundRect]] as const) {
      const clip = document.createElementNS(NS, 'clipPath');
      clip.id = id; clip.setAttribute('clipPathUnits', 'userSpaceOnUse'); clip.append(rect); defs.append(clip);
    }
    this.root.append(defs, this.clipped); this.clipped.append(this.content);
    for (let i = 0; i < 4; i++) {
      const strip = document.createElementNS(NS, 'svg'), image = document.createElementNS(NS, 'image');
      strip.setAttribute('preserveAspectRatio', 'none'); strip.setAttribute('overflow', 'hidden');
      strip.append(image); this.strips.push(strip); this.images.push(image); this.content.append(strip);
    }
    this.image.setAttribute('preserveAspectRatio', 'none');
    this.shade.setAttribute('fill', 'black');
    this.content.append(this.image, this.shade); host.append(this.root);
  }
  update(matrix: DOMMatrix, photo: PhotoPaint) {
    const { source, width: w, height: h, radius, pad, edges, clip, dim } = photo;
    const attr = (el: Element, values: Record<string, string | number>) => {
      for (const [name, value] of Object.entries(values)) {
        const text = String(value); if (el.getAttribute(name) !== text) el.setAttribute(name, text);
      }
    };
    // No viewBox rescaling: these are exactly the same logical units as ink and
    // page positions. Keep the viewport extent independent of any one photo.
    const column = this.root.parentElement?.parentElement;
    attr(this.root, { width: parseFloat(column?.style.width || '1'), height: parseFloat(column?.style.height || '1') });
    attr(this.content, { transform: `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})` });
    if (clip) { attr(this.clipRect, clip); attr(this.clipped, { 'clip-path': `url(#${this.clipId})` }); }
    else if (this.clipped.getAttribute('clip-path') !== null) this.clipped.removeAttribute('clip-path');
    attr(this.roundRect, { x: -w / 2, y: -h / 2, width: w, height: h, rx: radius });
    if (radius) attr(this.content, { 'clip-path': `url(#${this.roundId})` });
    else if (this.content.getAttribute('clip-path') !== null) this.content.removeAttribute('clip-path');
    attr(this.image, { x: -w / 2, y: -h / 2, width: w, height: h });
    attr(this.shade, { x: -w / 2, y: -h / 2, width: w, height: h, opacity: dim });
    const sw = source.naturalWidth, sh = source.naturalHeight;
    if (this.src !== source.src) {
      this.src = source.src;
      attr(this.image, { href: this.src });
      const urls = originalEdgeSources(source);
      this.images.forEach((image,i)=>attr(image,{href:urls[i]}));
    }
    const leftPad=photo.edgePads?.[0] ?? pad, rightPad=photo.edgePads?.[1] ?? pad;
    const boxes = [
      [-w / 2 - leftPad, -h / 2, leftPad * 2, h, `0 0 1 ${sh}`],
      [w / 2 - rightPad, -h / 2, rightPad * 2, h, `0 0 1 ${sh}`],
      [-w / 2 - leftPad, -h / 2 - pad, w + leftPad + rightPad, pad * 2, `0 0 ${sw} 1`],
      [-w / 2 - leftPad, h / 2 - pad, w + leftPad + rightPad, pad * 2, `0 0 ${sw} 1`],
    ];
    this.strips.forEach((strip, i) => {
      const display = edges[i] && !radius ? '' : 'none';
      if (strip.style.display !== display) strip.style.display = display;
      const [x,y,width,height,viewBox] = boxes[i]; attr(strip, { x,y,width,height,viewBox });
      attr(this.images[i], { width: i < 2 ? 1 : sw, height: i < 2 ? sh : 1 });
    });
  }
  remove() { this.root.remove(); }
}
