// Exchange media, not layer identities/transforms. No image decoder may receive
// a video URL, and no asynchronous decode may overwrite a newer edit.
export function swapFloatingMedia(items, fromId, toId) {
  const a = items.find(item => item.id === fromId);
  const b = items.find(item => item.id === toId);
  if (!a || !b || a === b || a.shape || b.shape || a.text !== undefined || b.text !== undefined) return items;
  const replace = (frame, media) => {
    const longest = Math.max(frame.width, frame.height);
    const aspect = media.width / Math.max(1, media.height);
    return { ...frame, src: media.src, isVideo: !!media.isVideo,
      poster: media.poster, origSrc: media.origSrc, geo: media.geo,
      width: aspect >= 1 ? longest : longest * aspect,
      height: aspect >= 1 ? longest / aspect : longest };
  };
  return items.map(item => item === a ? replace(a, b) : item === b ? replace(b, a) : item);
}
