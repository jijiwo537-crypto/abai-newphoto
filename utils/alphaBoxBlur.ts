// The same two box passes and Uint8Clamped rounding as fastBlur, but only
// the alpha channel used by halation. Reuse both buffers while dragging.
export function blurAlpha(source, output, scratch, w, h, radius) {
  output.set(source);
  if (radius < 1) return output;
  const r = Math.floor(radius), divisor = 2 * r + 1;
  const pass = (src, dst, lines, length, lineStride, stride) => {
    for (let line = 0; line < lines; line++) {
      const start = line * lineStride;
      let sum = (r + 1) * src[start];
      for (let k = 1; k <= r; k++) sum += src[start + Math.min(k, length - 1) * stride];
      // Avoid per-pixel clamps/multiplications for the main scan. Keep the
      // general branch for panoramas whose short side is smaller than radius.
      if (2 * r + 1 < length) {
        let target=start, right=start+(r+1)*stride, left=start;
        const first=src[start],last=src[start+(length-1)*stride];
        for(let x=0;x<=r;x++,target+=stride,right+=stride){dst[target]=sum/divisor;sum+=src[right]-first;}
        for(let x=r+1;x<length-r-1;x++,target+=stride,right+=stride,left+=stride){dst[target]=sum/divisor;sum+=src[right]-src[left+stride];}
        left=start+(length-2*r-1)*stride;
        for(let x=length-r-1;x<length;x++,target+=stride,left+=stride){dst[target]=sum/divisor;sum+=last-src[left];}
      } else {
        for (let x = 0; x < length; x++) {
          dst[start + x * stride] = sum / divisor;
          sum += src[start + Math.min(x + r + 1, length - 1) * stride]
            - src[start + Math.max(x - r, 0) * stride];
        }
      }
    }
  };
  for (let i = 0; i < 2; i++) {
    pass(output, scratch, h, w, w, 1);
    pass(scratch, output, w, h, 1, w);
  }
  return output;
}
