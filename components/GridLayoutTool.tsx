import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { ArrowLeft, ChevronLeft, Download, Plus, Trash2, RotateCw, Sliders, SlidersHorizontal, LayoutGrid, Sparkles, MoveUp, MoveDown, Check, RefreshCw, Maximize2, Move, Smartphone, Image as ImageIcon, Crop, Palette, Magnet, Type, Bold, Italic, Copy, GalleryHorizontal, ChevronRight, Heart, MessageCircle, Bookmark, Volume2, VolumeX } from 'lucide-react';
import { Icon } from './Icon';
import { FONTS, FONT_CATEGORIES, FONT_SAMPLE, FontCategory, DEFAULT_FONT, ensureFont, ensureItalic, knownItalic, fontCssLoaded, waitForFont, fontStack } from '../utils/fonts';
import { PhotoFx, ADJUST_KEYS, applyPhotoFx, hasPhotoFx, loadLut, getLoadedLut } from '../utils/photoFx';
import { get2dWide } from '../utils/colorSpace';
import { FX_DEFS, warmFx } from '../utils/glEffects';
import { saveDraft, loadDraft, clearDraft, hasDraft } from '../utils/collageDraft';
import { ComposeStudio } from './ComposeStudio';
import { IgPreview } from './IgPreview';
import { SaveButton } from './SaveButton';
import { DEFAULT_GEO, GeoParams, composeCanvas, isGeoIdentity } from '../utils/compose';

interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageCell {
  id: string;
  url: string;
  file: File;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  naturalWidth?: number;
  naturalHeight?: number;
  /** 濾鏡／調節／特效。跟浮動圖片用同一組資料與同一支算圖 */
  fx?: PhotoFx;
  /** 這一格自己的圓角（%）。有設的話就蓋掉佈局那根共用的圓角滑桿 */
  imgRadius?: number;
}

/** 是不是影片檔（用 MIME 或副檔名判斷都可以） */
const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|ogv|3gp)$/i.test(f.name);

/** 影片的原始尺寸：等 metadata 進來就有 videoWidth / videoHeight */
const getVideoDimensions = (url: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => resolve({
      width: v.videoWidth || 800,
      height: v.videoHeight || 600,
    });
    v.onerror = () => resolve({ width: 800, height: 600 });
    v.src = url;
  });
};

/**
 * 預覽用的影片元素：跟照片一樣一個網址共用一個元素，
 * 這樣重畫、匯出都拿到同一個播放中的影片（不會各自播各自的）。
 */
const previewVideos = new Map<string, HTMLVideoElement>();
export const getPreviewVideo = (src: string) => {
  let v = previewVideos.get(src);
  if (!v) {
    v = document.createElement('video');
    v.src = src;
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    (v as any).disablePictureInPicture = true;
    v.play().catch(() => { /* 使用者還沒互動就先不播 */ });
    previewVideos.set(src, v);
  }
  return v;
};

const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    };
    img.onerror = () => {
      resolve({ width: 800, height: 600 });
    };
    img.src = url;
  });
};

const EMPTY_CELLS: ImageCell[] = [];

/** 佈局最小縮放：再小就很難點得到 */
const MIN_LAYOUT_SCALE = 0.4;

/** 新增佈局時預設佔頁面七分滿 */
const NEW_LAYOUT_SCALE = 0.7;

let layoutSeq = 0;
const makeLayout = (templateIndex: number, count: number, gap = 0, radius = 0) => ({
  id: `layout-${Date.now()}-${layoutSeq++}`,
  templateIndex,
  images: Array.from({ length: count }).map((_, i) => ({
    id: `empty-${Date.now()}-${layoutSeq}-${i}`,
    url: '', file: undefined, zoom: 1.0, offsetX: 0, offsetY: 0, rotation: 0,
  })),
  t: { x: 0, y: 0, scale: NEW_LAYOUT_SCALE },
  z: 0,
  gap,
  radius,
});

const RATIOS = [
  { id: '1:1', name: '1:1' },
  { id: '3:4', name: '3:4' },
  { id: '2:3', name: '2:3' },
  { id: '9:16', name: '9:16' },
  { id: '4:5', name: '4:5' },
];

/* ── 佈局自己的比例 ──────────────────────────────────────────────────
   每個佈局可以有自己的長寬比（跟整頁的「版型比例」是兩回事）。沒設就跟頁面
   一樣，所以舊檔案讀進來畫面完全不變。
   設了就把那個比例「contain」進頁面裡並置中，再乘上佈局自己的縮放。
   預覽、IG 預覽、匯出、拖曳吸附四條路全部呼叫這一支，幾何不可能對不上。 */
const layoutBox = (
  lay: { ratio?: string; landscape?: boolean } | null | undefined,
  pageW: number, pageH: number,
) => {
  const id = lay?.ratio;
  if (!id) return { w: pageW, h: pageH };
  const parts = String(id).split(':').map(Number);
  let rw = parts[0], rh = parts[1];
  if (!(rw > 0 && rh > 0)) return { w: pageW, h: pageH };
  if (lay?.landscape) { const t = rw; rw = rh; rh = t; }
  const fit = Math.min(pageW / rw, pageH / rh);
  return { w: rw * fit, h: rh * fit };
};

const TEMPLATE_MAP: Record<number, { name: string; rects: CellRect[] }[]> = {
  1: [
    {
      name: '滿版',
      rects: [{ x: 0, y: 0, w: 1, h: 1 }]
    }
  ],
  2: [
    {
      name: '上下對分',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 1, h: 0.5 }
      ]
    },
    {
      name: '左右對分',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 1 }
      ]
    },
    {
      name: '黃金左分割',
      rects: [
        { x: 0, y: 0, w: 0.618, h: 1 },
        { x: 0.618, y: 0, w: 0.382, h: 1 }
      ]
    },
    {
      name: '黃金右分割',
      rects: [
        { x: 0, y: 0, w: 0.382, h: 1 },
        { x: 0.382, y: 0, w: 0.618, h: 1 }
      ]
    }
  ],
  3: [
    {
      name: '上大下雙',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '下大上雙',
      rects: [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '左大右雙',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '右大左雙',
      rects: [
        { x: 0.5, y: 0, w: 0.5, h: 1 },
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '三直欄',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 1 },
        { x: 0.3333, y: 0, w: 0.3334, h: 1 },
        { x: 0.6667, y: 0, w: 0.3333, h: 1 }
      ]
    },
    {
      name: '三橫欄',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.3333 },
        { x: 0, y: 0.3333, w: 1, h: 0.3334 },
        { x: 0, y: 0.6667, w: 1, h: 0.3333 }
      ]
    }
  ],
  4: [
    {
      name: '四格棋盤',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '左大右疊',
      rects: [
        { x: 0, y: 0, w: 0.6667, h: 1 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: '右大左疊',
      rects: [
        { x: 0.3333, y: 0, w: 0.6667, h: 1 },
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: '一大三小',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.6667 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: '三小一大',
      rects: [
        { x: 0, y: 0.3333, w: 1, h: 0.6667 },
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 }
      ]
    }
  ],
  5: [
    {
      name: '左二右三',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0.5, y: 0.6667, w: 0.5, h: 0.3333 }
      ]
    },
    {
      name: '左三右二',
      rects: [
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0, y: 0, w: 0.5, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.5, h: 0.3333 }
      ]
    },
    {
      name: '一上四下',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: '一下四上',
      rects: [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: '五橫欄',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.2 },
        { x: 0, y: 0.2, w: 1, h: 0.2 },
        { x: 0, y: 0.4, w: 1, h: 0.2 },
        { x: 0, y: 0.6, w: 1, h: 0.2 },
        { x: 0, y: 0.8, w: 1, h: 0.2 }
      ]
    }
  ],
  6: [
    {
      name: '兩列三欄',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 0.5 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.5 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.5 },
        { x: 0, y: 0.5, w: 0.3333, h: 0.5 },
        { x: 0.3333, y: 0.5, w: 0.3334, h: 0.5 },
        { x: 0.6667, y: 0.5, w: 0.3333, h: 0.5 }
      ]
    },
    {
      name: '三列二欄',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0.5, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0.6667, w: 0.5, h: 0.3333 }
      ]
    },
    {
      name: '一大五小',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.2, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.4, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.6, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.8, y: 0.5, w: 0.2, h: 0.5 }
      ]
    },
    {
      name: '五小一大',
      rects: [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 0.2, h: 0.5 },
        { x: 0.2, y: 0, w: 0.2, h: 0.5 },
        { x: 0.4, y: 0, w: 0.2, h: 0.5 },
        { x: 0.6, y: 0, w: 0.2, h: 0.5 },
        { x: 0.8, y: 0, w: 0.2, h: 0.5 }
      ]
    },
    {
      name: '大角拼貼',
      rects: [
        { x: 0, y: 0, w: 0.6667, h: 0.6667 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    }
  ],
  7: [
    {
      name: '三上四下',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 0.5 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.5 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: '四上三下',
      rects: [
        { x: 0, y: 0, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0, w: 0.25, h: 0.5 },
        { x: 0, y: 0.5, w: 0.3333, h: 0.5 },
        { x: 0.3333, y: 0.5, w: 0.3334, h: 0.5 },
        { x: 0.6667, y: 0.5, w: 0.3333, h: 0.5 }
      ]
    },
    {
      name: '大左六小',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.6667 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.25, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.5, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.75, y: 0.6667, w: 0.25, h: 0.3333 }
      ]
    }
  ],
  8: [
    {
      name: '四直兩列',
      rects: [
        { x: 0, y: 0, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0, w: 0.25, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: '兩大六小',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0, y: 0.75, w: 0.5, h: 0.25 },
        { x: 0.5, y: 0.75, w: 0.5, h: 0.25 }
      ]
    }
  ],
  9: [
    {
      name: '九格棋盤',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0.3333, y: 0.3333, w: 0.3334, h: 0.3334 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: '錯位九宮',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0.3333, y: 0.3333, w: 0.3334, h: 0.3334 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.25, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.5, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.75, y: 0.6667, w: 0.25, h: 0.3333 }
      ]
    }
  ],
  10: [
    {
      name: '2x5 網格',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0, w: 0.5, h: 0.2 },
        { x: 0, y: 0.2, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0.2, w: 0.5, h: 0.2 },
        { x: 0, y: 0.4, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0.4, w: 0.5, h: 0.2 },
        { x: 0, y: 0.6, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0.6, w: 0.5, h: 0.2 },
        { x: 0, y: 0.8, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0.8, w: 0.5, h: 0.2 }
      ]
    },
    {
      name: '5x2 網格',
      rects: [
        { x: 0, y: 0, w: 0.2, h: 0.5 },
        { x: 0.2, y: 0, w: 0.2, h: 0.5 },
        { x: 0.4, y: 0, w: 0.2, h: 0.5 },
        { x: 0.6, y: 0, w: 0.2, h: 0.5 },
        { x: 0.8, y: 0, w: 0.2, h: 0.5 },
        { x: 0, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.2, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.4, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.6, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.8, y: 0.5, w: 0.2, h: 0.5 }
      ]
    },
    {
      name: '3-4-3 交錯',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.25, h: 0.3334 },
        { x: 0.25, y: 0.3333, w: 0.25, h: 0.3334 },
        { x: 0.5, y: 0.3333, w: 0.25, h: 0.3334 },
        { x: 0.75, y: 0.3333, w: 0.25, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    }
  ]
};

// --- HSV and HEX helpers for embedded color picker ---
const hsvToHex = (h: number, s: number, v: number) => {
  s /= 100; v /= 100;
  let f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`.toUpperCase();
};

const hexToHsv = (hex: string) => {
  if (!hex || hex.length < 7) return { h: 0, s: 0, v: 100 };
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, v = max;
  let d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) h = 0;
  else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
};

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  onClose: () => void;
}

/** 文字圖層的編輯面板：內容、字體、顏色、字距、粗體、邊緣發光。 */
/**
 * 文字用的色票：亞洲女生拼貼時最常拿來寫字的顏色。
 * 白與墨黑先打底（照片上最好讀），接著奶油／奶茶這類米色系，
 * 再來三個粉（淺粉、甜粉、莓紅）與焦糖棕，最後薰衣草、霧藍、抹茶、蜜黃各一。
 */
/** 長按多久才算「要拖去交換」。150ms 太容易誤觸，拉長到 250ms。 */
const LONG_PRESS_MS = 250;

const TEXT_COLORS = [
  /* 前兩顆固定是純黑與墨黑：寫字與描邊最常用的就是這兩個，
     擺在最前面才不用每次都往右滑。接著才是白與暖灰那些中性色。 */
  '#000000', '#2B2B2B',
  // 白／暖灰（中性）
  '#FFFFFF', '#EAE6DF',
  // 奶油 → 奶茶（暖色系挨在一起）
  '#FFF7EC', '#E8D3BC',
  // 粉 → 莓紅
  '#FFD6E0', '#F4C2C2', '#FFA8BE', '#D4667E',
  // 黃
  '#FFE49B', '#FFF1A5',
  // 綠 → 薄荷 → 淺青
  '#A9C2A0', '#CBEAD6', '#9BD4C3', '#B8E3D8', '#D2E8E1',
  // 藍 → 紫
  '#A7C4DC', '#C7B5E8',
];

/**
 * 色票最前面那顆「自訂顏色」。外觀跟美顏那顆一致：
 * 彩虹環 ＋ 深色圓心 ＋ 滴管圖標，點下去開系統調色盤。
 */
const CustomColorButton: React.FC<{
  value: string;
  onPick: (c: string) => void;
  size?: number;
}> = ({ value, onPick, size = 32 }) => (
  <label
    title="自訂顏色"
    aria-label="自訂顏色"
    className="rounded-full shrink-0 relative cursor-pointer ring-1 ring-white/40 flex items-center justify-center overflow-hidden active:scale-90 transition-transform"
    style={{
      width: size, height: size,
      background: 'conic-gradient(#f43,#fa3,#fd3,#3d6,#3cf,#63f,#f3a,#f43)',
    }}
  >
    <span className="absolute inset-[5px] rounded-full bg-[#080808] flex items-center justify-center">
      <Icon name="colorize" className="text-[13px] text-white" />
    </span>
    <input
      type="color"
      value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
      onChange={e => onPick(e.target.value.toUpperCase())}
      aria-label="自訂顏色"
      className="absolute inset-0 opacity-0 cursor-pointer"
    />
  </label>
);

/* 「圖片調整」的工具清單：id / 名稱 / Material 圖標 / 範圍 / 預設值，跟「編輯」同一組 */
const TUNE_TOOLS: [string, string, string, number, number, number][] = [
  ['brightness', '亮度', 'light_mode', -100, 100, 0],
  ['exposure', '曝光', 'brightness_6', -100, 100, 0],
  ['contrast', '對比', 'contrast', -100, 100, 0],
  ['highlights', '高光', 'wb_sunny', -100, 100, 0],
  ['shadows', '陰影', 'brightness_low', -100, 100, 0],
  ['temp', '色溫', 'device_thermostat', -100, 100, 0],
  ['tint', '色調', 'colorize', -100, 100, 0],
  ['sat', '飽和度', 'palette', -100, 100, 0],
  ['vib', '自然飽和度', 'color_lens', -100, 100, 0],
];

/* 特效清單跟「編輯」完全一致（順序、名稱、圖標、預設強度都是同一份），
   後面 16 顆直接從 FX_DEFS 長出來，不再自己維護第二份表。
   銳化在編輯那邊是「調節」的最後一顆，拼圖這裡的調節沒有它，所以也不列。 */
const FX_ROOT_TOOLS: [string, string, string][] = [
  ['softLight', '柔光', 'blur_on'],
  ['halation', '光暈', 'flare'],
  ['lightLeak', '漏光', 'leak_add'],
  ['colorNoise', '噪點', 'grain'],
  ['blur', '朦朧', 'blur_linear'],
  ...FX_DEFS.filter(d => d.id !== 'fxSharpen').map(d => [d.id, d.label, d.icon] as [string, string, string]),
];

/** 卡片 → 外層那根「強度」滑桿實際調的參數（柔光／光暈／漏光的強度不是卡片 id 本身） */
const FX_AMOUNT: Record<string, string> = {
  softLight: 'soft', halation: 'fringeIntensity', lightLeak: 'leakOpacity',
};
const fxAmountId = (id: string) => FX_AMOUNT[id] || id;

/** 點下卡片時要套的強度，跟編輯同一組 */
const FX_ON_AMOUNT: Record<string, number> = {
  softLight: 100, halation: 100, lightLeak: 100, colorNoise: 40, blur: 40,
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, d.onAmount ?? 100])),
};

/** 每一顆卡片自己的參數鍵 —— 一次只能套一個，切到別顆時其餘的都要歸零 */
const FX_OWN_KEYS: Record<string, string[]> = {
  softLight: ['soft'], halation: ['fringeIntensity'], lightLeak: ['leakOpacity'],
  colorNoise: ['colorNoise'], blur: ['blur'],
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, [d.id]])),
};
/** 所有特效的強度鍵，歸零時用 */
const FX_ALL_AMOUNTS = ['soft', 'fringeIntensity', 'leakOpacity', 'colorNoise', 'blur', 'vignette',
  ...FX_DEFS.map(d => d.id)];

/** 這一顆卡片的細項滑桿（第一根是強度，hidden 的不出現），跟編輯同一套 */
const FX_DETAIL: Record<string, [string, string, number, number, number][]> = {
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, [
    [d.id, '強度', 0, 100, 0] as [string, string, number, number, number],
    ...d.params.filter(p => !p.hidden).map(p =>
      [p.id, p.label, p.min, p.max, p.def] as [string, string, number, number, number]),
  ]])),
};

const FX_SUB_TOOLS: Record<string, [string, string, string, number, number, number][]> = {
  softLight: [
    ['soft', '強度', 'blur_on', 0, 100, 0],
    ['softThreshold', '範圍', 'tonality', 0, 95, 70],
    ['softRadius', '擴散', 'flare', 20, 100, 100],
    ['softColor', '色相', 'palette', 0, 100, 0],
  ],
  halation: [
    ['fringeIntensity', '強度', 'flare', 0, 100, 0],
    ['fringeSize', '擴散', 'blur_on', 0, 100, 10],
    ['fringeFeather', '範圍', 'tonality', 0, 100, 100],
    ['fringeHue', '色相', 'palette', 0, 360, 8],
  ],
  lightLeak: [
    ['leakOpacity', '強度', 'opacity', 0, 100, 0],
    ['leakAngle', '角度', 'rotate_right', 0, 360, 45],
    ['leakHue', '色相', 'palette', 0, 360, 15],
  ],
};

/** 形狀分頁的工具（拼圖獨有，取代編輯裡的遮色片）。
    描邊與發光跟柔光一樣是兩段式：點進去才有粗細／顏色。 */
const SHAPE_TOOLS: [string, string, string, number, number, number][] = [
  ['imgRadius', '圓角', 'rounded_corner', 0, 50, 0],
  ['feather', '羽化', 'gradient', 0, 50, 0],
  ['stroke', '描邊', 'border_style', 0, 0, 0],
  ['glow', '發光', 'light_mode', 0, 0, 0],
];

/** 描邊／發光點進去之後的子工具：粗細用滑桿、顏色用色票 */
const SHAPE_SUB_TOOLS: Record<string, [string, string, string, number, number, number][]> = {
  stroke: [
    ['imgStrokeWidth', '粗細', 'line_weight', 0, 20, 0],
    ['imgStrokeColor', '顏色', 'palette', 0, 0, 0],
  ],
  glow: [
    ['imgGlow', '強度', 'light_mode', 0, 20, 0],
    ['imgGlowColor', '顏色', 'palette', 0, 0, 0],
  ],
};

const FX_DIRECT_RANGE: Record<string, [number, number]> = {
  blur: [0, 100], colorNoise: [0, 100], vignette: [0, 200],
};

/** 發光專用色票：韓系那種奶油、櫻花粉、奶茶⋯⋯淡色系，第一顆固定是白色 */
const GLOW_COLORS = [
  // 第一顆固定是白
  '#FFFFFF',
  // 暖灰 → 奶油 → 米 → 玫瑰棕
  '#EAE6DF', '#FFF4E6', '#E8D5C4', '#C9A9A6',
  // 粉 → 藕粉 → 珊瑚
  '#FFE0E9', '#FFC2D1', '#F4C2C2', '#FFB3A7',
  // 杏 → 黃（原本的 #FFF1A8 跟指定的 #FFF1A5 肉眼一樣，直接用指定的那個）
  '#FFD8A8', '#FFF1A5',
  // 薄荷 → 淺青
  '#D9F2E6', '#CBEAD6', '#9BD4C3', '#B8E3D8', '#D2E8E1',
  // 藍 → 紫
  '#CFE3F7', '#E3D7F7',
];

const FontCard: React.FC<{
  font: { name: string; label: string; category: FontCategory };
  active: boolean;
  onPick: () => void;
}> = ({ font, active, onPick }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    // 捲到才載入，否則一次要抓上百個 CJK 字體
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => { if (visible) ensureFont(font.name); }, [visible, font.name]);

  return (
    <button
      ref={ref}
      onClick={onPick}
      title={font.label}
      className={`flex flex-col items-center justify-center gap-1 h-[62px] px-1.5 rounded-xl border transition-all ${
        active ? 'bg-white/10 border-white' : 'bg-white/[0.03] border-white/10 hover:border-white/25'
      }`}
    >
      <span
        className="text-[19px] leading-none text-white truncate max-w-full"
        style={{ fontFamily: visible ? fontStack(font.name) : undefined }}
      >
        {FONT_SAMPLE[font.category]}
      </span>
      <span className="text-[9px] font-bold tracking-wider text-white/40 truncate max-w-full">{font.label}</span>
    </button>
  );
};

export const TextEditorPanel: React.FC<{
  layer: FloatingImage;
  onChange: (patch: Partial<FloatingImage>) => void;
}> = ({ layer, onChange }) => {
  const [sub, setSub] = useState<'style' | 'font'>('style');
  const [cat, setCat] = useState<FontCategory>('zh');

  const list = FONTS.filter(f => f.category === cat);

  /* 這個字體有沒有真正的斜體？沒有的話就不給斜體鈕（瀏覽器會自己歪一個
     假斜體出來，那個不好看也不是這個字體本來的樣子）。答案問到之前先當成
     沒有，才不會閃一下又消失。換字體時如果新的字體沒有斜體，順手把已經
     打開的斜體關掉，不然會留下一個看不到開關的假斜體。 */
  const family = layer.fontFamily || DEFAULT_FONT;
  const [hasItalic, setHasItalic] = useState(() => knownItalic(family) === true);
  useEffect(() => {
    let alive = true;
    setHasItalic(knownItalic(family) === true);
    ensureItalic(family).then(ok => {
      if (!alive) return;
      setHasItalic(ok);
      if (!ok && layer.italic) onChange({ italic: false });
    });
    return () => { alive = false; };
  }, [family]);

  const swatchRow = (value: string | undefined, onPick: (c: string) => void, colors = TEXT_COLORS) => (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-0.5 py-0.5">
      {/* 第一顆固定是自訂顏色 */}
      <CustomColorButton value={value || '#FFFFFF'} onPick={onPick} />
      {colors.map(c => (
        <button
          key={c}
          onClick={() => onPick(c)}
          title={c}
          className={`shrink-0 w-8 h-8 rounded-[7px] transition-all active:scale-90 ${
            (value || '').toUpperCase() === c ? 'border-2 border-white' : 'border border-white/20'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );

  /* step 可以是小數：給邊緣發光那種「格數要多、拖起來才不會一格一格跳」的滑桿用。
     小數的時候要用 parseFloat（parseInt 會把 0.1 讀成 0），顯示也要跟著補到
     對應的小數位，不然 2.5 會顯示成 2.5000000000000004。 */
  const slider = (
    label: string, value: number, min: number, max: number,
    onVal: (v: number) => void, suffix = '', step = 1,
  ) => {
    const digits = step < 1 ? String(step).split('.')[1].length : 0;
    return (
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-bold text-white/70">{label}</span>
          <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded text-white">{value.toFixed(digits)}{suffix}</span>
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onVal(digits ? parseFloat(e.target.value) : parseInt(e.target.value))}
          className="w-full accent-white bg-white/10 h-1.5 rounded-full cursor-pointer appearance-none"
        />
      </div>
    );
  };

  return (
    <div className="max-w-md mx-auto h-full flex flex-row animate-in fade-in duration-300">
      {/* 左側細長分頁列，跟「新增佈局」同一種版型：只有圖示、
          沒有中間那條分隔線，選中也不畫指示條 */}
      <div className="flex flex-col shrink-0 w-11 -mt-4 -mb-4 -ml-4 border-r border-white/10 select-none">
        {/* 跟「新增佈局」完全同款：上面挑內容（字體）、下面調參數（樣式），
            圖標同一組、中間同一條分隔線 */}
        <button
          onClick={() => setSub('font')}
          title="字體"
          aria-label="字體"
          className={`w-full flex-1 flex items-center justify-center transition-all ${sub === 'font' ? 'text-white' : 'text-[#5a5a5a]'}`}
        >
          <Type size={18} className={`transition-transform ${sub === 'font' ? 'scale-110' : ''}`} />
        </button>
        <div className="w-full h-[1px] bg-white/10 shrink-0" />
        <button
          onClick={() => setSub('style')}
          title="樣式"
          aria-label="樣式"
          className={`w-full flex-1 flex items-center justify-center transition-all ${sub === 'style' ? 'text-white' : 'text-[#5a5a5a]'}`}
        >
          <Sliders size={18} className={`transition-transform ${sub === 'style' ? 'scale-110' : ''}`} />
        </button>
      </div>

      <div className="flex-1 no-scrollbar pl-3 pr-1 h-full overflow-y-auto">
        {sub === 'font' && (
          <div className="space-y-2.5 pt-1 pb-1">
            <div className="flex items-center gap-1 bg-white/[0.06] rounded-full p-0.5">
              {FONT_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className={`flex-1 h-7 rounded-full text-[11px] font-bold tracking-widest transition-all ${
                    cat === c.id ? 'bg-white text-black' : 'text-white/60'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {list.map(f => (
                <FontCard
                  key={f.name + f.category}
                  font={f}
                  active={(layer.fontFamily || DEFAULT_FONT) === f.name}
                  onPick={() => onChange({ fontFamily: f.name })}
                />
              ))}
            </div>
          </div>
        )}

        {sub === 'style' && (
          <div className="space-y-3.5 pt-1 pb-2">
            {/* 文字內容直接在畫布上打（選中後再點一次），這裡不再放輸入框 */}
            <div>
              <p className="text-[11px] font-bold text-white/70 mb-1.5">文字顏色</p>
              {swatchRow(layer.color, c => onChange({ color: c }))}
            </div>
            {slider('字級', layer.fontSize || 40, 12, 160, v => onChange({ fontSize: v }), 'px')}
            {/* 粗體與斜體同一排。這個字體沒有真斜體時只留粗體，
                粗體就自己撐滿整排 —— 跟沒有斜體鈕之前長得一樣。 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onChange({ bold: !layer.bold })}
                className={`flex-1 h-9 rounded-xl border flex items-center justify-center gap-2 text-[12px] font-bold tracking-widest transition-all ${
                  layer.bold ? 'bg-white text-black border-white' : 'bg-white/[0.04] text-white/70 border-white/15'
                }`}
              >
                <Bold size={14} />粗體
              </button>
              {hasItalic && (
                <button
                  onClick={() => onChange({ italic: !layer.italic })}
                  className={`flex-1 h-9 rounded-xl border flex items-center justify-center gap-2 text-[12px] font-bold tracking-widest transition-all ${
                    layer.italic ? 'bg-white text-black border-white' : 'bg-white/[0.04] text-white/70 border-white/15'
                  }`}
                >
                  <Italic size={14} />斜體
                </button>
              )}
            </div>
            {slider('字距', layer.letterSpacing || 0, -10, 40, v => onChange({ letterSpacing: v }), 'px')}
            {/* 描邊 0～2px，一樣分 50 格（每格 0.04px）：最小那一格只有 0.04px，
                從 0 拉出來時是慢慢浮現，不會一下就跳出一圈明顯的邊。 */}
            {slider('描邊', layer.strokeWidth || 0, 0, 2, v => onChange({ strokeWidth: v }), 'px', 0.04)}
            {!!layer.strokeWidth && (
              <div>
                <p className="text-[11px] font-bold text-white/70 mb-1.5">描邊顏色</p>
                {swatchRow(layer.strokeColor, c => onChange({ strokeColor: c }))}
              </div>
            )}
            {/* 顯示成 0～0.5、分 50 格（每格 0.01），拖起來才不會一格一格跳；
                最小那一格的模糊只有 0.28px，是從 0 慢慢亮起來、不會有斷層。
                存進去的還是原本的 0～20 —— 舊的拼圖草稿裡已經存了 0～20 的值，
                換算成新刻度存回去會讓舊作品的光突然變強，所以只換顯示。 */}
            {slider('邊緣發光', (layer.glow || 0) / 40, 0, 0.5, v => onChange({ glow: v * 40 }), '', 0.01)}
            <div>
              <p className="text-[11px] font-bold text-white/70 mb-1.5">發光顏色</p>
              {swatchRow(layer.glowColor, c => onChange({ glowColor: c }), GLOW_COLORS)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 圖片調整面板。
 *
 * 這一段原本寫死在 GridLayoutTool 裡面，創意拼圖要用同一套介面就只能複製一份，
 * 兩邊遲早會走鐘。所以整段原封不動搬出來變成共用元件 ——
 * **裡面一行邏輯都沒有改**，經典拼圖只是改成把原本的區域變數當 props 傳進來。
 *
 * 為什麼 props 這麼多：那些 UI 狀態（現在停在哪個子分頁、選了哪張特效卡…）
 * 本來就住在各自的工具裡，留在外面才不會影響經典拼圖現有的行為。
 */
export type ImageAdjustPanelProps = {
  img: any;
  set: (patch: any) => void;
  lutList: { id: string; name: string; url: string }[];
  loadingLut: string | null;
  setLoadingLut: (v: any) => void;
  lutRevision: number;
  setLutRevision: (v: any) => void;
  adjustSub: 'shape' | 'tune' | 'filter' | 'effect';
  setAdjustSub: (v: any) => void;
  effectCard: string | null;
  setEffectCard: (v: any) => void;
  effectDetail: boolean;
  setEffectDetail: (v: any) => void;
  shapeMenu: string;
  setShapeMenu: (v: any) => void;
  shapeTool: string;
  setShapeTool: (v: any) => void;
  tuneTool: string;
  setTuneTool: (v: any) => void;
  setTuningEdge: (v: any) => void;
  openComposeFor: (id: string) => void;
  /* 開著的時候：切到「調節」「形狀」不預先選好第一個工具 —— 滑桿要等
     真的點下某顆工具鈕才出現，而且是帶動畫出現的。經典拼圖不傳這個，
     維持原本「一切過去滑桿就在那」的手感。 */
  deferSlider?: boolean;
  /** 回報「這一格有沒有滑桿在上面那一段」——創意拼圖用它決定工具欄要不要長高 */
  onSliderOpenChange?: (open: boolean) => void;
  /** 佈局裡的格子沒有「形狀」那一組，傳 true 就把它藏起來 */
  hideShape?: boolean;
  /** 滑桿排成一排：名稱、軌道、數值全部同一列，上面不再有一排字 */
  inlineSlider?: boolean;
};

export const ImageAdjustPanel: React.FC<ImageAdjustPanelProps> = ({
  img, set, lutList, loadingLut, setLoadingLut, lutRevision, setLutRevision,
  adjustSub, setAdjustSub, effectCard, setEffectCard, effectDetail, setEffectDetail,
  shapeMenu, setShapeMenu, shapeTool, setShapeTool, tuneTool, setTuneTool,
  setTuningEdge, openComposeFor, hideShape, deferSlider, onSliderOpenChange, inlineSlider,
}) => {
const fx = img.fx || {};
const setFx = (patch: Partial<PhotoFx>) => set({ fx: { ...fx, ...patch } });
const fxVal = (key: string, dflt: number) => (fx as any)[key] ?? dflt;

/* 點特效卡片＝只留這一顆（其他整組歸零）；
   長按＝疊在現在這些上面，好幾個同時生效（再長按一次就關掉那一顆）。 */
const pickEffect = (id: string) => {
  if (FX_DETAIL[id]) warmFx(id);      // 先把著色器編好，第一次拖才不會卡
  setEffectCard(id);
  setEffectDetail(false);
  const amountId = fxAmountId(id);
  const on = fxVal(amountId, 0) !== 0;
  const keep = new Set(FX_OWN_KEYS[id] || [id]);
  const patch: any = {};
  for (const k of FX_ALL_AMOUNTS) if (!keep.has(k)) patch[k] = 0;
  if (!on) patch[amountId] = FX_ON_AMOUNT[id] ?? 100;
  setFx(patch);
};

/* 長按 450ms＝疊加，並把接著那一次 click 吃掉 */

/* 佈局裡的格子沒有「形狀」——羽化／發光／描邊都會長到格子外面，
   而格子是被裁切的，畫出來會被切掉；圓角則已經有佈局那根共用滑桿。 */
const CATS = ([
  ['filter', 'palette', '濾鏡'],
  ['tune', 'tune', '調節'],
  ['effect', 'magic_button', '特效'],
  ['shape', 'shapes', '形狀'],
  // 構圖圖標跟「編輯」那邊用同一顆（crop）
  ['compose', 'crop', '構圖'],
] as const).filter(c => !(hideShape && c[0] === 'shape'));

// 編輯同款的圓形工具鈕
const toolBtn = (id: string, label: string, icon: string, active: boolean, adjusted: boolean, onClick: () => void) => (
  <button key={id} onClick={onClick} className="flex flex-col items-center gap-1 shrink-0 group w-16">
    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${active ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}>
      <Icon name={icon} className="text-lg" fill={active} />
    </div>
    <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${active ? 'text-white' : 'text-white/20'}`}>{label}</span>
    <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${adjusted ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
  </button>
);

// 編輯同款的滑桿（label 在左、數字在右、track 一樣是 custom-range）
// 上面那一行（名稱＋數值）往下挪一點，不要貼著上面的細線。
// hideChrome：拖這根滑桿的期間把圖片的選取框整組收起來（形狀分頁用）
const editorSlider = (
  label: string, value: number, min: number, max: number,
  onVal: (v: number) => void,
  swatches?: React.ReactNode,
  hideChrome = false,
) => {
  const input = (cls: string) => (
    <input
      type="range" min={min} max={max} step="1" value={value}
      onChange={e => onVal(parseInt(e.target.value))}
      onPointerDown={hideChrome ? () => setTuningEdge(true) : undefined}
      onPointerUp={hideChrome ? () => setTuningEdge(false) : undefined}
      onPointerCancel={hideChrome ? () => setTuningEdge(false) : undefined}
      onLostPointerCapture={hideChrome ? () => setTuningEdge(false) : undefined}
      className={cls}
    />
  );
  /* 排成一排：名稱在左、軌道在中間、數值在右，上面那一排字整個拿掉。
     軌道用 dense 那一版 —— 原本那版刻意往左右各溢出 32px（讓圓點可以滑到
     邊緣外），排成一排時會壓到兩邊的字。 */
  if (inlineSlider) return (
    <div className="w-full flex items-center gap-3">
      <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] pointer-events-none shrink-0">{label}</span>
      {swatches}
      <div className="relative flex-1 min-w-0 h-11 flex items-center touch-none">
        {input('custom-range dense')}
      </div>
      <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded shrink-0 text-center min-w-[2.6rem]">{value}</span>
    </div>
  );
  return (
    <div className="w-full pt-1.5">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] pointer-events-none shrink-0">{label}</span>
        {swatches}
        <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded shrink-0">{value}</span>
      </div>
      <div className="relative h-11 flex items-center justify-center touch-none">
        {input('custom-range')}
      </div>
    </div>
  );
};

// 色票：第一顆固定是自訂顏色（開系統調色盤），後面才是預設色
const swatchStrip = (
  value: string | undefined, colors: string[], onPick: (c: string) => void, big = false,
) => (
  <div className={`flex items-center overflow-x-auto no-scrollbar min-w-0 px-0.5 py-0.5 ${big ? 'gap-2 w-full' : 'gap-1.5'}`}>
    <CustomColorButton value={value || '#FFFFFF'} onPick={onPick} size={big ? 32 : 24} />
    {colors.map(c => (
      <button
        key={c}
        onClick={() => onPick(c)}
        title={c}
        className={`shrink-0 rounded-[7px] transition-all active:scale-90 ${big ? 'w-8 h-8' : 'w-6 h-6'} ${
          (value || '#FFFFFF').toUpperCase() === c ? 'border-2 border-white' : 'border border-white/20'
        }`}
        style={{ backgroundColor: c }}
      />
    ))}
  </div>
);

/* 特效細項的排法跟「編輯」一致：剛好兩根上下各一行；
   奇數根時「強度」自己站一行，其餘兩兩一排。 */
const fxDetailOpen = adjustSub === 'effect' && effectDetail && !!effectCard;
const fxRows = (() => {
  const tools = (FX_DETAIL[effectCard] || (FX_SUB_TOOLS[effectCard] || []).map(
    ([k, l, , mn, mx, d]) => [k, l, mn, mx, d] as [string, string, number, number, number]));
  if (!tools.length) return [] as [string, string, number, number, number][][];
  if (tools.length === 2) return [[tools[0]], [tools[1]]];
  const out: [string, string, number, number, number][][] = [];
  const solo = tools.length % 2 === 1;
  if (solo) out.push([tools[0]]);
  const rest = tools.slice(solo ? 1 : 0);
  for (let i = 0; i < rest.length; i += 2) out.push(rest.slice(i, i + 2));
  return out;
})();
const fxRowH = fxRows.length ? Math.min(52, Math.floor(172 / fxRows.length)) : 52;

// 目前這一段要放什麼
const sliderArea = (() => {
  if (adjustSub === 'filter') {
    if (!fx.lut || fx.lut === 'none') return null;
    return editorSlider('強度', fx.lutAmount ?? 100, 0, 100, v => setFx({ lutAmount: v }));
  }
  if (adjustSub === 'tune') {
    const t = TUNE_TOOLS.find(x => x[0] === tuneTool) || (deferSlider ? null : TUNE_TOOLS[0]);
    if (!t) return null;
    return editorSlider(t[1], fxVal(t[0], t[5]), t[3], t[4], v => setFx({ [t[0]]: v }));
  }
  if (adjustSub === 'effect') {
    // 細項是另外一整區（並排滑桿），不走這一根
    if (effectDetail) return null;
    if (!effectCard) return null;
    // 最外層一律只有一根「強度」，跟編輯一樣
    const amountId = fxAmountId(effectCard);
    return editorSlider('強度', fxVal(amountId, 0), 0, 100, v => setFx({ [amountId]: v }));
  }
  if (adjustSub === 'shape') {
    const sub = SHAPE_SUB_TOOLS[shapeMenu];
    const subTool = sub?.find(t => t[0] === shapeTool);
    if (subTool) {
      // 描邊色跟發光色用同一組色票
      if (subTool[0] === 'imgStrokeColor') return swatchStrip(img.imgStrokeColor, GLOW_COLORS, c => set({ imgStrokeColor: c }), true);
      if (subTool[0] === 'imgGlowColor') return swatchStrip(img.imgGlowColor, GLOW_COLORS, c => set({ imgGlowColor: c }), true);
      const k = subTool[0] as 'imgStrokeWidth' | 'imgGlow';
      // 形狀的滑桿都會動到圖片邊緣，拖的時候把選取框收起來
      return editorSlider(
        subTool[1], (img[k] as number) || 0, subTool[3], subTool[4],
        v => set({ [k]: v }), undefined, true,
      );
    }
    const t = SHAPE_TOOLS.find(x => x[0] === shapeTool);
    if (t && (t[0] === 'imgRadius' || t[0] === 'feather')) {
      const key = t[0] as 'imgRadius' | 'feather';
      return editorSlider(
        t[1], (img[key] as number) || 0, t[3], t[4],
        v => set({ [key]: v }), undefined, true,
      );
    }
    return null;
  }
  return null;
})();

const sliderShown = fxDetailOpen || !!sliderArea;
useEffect(() => { onSliderOpenChange?.(sliderShown); }, [sliderShown, onSliderOpenChange]);

return (
  <div className="h-full flex flex-col justify-end">
    {/* 1. 滑桿（跟編輯一樣的 5rem、px-8、底下一條細線）。
           特效細項時把下面工具列那 6rem 借過來（它同時收成 0），
           兩段加起來還是 5rem + 6rem —— 預覽圖的大小完全不變。 */}
    <div
      className={`flex flex-col justify-center shrink-0 overflow-hidden bg-[#111] ${fxDetailOpen ? 'px-4' : 'px-8'}`}
      style={{ height: fxDetailOpen ? '11rem' : '5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      {fxDetailOpen ? (
        <div className="w-full h-full flex items-center gap-3">
          <button
            onClick={() => setEffectDetail(false)}
            aria-label="返回特效"
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-white"
          >
            <Icon name="arrow_back" className="text-xl" />
          </button>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {fxRows.map((row, ri) => (
              <div key={ri} className="flex items-center gap-4" style={{ height: fxRowH }}>
                {row.map(([key, label, mn, mx, dflt]) => (
                  <div key={key} className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.12em] truncate pointer-events-none">{label}</span>
                      <span className="text-[10px] leading-none font-sans tabular-nums font-bold bg-white/10 px-1.5 py-[4px] rounded shrink-0">{Math.round(fxVal(key, dflt))}</span>
                    </div>
                    <div className="relative h-[26px] flex items-center justify-center touch-none">
                      <input
                        type="range" min={mn} max={mx} step="1"
                        value={fxVal(key, dflt)}
                        onChange={e => setFx({ [key]: parseInt(e.target.value) })}
                        className="custom-range dense"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (deferSlider && sliderArea ? (
        /* key 一變就重播一次：每點一顆工具鈕，滑桿都是「從下面浮上來」 */
        <div key={`${adjustSub}|${tuneTool}|${shapeTool}|${effectCard}|${fx.lut || ''}`}
             className="w-full animate-in fade-in slide-in-from-bottom-2 duration-200">
          {sliderArea}
        </div>
      ) : sliderArea)}
    </div>

    {/* 2. 工具列（6rem、px-4、gap-2、深一階的底色） */}
    <div className="flex items-center px-4 overflow-x-auto no-scrollbar gap-2 bg-[#080808] shrink-0"
         style={{ height: fxDetailOpen ? '0px' : '6rem', opacity: fxDetailOpen ? 0 : 1 }}>
      {/* 濾鏡卡片：外觀跟「編輯」完全一樣 —— 縮圖是這張照片套上這顆濾鏡的樣子，
          名稱壓在下緣，選中的那顆是內描邊的白框（不佔版面、不會位移）。 */}
      {adjustSub === 'filter' && lutList.map((l, li) => {
        const active = (fx.lut || 'none') === l.id;
        return (
          <button
            key={l.id}
            data-lut-card={l.id}
            onClick={async () => {
              if (active) return;
              if (l.url) { setLoadingLut(l.id); await loadLut(l.id, l.url); setLoadingLut(null); }
              setFx({ lut: l.id });
              setLutRevision(n => n + 1);
            }}
            className="flex flex-col items-center gap-2 shrink-0 group w-[64px]"
          >
            <div className="relative w-full h-[76px] rounded-lg bg-[#111] overflow-hidden">
              <div className="absolute inset-0 bg-[#1a1a1a]" />
              <CardThumb src={img.src} delay={li * 24}
                         cacheKey={`${img.src}|lut:${l.id}|${lutRevision}`}
                         fx={{ lut: l.id, lutAmount: 100 }} />
              {loadingLut === l.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 h-[16px] bg-[#0b0b0b]/90 flex items-center justify-center pb-[2px]">
                <span className={`text-[8px] font-black uppercase tracking-widest leading-none ${active ? 'text-white' : 'text-white/60'}`}>
                  {l.url ? l.name : '原始'}
                </span>
              </div>
              {active && <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />}
            </div>
          </button>
        );
      })}

      {adjustSub === 'tune' && TUNE_TOOLS.map(([id, label, icon, , , dflt]) =>
        toolBtn(id, label, icon, tuneTool === id, fxVal(id, dflt) !== dflt, () => setTuneTool(id))
      )}

      {/* 特效卡片：跟「編輯」同一份清單、同一種卡片外觀。
          縮圖是這個特效的預設效果，選中的那顆右上角會多一顆編輯鍵（有細項才有）。 */}
      {adjustSub === 'effect' && FX_ROOT_TOOLS.map(([id, label], fi) => {
        const amountId = fxAmountId(id);
        const on = fxVal(amountId, 0) !== 0;
        const detail = FX_DETAIL[id] || FX_SUB_TOOLS[id];
        const hasDetail = !!detail && detail.length > 1;
        return (
          <button
            key={id}
            data-fx-card={id}
            onClick={() => pickEffect(id)}
            className="flex flex-col items-center gap-2 shrink-0 group w-[64px]"
          >
            <div className="relative w-full h-[76px] rounded-lg bg-[#111] overflow-hidden">
              <div className="absolute inset-0 bg-[#1a1a1a]" />
              <CardThumb src={img.src} delay={fi * 24}
                         cacheKey={`${img.src}|fx:${id}`}
                         fx={{ [fxAmountId(id)]: FX_ON_AMOUNT[id] ?? 100 } as PhotoFx} />
              <div className="absolute inset-x-0 bottom-0 h-[16px] bg-[#0b0b0b]/90 flex items-center justify-center pb-[2px]">
                <span className={`text-[8px] font-black uppercase tracking-widest leading-none whitespace-nowrap ${on ? 'text-white' : 'text-white/60'}`}>
                  {label}
                </span>
              </div>
              {/* 白框＝這個特效正在生效；只是選到但沒開的不畫 */}
              {on && <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />}
              {on && hasDetail && (
                // 卡片本身就是一顆 button，裡面不能再放 button，所以用 span
                <span
                  role="button"
                  aria-label="調整細項"
                  onClick={e => { e.stopPropagation(); setEffectDetail(true); }}
                  onPointerDown={e => e.stopPropagation()}
                  style={{ position: 'absolute', top: 3, right: 3, width: 22, height: 22 }}
                  className="rounded-full flex items-center justify-center bg-black/55 border border-white/25 text-white active:scale-90 transition-transform"
                >
                  <Icon name="tune" className="text-[13px]" />
                </span>
              )}
            </div>
          </button>
        );
      })}

      {adjustSub === 'shape' && (shapeMenu === 'root'
        ? SHAPE_TOOLS.map(([id, label, icon, , , dflt]) => {
            const isSub = !!SHAPE_SUB_TOOLS[id];
            // 只看粗細／強度，顏色不算：值是 0 的時候畫面上根本沒有效果，
            // 按鈕下方就不該有白點
            const adjusted = isSub
              ? SHAPE_SUB_TOOLS[id].some(([k, , , , , d]) =>
                  !k.endsWith('Color') && (((img as any)[k]) || 0) !== d)
              : (((img as any)[id]) || 0) !== dflt;
            return toolBtn(id, label, icon, shapeTool === id, adjusted, () => {
              if (isSub) {
                setShapeMenu(id as any);
                setShapeTool(SHAPE_SUB_TOOLS[id][0][0]);
              } else {
                setShapeTool(id);
              }
            });
          })
        : (
          <div className="flex items-center gap-4 animate-in slide-in-from-right duration-300">
            <button
              onClick={() => { setShapeMenu('root'); setShapeTool(SHAPE_TOOLS[0][0]); }}
              className="flex flex-col items-center justify-center gap-2 shrink-0 group w-12"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all text-white">
                <Icon name="arrow_back" className="text-xl" />
              </div>
            </button>
            <div className="w-[1px] h-8 bg-white/10 mx-2" />
            {SHAPE_SUB_TOOLS[shapeMenu].map(([id, label, icon, , , dflt]) => {
              const cur = (img as any)[id];
              const adjusted = id.endsWith('Color')
                ? !!cur && cur.toUpperCase() !== '#FFFFFF'
                : (cur || 0) !== dflt;
              return toolBtn(id, label, icon, shapeTool === id, adjusted, () => setShapeTool(id));
            })}
          </div>
        ))}
    </div>

    {/* 3. 分類列：跟編輯一樣的 h-16、上方細線、黑底、底部安全區空隙 */}
    <div className="flex h-16 border-t border-white/10 bg-black pb-[calc(env(safe-area-inset-bottom,0px)+12px)] box-content shrink-0">
      {CATS.map(([id, icon, label]) => (
        <button
          key={id}
          onClick={() => {
            if (id === 'compose') { openComposeFor(img.id); return; }
            setAdjustSub(id as any);
            // 跟編輯一樣：切分類就把該分類的第一個工具選起來
            if (id === 'tune') setTuneTool(deferSlider ? '' : TUNE_TOOLS[0][0]);
            if (id === 'shape') { setShapeMenu('root'); setShapeTool(deferSlider ? '' : SHAPE_TOOLS[0][0]); }
            if (id === 'effect') { setEffectCard(''); setEffectDetail(false); }
          }}
          className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${adjustSub === id ? 'text-white' : 'text-white/20'}`}
        >
          <Icon name={icon} className="text-xl" fill={adjustSub === id} />
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">{label}</span>
        </button>
      ))}
    </div>
  </div>
);
};

const ColorPickerEmbedded: React.FC<ColorPickerProps> = ({ color, onChange, onClose }) => {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexInput, setHexInput] = useState(color);

  useEffect(() => { 
    setHexInput((prev) => {
      if (color.toUpperCase() !== prev.toUpperCase()) {
        setHsv(hexToHsv(color));
        return color.toUpperCase();
      }
      return prev;
    });
  }, [color]);

  const handleHsvChange = (key: string, val: string) => {
    const newHsv = { ...hsv, [key]: Number(val) };
    setHsv(newHsv as any);
    const newHex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    setHexInput(newHex);
    onChange(newHex);
  };

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase();
    if (val.length > 0 && !val.startsWith('#')) val = '#' + val;
    setHexInput(val);
    
    if (/^#[0-9A-F]{6}$/i.test(val)) {
      setHsv(hexToHsv(val));
      onChange(val);
    }
  };

  // 韓系拼貼常見的柔和底色
  const PRESETS = [
    // 白 → 暖白 → 暖灰 → 奶油 → 米
    '#FFFFFF', '#FAF6F0', '#EAE6DF', '#F1E7DB', '#E7DACB',
    // 粉
    '#F6DCD8', '#F4C2C2',
    // 黃
    '#F7E9C8', '#FFF1A5',
    // 綠 → 薄荷 → 淺青
    '#DCE7DB', '#CBEAD6', '#9BD4C3', '#B8E3D8', '#D2E8E1',
    // 藍 → 紫
    '#D7E3EF', '#E2DCEC',
  ];

  return (
    <div className="h-full flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-2 mb-3">
        {/* 韓系拼貼常用色：一點就換。
            內距是留給選取外框的，否則第一顆與外框上緣會被捲動容器裁掉。 */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0 px-0.5 py-0.5">
          {/* 第一顆固定是自訂顏色 */}
          <CustomColorButton
            value={/^#[0-9A-F]{6}$/i.test(hexInput) ? hexInput : color}
            onPick={c => { setHsv(hexToHsv(c)); setHexInput(c.toUpperCase()); onChange(c); }}
          />
          {PRESETS.map(c => {
            const active = c.toUpperCase() === (color || '').toUpperCase();
            return (
              <button
                key={c}
                onClick={() => { setHsv(hexToHsv(c)); setHexInput(c.toUpperCase()); onChange(c); }}
                title={c}
                className={`shrink-0 w-8 h-8 rounded-[7px] transition-all active:scale-90 ${
                  active ? 'border-2 border-white' : 'border border-white/20'
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
        <input
          type="text"
          value={hexInput}
          onChange={handleHexInputChange}
          maxLength={7}
          aria-label="色號"
          className="shrink-0 h-8 w-[86px] bg-[#1A1A1A] border border-[#333] rounded-[7px] px-2 text-white font-mono text-xs outline-none focus:border-white/50"
        />
      </div>
      
      <div className="flex-1 flex flex-col space-y-3">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
              <span>色相</span>
              <span className="text-white/40">{Math.round(hsv.h)}°</span>
            </div>
            <input type="range" min="0" max="360" value={hsv.h} onInput={e => handleHsvChange('h', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>飽和度</span>
                <span className="text-white/40">{Math.round(hsv.s)}%</span>
              </div>
              <input type="range" min="0" max="100" value={hsv.s} onInput={e => handleHsvChange('s', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: `linear-gradient(to right, #808080, ${hsvToHex(hsv.h, 100, 100)})` }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>明度</span>
                <span className="text-white/40">{Math.round(hsv.v)}%</span>
              </div>
              <input type="range" min="0" max="100" value={hsv.v} onInput={e => handleHsvChange('v', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: `linear-gradient(to right, #000, ${hsvToHex(hsv.h, hsv.s, 100)})` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface AlignmentGuideline {
  type: 'vertical' | 'horizontal';
  coord: number;
}

/* ── 圓角 + 羽化遮罩 ────────────────────────────────────────────────
   線性漸層做的羽化在四個角會淡得比較快，看起來很廉價。這裡改成修圖軟體
   的做法：先把圓角矩形畫成遮罩，再對 alpha 做三次盒狀模糊（≈高斯），
   淡出就會沿著形狀輪廓等距展開，圓角也一起變柔。
   預覽與匯出共用同一支，兩邊才會長得一模一樣。                          */

/**
 * 圓角半徑：百分比一律吃「短邊」，四個角都是正圓弧。
 *
 * 以前是水平吃寬、垂直吃高（＝CSS 的 border-radius: N%），角變成橢圓：
 * 直立的格子 rx 很小、ry 很大，上下那條邊才走一點點就急轉彎，看起來
 * 就是「邊上突然多一個角」。正圓角走的是四分之一圓，接到直邊的曲率
 * 變化平順，也才是修圖軟體的做法。
 */
export const cornerR = (pct: number, w: number, h: number) => (pct / 100) * Math.min(w, h);

/** 圓角矩形路徑（rx/ry 可不同，但呼叫端一律傳同一個值 → 正圓角）。 */
export const roundRectPath = (
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, rx: number, ry: number,
) => {
  rx = Math.max(0, Math.min(rx, w / 2));
  ry = Math.max(0, Math.min(ry, h / 2));
  g.beginPath();
  if (rx < 0.5 || ry < 0.5) { g.rect(x, y, w, h); return; }
  const Q = Math.PI / 2;
  g.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI + Q);
  g.lineTo(x + w - rx, y);
  g.ellipse(x + w - rx, y + ry, rx, ry, 0, -Q, 0);
  g.lineTo(x + w, y + h - ry);
  g.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Q);
  g.lineTo(x + rx, y + h);
  g.ellipse(x + rx, y + h - ry, rx, ry, 0, Q, Math.PI);
  g.closePath();
};

/** 單次盒狀模糊（滑動視窗，邊界夾住）。三次疊起來就很接近高斯。 */
const boxBlurH = (src: Float32Array, dst: Float32Array, w: number, h: number, r: number) => {
  const norm = 1 / (r * 2 + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
};

const boxBlurV = (src: Float32Array, dst: Float32Array, w: number, h: number, r: number) => {
  const norm = 1 / (r * 2 + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
};

/**
 * 產生一張遮罩（白色、alpha 就是可見度）。
 * radiusPct / featherPct 都是佔短邊的百分比，0~50。
 */
export const makeShapeMask = (w: number, h: number, radiusPct: number, featherPct: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(w));
  c.height = Math.max(4, Math.round(h));
  const g = c.getContext('2d')!;
  const fp = Math.max(0, Math.min(50, featherPct));
  const rp = Math.max(0, Math.min(50, radiusPct));
  /* 淡出的總寬度。
     模糊是「三次盒狀模糊」，半徑 r 的三次疊起來，一條硬邊會被抹開到
     ±3r 這麼寬。所以形狀要先往內縮「剛好 3r」，淡出才會在畫布邊界
     收斂到完全透明。
     以前 r 取 fade/4、卻只內縮 fade/2 —— 模糊往外散 0.75×fade、內縮只有
     0.5×fade，等於還沒淡完就撞到畫布邊界被切掉，邊緣的 alpha 停在某個
     不是 0 的值：看起來就是「有羽化，但照片還是有一條生硬的邊」。
     改成 r = fade/6、內縮 3r，兩邊剛好對上，邊界一定是 0。 */
  const fade = (fp / 100) * Math.min(c.width, c.height);
  const r = fp > 0 ? Math.max(1, Math.round(fade / 6)) : 0;
  const inset = r > 0 ? r * 3 + 1 : 0;   // +1：離散的盒狀模糊在邊界還會留一點點，多讓 1px
  g.fillStyle = '#fff';
  const R = Math.max(0, cornerR(rp, c.width, c.height) - inset);
  roundRectPath(g, inset, inset, c.width - inset * 2, c.height - inset * 2, R, R);
  g.fill();

  if (r >= 1) {
    const px = g.getImageData(0, 0, c.width, c.height);
    const n = c.width * c.height;
    let a = new Float32Array(n);
    let b = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = px.data[i * 4 + 3];
    for (let pass = 0; pass < 3; pass++) {
      boxBlurH(a, b, c.width, c.height, r); [a, b] = [b, a];
      boxBlurV(a, b, c.width, c.height, r); [a, b] = [b, a];
    }
    for (let i = 0; i < n; i++) {
      // RGB 全部填白，這樣不管遮罩被當成 alpha 還是亮度都成立
      px.data[i * 4] = 255; px.data[i * 4 + 1] = 255; px.data[i * 4 + 2] = 255;
      px.data[i * 4 + 3] = a[i];
    }
    g.putImageData(px, 0, 0);
  }
  return c;
};

/** 新增文字時的預設內容；點進去打字會自動清掉，沒打東西再放回來 */
const TEXT_PLACEHOLDER = '輸入文字';

/**
 * 把顏色往黑色壓一點，做出「不透明」的接縫顏色。
 * 排頁面時接縫一定要不透明：半透明的話，底下的深色工作區會從次像素的縫裡
 * 透出來，透多少完全看那條縫剛好落在像素格的哪個位置 —— 每條的深淺就不一樣。
 */
const shadeHex = (hex: string | undefined, amount: number) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || '').trim());
  if (!m) return hex || '#ffffff';
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};

/** 工作區的底色。一般模式下頁與頁之間露出來的就是它。 */
const WORKSPACE_BG = '#070707';
/**
 * 頁與頁之間那條分隔線。
 *
 * 一般模式是 1px 的 bg-black/15，而它底下是工作區的深色 —— 所以看到的其實是
 * 一條**深色**細線（#070707 再壓深 15%），不是灰線。
 *
 * 排頁面時跟著整排一起等比例縮小（1px → 0.4px），只有顏色改成「不透明」的
 * 同一個深色：半透明的話，相鄰兩頁各自做次像素抗鋸齒，底下透出來多少會看
 * 那條縫剛好落在像素格的哪 —— 每條深淺就不一樣了。不透明之後，不管落在哪
 * 一格，畫出來的墨水量都固定是「0.4px × 這個深色」。
 */
const PAGE_SEAM_INK = 0.15;

/** 發光的單位模糊：跟文字一樣是 (強度/20) × 14，再疊 ×1、×2、×3 三層 */
export const GLOW_BLUR_UNIT = 14;
/** 三層裡最寬的那層是 1.5 個單位，散到 3.2σ 就看不見了 → 單位的 4.8 倍 */
export const GLOW_EXTENT = 4.8;

/** erfc 近似（Abramowitz & Stegun 7.1.26，誤差 < 1.5e-7），只用在 x ≥ 0 */
const erfc = (x: number) => {
  const t = 1 / (1 + 0.3275911 * x);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741
    + t * (-1.453152027 + t * 1.061405429))));
  return y * Math.exp(-x * x);
};

/**
 * 光暈：跟文字的發光同一套 —— 同一個形狀疊三層陰影，
 * 模糊半徑是「單位 ×1、×2、×3」，所以貼著邊很亮、往外拖一條長長的淡尾巴。
 *
 * 文字是直接讓 canvas 畫三次 shadow。但對一張矩形照片這樣做，
 * 四個角只會被兩個方向各照到一半，濃度天生是邊的一半（角落的光比較少）。
 * 所以這裡改成：先算每一格「離輪廓多遠」，再用三層高斯疊起來的亮度公式
 * 1 − Π(1 − erfc(d/σ√2)/2) 去換算（canvas 的 shadowBlur b 相當於 σ = b/2）。
 * 直邊上算出來的濃淡跟文字那三層一模一樣，而距離跟方向無關，
 * 四個角就自然跟邊一樣濃。
 */
export const makeGlowCanvas = (
  shape: CanvasImageSource,
  w: number, h: number,
  sx: number, sy: number, sw: number, sh: number,
  blurPx: number,
  color: string,
) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return c;
  g.drawImage(shape, sx, sy, sw, sh);

  const W = c.width, H = c.height;
  const px = g.getImageData(0, 0, W, H);
  const n = W * H;
  const unit = Math.max(0.5, blurPx);
  // 三層的 σ：shadowBlur = unit × k，而 shadowBlur b 相當於 σ = b/2
  const sigma = [1, 2, 3].map(k => (unit * k) / 2);
  const extent = unit * GLOW_EXTENT;

  // 距離場（兩次掃描的 chamfer 近似）：圖片裡面是 0，外面是離輪廓的距離
  const FAR = extent + 2;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = px.data[i * 4 + 3] >= 128 ? 0 : FAR;
  const D1 = 1, D2 = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + D1);
      if (y > 0) {
        v = Math.min(v, d[i - W] + D1);
        if (x > 0) v = Math.min(v, d[i - W - 1] + D2);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + D2);
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[i + 1] + D1);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + D1);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + D2);
        if (x > 0) v = Math.min(v, d[i + W - 1] + D2);
      }
      d[i] = v;
    }
  }

  // 距離 → 亮度：三層高斯疊起來（跟文字疊三層 shadow 的結果相同）。
  // 每 0.5px 建一次查表，省掉每個像素算三次 erfc。
  const STEP = 0.5;
  const lutN = Math.ceil(extent / STEP) + 2;
  const lut = new Float32Array(lutN);
  for (let i = 0; i < lutN; i++) {
    let keep = 1;
    for (const s of sigma) keep *= 1 - 0.5 * erfc((i * STEP) / (s * Math.SQRT2));
    lut[i] = 255 * (1 - keep);
  }
  let a = new Float32Array(n);
  let b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = d[i] / STEP;
    const j = t | 0;
    a[i] = j >= lutN - 1 ? 0 : lut[j] + (lut[j + 1] - lut[j]) * (t - j);
  }
  // 距離是一格一格算出來的，補一次小模糊把 chamfer 的稜角磨平
  const r = Math.max(1, Math.round(sigma[0] * 0.6));
  for (let pass = 0; pass < 2; pass++) {
    boxBlurH(a, b, W, H, r); [a, b] = [b, a];
    boxBlurV(a, b, W, H, r); [a, b] = [b, a];
  }

  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.replace('#', '#'));
  const cr = m ? parseInt(m[1], 16) : 255;
  const cg = m ? parseInt(m[2], 16) : 255;
  const cb = m ? parseInt(m[3], 16) : 255;
  for (let i = 0; i < n; i++) {
    px.data[i * 4] = cr;
    px.data[i * 4 + 1] = cg;
    px.data[i * 4 + 2] = cb;
    px.data[i * 4 + 3] = a[i];
  }
  g.putImageData(px, 0, 0);
  return c;
};

/**
 * 預覽用的遮罩。只依「長寬比 + 圓角 + 羽化」快取，縮放圖片時不用重算；
 * 遮罩本來就是平滑的，拉伸貼上看不出差別。
 */
const maskCanvasCache = new Map<string, HTMLCanvasElement>();
const previewMask = (aspect: number, radiusPct: number, featherPct: number) => {
  const key = `${aspect.toFixed(2)}|${radiusPct}|${featherPct}`;
  const hit = maskCanvasCache.get(key);
  if (hit) return hit;
  const MAX = 400;
  const w = aspect >= 1 ? MAX : Math.max(16, Math.round(MAX * aspect));
  const h = aspect >= 1 ? Math.max(16, Math.round(MAX / aspect)) : MAX;
  const c = makeShapeMask(w, h, radiusPct, featherPct);
  if (maskCanvasCache.size > 60) maskCanvasCache.clear();
  maskCanvasCache.set(key, c);
  return c;
};

/* ── 濾鏡／特效按鈕的縮圖 ────────────────────────────────────────────
   跟「編輯」那邊同一個做法：直接畫在 canvas 上（不轉 data URL，
   省掉 PNG 編碼與解碼那一段，按鈕才會馬上有圖）。
   算好的留在模組層，換分頁、換圖層都不用重算。 */
const CARD_W = 64, CARD_H = 76;
/** 縮圖用的實際像素密度，2～3 之間 —— 太低會糊，太高只是白算 */
const CARD_DPR = Math.max(2, Math.min(3, Math.round(typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2)));
const cardThumbCache = new Map<string, HTMLCanvasElement>();

/** 這一格縮圖：把來源縮成卡片大小之後才套效果，所以很快 */
const makeCardThumb = (img: HTMLImageElement, fx: PhotoFx): HTMLCanvasElement | null => {
  if (!img.naturalWidth) return null;
  const w = CARD_W * CARD_DPR, h = CARD_H * CARD_DPR;
  // 先等比例填滿卡片（object-cover），再把效果套在這張小圖上
  const cut = document.createElement('canvas');
  cut.width = w; cut.height = h;
  const cctx = cut.getContext('2d')!;
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  cctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return applyPhotoFx(cut, w, h, fx);
};

/** 濾鏡／特效卡片上的那張縮圖。算好之前先畫底圖，不會有空洞。 */
const CardThumb: React.FC<{ src: string; cacheKey: string; fx: PhotoFx; delay?: number }> = ({ src, cacheKey, fx, delay = 0 }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let dead = false;
    const paint = () => {
      const cvs = ref.current;
      if (dead || !cvs) return;
      let thumb = cardThumbCache.get(cacheKey);
      if (!thumb) {
        const img = getPreviewImg(src);
        if (!img.naturalWidth) { img.decode?.().then(() => { if (!dead) paint(); }).catch(() => {}); return; }
        const made = makeCardThumb(img, fx);
        if (!made) return;
        if (cardThumbCache.size > 200) cardThumbCache.clear();
        cardThumbCache.set(cacheKey, made);
        thumb = made;
      }
      cvs.width = thumb.width; cvs.height = thumb.height;
      cvs.getContext('2d')!.drawImage(thumb, 0, 0);
    };
    // 一次算 20 幾張會卡住主執行緒，錯開一點點就順了
    const t = setTimeout(paint, delay);
    return () => { dead = true; clearTimeout(t); };
  }, [src, cacheKey, delay]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full object-cover" />;
};

/** 預覽重畫時要馬上有圖可以畫，所以原圖載過一次就留著。 */
const previewImgCache = new Map<string, HTMLImageElement>();
/**
 * 佈局格子的照片。沒有套濾鏡就是原本那張 <img>（完全不變）；
 * 套了就換成 canvas，用跟浮動圖片同一支 applyPhotoFx 算，
 * 外層的裁切、縮放、位移邏輯都不動。
 */
const CellFxImage: React.FC<{
  url: string;
  fx: PhotoFx;
  style: React.CSSProperties;
  lutRevision: number;
  boxW: number;
  boxH: number;
}> = ({ url, fx, style, lutRevision, boxW, boxH }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = getPreviewImg(url);
    const draw = () => {
      if (!img.naturalWidth) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // 算到「畫面上真的有幾個實體像素」，套了濾鏡才不會變糊
      const MAX = Math.min(1600, Math.max(640, Math.round(Math.max(boxW, boxH) * dpr)));
      const ar = img.naturalWidth / img.naturalHeight;
      const w = ar >= 1 ? MAX : Math.max(16, Math.round(MAX * ar));
      const h = ar >= 1 ? Math.max(16, Math.round(MAX / ar)) : MAX;
      const out = applyPhotoFx(img, w, h, fx);
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, w, h);
      g.drawImage(out, 0, 0, w, h);
    };
    if (img.complete && img.naturalWidth) { draw(); return; }
    img.addEventListener('load', draw);
    return () => img.removeEventListener('load', draw);
  }, [url, fx, lutRevision, boxW, boxH]);
  return <canvas ref={ref} style={style} />;
};

/**
 * 頁面縮圖／IG 預覽用的浮動圖片。
 * 跟主預覽走同一組演算法（濾鏡 → 圓角＋羽化遮罩 → 描邊 → 發光），
 * 只是畫在比較小的畫布上 —— 這樣三個地方看到的才會是同一張圖。
 */
const MiniShapeImage: React.FC<{
  img: FloatingImage;
  boxW: number;
  boxH: number;
  glowPad: number;
  style: React.CSSProperties;
  lutRevision: number;
}> = ({ img, boxW, boxH, glowPad, style, lutRevision }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const el = getPreviewImg(img.src);
    const draw = () => {
      if (!el.naturalWidth) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round((boxW + glowPad * 2) * dpr));
      const H = Math.max(1, Math.round((boxH + glowPad * 2) * dpr));
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, W, H);

      const iw = Math.max(1, Math.round(boxW * dpr));
      const ih = Math.max(1, Math.round(boxH * dpr));
      const lw = (img.imgStrokeWidth || 0) * img.scale * dpr;
      const sw = iw + lw * 2, sh = ih + lw * 2;
      const ox = (W - sw) / 2, oy = (H - sh) / 2;

      let base: CanvasImageSource = el;
      if (hasPhotoFx(img.fx)) {
        const ar = el.naturalWidth / el.naturalHeight;
        const MAX = Math.min(1200, Math.max(120, Math.round(Math.max(boxW, boxH) * dpr)));
        const fw = ar >= 1 ? MAX : Math.max(16, Math.round(MAX * ar));
        const fh = ar >= 1 ? Math.max(16, Math.round(MAX / ar)) : MAX;
        base = applyPhotoFx(el, fw, fh, img.fx!);
      }

      let shaped: CanvasImageSource = base;
      let drawW = iw, drawH = ih, drawX = (W - iw) / 2, drawY = (H - ih) / 2;
      if (img.feather || img.imgRadius || img.imgStrokeWidth) {
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(sw));
        off.height = Math.max(1, Math.round(sh));
        const oc = off.getContext('2d');
        if (!oc) return;
        oc.drawImage(base, lw, lw, iw, ih);
        if (img.feather || img.imgRadius) {
          oc.globalCompositeOperation = 'destination-in';
          if (img.feather) {
            oc.drawImage(previewMask(boxW / boxH, img.imgRadius || 0, img.feather), lw, lw, iw, ih);
          } else {
            const R = cornerR(img.imgRadius || 0, iw, ih);
            roundRectPath(oc, lw, lw, iw, ih, R, R);
            oc.fillStyle = '#fff';
            oc.fill();
          }
          oc.globalCompositeOperation = 'source-over';
        }
        if (lw > 0) {
          const rp = img.imgRadius || 0;
          const sr = rp ? cornerR(rp, iw, ih) + lw / 2 : 0;
          roundRectPath(oc, lw / 2, lw / 2, iw + lw, ih + lw, sr, sr);
          oc.lineWidth = lw;
          oc.lineJoin = 'miter';
          oc.miterLimit = 4;
          oc.strokeStyle = img.imgStrokeColor || '#FFFFFF';
          oc.stroke();
        }
        shaped = off;
        drawW = off.width; drawH = off.height; drawX = ox; drawY = oy;
      }

      if (img.imgGlow) {
        const gk = Math.min(1, 420 / Math.max(W, H));
        const glow = makeGlowCanvas(
          shaped, W * gk, H * gk, drawX * gk, drawY * gk, drawW * gk, drawH * gk,
          (img.imgGlow / 20) * GLOW_BLUR_UNIT * img.scale * dpr * gk,
          img.imgGlowColor || '#FFFFFF',
        );
        g.drawImage(glow, 0, 0, W, H);
      }
      g.drawImage(shaped, drawX, drawY, drawW, drawH);
    };
    if (el.complete && el.naturalWidth) { draw(); return; }
    el.addEventListener('load', draw);
    return () => el.removeEventListener('load', draw);
  }, [img.src, img.fx, img.feather, img.imgRadius, img.imgGlow, img.imgGlowColor,
      img.imgStrokeWidth, img.imgStrokeColor, img.scale, boxW, boxH, glowPad, lutRevision]);
  return <canvas ref={ref} style={style} />;
};

const getPreviewImg = (src: string) => {
  let el = previewImgCache.get(src);
  if (!el) {
    el = new Image();
    el.src = src;
    if (previewImgCache.size > 60) previewImgCache.clear();
    previewImgCache.set(src, el);
  }
  return el;
};

interface FloatingImage {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  /** 有 text 就是文字圖層。位置、縮放、旋轉、圖層順序全部沿用圖片那一套。 */
  text?: string;
  fontFamily?: string;
  /** 未縮放狀態下的字級（px），實際大小再乘上 scale */
  fontSize?: number;
  color?: string;
  bold?: boolean;
  /** 斜體。只有該字體真的有斜體字身時才會被打開 */
  italic?: boolean;
  /** 字距（px，未縮放） */
  letterSpacing?: number;
  /** 邊緣發光強度 0~20，0 = 關閉 */
  glow?: number;
  glowColor?: string;
  /** 文字描邊寬度（px，未縮放），0 = 不描邊 */
  strokeWidth?: number;
  strokeColor?: string;
  /** 以下是「圖片調整」分頁的參數，只有圖片圖層會用到 */
  /** 圓角，佔短邊的百分比 0~50（50 = 橢圓） */
  imgRadius?: number;
  /** 邊緣羽化，佔短邊的百分比 0~50 */
  feather?: number;
  /** 圖片邊緣發光強度 0~20 */
  /** 這一層是影片（預覽用 <video> 播、匯出取當下那一格） */
  isVideo?: boolean;
  imgGlow?: number;
  imgGlowColor?: string;
  /** 濾鏡與調節，跟「編輯」共用同一套像素管線 */
  fx?: PhotoFx;
  /** 圖片描邊（相框線）寬度 px（未縮放）與顏色 */
  imgStrokeWidth?: number;
  imgStrokeColor?: string;
  /** 構圖（裁切／旋轉／翻轉）：baked 之前的原圖與參數，重開構圖時從這裡接續 */
  origSrc?: string;
  geo?: GeoParams;
}

type SwapSource = { kind: 'cell'; idx: number; src: string } | { kind: 'floating'; id: string; src: string };
type SwapTarget = { kind: 'cell'; idx: number; layoutId?: string } | { kind: 'floating'; id: string };

interface FloatingImageComponentProps {
  image: FloatingImage;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (updated: Partial<FloatingImage>) => void;
  onDelete: () => void;
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  hasActiveGuidelines?: boolean;
  onDragStart?: () => void;
  onDragMove?: (rawX: number, rawY: number) => void;
  onDragEnd?: () => void;
  onScaleStart?: () => void;
  onScaleMove?: (
    newX: number,
    newY: number,
    newScale: number,
    corner?: 'tl' | 'tr' | 'bl' | 'br',
    pivotContainerX?: number,
    pivotContainerY?: number,
    K_x?: number,
    K_y?: number,
    oppositeLocalX?: number,
    oppositeLocalY?: number
  ) => void;
  onScaleEnd?: () => void;
  isSwapTarget?: boolean;
  isSwapSource?: boolean;
  stackIndex?: number;
  onLayerAction?: (action: 'up' | 'down' | 'delete' | 'copy' | 'edit') => void;
  canLayerUp?: boolean;
  canLayerDown?: boolean;
  /** 下方空間不夠時把工具列翻到物件上方 */
  toolbarAbove?: boolean;
  /** 文字圖層自動貼合寬度時的上限（未縮放像素） */
  maxTextWidth?: number;
  /** 直接在畫布上打字：選中後再點一次就進入這個狀態 */
  isTextEditing?: boolean;
  onTextEditEnd?: () => void;
  /** 雙指縮放／旋轉進行中：工具列先收起來 */
  hideToolbar?: boolean;
  /** 正在拖形狀的滑桿：選取框、四角圓球、工具列全部收起來，邊緣的效果才看得清楚 */
  hideChrome?: boolean;
  /** 濾鏡載完會 +1，用來讓已經套用濾鏡的圖層重畫 */
  lutRevision?: number;
  /** 沒有選取任何東西時交回 pan-x，橫向捲動就由瀏覽器處理，手感跟空白處一致 */
  touchMode?: 'none' | 'pan-x';
  /**
   * 排頁面拖曳中，這一層要跟著自己那一頁一起移動（順便跟著那一頁整組縮小）。
   * live = 正在被手指拖的那一頁（不加動畫），其餘是讓開的頁面（200ms 滑過去）。
   */
  dragShift?: { tx: number; ty: number; s: number; live: boolean } | null;
  onSwapTouchStart?: (e: React.TouchEvent) => void;
  onSwapTouchMove?: (e: React.TouchEvent) => void;
  onSwapTouchEnd?: (e: React.TouchEvent) => void;
  /**
   * 選取框、四角圓球、工具列要改掛到這一層去畫。
   * 這一層是「頁面容器的兄弟」，不在那個 overflow-hidden 底下，
   * 所以物件被拖出畫布邊緣時，框跟按鈕不會被邊緣的黑色切掉 ——
   * 但物件本身仍然留在原本會被裁切的那一層，超出畫布的部分照樣看不到。
   * 拿不到這一層時就退回原本的畫法（掛在自己身上），行為完全不變。
   */
  chromeLayer?: HTMLElement | null;
}

let globalDragPointerId: number | null = null;

const FloatingImageComponent: React.FC<FloatingImageComponentProps> = ({
  image,
  isSelected,
  onSelect,
  onChange,
  onDelete,
  pagesContainerRef,
  hasActiveGuidelines = false,
  onDragStart,
  onDragMove,
  onDragEnd,
  onScaleStart,
  onScaleMove,
  onScaleEnd,
  isSwapTarget = false,
  isSwapSource = false,
  stackIndex = 0,
  onLayerAction,
  canLayerUp = true,
  canLayerDown = true,
  toolbarAbove,
  maxTextWidth,
  isTextEditing = false,
  onTextEditEnd,
  hideToolbar = false,
  hideChrome = false,
  lutRevision = 0,
  touchMode = 'none',
  dragShift = null,
  onSwapTouchStart,
  onSwapTouchMove,
  onSwapTouchEnd,
  chromeLayer = null,
}) => {
  const imageRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isScaling, setIsScaling] = useState(false);
  
  const dragStart = useRef<{ pointerId: number; startX: number; startY: number; imgX: number; imgY: number } | null>(null);
  const rotateStart = useRef<{ pointerId: number; startAngle: number; imgRotation: number } | null>(null);
  const scaleStart = useRef<{
    pointerId: number;
    corner: 'tl' | 'tr' | 'bl' | 'br';
    pivotX: number;
    pivotY: number;
    dragLocalX: number;
    dragLocalY: number;
    oppositeLocalX: number;
    oppositeLocalY: number;
    rotationRad: number;
  } | null>(null);

  const getClientCenter = () => {
    if (!pagesContainerRef.current) return { x: 0, y: 0 };
    const containerRect = pagesContainerRef.current.getBoundingClientRect();
    const cx = containerRect.left + image.x + (image.width * image.scale) / 2;
    const cy = containerRect.top + image.y + (image.height * image.scale) / 2;
    return { x: cx, y: cy };
  };

  const touchStart = useRef<{ x: number, y: number, time: number, pointerId: number } | null>(null);

  // 文字圖層的框跟著內容貼合，選取框才不會離字太遠
  const textRef = useRef<HTMLDivElement>(null);
  const textInnerRef = useRef<HTMLSpanElement>(null);
  const textMeasureRef = useRef<HTMLSpanElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // 進入畫布上打字時把游標移到最後面，並叫出原生鍵盤。
  // 內容還是預設的「輸入文字」就先清空 —— 使用者不用自己一個字一個字刪。
  useEffect(() => {
    if (!isTextEditing) return;
    if (image.text === TEXT_PLACEHOLDER) onChange({ text: '' });
    const el = textAreaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const n = el.value.length;
    try { el.setSelectionRange(n, n); } catch {}
  }, [isTextEditing]);

  // 打完什麼都沒留就把預設字放回去，圖層才不會變成看不見的空框
  const prevTextEditing = useRef(isTextEditing);
  useEffect(() => {
    if (prevTextEditing.current && !isTextEditing && image.text === '') {
      onChange({ text: TEXT_PLACEHOLDER });
    }
    prevTextEditing.current = isTextEditing;
  }, [isTextEditing, image.text]);
  // 量測用的是另一個「永遠 1 倍大」的隱藏 span，跟 scale 完全脫鉤。
  //
  // 而且只有「真的會改變排版的東西」變了才量：以前 onChange 是行內箭頭函式，
  // 每次 render 都是新的參考，捏合的每一格都會跑進來強制同步 reflow
  // （offsetWidth/offsetHeight），手機上就是一邊縮放一邊抖。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dimsRef = useRef({ w: image.width, h: image.height });
  dimsRef.current = { w: image.width, h: image.height };

  /* 這裡一定要用 useLayoutEffect，不能用 useEffect。
     useEffect 是「畫完才跑」：改字級那一幀會先用『新字級 + 舊寬高』畫出來，
     下一幀量到新寬高才修正 —— 拉滑桿時每一格都閃一下，就是這個一幀落差。
     useLayoutEffect 在瀏覽器畫之前就量完並改好，錯的那一幀根本不會上畫面。 */
  useLayoutEffect(() => {
    if (image.text === undefined) return;
    const el = textMeasureRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const patch: Partial<FloatingImage> = {};
      if (Math.abs(w - dimsRef.current.w) > 1) patch.width = Math.round(w);
      if (Math.abs(h - dimsRef.current.h) > 1) patch.height = Math.round(h);
      if (patch.width !== undefined || patch.height !== undefined) onChangeRef.current(patch);
    };
    /* 換字體／換斜體會抖一下，是因為新的字身還沒下載完。這時候量到的是
       退回字體的寬高，先把框改成那個尺寸、等字身到了再改回來 —— 使用者看到
       的就是「跳一次又跳回來」。
       所以：字身已經在手上才立刻量；還沒在的話這一輪先不動框，等真的載好
       再量一次，框就只會變一次。 */
    const fam = image.fontFamily || DEFAULT_FONT;
    const spec = `${image.italic ? 'italic ' : ''}${image.bold ? 700 : 400} ${(image.fontSize || 40)}px "${fam}"`;
    const fontsApi = typeof document !== 'undefined' ? document.fonts : undefined;
    // CSS 還沒到的時候 @font-face 還不存在，check 會拿到「可以」的假答案，
    // 所以要先確認 CSS 真的下載完了才信它。
    /* 斜體還要多確認一件事：斜體的 CSS 也回來了沒。CSS 還沒到的時候
       斜體的 @font-face 根本不存在，check 會配到系統的假斜體然後回「可以」，
       量到的就是假斜體的寬高。 */
    const italicSettled = !image.italic || knownItalic(fam) !== undefined;
    const ready = !fontsApi || (fontCssLoaded(fam) && italicSettled && fontsApi.check(spec));
    if (ready) { measure(); return; }

    let alive = true;
    const done = () => { if (alive) measure(); };
    Promise.all([ensureFont(fam), image.italic ? ensureItalic(fam) : Promise.resolve()])
      .then(() => fontsApi!.load(spec))
      .then(done, done);
    // 真的載不到（離線、家族名打錯）就別讓框永遠停在舊尺寸
    const t = setTimeout(done, 3000);
    return () => { alive = false; clearTimeout(t); };
  }, [image.text, image.fontFamily, image.fontSize, image.bold, image.italic, image.letterSpacing, maxTextWidth]);

  /* 圓角／羽化／發光都自己畫在 canvas 上，預覽與匯出走同一套邏輯 */
  const shapeCanvasRef = useRef<HTMLCanvasElement>(null);
  /* 兩個 dpr 是不同的東西，之前混用是錯的：
       geoDpr —— 螢幕「真正」的實體像素密度。版面盒要吸到它的格線上才叫對齊；
                 iPhone 常見是 3，之前拿被上限砍到 2 的那個去吸等於吸到半格，
                 在 3 倍螢幕上根本沒對齊，縮放時照樣沿路留殘影。
       shapeDpr —— 只決定 canvas 內部要開幾個像素（上限 2 是記憶體考量）。 */
  const geoDpr = Math.min(4, Math.max(1, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
  const shapeDpr = Math.min(2, geoDpr);
  /** 把長度吸到整數個實體像素（見 wrapGeo 的說明） */
  const snapPx = (v: number) => Math.round(v * geoDpr) / geoDpr;
  /** 吸到「偶數個」實體像素 —— 這樣一半也還落在格線上（見 wrapGeo） */
  const snapPx2 = (v: number) => (Math.round((v * geoDpr) / 2) * 2) / geoDpr;
  /** 重畫收斂成一幀一次用的 */
  const rafRef = useRef(0);
  const drawnSrcRef = useRef<string | null>(null);
  const boxW = image.width * image.scale;
  const boxH = image.height * image.scale;
  // 發光與描邊都會超出框，canvas 要留邊。
  // 留邊固定用「最大強度」算：拖發光滑桿時邊界就不會每一格都變，
  // 不然 canvas 的位置與大小一直重算，圖看起來就是在抖。
  // 發光留的是「最大強度的光散到哪裡」，留少了預覽的光會被 canvas 邊界
  // 切掉一個直角，跟匯出也對不起來。
  const glowPad = Math.round(
    ((image.imgGlow ? Math.ceil(GLOW_BLUR_UNIT * GLOW_EXTENT) : 0)
      + (image.imgStrokeWidth ? 20 : 0)) * image.scale,
  );
  // 原圖先在背景解好，第一次切到 canvas 才不會有一格空白（看起來就是閃一下）
  const [shapeImgReady, setShapeImgReady] = useState(false);
  useEffect(() => {
    if (image.text !== undefined || image.isVideo || !image.src) return;
    const el = getPreviewImg(image.src);
    if (el.complete && el.naturalWidth) { setShapeImgReady(true); return; }
    setShapeImgReady(false);
    const on = () => setShapeImgReady(true);
    el.addEventListener('load', on);
    return () => el.removeEventListener('load', on);
  }, [image.src, image.text]);

  // 一旦用過 canvas 就一直用下去。
  // 不然把滑桿拉回 0 的那一格會從 canvas 換成 <img>，新的 <img> 還沒畫上來，
  // 圖片就會整張閃掉一下。值全是 0 的時候 canvas 畫的就是原圖，看起來一樣。
  const usedCanvasRef = useRef(false);
  const wantsShapeCanvas =
    image.text === undefined && !image.isVideo && shapeImgReady
    && !!(image.feather || image.imgRadius || image.imgGlow || image.imgStrokeWidth || hasPhotoFx(image.fx));
  if (wantsShapeCanvas) usedCanvasRef.current = true;
  const needsShapeCanvas =
    image.text === undefined && !image.isVideo && shapeImgReady && usedCanvasRef.current;

  /* 濾鏡／調節算一次就留著。固定用長邊算，捏合時尺寸一直變也不會重算。

     以前拖滑桿時會先降到 380 長邊算一張「快的」，手停下來再補算全尺寸。
     那正是主人說的「拖動滑桿時圖片會有像素感」—— 380 比畫面上真正的實體像素
     少了一大截，拖的過程中看到的就是放大的糊圖。

     現在顏色鏈可以交給 GPU（烤 33³ 的表 2.2ms ＋ 一個 draw call），
     全尺寸本來就跑得動，所以拖曳中與靜止時**用同一個尺寸**：
     畫面上有幾個實體像素就算幾個。拖曳中看到的就是最終那一張。 */
  /* 正式那一張要算到「畫面上真的有幾個實體像素」。
     以前固定 720，比實際顯示的像素少一大截，所以一套上濾鏡或特效，
     照片就明顯變糊。上限 1400 是為了不讓超大格子把一次重算拖太久。 */
  const fxFullMax = () => {
    const dpr = Math.min(2, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);
    return Math.min(1400, Math.max(720, Math.round(Math.max(boxW, boxH) * dpr)));
  };
  const fxCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const fxFastRef = useRef(false);
  /** 上一次 fx 變動的時間，用來分辨「點一下」與「拖滑桿」 */
  const fxLastChangeRef = useRef(0);
  const fxIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fxKeyRef = useRef<string | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { if (fxIdleRef.current) clearTimeout(fxIdleRef.current); }, []);
  const fxSourceFor = (img: HTMLImageElement) => {
    if (!hasPhotoFx(image.fx)) return img as CanvasImageSource;
    const MAX = fxFullMax();
    const key = `${image.src}|${JSON.stringify(image.fx)}|${lutRevision}|${MAX}`;
    const hit = fxCacheRef.current;
    if (hit && hit.key === key) return hit.canvas;
    const aspect = (image.width || 1) / (image.height || 1);
    const fw = aspect >= 1 ? MAX : Math.max(16, Math.round(MAX * aspect));
    const fh = aspect >= 1 ? Math.max(16, Math.round(MAX / aspect)) : MAX;
    const canvas = applyPhotoFx(img, fw, fh, image.fx!);
    fxCacheRef.current = { key, canvas };
    return canvas;
  };

  useLayoutEffect(() => {
    if (!needsShapeCanvas) return;
    const c = shapeCanvasRef.current;
    if (!c) return;
    const img = getPreviewImg(image.src);
    const draw = () => {
      if (!img.naturalWidth) return;
      const dpr = shapeDpr;
      // 用「版面盒吸過之後」的尺寸去推內部像素，兩邊才會剛好整數倍
      const W = Math.max(1, Math.round(snapPx(boxW + glowPad * 2) * dpr));
      const H = Math.max(1, Math.round(snapPx(boxH + glowPad * 2) * dpr));
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, W, H);

      const iw = Math.max(1, Math.round(boxW * dpr));
      const ih = Math.max(1, Math.round(boxH * dpr));
      // 描邊是往外長的，所以形狀那一張要比框大 lw 一圈
      const lw = (image.imgStrokeWidth || 0) * image.scale * dpr;
      const sw = iw + lw * 2;
      const sh = ih + lw * 2;
      const ox = (W - sw) / 2;
      const oy = (H - sh) / 2;

      const base = fxSourceFor(img);
      let shaped: CanvasImageSource = base;
      let drawW = iw, drawH = ih, drawX = (W - iw) / 2, drawY = (H - ih) / 2;
      if (image.feather || image.imgRadius || image.imgStrokeWidth) {
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(sw));
        off.height = Math.max(1, Math.round(sh));
        const oc = off.getContext('2d');
        if (!oc) return;
        // 圖片畫在中間，四周留給描邊
        oc.drawImage(base, lw, lw, iw, ih);
        if (image.feather || image.imgRadius) {
          oc.globalCompositeOperation = 'destination-in';
          if (image.feather) {
            // 有羽化才需要那張模糊過的遮罩；邊本來就是糊的，縮放貼回來看不出差別
            const m = previewMask(boxW / boxH, image.imgRadius || 0, image.feather);
            oc.drawImage(m, lw, lw, iw, ih);
          } else {
            /* 只有圓角、沒有羽化：以前也走那張 400px 的遮罩再拉大，
               硬邊被放大就變成階梯狀的鋸齒。改成直接在這張畫布上填路徑 ——
               原生解析度、瀏覽器自己抗鋸齒，邊緣才會乾淨。 */
            const R = cornerR(image.imgRadius || 0, iw, ih);
            roundRectPath(oc, lw, lw, iw, ih, R, R);
            oc.fillStyle = '#fff';
            oc.fill();
          }
          oc.globalCompositeOperation = 'source-over';
        }
        // 描邊（相框線）：整條線都長在圖片外面，內緣剛好貼著圖片的邊。
        // 圖片沒有圓角就描成直角（miter），不要自己多加一個圓角出來。
        if (lw > 0) {
          const rp = image.imgRadius || 0;
          const sr = rp ? cornerR(rp, iw, ih) + lw / 2 : 0;
          roundRectPath(oc, lw / 2, lw / 2, iw + lw, ih + lw, sr, sr);
          oc.lineWidth = lw;
          oc.lineJoin = 'miter';
          oc.miterLimit = 4;
          oc.strokeStyle = image.imgStrokeColor || '#FFFFFF';
          oc.stroke();
        }
        shaped = off;
        drawW = off.width; drawH = off.height; drawX = ox; drawY = oy;
      }

      // 發光：跟文字同一組模糊半徑（(強度/20)×14 的 ×1、×2、×3 三層）。
      // 光暈本身很平滑，所以算在有上限的小張上再放大貼回來，
      // 留邊變大也不會讓拖滑桿變慢（跟匯出同一招）。
      if (image.imgGlow) {
        const gk = Math.min(1, 420 / Math.max(W, H));
        const glow = makeGlowCanvas(
          shaped, W * gk, H * gk, drawX * gk, drawY * gk, drawW * gk, drawH * gk,
          (image.imgGlow / 20) * GLOW_BLUR_UNIT * image.scale * dpr * gk,
          image.imgGlowColor || '#FFFFFF',
        );
        g.drawImage(glow, 0, 0, W, H);
      }
      g.drawImage(shaped, drawX, drawY, drawW, drawH);
    };
    drawRef.current = draw;
    /* 低解析度那張只給「連續在動」的情況用（拖滑桿）。
       以前只要 fx 值一變就先畫 380 的、220ms 後再換成正式的 ——
       所以「點一下濾鏡」也會先出現一張糊的、再跳成清楚的，看起來就是閃一下。
       改成看距離上一次變動多久：點一下（單一次變動）直接畫正式的，不閃；
       拖滑桿（連續變動）才走快的那條，維持原本的流暢度。 */
    const fxKey = `${JSON.stringify(image.fx)}|${lutRevision}`;
    if (fxKeyRef.current !== null && fxKeyRef.current !== fxKey && hasPhotoFx(image.fx)) {
      const now = Date.now();
      const streaming = now - fxLastChangeRef.current < 260;
      fxLastChangeRef.current = now;
      if (streaming) {
        fxFastRef.current = true;
        if (fxIdleRef.current) clearTimeout(fxIdleRef.current);
        fxIdleRef.current = setTimeout(() => {
          fxIdleRef.current = null;
          fxFastRef.current = false;
          drawRef.current?.();
        }, 220);
      }
    }
    fxKeyRef.current = fxKey;

    if (img.complete && img.naturalWidth) {
      // 拖滑桿時一格會送好幾個 input，每一個都重算就會一頓一頓。
      // 收斂成「最多一幀畫一次、只畫最後那個值」：畫面照樣即時，工作量少很多。
      // 第一次（或換圖）同步畫，不然會空一格。
      if (drawnSrcRef.current !== image.src) {
        drawnSrcRef.current = image.src;
        draw();
      } else {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
      }
      return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
    }
    img.addEventListener('load', draw);
    return () => img.removeEventListener('load', draw);
  }, [
    needsShapeCanvas, image.src, image.feather, image.imgRadius,
    image.imgGlow, image.imgGlowColor, image.imgStrokeWidth, image.imgStrokeColor,
    image.scale, boxW, boxH, glowPad,
    image.fx, lutRevision,
  ]);

  const handleBodyPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      // 觸控的選取一律交給畫布層級統一處理（保證同時只有一個選取目標），
      // 這裡不攔截、也不做選取。
      return;
    }

    e.stopPropagation();
    onSelect();
    
    // Forbid moving two images at the same time
    if (globalDragPointerId !== null && globalDragPointerId !== e.pointerId) {
      return;
    }

    globalDragPointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      imgX: image.x,
      imgY: image.y,
    };
    setIsDragging(true);
    onDragStart?.();
  };

  const handleBodyPointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) {
      if (dragStart.current && globalDragPointerId === dragStart.current.pointerId) {
        globalDragPointerId = null;
      }
      dragStart.current = null;
      setIsDragging(false);
      onDragEnd?.();
      return;
    }
    if (dragStart.current && dragStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      const dx = e.clientX - dragStart.current.startX;
      const dy = e.clientY - dragStart.current.startY;
      const rawX = dragStart.current.imgX + dx;
      const rawY = dragStart.current.imgY + dy;
      if (onDragMove) {
        onDragMove(rawX, rawY);
      } else {
        onChange({
          x: rawX,
          y: rawY,
        });
      }
    }
  };

  const handleBodyPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;

    if (dragStart.current && dragStart.current.pointerId === e.pointerId) {
      if (globalDragPointerId === e.pointerId) {
        globalDragPointerId = null;
      }
      e.stopPropagation();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      dragStart.current = null;
      setIsDragging(false);
      onDragEnd?.();
    }
  };

  const handleRotatePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const center = getClientCenter();
    const currentAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    
    rotateStart.current = {
      pointerId: e.pointerId,
      startAngle: currentAngle,
      imgRotation: image.rotation,
    };
  };

  const handleRotatePointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) {
      rotateStart.current = null;
      return;
    }
    if (rotateStart.current && rotateStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      const center = getClientCenter();
      const currentAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
      const angleDiff = currentAngle - rotateStart.current.startAngle;
      const degDiff = (angleDiff * 180) / Math.PI;
      onChange({
        rotation: (rotateStart.current.imgRotation + degDiff + 360) % 360,
      });
    }
  };

  const handleRotatePointerUp = (e: React.PointerEvent) => {
    if (rotateStart.current && rotateStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      rotateStart.current = null;
    }
  };

  const handleScalePointerDown = (e: React.PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // 拉角落縮放時工具列也先收起來，不然框一長一縮它就會上下換邊
    setIsScaling(true);

    if (!pagesContainerRef.current) return;
    const containerRect = pagesContainerRef.current.getBoundingClientRect();

    const R = (image.rotation * Math.PI) / 180;
    const halfW = image.width / 2;
    const halfH = image.height / 2;

    let dragLocalX = 0;
    let dragLocalY = 0;
    let oppositeLocalX = 0;
    let oppositeLocalY = 0;

    switch (corner) {
      case 'tl':
        dragLocalX = -halfW;
        dragLocalY = -halfH;
        oppositeLocalX = halfW;
        oppositeLocalY = halfH;
        break;
      case 'tr':
        dragLocalX = halfW;
        dragLocalY = -halfH;
        oppositeLocalX = -halfW;
        oppositeLocalY = halfH;
        break;
      case 'bl':
        dragLocalX = -halfW;
        dragLocalY = halfH;
        oppositeLocalX = halfW;
        oppositeLocalY = -halfH;
        break;
      case 'br':
        dragLocalX = halfW;
        dragLocalY = halfH;
        oppositeLocalX = -halfW;
        oppositeLocalY = -halfH;
        break;
    }

    const currentCx = image.x + halfW;
    const currentCy = image.y + halfH;

    const pivotX = currentCx + image.scale * (oppositeLocalX * Math.cos(R) - oppositeLocalY * Math.sin(R));
    const pivotY = currentCy + image.scale * (oppositeLocalX * Math.sin(R) + oppositeLocalY * Math.cos(R));

    scaleStart.current = {
      pointerId: e.pointerId,
      corner,
      pivotX: pivotX + containerRect.left,
      pivotY: pivotY + containerRect.top,
      dragLocalX,
      dragLocalY,
      oppositeLocalX,
      oppositeLocalY,
      rotationRad: R,
    };
    onScaleStart?.();
  };

  const handleScalePointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) {
      scaleStart.current = null;
      onScaleEnd?.();
      return;
    }
    if (scaleStart.current && scaleStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      if (!pagesContainerRef.current) return;
      const containerRect = pagesContainerRef.current.getBoundingClientRect();

      const {
        pivotX,
        pivotY,
        dragLocalX,
        dragLocalY,
        oppositeLocalX,
        oppositeLocalY,
        rotationRad: R,
      } = scaleStart.current;

      const v_px = e.clientX - pivotX;
      const v_py = e.clientY - pivotY;

      const dx_local = dragLocalX - oppositeLocalX;
      const dy_local = dragLocalY - oppositeLocalY;
      const L_local = Math.hypot(dx_local, dy_local);

      if (L_local <= 0) return;

      const dx_rot = dx_local * Math.cos(R) - dy_local * Math.sin(R);
      const dy_rot = dx_local * Math.sin(R) + dy_local * Math.cos(R);

      const u_x = dx_rot / L_local;
      const u_y = dy_rot / L_local;

      const L_projected = v_px * u_x + v_py * u_y;

      const newScale = Math.max(0.1, Math.min(10, L_projected / L_local));

      const oppositeOffsetRotX = oppositeLocalX * Math.cos(R) - oppositeLocalY * Math.sin(R);
      const oppositeOffsetRotY = oppositeLocalX * Math.sin(R) + oppositeLocalY * Math.cos(R);

      const pivotContainerX = pivotX - containerRect.left;
      const pivotContainerY = pivotY - containerRect.top;

      const newCx = pivotContainerX - newScale * oppositeOffsetRotX;
      const newCy = pivotContainerY - newScale * oppositeOffsetRotY;

      const newX = newCx - image.width / 2;
      const newY = newCy - image.height / 2;

      const dx = dragLocalX - oppositeLocalX;
      const dy = dragLocalY - oppositeLocalY;
      const K_x = dx * Math.cos(R) - dy * Math.sin(R);
      const K_y = dx * Math.sin(R) + dy * Math.cos(R);

      if (onScaleMove) {
        onScaleMove(
          newX,
          newY,
          newScale,
          scaleStart.current.corner,
          pivotContainerX,
          pivotContainerY,
          K_x,
          K_y,
          oppositeLocalX,
          oppositeLocalY
        );
      } else {
        onChange({
          scale: newScale,
          x: newX,
          y: newY,
        });
      }
    }
  };

  const handleScalePointerUp = (e: React.PointerEvent) => {
    setIsScaling(false);
    if (scaleStart.current && scaleStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      scaleStart.current = null;
      onScaleEnd?.();
    }
  };

  /* 外框的幾何：選取框那一組要搬到另一層去畫（見 chromeLayer），
     搬過去之後必須落在完全一樣的位置，所以位置／大小／旋轉抽成同一份，
     兩邊共用 —— 不是各算一次，才不會有任何一格的偏差。 */
  const wrapGeo: React.CSSProperties = {
    position: 'absolute',
    // 大小直接寫進版面而不是靠 transform: scale()。用 scale 放大時瀏覽器會沿用
    // 原尺寸的點陣快取再拉大，放大後就糊掉；改成實際尺寸才會用原圖重新取樣。
    // 幾何完全等價：scale 以中心為原點，所以左上角是 x + (w - w*s)/2。
    /* 版面盒一律吸到「整數個實體像素」。
       這一層因為有 transform 而被提升成合成層，合成層的框每一格都在變、而且
       落在小數位置時，瀏覽器算「要重畫哪一塊」是往內取整、實際畫出來的範圍
       卻是往外取整 —— 中間差的那一列永遠不會被重畫，縮放時就沿路留下一條
       一像素的殘影（照片是深色、頁面是白的，看起來就是一根根黑線）。
       吸到整數之後兩邊對齊，殘影就沒有可以躲的地方。 */
    /* 位置要用「中心」推回來，不能位置與大小各吸各的。
       縮放時中心點其實是不動的（x + (w - w·s)/2 + w·s/2 恆等於 x + w/2），
       但左上角與寬高分別吸到格線之後，兩個誤差不同步 —— 中心就會一路上下、
       左右來回抖（模擬一趟 1→3 倍：垂直來回 341 次）。
       改成：寬高先吸到「偶數個」實體像素（一半也還在格線上），再由固定的
       中心點推出左上角。這樣中心不再隨縮放跳動（來回 0 次），四個邊也仍然
       都落在整數實體像素上，殘影的防治沒有變。 */
    ...(() => {
      const cx = image.x + image.width / 2;
      const cy = image.y + image.height / 2;
      const w = snapPx2(image.width * image.scale);
      const h = snapPx2(image.height * image.scale);
      return {
        left: `${snapPx(cx - w / 2)}px`,
        top: `${snapPx(cy - h / 2)}px`,
        width: `${w}px`,
        height: `${h}px`,
      };
    })(),
    transformOrigin: 'center center',
    // 排頁面拖曳中要跟著自己那一頁一起走（平移＋群組縮放），最後才是自己的旋轉
    /* 這裡「一定要」保留 transform（即使旋轉是 0）。
       有 transform 時 Chrome 會把這一層提升成合成層，繪製位置吸附到整數
       像素，邊緣是實心的；拿掉之後改成次像素繪製，貼齊畫布邊緣時邊緣會被
       抗鋸齒抹成半透明的一條，看起來就像沒對齊 —— 而匯出是直接用座標畫在
       canvas 上、不受影響，於是變成「匯出是對的、預覽有誤差」。 */
    /* 只有「真的需要」才給 transform。
       有 transform 這一層就會被提升成合成層；合成層的框在縮放時每一格都在變，
       它讓出來的那一條舊區域瀏覽器常常不會重畫 —— 那就是縮小圖片時邊緣沿路
       留下一根根線的成因。沒有旋轉、也沒有排頁面的群組位移時就不留 transform，
       改走一般繪製，讓出來的區域一定會被重畫。
       （原本留著它是為了讓邊緣吸到整數像素，那件事現在由 snapPx 用「真正的」
       實體像素密度做掉了，不必再靠合成層。） */
    transform: (dragShift || (image.rotation % 360) !== 0)
      ? `${dragShift ? `translate(${dragShift.tx}px, ${dragShift.ty}px) scale(${dragShift.s}) ` : ''}rotate(${image.rotation}deg)`
      : undefined,
    /* 過場一定要跟頁面容器那邊「一模一樣」（220ms、同一條曲線）。
       以前這裡是 200ms ease-out、那邊是 220ms cubic-bezier(0.2,0,0,1)：
       兩者同時起跑卻走不同的速度、也不同時到，排頁面時就會看到圖層跟頁面
       分家 —— 那就是「圖片跟頁面沒有完全同步」的另一半。 */
    transition: dragShift ? (dragShift.live ? 'none' : 'transform 220ms cubic-bezier(0.2,0,0,1)') : undefined,
  };

  /* 選取框、四角圓球、工具列 —— 統稱「外框」。
     這一整組會被搬到 chromeLayer 那一層去畫（那一層不在 overflow-hidden 底下），
     所以物件被拖出畫布時，框跟按鈕不會被邊緣的黑色切掉。
     只有物件本身還留在會被裁切的那一層。 */
  const chrome = (
    <>
    {/* 對齊線亮起來的時候，工具列先收起來 —— 那一刻使用者在看的是「有沒有對齊」，
        白色的按鈕壓在白色的對齊線上會看不清楚。放開手（線消失）就自己回來。 */}
    {isSelected && onLayerAction && !hideToolbar && !hideChrome && !isScaling && !hasActiveGuidelines && (() => {
      // 轉過角度之後要擺在「畫面上最靠下」的那一側：先算旋轉後外接框的半高，
      // 再把工具列沿著畫面的 Y 軸推出去（用區域座標表示，因為這層跟著框一起轉）。
      const rad = (image.rotation * Math.PI) / 180;
      const halfSpan =
        (boxW * Math.abs(Math.sin(rad)) + boxH * Math.abs(Math.cos(rad))) / 2;
      const dir = toolbarAbove ? -1 : 1;
      const d = dir * (halfSpan + 26);
      return (
      <div
        className="absolute left-1/2 top-1/2 flex items-center gap-0.5 bg-white rounded-full p-0.5 shadow-xl pointer-events-auto z-50"
        style={{
          transform: `translate(-50%, -50%) translate(${d * Math.sin(rad)}px, ${d * Math.cos(rad)}px) rotate(${-image.rotation}deg)`,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (canLayerDown) onLayerAction('down'); }}
          disabled={!canLayerDown}
          title="下移一層"
          className={`w-7 h-7 rounded-full flex items-center justify-center ${canLayerDown ? 'text-black hover:bg-black/10' : 'text-black/25 cursor-default'}`}
        >
          <MoveDown size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); if (canLayerUp) onLayerAction('up'); }}
          disabled={!canLayerUp}
          title="上移一層"
          className={`w-7 h-7 rounded-full flex items-center justify-center ${canLayerUp ? 'text-black hover:bg-black/10' : 'text-black/25 cursor-default'}`}
        >
          <MoveUp size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onLayerAction('copy'); }}
          title="複製"
          className="w-7 h-7 rounded-full hover:bg-black/10 flex items-center justify-center text-black"
        >
          <Copy size={14} />
        </button>
        {/* 編輯鍵：文字與圖片都用同一顆（跟佈局那顆同款） */}
        <button
          onClick={(e) => { e.stopPropagation(); onLayerAction('edit'); }}
          title={image.text !== undefined ? '編輯文字' : '圖片調整'}
          className="w-7 h-7 rounded-full hover:bg-black/10 flex items-center justify-center text-black"
        >
          <Sliders size={14} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onLayerAction('delete'); }} title="刪除" className="w-7 h-7 rounded-full hover:bg-black/10 flex items-center justify-center text-black">
          <Trash2 size={14} />
        </button>
      </div>
      );
    })()}

    {/* 選取框與四角圓球：不用「掛載／卸載」切換，改成一直在、用 visibility 開關。
        卸載時瀏覽器偶爾不會重繪那一層（尤其是有 transform 的圖層），
        畫面上就會留下已經取消選取的框與圓球。 */}
    {(() => {
      // 對齊線亮起來時，選取框與四角圓球也一起讓位（跟工具列同一個理由）
      const showChrome = isSelected && !hideChrome && !hasActiveGuidelines;
      /* ── 縮放時陰影會留下殘影，但**不能**用 overflow:hidden 解 ──────────
         問題本身：白色選取框帶一圈 4px 的深色外陰影、四顆圓球也各帶一圈，
         那些都畫在「框的外面」。框在縮放時每一格都在縮，瀏覽器算要重畫哪一塊
         時只看框、不看陰影多出去的那一圈，舊陰影就沒被擦掉，一格留一條。

         我上一版是把這一層 overflow:hidden 裁掉。那確實沒有殘影了，但也把
         「本來就該露在框外面的東西」一起裁掉：
           ① 選取框的外陰影整個不見（所以才被迫改成 inset，看起來完全不一樣）
           ② 四顆圓球是用 translate(-50%,-50%) 掛在四個角上的，四分之三在框外
              —— 被裁成四分之一圓，圖層看起來就很怪。
         這正是主人說的「選中框的圖層很奇怪、影子也不見了」。

         改成正確的做法：把這一層**升成自己的合成層**（translateZ(0) ＋
         will-change）。整層自己重畫，陰影多出去的那一圈也在這一層裡，
         縮放時會整層一起更新，殘影同樣不會留 —— 而且什麼都不必裁。 */
      return (
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          visibility: showChrome ? 'visible' : 'hidden',
          opacity: showChrome ? 1 : 0,
          transform: 'translateZ(0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      >
        {/* Active border matching layout style（深色那一圈是往外畫的，跟原本一樣） */}
        <div className="absolute inset-0 pointer-events-none z-30 border-[0.75px] border-solid border-white/95 shadow-[0_0_4px_rgba(0,0,0,0.3)]" />

        {/* Four Corner scale dots */}
        <div
          className="absolute top-0 left-0 w-3.5 h-3.5 rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.5)] cursor-nwse-resize z-50 pointer-events-auto touch-none"
          style={{ transform: 'translate(-50%, -50%)' }}
          onPointerDown={(e) => handleScalePointerDown(e, 'tl')}
          onPointerMove={handleScalePointerMove}
          onPointerUp={handleScalePointerUp}
          onPointerCancel={handleScalePointerUp}
          title="縮放"
        />
        <div
          className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.5)] cursor-nesw-resize z-50 pointer-events-auto touch-none"
          style={{ transform: 'translate(50%, -50%)' }}
          onPointerDown={(e) => handleScalePointerDown(e, 'tr')}
          onPointerMove={handleScalePointerMove}
          onPointerUp={handleScalePointerUp}
          onPointerCancel={handleScalePointerUp}
          title="縮放"
        />
        <div
          className="absolute bottom-0 left-0 w-3.5 h-3.5 rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.5)] cursor-nesw-resize z-50 pointer-events-auto touch-none"
          style={{ transform: 'translate(-50%, 50%)' }}
          onPointerDown={(e) => handleScalePointerDown(e, 'bl')}
          onPointerMove={handleScalePointerMove}
          onPointerUp={handleScalePointerUp}
          onPointerCancel={handleScalePointerUp}
          title="縮放"
        />
        <div
          className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.5)] cursor-nwse-resize z-50 pointer-events-auto touch-none"
          style={{ transform: 'translate(50%, 50%)' }}
          onPointerDown={(e) => handleScalePointerDown(e, 'br')}
          onPointerMove={handleScalePointerMove}
          onPointerUp={handleScalePointerUp}
          onPointerCancel={handleScalePointerUp}
          title="縮放"
        />

      </div>
      );
    })()}
    </>
  );


  return (
    <>
    <div
      ref={imageRef}
      data-floating-id={image.id}
      className="floating-image-wrapper group/floating"
      style={{
        ...wrapGeo,
        // 要疊在選取時出現的透明拖曳層（z-40）之上，直接碰圖片才拖得動
        // 一般圖片用偶數層，佈局用奇數層，兩者才能互相穿插
        // 被拖的那一頁整組（頁面 900、上面的東西 1000+）要蓋過其他頁
        zIndex: (dragShift?.live ? 1000 : 60) + stackIndex * 2,
        touchAction: touchMode,
      }}
      onTouchStart={onSwapTouchStart}
      onTouchMove={onSwapTouchMove}
      onTouchEnd={onSwapTouchEnd}
      onTouchCancel={onSwapTouchEnd}
    >
      {image.text !== undefined ? (
        <div
          ref={textRef}
          style={{
            width: '100%', minHeight: '100%', pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: fontStack(image.fontFamily),
            fontSize: `${(image.fontSize || 40) * image.scale}px`,
            lineHeight: 1.12,
            fontWeight: image.bold ? 700 : 400,
            fontStyle: image.italic ? 'italic' : 'normal',
            letterSpacing: `${(image.letterSpacing || 0) * image.scale}px`,
            color: image.color || '#FFFFFF',
            // 只有使用者自己按的換行才換行，不自動斷行
            whiteSpace: 'pre',
            wordBreak: 'normal',
            overflowWrap: 'normal',
            textAlign: 'center',
            // 描邊：只描字的外圍輪廓。-webkit-text-stroke 是沿著輪廓中線描，
            // 一半會吃進字身，看起來像每一筆都被描了一圈。改成 paint-order
            // 把描邊畫在填色「下面」、寬度加倍 —— 字身蓋住內半邊，
            // 剩下的就是純外描邊。
            WebkitTextStrokeWidth: image.strokeWidth ? `${image.strokeWidth * 2 * image.scale}px` : undefined,
            WebkitTextStrokeColor: image.strokeWidth ? (image.strokeColor || '#FFFFFF') : undefined,
            // 沒有描邊時不要留著 paint-order。
            paintOrder: image.strokeWidth ? 'stroke fill' : undefined,
            /* 發光不畫在這一層。text-shadow 的輪廓是「填色＋描邊」合起來的形狀，
               所以一旦加了描邊，光就沿著描邊的外緣散開 —— 看起來就是描邊突然
               變粗一大圈。匯出那邊是「先用填色的形狀畫光、再畫描邊、最後填色」，
               兩邊對不起來。改成下面另外疊一層只有光的文字，跟匯出同一套順序。 */
            textShadow: 'none',
            boxSizing: 'border-box',
          }}
        >
          {/* 發光層：疊在主層底下，只負責發光。發光跟描邊是兩件獨立的事 ——
              這一層把描邊明確歸零（-webkit-text-stroke 會從外層繼承下來，
              不歸零的話這一層也會被描到），所以光永遠只從「字身本來的輪廓」
              散出去，描邊粗細完全不參與計算：只調發光跟同時開描邊，看到的
              光一模一樣。

              用 text-shadow、而且只用「一層」，是刻意的：
              ① text-shadow 是文字墨跡的一部分，不會建立合成層、不會有
                 filter 的濾鏡區域，所以不會在光暈外圍被裁出一條硬邊；
              ② 疊多層會讓字緣的抗鋸齒像素重複合成（0.5 疊三次變 0.875），
                 在柔和的光暈上就浮出一圈明顯的分割線。
              三段模糊半徑寫在同一個 text-shadow 裡，濃度跟原本一樣，
              但整層只畫一次，邊緣乾淨。 */}
          {!!image.glow && (
            <span
              aria-hidden
              style={{
                position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none', whiteSpace: 'pre', textAlign: 'center',
                color: image.color || '#FFFFFF',
                // 這一層絕對不描邊，光才不會算到描邊的部分
                WebkitTextStrokeWidth: 0,
                paintOrder: 'normal',
                textShadow: [1, 2, 3]
                  .map(k => `0 0 ${(image.glow! / 20) * 14 * k * image.scale}px ${image.glowColor || '#FFFFFF'}`)
                  .join(', '),
                visibility: isTextEditing ? 'hidden' : undefined,
              }}
            >
              {image.text}
            </span>
          )}

          <span
            ref={textInnerRef}
            style={{
              display: 'inline-block',
              // 主層要蓋在發光層上面
              position: 'relative', zIndex: 1,
              // width: max-content 才能不受外框寬度限制地量到真正需要的寬度，
              // 否則框被縮到上一次的寬度之後，文字就會一直卡在那個寬度換行
              width: 'max-content',
              // 外層是 flex，不擋住收縮的話這個 span 會被壓回外框寬度而提早換行
              flexShrink: 0,
              // 不設寬度上限：文字只在使用者自己換行的地方斷，
              // 有上限的話 pre 會直接被裁掉而不是換行。
              whiteSpace: 'pre',
              // 打字時字還是由這個 span 撐出版面（框才會跟著長），
              // 只是讓位給上面那層真正在收鍵盤輸入的 textarea
              visibility: isTextEditing ? 'hidden' : undefined,
            }}
          >
            {image.text}
          </span>

          {/* 量測專用：永遠 1 倍大、不參與版面，框的寬高只看它 */}
          <span
            ref={textMeasureRef}
            aria-hidden
            style={{
              position: 'absolute', left: 0, top: 0,
              visibility: 'hidden', pointerEvents: 'none',
              display: 'inline-block', width: 'max-content',
              whiteSpace: 'pre', wordBreak: 'normal', overflowWrap: 'normal',
              fontFamily: fontStack(image.fontFamily),
              fontSize: `${image.fontSize || 40}px`,
              fontWeight: image.bold ? 700 : 400,
              fontStyle: image.italic ? 'italic' : 'normal',
              letterSpacing: `${image.letterSpacing || 0}px`,
              lineHeight: 1.12,
            }}
          >
            {/* 內容是空的（剛點進去打字、預設字被清掉）就拿預設那四個字來量，
                框才會維持原本的大小，等真的打了字再照打的內容量 */}
            {image.text === '' ? TEXT_PLACEHOLDER : image.text}
          </span>

          {/* 直接在畫布上打字：疊一層一模一樣排版的 textarea，
              原生鍵盤與游標都交給它，內容仍然即時寫回圖層 */}
          {isTextEditing && (
            <textarea
              ref={textAreaRef}
              value={image.text}
              // 關掉軟換行，打字時看到的斷行才跟收工後一樣
              wrap="off"
              onChange={e => onChange({ text: e.target.value })}
              onBlur={() => onTextEditEnd?.()}
              onPointerDown={e => e.stopPropagation()}
              // 單指是在編輯文字，不要被畫布搶走；兩指則讓畫布接手，
              // 這樣打字中也還能直接縮放／旋轉
              onTouchStart={e => { if (e.touches.length < 2) e.stopPropagation(); }}
              onTouchMove={e => { if (e.touches.length < 2) e.stopPropagation(); }}
              style={{
                position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
                margin: 0, padding: 0, border: 'none', outline: 'none', resize: 'none',
                background: 'transparent', overflow: 'hidden', pointerEvents: 'auto',
                font: 'inherit', fontFamily: 'inherit', fontSize: 'inherit',
                fontWeight: 'inherit', letterSpacing: 'inherit', lineHeight: 'inherit',
                color: 'inherit', textAlign: 'center', whiteSpace: 'pre',
                caretColor: image.color || '#FFFFFF',
                zIndex: 45,
              }}
            />
          )}
        </div>
      ) : needsShapeCanvas ? (
        // 圓角／羽化／發光都畫在 canvas 上。用 CSS 遮罩的話每動一格滑桿就要
        // 重新解碼一張遮罩圖，畫面會一閃一閃；canvas 是同一格畫完才送出，不會閃。
        // 發光也才能跟文字一樣「同一個來源疊三層」，而不是一層陰影再套一層。
        <canvas
          ref={shapeCanvasRef}
          style={{
            position: 'absolute',
            left: `${-glowPad}px`,
            top: `${-glowPad}px`,
            /* 版面尺寸要對齊實體像素格線。
               內部畫布是 round((boxW+2pad)×dpr) 個像素，但 CSS 這裡本來寫的是
               沒有捨入的浮點寬高 —— 兩者對不上時瀏覽器會用非整數倍率重取樣，
               最外面那一列就跟外面的透明混在一起，縮放的過程中沿路留下一條
               忽隱忽現的細線。改成用「同一個捨入結果 ÷ dpr」，倍率剛好是 1:1。 */
            width: `${snapPx(boxW + glowPad * 2)}px`,
            height: `${snapPx(boxH + glowPad * 2)}px`,
            pointerEvents: 'none',
          }}
        />
      ) : image.isVideo ? (
        // 影片直接交給瀏覽器播：預覽就是原生解析度（不是縮圖也不是逐格轉貼圖），
        // 所以拖大拖小都還是清楚的。
        <video
          src={image.src}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          /* 這裡是 fill 不是 contain：匯出是 drawImage(src, x, y, w, h)，直接把圖填滿
             整個框、不留信箱邊。預覽如果用 contain，只要圖層框的長寬比跟原圖差一點點
             （匯入時取整就會差），四周就會多出零點幾 px 的空白 —— 貼齊畫布邊緣時那就
             是一條白縫，而匯出沒有。用 fill 才跟匯出一致。 */
          style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
        />
      ) : (
        <img
          src={image.src}
          alt="floating-item"
          style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
        />
      )}

      {/* 拖曳來源與拖放目標都只是變暗，不用半透明也不加白框 */}
      {(isSwapTarget || isSwapSource) && (
        <div
          data-dim-overlay="1"
          className="absolute inset-0 pointer-events-none z-40"
          style={{ backgroundColor: isSwapTarget ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)' }}
        />
      )}
      
      <div
        className="absolute inset-0 cursor-move"
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handleBodyPointerMove}
        onPointerUp={handleBodyPointerUp}
        onPointerCancel={handleBodyPointerUp}
      />

      {/* 拿不到外框層時就照原本的方式掛在自己身上，行為完全不變 */}
      {!chromeLayer && chrome}
    </div>

      {chromeLayer && createPortal(
        <div
          data-floating-id={image.id}
          className="floating-image-chrome"
          style={{
            ...wrapGeo,
            /* 這一層只是外框的容器，本身不接手勢：
               只有圓球與工具列自己開 pointer-events，其餘一律穿透下去，
               點在框裡面時仍然是打到底下那個物件（拖曳手感完全不變）。 */
            pointerEvents: 'none',
            /* 外框永遠畫在最上面。頁面容器沒有自成堆疊環境（position: relative、
               z-index: auto），所以裡面那些 60～1000+ 的圖層是跟這一層平起平坐地
               比大小的 —— 要壓過它們就得比最大的那個還高。 */
            zIndex: 100000 + stackIndex * 2,
          }}
        >
          {chrome}
        </div>,
        chromeLayer,
      )}
    </>
  );
};

interface GridLayoutToolProps {
  onHome: () => void;
  onImportNew?: () => void;
  initialFiles?: File[];
  /** 濾鏡清單，跟「編輯」用的是同一份 */
  lutList?: { id: string; name: string; url: string }[];
}

export const GridLayoutTool: React.FC<GridLayoutToolProps> = ({ onHome, onImportNew, initialFiles, lutList = [] }) => {
  /** 一頁上可以放多個佈局，每個佈局都是一個獨立物件（跟一般圖片一樣）。 */
  interface LayoutItem {
    id: string;
    templateIndex: number;
    images: ImageCell[];
    /** 佈局在頁面上的位移與縮放。新增時預設佔頁面七分滿。 */
    t: { x: number; y: number; scale: number; rot?: number };
    /** 圖層堆疊位置：0 = 在所有一般圖片下方，N = 在全部上方。 */
    z: number;
    /** 這個佈局自己的長寬比（'3:4' 之類）。沒設就跟整頁一樣。 */
    ratio?: string;
    /** 這個佈局自己的比例是不是橫過來 */
    landscape?: boolean;
    /** 間距與圓角都是各佈局自己的設定，調整不會影響之後新增的佈局。 */
    gap: number;
    radius: number;
  }

  interface PageConfig {
    id: string;
    bgColor: string;
    layouts: LayoutItem[];
  }

  const [pages, setPages] = useState<PageConfig[]>(() => [
    { id: 'page-1', bgColor: '#ffffff', layouts: [] }
  ]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [floatingImages, setFloatingImages] = useState<FloatingImage[]>([]);
  const [selectedFloatingId, setSelectedFloatingId] = useState<string | null>(null);
  const [activeGuidelines, setActiveGuidelines] = useState<AlignmentGuideline[]>([]);
  const [enableSnapping, setEnableSnapping] = useState(true);
  /** 上方那顆三個點的選單 */
  const [moreOpen, setMoreOpen] = useState(false);
  /** IG 貼文預覽 */
  const [igPreview, setIgPreview] = useState(false);

  const workspacePointerDown = useRef<{ x: number, y: number, time: number, onBlank?: boolean, movesObject?: boolean } | null>(null);
  /** 這個位置是空白嗎（不是圖層、不是格子、也不是佈局） */
  const isBlankTarget = (t: Element | null) =>
    !t || (!t.closest('[data-floating-id]') && !t.closest('[data-cell-id]') && !t.closest('[data-layout-wrapper]'));
  const globalFloatingTouchState = useRef<{
    startX: number;
    startY: number;
    startImgX: number;
    startImgY: number;
    startDist?: number;
    startScale?: number;
    isDragging: boolean;
    isPinching: boolean;
  } | null>(null);

  const getPageRect = (pageIdx: number) => {
    if (!pagesContainerRef.current) return null;
    const activePageEl = document.getElementById(pageIdx === 0 ? "grid-preview-container" : `grid-preview-container-${pageIdx}`);
    if (!activePageEl) {
      return {
        left: 0,
        right: previewW,
        top: 0,
        bottom: previewH,
        centerX: previewW / 2,
        centerY: previewH / 2,
        width: previewW,
        height: previewH,
      };
    }
    const containerRect = pagesContainerRef.current.getBoundingClientRect();
    const pageRect = activePageEl.getBoundingClientRect();
    
    const left = pageRect.left - containerRect.left;
    const top = pageRect.top - containerRect.top;
    const width = pageRect.width;
    const height = pageRect.height;
    
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      centerX: left + width / 2,
      centerY: top + height / 2,
      width,
      height,
    };
  };

  const getActivePageRect = () => getPageRect(activePageIndex);

  const getAllPageRects = () => {
    if (!pagesContainerRef.current) return [];
    const containerRect = pagesContainerRef.current.getBoundingClientRect();
    
    return pages.map((page, pageIdx) => {
      const pageEl = document.getElementById(pageIdx === 0 ? "grid-preview-container" : `grid-preview-container-${pageIdx}`);
      if (!pageEl) {
        const left = pageIdx * (previewW + 1);
        return {
          left,
          top: 0,
          right: left + previewW,
          bottom: previewH,
          centerX: left + previewW / 2,
          centerY: previewH / 2,
          width: previewW,
          height: previewH,
          pageIdx,
        };
      }
      const pageRect = pageEl.getBoundingClientRect();
      const left = pageRect.left - containerRect.left;
      const top = pageRect.top - containerRect.top;
      const width = pageRect.width;
      const height = pageRect.height;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        centerX: left + width / 2,
        centerY: top + height / 2,
        width,
        height,
        pageIdx,
      };
    });
  };

  /**
   * 只回傳「物件目前所在的那一頁」的邊界。
   *
   * 相鄰兩頁中間留了 1px 的分隔（stride = previewW + 1），所以上一頁的右緣和
   * 下一頁的左緣是兩個相差 1px 的獨立吸附點 —— 拖過去時會亮一次、再往前 1px
   * 又亮一次，看起來就像同一條邊觸發了兩次。改成只跟自己這一頁對齊之後，
   * 一條邊就只有一個吸附位置。
   * 中心點不在任何一頁上（例如拖到頁面外的空白處）時退回全部，行為跟以前一樣。
   */
  const pageRectsNear = (rects: ReturnType<typeof getAllPageRects>, centerX: number) => {
    const own = rects.filter(r => centerX >= r.left - 0.5 && centerX <= r.right + 0.5);
    return own.length ? own : rects;
  };

  /** 同一條線只留一份（吸附挑到的那條可能跟下面重新掃出來的重複） */
  const dedupeGuidelines = (list: AlignmentGuideline[]) => {
    const seen = new Set<string>();
    return list.filter(g => {
      const k = `${g.type}|${Math.round(g.coord * 10)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  /**
   * 在指定位置上，列出「現在真的對齊到」的畫布輔助線：
   * 垂直中線、水平中線、以及畫布的四個邊界。
   * 吸附時邊界會刻意外溢 1px 防止次像素縫，所以邊界的容許值放寬一點。
   */
  /** 旋轉之後真正佔的框（外接矩形）。0/180 度就是原本的寬高，90 度會對調。 */
  const rotExtent = (w: number, h: number, rot: number) => {
    const r = ((rot || 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
    return { bw: w * c + h * sn, bh: w * sn + h * c };
  };

  const pageGuidelinesAt = (
    x: number, y: number, imgWidth: number, imgHeight: number, scale: number, edgeOnly = false, rot = 0,
  ): AlignmentGuideline[] => {
    const out: AlignmentGuideline[] = [];
    // 轉過的圖要用外接矩形去比，不然線會亮在離邊緣半個身子的地方
    const { bw: scaledW, bh: scaledH } = rotExtent(imgWidth * scale, imgHeight * scale, rot);
    const cx = x + imgWidth / 2;
    const cy = y + imgHeight / 2;
    const left = cx - scaledW / 2, right = cx + scaledW / 2;
    const top = cy - scaledH / 2, bottom = cy + scaledH / 2;
    const EPS_C = 0.75;   // 中線是精準吸附
    /* 貼齊是「剛好對齊、不外溢」，容差只留給次像素捨入。
       超過就代表真的有縫（或真的超出去），那就不該畫線 —— 不然會出現
       「線亮了、圖卻沒真的貼上去」的落差。 */
    const EPS_E = 0.6;
    pageRectsNear(getAllPageRects(), cx).forEach(pr => {
      if (!edgeOnly && Math.abs(cx - pr.centerX) < EPS_C) out.push({ type: 'vertical', coord: pr.centerX });
      if (Math.abs(left - pr.left) < EPS_E) out.push({ type: 'vertical', coord: pr.left });
      if (Math.abs(right - pr.right) < EPS_E) out.push({ type: 'vertical', coord: pr.right });
      if (!edgeOnly && Math.abs(cy - pr.centerY) < EPS_C) out.push({ type: 'horizontal', coord: pr.centerY });
      if (Math.abs(top - pr.top) < EPS_E) out.push({ type: 'horizontal', coord: pr.top });
      if (Math.abs(bottom - pr.bottom) < EPS_E) out.push({ type: 'horizontal', coord: pr.bottom });
    });
    return out;
  };

  const applySnapping = (
    imgId: string,
    rawX: number,
    rawY: number,
    imgWidth: number,
    imgHeight: number,
    imgScale: number,
    edgeOnly?: boolean,
    rot = 0
  ) => {
    if (!enableSnapping) {
      return { snappedX: rawX, snappedY: rawY, fitScale: undefined, guidelines: [] };
    }
    // 只跟自己所在的那一頁對齊：隔壁頁的邊界只差 1px，兩個都留著會讓同一條邊
    // 出現兩個吸附位置（拖過去亮一次、再往前 1px 又亮一次）
    const pageRects = pageRectsNear(getAllPageRects(), rawX + imgWidth / 2);
    if (pageRects.length === 0) {
      return { snappedX: rawX, snappedY: rawY, fitScale: undefined, guidelines: [] };
    }

    const SNAP_THRESHOLD = 4; // Snapping threshold reduced to 4px
    const ownPageRectsForFit = pageRects;
    // 轉過的圖一律用外接矩形判定（跟創意拼圖同一套）
    const { bw: scaledW, bh: scaledH } = rotExtent(imgWidth * imgScale, imgHeight * imgScale, rot);

    // Center coordinates for raw input
    const rawCenterX = rawX + imgWidth / 2;
    const rawCenterY = rawY + imgHeight / 2;

    // Edges for raw input
    const rawLeft = rawCenterX - scaledW / 2;
    const rawRight = rawCenterX + scaledW / 2;
    const rawTop = rawCenterY - scaledH / 2;
    const rawBottom = rawCenterY + scaledH / 2;

    let snappedX = rawX;
    let snappedY = rawY;
    const guidelines: AlignmentGuideline[] = [];

    // 1. Vertical snapping (determines snappedX)
    let minDiffX = Infinity;
    let bestSnapX = rawX;
    let bestGuidelineX: number | null = null;

    // Check ALL pages' boundaries (centerX, left edge, right edge)
    pageRects.forEach(pageRect => {
      // Page centerX (only if not edgeOnly)
      if (!edgeOnly) {
        const diffCenterX = rawCenterX - pageRect.centerX;
        if (Math.abs(diffCenterX) < SNAP_THRESHOLD && Math.abs(diffCenterX) < Math.abs(minDiffX)) {
          minDiffX = diffCenterX;
          bestSnapX = pageRect.centerX - imgWidth / 2;
          bestGuidelineX = pageRect.centerX;
        }
      }

      // Page left edge
      const diffLeft = rawLeft - pageRect.left;
      if (Math.abs(diffLeft) < SNAP_THRESHOLD && Math.abs(diffLeft) < Math.abs(minDiffX)) {
        minDiffX = diffLeft;
        /* 往外多半個像素：剛好貼齊時邊緣落在非整數像素上，抗鋸齒會讓最外面
           那一列露出底下的頁面白色，看起來就是一條髮絲白縫。半個像素肉眼看不
           出來，也不會像原本的 1px 那樣溢到隔壁頁。 */
        bestSnapX = pageRect.left - imgWidth / 2 + scaledW / 2;
        bestGuidelineX = pageRect.left;
      }

      // Page right edge
      const diffRight = rawRight - pageRect.right;
      if (Math.abs(diffRight) < SNAP_THRESHOLD && Math.abs(diffRight) < Math.abs(minDiffX)) {
        minDiffX = diffRight;
        bestSnapX = pageRect.right - imgWidth / 2 - scaledW / 2;
        bestGuidelineX = pageRect.right;
      }
    });

    // Image-to-image vertical edge snapping
    floatingImages.forEach(other => {
      if (other.id === imgId) return;

      const otherW = rotExtent(other.width * other.scale, other.height * other.scale, other.rotation || 0).bw;
      const otherCenterX = other.x + other.width / 2;
      const otherLeft = otherCenterX - otherW / 2;
      const otherRight = otherCenterX + otherW / 2;

      // Center-to-center alignment
      const diffCCX = rawCenterX - otherCenterX;
      if (Math.abs(diffCCX) < SNAP_THRESHOLD && Math.abs(diffCCX) < Math.abs(minDiffX)) {
        minDiffX = diffCCX;
        bestSnapX = otherCenterX - imgWidth / 2;
        bestGuidelineX = otherCenterX;
      }

      // Current Left edge with other Left edge
      const diffLL = rawLeft - otherLeft;
      if (Math.abs(diffLL) < SNAP_THRESHOLD && Math.abs(diffLL) < Math.abs(minDiffX)) {
        minDiffX = diffLL;
        bestSnapX = otherLeft - imgWidth / 2 + scaledW / 2;
        bestGuidelineX = otherLeft;
      }
      // Current Left edge with other Right edge
      const diffLR = rawLeft - otherRight;
      if (Math.abs(diffLR) < SNAP_THRESHOLD && Math.abs(diffLR) < Math.abs(minDiffX)) {
        minDiffX = diffLR;
        // Bleed 1px to overlap and prevent subpixel edge gap
        bestSnapX = otherRight - imgWidth / 2 + scaledW / 2 - 1;
        bestGuidelineX = otherRight;
      }
      // Current Right edge with other Left edge
      const diffRL = rawRight - otherLeft;
      if (Math.abs(diffRL) < SNAP_THRESHOLD && Math.abs(diffRL) < Math.abs(minDiffX)) {
        minDiffX = diffRL;
        // Bleed 1px to overlap and prevent subpixel edge gap
        bestSnapX = otherLeft - imgWidth / 2 - scaledW / 2 + 1;
        bestGuidelineX = otherLeft;
      }
      // Current Right edge with other Right edge
      const diffRR = rawRight - otherRight;
      if (Math.abs(diffRR) < SNAP_THRESHOLD && Math.abs(diffRR) < Math.abs(minDiffX)) {
        minDiffX = diffRR;
        bestSnapX = otherRight - imgWidth / 2 - scaledW / 2;
        bestGuidelineX = otherRight;
      }
    });

    if (bestGuidelineX !== null) {
      snappedX = bestSnapX;
      guidelines.push({ type: 'vertical', coord: bestGuidelineX });
      /* 貼齊之後再把「視覺邊緣」對到實體像素格線上。邊緣落在非整數的實體像素時，
         瀏覽器會把最外面那一列跟底下的頁面白色混在一起，看起來就是一條髮絲白線
         （只有預覽會，匯出是畫在 canvas 上）。往外捨入，最多只多蓋一個實體像素 ——
         3 倍螢幕上是 0.33 CSS px，看不出凸出去。 */
      const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const leftEdge = snappedX + imgWidth / 2 - scaledW / 2;
      const rightEdge = leftEdge + scaledW;
      if (Math.abs(leftEdge - bestGuidelineX) < 0.51) {
        snappedX += (Math.floor(leftEdge * dpr) / dpr) - leftEdge;
      } else if (Math.abs(rightEdge - bestGuidelineX) < 0.51) {
        snappedX += (Math.ceil(rightEdge * dpr) / dpr) - rightEdge;
      }
    }
    /* 圖層比頁面「幾乎一樣寬」時，左緣貼齊與右緣貼齊是兩個相差零點幾 px 的位置，
       從哪一邊靠過去就吸到哪一個 —— 那就是「由外而內沒縫、由內而外有縫」。
       這種情況直接把圖擺成「兩邊都不露白」：以較寬的那一側為準置中對齊。 */
    ownPageRectsForFit.forEach(pr => {
      const w = pr.right - pr.left;
      if (Math.abs(scaledW - w) < 2 && Math.abs((snappedX + imgWidth / 2) - pr.centerX) < 4) {
        snappedX = pr.centerX - imgWidth / 2;
      }
    });
    /* 圖層已經「幾乎剛好等於整頁」時，光把位置對準還不夠 —— 只要比頁面窄零點幾
       px，置中之後兩側各留 0.25px，抗鋸齒就會把那條縫顯示出來。這裡順便回報一個
       「確實覆蓋整頁再多半個像素」的倍率，讓拖曳也能把最後那一點補起來。
       頁面本來就會裁掉超出的部分，所以多蓋的完全看不到。 */
    // 2. Horizontal snapping (determines snappedY)
    let minDiffY = Infinity;
    let bestSnapY = rawY;
    let bestGuidelineY: number | null = null;

    // Check ALL pages' boundaries (centerY, top edge, bottom edge)
    pageRects.forEach(pageRect => {
      // Page centerY (only if not edgeOnly)
      if (!edgeOnly) {
        const diffCenterY = rawCenterY - pageRect.centerY;
        if (Math.abs(diffCenterY) < SNAP_THRESHOLD && Math.abs(diffCenterY) < Math.abs(minDiffY)) {
          minDiffY = diffCenterY;
          bestSnapY = pageRect.centerY - imgHeight / 2;
          bestGuidelineY = pageRect.centerY;
        }
      }

      // Page top edge
      const diffTop = rawTop - pageRect.top;
      if (Math.abs(diffTop) < SNAP_THRESHOLD && Math.abs(diffTop) < Math.abs(minDiffY)) {
        minDiffY = diffTop;
        // Bleed 1px outwards (top) to prevent subpixel edge gap in browser preview
        bestSnapY = pageRect.top - imgHeight / 2 + scaledH / 2;
        bestGuidelineY = pageRect.top;
      }

      // Page bottom edge
      const diffBottom = rawBottom - pageRect.bottom;
      if (Math.abs(diffBottom) < SNAP_THRESHOLD && Math.abs(diffBottom) < Math.abs(minDiffY)) {
        minDiffY = diffBottom;
        // Bleed 1px outwards (bottom) to prevent subpixel edge gap in browser preview
        bestSnapY = pageRect.bottom - imgHeight / 2 - scaledH / 2;
        bestGuidelineY = pageRect.bottom;
      }
    });

    // Image-to-image horizontal edge snapping
    floatingImages.forEach(other => {
      if (other.id === imgId) return;

      const otherH = rotExtent(other.width * other.scale, other.height * other.scale, other.rotation || 0).bh;
      const otherCenterY = other.y + other.height / 2;
      const otherTop = otherCenterY - otherH / 2;
      const otherBottom = otherCenterY + otherH / 2;

      // Center-to-center alignment
      const diffCCY = rawCenterY - otherCenterY;
      if (Math.abs(diffCCY) < SNAP_THRESHOLD && Math.abs(diffCCY) < Math.abs(minDiffY)) {
        minDiffY = diffCCY;
        bestSnapY = otherCenterY - imgHeight / 2;
        bestGuidelineY = otherCenterY;
      }

      // Current Top edge with other Top edge
      const diffTT = rawTop - otherTop;
      if (Math.abs(diffTT) < SNAP_THRESHOLD && Math.abs(diffTT) < Math.abs(minDiffY)) {
        minDiffY = diffTT;
        bestSnapY = otherTop - imgHeight / 2 + scaledH / 2;
        bestGuidelineY = otherTop;
      }
      // Current Top edge with other Bottom edge
      const diffTB = rawTop - otherBottom;
      if (Math.abs(diffTB) < SNAP_THRESHOLD && Math.abs(diffTB) < Math.abs(minDiffY)) {
        minDiffY = diffTB;
        // Bleed 1px to overlap and prevent subpixel edge gap
        bestSnapY = otherBottom - imgHeight / 2 + scaledH / 2 - 1;
        bestGuidelineY = otherBottom;
      }
      // Current Bottom edge with other Top edge
      const diffBT = rawBottom - otherTop;
      if (Math.abs(diffBT) < SNAP_THRESHOLD && Math.abs(diffBT) < Math.abs(minDiffY)) {
        minDiffY = diffBT;
        // Bleed 1px to overlap and prevent subpixel edge gap
        bestSnapY = otherTop - imgHeight / 2 - scaledH / 2 + 1;
        bestGuidelineY = otherTop;
      }
      // Current Bottom edge with other Bottom edge
      const diffBB = rawBottom - otherBottom;
      if (Math.abs(diffBB) < SNAP_THRESHOLD && Math.abs(diffBB) < Math.abs(minDiffY)) {
        minDiffY = diffBB;
        bestSnapY = otherBottom - imgHeight / 2 - scaledH / 2;
        bestGuidelineY = otherBottom;
      }
    });

    if (bestGuidelineY !== null) {
      snappedY = bestSnapY;
      guidelines.push({ type: 'horizontal', coord: bestGuidelineY });
      const dprY = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const topEdge = snappedY + imgHeight / 2 - scaledH / 2;
      const bottomEdge = topEdge + scaledH;
      if (Math.abs(topEdge - bestGuidelineY) < 0.51) {
        snappedY += (Math.floor(topEdge * dprY) / dprY) - topEdge;
      } else if (Math.abs(bottomEdge - bestGuidelineY) < 0.51) {
        snappedY += (Math.ceil(bottomEdge * dprY) / dprY) - bottomEdge;
      }
    }
    ownPageRectsForFit.forEach(pr => {
      const h = pr.bottom - pr.top;
      if (Math.abs(scaledH - h) < 2 && Math.abs((snappedY + imgHeight / 2) - pr.centerY) < 4) {
        snappedY = pr.centerY - imgHeight / 2;
      }
    });


    /* 貼齊只會挑「最近的那一條」來吸附，但畫面上該顯示的是「現在同時對齊的每一條」：
       例如剛好卡在畫布正中央時，垂直中線與水平中線要一起亮起來；貼齊左邊界時，
       如果高度也剛好跟畫布同高，上下兩條邊界線也要一起顯示。
       這裡在「已經吸附完的位置」上把畫布的中線與四個邊界重新對一次，全部符合的
       都加進去。跟其他物件的對齊線不列入（那是另一回事，維持原本只顯示吸附到的那一條）。 */
    guidelines.push(...pageGuidelinesAt(snappedX, snappedY, imgWidth, imgHeight, imgScale, edgeOnly, rot));

    return { snappedX, snappedY, fitScale: undefined, guidelines: dedupeGuidelines(guidelines) };
  };

  const [draggedFloatingIndex, setDraggedFloatingIndex] = useState<number | null>(null);

  const handleReorder = (fromIndex: number, toIndex: number) => {
    setFloatingImages(prev => {
      const result = [...prev];
      if (fromIndex < 0 || fromIndex >= result.length || toIndex < 0 || toIndex >= result.length) {
        return prev;
      }
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return result;
    });
  };
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  /**
   * 「外框層」。
   *
   * 頁面容器（pagesContainerRef）是開 overflow-hidden 的 —— 那條裁切線就是使用者
   * 看到的「畫布邊緣的黑」。物件被拖出去的部分本來就該被切掉，但選取框、四個角的
   * 圓球、上面那排按鈕不該一起被切：東西一超出畫布就抓不到角，也按不到刪除。
   *
   * 所以外框改掛在這一層。它是頁面容器的「兄弟」（同一個父層、同樣的座標原點、
   * 同樣的縮放與位移），只是不在那個 overflow-hidden 底下 ——
   * 於是位置分毫不差，卻不會被裁切。
   *
   * 用 state 而不是 ref：要等這個 DOM 節點真的掛上去，子層才能 createPortal 過去。
   * ref 不會觸發重新渲染，第一次渲染時子層拿到的還是 null。
   */
  const [chromeLayer, setChromeLayer] = useState<HTMLDivElement | null>(null);

  // Workspace-wide interaction for selected floating images
  const wsDragStart = useRef<{
    startX: number;
    startY: number;
    imgX: number;
    imgY: number;
    pointerId: number;
    hasMoved: boolean;
  } | null>(null);

  const wsPinchStart = useRef<{
    startDist: number;
    imgScale: number;
  } | null>(null);

  const handleWorkspacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedFloatingId) return;
    const selectedImg = floatingImages.find(img => img.id === selectedFloatingId);
    if (!selectedImg) return;

    e.currentTarget.setPointerCapture(e.pointerId);

    wsDragStart.current = {
      startX: e.clientX,
      startY: e.clientY,
      imgX: selectedImg.x,
      imgY: selectedImg.y,
      pointerId: e.pointerId,
      hasMoved: false,
    };
  };

  const handleWorkspacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedFloatingId || !wsDragStart.current || wsDragStart.current.pointerId !== e.pointerId) return;

    if (e.buttons === 0) {
      wsDragStart.current = null;
      setActiveGuidelines([]);
      return;
    }

    if (wsPinchStart.current) return;

    const dx = e.clientX - wsDragStart.current.startX;
    const dy = e.clientY - wsDragStart.current.startY;

    if (Math.hypot(dx, dy) > 3) {
      wsDragStart.current.hasMoved = true;
    }

    const selectedImg = floatingImages.find(img => img.id === selectedFloatingId);
    if (!selectedImg) return;

    const rawX = wsDragStart.current.imgX + dx;
    const rawY = wsDragStart.current.imgY + dy;

    const { snappedX, snappedY, guidelines } = applySnapping(
      selectedImg.id,
      rawX,
      rawY,
      selectedImg.width,
      selectedImg.height,
      selectedImg.scale,
      undefined,
      selectedImg.rotation || 0,
    );

    setActiveGuidelines(guidelines);

    setFloatingImages(prev => prev.map(img => {
      if (img.id === selectedFloatingId) {
        return {
          ...img,
          x: snappedX,
          y: snappedY,
        };
      }
      return img;
    }));
  };

  const handleWorkspacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!wsDragStart.current || wsDragStart.current.pointerId !== e.pointerId) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (!wsDragStart.current.hasMoved) {
      setSelectedFloatingId(null);
    }

    wsDragStart.current = null;
    setActiveGuidelines([]);
  };

  const handleWorkspaceWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!selectedFloatingId) return;
    if (e.ctrlKey) {
      e.preventDefault();
      const selectedImg = floatingImages.find(img => img.id === selectedFloatingId);
      if (!selectedImg) return;

      const factor = 1 - e.deltaY * 0.01;
      const newScale = Math.max(0.1, Math.min(10.0, selectedImg.scale * factor));

      setFloatingImages(prev => prev.map(img => {
        if (img.id === selectedFloatingId) {
          return {
            ...img,
            scale: newScale,
          };
        }
        return img;
      }));
    }
  };

  // Keyboard listener to delete selected floating image on Delete/Backspace keypress
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedFloatingId && (e.key === 'Delete' || e.key === 'Backspace')) {
        const activeEl = document.activeElement;
        if (
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.getAttribute('contenteditable') === 'true')
        ) {
          return;
        }
        setFloatingImages(prev => prev.filter(img => img.id !== selectedFloatingId));
        setSelectedFloatingId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFloatingId]);

  /** 正在編輯的文字圖層 id，null 代表沒有打開文字面板 */
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  /** 正在畫布上直接打字的文字圖層 */
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  /** 正在被雙指縮放／旋轉的圖層：這段期間工具列先收起來 */
  const [pinchFloatingId, setPinchFloatingId] = useState<string | null>(null);
  /** 「圖片調整」的子分頁 */
  const [adjustSub, setAdjustSub] = useState<'shape' | 'tune' | 'filter' | 'effect'>('filter');
  /** 調節分頁目前選中的工具 */
  const [tuneTool, setTuneTool] = useState('brightness');
  /** 形狀分頁目前選中的工具 */
  const [shapeTool, setShapeTool] = useState('imgRadius');
  /** 形狀分頁：root 是總覽，其餘是描邊／發光的子選單 */
  const [shapeMenu, setShapeMenu] = useState<'root' | 'stroke' | 'glow'>('root');
  /** 正在拖形狀的滑桿：圖片的選取框先整組收起來 */
  const [tuningEdge, setTuningEdge] = useState(false);
  /** 特效分頁：選中哪一張卡片，以及細項有沒有展開（跟「編輯」同一種操作） */
  const [effectCard, setEffectCard] = useState('');
  const [effectDetail, setEffectDetail] = useState(false);
  /** 正在下載的濾鏡：那張卡片上要有轉圈動畫 */
  const [loadingLut, setLoadingLut] = useState<string | null>(null);

  /* 換一張圖層就把特效的選取收乾淨 —— 不然細項面板還開著上一張選的那顆，
     滑桿卻已經接到新這張的參數上了。 */
  useEffect(() => { setEffectCard(''); setEffectDetail(false); }, [selectedFloatingId]);
  /** 構圖中的圖層：跟「編輯」共用同一個 ComposeStudio */
  const [composeState, setComposeState] = useState<{ id: string; img: HTMLImageElement; geo: GeoParams } | null>(null);

  const openComposeFor = (id: string) => {
    const layer = floatingImages.find(f => f.id === id);
    if (!layer) return;
    const el = new Image();
    el.onload = () => setComposeState({ id, img: el, geo: layer.geo || DEFAULT_GEO });
    // baked 過就從原圖接續，參數還原成上次的樣子
    el.src = layer.origSrc || layer.src;
  };

  const applyComposeToLayer = () => {
    const st = composeState;
    if (!st) return;
    const layer = floatingImages.find(f => f.id === st.id);
    if (!layer) { setComposeState(null); return; }
    const srcUrl = layer.origSrc || layer.src;
    const finish = (newSrc: string, aspect: number) => {
      setFloatingImages(prev => prev.map(f => {
        if (f.id !== st.id) return f;
        const newH = Math.max(24, Math.round(f.width / aspect));
        return {
          ...f,
          src: newSrc,
          origSrc: srcUrl,
          geo: st.geo,
          // 高度變了讓中心留在原地
          y: f.y + (f.height - newH) / 2,
          height: newH,
        };
      }));
      setComposeState(null);
    };
    const sw = st.img.naturalWidth || st.img.width;
    const sh = st.img.naturalHeight || st.img.height;
    if (isGeoIdentity(st.geo)) {
      finish(srcUrl, sw / sh);
      return;
    }
    const baked = composeCanvas(st.img, sw, sh, st.geo, 2400);
    baked.toBlob(blob => {
      if (!blob) { setComposeState(null); return; }
      finish(URL.createObjectURL(blob), baked.width / baked.height);
    }, 'image/png');
  };
  /** 濾鏡每載好一個就 +1，讓已經套用的圖層重畫 */
  const [lutRevision, setLutRevision] = useState(0);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  /** 第一次點佈局是選整個佈局（等同一張圖片被選取），再點一次才會選到裡面的格子 */
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);

  const activePage = pages[activePageIndex] || pages[0];
  /** 被選取的佈局可能不在目前捲到的那一頁上（選好之後滑到別頁），所以一律用 id 全域找。 */
  const selectedLayoutPageIdx = selectedLayoutId
    ? pages.findIndex(p => p.layouts.some(l => l.id === selectedLayoutId))
    : -1;
  // 目前正在編輯的佈局：優先用被選取的那個，沒選就退回這一頁的第一個
  const activeLayout: LayoutItem | null =
    (selectedLayoutPageIdx >= 0
      ? pages[selectedLayoutPageIdx].layouts.find(l => l.id === selectedLayoutId)
      : undefined) || activePage.layouts[0] || null;
  const images = activeLayout?.images ?? EMPTY_CELLS;
  const templateIndex = activeLayout?.templateIndex ?? 0;
  const gap = activeLayout?.gap ?? 0;
  const radius = activeLayout?.radius ?? 0;
  /** 目前選中的佈局自己的長寬比（沒設就跟整頁一樣） */
  const layoutRatio = activeLayout?.ratio ?? '';
  const layoutLandscape = !!activeLayout?.landscape;
  /** 改「這個佈局」的比例；不影響整頁，也不影響其他佈局 */
  const patchLayoutShape = (patch: { ratio?: string; landscape?: boolean }) => {
    const id = selectedLayoutId;
    if (!id) return;
    setPages(prev => prev.map(p => p.layouts.some(l => l.id === id) ? ({
      ...p,
      layouts: p.layouts.map(l => l.id === id ? { ...l, ...patch } : l),
    }) : p));
  };
  const bgColor = activePage.bgColor;
  const layoutSelected = selectedLayoutId !== null;

  /** 只改動「正在編輯的那個佈局」，不管它現在在哪一頁。 */
  const patchActiveLayout = (fn: (l: LayoutItem) => LayoutItem) => {
    setPages(prev => prev.map((p, idx) => {
      if (selectedLayoutId) {
        if (!p.layouts.some(l => l.id === selectedLayoutId)) return p;
        return { ...p, layouts: p.layouts.map(l => (l.id === selectedLayoutId ? fn(l) : l)) };
      }
      if (idx !== activePageIndex || p.layouts.length === 0) return p;
      return { ...p, layouts: p.layouts.map((l, i) => (i === 0 ? fn(l) : l)) };
    }));
  };

  const setImages = (newImages: ImageCell[] | ((prev: ImageCell[]) => ImageCell[])) => {
    patchActiveLayout(l => ({ ...l, images: typeof newImages === 'function' ? newImages(l.images) : newImages }));
  };

  const setTemplateIndex = (newTmplIdx: number | ((prev: number) => number)) => {
    patchActiveLayout(l => ({ ...l, templateIndex: typeof newTmplIdx === 'function' ? newTmplIdx(l.templateIndex) : newTmplIdx }));
  };

  const setGap = (v: number) => patchActiveLayout(l => ({ ...l, gap: v }));
  const setRadius = (v: number) => patchActiveLayout(l => ({ ...l, radius: v }));

  const setBgColor = (newColor: string | ((prev: string) => string)) => {
    setPages(prev => prev.map((p, idx) => {
      const updatedColor = typeof newColor === 'function' ? newColor(p.bgColor) : newColor;
      return { ...p, bgColor: updatedColor };
    }));
  };

  const addedPagesCount = pages.length - 1;

  const setAddedPagesCount = (newCountOrFn: number | ((prev: number) => number)) => {
    setPages(prev => {
      const currentCount = prev.length - 1;
      const targetCount = typeof newCountOrFn === 'function' ? newCountOrFn(currentCount) : newCountOrFn;
      
      if (targetCount > currentCount) {
        const newPages = [...prev];
        const currentBgColor = prev[activePageIndex]?.bgColor || prev[0]?.bgColor || '#ffffff';
        for (let i = currentCount; i < targetCount; i++) {
          newPages.push({
            id: `page-${Math.random().toString(36).substring(2, 9)}`,
            bgColor: currentBgColor,
            layouts: [],
          });
        }
        return newPages;
      } else if (targetCount < currentCount) {
        return prev.slice(0, targetCount + 1);
      }
      return prev;
    });
  };

  const handleSwitchPage = (targetIdx: number) => {
    if (targetIdx >= 0 && targetIdx < pages.length) {
      setActivePageIndex(targetIdx);
    }
  };

  /** 在指定頁面「再加一個」佈局，不動既有的。 */
  /** 在目前這一頁的中央加一個文字圖層，並直接打開編輯面板。 */
  const handleAddTextLayer = (init?: Partial<FloatingImage>) => {
    const rect = getActivePageRect();
    const w = Math.round((rect?.width ?? previewW) * 0.7);
    const h = 96;
    const id = `text-${Math.random().toString(36).substring(2, 9)}`;
    ensureFont(DEFAULT_FONT);
    const item: FloatingImage = {
      id, src: '',
      x: (rect ? rect.centerX : previewW / 2) - w / 2,
      y: (rect ? rect.centerY : previewH / 2) - h / 2,
      width: w, height: h, scale: 1, rotation: 0,
      text: TEXT_PLACEHOLDER,
      fontFamily: DEFAULT_FONT,
      fontSize: 20,
      // 頁面底色預設是白的，文字也用白色的話新增完會看不到
      color: '#1C1C1C',
      bold: false,
      italic: false,
      letterSpacing: 0,
      glow: 0,
      glowColor: '#FFFFFF',
      ...init,
    };
    setFloatingImages(prev => [...prev, item]);
    setSelectedFloatingId(id);
    setSelectedIndex(null);
    setSelectedLayoutId(null);
    setEditingTextId(id);
    // 新增完直接進文字編輯頁，省掉「再按一次工具列的編輯」那一步
    setActiveTab('adjust');
  };

  /** 複製一份圖片／文字圖層，稍微錯開一點放在原件上面，並直接選中新的那一份。 */
  const handleDuplicateFloating = (id: string) => {
    const src = floatingImages.find(f => f.id === id);
    if (!src) return;
    const copy: FloatingImage = {
      ...src,
      id: `${src.text !== undefined ? 'text' : 'img'}-${Math.random().toString(36).substring(2, 9)}`,
      x: src.x + 16,
      y: src.y + 16,
    };
    setFloatingImages(prev => {
      const i = prev.findIndex(f => f.id === id);
      const next = [...prev];
      next.splice(i + 1, 0, copy);   // 疊在原件正上方
      return next;
    });
    setSelectedFloatingId(copy.id);
    setSelectedIndex(null);
    setSelectedLayoutId(null);
    setInlineEditId(null);
  };

  const patchTextLayer = (id: string, patch: Partial<FloatingImage>) => {
    setFloatingImages(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleAddLayoutToPage = (pageIdx: number, templateIdx = 0, count = 4) => {
    const item = makeLayout(templateIdx, count);
    setPages(prev => prev.map((p, idx) => idx === pageIdx ? { ...p, layouts: [...p.layouts, item] } : p));
    setActivePageIndex(pageIdx);
    // 刻意不自動選中新佈局：選中＝進入編輯，會讓下一次點版型變成「換版型」而不是「再加一個」
    setSelectedLayoutId(null);
    setSelectedIndex(null);
    setSelectedFloatingId(null);
  };

  /**
   * 自由圖層的 x 是整條頁面帶的座標，所以「第幾頁」是用中心點除以一頁的寬度算出來的
   * （每頁之間還有預覽裡那 1px 的縫）。搬頁面或刪頁面時，這些圖層都要跟著處理。
   */
  const pageOfFloating = (f: FloatingImage, stride: number, count: number) =>
    Math.max(0, Math.min(count - 1, Math.floor((f.x + f.width / 2) / stride)));

  const handleDeletePage = (pageIdx: number) => {
    if (pages.length <= 1) return;
    const stride = previewW + 1;
    const count = pages.length;
    // 這一頁上的自由圖層一起刪掉；後面幾頁的圖層往前挪一頁
    setFloatingImages(prev => prev
      .filter(f => pageOfFloating(f, stride, count) !== pageIdx)
      .map(f => {
        const p = pageOfFloating(f, stride, count);
        return p > pageIdx ? { ...f, x: f.x - stride } : f;
      }));
    setSelectedFloatingId(prev => {
      const sel = floatingImages.find(f => f.id === prev);
      return sel && pageOfFloating(sel, stride, count) === pageIdx ? null : prev;
    });
    setPages(prev => prev.filter((_, idx) => idx !== pageIdx));
    setActivePageIndex(prev => {
      if (pageIdx === prev) {
        return Math.max(0, pageIdx - 1);
      } else if (pageIdx < prev) {
        return prev - 1;
      }
      return prev;
    });
  };

  /* ---- 頁面順序模式 ---- */
  /**
   * 進這個模式時整條操作欄往下滑，只留最上面那排分頁鍵；空出來的高度
   * 讓畫布往下滑一半，看起來就是頁面平順地移到畫面中央。
   * 每一頁下面會出現一顆握把與刪除鍵，拖握把就是直接在拖真正的那一頁。
   */
  /**
   * 頁面順序模式：操作欄留在原位，畫布縮成一半 ——
   * 一次看得到前後好幾頁，排起來才知道自己在排什麼。
   * 用 transform 縮，不動 previewW/H，圖層的座標才不會跟著跑掉。
   */
  const PAGES_MODE_SCALE = 0.4;
  /** 握把要按住這麼久才算開始拖（太短會誤觸） */
  const PAGE_DRAG_HOLD_MS = 260;
  /** 拖曳中被拿起來的那一頁：微微放大＋陰影，看起來像被拿離桌面（專業排序介面的做法） */
  const PAGE_DRAG_SCALE = 1.05;

  /** 正在拖的是哪一頁（拖的就是畫布上真正的那一頁） */
  const [pageDragIdx, setPageDragIdx] = useState<number | null>(null);
  /** 放手後的收尾：內容從「放手時看起來的位置」平順滑回新定位 */
  const [dragSettle, setDragSettle] = useState<{ page: number; x: number; ease: boolean } | null>(null);
  const settleTimerRef = useRef(0);

  /**
   * 拖曳中，每一頁該往哪邊讓開：
   * 被拖的那一頁跟著手指；夾在「原本位置」與「目標位置」之間的頁面各讓一格。
   */
  const pageDragOffset = (idx: number) => {
    const from = pageDragIdx;
    const to = pageDragTo;
    if (from === null || to === null) return { x: 0, live: false };
    if (idx === from) return { x: pageDragShift / Math.max(0.01, pagesScale), live: true };
    const stride = previewW + 1;
    if (from < to && idx > from && idx <= to) return { x: -stride, live: false };
    if (to < from && idx >= to && idx < from) return { x: stride, live: false };
    return { x: 0, live: false };
  };

  /**
   * 排頁面時「畫布不動、動的是上面的東西」。
   *
   * 被拖的那一頁：整組跟著手指、而且統一縮到 80%（一眼就知道自己在搬哪一頁）。
   * 其他頁：讓開一格。縮放是以「那一頁的中心」為原點的群組縮放，但**每個元素
   * 各自算一個位移**、不包成一個容器 —— 包起來會多一個堆疊環境，佈局與圖層
   * 之間的前後關係就會跑掉。
   *
   * cx/cy 是那一頁的中心、ex/ey 是元素自己的中心，兩者要在同一個座標系裡
   * （佈局用頁內座標，自由圖層用整條頁面的座標）。
   */
  const pageContentShift = (pageIdx: number) => {
    if (!pagesMode) return null;
    if (pageDragIdx === null) {
      // 放手瞬間的收尾（FLIP）：換完順序後內容先停在「看起來的位置」，
      // 下一帧再平順滑回定位 —— 不做這一段的話會先閃回再跳走
      if (dragSettle && pageIdx === dragSettle.page) {
        return { dx: dragSettle.x, s: 1, live: !dragSettle.ease };
      }
      return null;
    }
    // 拖曳中每一頁都回傳位移（包含 0）：讓開再讓回來時 transition 才接得上，
    // 不會從「有 transform」直接跳成「沒 transform」閃一下
    const off = pageDragOffset(pageIdx);
    const s = off.live ? PAGE_DRAG_SCALE : 1;
    return { dx: off.x, s, live: off.live };
  };
  const groupShift = (
    shift: { dx: number; s: number; live: boolean },
    cx: number, cy: number, ex: number, ey: number,
  ) => ({
    tx: shift.dx + (1 - shift.s) * (cx - ex),
    ty: (1 - shift.s) * (cy - ey),
    s: shift.s,
    live: shift.live,
  });
  /** 自由圖層：中心就是 x + 寬/2（外框的 left 已經把縮放算進去了） */
  const floatingDragShift = (f: FloatingImage) => {
    const stride = previewW + 1;
    const idx = pageOfFloating(f, stride, pages.length);
    const shift = pageContentShift(idx);
    if (!shift) return null;
    return groupShift(shift, idx * stride + previewW / 2, previewH / 2, f.x + f.width / 2, f.y + f.height / 2);
  };

  /** 手指位置落在畫布上第幾頁（用每一頁真正的位置判斷） */
  const pageUnder = (clientX: number) => {
    const els = [...document.querySelectorAll('[id^="grid-preview-container"]')] as HTMLElement[];
    let best: number | null = null;
    let bestD = Infinity;
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(clientX - (r.left + r.width / 2));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  const dragIdxRef = useRef<number | null>(null);
  /** 這次拖曳手指真的移動過了嗎（沒動過就不啟動邊緣自動捲動） */
  const dragMovedRef = useRef(false);
  /** 邊緣自動捲動「這個方向已經到底了」的鎖，手指離開感應範圍才鬆開 */
  const edgeScrollDoneRef = useRef({ left: false, right: false });
  const dragXRef = useRef(0);
  const dragStartXRef = useRef(0);
  const dragRafRef = useRef(0);
  /**
   * 拖曳中的位移：被拖的那一頁直接跟著手指走（不加動畫），
   * 被讓開的那幾頁用 200ms 平順地滑到新位置。放手時才真的改順序。
   */
  const [pageDragShift, setPageDragShift] = useState(0);
  /** 每一帧要用（按鈕跟著那一頁的東西走），所以另外留一份 ref */
  const pageDragShiftRef = useRef(0);
  const [pageDragTo, setPageDragTo] = useState<number | null>(null);
  const pageDragToRef = useRef<number | null>(null);
  useEffect(() => { pageDragToRef.current = pageDragTo; }, [pageDragTo]);

  /** 手指移動多少＝往前／往後幾頁（一頁的寬度就是一格） */
  const settlePageDrag = () => {
    const from = dragIdxRef.current;
    if (from === null) return;
    const stride = (previewW + 1) * pagesScale;
    // 頭尾之外再多給「半格」：拖到第一頁之前／最後一頁之後時會露出一小塊黑，
    // 知道自己已經到底了，但不會整個甩出去（放手仍然只會落在有效的頁次上）
    const slack = stride / 2;
    const raw = Math.max(
      (0 - from) * stride - slack,
      Math.min((pagesCountRef.current - 1 - from) * stride + slack, dragXRef.current - dragStartXRef.current),
    );
    pageDragShiftRef.current = raw;
    setPageDragShift(raw);
    const slots = Math.round(raw / Math.max(1, stride));
    const to = Math.max(0, Math.min(pagesCountRef.current - 1, from + slots));
    // ref 當場就寫（自動捲動的煞車同一帧要用），state 慢一帧沒關係
    pageDragToRef.current = to;
    setPageDragTo(prev => (prev === to ? prev : to));
  };

  /**
   * 一頁差不多就跟螢幕一樣寬，所以隔壁那一頁通常在畫面外。
   * 手指靠近左右邊緣時就自動捲動，捲到隔壁那一頁就換過去。
   */
  const dragTick = () => {
    const el = containerRef.current;
    if (el && dragIdxRef.current !== null) {
      const r = el.getBoundingClientRect();
      // 手指還沒真的移動過就不捲：不然原地長按時，握把本來就落在感應範圍裡，
      // 頁面會自己往一邊飄走
      const EDGE = 80, SPEED = 13;
      if (!dragMovedRef.current) { settlePageDrag(); dragRafRef.current = requestAnimationFrame(dragTick); return; }
      let dir = 0;
      if (dragXRef.current < r.left + EDGE) dir = -1;
      else if (dragXRef.current > r.right - EDGE) dir = 1;
      let dx = dir === -1
        ? -SPEED * Math.min(1, (r.left + EDGE - dragXRef.current) / EDGE)
        : dir === 1
          ? SPEED * Math.min(1, (dragXRef.current - (r.right - EDGE)) / EDGE)
          : 0;
      if (dir === -1 && edgeScrollDoneRef.current.left) dx = 0;
      if (dir === 1 && edgeScrollDoneRef.current.right) dx = 0;
      /*
        什麼時候「這個方向捲到底了」：

        自動捲動會回頭把 dragStartX 補掉，所以「捲了多少」也會算進拖曳位移裡。
        以前的煞車是看那個位移有沒有到頂 —— 那會變成棘輪：一到頂就停，手指
        往回一點位移就掉下來、又開始捲，捲又把位移推回頂端⋯⋯在最邊邊來回晃
        就等於一直往那邊捲個不停。

        改成兩個條件，而且踩下去之後會「鎖住」，要真的往反方向捲過才鬆開
        （鎖在手指離開感應範圍時就放掉的話，手指再靠過來又會多捲一小段 ——
        「第二次頂到底又滑一下」就是這樣來的）：
        1) 容器已經捲到底：再捲也沒有新的畫面可看。
        2) 被拖的那一頁已經走到可以走的極限（最後一頁再多半格）：再捲的話
           頁面的位移被夾住、整排卻還在跑，那一頁就會被帶著離開手指。
      */
      if (dx) {
        const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
        const from = dragIdxRef.current;
        const stride = (previewWRef.current + 1) * PAGES_MODE_SCALE;
        const shift = pageDragShiftRef.current;
        const atEnd = dx > 0
          ? el.scrollLeft >= maxScroll - 0.5
            || shift >= (pagesCountRef.current - 1 - from) * stride + stride / 2 - 0.5
          : el.scrollLeft <= 0.5
            || shift <= (0 - from) * stride - stride / 2 + 0.5;
        if (atEnd) {
          dx = 0;
          if (dir === 1) edgeScrollDoneRef.current.right = true;
          else if (dir === -1) edgeScrollDoneRef.current.left = true;
        }
      }
      if (dx) {
        // 捲動等於手指相對頁面又多移動了一點。捲動已經是一比一（捲 1px 畫面就走
        // 1px），所以補的量就是「真的捲了多少」—— 捲到頭時瀏覽器會夾住，
        // 這時一點都不能補，不然被拖的那一頁會愈跑愈離開手指。
        const before = el.scrollLeft;
        el.scrollLeft = before + dx;
        const applied = el.scrollLeft - before;
        dragStartXRef.current -= applied;
        // 往反方向捲過了＝另一邊又有東西可以捲出來，那邊的鎖就鬆開
        if (applied > 0) edgeScrollDoneRef.current.left = false;
        if (applied < 0) edgeScrollDoneRef.current.right = false;
      }
      settlePageDrag();
    }
    dragRafRef.current = requestAnimationFrame(dragTick);
  };

  /**
   * 拖曳中的事件掛在 window 上，不用 setPointerCapture ——
   * 換順序時握把在 DOM 裡會被搬位置，指標捕捉會因此掉掉，
   * 那樣就收不到放手事件（握把會一直停在按下的樣子）。
   */
  const handlePageDragStart = (e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    // 先按住一下下才算開始拖：手指剛碰到就跟著跑的話很容易誤觸
    const downX = e.clientX, downY = e.clientY;
    let armed = false;
    let hold: number | undefined = window.setTimeout(() => {
      hold = undefined;
      armed = true;
      dragMovedRef.current = false;
      edgeScrollDoneRef.current = { left: false, right: false };
      dragIdxRef.current = idx;
      dragXRef.current = downX;
      dragStartXRef.current = downX;
      setPageDragIdx(idx);
      setPageDragTo(idx);
      pageDragShiftRef.current = 0;
      setPageDragShift(0);
      if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(dragTick);
    }, PAGE_DRAG_HOLD_MS);
    const onMove = (ev: PointerEvent) => {
      if (!armed) {
        // 還沒按滿時間就滑走＝不是要拖，取消
        if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 12) {
          if (hold !== undefined) { clearTimeout(hold); hold = undefined; }
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
        }
        return;
      }
      if (Math.abs(ev.clientX - downX) > 6) dragMovedRef.current = true;
      dragXRef.current = ev.clientX;
      settlePageDrag();
    };
    const onUp = () => {
      if (hold !== undefined) { clearTimeout(hold); hold = undefined; }
      if (!armed) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        return;
      }
      return onUpReal();
    };
    const onUpReal = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const from = dragIdxRef.current;
      const to = pageDragToRef.current;
      // 放手那一刻的位移要先抄下來 —— 下面就要清掉了，
      // 收尾動畫的起點就是它（先清再讀會變成從原位起跑＝瞬移回去再滑過來）
      const releasedShift = pageDragShiftRef.current;
      dragIdxRef.current = null;
      setPageDragIdx(null);
      pageDragShiftRef.current = 0;
      setPageDragShift(0);
      setPageDragTo(null);
      if (dragRafRef.current) { cancelAnimationFrame(dragRafRef.current); dragRafRef.current = 0; }
      // 放手才真的改順序。畫面不捲動：內容本來就停在使用者放手的位置，
      // 只要讓它從那裡平順滑回新定位就好（FLIP），不會先閃回再跳走
      if (from !== null && to !== null) {
        const liveDx = releasedShift / Math.max(0.01, PAGES_MODE_SCALE);
        const remainder = liveDx - (to - from) * (previewW + 1);
        if (from !== to) handleMovePage(from, to);
        window.clearTimeout(settleTimerRef.current);
        setDragSettle({ page: to, x: remainder, ease: false });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          setDragSettle(prev => (prev && !prev.ease ? { page: prev.page, x: 0, ease: true } : prev));
        }));
        settleTimerRef.current = window.setTimeout(() => setDragSettle(null), 260);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  useEffect(() => () => { if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current); }, []);

  /**
   * React 的 onTouchMove 是 passive 的 —— 裡面的 e.preventDefault() 完全不會生效
   * （console 會一直噴 "Unable to preventDefault inside passive event listener"）。
   * 結果就是：操作物件（縮放佈局、平移格內照片）的時候，瀏覽器的原生捲動
   * 還是照跑，手勢被搶走、甚至被瀏覽器中斷，縮放做到一半就被打斷還原。
   * 這裡自己補一個「非 passive」的監聽器，真正把原生捲動擋掉。
   */
  useEffect(() => {
    const block = (e: TouchEvent) => {
      const busy = wsGestureRef.current || layoutGestureRef.current
        || layoutCornerRef.current || pointerState.current.isDraggingContent
        || floatSwapRef.current?.dragging || touchDragState.current;
      if (busy && e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, []);

  /* IG 預覽的翻頁已經改成自己搬位置（見 igMoveTrack），容器完全不捲動，
     所以「第一張再往左滑就擋掉」那個非 passive 的 touchmove 監聽器不用了 ——
     頭尾拖不出去的判斷直接寫在 onIgPointerMove 裡。 */

  /**
   * 換頁面順序：頁面裡的佈局本來就跟著頁面走，頁面上的自由圖層要自己搬過去。
   *
   * 「舊頁碼 → 新頁碼」用純算式算（搬一個項目的位移），不依賴當下的 pages，
   * 這樣拖曳過程中連續換好幾次也不會用到過期的狀態。
   */
  const pagesCountRef = useRef(pages.length);
  // render 當下就更新：整排的版面是在 useLayoutEffect 裡用這個值算的，
  // 放到 useEffect 才寫的話會晚一步，新增／刪除頁面那一帧會用到舊的頁數
  pagesCountRef.current = pages.length;
  /** 每一帧要照頁碼找元素，用 ref 拿最新的 pages（rAF 迴圈不跟著 pages 重掛） */
  const pagesRef = useRef(pages);
  useEffect(() => { pagesRef.current = pages; }, [pages]);

  const handleMovePage = (from: number, to: number) => {
    const count = pagesCountRef.current;
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return;
    const stride = previewW + 1;
    const remap = (p: number) => {
      if (p === from) return to;
      if (from < to) return p > from && p <= to ? p - 1 : p;
      return p >= to && p < from ? p + 1 : p;
    };
    setPages(prev => {
      const next = [...prev];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
    /* 這裡一定要用 pageOfFloating（跟畫面上判斷「這個圖層屬於哪一頁」是同一支）。
       以前是自己再算一次、而且只夾了下界沒夾上界：中心點落在最後一頁右緣外面的
       圖層會算出 count（不存在的頁），remap 原封不動回傳，於是拖曳中它跟著最後
       一頁走、放手卻留在原地 —— 那就是「圖片跟頁面沒有完全同步」。 */
    setFloatingImages(prev => prev.map(f => {
      const p = pageOfFloating(f, stride, count);
      const np = remap(p);
      return np === p ? f : { ...f, x: f.x + (np - p) * stride };
    }));
    setActivePageIndex(prev => remap(prev));
  };

  const [selectedRatio, setSelectedRatio] = useState('3:4');
  const [isLandscape, setIsLandscape] = useState(false);

  /** 觸控結束後瀏覽器還會補送一次 click，兩邊都處理的話一次點擊會被算成兩次 */
  const touchHandledAtRef = useRef(0);
  /** 有東西被選取時，畫布就進入編輯狀態：手勢全部給選取物，不再左右滑動 */
  const anySelected = selectedIndex !== null || selectedFloatingId !== null || layoutSelected;
  const [exportState, setExportState] = useState<'idle' | 'processing' | 'success'>('idle');
  // One exported file per page. The object URLs are mirrored into a ref so they can be
  // revoked without making every consumer depend on the state value.
  const [finalImages, setFinalImages] = useState<string[]>([]);
  /** 每一頁匯出的是圖片還是影片（有影片圖層的那一頁會輸出影片） */
  const [finalKinds, setFinalKinds] = useState<('image' | 'video')[]>([]);
  const finalImagesRef = useRef<string[]>([]);
  const resultStripRef = useRef<HTMLDivElement>(null);

  /** 匯出完成的預覽一定要從第一頁開始，不要停在剛才編輯的那一頁。 */
  const [resultIdx, setResultIdx] = useState(0);
  useEffect(() => {
    if (finalImages.length === 0) return;
    const el = resultStripRef.current;
    if (!el) return;
    el.scrollLeft = 0;
    setResultIdx(0);
    const t = setTimeout(() => { if (resultStripRef.current) resultStripRef.current.scrollLeft = 0; }, 60);
    return () => clearTimeout(t);
  }, [finalImages]);
  /* 頁數只放一個，固定在圖片下面 —— 跟著捲到中間的那一頁走，
     不用每張圖底下都掛一個。用 rAF 跟捲動，慣性滑完也對得上。 */
  useEffect(() => {
    const el = resultStripRef.current;
    if (!el || finalImages.length < 2) return;
    let raf = 0;
    const pick = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      let best = 0, bestD = Infinity;
      Array.from(el.children).forEach((ch: Element, i: number) => {
        const c = ch.getBoundingClientRect();
        const d = Math.abs((c.left + c.width / 2) - mid);
        if (d < bestD) { bestD = d; best = i; }
      });
      setResultIdx(best);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(pick); };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    pick();
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [finalImages, exportState]);

  const clearFinalImages = useCallback(() => {
    finalImagesRef.current.forEach(u => URL.revokeObjectURL(u));
    finalImagesRef.current = [];
    setFinalImages([]);
    setFinalKinds([]);
  }, []);
  useEffect(() => () => { finalImagesRef.current.forEach(u => URL.revokeObjectURL(u)); }, []);
  const [activeTab, setActiveTab] = useState<'layout' | 'ratio' | 'color' | 'add' | 'adjust' | 'pages'>('ratio');
  /** 頁面順序模式：操作欄往下滑、畫布往下移到中央、每一頁下面出現握把與刪除鍵 */
  const pagesMode = activeTab === 'pages';
  const pagesModeRef = useRef(false);
  pagesModeRef.current = pagesMode;
  /** 排頁面時整排頁面縮成一半（用 transform，不動 previewW/H） */
  const pagesScale = pagesMode ? PAGES_MODE_SCALE : 1;
  /** 整排頁面左邊要留的空白（讓第一頁置中） */
  const stripOffset = (w: number, k: number) => Math.max(16, (w - previewW * k) / 2);
  /** 第 i 頁置中時的捲動位置 */
  const pageScrollLeft = (i: number, w: number, k: number) =>
    stripOffset(w, k) + k * (i * (previewW + 1) + previewW / 2) - w / 2;
  // 這個模式是在排頁面，先把選取取消掉，免得順手拖到圖層
  useEffect(() => {
    if (!pagesMode) return;
    setSelectedFloatingId(null);
    setSelectedIndex(null);
    setSelectedLayoutId(null);
    // 正在畫布上打字也要一併收掉，不然鍵盤跟輸入框會留在畫面上
    setInlineEditId(null);
  }, [pagesMode]);

  /**
   * 握把與刪除鍵要長在「真正那一頁」的正下方，但畫布容器會裁切也會位移，
   * 所以控制項放在容器外面、用固定定位貼上去。位置每一帧量一次：
   * 這樣操作欄滑下去的動畫、左右捲動、換頁數都跟得上。
   */
  const pageCtlRefs = useRef(new Map<string, HTMLDivElement>());
  const pagesColRef = useRef<HTMLDivElement>(null);
  /** 整排頁面的外殼（尺寸＝縮放後真正佔的大小）與右邊的留白 */
  const stripShellRef = useRef<HTMLDivElement>(null);
  const stripPadRef = useRef<HTMLDivElement>(null);
  const addPageBtnRef = useRef<HTMLButtonElement>(null);
  /**
   * 縮放與「補回縮放造成的位移」必須是同一帧算出來的同一個值。
   * 之前縮放交給 CSS transition、位移自己每一帧補，兩邊差一帧 ——
   * 位移量又跟捲動位置成正比（可以到一百多 px），進出這個模式就會抖。
   * 所以動畫自己跑：每一帧算出 k，縮放與位移一起寫進同一個 transform。
   */
  /** 縮放動畫還沒結束前，視覺上仍然當作在排頁面（接縫、外框、陰影） */
  const [pagesVisual, setPagesVisual] = useState(false);
  const pagesVisualTimerRef = useRef(0);
  const kRef = useRef(1);
  const kAnimRef = useRef<{ from: number; to: number; t0: number } | null>(null);
  /** 動畫期間繞著哪一頁縮放（就是動畫開始時停在畫面正中間的那一頁） */
  const kAnchorRef = useRef(0);
  const prevPagesScaleRef = useRef(pagesScale);
  const containerWRef = useRef(0);
  const plusVisibleRef = useRef(true);
  plusVisibleRef.current = pages.length - 1 < 24;

  /**
   * 整排頁面在縮放倍率 k 之下該有的版面。**尺寸、留白、捲動位置全部由 k 算出來**，
   * 動畫每一帧重算一次 —— 這樣縮放的過程中版面本身永遠是對的，
   * 不會像以前那樣「外殼的大小和位置瞬間換成新的、只有縮放在慢慢跑」，
   * 一進去整排就先瞬移一百多 px 再縮小。
   */
  const applyStripGeometry = useCallback((k: number) => {
    const n = Math.max(1, pagesCountRef.current);
    const pw = previewWRef.current;
    const w = containerWRef.current;
    const shell = stripShellRef.current;
    const col = pagesColRef.current;
    const pad = stripPadRef.current;
    // 跟 stripOffset 同一條式子，但頁寬取自 ref —— 這支是 useCallback([])，
    // 直接用外面的 stripOffset 會一直沿用第一次 render 那時候的頁寬
    const m = Math.max(16, (w - pw * k) / 2);
    if (shell) {
      shell.style.marginLeft = `${m}px`;
      shell.style.width = `${(n * pw + (n - 1)) * k}px`;
      shell.style.height = `${previewHRef.current * k}px`;
    }
    // 右邊剛好留到「最後一頁停在正中間」為止；加號按鈕已經佔掉 ml-3 + 40
    if (pad) pad.style.width = `${Math.max(0, m - (plusVisibleRef.current ? 52 : 0))}px`;
    if (col) col.style.transform = k === 1 ? '' : `scale(${k})`;
  }, []);

  // 要在「把版面貼成目標倍率」那個 useLayoutEffect 之前先把動畫排好，
  // 不然版面會先一步跳到目標值，動畫就整段被跳過了
  useLayoutEffect(() => {
    const prev = prevPagesScaleRef.current;
    prevPagesScaleRef.current = pagesScale;
    if (Math.abs(kRef.current - pagesScale) < 0.0001) return;
    // 動畫開始時停在正中間的那一頁，整段縮放都繞著它 —— 捲動位置也由 k 算，
    // 縮放與位移同一帧，看起來就是整排「以那一頁為中心」平順地縮小／放大
    const el = containerRef.current;
    if (el && containerSize.width > 0) {
      const i = Math.round((el.scrollLeft + containerSize.width / 2 - stripOffset(containerSize.width, prev))
        / Math.max(1, prev * (previewW + 1)) - 0.5);
      kAnchorRef.current = Math.max(0, Math.min(pagesCountRef.current - 1, i));
    } else {
      kAnchorRef.current = 0;
    }
    kAnimRef.current = { from: kRef.current, to: pagesScale, t0: performance.now() };
    // 縮放動畫還在跑的時候，維持排頁面的樣子（接縫、外框、陰影都先不要回來），
    // 不然退出的瞬間會先閃一排線條再縮回去
    setPagesVisual(true);
    window.clearTimeout(pagesVisualTimerRef.current);
    pagesVisualTimerRef.current = window.setTimeout(() => setPagesVisual(pagesModeRef.current), 340);
  }, [pagesScale]);

  /**
   * 把握把／刪除鍵／加號貼到目前的捲動位置上。
   * 除了每一帧跑一次，手動捲頁時「寫完 scrollLeft 立刻」也要再跑一次 ——
   * 頁面是被 scrollLeft 直接帶著走的，按鈕是 transform，
   * 兩者不在同一帧寫就會差一帧，看起來就是按鈕跟不上頁面。
   */
  const positionPageCtls = useCallback(() => {
    const k = kRef.current;
    const cont = containerRef.current;
    const col = pagesColRef.current;
    if (!cont || !col) return;
    const rc = cont.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    const m = parseFloat((col.parentElement as HTMLElement).style.marginLeft) || 0;
    const stride = previewWRef.current + 1;
    // 這裡拿到的是「那一頁沒被拖走時」該在的位置。
    // 不去量頁框本身：頁框拖曳時會被移走、還會放大，量它會把位移算兩次。
    const left0 = rc.left - cont.scrollLeft + m;
    const bottom = colRect.top + k * previewHRef.current;
    pageCtlRefs.current.forEach((node, id) => {
      const i = pagesRef.current.findIndex(pg => pg.id === id);
      if (i < 0) return;
      node.style.transform =
        `translate3d(${left0 + k * (i * stride + previewWRef.current / 2)}px, ${bottom + 8}px, 0) translateX(-50%)`;
      node.style.visibility = 'visible';
    });
    // 「新增一頁」貼在最後一頁原本的位置旁邊 —— 用算的，才不會被拖曳中的
    // 最後一頁拖著跑（看起來像跟那一頁黏在一起）
    const plus = addPageBtnRef.current;
    if (plus) {
      plus.style.transition = k === 1 ? '' : 'none';
      if (k === 1) {
        plus.style.transform = '';
      } else {
        const n = pagesRef.current.length;
        const want = left0 + k * ((n - 1) * stride + previewWRef.current) + 12;
        const curTx = new DOMMatrixReadOnly(getComputedStyle(plus).transform).m41;
        const layoutLeft = plus.getBoundingClientRect().left - curTx;
        if (Math.abs(want - layoutLeft - curTx) > 0.5) plus.style.transform = `translateX(${want - layoutLeft}px)`;
      }
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const anim = kAnimRef.current;
      if (anim) {
        const t = Math.min(1, (performance.now() - anim.t0) / 300);
        kRef.current = anim.from + (anim.to - anim.from) * (1 - Math.pow(1 - t, 3));
        if (t >= 1) { kRef.current = anim.to; kAnimRef.current = null; }
      }
      const k = kRef.current;
      // 版面（外殼尺寸、左右留白、縮放）全部由這一帧的 k 算出來，
      // 捲動幾何永遠跟看到的大小一致：捲 1px 畫面就走 1px
      applyStripGeometry(k);
      if (anim) {
        // 先寫完尺寸（scrollWidth 才是對的）再寫捲動位置，
        // 讓「動畫開始時停在中間的那一頁」整段都待在正中間
        const cont = containerRef.current;
        const w = containerWRef.current;
        if (cont && w > 0) {
          // 同樣用 ref 版的頁寬（這個迴圈不跟著每次 render 重掛）
          const pw = previewWRef.current;
          const m = Math.max(16, (w - pw * k) / 2);
          cont.scrollLeft = Math.max(0, m + k * (kAnchorRef.current * (pw + 1) + pw / 2) - w / 2);
        }
      }
      // 外層（貼在頁框正下方）由這裡每一帧定位 —— 頁框在排頁面時是不動的，
      // 所以這層只跟捲動與模式動畫有關。拖曳的位移放在「內層」、由 React
      // 跟內容用同一次 render 寫出來，兩邊永遠同一帧、速度不可能不一樣。
      positionPageCtls();
      // 離開這個模式後還要再跑到動畫結束，位移才有東西補
      if (!pagesMode && !kAnimRef.current && k === 1) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pagesMode, pagesScale, positionPageCtls, applyStripGeometry]);

  // 進到濾鏡分頁才在背景把濾鏡一個一個載進來，載好一個就重畫一次
  useEffect(() => {
    if (activeTab !== 'adjust' || adjustSub !== 'filter') return;
    let alive = true;
    (async () => {
      for (const l of lutList) {
        if (!alive) return;
        if (!l.url || getLoadedLut(l.id)) continue;
        await loadLut(l.id, l.url);
        if (!alive) return;
        setLutRevision(n => n + 1);
      }
    })();
    return () => { alive = false; };
  }, [activeTab, adjustSub, lutList]);

  const [layoutSubTab, setLayoutSubTab] = useState<'layout' | 'adjust'>('layout');
  const [colorPickerActive, setColorPickerActive] = useState(false);
  /** 編輯頁選到的是圖片（不是文字）—— 這時整個工具欄要換成跟「編輯」一樣的三段式 */
  /* 這個旗標控制外框要不要再包一層 p-4。編輯圖片的那套介面自己就把邊界算好了，
     多包一層 padding 就會整個縮一圈、位置也跟著偏 —— 佈局裡的格子走的是同一套
     介面，所以也要算進來，不然只有格子那邊會縮小跑位。 */
  const imageEditMode = activeTab === 'adjust'
    && (!!floatingImages.find(f => f.id === selectedFloatingId && f.text === undefined)
        || (!selectedFloatingId && selectedIndex !== null && selectedLayoutId !== null));

  const [historyState, setHistoryState] = useState<{
    history: { pages: PageConfig[]; floatingImages: FloatingImage[]; selectedRatio: string; isLandscape: boolean }[];
    index: number;
  }>({
    history: [],
    index: -1
  });
  const isUndoing = useRef(false);

  useEffect(() => {
    if (isUndoing.current) {
      isUndoing.current = false;
      return;
    }

    const timer = setTimeout(() => {
      setHistoryState(prev => {
        const stateToSave = { pages, floatingImages, selectedRatio, isLandscape };
        
        if (prev.index === -1) {
          return { history: [stateToSave], index: 0 };
        }

        const current = prev.history[prev.index];
        if (current && JSON.stringify(current) === JSON.stringify(stateToSave)) {
          return prev;
        }

        const sliced = prev.history.slice(0, prev.index + 1);
        const nextHistory = [...sliced, stateToSave].slice(-30);
        return {
          history: nextHistory,
          index: nextHistory.length - 1
        };
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [pages, floatingImages, selectedRatio, isLandscape]);

  const undo = () => {
    if (historyState.index > 0) {
      isUndoing.current = true;
      const prevIndex = historyState.index - 1;
      const state = historyState.history[prevIndex];
      setPages(state.pages);
      setFloatingImages(state.floatingImages);
      setSelectedRatio(state.selectedRatio);
      setIsLandscape(state.isLandscape);
      setHistoryState(prev => ({ ...prev, index: prevIndex }));
    }
  };

  const redo = () => {
    if (historyState.index < historyState.history.length - 1) {
      isUndoing.current = true;
      const nextIndex = historyState.index + 1;
      const state = historyState.history[nextIndex];
      setPages(state.pages);
      setFloatingImages(state.floatingImages);
      setSelectedRatio(state.selectedRatio);
      setIsLandscape(state.isLandscape);
      setHistoryState(prev => ({ ...prev, index: nextIndex }));
    }
  };

  useEffect(() => {
    if (activeTab !== 'color') {
      setColorPickerActive(false);
    }
    
    if (activeTab === 'layout') {
      setTimeout(() => {
        const el = document.getElementById('active-layout-button');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 50);
    }
  }, [activeTab]);

  const [slotToUpload, setSlotToUpload] = useState<number | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 420, height: 420 });
  /** 容器還沒量到之前用的是預設值，先不要畫出來，不然量到的瞬間會跳一下 */
  const [containerMeasured, setContainerMeasured] = useState(false);
  const [allowSingleLayout, setAllowSingleLayout] = useState(false);
  const [layoutSortBase, setLayoutSortBase] = useState(() => 4);
  const isLayoutChangeRef = useRef(false);

  useEffect(() => {
    if (isLayoutChangeRef.current) {
      isLayoutChangeRef.current = false;
    } else {
      setLayoutSortBase(images.length);
    }
  }, [images.length]);

  // Drag and drop to swap states
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [hoveredSwapTargetIndex, setHoveredSwapTargetIndex] = useState<number | null>(null);
  const [activeCollisions, setActiveCollisions] = useState<{
    left: boolean;
    right: boolean;
    top: boolean;
    bottom: boolean;
  }>({ left: false, right: false, top: false, bottom: false });

  // Mobile Touch States
  const [touchDraggedIndex, setTouchDraggedIndex] = useState<number | null>(null);
  const [touchDragOverIndex, setTouchDragOverIndex] = useState<number | null>(null);

  const touchDragState = useRef<{
    startX: number;
    startY: number;
    currentIndex: number;
    hasMoved: boolean;
  } | null>(null);

  const touchZoomState = useRef<{
    startDist: number;
    startZoom: number;
  } | null>(null);
  const wasZoomingRef = useRef<boolean>(false);

  const touchDragOverIndexRef = useRef<number | null>(null);
  const touchPosRef = useRef<{ x: number; y: number } | null>(null);

  // Long press refs for mobile touch drag-to-swap
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressedRef = useRef<boolean>(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  // Cells keep touch-action:none so long-press reordering can own the gesture, which also
  // killed the native horizontal scroll everywhere a photo covers the canvas. While no
  // long-press is in flight we drive that scroll ourselves from the raw touch delta.
  const cellSwipeRef = useRef<{ lastX: number; active: boolean } | null>(null);

  // Long-press swapping for free-standing images, and the shared drop-target highlight
  // used by both the cell drag and this one.
  const floatSwapRef = useRef<{
    id: string; src: string; startX: number; startY: number;
    lastX: number; swiping: boolean; dragging: boolean;
  } | null>(null);
  const floatSwapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapOverRef = useRef<SwapTarget | null>(null);
  const [swapOver, setSwapOver] = useState<SwapTarget | null>(null);
  const [floatDragSrc, setFloatDragSrc] = useState<string | null>(null);
  useEffect(() => () => { if (floatSwapTimerRef.current) clearTimeout(floatSwapTimerRef.current); }, []);

  const setSwapOverTarget = (t: SwapTarget | null) => {
    const a = swapOverRef.current;
    const same = a && t && a.kind === t.kind &&
      (a.kind === 'cell'
        ? a.idx === (t as any).idx && a.layoutId === (t as any).layoutId
        : a.id === (t as any).id);
    if (same) return;
    swapOverRef.current = t;
    setSwapOver(t);
  };
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragOrMoveOccurredRef = useRef<boolean>(false);

  // Pointer state for dragging to pan the image inside the selected cell
  const pointerState = useRef({
    isDraggingContent: false,
    // 只認第一根手指：第二根落下就是要縮放，不是要平移
    pointerId: -1,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    cellIdx: -1
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure container size dynamically
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
          setContainerMeasured(true);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Automatically clamp image offsets when layout, ratio, gap, or preview dimensions change to prevent shifting and empty spaces
  const imagesStateKey = images.map(img => `${img.zoom || 1}-${img.rotation || 0}-${img.url || ''}`).join(',');

  useEffect(() => {
    if (images.length === 0) return;
    const templates = TEMPLATE_MAP[images.length] || [];
    const activeTmpl = templates[templateIndex] || templates[0];
    if (!activeTmpl) return;
 
    const { width: previewW, height: previewH } = getRatioDimensions();
 
    let hasChanges = false;
    const clamped = images.map((cell, idx) => {
      if (!cell || !cell.url) return cell;
      const rect = activeTmpl.rects[idx];
      if (!rect) return cell;
 
      const cellWidth = rect.w * previewW;
      const cellHeight = rect.h * previewH;
      if (cellWidth <= 0 || cellHeight <= 0) return cell;
 
      const w_img = cell.naturalWidth || 800;
      const h_img = cell.naturalHeight || 600;
      const is90or270 = (cell.rotation % 180) !== 0;
      const drawW = is90or270 ? h_img : w_img;
      const drawH = is90or270 ? w_img : h_img;
 
      const scaleX = cellWidth / drawW;
      const scaleY = cellHeight / drawH;
      const coverScale = Math.max(scaleX, scaleY);
      const finalScale = coverScale * (cell.zoom || 1);
 
      const rotatedImgW = is90or270 ? (h_img * finalScale) : (w_img * finalScale);
      const rotatedImgH = is90or270 ? (w_img * finalScale) : (h_img * finalScale);
 
      const maxShiftX = Math.max(0, (rotatedImgW - cellWidth) / 2) / cellWidth;
      const maxShiftY = Math.max(0, (rotatedImgH - cellHeight) / 2) / cellHeight;
 
      const newOffsetX = Math.max(-maxShiftX, Math.min(maxShiftX, cell.offsetX));
      const newOffsetY = Math.max(-maxShiftY, Math.min(maxShiftY, cell.offsetY));
 
      if (Math.abs(newOffsetX - cell.offsetX) > 0.001 || Math.abs(newOffsetY - cell.offsetY) > 0.001) {
        hasChanges = true;
        return {
          ...cell,
          offsetX: newOffsetX,
          offsetY: newOffsetY
        };
      }
      return cell;
    });
 
    if (hasChanges) {
      setImages(clamped);
    }
  }, [templateIndex, selectedRatio, isLandscape, gap, containerSize.width, containerSize.height, images.length, imagesStateKey]);

  const getRatioDimensions = () => {
    // 上下左右都只留這麼一點空隙（容器自己還有 py-2）。
    // 頁面下方原本要留給刪除鍵的位置已經移到「頁面順序」分頁，所以這裡可以留很少。
    const pad = 8;
    // 寬度仍然壓在 450 以免桌機上過大；高度就讓它撐滿可用空間，
    // 這樣白色畫布下緣跟工具欄之間的空隙才會跟上緣一樣小。
    const maxW = Math.min(450, Math.max(200, containerSize.width - pad));
    const maxH = Math.max(200, containerSize.height - pad);
    let w = maxW;

    let ratioW = 1;
    let ratioH = 1;

    if (selectedRatio === '1:1') {
      ratioW = 1;
      ratioH = 1;
    } else if (selectedRatio === '3:4') {
      ratioW = isLandscape ? 4 : 3;
      ratioH = isLandscape ? 3 : 4;
    } else if (selectedRatio === '2:3') {
      ratioW = isLandscape ? 3 : 2;
      ratioH = isLandscape ? 2 : 3;
    } else if (selectedRatio === '9:16') {
      ratioW = isLandscape ? 16 : 9;
      ratioH = isLandscape ? 9 : 16;
    } else if (selectedRatio === '4:5') {
      ratioW = isLandscape ? 5 : 4;
      ratioH = isLandscape ? 4 : 5;
    }

    let h = w * (ratioH / ratioW);

    const scale = Math.min(maxW / w, maxH / h);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  };

  const { width: previewW, height: previewH } = getRatioDimensions();
  /** 頁面順序模式縮小的倍率：騰出下面那兩顆按鈕的高度 */
  /** rAF 迴圈裡要用到的頁寬（不想讓迴圈跟著每次 render 重掛） */
  const previewWRef = useRef(previewW);
  previewWRef.current = previewW;
  const previewHRef = useRef(previewH);
  previewHRef.current = previewH;
  containerWRef.current = containerSize.width;
  /**
   * 沒有縮放動畫在跑的時候，整排的版面就是目標倍率該有的樣子。
   * （換頁數、換版型比例、視窗大小改變都走這裡；動畫期間交給 rAF 每一帧寫。）
   */
  useLayoutEffect(() => {
    if (kAnimRef.current) return;
    kRef.current = pagesScale;
    applyStripGeometry(pagesScale);
  }, [pagesScale, pages.length, previewW, previewH, containerSize.width, applyStripGeometry]);
  /** 格子在畫面上的實際大小會乘上整組佈局的縮放；把螢幕位移換算成格內偏移時要跟著乘。 */
  const layoutScale = activeLayout?.t?.scale ?? 1;

  // Pointer event handlers for panning the image inside the selected cell
  const handleContentPointerDown = (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
    if (selectedIndex !== idx) return;
    if (isLongPressedRef.current) return;
    // 第二根手指落下＝要雙指縮放了：把平移收掉，不然兩根手指的移動
    // 會輪流被拿來當平移量，照片就在兩根手指之間亂跳
    if (pointerState.current.isDraggingContent) {
      pointerState.current.isDraggingContent = false;
      pointerState.current.cellIdx = -1;
      return;
    }
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    // Reset move flag for content panning
    dragOrMoveOccurredRef.current = false;
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };

    const cell = images[idx];
    pointerState.current = {
      isDraggingContent: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: cell ? cell.offsetX : 0,
      startOffsetY: cell ? cell.offsetY : 0,
      cellIdx: idx
    };
  };

  const handleContentPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerState.current.isDraggingContent) return;
    // 別的手指（或縮放中冒出來的事件）不算：平移只跟著當初按下的那一根
    if (e.pointerId !== pointerState.current.pointerId) return;
    if (wsGestureRef.current?.mode === 'pinch') {
      pointerState.current.isDraggingContent = false;
      return;
    }
    if (isLongPressedRef.current) {
      pointerState.current.isDraggingContent = false;
      return;
    }
    e.stopPropagation();

    // Check distance for click cancellation
    if (pointerStartPosRef.current) {
      const dx = e.clientX - pointerStartPosRef.current.x;
      const dy = e.clientY - pointerStartPosRef.current.y;
      if (Math.hypot(dx, dy) > 8) {
        dragOrMoveOccurredRef.current = true;
      }
    }

    const { startX, startY, startOffsetX, startOffsetY, cellIdx } = pointerState.current;
    if (cellIdx === -1) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const templates = TEMPLATE_MAP[images.length] || [];
    const activeTmpl = templates[templateIndex] || templates[0];
    if (!activeTmpl) return;

    const rect = activeTmpl.rects[cellIdx];
    if (!rect) return;

    const cellWidth = rect.w * previewW * layoutScale;
    const cellHeight = rect.h * previewH * layoutScale;

    if (cellWidth > 0 && cellHeight > 0) {
      const cell = images[cellIdx];
      const w_img = cell.naturalWidth || 800;
      const h_img = cell.naturalHeight || 600;

      const is90or270 = (cell.rotation % 180) !== 0;
      const drawW = is90or270 ? h_img : w_img;
      const drawH = is90or270 ? w_img : h_img;

      const scaleX = cellWidth / drawW;
      const scaleY = cellHeight / drawH;
      const coverScale = Math.max(scaleX, scaleY);
      const finalScale = coverScale * cell.zoom;

      const rotatedImgW = is90or270 ? (h_img * finalScale) : (w_img * finalScale);
      const rotatedImgH = is90or270 ? (w_img * finalScale) : (h_img * finalScale);

      const maxShiftX = Math.max(0, (rotatedImgW - cellWidth) / 2) / cellWidth;
      const maxShiftY = Math.max(0, (rotatedImgH - cellHeight) / 2) / cellHeight;

      const calculatedOffsetX = startOffsetX + (dx / cellWidth);
      const calculatedOffsetY = startOffsetY + (dy / cellHeight);

      let newOffsetX = calculatedOffsetX;
      let newOffsetY = calculatedOffsetY;

      const snapThreshold = 0.015; // Snapping threshold

      // Snap & collision detection for X
      if (maxShiftX > 0) {
        if (Math.abs(calculatedOffsetX - maxShiftX) <= snapThreshold) {
          newOffsetX = maxShiftX;
        } else if (Math.abs(calculatedOffsetX - (-maxShiftX)) <= snapThreshold) {
          newOffsetX = -maxShiftX;
        }
      }

      // Snap & collision detection for Y
      if (maxShiftY > 0) {
        if (Math.abs(calculatedOffsetY - maxShiftY) <= snapThreshold) {
          newOffsetY = maxShiftY;
        } else if (Math.abs(calculatedOffsetY - (-maxShiftY)) <= snapThreshold) {
          newOffsetY = -maxShiftY;
        }
      }

      // Strictly clamp to prevent showing empty black areas
      newOffsetX = Math.max(-maxShiftX, Math.min(maxShiftX, newOffsetX));
      newOffsetY = Math.max(-maxShiftY, Math.min(maxShiftY, newOffsetY));

      // Determine active collisions based on final clamped positions
      const collisionMargin = 0.001;
      const leftColliding = maxShiftX > 0 && Math.abs(newOffsetX - maxShiftX) <= collisionMargin;
      const rightColliding = maxShiftX > 0 && Math.abs(newOffsetX - (-maxShiftX)) <= collisionMargin;
      const topColliding = maxShiftY > 0 && Math.abs(newOffsetY - maxShiftY) <= collisionMargin;
      const bottomColliding = maxShiftY > 0 && Math.abs(newOffsetY - (-maxShiftY)) <= collisionMargin;

      setActiveCollisions({
        left: leftColliding,
        right: rightColliding,
        top: topColliding,
        bottom: bottomColliding
      });

      setImages(prev => prev.map((img, i) => {
        if (i !== cellIdx) return img;
        return {
          ...img,
          offsetX: newOffsetX,
          offsetY: newOffsetY
        };
      }));
    }
  };

  const handleContentPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerState.current.isDraggingContent) {
      e.stopPropagation();
      pointerState.current.isDraggingContent = false;
      pointerState.current.cellIdx = -1;
      setActiveCollisions({ left: false, right: false, top: false, bottom: false });
    }
  };

  // HTML5 Drag and Drop handlers for swapping images
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    if (pointerState.current.isDraggingContent) {
      e.preventDefault();
      return;
    }

    // Set drag image to match the original aspect ratio with no rounded corners
    const img = e.currentTarget.querySelector('img');
    if (img) {
      const container = document.createElement('div');
      const w_nat = images[idx]?.naturalWidth || img.naturalWidth || 800;
      const h_nat = images[idx]?.naturalHeight || img.naturalHeight || 600;
      const aspect = w_nat / h_nat;

      // Base size of 200px on the larger side
      let dragW = 200;
      let dragH = 200;
      if (aspect >= 1) {
        dragW = 200;
        dragH = Math.round(200 / aspect);
      } else {
        dragW = Math.round(200 * aspect);
        dragH = 200;
      }

      container.style.width = `${dragW}px`;
      container.style.height = `${dragH}px`;
      container.style.position = 'fixed';
      container.style.top = '-2000px';
      container.style.left = '-2000px';
      container.style.zIndex = '-9999';
      container.style.borderRadius = '0px';
      container.style.overflow = 'hidden';
      container.style.border = 'none';
      container.style.backgroundColor = '#000000';
      container.style.boxShadow = '0 12px 30px rgba(0,0,0,0.6)';
      container.style.pointerEvents = 'none';

      const cloneImg = document.createElement('img');
      cloneImg.src = images[idx]?.url || img.src;
      cloneImg.style.width = '100%';
      cloneImg.style.height = '100%';
      cloneImg.style.maxWidth = 'none';
      cloneImg.style.maxHeight = 'none';
      cloneImg.style.objectFit = 'cover';
      cloneImg.style.borderRadius = '0px';
      cloneImg.style.transform = `rotate(${images[idx]?.rotation || 0}deg)`;

      container.appendChild(cloneImg);
      document.body.appendChild(container);
      e.dataTransfer.setDragImage(container, dragW / 2, dragH / 2);

      setTimeout(() => {
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      }, 0);
    }

    // Wrap in setTimeout so the browser finishes capturing the drag image before we hide the source cell's image
    setTimeout(() => {
      setDraggedIndex(idx);
    }, 0);

    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === idx) return;
    if (selectedIndex === draggedIndex) return;
    setDragOverIndex(idx);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === idx) return;
    if (selectedIndex === draggedIndex) return;

    setImages(prev => {
      const copy = [...prev];
      const temp = { ...copy[draggedIndex] };
      // After swapping, both images must become fully filling/occupying the cell (zoom = 1.0, offsetX = 0, offsetY = 0)
      copy[draggedIndex] = {
        ...copy[idx],
        zoom: 1.0,
        offsetX: 0,
        offsetY: 0
      };
      copy[idx] = {
        ...temp,
        zoom: 1.0,
        offsetX: 0,
        offsetY: 0
      };
      return copy;
    });

    if (selectedIndex === draggedIndex) {
      setSelectedIndex(idx);
    } else if (selectedIndex === idx) {
      setSelectedIndex(draggedIndex);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  /** 兩段式選取：先選整組佈局，已經選中同一個佈局時再點才選到裡面的格子。 */
  const selectCellOrLayout = (layoutId: string, idx: number) => {
    // 兩段式：第一次點先選整組佈局，已經選中同一個佈局時再點才選到裡面的格子。
    if (selectedLayoutId !== layoutId) {
      setSelectedLayoutId(layoutId);
      setSelectedIndex(null);
      setSelectedFloatingId(null);
      return;
    }
    setSelectedIndex(idx);
    // 空格子被選到就直接開選圖（觸控的合成 click 會被防重複機制擋掉，這裡要自己開）
    const lay = pages.flatMap(p => p.layouts).find(l => l.id === layoutId);
    if (lay && !lay.images[idx]?.url) {
      setSlotToUpload(idx);
      replaceInputRef.current?.click();
    }
  };

  const handleCellTouchStart = (e: React.TouchEvent<HTMLDivElement>, idx: number, layoutId: string) => {
    const isSelected = selectedIndex === idx;

    // Reset touch movement tracking
    dragOrMoveOccurredRef.current = false;

    // Clear any existing long-press timer
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    isLongPressedRef.current = false;

    // 已經選中別的東西時，這一手勢屬於「畫布層級手勢」（移動/縮放選中物件），
    // 不要在這裡再啟動長按交換或格內縮放。
    if (selectedFloatingId) return;
    // 別的佈局被選取時，手勢屬於那個佈局
    if (selectedLayoutId !== null && selectedLayoutId !== layoutId) return;
    if (selectedIndex !== null && selectedIndex !== idx) return;
    // 註：這個佈局整組被選取時仍然允許往下走 —— 短拖曳會搬整組佈局，
    //     但長按 150ms 之後就切換成「拖曳交換這一格的照片」。

    if (e.touches.length >= 2) {
      // 整組佈局被選取時，雙指是要縮放「整組」；手指剛好落在某一格上面
      // 不代表要縮那一格裡的照片，這裡直接讓給佈局自己的處理器
      if (selectedIndex === null) {
        touchZoomState.current = null;
        touchDragState.current = null;
        return;
      }
      wasZoomingRef.current = true;
      touchDragState.current = null;
      // Pinch-to-zoom start
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchZoomState.current = {
        startDist: dist,
        startZoom: images[idx]?.zoom || 1.0,
      };
      // Cancel pointer panning
      pointerState.current.isDraggingContent = false;
    } else if (e.touches.length === 1) {
      wasZoomingRef.current = false;
      // Prevent dragging empty cells
      const thisLayout = pages.flatMap(p => p.layouts).find(l => l.id === layoutId);
      if (!thisLayout?.images[idx]?.url) {
        // 空格子沒有長按交換，但仍要記起點，滑動時才判斷得出這是拖曳而不是點擊
        touchStartPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return;
      }

      const touch = e.touches[0];
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      cellSwipeRef.current = { lastX: touch.clientX, active: false };

      /* 長按門檻。原本 150ms 太短，手指稍微停一下就被判定成「要拖去交換」，
         滑動與點選都很容易誤觸。250ms 是拖曳排序常見的手感：還是立即，
         但已經過了「手指剛放上去那一瞬間」。 */
      longPressTimeoutRef.current = setTimeout(() => {
        isLongPressedRef.current = true;

        // Ensure pointer content dragging is fully disabled when long-press triggers
        pointerState.current.isDraggingContent = false;
        pointerState.current.cellIdx = -1;
        // 長按交換勝過「搬動整組佈局」與畫布捲動
        layoutGestureRef.current = null;
        stopInertia();
        panRef.current = null;
        wsGestureRef.current = null;

        // Vibrate to give physical feedback to the user (if supported)
        if (navigator.vibrate) {
          navigator.vibrate(40);
        }

        // Initialize custom touch drag state
        touchPosRef.current = { x: touch.clientX, y: touch.clientY };
        touchDragState.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          currentIndex: idx,
          hasMoved: true, // Started with long-press, mark as moved so the floating preview shows up!
        };

        setTouchDraggedIndex(idx);
      }, LONG_PRESS_MS);
    }
  };

  const handleCellTouchMove = (e: React.TouchEvent<HTMLDivElement>, idx: number, layoutId: string) => {
    const isSelected = selectedIndex === idx;

    if (touchZoomState.current && e.touches.length >= 2) {
      e.preventDefault();
      dragOrMoveOccurredRef.current = true;
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = currentDist / touchZoomState.current.startDist;
      let newZoom = touchZoomState.current.startZoom * factor;
      newZoom = Math.max(1.0, Math.min(5.0, newZoom));

      // Calculate and clamp offsets simultaneously inside the state setter
      // to completely prevent any frame from showing empty space borders
      setImages(prev => prev.map((cell, i) => {
        if (i !== idx) return cell;

        const templates = TEMPLATE_MAP[prev.length] || [];
        const activeTmpl = templates[templateIndex] || templates[0];
        const rect = activeTmpl?.rects[i];
        if (!rect) return { ...cell, zoom: newZoom };

        const cellWidth = rect.w * previewW;
        const cellHeight = rect.h * previewH;
        if (cellWidth <= 0 || cellHeight <= 0) return { ...cell, zoom: newZoom };

        const w_img = cell.naturalWidth || 800;
        const h_img = cell.naturalHeight || 600;
        const is90or270 = (cell.rotation % 180) !== 0;
        const drawW = is90or270 ? h_img : w_img;
        const drawH = is90or270 ? w_img : h_img;

        const scaleX = cellWidth / drawW;
        const scaleY = cellHeight / drawH;
        const coverScale = Math.max(scaleX, scaleY);
        const finalScale = coverScale * newZoom;

        const rotatedImgW = is90or270 ? (h_img * finalScale) : (w_img * finalScale);
        const rotatedImgH = is90or270 ? (w_img * finalScale) : (h_img * finalScale);

        const maxShiftX = Math.max(0, (rotatedImgW - cellWidth) / 2) / cellWidth;
        const maxShiftY = Math.max(0, (rotatedImgH - cellHeight) / 2) / cellHeight;

        const newOffsetX = Math.max(-maxShiftX, Math.min(maxShiftX, cell.offsetX));
        const newOffsetY = Math.max(-maxShiftY, Math.min(maxShiftY, cell.offsetY));

        return {
          ...cell,
          zoom: newZoom,
          offsetX: newOffsetX,
          offsetY: newOffsetY
        };
      }));
    } else if (e.touches.length === 1) {
      if (wasZoomingRef.current) {
        // Prevent drag behavior if we were just zooming and one finger is still down
        return;
      }
      const touch = e.touches[0];
      
      if (touchStartPosRef.current) {
        const dx = touch.clientX - touchStartPosRef.current.x;
        const dy = touch.clientY - touchStartPosRef.current.y;
        if (Math.hypot(dx, dy) > 8) {
          dragOrMoveOccurredRef.current = true;
        }
      }

      // If long press has not triggered yet, check if finger moved too far to cancel
      if (!isLongPressedRef.current) {
        if (touchStartPosRef.current) {
          const dx = touch.clientX - touchStartPosRef.current.x;
          const dy = touch.clientY - touchStartPosRef.current.y;
          if (Math.hypot(dx, dy) > 10) {
            // Cancel long press timeout
            if (longPressTimeoutRef.current) {
              clearTimeout(longPressTimeoutRef.current);
              longPressTimeoutRef.current = null;
            }
          }
        }
        return; // Skip dragging behavior until long pressed
      }

      if (touchDragState.current) {
        // Prevent default screen scrolling during mobile touch drags
        if (e.cancelable) {
          e.preventDefault();
        }

        const floatingEl = document.getElementById('mobile-drag-floating-thumbnail');
        if (floatingEl) {
          floatingEl.style.transform = `translate3d(${touch.clientX}px, ${touch.clientY}px, 0) translate(-50%, -50%) scale(1.15) rotate(4deg)`;
        }

        const dx = touch.clientX - touchDragState.current.startX;
        const dy = touch.clientY - touchDragState.current.startY;

        touchDragState.current.hasMoved = true;
        
        const hoveredIdx = getCellIndexFromPoint(touch.clientX, touch.clientY);
        if (hoveredIdx !== touchDragOverIndexRef.current) {
          touchDragOverIndexRef.current = hoveredIdx;
          setTouchDragOverIndex(hoveredIdx);
        }
        // A cell can also be dropped onto a free-standing image.
        const swapTarget = getSwapTargetFromPoint(touch.clientX, touch.clientY);
        setSwapOverTarget(swapTarget && swapTarget.kind === 'floating' ? swapTarget : null);
      }
    }
  };

  const handleCellTouchEnd = (e: React.TouchEvent<HTMLDivElement>, idx: number, layoutId: string) => {
    if (e.touches.length === 0) {
      wasZoomingRef.current = false;
    }

    // Clear any active long-press timer
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }

    if (touchZoomState.current) {
      touchZoomState.current = null;
    }

    if (touchDragState.current) {
      if (isLongPressedRef.current && touchDragState.current.hasMoved) {
        // Perform Touch Swap
        const targetOverIndex = touchDragOverIndexRef.current;
        const floatTarget = swapOverRef.current;
        const fromIdx = touchDragState.current.currentIndex;

        if (floatTarget && floatTarget.kind === 'floating') {
          void applySwap({ kind: 'cell', idx: fromIdx, src: images[fromIdx]?.url || '' }, floatTarget);
        } else if (targetOverIndex !== null && targetOverIndex !== fromIdx) {
          const toIdx = targetOverIndex;

          setImages(prev => {
            const copy = [...prev];
            const temp = { ...copy[fromIdx] };
            copy[fromIdx] = {
              ...copy[toIdx],
              zoom: 1.0,
              offsetX: 0,
              offsetY: 0
            };
            copy[toIdx] = {
              ...temp,
              zoom: 1.0,
              offsetX: 0,
              offsetY: 0
            };
            return copy;
          });

          if (selectedIndex === fromIdx) {
            setSelectedIndex(toIdx);
          } else if (selectedIndex === toIdx) {
            setSelectedIndex(fromIdx);
          }
        }
      } else {
        // Simple touch tap - select the cell (only if we didn't move/drag)
        if (!dragOrMoveOccurredRef.current) {
          selectCellOrLayout(layoutId, idx);
        }
      }

      touchDragState.current = null;
      touchDragOverIndexRef.current = null;
      setTouchDraggedIndex(null);
      setTouchDragOverIndex(null);
      setSwapOverTarget(null);
      touchPosRef.current = null;
    } else {
      // Regular touch release without starting drag state
      if (!isLongPressedRef.current && !dragOrMoveOccurredRef.current) {
        selectCellOrLayout(layoutId, idx);
      }
    }

    isLongPressedRef.current = false;
    touchStartPosRef.current = null;
    cellSwipeRef.current = null;
    touchHandledAtRef.current = Date.now();
  };

  // Cleanup long press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
      }
    };
  }, []);

  /** 這批匯入的圖只放一次（等版面量好之後才放，見下面） */
  const initialPlacedRef = useRef(false);

  // Initialize with initialFiles if provided
  useEffect(() => {
    /* 一定要等畫布量好才放。
       這支以前只掛在 [initialFiles] 上，第一次執行時 containerSize 還是 0 ——
       previewW/previewH 那時候是保底的 150×200，而不是真正的頁面大小。
       於是「置中」是照 150×200 算的，換算到真的頁面上就變成偏左上一大塊。
       改成等 containerMeasured 之後才放，第一張才會真的在正中央。 */
    if (!containerMeasured) return;
    if (initialPlacedRef.current) return;
    if (initialFiles && initialFiles.length > 0) {
      initialPlacedRef.current = true;
      const filesToLoad = initialFiles.slice(0, 25);
      const loadInitial = async () => {
        const fImgs: FloatingImage[] = [];
        for (let idx = 0; idx < filesToLoad.length; idx++) {
          const f = filesToLoad[idx];
          const url = URL.createObjectURL(f);
          const video = isVideoFile(f);
          const dims = video ? await getVideoDimensions(url) : await getImageDimensions(url);

          const aspect = dims.width / dims.height;

          /* 讀圖是非同步的，中途畫面可能又量了一次（旋轉、鍵盤收起來…），
             所以每一張都當場拿最新的頁面尺寸，不要用閉包裡那份。 */
          const previewW = previewWRef.current;
          const previewH = previewHRef.current;

          const margin = 12; // comfortable margin from boundaries
          const maxAllowedW = Math.max(10, previewW - 2 * margin);
          const maxAllowedH = Math.max(10, previewH - 2 * margin);

          let initialWidth = 160;
          let initialHeight = 160;
          
          if (aspect > 1) {
            initialHeight = initialWidth / aspect;
          } else {
            initialWidth = initialHeight * aspect;
          }
          
          if (initialWidth > maxAllowedW) {
            initialWidth = maxAllowedW;
            initialHeight = initialWidth / aspect;
          }
          if (initialHeight > maxAllowedH) {
            initialHeight = maxAllowedH;
            initialWidth = initialHeight * aspect;
          }
          
          const baseX = (previewW - initialWidth) / 2;
          const baseY = (previewH - initialHeight) / 2;
          
          const minX = margin;
          const maxX = Math.max(margin, previewW - margin - initialWidth);
          const minY = margin;
          const maxY = Math.max(margin, previewH - margin - initialHeight);
          
          const maxOffsetX = Math.max(0, maxX - baseX);
          const maxOffsetY = Math.max(0, maxY - baseY);
          
          let offsetStep = 16;
          if (filesToLoad.length > 1) {
            const maxNeededStepX = maxOffsetX / (filesToLoad.length - 1);
            const maxNeededStepY = maxOffsetY / (filesToLoad.length - 1);
            offsetStep = Math.min(16, maxNeededStepX, maxNeededStepY);
          }
          
          /* 第一張永遠是正中央（idx 0 ⇒ 位移 0），其餘依序往右下錯開。
             夾邊界時特別讓第一張免夾 —— 圖再大也不會超出（上面已經先縮到
             maxAllowedW/H 了），夾了反而會在極端比例下把它推離中心。 */
          let x = baseX + (idx * offsetStep);
          let y = baseY + (idx * offsetStep);

          if (idx > 0) {
            // Clamp to stay strictly inside the margin
            x = Math.max(minX, Math.min(x, maxX));
            y = Math.max(minY, Math.min(y, maxY));
          }

          fImgs.push({
            id: Math.random().toString(36).substring(2, 9),
            src: url,
            x,
            y,
            width: initialWidth,
            height: initialHeight,
            scale: 1.0,
            rotation: 0,
            ...(video ? { isVideo: true } : {}),
          });
        }
        setFloatingImages(fImgs);
      };
      loadInitial();
    }
  }, [initialFiles, containerMeasured]);

  /* 收尾單獨一支：上面那支現在會因為 containerMeasured 變動而重跑，
     清空的動作要是還留在裡面，量好尺寸的那一刻就會把剛放好的圖全部清掉。 */
  useEffect(() => {
    return () => {
      // Cleanup URLs on unmount
      setImages(prev => {
        prev.forEach(img => {
          /* revoke */
        });
        return [];
      });
      setFloatingImages(prev => {
        prev.forEach(img => {
          /* revoke */
        });
        return [];
      });
    };
  }, []);

  /* ── 自動存檔 ────────────────────────────────────────────────────
     照片放 IndexedDB、版面放 JSON。帶著新照片進來就是全新的一份，
     重新整理（沒有帶照片）才會把上次的接回來。 */
  // 用 state 而不是 ref：旗標翻起來的時候要讓存檔的 effect 再跑一次，
  // 不然「進來就沒再動過」的那一份會漏存
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (initialFiles && initialFiles.length > 0) {
        await clearDraft();
        if (alive) setDraftReady(true);
        return;
      }
      if (!hasDraft()) { setDraftReady(true); return; }
      const draft = await loadDraft();
      if (!alive) return;
      if (draft) {
        setPages(draft.pages);
        setFloatingImages(draft.floatingImages);
        setSelectedRatio(draft.selectedRatio);
        setIsLandscape(draft.isLandscape);
        setActivePageIndex(0);
      }
      setDraftReady(true);
    })();
    return () => { alive = false; };
  }, [initialFiles]);

  /** 離開拼圖＝這一份結束了：先關掉自動存檔再把草稿收掉，
      不然剛排隊的那次存檔會在清掉之後又寫回去。 */
  const leftRef = useRef(false);
  const handleLeave = () => {
    leftRef.current = true;
    clearDraft();
    onHome();
  };

  useEffect(() => {
    if (!draftReady || leftRef.current) return;
    const empty = floatingImages.length === 0 && pages.every(p => p.layouts.length === 0);
    if (empty) return;
    const t = setTimeout(() => {
      if (leftRef.current) return;
      saveDraft({ pages, floatingImages, selectedRatio, isLandscape });
    }, 1200);
    return () => clearTimeout(t);
  }, [draftReady, pages, floatingImages, selectedRatio, isLandscape]);

  // When image count changes, reset selected index if out of bounds, and clamp templateIndex
  useEffect(() => {
    const templates = TEMPLATE_MAP[images.length] || [];
    if (templateIndex >= templates.length) {
      setTemplateIndex(0);
    }
    if (selectedIndex !== null && selectedIndex >= images.length) {
      setSelectedIndex(null);
    }
  }, [images.length, templateIndex, selectedIndex]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, append = false) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newFloatingImages: FloatingImage[] = [];
    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx];
      const url = URL.createObjectURL(f);
      const video = isVideoFile(f as File);
      const dims = video ? await getVideoDimensions(url) : await getImageDimensions(url);
      
      const aspect = dims.width / dims.height;

      // 讀圖是非同步的，中途畫面可能又量過一次，所以當場拿最新的頁面尺寸
      const previewW = previewWRef.current;
      const previewH = previewHRef.current;

      const margin = 12; // comfortable margin from boundaries
      const maxAllowedW = Math.max(10, previewW - 2 * margin);
      const maxAllowedH = Math.max(10, previewH - 2 * margin);
      
      let initialWidth = 160;
      let initialHeight = 160;
      
      if (aspect > 1) {
        initialHeight = initialWidth / aspect;
      } else {
        initialWidth = initialHeight * aspect;
      }
      
      if (initialWidth > maxAllowedW) {
        initialWidth = maxAllowedW;
        initialHeight = initialWidth / aspect;
      }
      if (initialHeight > maxAllowedH) {
        initialHeight = maxAllowedH;
        initialWidth = initialHeight * aspect;
      }
      
      const baseX = activePageIndex * (previewW + 1) + (previewW - initialWidth) / 2;
      const baseY = (previewH - initialHeight) / 2;
      
      const minX = activePageIndex * (previewW + 1) + margin;
      const maxX = Math.max(minX, activePageIndex * (previewW + 1) + previewW - margin - initialWidth);
      const minY = margin;
      const maxY = Math.max(margin, previewH - margin - initialHeight);
      
      const maxOffsetX = Math.max(0, maxX - baseX);
      const maxOffsetY = Math.max(0, maxY - baseY);
      
      let offsetStep = 16;
      if (files.length > 1) {
        const maxNeededStepX = maxOffsetX / (files.length - 1);
        const maxNeededStepY = maxOffsetY / (files.length - 1);
        offsetStep = Math.min(16, maxNeededStepX, maxNeededStepY);
      }
      
      let x = baseX + (idx * offsetStep);
      let y = baseY + (idx * offsetStep);
      
      // Clamp to stay strictly inside the margin for the active page
      x = Math.max(minX, Math.min(x, maxX));
      y = Math.max(minY, Math.min(y, maxY));
      
      newFloatingImages.push({
        id: Math.random().toString(36).substring(2, 9),
        src: url,
        x,
        y,
        width: initialWidth,
        height: initialHeight,
        scale: 1.0,
        rotation: 0,
        ...(video ? { isVideo: true } : {}),
      });
    }

    setFloatingImages(prev => [...prev, ...newFloatingImages]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleReplaceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const targetIdx = slotToUpload !== null ? slotToUpload : selectedIndex;

    const loadPromises = files.map(async (file) => {
      const url = URL.createObjectURL(file);
      const dims = await getImageDimensions(url);
      return { file, url, dims };
    });

    const loadedFiles = await Promise.all(loadPromises);

    setImages(prev => {
      const updated = [...prev];
      let fileIdx = 0;

      if (targetIdx !== null && fileIdx < loadedFiles.length) {
        const { file, url, dims } = loadedFiles[fileIdx++];
        const currentCell = updated[targetIdx];
        if (currentCell && currentCell.url) {
          /* revoke */
        }
        updated[targetIdx] = {
          ...currentCell,
          id: currentCell?.id || Math.random().toString(36).substring(2, 9),
          url: url,
          file: file,
          zoom: 1.0,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          naturalWidth: dims.width,
          naturalHeight: dims.height,
        };
      }

      for (let i = 0; i < updated.length && fileIdx < loadedFiles.length; i++) {
        if (updated[i].url === '') {
          const { file, url, dims } = loadedFiles[fileIdx++];
          updated[i] = {
            ...updated[i],
            id: updated[i].id || Math.random().toString(36).substring(2, 9),
            url: url,
            file: file,
            zoom: 1.0,
            offsetX: 0,
            offsetY: 0,
            rotation: 0,
            naturalWidth: dims.width,
            naturalHeight: dims.height,
          };
        }
      }

      return updated;
    });

    setSlotToUpload(null);
    if (replaceInputRef.current) replaceInputRef.current.value = '';
  };
  const handleRemoveImage = (index: number) => {
    const cell = images[index];
    /* revoke */
    const updated = images.filter((_, idx) => idx !== index);
    setImages(updated);
    setSelectedIndex(null);
  };

  const handleDeleteCellImage = (index: number) => {
    setImages(prev => prev.map((img, idx) => {
      if (idx !== index) return img;
      return {
        ...img,
        url: '',
        zoom: 1.0,
        offsetX: 0,
        offsetY: 0,
        rotation: 0
      };
    }));
  };

  const handleResetCellImage = (index: number) => {
    setImages(prev => prev.map((img, idx) => {
      if (idx !== index) return img;
      return {
        ...img,
        zoom: 1.0,
        offsetX: 0,
        offsetY: 0,
        rotation: 0
      };
    }));
  };

  const getCellIndexFromPoint = (clientX: number, clientY: number): number | null => {
    const elem = document.elementFromPoint(clientX, clientY);
    if (!elem) return null;
    const cellElem = elem.closest('[data-cell-id]');
    // 一頁上可能有多個佈局，只有「正在編輯的那個」的格子才算數
    if (cellElem && cellElem.closest(`[data-layout-id="${selectedLayoutId}"]`)) {
      const idAttr = cellElem.getAttribute('data-cell-id');
      if (idAttr !== null) {
        return parseInt(idAttr, 10);
      }
    }
    return null;
  };

  // A long-press drag can start from a layout cell or from a free-standing image, and can
  // land on either kind, so drop targets are resolved for both. Stickers sit above the
  // cells, so whichever is on top at that point wins.
  const getSwapTargetFromPoint = (clientX: number, clientY: number): SwapTarget | null => {
    const elem = document.elementFromPoint(clientX, clientY);
    if (!elem) return null;
    const fEl = elem.closest('[data-floating-id]');
    if (fEl) {
      const id = fEl.getAttribute('data-floating-id');
      // 文字圖層沒有照片可以換
      if (id && !floatingImages.find(f => f.id === id)?.text) return { kind: 'floating', id };
      if (id) return null;
    }
    const cEl = elem.closest('[data-cell-id]');
    if (cEl) {
      // 拖放不需要先選中佈局，任何佈局的格子都可以接收
      const idAttr = cEl.getAttribute('data-cell-id');
      const layEl = cEl.closest('[data-layout-id]');
      if (idAttr !== null) {
        return { kind: 'cell', idx: parseInt(idAttr, 10), layoutId: layEl?.getAttribute('data-layout-id') || undefined };
      }
    }
    return null;
  };

  // Swapping a picture into a free-standing frame has to re-derive the frame's box from the
  // incoming aspect ratio, otherwise the picture would be stretched. The frame's longest
  // side, its position and its rotation are preserved.
  const reframeFloating = (box: { width: number; height: number }, url: string): Promise<{ width: number; height: number }> =>
    new Promise(resolve => {
      const longest = Math.max(box.width, box.height);
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        resolve(aspect >= 1
          ? { width: longest, height: longest / aspect }
          : { width: longest * aspect, height: longest });
      };
      img.onerror = () => resolve({ width: box.width, height: box.height });
      img.src = url;
    });

  const applySwap = async (source: SwapSource, target: SwapTarget) => {
    if (source.kind === 'cell' && target.kind === 'cell') {
      if (source.idx === target.idx) return;
      const fromIdx = source.idx, toIdx = target.idx;
      setImages(prev => {
        const copy = [...prev];
        const temp = { ...copy[fromIdx] };
        copy[fromIdx] = { ...copy[toIdx], zoom: 1.0, offsetX: 0, offsetY: 0 };
        copy[toIdx] = { ...temp, zoom: 1.0, offsetX: 0, offsetY: 0 };
        return copy;
      });
      if (selectedIndex === fromIdx) setSelectedIndex(toIdx);
      else if (selectedIndex === toIdx) setSelectedIndex(fromIdx);
      return;
    }

    if (source.kind === 'floating' && target.kind === 'floating') {
      if (source.id === target.id) return;
      const a = floatingImages.find(f => f.id === source.id);
      const b = floatingImages.find(f => f.id === target.id);
      if (!a || !b) return;
      const [boxA, boxB] = await Promise.all([
        reframeFloating(a, b.src),
        reframeFloating(b, a.src),
      ]);
      setFloatingImages(prev => prev.map(f => {
        if (f.id === a.id) return { ...f, src: b.src, ...boxA };
        if (f.id === b.id) return { ...f, src: a.src, ...boxB };
        return f;
      }));
      return;
    }

    // Mixed: one side is a layout cell, the other a free-standing image.
    const cellIdx = source.kind === 'cell' ? source.idx : (target as { kind: 'cell'; idx: number }).idx;
    const floatId = source.kind === 'floating' ? source.id : (target as { kind: 'floating'; id: string }).id;
    // 目標格子可能屬於「沒有被選中的佈局」，所以要指名是哪一個佈局
    const targetLayoutId = target.kind === 'cell' ? target.layoutId : undefined;
    const targetLayout = targetLayoutId
      ? pages.flatMap(p => p.layouts).find(l => l.id === targetLayoutId)
      : activeLayout;
    const setCells = (fn: (imgs: ImageCell[]) => ImageCell[]) => {
      if (!targetLayoutId) { setImages(fn); return; }
      setPages(prev => prev.map(p => p.layouts.some(l => l.id === targetLayoutId)
        ? { ...p, layouts: p.layouts.map(l => l.id === targetLayoutId ? { ...l, images: fn(l.images) } : l) }
        : p));
    };
    const cellImages = targetLayout?.images ?? images;
    const cell = cellImages[cellIdx];
    const float = floatingImages.find(f => f.id === floatId);
    if (!cell || !float) return;
    // 格子必須拿到新圖的原始長寬，否則 cover 會用上一張圖的比例算，畫面就被拉扁了
    const incoming = await getImageDimensions(float.src);

    if (!cell.url) {
      // 空格子沒有東西可以換，等於把圖片搬進去，自由圖層就此消失
      setCells(prev => prev.map((c, i) => i === cellIdx
        ? { ...c, url: float.src, file: undefined, zoom: 1.0, offsetX: 0, offsetY: 0, rotation: 0,
            naturalWidth: incoming.width, naturalHeight: incoming.height }
        : c));
      setFloatingImages(prev => prev.filter(f => f.id !== floatId));
      setSelectedFloatingId(null);
      return;
    }

    const box = await reframeFloating(float, cell.url);
    setCells(prev => prev.map((c, i) => i === cellIdx
      ? { ...c, url: float.src, file: undefined, zoom: 1.0, offsetX: 0, offsetY: 0,
          naturalWidth: incoming.width, naturalHeight: incoming.height }
      : c));
    setFloatingImages(prev => prev.map(f => f.id === floatId ? { ...f, src: cell.url, ...box } : f));
  };

  const handleFloatSwapTouchStart = (fImg: FloatingImage) => (e: React.TouchEvent) => {
    if (fImg.text !== undefined) return;   // 文字圖層不參與長按交換
    if (e.touches.length !== 1) {
      if (floatSwapTimerRef.current) { clearTimeout(floatSwapTimerRef.current); floatSwapTimerRef.current = null; }
      floatSwapRef.current = null;
      return;
    }
    const t = e.touches[0];
    floatSwapRef.current = {
      id: fImg.id, src: fImg.src,
      startX: t.clientX, startY: t.clientY, lastX: t.clientX,
      swiping: false, dragging: false,
    };
    if (floatSwapTimerRef.current) clearTimeout(floatSwapTimerRef.current);
    floatSwapTimerRef.current = setTimeout(() => {
      const s = floatSwapRef.current;
      if (!s || s.swiping) return;
      s.dragging = true;
      // A swap drag wins over the free-move drag the canvas handler would otherwise run.
      globalFloatingTouchState.current = null;
      // 也要把畫布的捲動／物件手勢一起取消，長按拖曳時頁面不該跟著滑
      stopInertia();
      panRef.current = null;
      wsGestureRef.current = null;
      setActiveGuidelines([]);
      if (navigator.vibrate) navigator.vibrate(40);
      setFloatDragSrc(s.src);
    }, LONG_PRESS_MS);
  };

  const handleFloatSwapTouchMove = (e: React.TouchEvent) => {
    const s = floatSwapRef.current;
    if (!s || e.touches.length !== 1) return;
    const t = e.touches[0];

    if (s.dragging) {
      // 擋原生捲動的是那個非 passive 的 document 監聽器（React 這層是 passive 的）
      const el = document.getElementById('float-drag-thumbnail');
      if (el) el.style.transform = `translate3d(${t.clientX}px, ${t.clientY}px, 0) translate(-50%, -50%) scale(1.1) rotate(4deg)`;
      const target = getSwapTargetFromPoint(t.clientX, t.clientY);
      setSwapOverTarget(target && !(target.kind === 'floating' && target.id === s.id) ? target : null);
      return;
    }

    const dx = t.clientX - s.startX;
    const dy = t.clientY - s.startY;
    if (Math.hypot(dx, dy) > 10) {
      if (floatSwapTimerRef.current) { clearTimeout(floatSwapTimerRef.current); floatSwapTimerRef.current = null; }
    }
  };

  const handleFloatSwapTouchEnd = () => {
    if (floatSwapTimerRef.current) { clearTimeout(floatSwapTimerRef.current); floatSwapTimerRef.current = null; }
    const s = floatSwapRef.current;
    floatSwapRef.current = null;
    if (!s) return;
    if (s.dragging) {
      const target = swapOverRef.current;
      setSwapOverTarget(null);
      setFloatDragSrc(null);
      if (target && !(target.kind === 'floating' && target.id === s.id)) {
        void applySwap({ kind: 'floating', id: s.id, src: s.src }, target);
      }
    }
  };


  // ------ 佈局被選取時的手勢：拖曳移動、雙指縮放 ------
  const layoutGestureRef = useRef<{
    mode: 'drag' | 'pinch';
    startX: number; startY: number;
    baseX: number; baseY: number; baseScale: number;
    startDist: number;
  } | null>(null);

  /**
   * 全選佈局的縮放：就是單純把整組等比例放大縮小，位置不動。
   *
   * 這裡刻意「每一帧就直接寫進真實尺寸」，不做那種「手勢中先用 transform 撐著、
   * 放手才提交」的把戲 —— 只要提交那一步因為任何原因沒跑到（手勢被瀏覽器中斷、
   * 選取狀態剛好被清掉…），畫面就會整個彈回原大小。沒有提交這一步就不會有這種事。
   */
  const scaleLayout = (next: number, targetId: string | null) => {
    patchLayoutT({ scale: Math.max(MIN_LAYOUT_SCALE, Math.min(4, next)) }, targetId);
  };

  /**
   * 雙指縮放佈局：跟一般圖片的捏合完全一樣 —— 邊界會吸附頁緣，而且把「現在真的
   * 對齊到」的線畫出來。捏合時中心不動，只有四個邊會隨倍率移動，所以把倍率解成
   * 「這條邊剛好落在頁緣上」的值，最近的那一個在門檻內就吸附過去。
   *
   * 四角的縮放圓點刻意不套這一支（見 handleLayoutCornerMove 的註解）：佈局在
   * scale 1 時剛好等於整頁，四個邊會同時對齊，拉角的時候會一直被拉回 1。
   * 捏合是兩根手指、位移量大得多，4px 的黏著範圍推得過去，不會卡住。
   */
  const scaleLayoutSnapped = (next: number, targetId: string | null) => {
    let ns = Math.max(MIN_LAYOUT_SCALE, Math.min(4, next));
    const rect = getPageRect(selectedLayoutPageIdx >= 0 ? selectedLayoutPageIdx : activePageIndex);
    const t = activeLayout?.t;
    if (!rect || !t) { scaleLayout(ns, targetId); return; }
    /* 佈局的「未縮放框」不一定等於整頁 —— 它可以有自己的長寬比（layoutBox），
       而且是置中的。吸附一定要用這個框算，不然設過比例的佈局會照著整頁的
       邊界吸，畫面上的框跟實際行為就對不上。 */
    const box = layoutBox(activeLayout, rect.width, rect.height);
    const x = rect.left + (rect.width - box.w) / 2 + t.x;
    const y = rect.top + (rect.height - box.h) / 2 + t.y;
    const cx = x + box.w / 2, cy = y + box.h / 2;
    if (enableSnapping) {
      const SNAP = 4;
      let best = Infinity, bestScale = ns;
      pageRectsNear(getAllPageRects(), cx).forEach(pr => {
        const cands: number[] = [];
        if (box.w > 1) {
          cands.push((2 * (cx - pr.left)) / box.w);    // 左邊貼齊
          cands.push((2 * (pr.right - cx)) / box.w);   // 右邊貼齊
        }
        if (box.h > 1) {
          cands.push((2 * (cy - pr.top)) / box.h);     // 上邊貼齊
          cands.push((2 * (pr.bottom - cy)) / box.h);  // 下邊貼齊
        }
        cands.forEach(cand => {
          if (!(cand > MIN_LAYOUT_SCALE) || cand > 4) return;
          // 換算成「畫面上差幾個像素」再比門檻，倍率本身的差沒有意義
          const px = Math.abs(cand - ns) * Math.max(box.w, box.h) / 2;
          if (px < SNAP && px < best) { best = px; bestScale = cand; }
        });
      });
      if (best < SNAP) ns = bestScale;
    }
    patchLayoutT({ scale: ns }, targetId);
    /* 只畫「邊」的線（edgeOnly）：捏合時中心點根本不會動，中線會從頭亮到尾 ——
       佈局沒搬過的時候本來就正正對在頁面中心，那兩條線等於整趟手勢都掛在畫面上，
       看起來像壞掉。會隨倍率移動的只有四個邊，那才是這個手勢真正的回饋。 */
    setActiveGuidelines(dedupeGuidelines(pageGuidelinesAt(x, y, rect.width, rect.height, ns, true)));
  };

  /**
   * 改佈局的位置／大小。targetId 由手勢在「開始的時候」記下來 ——
   * 不要靠當下的 selectedLayoutId：手指放開的瞬間選取狀態可能已經被別的
   * handler 清掉，那樣這一筆就會寫不進去，看起來就是「縮放完自己彈回原大小」。
   */
  const patchLayoutT = (patch: Partial<{ x: number; y: number; scale: number; rot: number }>, targetId?: string | null) => {
    const id = targetId ?? selectedLayoutId;
    if (!id) return;
    setPages(prev => prev.map(p => p.layouts.some(l => l.id === id) ? ({
      ...p,
      layouts: p.layouts.map(l => l.id === id ? { ...l, t: { ...l.t, ...patch } } : l),
    }) : p));
  };

  /**
   * 每個物件（照片、文字、佈局）共用同一條圖層順序。
   *
   * 畫面上的 z-index 一般圖片是 60 + 2i、佈局是 59 + 2z，兩邊剛好交錯 ——
   * 也就是「佈局的 z」＝「它下面有幾張一般圖片」。這裡把兩邊攤平成一條
   * 由下到上的清單，上移／下移就只是跟清單裡的隔壁換位子。
   * 以前兩邊各排各的（圖片只跟圖片換、佈局只跟佈局換），圖片永遠爬不到
   * 最上面那組佈局上面，這就是「圖片無法超過佈局的圖層」的原因。
   */
  type StackRef = { kind: 'float' | 'layout'; id: string };
  const layerStack = useMemo<StackRef[]>(() => {
    const items: { key: number; ref: StackRef }[] = [];
    floatingImages.forEach((f, i) => items.push({ key: 60 + i * 2, ref: { kind: 'float', id: f.id } }));
    pages.forEach(p => p.layouts.forEach(l =>
      items.push({ key: 59 + (l.z ?? 0) * 2, ref: { kind: 'layout', id: l.id } })));
    // 同一層的兩個佈局 key 會相同，穩定排序會保留陣列順序＝DOM 順序＝畫面上的上下
    items.sort((a, b) => a.key - b.key);
    return items.map(i => i.ref);
  }, [floatingImages, pages]);

  const stackPos = (kind: StackRef['kind'], id: string | null) =>
    id ? layerStack.findIndex(s => s.kind === kind && s.id === id) : -1;

  /** 在共用的圖層清單裡跟上／下一個物件換位子，再換算回各自的表示法 */
  const moveInStack = (kind: StackRef['kind'], id: string, dir: 1 | -1) => {
    const i = stackPos(kind, id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= layerStack.length) return;
    const next = [...layerStack];
    [next[i], next[j]] = [next[j], next[i]];

    const floatRank = new Map<string, number>();
    const layoutZ = new Map<string, number>();
    const layoutRank = new Map<string, number>();
    let floats = 0;
    next.forEach((s, k) => {
      if (s.kind === 'float') floatRank.set(s.id, floats++);
      // 佈局的 z 就是「底下有幾張一般圖片」；同 z 的佈局再用陣列順序分上下
      else { layoutZ.set(s.id, floats); layoutRank.set(s.id, k); }
    });
    setFloatingImages(prev => [...prev].sort((a, b) => (floatRank.get(a.id) ?? 0) - (floatRank.get(b.id) ?? 0)));
    setPages(prev => prev.map(p => ({
      ...p,
      layouts: [...p.layouts]
        .sort((a, b) => (layoutRank.get(a.id) ?? 0) - (layoutRank.get(b.id) ?? 0))
        .map(l => (layoutZ.has(l.id) ? { ...l, z: layoutZ.get(l.id)! } : l)),
    })));
  };

  // 佈局四角的縮放圓點：拖哪一角，對角就固定不動（與一般圖片的縮放邏輯相同）
  const layoutCornerRef = useRef<{
    pointerId: number;
    /** 手勢一開始就記住在縮哪一組，之後不看當下的選取狀態 */
    layoutId: string | null;
    pivotX: number; pivotY: number;
    startDist: number;
    baseScale: number; baseX: number; baseY: number;
    ox: number; oy: number;
  } | null>(null);

  const handleLayoutCornerDown = (e: React.PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') => {
    e.stopPropagation();
    const wrapper = (e.currentTarget as HTMLElement).closest('[data-layout-wrapper]') as HTMLElement | null;
    if (!wrapper) return;
    const r = wrapper.getBoundingClientRect();
    // 拖角球＝單純等比縮放，跟在空白畫布上雙指縮放完全一樣：
    // 以「佈局中心」為原點，只看手指離中心多遠，位置完全不動。
    const pivotX = r.left + r.width / 2;
    const pivotY = r.top + r.height / 2;
    const dist = Math.hypot(e.clientX - pivotX, e.clientY - pivotY);
    if (dist < 1) return;
    const base = activeLayout?.t || { x: 0, y: 0, scale: 1 };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch (err) {}
    layoutCornerRef.current = {
      pointerId: e.pointerId,
      layoutId: wrapper.getAttribute('data-layout-id') || selectedLayoutId,
      pivotX, pivotY, startDist: dist,
      baseScale: base.scale || 1, baseX: base.x, baseY: base.y,
      ox: 0, oy: 0,
    };
  };

  const handleLayoutCornerMove = (e: React.PointerEvent) => {
    const g = layoutCornerRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    e.stopPropagation();
    // 單純等比：手指離中心的距離變幾倍，佈局就變幾倍。
    // （這裡刻意不做「角吸附頁緣」—— 佈局在 scale 1 時剛好等於整頁，
    //   四個邊會同時對齊，吸附就會一直把尺寸拉回 1，放大到一半就縮回去。）
    const dist = Math.hypot(e.clientX - g.pivotX, e.clientY - g.pivotY);
    scaleLayout(g.baseScale * (dist / g.startDist), g.layoutId);
  };

  const handleLayoutCornerUp = (e: React.PointerEvent) => {
    if (!layoutCornerRef.current || layoutCornerRef.current.pointerId !== e.pointerId) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch (err) {}
    layoutCornerRef.current = null;
    setActiveGuidelines([]);
  };

  /** 手勢開始時記下在操作哪一組佈局（不看之後的選取狀態） */
  const layoutGestureIdRef = useRef<string | null>(null);
  const wsGestureLayoutIdRef = useRef<string | null>(null);

  const handleLayoutTouchStart = (e: React.TouchEvent) => {
    if (!layoutSelected || selectedIndex !== null) return;
    layoutGestureIdRef.current = (e.currentTarget as HTMLElement)
      .closest('[data-layout-wrapper]')?.getAttribute('data-layout-id') || selectedLayoutId;
    const t = e.target as Element;
    if (t.closest('.cursor-nwse-resize') || t.closest('.cursor-nesw-resize')) return;
    const base = activeLayout?.t || { x: 0, y: 0, scale: 1 };
    if (e.touches.length >= 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      ) || 1;
      layoutGestureRef.current = {
        mode: 'pinch',
        startX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        startY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        baseX: base.x, baseY: base.y, baseScale: base.scale, startDist: d,
      };
    } else {
      layoutGestureRef.current = {
        mode: 'drag',
        startX: e.touches[0].clientX, startY: e.touches[0].clientY,
        baseX: base.x, baseY: base.y, baseScale: base.scale, startDist: 1,
      };
    }
  };

  const handleLayoutTouchMove = (e: React.TouchEvent) => {
    if (isLongPressedRef.current || touchDragState.current) { layoutGestureRef.current = null; return; }
    const g = layoutGestureRef.current;
    if (!g) return;
    if (g.mode === 'pinch' && e.touches.length >= 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      scaleLayoutSnapped(g.baseScale * (d / g.startDist), layoutGestureIdRef.current);
    } else if (g.mode === 'drag' && e.touches.length === 1) {
      moveLayoutTo(g.baseX + (e.touches[0].clientX - g.startX), g.baseY + (e.touches[0].clientY - g.startY));
    }
  };

  const handleLayoutTouchEnd = () => { layoutGestureRef.current = null; setActiveGuidelines([]); };

  /**
   * 佈局被整組選取時就等同一張圖片，移動時同樣要吸附並顯示對齊線。
   * 佈局未變形時剛好等於整頁，所以它的「未縮放框」就是頁面本身。
   */
  const moveLayoutTo = (nx: number, ny: number) => {
    const scale = activeLayout?.t?.scale ?? 1;
    const rect = getPageRect(selectedLayoutPageIdx >= 0 ? selectedLayoutPageIdx : activePageIndex);
    if (!rect) { patchLayoutT({ x: nx, y: ny }); return; }
    // 跟上面同一個理由：用佈局自己的框（可能比整頁小、而且是置中的）
    const box = layoutBox(activeLayout, rect.width, rect.height);
    const { snappedX, snappedY, guidelines } = applySnapping(
      `layout:${selectedLayoutId}`,
      rect.left + (rect.width - box.w) / 2 + nx,
      rect.top + (rect.height - box.h) / 2 + ny,
      box.w,
      box.h,
      scale
    );
    setActiveGuidelines(guidelines);
    // 吸附回來的是「框的左上角」，扣掉置中的那一段才是佈局的位移量
    patchLayoutT({
      x: snappedX - rect.left - (rect.width - box.w) / 2,
      y: snappedY - rect.top - (rect.height - box.h) / 2,
    });
  };

  // 依格子尺寸算出照片可位移的範圍（單位為格子寬/高的比例）
  const cellShiftLimits = (idx: number, zoom: number) => {
    const templates = TEMPLATE_MAP[images.length] || [];
    const activeTmpl = templates[templateIndex] || templates[0];
    const rect = activeTmpl?.rects[idx];
    const cell = images[idx];
    if (!rect || !cell) return null;
    const cellWidth = rect.w * previewW * layoutScale;
    const cellHeight = rect.h * previewH * layoutScale;
    if (cellWidth <= 0 || cellHeight <= 0) return null;
    const w_img = cell.naturalWidth || 800;
    const h_img = cell.naturalHeight || 600;
    const is90or270 = (cell.rotation % 180) !== 0;
    const drawW = is90or270 ? h_img : w_img;
    const drawH = is90or270 ? w_img : h_img;
    const coverScale = Math.max(cellWidth / drawW, cellHeight / drawH);
    const finalScale = coverScale * zoom;
    const rotatedImgW = (is90or270 ? h_img : w_img) * finalScale;
    const rotatedImgH = (is90or270 ? w_img : h_img) * finalScale;
    return {
      cellWidth,
      cellHeight,
      maxShiftX: Math.max(0, (rotatedImgW - cellWidth) / 2) / cellWidth,
      maxShiftY: Math.max(0, (rotatedImgH - cellHeight) / 2) / cellHeight,
    };
  };

  const applyCellZoom = (idx: number, zoom: number) => {
    const lim = cellShiftLimits(idx, zoom);
    setImages(prev => prev.map((cell, i) => i !== idx ? cell : ({
      ...cell,
      zoom,
      offsetX: lim ? Math.max(-lim.maxShiftX, Math.min(lim.maxShiftX, cell.offsetX)) : cell.offsetX,
      offsetY: lim ? Math.max(-lim.maxShiftY, Math.min(lim.maxShiftY, cell.offsetY)) : cell.offsetY,
    })));
  };

  const applyCellPan = (idx: number, baseOffsetX: number, baseOffsetY: number, dx: number, dy: number) => {
    const cell = images[idx];
    if (!cell) return;
    const lim = cellShiftLimits(idx, cell.zoom);
    if (!lim) return;
    const nx = Math.max(-lim.maxShiftX, Math.min(lim.maxShiftX, baseOffsetX + dx / lim.cellWidth));
    const ny = Math.max(-lim.maxShiftY, Math.min(lim.maxShiftY, baseOffsetY + dy / lim.cellHeight));
    setImages(prev => prev.map((c, i) => i !== idx ? c : ({ ...c, offsetX: nx, offsetY: ny })));
  };

  // ------ 畫布層級手勢 ------
  // 1) 有選中物件時：在畫布任何地方拖曳都能移動它、雙指縮放都能改變它的大小。
  // 2) 沒選中東西時：手動做水平捲頁（含慣性），這樣長按拖曳圖片時才不會被瀏覽器
  //    的原生捲動搶走手勢。
  const wsGestureRef = useRef<{
    kind: 'floating' | 'cell' | 'layout';
    floatingId: string | null;
    mode: 'drag' | 'pinch';
    startX: number; startY: number; startDist: number;
    /** 兩指連線的起始角度與物件當下的角度，雙指旋轉用 */
    startAngle: number; baseRotation: number;
    /** 旋轉的不動區：轉超過門檻才開始轉，rotBias 是要扣掉的那一段 */
    rotOn?: boolean; rotBias?: number;
    baseX: number; baseY: number; baseScale: number;
    /** 整組佈局當下的角度（佈局的雙指旋轉用） */
    baseLayoutRot: number;
    cellIdx: number; baseOffsetX: number; baseOffsetY: number; baseZoom: number;
  } | null>(null);

  const panRef = useRef<{
    startX: number; startScroll: number;
    lastX: number; lastT: number; v: number;
  } | null>(null);
  const inertiaRef = useRef<number | null>(null);

  const stopInertia = () => {
    if (inertiaRef.current !== null) {
      cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
  };

  useEffect(() => () => stopInertia(), []);

  /**
   * 手勢的歸屬：
   *  'none'  —— 該元素自己處理（畫布不捲動、也不搬任何東西）
   *  'floating' —— 由畫布層級手勢搬動「被選中的那張圖片」
   *  'pan'   —— 屬於畫布，左右捲頁
   * 規則就是「拖到被選中的物件身上＝操作它，拖別的地方＝捲頁」。
   */
  const gestureScope = (target: Element | null): 'none' | 'floating' | 'layout' | 'pan' => {
    if (!target) return 'pan';
    if (target.closest('button')) return 'none';
    if (target.closest('.cursor-nwse-resize') || target.closest('.cursor-nesw-resize')) return 'none';

    const cellEl = target.closest('[data-cell-id]');
    if (cellEl && selectedIndex !== null
      && Number(cellEl.getAttribute('data-cell-id')) === selectedIndex
      && cellEl.closest(`[data-layout-id="${selectedLayoutId}"]`)) {
      // 已經被選中的那一格：在它身上拖曳＝平移格內照片
      return 'none';
    }
    if (layoutSelected && selectedIndex === null) {
      // 整組佈局被選取＝它就是現在唯一在操作的物件：畫布任何地方拖曳都是搬它，
      // 完全不捲頁（要換頁請先點空白處取消選取）。
      // 落在佈局自己身上時交給它自己的處理器，其餘由畫布層級手勢代勞。
      return target.closest(`[data-layout-id="${selectedLayoutId}"]`) ? 'none' : 'layout';
    }
    if (selectedFloatingId) {
      // 圖片被選取時同理：拖畫布任何地方都是搬這張圖
      return 'floating';
    }
    return 'pan';
  };

  /**
   * 點一下的選取一律走這裡：選取目標只有一個，其餘全部清掉。
   * （之前圖片自己也會選取，兩邊搶著設 state，偶爾會出現上一張的圓球沒消失。）
   */
  const applyTapSelection = (target: Element) => {
    const fEl = target.closest('[data-floating-id]');
    if (fEl) {
      const id = fEl.getAttribute('data-floating-id');
      if (id) {
        // 已經選取的文字圖層再點一次＝直接在畫布上打字（不會自己跳到編輯頁）
        if (id === selectedFloatingId && floatingImages.find(f => f.id === id)?.text !== undefined) {
          setEditingTextId(id);
          setInlineEditId(id);
        } else if (id !== inlineEditId) {
          setInlineEditId(null);
        }
        setSelectedFloatingId(id);
        setSelectedIndex(null);
        setSelectedLayoutId(null);
      }
      return;
    }
    setInlineEditId(null);
    if (target.closest('[data-cell-id]')) {
      // 格子／佈局的兩段式選取由 handleCellTouchEnd 負責，這裡只清掉圖片
      setSelectedFloatingId(null);
      return;
    }
    setSelectedIndex(null);
    setSelectedLayoutId(null);
    setSelectedFloatingId(null);
  };

  const handleWorkspaceTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    stopInertia();
    panRef.current = null;
    wsGestureRef.current = null;
    if (isLongPressedRef.current || touchDragState.current) return;

    const scope = gestureScope(e.target as Element);
    if (scope === 'none') return;
    const gestureFloatingId = selectedFloatingId;

    // 雙指縮放不會跟捲頁衝突，所以不管手指落在哪裡都拿來縮放選中的物件
    const twoFingerOnSelection = e.touches.length >= 2 && (selectedFloatingId || selectedIndex !== null || layoutSelected);
    const kind: 'floating' | 'cell' | 'layout' | null =
      scope === 'floating' ? 'floating'
      : scope === 'layout' ? 'layout'
      : twoFingerOnSelection ? (selectedFloatingId ? 'floating' : selectedIndex !== null ? 'cell' : 'layout')
      : null;
    if (kind) {
      const twoFinger = e.touches.length >= 2;
      const dist = twoFinger
        ? Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          ) || 1
        : 1;
      const cx = twoFinger ? (e.touches[0].clientX + e.touches[1].clientX) / 2 : e.touches[0].clientX;
      const cy = twoFinger ? (e.touches[0].clientY + e.touches[1].clientY) / 2 : e.touches[0].clientY;
      const ang = twoFinger
        ? Math.atan2(
            e.touches[1].clientY - e.touches[0].clientY,
            e.touches[1].clientX - e.touches[0].clientX
          ) * 180 / Math.PI
        : 0;

      const fImg = kind === 'floating' ? floatingImages.find(img => img.id === gestureFloatingId) : undefined;
      if (kind === 'floating' && !fImg) return;
      const cell = kind === 'cell' && selectedIndex !== null ? images[selectedIndex] : undefined;
      if (kind === 'cell' && !cell?.url) return;
      const lt = activeLayout?.t || { x: 0, y: 0, scale: 1 };

      // 雙指操作時先把圖層工具列收起來，放開才依旋轉後的方向重新擺
      setPinchFloatingId(kind === 'floating' && twoFinger ? gestureFloatingId : null);
      wsGestureLayoutIdRef.current = selectedLayoutId;
      wsGestureRef.current = {
        kind,
        floatingId: gestureFloatingId,
        mode: twoFinger ? 'pinch' : 'drag',
        startX: cx, startY: cy, startDist: dist,
        startAngle: ang,
        baseRotation: fImg?.rotation ?? 0,
        rotOn: false, rotBias: 0,   // 旋轉的不動區：超過門檻才開始轉
        baseX: kind === 'floating' ? (fImg?.x ?? 0) : lt.x,
        baseY: kind === 'floating' ? (fImg?.y ?? 0) : lt.y,
        baseScale: kind === 'floating' ? (fImg?.scale ?? 1) : lt.scale,
        baseLayoutRot: lt.rot || 0,
        cellIdx: selectedIndex ?? -1,
        baseOffsetX: cell?.offsetX ?? 0,
        baseOffsetY: cell?.offsetY ?? 0,
        baseZoom: cell?.zoom ?? 1,
      };
      return;
    }

    // 沒有接管物件手勢 → 準備手動捲頁。
    // （手勢沒有落在「已選中的那個物件」身上時就屬於畫布，可以左右滑動。）
    const el = containerRef.current;
    if (!el || e.touches.length !== 1) return;
    panRef.current = {
      startX: e.touches[0].clientX,
      startScroll: el.scrollLeft,
      lastX: e.touches[0].clientX,
      lastT: performance.now(),
      v: 0,
    };
  };

  const handleWorkspaceTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    // 長按拖曳圖片時，任何捲頁 / 物件位移都不該發生
    if (isLongPressedRef.current || touchDragState.current || floatSwapRef.current?.dragging) {
      panRef.current = null;
      wsGestureRef.current = null;
      return;
    }

    const g = wsGestureRef.current;
    if (g) {
      const twoFinger = e.touches.length >= 2;
      if (g.mode === 'pinch' && twoFinger) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const k = d / g.startDist;
        if (g.kind === 'floating') {
          const target = floatingImages.find(img => img.id === g.floatingId);
          // 圖片跟文字都可以轉，邏輯跟創意拼圖同一套
          const canRotate = true;
          let rot = target?.rotation ?? 0;
          let straight = false;
          {
            /* 旋轉有一段「不動區」：兩指轉不到 ROT_START 度就當成純縮放，
               不然只是想放大也會不小心轉到。超過之後把門檻扣掉再開始轉，
               所以不會在跨過門檻那一瞬間跳一下。
               靠近 0/90/180/270 就吸正，並在物件中心打兩條臨時線，讓人知道是正的。 */
            const ROT_START = 8, ROT_SNAP = 6;
            const wrap180 = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
            const ang = Math.atan2(
              e.touches[1].clientY - e.touches[0].clientY,
              e.touches[1].clientX - e.touches[0].clientX
            ) * 180 / Math.PI;
            let dRot = wrap180(ang - g.startAngle);
            if (!g.rotOn) {
              if (Math.abs(dRot) < ROT_START) dRot = 0;
              else { g.rotOn = true; g.rotBias = dRot > 0 ? ROT_START : -ROT_START; }
            }
            if (g.rotOn) dRot -= (g.rotBias || 0);
            rot = ((g.baseRotation + dRot) % 360 + 360) % 360;
            const nearest = (Math.round(rot / 90) * 90) % 360;
            straight = Math.abs(wrap180(rot - nearest)) <= ROT_SNAP;
            if (straight) rot = nearest;
          }
          /* 雙指縮放時也要吸附畫布邊界並顯示輔助線 —— 以前只有拖曳和拉四角
             才有，捏合完全沒有，很難把圖縮到剛好貼齊畫布。
             中心點在捏合時不動，所以只有「四個邊界」會隨倍率移動：把倍率解成
             「這條邊剛好落在畫布邊界上」的值，最近的那一個在門檻內就吸附過去。 */
          let ns = Math.max(0.1, g.baseScale * k);
          if (target && enableSnapping) {
            const SNAP = 4;
            const cx = target.x + target.width / 2;
            const cy = target.y + target.height / 2;
            let best = Infinity, bestScale = ns;
            // 倍率吸附也要用轉過的外框，不然轉 90 度之後貼齊的位置會差半個身子
            const ext = rotExtent(target.width, target.height, rot);
            pageRectsNear(getAllPageRects(), cx).forEach(pr => {
              const cands: number[] = [];
              if (ext.bw > 1) {
                cands.push((2 * (cx - pr.left)) / ext.bw);
                cands.push((2 * (pr.right - cx)) / ext.bw);
              }
              if (ext.bh > 1) {
                cands.push((2 * (cy - pr.top)) / ext.bh);    // 上邊貼齊
                cands.push((2 * (pr.bottom - cy)) / ext.bh); // 下邊貼齊
              }
              cands.forEach(cand => {
                if (!(cand > 0.1)) return;
                // 換算成「畫面上差幾個像素」再比門檻，倍率本身的差沒有意義
                const px = Math.abs(cand - ns) * Math.max(ext.bw, ext.bh) / 2;
                if (px < SNAP && px < best) { best = px; bestScale = cand; }
              });
            });
            if (best < SNAP) ns = bestScale;
          }
          setFloatingImages(prev => prev.map(img =>
            img.id === g.floatingId
              ? { ...img, scale: ns, ...(canRotate ? { rotation: rot } : {}) }
              : img
          ));
          if (target) {
            // 同樣只畫「邊」的線：捏合時中心不動，中線會整趟亮著（見 scaleLayoutSnapped）
            const pageLines = pageGuidelinesAt(target.x, target.y, target.width, target.height, ns, true, rot);
            setActiveGuidelines(dedupeGuidelines(straight
              ? [
                  { type: 'vertical', coord: target.x + target.width / 2 },
                  { type: 'horizontal', coord: target.y + target.height / 2 },
                  ...pageLines,
                ]
              : pageLines));
          }
        } else if (g.kind === 'layout') {
          scaleLayoutSnapped(g.baseScale * k, wsGestureLayoutIdRef.current);
          /* 整組佈局的兩指旋轉，手感跟一般圖片、文字同一套：
             ① 先有一段「不動區」——轉不到 ROT_START 度就當成純縮放，
                免得只是想放大卻不小心歪掉；
             ② 超過門檻之後把門檻那一段扣掉再開始轉，跨過去的瞬間不會跳一下；
             ③ 靠近 0/90/180/270 就吸正。 */
          {
            const ROT_START = 8, ROT_SNAP = 6;
            const wrap180 = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
            const ang2 = Math.atan2(
              e.touches[1].clientY - e.touches[0].clientY,
              e.touches[1].clientX - e.touches[0].clientX
            ) * 180 / Math.PI;
            let dRot = wrap180(ang2 - g.startAngle);
            if (!g.rotOn) {
              if (Math.abs(dRot) < ROT_START) dRot = 0;
              else { g.rotOn = true; g.rotBias = dRot > 0 ? ROT_START : -ROT_START; }
            }
            if (g.rotOn) {
              dRot -= (g.rotBias || 0);
              let rot = ((g.baseLayoutRot + dRot) % 360 + 360) % 360;
              const nearest = (Math.round(rot / 90) * 90) % 360;
              if (Math.abs(wrap180(rot - nearest)) <= ROT_SNAP) rot = nearest;
              patchLayoutT({ rot }, wsGestureLayoutIdRef.current);
            }
          }
        } else if (g.kind === 'cell' && g.cellIdx >= 0) {
          applyCellZoom(g.cellIdx, Math.max(1.0, Math.min(5.0, g.baseZoom * k)));
        }
      } else if (g.mode === 'drag' && e.touches.length === 1) {
        const dx = e.touches[0].clientX - g.startX;
        const dy = e.touches[0].clientY - g.startY;
        if (g.kind === 'floating') {
          const selectedImg = floatingImages.find(img => img.id === g.floatingId);
          if (selectedImg) {
            const { snappedX, snappedY, guidelines } = applySnapping(
              selectedImg.id, g.baseX + dx, g.baseY + dy,
              selectedImg.width, selectedImg.height, selectedImg.scale,
              undefined, selectedImg.rotation || 0,
            );
            setActiveGuidelines(guidelines);
            setFloatingImages(prev => prev.map(img =>
              img.id === g.floatingId ? { ...img, x: snappedX, y: snappedY } : img
            ));
          }
        } else if (g.kind === 'layout') {
          moveLayoutTo(g.baseX + dx, g.baseY + dy);
        } else if (g.kind === 'cell' && g.cellIdx >= 0) {
          applyCellPan(g.cellIdx, g.baseOffsetX, g.baseOffsetY, dx, dy);
        }
      }
      return;
    }

    const p = panRef.current;
    const el = containerRef.current;
    if (!p || !el || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    const now = performance.now();
    const dt = Math.max(1, now - p.lastT);
    // 捲動方向與手指相反；速度單位為 px/ms（捲動座標）
    p.v = (p.lastX - x) / dt;
    p.lastX = x;
    p.lastT = now;
    // 到頭到尾就重新抓一次起點。不然手指還可以繼續往外滑幾百 px（scrollLeft
    // 被夾住、畫面不動），回頭時要先把那幾百 px 滑回來畫面才開始動，
    // 手感就是「滑到最邊邊卡住又彈不回來」。
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    let target = p.startScroll - (x - p.startX);
    if (target < 0) { target = 0; p.startX = x; p.startScroll = 0; }
    else if (target > max) { target = max; p.startX = x; p.startScroll = max; }
    el.scrollLeft = target;
    // 頁面是 scrollLeft 帶著走的，按鈕是 transform：同一帧寫完才不會慢半拍
    positionPageCtls();
  };

  const handleWorkspaceTouchEnd = () => {
    setPinchFloatingId(null);
    if (wsGestureRef.current) {
      wsGestureRef.current = null;
      setActiveGuidelines([]);
      setActiveCollisions({ left: false, right: false, top: false, bottom: false });
      return;
    }
    const p = panRef.current;
    panRef.current = null;
    const el = containerRef.current;
    if (!p || !el) return;
    // 慣性滑行，讓手感接近原生捲動
    let v = Math.max(-4, Math.min(4, p.v));
    if (Math.abs(v) < 0.05) return;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(32, now - last);
      last = now;
      el.scrollLeft += v * dt;
      positionPageCtls();
      v *= Math.pow(0.95, dt / 16);
      if (Math.abs(v) < 0.02 || el.scrollLeft <= 0 || el.scrollLeft >= el.scrollWidth - el.clientWidth) {
        inertiaRef.current = null;
        return;
      }
      inertiaRef.current = requestAnimationFrame(step);
    };
    inertiaRef.current = requestAnimationFrame(step);
  };

  const handleDeleteLayout = () => {
    setPages(prev => prev.map(p => p.layouts.some(l => l.id === selectedLayoutId)
      ? { ...p, layouts: p.layouts.filter(l => l.id !== selectedLayoutId) }
      : p));
    setSelectedLayoutId(null);
    setSelectedIndex(null);
  };

  const handleRotateImage = (index: number) => {
    setImages(prev => prev.map((img, idx) => {
      if (idx !== index) return img;
      return { ...img, rotation: (img.rotation + 90) % 360 };
    }));
  };

  const handleSwapLeft = (index: number) => {
    if (index === 0) return;
    setImages(prev => {
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[index - 1];
      next[index - 1] = tmp;
      return next;
    });
    setSelectedIndex(index - 1);
  };

  const handleSwapRight = (index: number) => {
    if (index === images.length - 1) return;
    setImages(prev => {
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[index + 1];
      next[index + 1] = tmp;
      return next;
    });
    setSelectedIndex(index + 1);
  };

  const currentTemplates = TEMPLATE_MAP[images.length] || [];
  const activeTemplate = currentTemplates[templateIndex] || currentTemplates[0] || { name: '預設', rects: [] };

  const allTemplatesFlattened: { count: number, idx: number, tmpl: any, isCurrentCount: boolean }[] = [];
  const C = layoutSortBase;
  const availableCounts = [3, 1, 2, 4, 5, 6, 7, 8, 9, 10].filter(c => c !== 1 || allowSingleLayout);
  
  const orderedCounts = availableCounts;

  orderedCounts.forEach(count => {
    if (TEMPLATE_MAP[count]) {
      TEMPLATE_MAP[count].forEach((tmpl, idx) => {
        allTemplatesFlattened.push({ count, idx, tmpl, isCurrentCount: count === images.length });
      });
    }
  });

  /** 匯出時同一張圖可能要畫在好幾頁上，載一次就好。 */
  const exportImgCache = useRef<Map<string, HTMLImageElement | null>>(new Map());
  /**
   * 匯出影片圖層時用的來源：直接拿預覽在播的那個 video 元素，
   * 所以存出來的就是畫面上看到的那一格。
   */
  const loadExportVideo = (url: string) => new Promise<HTMLVideoElement | null>((resolve) => {
    const v = getPreviewVideo(url);
    if (v.readyState >= 2) return resolve(v);
    const on = () => { v.removeEventListener('loadeddata', on); resolve(v.readyState >= 2 ? v : null); };
    v.addEventListener('loadeddata', on);
    setTimeout(on, 3000);
  });

  const loadExportImage = (url: string) => {
    const cache = exportImgCache.current;
    if (cache.has(url)) return Promise.resolve(cache.get(url)!);
    return new Promise<HTMLImageElement | null>((resolve) => {
      const i = new Image();
      i.onload = () => { cache.set(url, i); resolve(i); };
      i.onerror = () => { cache.set(url, null); resolve(null); };
      i.src = url;
    });
  };

  /**
   * 匯出時把文字圖層畫上去。字級、字距、行高、換行規則都跟預覽同一套，
   * 位置才會落在一樣的地方。
   */
  const drawTextLayer = async (
    ctx: CanvasRenderingContext2D,
    fImg: FloatingImage,
    scaleFactor: number
  ) => {
    const family = fImg.fontFamily || DEFAULT_FONT;
    await waitForFont(family, fImg.bold ? 700 : 400, !!fImg.italic);

    const adjustedX = fImg.x - Math.floor(fImg.x / (previewW + 1));
    const fw = fImg.width * scaleFactor;
    const fh = fImg.height * scaleFactor;
    const cx = adjustedX * scaleFactor + fw / 2;
    const cy = fImg.y * scaleFactor + fh / 2;
    const size = (fImg.fontSize || 40) * scaleFactor * fImg.scale;
    const spacing = (fImg.letterSpacing || 0) * scaleFactor * fImg.scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((fImg.rotation * Math.PI) / 180);
    ctx.font = `${fImg.italic ? 'italic ' : ''}${fImg.bold ? 700 : 400} ${size}px ${fontStack(family)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as any).letterSpacing = `${spacing}px`;

    // 與預覽相同的斷行：只在使用者自己按的換行處斷，不再依寬度自動換行
    const lines: string[] = (fImg.text || '').split('\n');
    const lineH = size * 1.12;
    const startY = -((lines.length - 1) * lineH) / 2;

    const drawLines = () => lines.forEach((ln, i) => ctx.fillText(ln, 0, startY + i * lineH));
    if (fImg.glow) {
      ctx.shadowColor = fImg.glowColor || '#FFFFFF';
      ctx.fillStyle = fImg.color || '#FFFFFF';
      /* 只用填色的字形投影，完全不碰描邊 —— 跟預覽的發光層一樣。
         這裡如果先 strokeText，光就會從描邊的外緣散出去，等於把描邊
         算進發光裡；發光與描邊要各自獨立，所以這一段不描邊。 */
      // 疊三層，跟預覽那一層的三段 text-shadow 對齊
      for (const k of [1, 2, 3]) {
        ctx.shadowBlur = (fImg.glow / 20) * 14 * k * scaleFactor * fImg.scale;
        drawLines();
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }
    // 描邊先畫（寬度加倍），填色再蓋上去 —— 只剩外圍的一圈，
    // 跟預覽的 paint-order: stroke fill 同一套邏輯
    if (fImg.strokeWidth) {
      ctx.lineWidth = fImg.strokeWidth * 2 * scaleFactor * fImg.scale;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = fImg.strokeColor || '#FFFFFF';
      lines.forEach((ln, i) => ctx.strokeText(ln, 0, startY + i * lineH));
    }
    ctx.fillStyle = fImg.color || '#FFFFFF';
    drawLines();
    ctx.restore();
  };

  /** 匯出時把自由圖層畫到頁面座標系上，順序就是陣列順序。 */
  const drawFloatingLayers = async (
    ctx: CanvasRenderingContext2D,
    layers: FloatingImage[],
    scaleFactor: number
  ) => {
    for (const fImg of layers) {
      if (fImg.text !== undefined) {
        await drawTextLayer(ctx, fImg, scaleFactor);
        continue;
      }
      const img = fImg.isVideo ? await loadExportVideo(fImg.src) : await loadExportImage(fImg.src);
      if (!img) continue;

      ctx.save();
      // 扣掉預覽裡每頁之間那 1px 的間隔
      const adjustedX = fImg.x - Math.floor(fImg.x / (previewW + 1));
      const fx = adjustedX * scaleFactor;
      const fy = fImg.y * scaleFactor;
      const fw = fImg.width * scaleFactor;
      const fh = fImg.height * scaleFactor;

      // CSS 的 scale 以未縮放框的中心為原點
      const cx = fx + fw / 2;
      const cy = fy + fh / 2;

      ctx.translate(cx, cy);
      ctx.rotate((fImg.rotation * Math.PI) / 180);
      ctx.scale(fImg.scale, fImg.scale);

      // 濾鏡／調節先套上去（用匯出解析度重算一次，不是拿預覽那張小圖放大）
      let src: CanvasImageSource = img;
      if (hasPhotoFx(fImg.fx)) {
        const cap = 2400;
        const k = Math.min(1, cap / Math.max(img.naturalWidth || fw, img.naturalHeight || fh));
        src = applyPhotoFx(
          img,
          Math.max(1, Math.round((img.naturalWidth || fw) * k)),
          Math.max(1, Math.round((img.naturalHeight || fh) * k)),
          fImg.fx!,
        );
      }

      // 有圓角、羽化或描邊就先在離屏畫布上處理好，再整張貼回來。
      // 離屏尺寸含 fImg.scale，放大過的圖才不會先畫小張再拉大而變糊。
      // 描邊往外長，所以離屏要比圖片本身大 lw 一圈；貼回去時也要跟著放大
      const strokeLw = (fImg.imgStrokeWidth || 0) * scaleFactor * fImg.scale;
      let drawW = fw, drawH = fh;
      if (fImg.imgRadius || fImg.feather || fImg.imgStrokeWidth) {
        const iw = Math.max(1, Math.round(fw * fImg.scale));
        const ih = Math.max(1, Math.round(fh * fImg.scale));
        const lw = strokeLw * fImg.scale;
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(iw + lw * 2));
        off.height = Math.max(1, Math.round(ih + lw * 2));
        const oc = get2dWide(off)!;
        oc.drawImage(src, lw, lw, iw, ih);
        if (fImg.imgRadius || fImg.feather) {
          // 只把「圖片那一塊」裁形狀，描邊的區域不能被裁掉
          const shapeOnly = document.createElement('canvas');
          shapeOnly.width = iw; shapeOnly.height = ih;
          const sc = get2dWide(shapeOnly)!;
          sc.drawImage(src, 0, 0, iw, ih);
          sc.globalCompositeOperation = 'destination-in';
          if (fImg.feather) {
            // 遮罩的模糊很吃 CPU，超過這個邊長就先算小張再放大貼上；
            // 遮罩本來就是平滑的，放大看不出差別
            const cap = 1200;
            const k = Math.min(1, cap / Math.max(iw, ih));
            const mask = makeShapeMask(iw * k, ih * k, fImg.imgRadius || 0, fImg.feather);
            sc.drawImage(mask, 0, 0, iw, ih);
          } else {
            sc.fillStyle = '#000';
            const R = cornerR(fImg.imgRadius!, iw, ih);
            roundRectPath(sc, 0, 0, iw, ih, R, R);
            sc.fill();
          }
          sc.globalCompositeOperation = 'source-over';
          oc.clearRect(0, 0, off.width, off.height);
          oc.drawImage(shapeOnly, lw, lw, iw, ih);
        }
        if (lw > 0) {
          const rp = fImg.imgRadius || 0;
          const sr = rp ? cornerR(rp, iw, ih) + lw / 2 : 0;
          roundRectPath(oc, lw / 2, lw / 2, iw + lw, ih + lw, sr, sr);
          oc.lineWidth = lw;
          oc.lineJoin = 'miter';
          oc.miterLimit = 4;
          oc.strokeStyle = fImg.imgStrokeColor || '#FFFFFF';
          oc.stroke();
        }
        src = off;
        drawW = fw + strokeLw * 2;
        drawH = fh + strokeLw * 2;
      }

      // 發光：跟預覽同一支（文字那三層的濃淡），形狀取自已經裁好的那一張。
      // 光暈本身很平滑，所以算在有上限的小張上再放大貼回去（省掉大圖的成本）。
      if (fImg.imgGlow) {
        const blurUnit = (fImg.imgGlow / 20) * GLOW_BLUR_UNIT * scaleFactor;
        const pad = blurUnit * GLOW_EXTENT + 2;
        const fullW = drawW + pad * 2;
        const fullH = drawH + pad * 2;
        const k = Math.min(1, 1200 / Math.max(fullW, fullH));
        const glow = makeGlowCanvas(
          src, fullW * k, fullH * k,
          pad * k, pad * k, drawW * k, drawH * k,
          blurUnit * k, fImg.imgGlowColor || '#FFFFFF',
        );
        ctx.drawImage(glow, -drawW / 2 - pad, -drawH / 2 - pad, fullW, fullH);
      }
      ctx.drawImage(src, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
  };


  /* ---- IG 貼文預覽 ---- */
  /**
   * 直式 2:3 與 9:16 比 IG 的極限（4:5）還要更長，IG 根本吃不下，
   * 預覽出來也不是發文後的樣子 —— 這兩種比例直接不給預覽，
   * 「更多」選單裡連那顆按鈕都不出現（不用跳任何提示）。
   * 橫過來的 3:2、16:9 在 IG 的橫式範圍內，照常可以預覽。
   */
  const igPreviewSupported = (() => {
    if (previewH <= previewW) return true;          // 正方形與橫式都沒問題
    const r = previewW / previewH;
    return !( Math.abs(r - 2 / 3) < 0.01 || Math.abs(r - 9 / 16) < 0.01 );
  })();
  /* IG 預覽顯示的就是「匯出的成品」本人 —— 打開時用同一支 handleExport
     算一次（壓低解析度、不動任何畫面狀態），顯示回傳的那幾張圖。
     以前 IG 預覽是另外用 DOM 重畫一次，兩份程式碼永遠會有對不上的地方
     （比例、裁切、跨頁、次像素…），改成共用同一條管線就不可能不一樣。 */
  const [igShots, setIgShots] = useState<string[]>([]);
  const igShotsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!igPreview) return;
    let alive = true;
    (async () => {
      let r = await handleExport({ silent: true, previewWidth: 900 });
      let urls = (r && 'urls' in r) ? r.urls : [];
      // 偶爾第一次會算不出來（圖還沒解碼完之類），隔一下再試一次
      if (!urls.length && alive) {
        await new Promise(res => setTimeout(res, 400));
        r = await handleExport({ silent: true, previewWidth: 900 });
        urls = (r && 'urls' in r) ? r.urls : [];
      }
      if (!alive) { urls.forEach(u => URL.revokeObjectURL(u)); return; }
      if (!urls.length) return;   // 還是失敗就留著備援，不要清成空白
      /* 先把每一張都解碼完再交給畫面。
         以前是拿到網址就立刻 setState，<img> 還在解碼的那幾百毫秒畫面上是空的，
         看起來就是「進 IG 預覽時整片白」。等解碼完再換就沒有那段空窗。 */
      await Promise.all(urls.map(u => new Promise<void>(res => {
        const im = new Image();
        im.onload = () => res();
        im.onerror = () => res();
        im.src = u;
      })));
      if (!alive) { urls.forEach(u => URL.revokeObjectURL(u)); return; }
      igShotsRef.current.forEach(u => URL.revokeObjectURL(u));
      igShotsRef.current = urls;
      setIgShots(urls);
    })();
    return () => {
      alive = false;
      igShotsRef.current.forEach(u => URL.revokeObjectURL(u));
      igShotsRef.current = [];
      setIgShots([]);
    };
  }, [igPreview]);
  /** 頭像與「說讚」那排的小頭像：直接拿拼圖裡的照片來用，看起來才像真的貼文 */
  const igFaces = (() => {
    const out: string[] = [];
    const push = (s?: string) => { if (s && out.length < 3 && !out.includes(s)) out.push(s); };
    floatingImages.forEach(f => { if (f.text === undefined && !f.isVideo) push(f.src); });
    pages.forEach(p => p.layouts.forEach(l => l.images.forEach(im => push(im?.url))));
    return [out[0] || '', out[1] || '', out[2] || ''];
  })();
  /** 這一頁有沒有影片：有的話才顯示 IG 的聲音鍵 */
  const igPageHasVideo = (pageIdx: number) =>
    floatingImages.some(f => f.isVideo && f.src && pageOfFloating(f, previewW + 1, pages.length) === pageIdx);

  /**
   * 把某一頁照原比例縮小畫一次（底色、佈局、照片、影片、文字都在）。
   * 預覽用的縮圖與 IG 預覽共用這一支，看到的就跟畫布上那一頁一樣。
   */
  const renderMiniPage = (pageIdx: number, maxW: number, maxH: number, mode: 'contain' | 'cover' = 'contain') => {
    const page = pages[pageIdx];
    if (!page) return null;
    /* contain：整頁完整顯示，絕不裁切。
       以前用 cover 去填滿那個 4:5 的框，1:1 的頁面上下就被切掉一截 ——
       IG 預覽的重點是「跟預覽／匯出看到的是同一張」，寧可留黑邊也不能裁。 */
    /* 框的尺寸是整數 px（量出來再取整），長寬比會跟頁面差零點幾 % ——
       用 contain 就會多出一條零點幾 px 的黑邊（IG 預覽上方那條就是這樣來的）。
       差距小於 1% 時視為同比例，直接兩軸都拉滿：不留邊也不裁切。 */
    const arBox = maxW / maxH, arPage = previewW / previewH;
    const sameAR = Math.abs(arBox - arPage) / arPage < 0.01;
    const kx = maxW / previewW, ky = maxH / previewH;
    /* 同比例時仍然用「取小」：取大等於覆蓋，比例差那零點幾 % 就會把下緣切掉
       ——「絕不裁切」比「絕不留邊」重要，何況差距 < 1%，留的邊不到 1px。 */
    const k = (sameAR || mode !== 'cover') ? Math.min(kx, ky) : Math.max(kx, ky);
    const stride = previewW + 1;
    const onThisPage = floatingImages.filter(f => pageOfFloating(f, stride, pages.length) === pageIdx);
    return (
      <div
        className="relative overflow-hidden shrink-0"
        style={{ width: `${previewW * k}px`, height: `${previewH * k}px`, backgroundColor: page.bgColor }}
      >
        {page.layouts.map(layout => {
          const tpls = TEMPLATE_MAP[layout.images.length] || [];
          const tpl = tpls[layout.templateIndex] || tpls[0] || { name: '', rects: [] };
          const ls = layout.t?.scale ?? 1;
          const lbox = layoutBox(layout, previewW, previewH);
          const lw = lbox.w * ls, lh = lbox.h * ls;
          const gap = layout.gap * ls, inset = gap / 2;
          const areaW = Math.max(1, lw - inset * 2), areaH = Math.max(1, lh - inset * 2);
          return (
            <div
              key={layout.id}
              className="absolute"
              style={{
                left: `${((previewW - lw) / 2 + (layout.t?.x || 0)) * k}px`,
                top: `${((previewH - lh) / 2 + (layout.t?.y || 0)) * k}px`,
                width: `${lw * k}px`,
                height: `${lh * k}px`,
                ...((layout.t?.rot || 0) !== 0
                  ? { transform: `rotate(${layout.t!.rot}deg)`, transformOrigin: 'center center' }
                  : null),
              }}
            >
              {tpl.rects.map((rect, ci) => {
                const cell = layout.images[ci];
                return (
                  <div
                    key={ci}
                    className="absolute overflow-hidden"
                    style={{
                      left: `${(inset + rect.x * areaW) * k}px`,
                      top: `${(inset + rect.y * areaH) * k}px`,
                      width: `${rect.w * areaW * k}px`,
                      height: `${rect.h * areaH * k}px`,
                      borderRadius: `${layout.radius * ls * k}px`,
                      backgroundColor: cell?.url ? 'transparent' : 'rgba(0,0,0,0.06)',
                    }}
                  >
                    {cell?.url && (
                      <img
                        src={cell.url}
                        alt=""
                        className="w-full h-full object-cover"
                        style={{
                          transform: `translate(${(cell.offsetX || 0) * 100}%, ${(cell.offsetY || 0) * 100}%) rotate(${cell.rotation || 0}deg) scale(${cell.zoom || 1})`,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {onThisPage.map(f => {
          const common: React.CSSProperties = {
            position: 'absolute',
            left: `${(f.x - pageIdx * stride + (f.width - f.width * f.scale) / 2) * k}px`,
            top: `${(f.y + (f.height - f.height * f.scale) / 2) * k}px`,
            width: `${f.width * f.scale * k}px`,
            height: `${f.height * f.scale * k}px`,
            transform: `rotate(${f.rotation}deg)`,
          };
          if (f.text !== undefined) {
            return (
              <span
                key={f.id}
                style={{
                  ...common,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: fontStack(f.fontFamily),
                  fontSize: `${Math.max(2, (f.fontSize || 40) * f.scale * k)}px`,
                  fontWeight: f.bold ? 700 : 400,
                  fontStyle: f.italic ? 'italic' : 'normal',
                  letterSpacing: `${(f.letterSpacing || 0) * f.scale * k}px`,
                  color: f.color || '#1C1C1C',
                  lineHeight: 1.12,
                  overflow: 'visible',
                  whiteSpace: 'pre',
                  textAlign: 'center',
                  WebkitTextStrokeWidth: f.strokeWidth ? `${f.strokeWidth * 2 * f.scale * k}px` : undefined,
                  WebkitTextStrokeColor: f.strokeWidth ? (f.strokeColor || '#FFFFFF') : undefined,
                  paintOrder: f.strokeWidth ? 'stroke fill' : undefined,
                  textShadow: 'none',
                }}
              >
                {!!f.glow && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none', whiteSpace: 'pre', textAlign: 'center',
                      color: f.color || '#1C1C1C',
                      WebkitTextStrokeWidth: 0,
                      paintOrder: 'normal',
                      textShadow: [1, 2, 3]
                        .map(kk => `0 0 ${(f.glow! / 20) * 14 * kk * f.scale * k}px ${f.glowColor || '#FFFFFF'}`)
                        .join(', '),
                    }}
                  >
                    {f.text}
                  </span>
                )}
                <span style={{ position: 'relative', zIndex: 1 }}>{f.text}</span>
              </span>
            );
          }
          if (f.isVideo) {
            return <video key={f.id} src={f.src} autoPlay loop muted playsInline style={{ ...common, objectFit: 'fill' }} />;
          }
          /* 濾鏡、圓角、羽化、發光、描邊全部交給跟主預覽同一支演算法去畫，
             IG 預覽／頁面縮圖／畫布上看到的才會是同一張。 */
          const bw = f.width * f.scale * k;
          const bh = f.height * f.scale * k;
          const needsCanvas = !!(f.feather || f.imgRadius || f.imgGlow || f.imgStrokeWidth || hasPhotoFx(f.fx));
          if (!needsCanvas) {
            return <img key={f.id} src={f.src} alt="" style={{ ...common, objectFit: 'fill' }} />;
          }
          const gp = Math.round(
            ((f.imgGlow ? Math.ceil(GLOW_BLUR_UNIT * GLOW_EXTENT) : 0)
              + (f.imgStrokeWidth ? 20 : 0)) * f.scale * k,
          );
          return (
            <MiniShapeImage
              key={f.id}
              img={f}
              boxW={bw}
              boxH={bh}
              glowPad={gp}
              lutRevision={lutRevision}
              style={{
                ...common,
                left: `${(f.x - pageIdx * stride + (f.width - f.width * f.scale) / 2) * k - gp}px`,
                top: `${(f.y + (f.height - f.height * f.scale) / 2) * k - gp}px`,
                width: `${bw + gp * 2}px`,
                height: `${bh + gp * 2}px`,
              }}
            />
          );
        })}
      </div>
    );
  };

  // Export to Canvas
  /**
   * 匯出。
   * silent = true 時不動任何畫面狀態，直接把每一頁的圖回傳 ——
   * IG 預覽就是靠這個顯示「跟匯出一模一樣」的畫面（同一支程式碼、同一條管線，
   * 定義上不可能不一樣）。previewWidth 用來壓低解析度，預覽不需要 4096。
   */
  const handleExport = async (
    opts?: { silent?: boolean; previewWidth?: number },
  ): Promise<{ urls: string[]; kinds: ('image' | 'video')[] } | void> => {
    if (pages.length === 0) return;
    const silent = !!opts?.silent;
    if (!silent) setExportState('processing');

    try {
      const canvas = document.createElement('canvas');
      /* 導出鏈上的畫布用 Display P3：照片本身的廣色域不會在這裡被裁掉。
         已經套過特效的那些是 sRGB 的畫布，畫進來時瀏覽器會做色彩管理轉換，
         看起來完全一樣 —— 所以現有成品的樣子不會變。 */
      const ctx = get2dWide(canvas)!;

      // 輸出寬度跟著頁面裡最大的原圖走，而不是永遠壓在 1800。
      // 原本 4000px 的照片存出來只剩不到一半的細節。上限 4096 是為了避免
      // 多頁時長條畫布超過瀏覽器的單一 canvas 尺寸限制。
      const sourceWidths: number[] = [];
      for (const pg of pages) {
        for (const lay of pg.layouts) {
          const tpls = TEMPLATE_MAP[lay.images.length] || [];
          const tpl = tpls[lay.templateIndex] || tpls[0];
          lay.images.forEach((c, i) => {
            const r = tpl?.rects[i];
            // 格子只佔頁面的一部分（再乘上佈局本身的縮放），換算回整頁需要的解析度
            const frac = Math.max(0.05, (r?.w ?? 1) * (lay.t?.scale ?? 1));
            if (c.url && c.naturalWidth && r) sourceWidths.push(c.naturalWidth / frac);
          });
        }
      }
      for (const f of floatingImages) {
        const d = f.isVideo ? await getVideoDimensions(f.src) : await getImageDimensions(f.src);
        // 圖層在版面上只佔一部分寬度，換算回整頁需要的解析度
        const frac = Math.max(0.05, (f.width * f.scale) / previewW);
        sourceWidths.push(d.width / frac);
      }
      const wanted = sourceWidths.length ? Math.max(...sourceWidths) : 1800;
      // 每一頁各自輸出一張畫布，所以上限不再被頁數瓜分
      const targetW = opts?.previewWidth
        ? Math.max(320, Math.round(opts.previewWidth))
        : Math.max(1800, Math.min(4096, Math.round(wanted)));
      let targetH = targetW;

      if (selectedRatio === '1:1') {
        targetH = targetW;
      } else if (selectedRatio === '3:4') {
        targetH = Math.round(isLandscape ? targetW * (3 / 4) : targetW * (4 / 3));
      } else if (selectedRatio === '2:3') {
        targetH = Math.round(isLandscape ? targetW * (2 / 3) : targetW * (3 / 2));
      } else if (selectedRatio === '9:16') {
        targetH = Math.round(isLandscape ? targetW * (9 / 16) : targetW * (16 / 9));
      } else if (selectedRatio === '4:5') {
        targetH = Math.round(isLandscape ? targetW * (4 / 5) : targetW * (5 / 4));
      }

      const scaleFactor = targetW / previewW;
      /* 高度一定要是「預覽高度 × 同一個縮放倍率」，不能用比例公式另外算。
         previewH 是量出來的實際像素（含小數），跟公式算出來的值會差幾個 px；
         而所有物件的座標都是乘 scaleFactor 換算過去的 —— 兩邊對不上的話，
         擺在頁面正中央的圖，匯出後就會偏離中心（差多少就偏多少的一半）。
         這也是 IG 預覽看起來「圖比較靠近下面」的原因，因為它顯示的就是匯出圖。 */
      /* 這裡要用 floor 不能用 round：round 有一半機率往上進位，畫布就比
         內容高了不到 1px —— 那一列沒有任何東西蓋到，露出來的就是畫布底色，
         在 IG 預覽（顯示的就是這張匯出圖）下緣看到的那條白線就是它。
         往下取整之後畫布永遠不會比內容高，白線不可能出現。 */
      targetH = Math.floor(previewH * scaleFactor);

      canvas.width = targetW;
      canvas.height = targetH;

      // 每個物件仍然用「整條頁面帶」的座標計算，畫的時候再把畫布平移到該頁，
      // 所以被拖到隔壁頁的東西一樣會正確接續過去。
      const drawPageLayout = async (ctx: CanvasRenderingContext2D, pageIdx: number, layout: LayoutItem) => {
        const pageOffsetX = pageIdx * targetW;
        {
          const gap = layout.gap;
          const radius = layout.radius;
          const canvasGap = gap * scaleFactor;
          const canvasRadius = radius * scaleFactor;
          // 整組佈局可能被移動或縮放過，匯出時套用同一個變形
          const lt = layout.t || { x: 0, y: 0, scale: 1 };
          const ltScale = lt.scale || 1;
          const ltRot = lt.rot || 0;
          ctx.save();
          if (lt.x !== 0 || lt.y !== 0 || ltScale !== 1 || ltRot !== 0) {
            ctx.translate(pageOffsetX + targetW / 2 + lt.x * scaleFactor, targetH / 2 + lt.y * scaleFactor);
            // 旋轉與縮放都以佈局中心為軸，跟預覽的 transform-origin: center 一致
            if (ltRot !== 0) ctx.rotate((ltRot * Math.PI) / 180);
            ctx.scale(ltScale, ltScale);
            ctx.translate(-(pageOffsetX + targetW / 2), -targetH / 2);
          }

          // Draw layout images for this page!
          const pageTemplates = TEMPLATE_MAP[layout.images.length] || [];
          const pageActiveTemplate = pageTemplates[layout.templateIndex] || pageTemplates[0] || { name: '預設', rects: [] };

          // Load images for this specific page
          const imageLoaders = layout.images.map(cell => cell.url ? loadExportImage(cell.url) : Promise.resolve(null));

          const loadedImages = await Promise.all(imageLoaders);

          pageActiveTemplate.rects.forEach((rect, idx) => {
            const cell = layout.images[idx];
            const img = loadedImages[idx];

            // Base cell coordinates with pixel snapping to prevent gaps (shifted by pageOffsetX)
            // 與預覽同一套幾何：整體內縮半個間距，格子再各留半個 padding
            const inset = canvasGap / 2;
            /* 佈局可以有自己的長寬比，框不一定等於整頁 —— 跟預覽呼叫同一支
               layoutBox，而且一樣置中，所以匯出跟畫面上長得一模一樣。 */
            const lbox = layoutBox(layout, targetW, targetH);
            const boxX = pageOffsetX + (targetW - lbox.w) / 2;
            const boxY = (targetH - lbox.h) / 2;
            const areaW = Math.max(1, lbox.w - inset * 2);
            const areaH = Math.max(1, lbox.h - inset * 2);
            const leftPx = boxX + inset + Math.round(rect.x * areaW);
            const rightPx = boxX + inset + Math.round((rect.x + rect.w) * areaW);
            const topPx = boxY + inset + Math.round(rect.y * areaH);
            const bottomPx = boxY + inset + Math.round((rect.y + rect.h) * areaH);

            const bw = rightPx - leftPx;
            const bh = bottomPx - topPx;
            const bx = leftPx;
            const by = topPx;

            // Apply gap padding
            const ix = bx + canvasGap / 2;
            const iy = by + canvasGap / 2;
            const iw = bw - canvasGap;
            const ih = bh - canvasGap;

            if (iw <= 0 || ih <= 0) return;

            /* 這一格自己設了圓角就蓋掉佈局那根共用滑桿（跟預覽同一套） */
            const cellRadius = cell?.imgRadius
              ? cornerR(cell.imgRadius, iw, ih)
              : canvasRadius;

            // Draw solid background for the cell slot
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(ix, iy, iw, ih, cellRadius);
            } else {
              ctx.rect(ix, iy, iw, ih);
            }
            ctx.fillStyle = '#121212';
            ctx.fill();
            ctx.restore();

            if (!cell || !img) return;

            // Draw image inside clipping path
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(ix, iy, iw, ih, cellRadius);
            } else {
              ctx.rect(ix, iy, iw, ih);
            }
            ctx.clip();

            /* 套了濾鏡／調節／特效就先算出處理過的那一張，再照原本的
               裁切與縮放畫上去 —— 跟預覽用的是同一支 applyPhotoFx。 */
            const src: CanvasImageSource = hasPhotoFx(cell.fx)
              ? applyPhotoFx(
                  img,
                  Math.max(1, Math.round((img.naturalWidth || img.width))),
                  Math.max(1, Math.round((img.naturalHeight || img.height))),
                  cell.fx!,
                )
              : img;

            const imgW = img.naturalWidth || img.width;
            const imgH = img.naturalHeight || img.height;
            const is90or270 = (cell.rotation % 180) !== 0;

            const drawW = is90or270 ? imgH : imgW;
            const drawH = is90or270 ? imgW : imgH;

            const scaleX = iw / drawW;
            const scaleY = ih / drawH;
            // Add a tiny subpixel bleed factor to prevent thin gaps on edges
            const coverScale = Math.max(scaleX, scaleY) * 1.015 + 0.005;
            const finalScale = coverScale * cell.zoom;

            // Perform transformations
            ctx.translate(ix + iw / 2, iy + ih / 2);

            // Apply user shifts (in unrotated coordinate space to match preview)
            const shiftX = cell.offsetX * iw;
            const shiftY = cell.offsetY * ih;
            ctx.translate(shiftX, shiftY);

            ctx.rotate((cell.rotation * Math.PI) / 180);

            // Scale and draw（整組佈局是一個群組，格內照片跟著一起縮放）
            ctx.scale(finalScale, finalScale);
            ctx.drawImage(src, -imgW / 2, -imgH / 2, imgW, imgH);
            ctx.restore();
          });
          ctx.restore();
        }
      };

      // 依畫面上的圖層順序合成：一般圖片是偶數層，佈局是奇數層（見預覽的 zIndex）。
      // minX/maxX 是物件在「整條頁面帶」上的範圍，用來跳過畫不到這一頁的東西。
      const drawJobs: {
        z: number; minX: number; maxX: number;
        isVideo?: boolean; src?: string;
        run: (c: CanvasRenderingContext2D) => Promise<void>;
      }[] = [];
      pages.forEach((page, pageIdx) => {
        page.layouts.forEach(lay => {
          const ls = lay.t?.scale ?? 1;
          // 佈局有自己的比例時佔的橫向範圍會比整頁窄，要照它自己的框算
          const lb0 = layoutBox(lay, targetW, targetH);
          // 轉過角度之後佔的橫向範圍會變寬，要用「轉過的外接框」
          const lbw = rotExtent(lb0.w * ls, lb0.h * ls, lay.t?.rot || 0).bw;
          const left = pageIdx * targetW + (targetW - lbw) / 2 + (lay.t?.x || 0) * scaleFactor;
          drawJobs.push({
            z: 59 + (lay.z ?? 0) * 2,
            minX: left,
            maxX: left + lbw,
            run: (c) => drawPageLayout(c, pageIdx, lay),
          });
        });
      });
      floatingImages.forEach((fImg, i) => {
        const adjustedX = fImg.x - Math.floor(fImg.x / (previewW + 1));
        const fw = fImg.width * scaleFactor;
        const cx = adjustedX * scaleFactor + fw / 2;
        /*
          轉過角度之後「外接框」的半寬 —— 要用外接『框』，不能用外接『圓』。
          外接圓的半徑是 hypot(寬, 高)/2，滿版的圖層算出來會比實際寬 60% 以上，
          範圍直接吃進隔壁那一頁 —— 影片旁邊那一頁就會被判定成「這頁有影片」，
          結果整頁被當成影片輸出。
        */
        const rad = ((fImg.rotation || 0) * Math.PI) / 180;
        const half = (Math.abs(fImg.width * Math.cos(rad)) + Math.abs(fImg.height * Math.sin(rad)))
          * fImg.scale * scaleFactor / 2;
        drawJobs.push({
          z: 60 + i * 2,
          minX: cx - half,
          maxX: cx + half,
          isVideo: !!fImg.isVideo,
          src: fImg.src,
          /* 裁在自己那一頁裡面。貼齊畫布邊緣時圖層會刻意往外多蓋半個像素
             （不然預覽會露出一條抗鋸齒的白縫），預覽有 overflow:hidden 擋著，
             但匯出是把所有頁面畫在同一張長畫布上、沒有任何裁切 ——
             多出來的那半個像素就跑到隔壁那一頁去了。 */
          run: async (c) => {
            /* 裁切範圍是「這個圖層真正橫跨到的每一頁」，不是只有一頁 ——
               只裁一頁的話，刻意跨在兩頁上的物件會被切掉一半。
               判斷跨頁時留 1.5px 的容差：貼齊邊緣時圖層會往外多蓋半個像素
               （不然預覽會露出抗鋸齒的白縫），那半個像素不能被當成「跨頁」。 */
            const TOL = 1.5 * scaleFactor;
            const lx = adjustedX * scaleFactor;
            const rx = lx + fImg.width * fImg.scale * scaleFactor;
            const last = Math.max(0, pages.length - 1);
            const p0 = Math.min(last, Math.max(0, Math.floor((lx + TOL) / targetW)));
            const p1 = Math.min(last, Math.max(p0, Math.floor((rx - TOL) / targetW)));
            c.save();
            c.beginPath();
            c.rect(p0 * targetW, 0, (p1 - p0 + 1) * targetW, targetH);
            c.clip();
            try {
              await drawFloatingLayers(c, [fImg], scaleFactor);
            } finally {
              c.restore();
            }
          },
        });
      });
      drawJobs.sort((x, y) => x.z - y.z);

      /**
       * 有影片圖層的那一頁輸出影片。
       *
       * 錄影是即時的（一秒要交出 30 張畫面），所以不會用匯出照片那個
       * 動輒 3000px 的解析度，而是壓到長邊 1280；而且先把「不是影片」的東西
       * 各畫成一張靜態底圖（影片下面一張、上面一張），每一帧只要貼兩張圖
       * ＋畫影片，才跟得上即時錄影。
       */
      const recordPageVideo = async (pageIdx: number, pageLeft: number): Promise<string> => {
        // 跟 pageHasVideo 用同一條判斷，兩邊才不會一個說有、一個挑不到
        const videoJobs = drawJobs.filter(j =>
          j.isVideo && j.maxX > pageLeft + 0.5 && j.minX < pageLeft + targetW - 0.5);
        const k = Math.min(1, 1280 / Math.max(targetW, targetH));
        // 編碼器要求偶數邊長
        const VW = Math.max(2, Math.round(targetW * k / 2) * 2);
        const VH = Math.max(2, Math.round(targetH * k / 2) * 2);

        const lowestVideoZ = Math.min(...videoJobs.map(j => j.z));
        const mkLayer = async (pick: (z: number) => boolean, withBg: boolean) => {
          const c = document.createElement('canvas');
          c.width = VW; c.height = VH;
          const g = c.getContext('2d')!;
          if (withBg) {
            g.fillStyle = pages[pageIdx].bgColor || '#ffffff';
            g.fillRect(0, 0, VW, VH);
          }
          g.save();
          g.scale(VW / targetW, VH / targetH);
          g.translate(-pageLeft, 0);
          for (const job of drawJobs) {
            if (job.isVideo) continue;
            if (job.maxX <= pageLeft || job.minX >= pageLeft + targetW) continue;
            if (!pick(job.z)) continue;
            await job.run(g);
          }
          g.restore();
          return c;
        };
        const below = await mkLayer(z => z < lowestVideoZ, true);
        const above = await mkLayer(z => z > lowestVideoZ, false);

        const rc = document.createElement('canvas');
        rc.width = VW; rc.height = VH;
        const rg = rc.getContext('2d')!;

        // 影片全部從頭開始播，長度取最長的那一支（上限 15 秒）
        const vids = videoJobs.map(j => getPreviewVideo(j.src!));
        await Promise.all(vids.map(v => new Promise<void>(res => {
          if (v.readyState >= 1) return res();
          const on = () => { v.removeEventListener('loadedmetadata', on); res(); };
          v.addEventListener('loadedmetadata', on);
          setTimeout(on, 3000);
        })));
        const dur = Math.min(15, Math.max(...vids.map(v => (isFinite(v.duration) && v.duration > 0 ? v.duration : 3))));
        /*
          倒回開頭，而且要等到「真的有畫面可以畫」（readyState ≥ HAVE_CURRENT_DATA）。
          只等 loadedmetadata 的話只有長寬、還沒有任何一帧，畫上去是空的。
        */
        await Promise.all(vids.map(v => new Promise<void>(res => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            v.removeEventListener('loadeddata', check);
            v.removeEventListener('seeked', check);
            v.removeEventListener('canplay', check);
            res();
          };
          const check = () => { if (v.readyState >= 2) finish(); };
          v.addEventListener('loadeddata', check);
          v.addEventListener('seeked', check);
          v.addEventListener('canplay', check);
          try { v.currentTime = 0; } catch { /* ignore */ }
          check();
          setTimeout(finish, 3000);
        })));

        // 逐帧合成：靜態底 → 影片 → 靜態上層
        const composite = async () => {
          rg.clearRect(0, 0, VW, VH);
          rg.drawImage(below, 0, 0);
          rg.save();
          rg.scale(VW / targetW, VH / targetH);
          rg.translate(-pageLeft, 0);
          for (const job of videoJobs) await job.run(rg);
          rg.restore();
          rg.drawImage(above, 0, 0);
        };
        /*
          先把第一帧合成上去再開始錄。captureStream 會把「開始錄的當下」畫布上
          的內容當成第一帧 —— 畫布還是空的就會錄到一段黑畫面，而第一次合成又
          特別慢（要載入影片、解碼、套濾鏡），黑掉的那段就更長。
        */
        await composite();

        const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm']
          .find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) || '';
        const stream = rc.captureStream(30);
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
        const chunks: Blob[] = [];
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        const done = new Promise<Blob>(res => { rec.onstop = () => res(new Blob(chunks, { type: mime || 'video/webm' })); });
        rec.start();
        // 錄影開始之後才播，第一帧才會剛好是影片的第 0 秒
        vids.forEach(v => { try { v.play().catch(() => {}); } catch { /* ignore */ } });

        const t0 = performance.now();
        await new Promise<void>(resolve => {
          const frame = async () => {
            await composite();
            if (performance.now() - t0 >= dur * 1000) return resolve();
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        rec.stop();
        const blob = await done;
        return URL.createObjectURL(blob);
      };

      // 每頁各自輸出一張畫布：解析度不再被頁數瓜分，跨頁的東西靠平移座標接續。
      const urls: string[] = [];
      const kinds: ('image' | 'video')[] = [];
      /**
       * 這一頁上面真的有影片嗎。
       * 留 0.5px 的容差：滿版的影片剛好切齊頁面邊界，浮點誤差會讓隔壁那一頁
       * 也算「碰到了」，那一頁就會被誤判成影片頁。
       */
      const VIDEO_EDGE_EPS = 0.5;
      const pageHasVideo = (pageIdx: number) => {
        const left = pageIdx * targetW;
        return drawJobs.some(j =>
          j.isVideo && j.maxX > left + VIDEO_EDGE_EPS && j.minX < left + targetW - VIDEO_EDGE_EPS);
      };
      // 有影片的那一頁輸出影片、沒有影片的那一頁照舊輸出無損 PNG，各出各的
      for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const pageLeft = pageIdx * targetW;
        const hasVideo = pageHasVideo(pageIdx);
        if (hasVideo && typeof MediaRecorder !== 'undefined') {
          urls.push(await recordPageVideo(pageIdx, pageLeft));
          kinds.push('video');
          continue;
        }
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.fillStyle = pages[pageIdx].bgColor || '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);

        ctx.save();
        ctx.translate(-pageLeft, 0);
        for (const job of drawJobs) {
          if (job.maxX <= pageLeft || job.minX >= pageLeft + targetW) continue;
          await job.run(ctx);
        }
        ctx.restore();

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Blob creation failed');
        urls.push(URL.createObjectURL(blob));
        kinds.push('image');
      }

      if (urls.length === 0) throw new Error('Blob creation failed');
      if (silent) return { urls, kinds };
      finalImagesRef.current.forEach(u => URL.revokeObjectURL(u));
      finalImagesRef.current = urls;
      setFinalImages(urls);
      setFinalKinds(kinds);
      setExportState('success');
    } catch (err) {
      console.error(err);
      if (silent) return;
      alert('存檔失敗，請重試');
      setExportState('idle');
    }
  };

  return (
    <div className="flex flex-col w-full h-screen bg-black text-white relative font-sans overflow-hidden">
      <style>{`
        /* 圓球跟「佈局調整」的滑桿一致：沿用原生 thumb + accent-color，不自己畫 */
        .designer-color-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 3px; outline: none; touch-action: none; accent-color: #ffffff; cursor: pointer; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        /* 圖片編輯那一頁的滑桿：跟「編輯」用同一組樣式，連軌道與圓點都一樣 */
        .custom-range {
          -webkit-appearance: none;
          width: calc(100% + 64px);
          height: 40px;
          background: rgba(0,0,0,0);
          outline: none;
          margin: 0 -32px;
          padding: 0;
          touch-action: none;
          -webkit-tap-highlight-color: rgba(0,0,0,0);
        }
        .custom-range:focus { outline: none; }
        /* 特效細項的並排滑桿：跟「編輯」同一份。盒子收到 18px（剛好包住 15px 的圓點），
           軌道也只畫 9px..寬-9px，圓點才走得到頭尾（並排的滑桿不能像一般滑桿那樣往外擴）。 */
        .custom-range.dense { height: 26px; width: 100%; margin: 0; }
        .custom-range.dense::-webkit-slider-runnable-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-moz-range-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-webkit-slider-thumb { height: 26px; width: 18px; margin-top: -12px; }
        .custom-range.dense::-moz-range-thumb { height: 26px; width: 18px; }
        .custom-range::-webkit-slider-runnable-track {
          width: 100%;
          height: 2px;
          background: linear-gradient(to right, rgba(0,0,0,0) 32px, #333 32px, #333 calc(100% - 32px), rgba(0,0,0,0) calc(100% - 32px));
          border-radius: 2px;
          cursor: pointer;
        }
        .custom-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 64px;
          width: 64px;
          background-color: rgba(0,0,0,0);
          background-image: radial-gradient(circle at center, #ffffff 0, #ffffff 7.5px, rgba(255,255,255,0) 8px, rgba(255,255,255,0) 100%);
          border: none;
          outline: none;
          cursor: pointer;
          margin-top: -31px;
          transition: transform 0.1s;
          box-shadow: none;
        }
        .custom-range::-webkit-slider-thumb:active { transform: scale(1.15); }
        .custom-range::-moz-range-track { height: 2px; background: #333; border-radius: 2px; }
        .custom-range::-moz-range-thumb {
          height: 15px; width: 15px; border-radius: 50%;
          background: #fff; border: none; cursor: pointer;
        }
        /* 觸控裝置上 :hover 會在點完之後殘留，導致「點一下佈局，格子就亮起來」。
           所以格子的 hover 效果只在真的有滑鼠的裝置上啟用。 */
        .cell-hover { transition: border-color .3s, background-color .3s; }
        @media (hover: hover) and (pointer: fine) {
          .cell-hover:hover { border-color: rgba(255,255,255,0.3); background-color: #111111; }
          .group:hover .cell-hover-icon { opacity: .6; transform: scale(1.1); }
          .group:hover .cell-hover-text { color: rgba(255,255,255,0.5); }
        }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .allow-callout {
            -webkit-touch-callout: default !important;
            -webkit-user-select: auto !important;
            -moz-user-select: auto !important;
            -ms-user-select: auto !important;
            user-select: auto !important;
            pointer-events: auto !important;
            touch-action: auto !important;
            cursor: pointer !important;
            z-index: 150 !important;
            display: block !important;
        }
      `}</style>
      {/* 構圖：跟「編輯」同一個介面，套用後 bake 回這個圖層 */}
      {composeState && (
        <ComposeStudio
          image={composeState.img}
          geo={composeState.geo}
          onChange={g => setComposeState(st => (st ? { ...st, geo: g } : st))}
          onCancel={() => setComposeState(null)}
          onApply={applyComposeToLayer}
        />
      )}

      {exportState === 'success' && finalImages.length > 0 && (
        <div className="absolute inset-0 z-[110] bg-black flex flex-col animate-in fade-in duration-500">
          <header className="h-14 flex items-center px-5 shrink-0 z-20 bg-black/40 backdrop-blur-xl">
            <button 
              onClick={(e) => { e.stopPropagation(); handleLeave(); }}
              className="p-2 -ml-2 text-[#888] hover:text-white transition-colors active:scale-90"
            >
              <ChevronLeft size={22} />
            </button>
          </header>
          <div className="flex-1 flex flex-col items-center justify-center p-6 relative min-h-0">
            <div className="w-full flex-1 min-h-0 flex items-center">
              <div
                ref={resultStripRef}
                // overflow-anchor: none 才不會被瀏覽器的捲動錨定拉到別頁
                style={{ overflowAnchor: 'none' }}
                className="w-full flex flex-row gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory px-[max(0px,calc(50%-40vw))] md:flex-wrap md:justify-center md:overflow-visible md:px-0"
              >
                {finalImages.map((src, i) => (
                  <div key={src} className="shrink-0 snap-center flex flex-col items-center">
                    <div className="relative shadow-2xl rounded overflow-hidden">
                      {finalKinds[i] === 'video' ? (
                        // 這一頁有影片，所以輸出的是影片
                        <video
                          src={src}
                          autoPlay
                          loop
                          muted
                          playsInline
                          controls
                          className="max-w-[80vw] max-h-[52vh] md:max-w-[38vh] object-contain relative z-10"
                        />
                      ) : (
                        <img
                          src={src}
                          alt={`Final Result ${i + 1}`}
                          className="max-w-[80vw] max-h-[52vh] md:max-w-[38vh] object-contain allow-callout relative z-10"
                        />
                      )}
                      <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* 頁數固定放這裡，只有一個 —— 桌機是換行排開的，全部看得到就不用標 */}
            {finalImages.length > 1 && (
              <div className="h-4 mt-3 shrink-0 md:hidden">
                <span className="text-[10px] text-white/40 font-bold tracking-[0.2em] tabular-nums">
                  {resultIdx + 1} / {finalImages.length}
                </span>
              </div>
            )}
          </div>
          <div className="bg-black flex flex-col gap-3 px-6 pb-6 pt-2">
            <SaveButton urls={finalImages} />
            <div className="flex items-center justify-center gap-4">
            <button
              onClick={(e) => { e.stopPropagation(); setExportState('idle'); clearFinalImages(); }}
              className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-sm"
            >
              繼續編輯
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onImportNew?.(); }}
              className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-sm"
            >
              拼下一張
            </button>
            </div>
          </div>
        </div>
      )}

      {exportState === 'processing' && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white">正在存檔</p>
          <p className="text-[10px] text-white/40 mt-3 uppercase tracking-widest font-bold">優化高品質渲染中</p>
        </div>
      )}

      {/* Top Header */}
      <header className="h-14 border-b border-[#1a1a1a] flex items-center justify-between px-4 z-50 bg-black/90 backdrop-blur-md">
        <button
          onClick={handleLeave}
          className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90"
        >
            <ChevronLeft size={22} />
          </button>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={(e) => { e.stopPropagation(); undo(); }} 
              disabled={historyState.index <= 0} 
              className={`p-2 text-white transition-all ${historyState.index <= 0 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}
              title="復原"
            >
              <Icon name="undo" className="text-xl" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); redo(); }} 
              disabled={historyState.index >= historyState.history.length - 1 || historyState.index === -1} 
              className={`p-2 text-white transition-all ${historyState.index >= historyState.history.length - 1 || historyState.index === -1 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}
              title="重做"
            >
              <Icon name="redo" className="text-xl" />
            </button>
            
            {/* 分割線 */}
            <div className="w-px h-4 bg-white/10 mx-1 shrink-0" />

            {/* 三個點：點開才有「預覽」與「對齊」 */}
            <div className="relative">
              <button
                onClick={() => setMoreOpen(o => !o)}
                // 打開時只有圖標變亮，不畫圓形底
                className={`w-9 h-9 flex items-center justify-center transition-colors active:scale-90 ${
                  moreOpen ? 'text-white' : 'text-white/70'
                }`}
                title="更多"
              >
                <Icon name="more_horiz" className="text-xl" />
              </button>
              {moreOpen && (
                <>
                  {/* 點旁邊就收起來 */}
                  {/* 這裡的層數只跟 header 裡面的東西比：整個工作區被關在 z-0 的
                      堆疊環境裡（見下面工作區那層的註解），所以選單一定在畫布的
                      照片、佈局上面 */}
                  <div className="fixed inset-0 z-[60]" onClick={() => setMoreOpen(false)} />
                  <div className="absolute right-0 top-11 z-[61] w-36 rounded-2xl bg-[#1b1b1b] border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    {/* 直式 2:3、9:16 IG 吃不下，這一顆就整個不出現 */}
                    {igPreviewSupported && (
                      <>
                        <button
                          onClick={() => { setMoreOpen(false); setIgPreview(true); }}
                          className="w-full h-11 px-4 flex items-center text-[12px] font-bold text-white/90 hover:bg-white/10 transition-colors"
                        >
                          <span>預覽</span>
                        </button>
                        <div className="h-px bg-white/10" />
                      </>
                    )}
                    {/* 這一列只是說明，不能點；能點的只有右邊那顆開關。
                        開關切完選單也不收起來（常常要連著開開關關比對效果）。 */}
                    <div className="w-full h-11 px-4 flex items-center text-[12px] font-bold text-white/90">
                      <span>對齊</span>
                      {/* 顏色跟操作欄那些「選中」的按鈕同一套：開＝白底黑球，
                          關＝跟未選中的按鈕一樣的淡白。按下去不做任何變色。 */}
                      <button
                        onClick={() => {
                          setEnableSnapping(!enableSnapping);
                          if (enableSnapping) setActiveGuidelines([]);
                        }}
                        role="switch"
                        aria-checked={enableSnapping}
                        title={enableSnapping ? '關閉對齊' : '開啟對齊'}
                        className={`ml-auto relative shrink-0 w-[38px] h-[22px] rounded-full transition-colors duration-200 ${
                          enableSnapping ? 'bg-white' : 'bg-white/[0.14]'
                        }`}
                      >
                        <span
                          className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200 ease-out ${
                            enableSnapping ? 'translate-x-4 bg-black' : 'translate-x-0 bg-white/45'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {(pages.some(p => p.layouts.some(l => l.images.some(img => img.url !== ''))) || floatingImages.length > 0) && (
              <button
                onClick={() => handleExport()}
                disabled={exportState === 'processing'}
                className="bg-white text-black px-6 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg active:scale-95 transition-transform whitespace-nowrap"
              >
                儲存
              </button>
            )}
          </div>
        </header>

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept="image/*,video/*"
        onChange={(e) => handleFileChange(e, true)}
        className="hidden"
      />
      <input
        type="file"
        ref={replaceInputRef}
        accept="image/*"
        multiple
        onChange={handleReplaceFileChange}
        className="hidden"
      />

      {/* Main Workspace Layout */}
      {/* 整個工作區的空白（含頁面上下的黑底）都能用來取消選取：
          佈局放大時幾乎蓋滿整頁，只靠頁面內的細長空白很難點到 */}
      {/* z-0 讓整個工作區自成一個堆疊環境：裡面的照片是 60、62、64⋯⋯，
          圖層一多就會爬過 header 的 z-50，把三個點叫出來的選單壓在底下。
          關進來之後，畫布上的東西再多也只在這一層裡面排前後。 */}
      <div
        className="flex-1 flex flex-col md:flex-row overflow-hidden relative z-0"
        onPointerDown={(e) => {
          workspacePointerDown.current = {
            x: e.clientX, y: e.clientY, time: Date.now(),
            onBlank: isBlankTarget(e.target as Element | null),
            /* 有東西被選中時，拖畫布任何一處都是在搬那個物件（見 gestureScope）。
               那種手勢鬆手時不能算「在空白處放開＝取消選取」——
               使用者只是把東西拖到別的位置，不是想取消選取。 */
            movesObject: gestureScope(e.target as Element | null) !== 'pan',
          };
        }}
        onPointerUp={(e) => {
          if (!workspacePointerDown.current) return;
          const dx = e.clientX - workspacePointerDown.current.x;
          const dy = e.clientY - workspacePointerDown.current.y;
          const startBlank = workspacePointerDown.current.onBlank;
          const movedObject = workspacePointerDown.current.movesObject;
          workspacePointerDown.current = null;
          const target = e.target as Element | null;
          if (Math.hypot(dx, dy) >= 15) {
            // 從空白處按下、也在空白處放開＝取消選取（手指滑了多少都算）。
            // 但如果這一下其實是在搬某個被選中的物件，就不算 —— 鬆手要維持選取。
            if (startBlank && !movedObject && isBlankTarget(target)) {
              setSelectedFloatingId(null);
              setSelectedIndex(null);
              setSelectedLayoutId(null);
              setInlineEditId(null);
            }
            return;
          }
          if (!target) return;
          applyTapSelection(target);
        }}
      >
        {/* Left/Top Collage Preview Area */}
        <div 
          className="flex-1 flex items-center justify-start py-2 bg-[#070707] relative overflow-x-auto overflow-y-hidden select-none no-scrollbar overscroll-x-contain touch-none"
          ref={containerRef}
          onScroll={(e) => {
            if (!containerRef.current || pages.length <= 1) return;
            const scrollLeft = e.currentTarget.scrollLeft;
            const initialLeftOffset = stripOffset(containerSize.width, pagesScale);
            const center = scrollLeft + containerSize.width / 2;
            let closestIdx = 0;
            let minDistance = Infinity;
            for (let i = 0; i < pages.length; i++) {
              const pageCenter = initialLeftOffset + pagesScale * (i * (previewW + 1) + previewW / 2);
              const distance = Math.abs(center - pageCenter);
              if (distance < minDistance) {
                minDistance = distance;
                closestIdx = i;
              }
            }
            if (closestIdx !== activePageIndex) {
              setActivePageIndex(closestIdx);
            }
          }}
          onTouchStart={handleWorkspaceTouchStart}
          onTouchMove={handleWorkspaceTouchMove}
          onTouchEnd={handleWorkspaceTouchEnd}
          onTouchCancel={handleWorkspaceTouchEnd}
          onPointerDown={(e) => {
            workspacePointerDown.current = {
              x: e.clientX, y: e.clientY, time: Date.now(),
              onBlank: isBlankTarget(e.target as Element | null),
              /* 有東西被選中的時候，拖畫布任何一處都是在搬那個物件（見 gestureScope）。
                 那種手勢鬆手時就不能算「在空白處放開＝取消選取」——
                 使用者只是把東西拖到別的位置，不是想取消選取。 */
              movesObject: gestureScope(e.target as Element | null) !== 'pan',
            };
          }}
          onPointerUp={(e) => {
            if (workspacePointerDown.current) {
              const dx = e.clientX - workspacePointerDown.current.x;
              const dy = e.clientY - workspacePointerDown.current.y;
              const target = e.target as Element | null;
              const endOnBlank = isBlankTarget(target);
              // 只要手指幾乎沒移動就算「點一下」。
              // 原本還限制 300ms 內，按久一點就不會取消，選取框與四角圓球會留在畫面上。
              if (Math.hypot(dx, dy) < 15) {
                if (target) applyTapSelection(target);
              } else if (workspacePointerDown.current.onBlank && !workspacePointerDown.current.movesObject && endOnBlank) {
                // 從空白處按下、也在空白處放開：不管手指滑了多少都算「取消選取」。
                // 不然只是點得手抖一點（超過 15px）就取消不掉，選取框與四角圓球會一直留著。
                setSelectedFloatingId(null);
                setSelectedIndex(null);
                setSelectedLayoutId(null);
                setInlineEditId(null);
              }
              workspacePointerDown.current = null;
            }
          }}
        >
          {(() => {
            return (
              <div
                className="flex items-center flex-row flex-nowrap flex-shrink-0 h-full transition-opacity duration-150"
                style={{
                  // max-content ＋ flex-shrink-0：這一排的寬度＝所有小孩加起來。
                  // 外層是 flex 容器，不鎖 shrink 的話這排會被壓回容器寬度，
                  // 右邊的留白就不算進 scrollWidth，最後一頁永遠捲不到正中間。
                  width: 'max-content',
                  minWidth: '100%',
                  opacity: containerMeasured ? 1 : 0,
                }}
              >
                {/* 只做縮放（以左上角為原點）—— 外層已經是縮放後的尺寸了 */}
                {/*
                  這層的尺寸就是「縮放之後真正佔的大小」，裡面那層才做 scale。
                  這樣捲動範圍跟看到的大小一致：捲 1px 畫面就走 1px，
                  不需要每一帧回頭補位移 —— 之前那種補法在真機上，捲動是
                  合成執行緒在跑、補償是主執行緒在跑，差一帧就會抖得很明顯。

                  尺寸與左邊留白改由 applyStripGeometry 直接寫（每一帧一次）：
                  進出這個模式時，版面要跟著縮放倍率一起連續變化才會絲滑，
                  交給 React 寫的話尺寸會一次跳到目標值、只有縮放在慢慢跑。
                */}
                <div ref={stripShellRef} className="flex-shrink-0 relative">
                <div
                  ref={pagesColRef}
                  className="flex flex-col items-start flex-shrink-0 relative"
                  style={{
                    // 外殼是「縮放後」的尺寸，這一層要自己撐住「縮放前」的尺寸，
                    // 不然會被外殼壓小、整排頁面就排不開（捲動範圍也會不夠）
                    width: `${pages.length * previewW + (pages.length - 1)}px`,
                    height: `${previewH}px`,
                    transformOrigin: 'left top',
                    // 這個模式只用來排頁面：頁面上的東西一律不能碰
                    // （左右滑動仍然可以，捲動是外層容器在處理的）
                    pointerEvents: pagesMode ? 'none' : undefined,
                  }}
                >
                  <div
                    ref={pagesContainerRef}
                    // 排頁面時不裁切也不打陰影：被拖到最邊邊的那一頁才不會被黑色蓋掉
                    className={`flex flex-row flex-nowrap relative ${
                      pagesMode || pagesVisual ? '' : 'shadow-[0_25px_60px_rgba(0,0,0,0.8)] overflow-hidden'
                    }`}
                  >
                    {pages.map((page, pageIdx) => {
                      const isPageActive = pageIdx === activePageIndex;

                      return (
                        <React.Fragment key={page.id}>
                          {pageIdx > 0 && (
                            <div
                              className="w-[1px] bg-black/15 flex-shrink-0 self-stretch pointer-events-none"
                              /*
                                排頁面時的分隔線：粗細跟著整排一起等比例縮小
                                （不另外補回來），顏色則直接取一般模式那條線的顏色
                                （工作區底色再壓深 15%）並改成「不透明」——
                                半透明的話相鄰兩頁各自做次像素抗鋸齒，底下透出來多少
                                看那條縫落在像素格的哪，每條深淺就會不一樣。
                                另外疊在頁面上面，不然右邊那一頁會把它蓋掉半條。
                              */
                              style={(pagesMode || pagesVisual) ? {
                                backgroundColor: (pageDragIdx !== null || dragSettle)
                                  ? 'transparent'
                                  : shadeHex(WORKSPACE_BG, PAGE_SEAM_INK),
                                position: 'relative',
                                // 只要比「頁面本身」高就夠了（頁面沒設 z-index），
                                // 佈局是 59+、一般圖片是 60+，分割線一律在物件下面
                                zIndex: 1,
                              } : undefined}
                            />
                          )}

                          <div
                            id={pageIdx === 0 ? "grid-preview-container" : `grid-preview-container-${pageIdx}`}
                            data-page-id={page.id}
                            onPointerDown={(e) => {
                              handleSwitchPage(pageIdx);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwitchPage(pageIdx);
                            }}
                            // 這裡刻意不裁切也不自成堆疊環境：佈局才能被拖出這一頁、
                            // 並和一般圖片互相穿插圖層（裁切改由整條頁面容器負責）
                            className={`relative flex-shrink-0 cursor-pointer transition-[ring-color] duration-200 ${
                              isPageActive && !pagesMode && !pagesVisual ? 'ring-2 ring-white/20' : ''
                            } opacity-100`}
                            // 排頁面拖曳：整張頁面（含裡面的佈局）一起跟著手指走。
                            // 被拿起來的那一張微微放大＋加陰影，其他張平順讓開。
                            style={(() => {
                              // 跟頁面上的自由圖層共用同一支（含放手後的收尾），
                              // 兩邊才會一起動、一起停
                              const mv = pageContentShift(pageIdx);
                              const lifted = !!mv && mv.s !== 1;
                              return {
                                width: `${previewW}px`,
                                height: `${previewH}px`,
                                backgroundColor: page.bgColor,
                                position: 'relative' as const,
                                transform: mv
                                  ? `translateX(${mv.dx}px)${lifted ? ` scale(${mv.s})` : ''}`
                                  : undefined,
                                transformOrigin: 'center center',
                                transition: mv ? (mv.live ? 'none' : 'transform 220ms cubic-bezier(0.2,0,0,1)') : undefined,
                                boxShadow: lifted ? '0 18px 40px rgba(0,0,0,0.55)' : undefined,
                                zIndex: lifted ? 900 : undefined,
                              };
                            })()}
                          >
                            <div className="absolute inset-0" style={{ backgroundColor: page.bgColor }} />
                            {page.layouts.map((layout) => {
                              const pageTemplates = TEMPLATE_MAP[layout.images.length] || [];
                              const pageActiveTemplate = pageTemplates[layout.templateIndex] || pageTemplates[0] || { name: '預設', rects: [] };
                              // 捲到別頁時也要保持選取狀態，才能一路把佈局拖過去
                              const isThisLayoutSelected = selectedLayoutId === layout.id;
                              // 整組佈局＝一張圖片：縮放時所有東西（格子、間距、圓角、
                              // 格內照片）等比例一起變，看起來完全一樣。
                              // 而且是用真實尺寸而不是 transform: scale()，放大才不會糊。
                              const ls = layout.t?.scale ?? 1;
                              const lbox = layoutBox(layout, previewW, previewH);
                              const lw = lbox.w * ls;
                              const lh = lbox.h * ls;
                              const gap = layout.gap * ls;
                              const radius = layout.radius * ls;
                              const lLeft = (previewW - lw) / 2 + (layout.t?.x || 0);
                              const lTop = (previewH - lh) / 2 + (layout.t?.y || 0);
                              return (
                              <div
                                key={layout.id}
                                data-layout-wrapper={pageIdx}
                                data-layout-id={layout.id}
                                data-layout-z={layout.z ?? 0}
                                className="absolute"
                                style={{
                                  left: `${lLeft}px`,
                                  top: `${lTop}px`,
                                  width: `${lw}px`,
                                  height: `${lh}px`,
                                  transition: 'none',
                                  zIndex: 59 + (layout.z ?? 0) * 2,
                                  /* 兩指旋轉：直接轉整個外框，裡面的格子、照片、
                                     選取框、四個角、那排按鈕全部跟著轉，
                                     連點擊命中判定都是瀏覽器自己算的。 */
                                  ...((layout.t?.rot || 0) !== 0
                                    ? { transform: `rotate(${layout.t!.rot}deg)`, transformOrigin: 'center center' }
                                    : null),
                                }}
                                onTouchStart={isThisLayoutSelected ? handleLayoutTouchStart : undefined}
                                onTouchMove={isThisLayoutSelected ? handleLayoutTouchMove : undefined}
                                onTouchEnd={isThisLayoutSelected ? handleLayoutTouchEnd : undefined}
                                onTouchCancel={isThisLayoutSelected ? handleLayoutTouchEnd : undefined}
                              >
                              {(() => {
                                const layoutTransition = 'none';
                                const imageTransition = 'none';

                                return pageActiveTemplate.rects.map((rect, idx) => {
                                  const cell = layout.images[idx];
                                  const isSelected = selectedIndex === idx && isThisLayoutSelected;
                                  // 整組佈局被選取時（第一次點擊），格子是「整體的一部分」，
                                  // 不該再各自反白／發亮
                                  // 整組選取時格子不各自反白；但真的在拖曳交換時還是要有放置回饋
                                  const swapping = touchDraggedIndex !== null || draggedIndex !== null || floatDragSrc !== null;
                                  const wholeLayoutSelected = isThisLayoutSelected && selectedIndex === null && !swapping;
                                  const isDragOver = dragOverIndex === idx && isThisLayoutSelected && !wholeLayoutSelected;

                                  // 版面整體先內縮半個間距，格子本身再各留半個 padding，
                                  // 這樣格線寬度與最外圈留白一致，而且相鄰格子精準相接、絕不重疊
                                  // （相鄰兩格算出同一個浮點邊界，仍然精準相接）。
                                  // 座標刻意不取整數：取整的話，縮放佈局的過程中每一格會在
                                  // 不同時間點跳 1px，格內的照片看起來就在亂動。
                                  const inset = gap / 2;
                                  const areaW = Math.max(1, lw - inset * 2);
                                  const areaH = Math.max(1, lh - inset * 2);
                                  const leftPx = inset + rect.x * areaW;
                                  const rightPx = inset + (rect.x + rect.w) * areaW;
                                  const topPx = inset + rect.y * areaH;
                                  const bottomPx = inset + (rect.y + rect.h) * areaH;

                                  /* ── 格子邊界一律取整 ────────────────────────────────
                                     每一條格線都取整，相鄰兩格自然算出同一條整數邊，必然重合。

                                     以前只有「空格子」取整、有照片的不取整。於是只要有格子
                                     沒放照片，它跟旁邊那格有照片的邊界就對不上，中間那條
                                     頁面底色會在縮放過程中一格閃一格 —— 就是主人說的白線。

                                     當初不敢對有照片的格子取整，是怕格內照片跟著跳 1px。
                                     這裡把兩件事拆開：**框**用取整後的值，**格內照片**用
                                     沒取整的真實幾何（rawW/rawH），再把「取整後的中心」與
                                     「真實中心」的差補回去（fixX/fixY）。
                                     於是框永遠貼齊像素、照片永遠連續，兩邊都拿到。 */
                                  const l0 = Math.round(leftPx), t0 = Math.round(topPx);
                                  const cellWidth = Math.round(rightPx) - l0;
                                  const cellHeight = Math.round(bottomPx) - t0;
                                  /** 沒取整的真實格子大小與中心補正（只給格內照片用） */
                                  const rawW = Math.max(1, rightPx - leftPx);
                                  const rawH = Math.max(1, bottomPx - topPx);
                                  const fixX = (leftPx + rightPx) / 2 - (l0 + cellWidth / 2);
                                  const fixY = (topPx + bottomPx) / 2 - (t0 + cellHeight / 2);

                                  if (!cell) {
                                    return (
                                      <div
                                        key={`slot-${idx}`}
                                        className="absolute bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-600"
                                        style={{
                                          left: `${l0}px`,
                                          top: `${t0}px`,
                                          width: `${cellWidth}px`,
                                          height: `${cellHeight}px`,
                                          padding: `${gap / 2}px`,
                                          transition: layoutTransition,
                                        }}
                                      >
                                        <div className="w-full h-full flex items-center justify-center bg-neutral-950" style={{ borderRadius: `${radius}px`, WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleSwitchPage(pageIdx);
                                              setSlotToUpload(idx);
                                              replaceInputRef.current?.click();
                                            }}
                                            className="p-2 hover:bg-white/5 rounded-full transition-all"
                                          >
                                            <Plus size={16} />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  }

                                  // Empty Slot Card UI
                                  if (cell.url === '') {
                                    return (
                                      <div
                                        key={cell.id}
                                        data-cell-id={idx}
                                        onPointerDown={(e) => {
                                          dragOrMoveOccurredRef.current = false;
                                          pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
                                        }}
                                        onPointerMove={(e) => {
                                          if (pointerStartPosRef.current) {
                                            const dx = e.clientX - pointerStartPosRef.current.x;
                                            const dy = e.clientY - pointerStartPosRef.current.y;
                                            if (Math.hypot(dx, dy) > 8) {
                                              dragOrMoveOccurredRef.current = true;
                                            }
                                          }
                                        }}
                                        onClick={(e) => {
                                          if (dragOrMoveOccurredRef.current) {
                                            e.stopPropagation();
                                            return;
                                          }
                                          e.stopPropagation();
                                          // 觸控已經在 touchend 處理過了，別讓合成出來的 click 再做一次
                                          if (Date.now() - touchHandledAtRef.current < 600) return;
                                          handleSwitchPage(pageIdx);
                                          // 與有照片的格子一致：第一次點擊先選中整組佈局，
                                          // 再點一次才進到這一格（開啟選圖）
                                          selectCellOrLayout(layout.id, idx);
                                        }}
                                        onDragOver={(e) => {
                                          handleSwitchPage(pageIdx);
                                          handleDragOver(e, idx);
                                        }}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => {
                                          handleSwitchPage(pageIdx);
                                          handleDrop(e, idx);
                                        }}
                                        onTouchStart={(e) => {
                                          handleSwitchPage(pageIdx);
                                          handleCellTouchStart(e, idx, layout.id);
                                        }}
                                        onTouchMove={(e) => handleCellTouchMove(e, idx, layout.id)}
                                        onTouchEnd={(e) => handleCellTouchEnd(e, idx, layout.id)}
                                        onTouchCancel={(e) => handleCellTouchEnd(e, idx, layout.id)}
                                        className="absolute cursor-pointer group"
                                        style={{
                                          left: `${l0}px`,
                                          top: `${t0}px`,
                                          width: `${cellWidth}px`,
                                          height: `${cellHeight}px`,
                                          padding: `${gap / 2}px`,
                                          transition: layoutTransition,
                                        }}
                                      >
                                        <div 
                                          className={`w-full h-full relative flex flex-col items-center justify-center border border-dashed rounded-lg bg-[#0c0c0c] transition-[border-color,background-color,box-shadow] duration-300 ${
                                            isSelected 
                                              ? 'border-white bg-[#141414] shadow-[0_0_15px_rgba(255,255,255,0.05)]' 
                                              : 'border-white/10 ' + (wholeLayoutSelected ? '' : 'cell-hover')
                                          }`}
                                          style={{ borderRadius: `${radius}px`, WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}
                                        >
                                          <Plus className={`text-white opacity-20 transition-all duration-300 mb-1 ${wholeLayoutSelected ? '' : 'cell-hover-icon'}`} size={20} />
                                          <span className={`text-[9px] font-bold text-white/20 tracking-widest uppercase ${wholeLayoutSelected ? '' : 'cell-hover-text'}`}>選擇相片</span>
                                          <div
                                            data-dim-overlay="1"
                                            className="absolute inset-0 pointer-events-none"
                                            style={{
                                              borderRadius: `${radius}px`,
                                              // 空格子也要有拖放回饋，一樣只用變亮暗示，不加白框
                                              backgroundColor: 'rgba(255,255,255,0.14)',
                                              opacity: (isThisLayoutSelected && !wholeLayoutSelected && (touchDragOverIndex === idx || isDragOver || hoveredSwapTargetIndex === idx)) ||
                                                (swapOver?.kind === 'cell' && swapOver.idx === idx && swapOver.layoutId === layout.id) ? 1 : 0,
                                            }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  }

                                  const w_img = cell.naturalWidth || 800;
                                  const h_img = cell.naturalHeight || 600;
                                  const is90or270 = (cell.rotation % 180) !== 0;

                                  const drawW = is90or270 ? h_img : w_img;
                                  const drawH = is90or270 ? w_img : h_img;

                                  /* 用「沒取整」的格子大小算，照片的縮放才不會跟著
                                     格線取整一起跳（框取整、照片連續，見上面的說明）。 */
                                  const scaleX = rawW / drawW;
                                  const scaleY = rawH / drawH;
                                  // 防止格子邊緣露出細縫的「咬邊」。純粹用乘的，不能再加常數 ——
                                  // 加常數的話縮放時每張照片相對格子的比例會跟著變，就不是等比例了。
                                  const coverScale = Math.max(scaleX, scaleY) * 1.02;
                                  const finalScale = coverScale * cell.zoom;

                                  const layoutW = w_img;
                                  const layoutH = h_img;
                                  // 整組佈局用 CSS scale 縮放時，格子跟著變大變小是對的，
                                  // 但格內照片本身不該跟著縮 —— 這裡反向抵銷掉 wrapper 的縮放。
                                  const cssScale = finalScale;

                                  return (
                                    <div
                                      key={cell.id}
                                      data-cell-id={idx}
                                      onPointerDown={(e) => {
                                        dragOrMoveOccurredRef.current = false;
                                        pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
                                      }}
                                      onPointerMove={(e) => {
                                        if (pointerStartPosRef.current) {
                                          const dx = e.clientX - pointerStartPosRef.current.x;
                                          const dy = e.clientY - pointerStartPosRef.current.y;
                                          if (Math.hypot(dx, dy) > 8) {
                                            dragOrMoveOccurredRef.current = true;
                                          }
                                        }
                                      }}
                                      onClick={(e) => {
                                        if (dragOrMoveOccurredRef.current) {
                                          e.stopPropagation();
                                          return;
                                        }
                                        e.stopPropagation();
                                        if (Date.now() - touchHandledAtRef.current < 600) return;
                                        handleSwitchPage(pageIdx);
                                        selectCellOrLayout(layout.id, idx);
                                      }}
                                      draggable={selectedIndex !== idx || !isThisLayoutSelected}
                                      onDragStart={(e) => {
                                        handleSwitchPage(pageIdx);
                                        handleDragStart(e, idx);
                                      }}
                                      onDragOver={(e) => {
                                        handleSwitchPage(pageIdx);
                                        handleDragOver(e, idx);
                                      }}
                                      onDragLeave={handleDragLeave}
                                      onDrop={(e) => {
                                        handleSwitchPage(pageIdx);
                                        handleDrop(e, idx);
                                      }}
                                      onDragEnd={handleDragEnd}
                                      onTouchStart={(e) => {
                                        handleSwitchPage(pageIdx);
                                        handleCellTouchStart(e, idx, layout.id);
                                      }}
                                      onTouchMove={(e) => handleCellTouchMove(e, idx, layout.id)}
                                      onTouchEnd={(e) => handleCellTouchEnd(e, idx, layout.id)}
                                      onTouchCancel={(e) => handleCellTouchEnd(e, idx, layout.id)}
                                      className="absolute cursor-grab active:cursor-grabbing select-none group"
                                      style={{
                                        left: `${l0}px`,
                                        top: `${t0}px`,
                                        width: `${cellWidth}px`,
                                        height: `${cellHeight}px`,
                                        padding: `${gap / 2}px`,
                                        transition: layoutTransition,
                                        zIndex: (isThisLayoutSelected && (isDragOver || touchDragOverIndex === idx || hoveredSwapTargetIndex === idx))
                                          ? 4
                                          : (isThisLayoutSelected && (draggedIndex === idx || touchDraggedIndex === idx))
                                            ? 3
                                            : isSelected
                                              ? 2
                                              : 1,
                                      }}
                                    >
                                      <div
                                        id={`cell-container-${idx}`}
                                        onPointerDown={(e) => {
                                          handleSwitchPage(pageIdx);
                                          handleContentPointerDown(e, idx);
                                        }}
                                        onPointerMove={handleContentPointerMove}
                                        onPointerUp={handleContentPointerUp}
                                        onPointerCancel={handleContentPointerUp}
                                        className={`relative w-full h-full overflow-hidden ${
                                          isSelected ? 'z-20' : ''
                                        }`}
                                        style={{
                                          backgroundColor: '#121212',
                                          // 這一格自己設了圓角就蓋掉佈局那根共用滑桿
                                          borderRadius: cell.imgRadius
                                            ? `${cornerR(cell.imgRadius, cellWidth, cellHeight)}px`
                                            : `${radius}px`,
                                          touchAction: 'none',
                                        }}
                                      >
                                        {(() => {
                                          const photoStyle: React.CSSProperties = {
                                            position: 'absolute',
                                            left: '50%',
                                            top: '50%',
                                            width: `${layoutW}px`,
                                            height: `${layoutH}px`,
                                            maxWidth: 'none',
                                            maxHeight: 'none',
                                            transformOrigin: 'center center',
                                            transform: `translate(-50%, -50%) translate(${cell.offsetX * rawW + fixX}px, ${cell.offsetY * rawH + fixY}px) rotate(${cell.rotation}deg) scale(${cssScale})`,
                                            transition: imageTransition,
                                            opacity: 1,
                                            pointerEvents: 'none',
                                          };
                                          return hasPhotoFx(cell.fx)
                                            ? (
                                              <CellFxImage
                                                url={cell.url}
                                                fx={cell.fx!}
                                                style={photoStyle}
                                                lutRevision={lutRevision}
                                                boxW={cellWidth}
                                                boxH={cellHeight}
                                              />
                                            )
                                            : <img src={cell.url} alt="cell" style={photoStyle} />;
                                        })()}

                                        {/* Thin solid outline on top of the image */}
                                        {isSelected && draggedIndex === null && touchDraggedIndex === null && (
                                          <div 
                                            className="absolute inset-0 pointer-events-none z-30 border-[0.75px] border-solid border-white/90"
                                            style={{
                                              borderRadius: `${radius}px`,
                                              transform: 'translateZ(0)',
                                              WebkitMaskImage: '-webkit-radial-gradient(white, black)'
                                            }}
                                          />
                                        )}

                                        {/* Drag Over Highlight Overlay - Simplified with React state */}
                                        {(() => {
                                          const isFloatSwapOver = swapOver?.kind === 'cell' && swapOver.idx === idx && swapOver.layoutId === layout.id;
                                          return (
                                        <div
                                          className={`absolute inset-0 bg-black/60 z-30 pointer-events-none ${
                                            (isThisLayoutSelected && !wholeLayoutSelected && (touchDragOverIndex === idx || isDragOver || hoveredSwapTargetIndex === idx)) || isFloatSwapOver ? 'border-[0.75px] border-solid border-white/90' : 'border-0'
                                          }`}
                                          style={{
                                            borderRadius: `${radius}px`,
                                            opacity: (isThisLayoutSelected && !wholeLayoutSelected && (isDragOver || hoveredSwapTargetIndex === idx || touchDraggedIndex === idx || touchDragOverIndex === idx)) || isFloatSwapOver ? 1 : 0
                                          }}
                                        />
                                          );
                                        })()}
                                      </div>
                                      {isSelected && draggedIndex === null && touchDraggedIndex === null && (
                                        /* 這排鍵本來壓在格子裡面（bottom-2），正好蓋住剛選中的那張照片。
                                           改成掛在格子**外面的下方** —— 跟整組佈局被選中時那排鍵同一種做法。
                                           貼著頁面下緣的那一列格子放不下，就翻到格子上方，不會被裁掉。 */
                                        <div className="absolute left-1/2 flex items-center gap-1 z-[60] bg-white backdrop-blur-md rounded-full p-1 shadow-xl pointer-events-auto"
                                             style={lTop + t0 + cellHeight + 46 > previewH
                                               ? { bottom: '100%', marginBottom: 8, transform: 'translate(-50%, 0)' }
                                               : { top: '100%', marginTop: 8, transform: 'translate(-50%, 0)' }}
                                             onPointerDown={(e) => e.stopPropagation()}
                                             onTouchStart={(e) => e.stopPropagation()}
                                        >
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteCellImage(idx);
                                              setSelectedIndex(null);
                                            }}
                                            className="text-black hover:text-neutral-400 p-1.5 rounded-full transition-colors flex items-center justify-center"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSlotToUpload(idx);
                                              replaceInputRef.current?.click();
                                            }}
                                            className="text-black hover:text-neutral-400 p-1.5 rounded-full transition-colors flex items-center justify-center"
                                          >
                                            <RefreshCw size={14} />
                                          </button>
                                          {/* 跟浮動圖片同一顆「圖片調整」，進的是同一個編輯面板 */}
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setActiveTab('adjust'); }}
                                            title="圖片調整"
                                            className="text-black hover:text-neutral-400 p-1.5 rounded-full transition-colors flex items-center justify-center"
                                          >
                                            <Sliders size={14} />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                });
                              })()}

                              {isThisLayoutSelected && selectedIndex === null && (() => {
                                const dot = 'absolute w-3.5 h-3.5 rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.5)] z-[60] pointer-events-auto touch-none';
                                /* 整組佈局放大到超出畫布時，四個角跟按鈕本來會被頁面容器的
                                   overflow-hidden 切掉 —— 抓不到角、也按不到刪除。
                                   跟一般圖片一樣：外框搬到不會被裁切的那一層去畫。 */
                                const mvChrome = pageContentShift(pageIdx);
                                const liftedChrome = !!mvChrome && mvChrome.s !== 1;
                                const corner = (key: 'tl' | 'tr' | 'bl' | 'br', pos: string, cursor: string) => (
                                  <div
                                    key={key}
                                    className={`${dot} ${pos} ${cursor}`}
                                    style={{ transform: 'translate(-50%, -50%)' }}
                                    onPointerDown={(e) => handleLayoutCornerDown(e, key)}
                                    onPointerMove={handleLayoutCornerMove}
                                    onPointerUp={handleLayoutCornerUp}
                                    onPointerCancel={handleLayoutCornerUp}
                                  />
                                );
                                const layoutChrome = (
                                  <>
                                    {/* 選取框跟一般圖片同款：細白線 + 陰影 */}
                                    <div
                                      className="absolute inset-0 pointer-events-none z-[55] border-solid border-white/95 shadow-[0_0_4px_rgba(0,0,0,0.3)]"
                                      style={{ borderWidth: 0.75 }}
                                    />
                                    {corner('tl', 'top-0 left-0', 'cursor-nwse-resize')}
                                    {corner('tr', 'top-0 left-full', 'cursor-nesw-resize')}
                                    {corner('bl', 'top-full left-0', 'cursor-nesw-resize')}
                                    {corner('br', 'top-full left-full', 'cursor-nwse-resize')}
                                    <div
                                      className="absolute left-1/2 flex items-center gap-0.5 bg-white rounded-full p-0.5 shadow-xl pointer-events-auto z-[60]"
                                      style={(previewH - lh) / 2 + (layout.t?.y || 0) + lh + 52 > previewH
                                        ? { bottom: '100%', marginBottom: 10, transform: 'translate(-50%, 0)', transformOrigin: 'bottom center' }
                                        : { top: '100%', marginTop: 10, transform: 'translate(-50%, 0)', transformOrigin: 'top center' }}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onTouchStart={(e) => e.stopPropagation()}
                                    >
                                      {/* 上下移動走跟照片、文字同一條圖層清單 */}
                                      {(() => {
                                        const pos = stackPos('layout', layout.id);
                                        const canDown = pos > 0;
                                        const canUp = pos >= 0 && pos < layerStack.length - 1;
                                        return (
                                          <>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); if (canDown) moveInStack('layout', layout.id, -1); }}
                                              disabled={!canDown}
                                              title="下移一層"
                                              className={`w-7 h-7 rounded-full flex items-center justify-center ${canDown ? 'text-black hover:bg-black/10' : 'text-black/25 cursor-default'}`}
                                            >
                                              <MoveDown size={14} />
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); if (canUp) moveInStack('layout', layout.id, 1); }}
                                              disabled={!canUp}
                                              title="上移一層"
                                              className={`w-7 h-7 rounded-full flex items-center justify-center ${canUp ? 'text-black hover:bg-black/10' : 'text-black/25 cursor-default'}`}
                                            >
                                              <MoveUp size={14} />
                                            </button>
                                          </>
                                        );
                                      })()}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setActiveTab('layout'); setLayoutSubTab('adjust'); }}
                                        title="佈局調整"
                                        className="w-7 h-7 rounded-full hover:bg-black/10 flex items-center justify-center text-black"
                                      >
                                        <Sliders size={14} />
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); handleDeleteLayout(); }} title="刪除佈局" className="w-7 h-7 rounded-full hover:bg-black/10 flex items-center justify-center text-black">
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </>
                                );

                                // 拿不到外框層就照原本的方式畫在佈局身上，行為完全不變
                                if (!chromeLayer) return layoutChrome;

                                return createPortal(
                                  /* 外面這層＝那一頁（含排頁面時整頁的位移與縮放，
                                     直接呼叫同一支 pageContentShift，不會跟頁面走散） */
                                  <div
                                    className="absolute pointer-events-none"
                                    style={{
                                      left: `${pageIdx * (previewW + 1)}px`,
                                      top: 0,
                                      width: `${previewW}px`,
                                      height: `${previewH}px`,
                                      transform: mvChrome
                                        ? `translateX(${mvChrome.dx}px)${liftedChrome ? ` scale(${mvChrome.s})` : ''}`
                                        : undefined,
                                      transformOrigin: 'center center',
                                      transition: mvChrome ? (mvChrome.live ? 'none' : 'transform 220ms cubic-bezier(0.2,0,0,1)') : undefined,
                                      zIndex: 100000 + (layout.z ?? 0) * 2 + 1,
                                    }}
                                  >
                                    {/* 裡面這層＝佈局自己的框。尺寸跟真正那個 wrapper 一模一樣，
                                        而且同樣掛著 data-layout-wrapper／data-layout-id ——
                                        拖角球是用 closest('[data-layout-wrapper]') 的中心當支點的，
                                        少了這兩個屬性就會抓不到支點、縮放整組失效。 */}
                                    <div
                                      data-layout-wrapper={pageIdx}
                                      data-layout-id={layout.id}
                                      className="absolute pointer-events-none"
                                      style={{
                                        left: `${lLeft}px`,
                                        top: `${lTop}px`,
                                        width: `${lw}px`,
                                        height: `${lh}px`,
                                        // 佈局轉了角度時，這層也要一起轉，
                                        // 不然選取框、角球、按鈕列會留在原地不跟著轉。
                                        ...((layout.t?.rot || 0) !== 0
                                          ? {
                                              transform: `rotate(${layout.t!.rot}deg)`,
                                              transformOrigin: 'center center',
                                            }
                                          : null),
                                      }}
                                    >
                                      {layoutChrome}
                                    </div>
                                  </div>,
                                  chromeLayer,
                                );
                              })()}
                              </div>
                              );
                            })}

                          </div>
                        </React.Fragment>
                      );
                    })}

                     {floatingImages.map((fImg, fIdx) => (
                      <FloatingImageComponent
                        key={fImg.id}
                        image={fImg}
                        isSelected={selectedFloatingId === fImg.id}
                        hasActiveGuidelines={activeGuidelines.length > 0}
                        stackIndex={fIdx}
                        // 選取框那一組改畫在不會被裁切的那一層
                        chromeLayer={chromeLayer}
                        touchMode="none"
                        hideToolbar={pinchFloatingId === fImg.id}
                        hideChrome={tuningEdge && selectedFloatingId === fImg.id}
                        // 排頁面拖曳時，圖層要跟著自己那一頁一起移動
                        dragShift={floatingDragShift(fImg)}
                        lutRevision={lutRevision}
                        toolbarAbove={(() => {
                          // 旋轉之後外接框會變高，要用轉過的高度判斷下面還有沒有位置
                          const rad = (fImg.rotation * Math.PI) / 180;
                          const halfSpan = (fImg.width * fImg.scale * Math.abs(Math.sin(rad))
                            + fImg.height * fImg.scale * Math.abs(Math.cos(rad))) / 2;
                          return fImg.y + fImg.height / 2 + halfSpan + 52 > previewH;
                        })()}
                        maxTextWidth={previewW}
                        isTextEditing={inlineEditId === fImg.id}
                        onTextEditEnd={() => setInlineEditId(prev => (prev === fImg.id ? null : prev))}
                        // 圖層上下是所有物件共用一條清單（照片、文字、佈局都算），
                        // 圖片才爬得到佈局上面
                        canLayerDown={stackPos('float', fImg.id) > 0}
                        canLayerUp={stackPos('float', fImg.id) < layerStack.length - 1}
                        onLayerAction={(action) => {
                          if (action === 'delete') {
                            setFloatingImages(prev => prev.filter(f => f.id !== fImg.id));
                            setSelectedFloatingId(null);
                            return;
                          }
                          if (action === 'edit') {
                            // 圖片與文字都進同一個「編輯」分頁，只是裡面長得不一樣
                            if (fImg.text !== undefined) {
                              setEditingTextId(fImg.id);
                              setInlineEditId(null);
                            }
                            setActiveTab('adjust');
                            return;
                          }
                          if (action === 'copy') {
                            handleDuplicateFloating(fImg.id);
                            return;
                          }
                          moveInStack('float', fImg.id, action === 'up' ? 1 : -1);
                        }}
                        isSwapTarget={swapOver?.kind === 'floating' && swapOver.id === fImg.id}
                        isSwapSource={floatDragSrc !== null && floatSwapRef.current?.id === fImg.id}
                        onSwapTouchStart={handleFloatSwapTouchStart(fImg)}
                        onSwapTouchMove={handleFloatSwapTouchMove}
                        onSwapTouchEnd={handleFloatSwapTouchEnd}
                        onSelect={() => { setSelectedFloatingId(fImg.id); setSelectedLayoutId(null); setSelectedIndex(null); }}
                        onChange={(updated) => {
                          setFloatingImages(prev => prev.map(item => item.id === fImg.id ? { ...item, ...updated } : item));
                        }}
                        onDelete={() => {
                          setFloatingImages(prev => prev.filter(item => item.id !== fImg.id));
                          if (selectedFloatingId === fImg.id) setSelectedFloatingId(null);
                        }}
                        pagesContainerRef={pagesContainerRef}
                        onDragStart={() => {}}
                        onDragMove={(rawX, rawY) => {
                          const { snappedX, snappedY, fitScale, guidelines } = applySnapping(
                            fImg.id,
                            rawX,
                            rawY,
                            fImg.width,
                            fImg.height,
                            fImg.scale,
                            undefined,
                            fImg.rotation || 0,
                          );
                          setActiveGuidelines(guidelines);
                          setFloatingImages(prev => prev.map(item => item.id === fImg.id
                            ? { ...item, x: snappedX, y: snappedY, ...(fitScale ? { scale: fitScale } : {}) }
                            : item));
                        }}
                        onDragEnd={() => {
                          setActiveGuidelines([]);
                        }}
                        onScaleStart={() => {}}
                        onScaleMove={(
                          newX,
                          newY,
                          newScale,
                          corner,
                          pivotContainerX,
                          pivotContainerY,
                          K_x,
                          K_y,
                          oppositeLocalX,
                          oppositeLocalY
                        ) => {
                          let finalScale = newScale;
                          let finalGuidelines: AlignmentGuideline[] = [];

                          if (
                            corner &&
                            pivotContainerX !== undefined &&
                            pivotContainerY !== undefined &&
                            K_x !== undefined &&
                            K_y !== undefined &&
                            oppositeLocalX !== undefined &&
                            oppositeLocalY !== undefined
                          ) {
                            const pageRects = pageRectsNear(
                              getAllPageRects(),
                              fImg.x + fImg.width / 2,
                            );
                            const SNAP_THRESHOLD = 4; // Snapping threshold reduced to 4px
                            
                            // Unsnapped position of the dragged corner
                            const rawCornerX = pivotContainerX + newScale * K_x;
                            const rawCornerY = pivotContainerY + newScale * K_y;

                            let minDiffX = SNAP_THRESHOLD;
                            let bestScaleX = newScale;
                            let bestGuidelineX: number | null = null;
                            let isPageBoundarySnapX = false;

                            let minDiffY = SNAP_THRESHOLD;
                            let bestScaleY = newScale;
                            let bestGuidelineY: number | null = null;
                            let isPageBoundarySnapY = false;

                            if (enableSnapping) {
                              pageRects.forEach(pageRect => {
                                // Vertical guidelines (left, right)
                              // Left edge
                              const diffLeft = rawCornerX - pageRect.left;
                              if (Math.abs(diffLeft) < SNAP_THRESHOLD && Math.abs(diffLeft) < Math.abs(minDiffX)) {
                                if (Math.abs(K_x) > 1e-5) {
                                  const s = (pageRect.left - pivotContainerX) / K_x;
                                  if (s > 0) {
                                    minDiffX = diffLeft;
                                    bestScaleX = s;
                                    bestGuidelineX = pageRect.left;
                                    isPageBoundarySnapX = true;
                                  }
                                }
                              }

                              // Right edge
                              const diffRight = rawCornerX - pageRect.right;
                              if (Math.abs(diffRight) < SNAP_THRESHOLD && Math.abs(diffRight) < Math.abs(minDiffX)) {
                                if (Math.abs(K_x) > 1e-5) {
                                  const s = (pageRect.right - pivotContainerX) / K_x;
                                  if (s > 0) {
                                    minDiffX = diffRight;
                                    bestScaleX = s;
                                    bestGuidelineX = pageRect.right;
                                    isPageBoundarySnapX = true;
                                  }
                                }
                              }

                              // Horizontal guidelines (top, bottom)
                              // Top edge
                              const diffTop = rawCornerY - pageRect.top;
                              if (Math.abs(diffTop) < SNAP_THRESHOLD && Math.abs(diffTop) < Math.abs(minDiffY)) {
                                if (Math.abs(K_y) > 1e-5) {
                                  const s = (pageRect.top - pivotContainerY) / K_y;
                                  if (s > 0) {
                                    minDiffY = diffTop;
                                    bestScaleY = s;
                                    bestGuidelineY = pageRect.top;
                                    isPageBoundarySnapY = true;
                                  }
                                }
                              }

                              // Bottom edge
                              const diffBottom = rawCornerY - pageRect.bottom;
                              if (Math.abs(diffBottom) < SNAP_THRESHOLD && Math.abs(diffBottom) < Math.abs(minDiffY)) {
                                if (Math.abs(K_y) > 1e-5) {
                                  const s = (pageRect.bottom - pivotContainerY) / K_y;
                                  if (s > 0) {
                                    minDiffY = diffBottom;
                                    bestScaleY = s;
                                    bestGuidelineY = pageRect.bottom;
                                    isPageBoundarySnapY = true;
                                  }
                                }
                              }
                            });
                            } // End of first enableSnapping

                            // Image-to-image edge snapping when scaling
                            if (enableSnapping) {
                              floatingImages.forEach(other => {
                                if (other.id === fImg.id) return; // Skip self

                                const otherW = other.width * other.scale;
                                const otherH = other.height * other.scale;
                              const otherCenterX = other.x + other.width / 2;
                              const otherCenterY = other.y + other.height / 2;
                              const otherLeft = otherCenterX - otherW / 2;
                              const otherRight = otherCenterX + otherW / 2;
                              const otherTop = otherCenterY - otherH / 2;
                              const otherBottom = otherCenterY + otherH / 2;

                              // Check vertical alignment with otherLeft
                              // If current corner is 'tr' or 'br' (Right edge), we align our Right edge to otherLeft.
                              // To bleed, we want to align to otherLeft + 1. Otherwise, no bleed (just otherLeft).
                              const targetLeft = (corner === 'tr' || corner === 'br') ? (otherLeft + 1) : otherLeft;
                              const diffLeft = rawCornerX - targetLeft;
                              if (Math.abs(diffLeft) < SNAP_THRESHOLD && Math.abs(diffLeft) < Math.abs(minDiffX)) {
                                if (Math.abs(K_x) > 1e-5) {
                                  const s = (targetLeft - pivotContainerX) / K_x;
                                  if (s > 0) {
                                    minDiffX = diffLeft;
                                    bestScaleX = s;
                                    bestGuidelineX = otherLeft;
                                    isPageBoundarySnapX = false; // prefer image snapping
                                  }
                                }
                              }

                              // Check vertical alignment with otherRight
                              // If current corner is 'tl' or 'bl' (Left edge), we align our Left edge to otherRight.
                              // To bleed, we want to align to otherRight - 1. Otherwise, no bleed (just otherRight).
                              const targetRight = (corner === 'tl' || corner === 'bl') ? (otherRight - 1) : otherRight;
                              const diffRight = rawCornerX - targetRight;
                              if (Math.abs(diffRight) < SNAP_THRESHOLD && Math.abs(diffRight) < Math.abs(minDiffX)) {
                                if (Math.abs(K_x) > 1e-5) {
                                  const s = (targetRight - pivotContainerX) / K_x;
                                  if (s > 0) {
                                    minDiffX = diffRight;
                                    bestScaleX = s;
                                    bestGuidelineX = otherRight;
                                    isPageBoundarySnapX = false; // prefer image snapping
                                  }
                                }
                              }

                              // Check horizontal alignment with otherTop
                              // If current corner is 'bl' or 'br' (Bottom edge), we align our Bottom edge to otherTop.
                              // To bleed, we want to align to otherTop + 1. Otherwise, no bleed (just otherTop).
                              const targetTop = (corner === 'bl' || corner === 'br') ? (otherTop + 1) : otherTop;
                              const diffTop = rawCornerY - targetTop;
                              if (Math.abs(diffTop) < SNAP_THRESHOLD && Math.abs(diffTop) < Math.abs(minDiffY)) {
                                if (Math.abs(K_y) > 1e-5) {
                                  const s = (targetTop - pivotContainerY) / K_y;
                                  if (s > 0) {
                                    minDiffY = diffTop;
                                    bestScaleY = s;
                                    bestGuidelineY = otherTop;
                                    isPageBoundarySnapY = false; // prefer image snapping
                                  }
                                }
                              }

                              // Check horizontal alignment with otherBottom
                              // If current corner is 'tl' or 'tr' (Top edge), we align our Top edge to otherBottom.
                              // To bleed, we want to align to otherBottom - 1. Otherwise, no bleed (just otherBottom).
                              const targetBottom = (corner === 'tl' || corner === 'tr') ? (otherBottom - 1) : otherBottom;
                              const diffBottom = rawCornerY - targetBottom;
                              if (Math.abs(diffBottom) < SNAP_THRESHOLD && Math.abs(diffBottom) < Math.abs(minDiffY)) {
                                if (Math.abs(K_y) > 1e-5) {
                                  const s = (targetBottom - pivotContainerY) / K_y;
                                  if (s > 0) {
                                    minDiffY = diffBottom;
                                    bestScaleY = s;
                                    bestGuidelineY = otherBottom;
                                    isPageBoundarySnapY = false; // prefer image snapping
                                  }
                                }
                              }
                            });
                            } // End of if (enableSnapping)

                            // Choose the stronger snap (the one with smaller diff)
                            const snapX = bestGuidelineX !== null;
                            const snapY = bestGuidelineY !== null;

                            if (snapX && snapY) {
                              /* 兩個軸都吸附得到時取「比較大」的倍率（＝覆蓋，而不是縮進去）。
                                 圖層框的長寬比跟頁面通常會差零點幾 px（匯入時取整造成），
                                 取小的那個等於留一條白縫在另一邊；取大的只是多蓋出去
                                 零點幾 px，而頁面本來就會裁掉超出的部分，所以四邊都不露白。
                                 這也是「由外而內沒縫、由內而外有縫」的成因 —— 以前是看
                                 哪一軸比較近就聽誰的，方向不同結果就不同。 */
                              if (bestScaleX >= bestScaleY) {
                                finalScale = bestScaleX;
                                finalGuidelines = [{ type: 'vertical', coord: bestGuidelineX! }];
                              } else {
                                finalScale = bestScaleY;
                                finalGuidelines = [{ type: 'horizontal', coord: bestGuidelineY! }];
                              }
                              /* 再多蓋出去半個像素。剛好貼齊時邊緣會落在非整數的像素上，
                                 抗鋸齒會把最外面那一列混成半透明，看起來就是一條髮絲白邊。
                                 頁面本身會裁掉超出的部分，所以多這半個像素完全看不到，
                                 卻能保證四邊都不露白。 */
                              /* 不再多蓋出去：使用者要的是「剛好貼齊」，
                                 多蓋的那一點在右邊／下面會看得出來凸出去。 */
                            } else if (snapX) {
                              finalScale = bestScaleX;
                              finalGuidelines = [{ type: 'vertical', coord: bestGuidelineX! }];
                            } else if (snapY) {
                              finalScale = bestScaleY;
                              finalGuidelines = [{ type: 'horizontal', coord: bestGuidelineY! }];
                            }

                            // Calculate the final (newX, newY) based on finalScale to keep pivot fixed
                            const R = (fImg.rotation * Math.PI) / 180;
                            const oppositeOffsetRotX = oppositeLocalX * Math.cos(R) - oppositeLocalY * Math.sin(R);
                            const oppositeOffsetRotY = oppositeLocalX * Math.sin(R) + oppositeLocalY * Math.cos(R);

                            const newCx = pivotContainerX - finalScale * oppositeOffsetRotX;
                            const newCy = pivotContainerY - finalScale * oppositeOffsetRotY;

                            const finalX = newCx - fImg.width / 2;
                            const finalY = newCy - fImg.height / 2;

                            setActiveGuidelines(finalGuidelines);
                            setFloatingImages(prev => prev.map(item => item.id === fImg.id ? { ...item, x: finalX, y: finalY, scale: finalScale } : item));
                          } else {
                            setFloatingImages(prev => prev.map(item => item.id === fImg.id ? { ...item, x: newX, y: newY, scale: newScale } : item));
                          }
                        }}
                        onScaleEnd={() => {
                          setActiveGuidelines([]);
                        }}
                      />
                    ))}

                    {/* 選取一張圖之後原本會蓋上一層 touch-action:none 的全畫布拖曳層，
                        「從任何地方都能拖」的代價是畫布完全不能左右滑。已移除 ——
                        要移動圖片直接拖那張圖即可，點空白處仍然是取消選取。 */}

                    {/* Alignment Guidelines Overlay */}
                    {(() => {
                      const rectsForLines = getAllPageRects();
                      const totalContainerWidth = pages.length * previewW + (pages.length - 1) * 1;
                      const totalContainerHeight = previewH;

                      return activeGuidelines.map((guideline, idx) => {
                        const isBottom = guideline.type === 'horizontal' && rectsForLines.some(rect => Math.abs(guideline.coord - rect.bottom) < 1);
                        const isRight = guideline.type === 'vertical' && rectsForLines.some(rect => Math.abs(guideline.coord - rect.right) < 1);
                        
                        // Check if the vertical guideline is on a left edge of a page next to a divider (i.e. pageIdx > 0)
                        const isLeftNearDivider = guideline.type === 'vertical' && rectsForLines.some(rect => rect.pageIdx > 0 && Math.abs(guideline.coord - rect.left) < 1);
                        
                        // Check if the vertical guideline is on a right edge of a page next to a divider (i.e. pageIdx < rectsForLines.length - 1)
                        const isRightNearDivider = guideline.type === 'vertical' && rectsForLines.some(rect => rect.pageIdx < rectsForLines.length - 1 && Math.abs(guideline.coord - rect.right) < 1);

                        let leftStyle = '0';
                        let topStyle = '0';
                        let widthStyle = '100%';
                        let heightStyle = '100%';

                        if (guideline.type === 'vertical') {
                          widthStyle = '2px';
                          if (guideline.coord <= 1) {
                            leftStyle = '0px';
                          } else if (guideline.coord >= totalContainerWidth - 1) {
                            leftStyle = `${totalContainerWidth - 2}px`;
                          } else {
                            leftStyle = `${guideline.coord - 1}px`;
                          }
                        } else {
                          heightStyle = '2px';
                          if (guideline.coord <= 1) {
                            topStyle = '0px';
                          } else if (guideline.coord >= totalContainerHeight - 1) {
                            topStyle = `${totalContainerHeight - 2}px`;
                          } else {
                            topStyle = `${guideline.coord - 1}px`;
                          }
                        }

                        return (
                          <div
                            key={idx}
                            className="absolute pointer-events-none z-[90] bg-blue-500"
                            style={{
                              left: leftStyle,
                              top: topStyle,
                              width: widthStyle,
                              height: heightStyle,
                            }}
                          />
                        );
                      });
                    })()}
                  </div>

                  {/*
                    外框層：選取框、四個角的圓球、那排按鈕都畫在這裡。

                    它跟上面那個頁面容器是兄弟、共用同一個父層，位置與大小也一模一樣
                    （父層的寬高就是整排頁面的寬高），所以座標完全不用換算 ——
                    子層原本怎麼擺，搬過來就還是擺在同一個地方。
                    差別只有一個：這一層不在 overflow-hidden 底下，
                    所以物件被拖出畫布時，框跟按鈕不會被邊緣的黑色切掉。

                    本身 pointer-events: none，只有圓球與按鈕自己開 —— 框裡面的空白處
                    仍然是穿透下去打到底下那個物件，拖曳手感一點都沒變。
                  */}
                  <div
                    ref={setChromeLayer}
                    className="absolute left-0 top-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 100000 }}
                  />

                </div>
                </div>

                {/* Plus Button to add more pages (Maximum 25 pages total, i.e., addedPagesCount < 24) */}
                {addedPagesCount < 24 && (
                  <button
                    ref={addPageBtnRef}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddedPagesCount(prev => prev + 1);
                    }}
                    className="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/25 flex items-center justify-center text-white transition-all ml-3 hover:scale-105 active:scale-95 cursor-pointer shadow-lg"
                    title="新增一頁"
                  >
                    <Plus size={20} />
                  </button>
                )}

                {/*
                  右邊的留白：剛好留到「最後一頁停在正中間」為止，多一分就會捲過頭
                  看到一大片黑。左邊的 margin 不算進捲動範圍，所以右邊要補一份
                  一樣的 stripOffset，再扣掉加號按鈕（ml-3 + 40）已經佔掉的部分。
                  寬度跟外殼一樣由 applyStripGeometry 每一帧寫。
                */}
                <div ref={stripPadRef} className="flex-shrink-0" />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Bottom Tabbed Controller */}
      {/* 高度所有分頁都一樣：切到圖片編輯時畫布不會突然變小。
          下限是編輯那組操作欄的實際高度（分頁列＋80＋96＋77），
          螢幕夠高就用 36dvh。 */}
      <footer
        className="bg-[#0a0a0a] border-t border-[#1a1a1a] flex flex-col z-[50] no-select shrink-0 transition-transform duration-300 ease-out"
        style={{ height: 'max(36dvh, 310px)' }}
      >
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Tabs list */}
          <div className="flex px-4 pt-1 border-b border-[#1a1a1a] shrink-0 overflow-x-auto overflow-y-hidden touch-pan-x no-scrollbar">
            {['ratio', 'pages', 'add', 'adjust', 'color'].map(id => {
              let iconEl = null;
              let titleText = '';
              if (id === 'ratio') {
                iconEl = <Crop size={18} />;
                titleText = '版型比例';
              } else if (id === 'add') {
                iconEl = <Plus size={18} />;
                titleText = '新增內容';
              } else if (id === 'adjust') {
                iconEl = <SlidersHorizontal size={18} />;
                titleText = '編輯';
              } else if (id === 'pages') {
                iconEl = <GalleryHorizontal size={18} />;
                titleText = '頁面順序';
              } else if (id === 'color') {
                iconEl = <Palette size={18} />;
                titleText = '背景顏色';
              }

              const isActive = activeTab === id || (id === 'add' && activeTab === 'layout');

              return (
                <button 
                  key={id} 
                  onClick={() => {
                    setActiveTab(id as any);
                    if (id === 'color') setColorPickerActive(true);
                  }} 
                  className={`flex-1 min-w-[70px] py-4 border-b-2 transition-all duration-150 flex flex-col items-center justify-center gap-1 ${
                    isActive ? 'text-white border-white scale-105' : 'text-[#444] border-transparent hover:text-[#777]'
                  }`}
                  title={titleText}
                >
                  {iconEl}
                </button>
              );
            })}
          </div>

          {/* Tabs Content */}
          <div className={`flex-1 no-scrollbar ${imageEditMode ? '' : 'p-4 pb-4'} ${['ratio', 'color', 'add', 'layout', 'adjust', 'pages'].includes(activeTab) ? 'overflow-hidden' : 'overflow-y-auto'}`}>

            {activeTab === 'adjust' && (() => {
              /* 佈局裡的格子也走同一套面板：把格子包成跟浮動圖片一樣的形狀，
                 面板本身完全不用改，寫回去的時候再導到格子上。 */
              const selCell = selectedFloatingId ? null
                : (selectedIndex !== null && selectedLayoutId
                    ? (activePage.layouts.find(l => l.id === selectedLayoutId)?.images[selectedIndex] || null)
                    : null);
              const layer = floatingImages.find(f => f.id === selectedFloatingId)
                || (selCell && selCell.url
                    ? ({ id: selCell.id, src: selCell.url, fx: selCell.fx } as unknown as FloatingImage)
                    : undefined);
              // 什麼都沒選：只給提示
              if (!layer) return (
                // 置中之後再稍微往上一點（pb 讓可用高度變矮，等於整段往上挪 12px）
                <div className="h-full flex items-center justify-center pb-6">
                  <p className="text-[11px] text-white/40 text-center">請先選中圖片或文字</p>
                </div>
              );

              // 選到文字：走文字那一套面板（同一個分頁、不同介面）
              if (layer.text !== undefined) {
                return (
                  <TextEditorPanel
                    layer={layer}
                    onChange={patch => patchTextLayer(layer.id, patch)}
                  />
                );
              }

              /* ── 選到圖片：跟「編輯」完全一樣的三段式操作欄 ───────────────
                 上：一根滑桿（5rem）／中：工具列（6rem）／下：分類列（h-16＋底部空隙） */
              const img = layer;
              const set = (patch: Partial<FloatingImage>) => {
                if (selCell) {
                  // 只有格子真的有的欄位才寫回去，其餘忽略
                  const cellPatch: Partial<ImageCell> = {};
                  if ('fx' in patch) cellPatch.fx = (patch as any).fx;
                  if (!Object.keys(cellPatch).length) return;
                  setImages(prev => prev.map((c, i) => (i === selectedIndex ? { ...c, ...cellPatch } : c)));
                  return;
                }
                setFloatingImages(prev => prev.map(f => (f.id === img.id ? { ...f, ...patch } : f)));
              };
              return (
                <ImageAdjustPanel
                  img={img} set={set} lutList={lutList}
                  loadingLut={loadingLut} setLoadingLut={setLoadingLut}
                  lutRevision={lutRevision} setLutRevision={setLutRevision}
                  adjustSub={adjustSub} setAdjustSub={setAdjustSub}
                  effectCard={effectCard} setEffectCard={setEffectCard}
                  effectDetail={effectDetail} setEffectDetail={setEffectDetail}
                  shapeMenu={shapeMenu} setShapeMenu={setShapeMenu}
                  shapeTool={shapeTool} setShapeTool={setShapeTool}
                  tuneTool={tuneTool} setTuneTool={setTuneTool}
                  setTuningEdge={setTuningEdge} openComposeFor={openComposeFor}
                  hideShape={!!selCell}
                />
              );
            })()}

            {activeTab === 'add' && (
              <div className="max-w-md mx-auto space-y-4 animate-in fade-in duration-300">
                <div className="flex justify-center gap-4 mt-6">
                  <button
                    onClick={() => {
                      setLayoutSubTab('layout');
                      setActiveTab('layout');
                    }}
                    className="flex flex-col items-center justify-center py-4 px-6 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    <Icon name="grid_view" className="text-[24px] text-white/80" />
                    <span className="text-[11px] font-bold tracking-widest text-white/90">新增佈局</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center py-4 px-6 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    <Icon name="add_photo_alternate" className="text-[24px] text-white/80" />
                    <span className="text-[11px] font-bold tracking-widest text-white/90">匯入照片</span>
                  </button>
                  <button
                    onClick={() => handleAddTextLayer()}
                    className="flex flex-col items-center justify-center py-4 px-6 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    {/* 跟文字編輯面板裡「字體」那一顆同一個圖示。
                        線寬調細對齊旁邊兩顆 Material 圖標；透明度改成掛在整個
                        圖示上（opacity-80）而不是筆畫顏色上（text-white/80）——
                        半透明的筆畫在交疊處會疊出更亮的一塊，看起來就是發白。 */}
                    <Type size={24} strokeWidth={1.5} className="text-white opacity-80" />
                    <span className="text-[11px] font-bold tracking-widest text-white/90">新增文字</span>
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'layout' && (
              <div className="max-w-md mx-auto h-full flex flex-row animate-in fade-in duration-300">
                {/* Left side: 2 small icon-only sub-buttons separated by a line directly connected from left edge to right border */}
                <div className="flex flex-col shrink-0 w-11 -mt-4 -mb-4 -ml-4 border-r border-white/10 select-none">
                  {/* Top half: Layout button */}
                  <button
                    onClick={() => setLayoutSubTab('layout')}
                    title="佈局"
                    aria-label="佈局"
                    className={`w-full flex-1 flex items-center justify-center transition-all ${
                      layoutSubTab === 'layout'
                        ? 'text-white'
                        : 'text-[#5a5a5a]'
                    }`}
                  >
                    <LayoutGrid size={18} className={`transition-transform ${layoutSubTab === 'layout' ? 'scale-110' : ''}`} />
                  </button>

                  {/* Divider line exactly in the middle connecting left wall to vertical border */}
                  <div className="w-full h-[1px] bg-white/10 shrink-0" />

                  {/* Bottom half: Adjust button */}
                  <button
                    onClick={() => setLayoutSubTab('adjust')}
                    title="調整"
                    aria-label="調整"
                    className={`w-full flex-1 flex items-center justify-center transition-all ${
                      layoutSubTab === 'adjust'
                        ? 'text-white'
                        : 'text-[#5a5a5a]'
                    }`}
                  >
                    <Sliders size={18} className={`transition-transform ${layoutSubTab === 'adjust' ? 'scale-110' : ''}`} />
                  </button>
                </div>

                {/* Right side content */}
                <div
                  className="flex-1 overflow-y-auto no-scrollbar pl-3 pr-1 h-full"
                  /* 到頂了再往上拉、到底了再往下拉都不要有那一下橡皮筋
                     （contain 只擋「把捲動傳給外層」，自己還是會彈，所以用 none） */
                  style={{ overscrollBehavior: 'none' }}
                >
                  {layoutSubTab === 'layout' ? (
                    allTemplatesFlattened.length > 0 ? (
                      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 pb-10">
                        {allTemplatesFlattened.map(({ count, idx, tmpl, isCurrentCount }) => {
                          // 只有「真的被選取」的佈局才算目前這個；沒選中就一律視為新增
                          const editing = selectedLayoutId ? activePage.layouts.find(l => l.id === selectedLayoutId) : null;
                          const isSelected = !!editing && isCurrentCount && editing.templateIndex === idx;
                          return (
                            <button
                              id={isSelected ? 'active-layout-button' : undefined}
                              key={`${count}-${idx}-${tmpl.name}`}
                              onClick={() => {
                                isLayoutChangeRef.current = true;
                                // 只有「完全沒選中佈局」時才會新增；有選中就是換掉那個佈局的版型
                                if (!editing) {
                                  handleAddLayoutToPage(activePageIndex, idx, count);
                                  return;
                                }
                                // 點別的版型 → 換掉目前選中的這個佈局
                                if (count !== images.length) {
                                  setImages(prev => {
                                    if (count > prev.length) {
                                      const newCells = Array.from({ length: count - prev.length }).map((_, i) => ({
                                        id: `empty-${Date.now()}-${i}`,
                                        url: '', file: undefined, zoom: 1.0, offsetX: 0, offsetY: 0, rotation: 0
                                      }));
                                      return [...prev, ...newCells];
                                    }
                                    return prev.slice(0, count);
                                  });
                                }
                                setTemplateIndex(idx);
                              }}
                              className={`p-1.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all text-center aspect-square ${
                                isSelected
                                  ? 'bg-white/[0.02] border-white shadow-[0_0_12px_rgba(255,255,255,0.05)] opacity-100'
                                  : 'bg-white/[0.02] border-white/5 hover:border-white/15 hover:bg-white/[0.04] ' + (isCurrentCount ? 'opacity-90' : 'opacity-40')
                              }`}
                              title={`${count}張: ${tmpl.name}`}
                            >
                              <svg viewBox="0 0 100 100" className="w-full h-full text-white/60">
                                {tmpl.rects.map((rect, rIdx) => (
                                  <rect
                                    key={rIdx}
                                    x={rect.x * 100 + 4}
                                    y={rect.y * 100 + 4}
                                    width={rect.w * 100 - 8}
                                    height={rect.h * 100 - 8}
                                    rx={4}
                                    fill="currentColor"
                                    fillOpacity="0.1"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    className="opacity-80"
                                  />
                                ))}
                              </svg>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-white/40 text-center py-4">
                        請先新增格子以選擇格局。
                      </div>
                    )
                  ) : !selectedLayoutId ? (
                    /* 沒選中佈局就不知道要調哪一個，滑桿整組不顯示 */
                    <div className="h-full flex items-center justify-center px-4">
                      <p className="text-[11px] font-bold tracking-[0.15em] text-white/40 text-center">
                        先點擊一下要調整的佈局
                      </p>
                    </div>
                  ) : (
                    /* Adjustment sliders - top aligned, smooth and stable without layout jitter */
                    <div className="space-y-4 pt-2.5 pb-24 px-1 max-w-xs">
                      {/* 這個佈局自己的比例。跟最左邊那一頁的「版型比例」是兩回事：
                          那邊調的是整張頁面，這裡只調選中的這一個佈局。
                          按鍵樣式跟那一頁同一套；直式／橫式不再包一層底色格子，
                          改成跟上面同一種 grid（同樣的 gap），
                          所以兩顆的左右外緣剛好對齊上面那排比例鍵。
                          再按一次同一顆比例就取消，回到「跟頁面一樣」。 */}
                      <div className="space-y-1.5">
                        {/* 這一排只放名稱。右邊本來會再寫一次目前的比例，
                            但下面那五顆按鈕自己就會反白標示，寫兩次是重複的。 */}
                        <div className="text-[11px] font-bold text-white/70">比例</div>
                        <div className="grid grid-cols-5 gap-1.5">
                          {RATIOS.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => {
                                if (selectedIndex !== null) setSelectedIndex(null);
                                patchLayoutShape({ ratio: layoutRatio === item.id ? undefined : item.id });
                              }}
                              className={`p-1 py-3 rounded-xl border text-center transition-all flex items-center justify-center ${
                                layoutRatio === item.id
                                  ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                                  : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                              }`}
                            >
                              <div className="text-xs font-mono tracking-wider">
                                {item.id === '1:1'
                                  ? '1:1'
                                  : layoutLandscape
                                    ? `${item.id.split(':')[1]}:${item.id.split(':')[0]}`
                                    : item.name}
                              </div>
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => { if (selectedIndex !== null) setSelectedIndex(null); patchLayoutShape({ landscape: false }); }}
                            className={`py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                              !layoutLandscape
                                ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                                : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                            }`}
                          >
                            <Smartphone size={14} className="rotate-0 shrink-0" />
                            <span>直式</span>
                          </button>
                          <button
                            onClick={() => { if (selectedIndex !== null) setSelectedIndex(null); patchLayoutShape({ landscape: true }); }}
                            className={`py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                              layoutLandscape
                                ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                                : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                            }`}
                          >
                            <Smartphone size={14} className="rotate-90 shrink-0" />
                            <span>橫式</span>
                          </button>
                        </div>
                      </div>

                      {/* Gap slider */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-bold text-white/70">
                          <span>間距</span>
                          <span className="font-mono text-white">{gap}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="25"
                          step="1"
                          value={gap}
                          onChange={(e) => {
                            if (selectedIndex !== null) setSelectedIndex(null);
                            setGap(parseInt(e.target.value));
                          }}
                          className="w-full accent-white bg-white/10 h-1.5 rounded-full cursor-pointer appearance-none"
                        />
                      </div>

                      {/* Radius slider */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-bold text-white/70">
                          <span>圓角</span>
                          <span className="font-mono text-white">{radius}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="30"
                          step="1"
                          value={radius}
                          onChange={(e) => {
                            if (selectedIndex !== null) setSelectedIndex(null);
                            setRadius(parseInt(e.target.value));
                          }}
                          className="w-full accent-white bg-white/10 h-1.5 rounded-full cursor-pointer appearance-none"
                        />
                      </div>

                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'ratio' && (
              <div className="max-w-md mx-auto space-y-4 animate-in fade-in duration-300">
                <div className="grid grid-cols-5 gap-1.5">
                  {RATIOS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedRatio(item.id)}
                      className={`p-1 py-3.5 rounded-xl border text-center transition-all flex items-center justify-center ${
                        selectedRatio === item.id
                          ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                          : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-mono tracking-wider">
                        {(() => {
                          if (item.id === '1:1') return '1:1';
                          if (isLandscape) {
                            const [w, h] = item.id.split(':');
                            return `${h}:${w}`;
                          }
                          return item.name;
                        })()}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between bg-white/[0.02] border border-white/5 p-1 rounded-xl gap-1">
                  <button
                    onClick={() => setIsLandscape(false)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      !isLandscape
                        ? 'bg-white text-black font-extrabold shadow-[0_2px_8px_rgba(255,255,255,0.1)]'
                        : 'text-white/50 hover:text-white'
                    }`}
                  >
                    <Smartphone size={14} className="rotate-0 shrink-0" />
                    <span>直式</span>
                  </button>
                  <button
                    onClick={() => setIsLandscape(true)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      isLandscape
                        ? 'bg-white text-black font-extrabold shadow-[0_2px_8px_rgba(255,255,255,0.1)]'
                        : 'text-white/50 hover:text-white'
                    }`}
                  >
                    <Smartphone size={14} className="rotate-90 shrink-0" />
                    <span>橫式</span>
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'color' && (
              <div className="max-w-md mx-auto animate-in fade-in duration-300 h-full">
                <ColorPickerEmbedded
                  color={bgColor}
                  onChange={setBgColor}
                  onClose={() => setActiveTab('layout')}
                />
              </div>
            )}


          </div>
        </div>
      </footer>

      {/* 頁面順序模式：每一頁正下方的握把與刪除鍵（貼在畫面上，不受畫布裁切影響） */}
      {pagesMode && pages.map((pg, ctlIdx) => {
        const dragging = pageDragIdx === ctlIdx;
        const ctl = { id: pg.id, idx: ctlIdx };
        // 拖曳的位移走 React、跟頁面內容同一次 render 寫出來：
        // 按鈕跟頁面才會「完完全全綁在一起」，不會一快一慢
        const shift = (() => {
          if (pageDragIdx !== null) {
            const off = pageDragOffset(ctl.idx);
            return { x: off.x * pagesScale, live: off.live, lift: off.live };
          }
          if (dragSettle && ctl.idx === dragSettle.page) {
            return { x: dragSettle.x * pagesScale, live: !dragSettle.ease, lift: false };
          }
          return null;
        })();
        return (
          <div
            key={`page-ctl-${ctl.id}`}
            ref={(el) => {
              if (el) pageCtlRefs.current.set(ctl.id, el);
              else pageCtlRefs.current.delete(ctl.id);
            }}
            // 外層位置每一帧由 rAF 貼著頁框寫（捲動、進出模式的動畫）
            className="fixed left-0 top-0 z-[46]"
            style={{ visibility: 'hidden' }}
          >
            <div
              className="flex items-center gap-1.5"
              style={{
                transform: shift
                  ? `translate(${shift.x}px, ${shift.lift ? (PAGE_DRAG_SCALE - 1) * pagesScale * previewH / 2 : 0}px)`
                  : undefined,
                transition: shift ? (shift.live ? 'none' : 'transform 220ms cubic-bezier(0.2,0,0,1)') : undefined,
              }}
            >
            <div
              title="拖曳調整順序"
              data-page-id={ctl.id}
              onPointerDown={(e) => handlePageDragStart(e, ctl.idx)}
              className={`w-9 h-[22px] rounded-full flex flex-col items-center justify-center gap-[3px] touch-none cursor-grab active:cursor-grabbing transition-colors shadow-lg ${
                dragging ? 'bg-white' : 'bg-white/15 hover:bg-white/25'
              }`}
            >
              <span className={`block w-4 h-[1.5px] rounded-full ${dragging ? 'bg-black' : 'bg-white/80'}`} />
              <span className={`block w-4 h-[1.5px] rounded-full ${dragging ? 'bg-black' : 'bg-white/80'}`} />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeletePage(ctl.idx); }}
              disabled={pages.length <= 1}
              title={`刪除第 ${ctl.idx + 1} 頁`}
              className="w-[22px] h-[22px] rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-all active:scale-90 disabled:opacity-25 shadow-lg"
            >
              <Trash2 size={11} />
            </button>
            </div>
          </div>
        );
      })}

      {/* IG 貼文預覽：照著 IG 動態上的版位做一次（滿版、不圓角），看發出去長怎樣 */}
      {/* IG 貼文預覽：整組抽到 components/IgPreview.tsx，兩個拼圖工具共用同一份 */}
      {igPreview && (
        <IgPreview
          shots={igShots}
          frame={{ w: previewW, h: previewH }}
          pageCount={pages.length}
          faces={igFaces}
          hasVideo={igPageHasVideo}
          supported={igPreviewSupported}
          onClose={() => setIgPreview(false)}
        />
      )}

      {/* Thumbnail following the finger while a free-standing image is long-press dragged */}
      {floatDragSrc && (
        <div
          id="float-drag-thumbnail"
          className="fixed pointer-events-none z-[9999] border-2 border-white/80 shadow-2xl overflow-hidden bg-neutral-900 flex items-center justify-center will-change-transform"
          style={{
            left: 0,
            top: 0,
            width: '80px',
            height: '80px',
            transform: `translate3d(${floatSwapRef.current?.startX || 0}px, ${floatSwapRef.current?.startY || 0}px, 0) translate(-50%, -50%) scale(1.1) rotate(4deg)`,
            borderRadius: '8px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}
        >
          <img src={floatDragSrc} alt="dragging" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Floating cell thumbnail following user's finger on mobile - Square design */}
      {touchDraggedIndex !== null && images[touchDraggedIndex]?.url && (
        <div
          id="mobile-drag-floating-thumbnail"
          className="fixed pointer-events-none z-[9999] border-2 border-white/80 shadow-2xl overflow-hidden bg-neutral-900 flex items-center justify-center will-change-transform"
          style={{
            left: 0,
            top: 0,
            width: '80px',
            height: '80px',
            transform: `translate3d(${touchDragState.current?.startX || 0}px, ${touchDragState.current?.startY || 0}px, 0) translate(-50%, -50%) scale(1.1) rotate(4deg)`,
            borderRadius: '8px', // Square design
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}
        >
          <img
            src={images[touchDraggedIndex].url}
            alt="dragging"
            className="w-full h-full object-cover"
            style={{
              transform: `rotate(${images[touchDraggedIndex].rotation || 0}deg)`
            }}
          />
        </div>
      )}
    </div>
  );
};
