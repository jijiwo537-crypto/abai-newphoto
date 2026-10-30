
import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react';
import { loadCameraLut, readyCameraLut } from '../utils/cameraLuts';
import {CAMERA_FX_ZERO, CAMERA_LOWFI_GLSL, CAMERA_HIGHLIGHT_FS, CAMERA_SPILL_STEP, type CameraFx} from '../utils/cameraEffects';
import {cameraPreviewGeometry} from '../utils/cameraPreview';
import {bindLowfiLut} from '../utils/lowfiLut';
import { createFaceSkinMask, type FaceSkinMask } from '../utils/faceSkin';

/** 拍照時可以即時看到的特效，跟編輯頁同款、數值都是 0–100 */
export type ViewfinderFx = CameraFx;
export const FX_ZERO = CAMERA_FX_ZERO;

interface ViewfinderProps {
  video: HTMLVideoElement | null;
  lutUrl: string;
  exposure: number;
  kelvin: number;
  isUserFacing: boolean;
  fx?: ViewfinderFx;
  /** 硬體變焦不夠時補上的數位變焦，1 = 不放大 */
  digitalZoom?: number;
  /** 這個比例最後的觀景窗大小（CSS px）。畫布照它配置，切換比例的動畫中不跟著每一格重配 */
  displayBox?: { w: number; h: number } | null;
  onClick?: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  /** 長按鎖定 AE/AF 用的 —— 直接掛在觀景窗的外框上 */
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
  /** 人臉磨皮（只作用在臉上的皮膚） */
  skinSmooth?: boolean;
}

const VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0, 1);
    v_texCoord = a_texCoord;
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_video;
uniform sampler2D u_coarse;    // 磨皮的大色塊層（1/4 尺寸模糊，只有臉的外框裡有算）
uniform sampler2D u_mask;      // 皮膚範圍遮罩（已柔邊）
uniform vec2 u_videoPx;        // 影像一個像素（貼圖座標）
uniform vec4 u_skinBox;        // 臉的外框（貼圖座標 x0, y0, x1, y1）
uniform bool u_useSkin;
uniform sampler2D u_lut;
uniform bool u_useLut;
uniform float u_exposure;
uniform float u_kelvin;
uniform bool u_isUserFacing;
uniform float u_zoom;
uniform vec2 u_crop;
uniform bool u_dither;
in vec2 v_texCoord;
out vec4 outColor;

/* 曝光與色溫在「線性光」裡算（跟真的相機與 Lightroom 同一種做法）：
   ① sRGB 解碼成線性 → ② 曝光 ×2^EV、色溫用 R／B 通道倍率（von Kries 式，
   亮度不變）→ ③ 超出範圍的亮部用平滑肩部收回，不再硬切成一片死白 → ④ 編回 sRGB。
   沒調任何東西時（EV 0、5000K）整條路徑是恆等，畫面跟以前相同（只多了看不見的抖色）。 */
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 toEncoded(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 kelvinGain(float kelvin) {
    float temp = (kelvin - 5000.0) / 5000.0;
    vec3 g = vec3(exp2(temp * 0.55), 1.0, exp2(-temp * 0.55));
    return g / dot(g, vec3(0.2126, 0.7152, 0.0722));
}
/* 肩部：低於 knee 完全不動；knee 以上把 [knee, peak] 平滑壓進 [knee, 1]。
   peak＝這次調整後可能出現的最大值，peak <= 1（沒有提亮）時就是恆等。
   斜率在 knee 處連續（=1），不會出現一條亮度斷層。 */
vec3 shoulder(vec3 x, float peak) {
    if (peak <= 1.0) return x;
    const float knee = 0.8;
    float s = (peak - 1.0) / ((peak - knee) * (1.0 - knee));
    vec3 over = max(x - knee, vec3(0.0));
    return mix(x, knee + over / (1.0 + over * s), step(vec3(knee), x));
}

/* 人臉磨皮（頻率分離）：畫面拆成三層：最細的紋理（毛孔、皮膚質感）、中間那層（痘印、斑、膚色不均）、最底的大色塊。
   只把中間那層壓平，細紋理照留；中間那層反差大的（輪廓、髮絲）是邊緣，不壓。
   只在遮罩（挖掉眼睛、眉毛、嘴唇）× 膚色判斷 裡做。直接在主畫面這一趟算（螢幕解析度），不另外多畫一張 */
vec3 skinSmooth(vec3 o, vec2 uv) {
    float m = texture(u_mask, uv).r;
    if (m < 0.003) return o;
    float Y = dot(o, vec3(0.299, 0.587, 0.114));
    float cb = (o.b - Y) * 0.564 + 0.5, cr = (o.r - Y) * 0.713 + 0.5;
    float skin = smoothstep(0.47, 0.54, cr) * (1.0 - smoothstep(0.69, 0.76, cr)) * smoothstep(0.24, 0.31, cb) * (1.0 - smoothstep(0.51, 0.58, cb));
    skin *= smoothstep(0.04, 0.18, Y);
    m *= mix(0.35, 1.0, skin);
    // 3×3 帳篷模糊只用四次取樣（半格位置，硬體雙線性一次平均四個像素）
    vec2 h = u_videoPx * 0.5;
    vec3 fine = (texture(u_video, uv + h).rgb + texture(u_video, uv - h).rgb
              + texture(u_video, uv + vec2(h.x, -h.y)).rgb + texture(u_video, uv + vec2(-h.x, h.y)).rgb) * 0.25;
    vec3 coarse = texture(u_coarse, uv).rgb;
    vec3 mid = fine - coarse;
    float keep = smoothstep(0.045, 0.14, length(mid));
    vec3 smoothed = coarse + mid * keep + (o - fine) * 0.9;
    return mix(o, smoothed, clamp(m, 0.0, 1.0) * 0.68);
}

void main() {
    vec2 tc = v_texCoord;
    if (u_isUserFacing) tc.x = 1.0 - tc.x;
    // 數位變焦：從中心往內裁一塊再放大（硬體變焦做不到的倍率才會用到）
    tc = (tc - 0.5) * u_crop / max(u_zoom, 0.0001) + 0.5;

    bool inSkin = u_useSkin && tc.x >= u_skinBox.x && tc.y >= u_skinBox.y && tc.x <= u_skinBox.z && tc.y <= u_skinBox.w;
    vec3 rgb = texture(u_video, tc).rgb;
    if (inSkin) rgb = skinSmooth(rgb, tc);

    // Manual Adjustments (linear light)
    vec3 gain = kelvinGain(u_kelvin) * exp2(u_exposure);
    vec3 lin = toLinear(clamp(rgb, 0.0, 1.0)) * gain;
    rgb = toEncoded(clamp(shoulder(lin, max(gain.r, max(gain.g, gain.b))), 0.0, 1.0));

    if (u_useLut) {
        float size = 64.0;
        float b = rgb.b * (size - 1.0);

        float z1 = floor(b);
        float z2 = ceil(b);

        vec2 q1;
        q1.y = floor(z1 / 8.0);
        q1.x = z1 - (q1.y * 8.0);

        vec2 q2;
        q2.y = floor(z2 / 8.0);
        q2.x = z2 - (q2.y * 8.0);

        vec2 p1;
        p1.x = (q1.x * size + 0.5 + rgb.r * (size - 1.0)) / 512.0;
        p1.y = (q1.y * size + 0.5 + rgb.g * (size - 1.0)) / 512.0;

        vec2 p2;
        p2.x = (q2.x * size + 0.5 + rgb.r * (size - 1.0)) / 512.0;
        p2.y = (q2.y * size + 0.5 + rgb.g * (size - 1.0)) / 512.0;

        vec3 c1 = texture(u_lut, p1).rgb;
        vec3 c2 = texture(u_lut, p2).rgb;

        rgb = mix(c1, c2, fract(b));
    }

    // ±½ 個 8-bit 階的抖色：漸層天空不出現色帶（肉眼看不到雜訊）。
    // Only on the final output; an intermediate effect target is dithered by the composite.
    if (u_dither) rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

/* 可分離的高斯模糊：橫一趟、直一趟。用線性取樣的九抽樣權重，
   一次只碰五個紋素就等於九抽樣的品質，手機上跑得動 60fps。 */
const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_step;      // 一個紋素的大小 × 方向
uniform float u_radius;   // 幾個紋素
uniform float u_brightTh; // >=0 時只取亮部（柔光用），<0 是一般模糊
uniform int u_mode;
uniform int u_box;
uniform sampler2D u_cut;
in vec2 v_texCoord;
out vec4 outColor;

/* 亮部萃取：跟編輯頁的柔光同一組係數 —— 超過門檻的部分 ×5 當強度。
   重點有兩個，缺一個就跟編輯頁對不起來：
   ① 先挑亮部、再模糊（不是先模糊再挑亮部），光暈才會從亮的地方往外散開；
   ② 顏色與遮罩分開走 —— 編輯頁的柔光是一張「RGB＝原色、A＝亮部強度」的
      圖層，RGB 與 A 各自模糊之後才相乘疊回去。先相乘再模糊的話，
      邊緣附近的顏色會偏向亮的那一側。 */
vec4 tap(vec2 uv) {
    vec4 c = texture(u_tex, uv);
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    if(u_mode==1){float cut=texture(u_cut,vec2(.5)).r;return vec4(c.rgb*smoothstep(cut-.004,cut+.004,lum),1.);}
    if(u_mode==2){float m=pow(clamp((lum-160./255.)/(95./255.),0.,1.),1.5);return vec4(vec3(m),1.);}
    if (u_brightTh < 0.0) return c;
    return vec4(c.rgb, clamp((lum - u_brightTh) * 5.0, 0.0, 1.0));
}

const float O1 = 1.3846153846;
const float O2 = 3.2307692308;
const float W0 = 0.2270270270;
const float W1 = 0.3162162162;
const float W2 = 0.0702702703;

void main() {
    if(u_box>0){vec4 s=vec4(0.);for(int i=-18;i<=18;i++){if(abs(i)<=u_box)s+=tap(v_texCoord+u_step*float(i));}outColor=s/float(u_box*2+1);return;}
    vec2 d1 = u_step * O1 * u_radius;
    vec2 d2 = u_step * O2 * u_radius;
    vec4 c = tap(v_texCoord) * W0;
    c += tap(v_texCoord + d1) * W1;
    c += tap(v_texCoord - d1) * W1;
    c += tap(v_texCoord + d2) * W2;
    c += tap(v_texCoord - d2) * W2;
    outColor = c;
}
`;

/* 合成：把清晰的那張跟模糊的那張疊起來。
   三種效果共用同一條模糊鏈，所以三個一起開也只多一次合成。 */
const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_blur;   // 一般模糊（朦朧用）
uniform sampler2D u_glow;   // 亮部模糊（柔光用）
uniform float u_soft;    // 0–1
uniform float u_blurAmt; // 0–1
uniform sampler2D u_spill;
uniform sampler2D u_narrow;
uniform sampler2D u_haloTex;
uniform float u_soft2;
uniform float u_halo;
uniform float u_lowfi;
uniform vec2 u_res;
uniform vec2 u_effectCrop;
in vec2 v_texCoord;
out vec4 outColor;
${CAMERA_LOWFI_GLSL}

void main() {
    /* 離屏畫布的原點在左下、螢幕在左上，所以讀回來要把 Y 翻回去，
       不然套上特效整張會上下顛倒。 */
    vec2 tc = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
    tc = (tc - .5) * u_effectCrop + .5;
    vec3 base = texture(u_scene, tc).rgb;
    vec3 bl   = texture(u_blur,  tc).rgb;

        /* 朦朧：跟編輯頁同一組係數 —— 模糊過的自己用 0.625 的不透明度蓋上去 */
    vec3 c = mix(base, bl, u_blurAmt * 0.625);
    vec2 sensorUV=tc;
    if(u_lowfi>0.){vec2 shift=lowfiShift(sensorUV);vec3 ab=vec3(texture(u_scene,tc+shift).r,base.g,texture(u_scene,tc-shift).b);c+=(ab-base)*u_lowfi;}

    /* 柔光：亮部圖層（RGB×A）用濾色疊回去，疊加量是強度 ×1.5。
       畫布的 globalAlpha 上限是 1，所以這裡也夾到 1，跟編輯頁一致。 */
    if (u_soft > 0.0) {
        vec4 g = texture(u_glow, tc);
        vec3 glow = g.rgb * g.a * clamp(u_soft * 1.5, 0.0, 1.0);
        c = 1.0 - (1.0 - c) * (1.0 - clamp(glow, 0.0, 1.0));
    }

    if(u_halo>0.){
      float lum=dot(base,vec3(.299,.587,.114));
      float m=min(1.,texture(u_haloTex,tc).r*(1.-lum)*u_halo*6.);
      vec3 tint=vec3(.63,.145,.07); // HSL 8°, 80%, 35%, same as editor
      c=1.-(1.-c)*(1.-tint*m);
    }
    if(u_soft2>0.){
      c=1.-(1.-c)*(1.-texture(u_spill,tc).rgb*u_soft2*.9);
      for(int i=-12;i<=12;i++){vec3 n=texture(u_narrow,tc+vec2(0.,float(i)*3./1200.)).rgb;c=1.-(1.-c)*(1.-n*u_soft2*.05);}
    }
    if(u_lowfi>0.)c=mix(c,lowfiColor(c,sensorUV,u_res,dot(base,vec3(.2126,.7152,.0722))),u_lowfi);
    c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/* ── 人臉磨皮（頻率分離，跟 Photoshop 修膚同一個做法）──────────────────
   畫面拆成三層：最細的紋理（毛孔、皮膚質感）、中間那層（痘印、斑、膚色不均）、最底的大色塊。
   只把中間那層壓平，細紋理照留 —— 所以是乾淨的皮膚，不是塑膠臉。
   中間那層裡反差大的（輪廓、髮絲、眼鏡邊）判定成邊緣，不壓。
   只在「臉的皮膚範圍」（找臉畫出來的遮罩，挖掉眼睛、眉毛、嘴唇）× 膚色判斷 裡做，其他地方一個像素都不動。
   座標一律用 gl_FragCoord（跟影像貼圖一一對應，不經過鏡像／裁切），主畫面那一趟再照常鏡像裁切。 */
const FS_SKIN_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_size;   // 輸出大小
uniform vec2 u_dir;    // 一步在來源貼圖上的位移（uv）
out vec4 outColor;
void main() {
    vec2 uv = gl_FragCoord.xy / u_size;
    vec3 acc = vec3(0.0); float wsum = 0.0;
    for (int i = -8; i <= 8; i++) {
        float x = float(i) / 3.0;          // 17 抽樣涵蓋 ±2.7σ
        float w = exp(-0.5 * x * x);
        acc += texture(u_tex, uv + u_dir * float(i)).rgb * w; wsum += w;
    }
    outColor = vec4(acc / wsum, 1.0);
}
`;

/** 朦朧的模糊在 1/4 邊長上算：肉眼看不出差別，但快 16 倍 */
const BLUR_DIV = 4;

/* 柔光的光暈固定在「長邊 176」的小圖上算，跟畫面多大無關 ——
   編輯頁的柔光也是先縮到 800px 再用固定半徑模糊，擴散範圍不隨解析度改變。
   下面這組數字是拿編輯頁「柔光 100／範圍 50／門檻 70」逐像素比對調出來的。 */
const GLOW_LONG = 176;
const GLOW_RADIUS = 1.6;
const GLOW_PASSES = 4;

export const Viewfinder = forwardRef(({ video, lutUrl, exposure, kelvin, isUserFacing, fx, digitalZoom, displayBox, onClick, onPointerDown, onPointerUp, onPointerCancel, skinSmooth }: ViewfinderProps, ref) => {
  /* 人臉磨皮：找臉在背景執行緒做。相機一打開、閒下來就先載好（不佔主執行緒），一按開關馬上有效果；
     關著的時候不送畫面、不算 */
  const skinOnRef = useRef(!!skinSmooth);
  skinOnRef.current = !!skinSmooth;
  const skinMaskRef = useRef<FaceSkinMask | null>(null);
  useEffect(() => {
    /* 只有打開磨皮才載入找臉的模型。以前相機一開就在背景先載：模型＋wasm 會吃掉上百 MB 記憶體、
       開頭幾秒佔滿 CPU，iPhone 上開關特效（要配置原尺寸暫存）就會卡一下 */
    if (!skinSmooth) return;
    let live = true;
    createFaceSkinMask().then(m => { if (live && m && !skinMaskRef.current) skinMaskRef.current = m; });
    return () => { live = false; };
  }, [skinSmooth]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewSizeRef=useRef({w:0,h:0});
  const displayBoxRef=useRef(displayBox);
  displayBoxRef.current=displayBox;
  /* 切換比例時的抖動：以前畫布跟著框的大小走，300ms 的動畫裡每一格框變一點、畫布就重配一次
     （重配＝清空重畫，內容的裁切也每格跳一下）。現在畫布固定是「整個感光元件的比例」，
     大小以這個比例最後的框為準（只在換比例的那一下重配一次），框裡看到哪一塊交給 CSS 的
     object-fit: cover —— 那跟拍照時從中間裁的方式完全一樣，動畫中每一格都是平順縮放。 */
  const previewTarget=(vw:number,vh:number,limit:number)=>{
    const box=displayBoxRef.current&&displayBoxRef.current.w>0&&displayBoxRef.current.h>0?displayBoxRef.current:previewSizeRef.current;
    if(!box.w||!box.h||!vw||!vh)return null;
    const sa=vw/vh;let cw=box.w,ch=box.h;
    if(cw/ch>sa)ch=cw/sa;else cw=ch*sa;
    return cameraPreviewGeometry(cw,ch,window.devicePixelRatio,vw,vh,limit);
  };
  /* 感光元件的比例（直式）。畫布在框裡的 CSS 大小用它算 */
  const [sensor,setSensor]=useState<{w:number;h:number}|null>(null);
  useEffect(()=>{
    if(!video)return;
    const read=()=>{if(video.videoWidth&&video.videoHeight)setSensor(s=>s&&s.w===video.videoWidth&&s.h===video.videoHeight?s:{w:video.videoWidth,h:video.videoHeight});};
    read();video.addEventListener('loadedmetadata',read);video.addEventListener('resize',read);
    return()=>{video.removeEventListener('loadedmetadata',read);video.removeEventListener('resize',read);};
  },[video]);
  /* 1:1 → 16:9 會抖一下：框同時「變窄又變高」，以前用 object-fit: cover，畫面的放大倍率是
     max(寬比, 高比) —— 動畫前半段由寬度決定（越縮越小）、後半段換成高度決定（越放越大），
     所以畫面先縮一下再放大。現在畫布自己有 CSS 大小＝「蓋滿最後那個框」的大小，置中，
     跟框用同一條曲線過渡：倍率從頭到尾單向變化，框只是負責裁切。 */
  const coverCss=(()=>{
    const box=displayBox;if(!box||!(box.w>0)||!(box.h>0)||!sensor)return null;
    const sa=sensor.w/sensor.h;let cw=box.w,ch=box.h;
    if(cw/ch>sa)ch=cw/sa;else cw=ch*sa;
    return{w:cw,h:ch};
  })();
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const measure=()=>{const r=canvas.getBoundingClientRect();previewSizeRef.current={w:r.width,h:r.height};};
    const observer=new ResizeObserver(measure);observer.observe(canvas);measure();
    return()=>observer.disconnect();
  },[]);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const blurProgRef = useRef<WebGLProgram | null>(null);
  const compProgRef = useRef<WebGLProgram | null>(null);
  const highlightProgRef = useRef<WebGLProgram | null>(null);
  const videoTexRef = useRef<WebGLTexture | null>(null);
  const lutTexRef = useRef<WebGLTexture | null>(null);
  const [lutLoaded, setLutLoaded] = useState(false);
  const [gpuEpoch, setGpuEpoch] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const lost = (event: Event) => event.preventDefault();
    const restored = () => setGpuEpoch(value => value + 1);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, []);

  /** 場景（調整＋濾鏡之後）與兩張乒乓用的模糊暫存 */
  const rtRef = useRef<{
    w: number; h: number; bw: number; bh: number;
    scene: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    ping: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    pong: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    blurOut: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    gw: number; gh: number;
    gPing: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    gPong: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    sw:number;sh:number;
    sPing: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    sPong: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    wide: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    narrow: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    halo: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    cut: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
  }>({ w: 0, h: 0, bw: 0, bh: 0, gw: 0, gh: 0, sw:0,sh:0,scene: null, ping: null, pong: null, blurOut: null, gPing: null, gPong: null,sPing:null,sPong:null,wide:null,narrow:null,halo:null,cut:null });

  /* 滑桿是每一幀都可能在動的，放進 effect 依賴會不停重建 render loop。
     用 ref 讓迴圈每一幀讀最新值，迴圈本身只建立一次。 */
  const skinBlurProgRef = useRef<WebGLProgram | null>(null);
  const skinRtRef = useRef<{ w: number; h: number; qw: number; qh: number; qa: { fb: WebGLFramebuffer; tex: WebGLTexture } | null; qb: { fb: WebGLFramebuffer; tex: WebGLTexture } | null }>({ w: 0, h: 0, qw: 0, qh: 0, qa: null, qb: null });
  const skinMaskTexRef = useRef<WebGLTexture | null>(null);
  const skinMaskVerRef = useRef(-1);
  const fxRef = useRef<ViewfinderFx>(fx || FX_ZERO);
  fxRef.current = fx || FX_ZERO;
  const zoomRef = useRef(1);
  zoomRef.current = digitalZoom && digitalZoom > 0 ? digitalZoom : 1;
  /* 讓「拍全解析度靜態照」也能走同一條管線 —— 一模一樣的著色器、
     一模一樣的參數，所以拍出來跟畫面上看到的完全一致。 */
  const drawRef = useRef<((src: TexImageSource, w: number, h: number, out: HTMLCanvasElement | null) => void) | null>(null);
  /** 拍靜態照時暫存預覽的畫布尺寸，拍完還原 */
  const stillSizeRef = useRef<{ w: number; h: number } | null>(null);
  /**
   * 全解析度靜態照與每幀預覽共用同一張 WebGL canvas。擷取期間若預覽迴圈
   * 又把 canvas 改回影片尺寸，Safari 會清空 drawing buffer；第一張偶爾還能
   * 存到，第二張就很容易只剩黑畫面。這個旗標讓兩條繪製路徑確實互斥。
   */
  const stillActiveRef = useRef(false);
  /* 曝光／色溫／濾鏡也一律走 ref。以前它們在 render loop 的依賴裡，
     滑桿每動一格（色溫是 50K 一格）就把整個迴圈拆掉重建一次，
     拉起來就是一頓一頓的。現在迴圈只建立一次，每一幀讀最新值。 */
  const paramRef = useRef({ exposure, kelvin, isUserFacing });
  paramRef.current = { exposure, kelvin, isUserFacing };

  useImperativeHandle(ref, () => ({
    isLutReady: () => !!glRef.current && !glRef.current.isContextLost()
      && (!lutUrl || (lutCacheRef.current.get(lutUrl) === lutTexRef.current && !!lutTexRef.current)),
    getCanvas: () => {
      const cv = canvasRef.current;
      /* 快門按下的當下先同步補畫最新一幀。這不只避免剛恢復尺寸時讀到
         被清空的 drawing buffer，也讓連拍第二張永遠不會沿用第一張的殘幀。 */
      if (cv && !stillActiveRef.current && video && video.readyState >= 2 && drawRef.current) {
        const w = video.videoWidth || cv.width;
        const h = video.videoHeight || cv.height;
        if (w && h && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
        drawRef.current(video, cv.width, cv.height, null);
      }
      return cv;
    },
    /** 快門取完全解析度的那一幀之後立刻縮回預覽尺寸並補畫。以前要等下一個
        animation frame 才縮回，全解析度的 drawing buffer（含 preserveDrawingBuffer
        的第二份與特效中間緩衝）會跟 2D 裁切畫布、JPEG 編碼同時佔著記憶體。 */
    restorePreview: () => {
      const cv = canvasRef.current, gl = glRef.current;
      if (!cv || !gl || stillActiveRef.current || !video || video.readyState < 2) return;
      const target = previewTarget(video.videoWidth, video.videoHeight, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
      if (!target) return;
      if (cv.width === target.w && cv.height === target.h) return;
      cv.width = target.w; cv.height = target.h;
      try { drawRef.current?.(video, cv.width, cv.height, null); } catch { /* next frame redraws */ }
    },
    /** GPU 能吃的最大貼圖邊長 —— 拍照時用來夾住靜態照的尺寸 */
    maxTextureSize: () => {
      const gl = glRef.current;
      try { return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) as number : 4096; } catch { return 4096; }
    },
    /**
     * 把一張全解析度的靜態影像走完同一條管線。
     *
     * 回傳的就是觀景窗那張畫布本身，不再另外複製一份 ——
     * 一張 4096×3072 的畫布大約 48MB，多留一份在手機上很容易直接爆掉
     * （那正是「拍完常常什麼都沒出來」的原因）。
     * 呼叫端把要的部分裁走之後，一定要呼叫 releaseStill() 把尺寸還原。
     */
    renderStill: (src: TexImageSource, w: number, h: number): HTMLCanvasElement | null => {
      const cv = canvasRef.current;
      if (!drawRef.current || !cv || !w || !h) return null;
      stillSizeRef.current = { w: cv.width, h: cv.height };
      stillActiveRef.current = true;
      cv.width = w; cv.height = h;
      drawRef.current(src, w, h, null);
      return cv;
    },
    /** 把畫布尺寸還原，並立刻補畫預覽；不能留一幀清空後的黑畫面。 */
    releaseStill: () => {
      const cv = canvasRef.current, prev = stillSizeRef.current;
      stillActiveRef.current = false;
      if (cv && prev) {
        cv.width = prev.w;
        cv.height = prev.h;
        stillSizeRef.current = null;
        if (video && video.readyState >= 2 && drawRef.current) {
          /* iOS 在 takePhoto 剛交還相機的極短時間內，video texture 偶爾仍不可讀。
             預覽迴圈下一幀會再補畫；這裡不能讓一次 GPU 例外阻斷快門解鎖。 */
          try { drawRef.current(video, prev.w, prev.h, null); } catch { /* next RAF retries */ }
        }
      }
    },
  }));

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
    if (!gl) return;
    glRef.current = gl;

    const createShader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))console.error('[camera shader]',gl.getShaderInfoLog(s));
      return s;
    };
    const link = (fs: string) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, createShader(gl.VERTEX_SHADER, VS_SOURCE));
      gl.attachShader(p, createShader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))console.error('[camera program]',gl.getProgramInfoLog(p));
      return p;
    };

    const prog = link(FS_SOURCE);
    progRef.current = prog;
    blurProgRef.current = link(FS_BLUR);
    skinBlurProgRef.current = link(FS_SKIN_BLUR);
    compProgRef.current = link(FS_COMPOSITE);
    highlightProgRef.current = link(CAMERA_HIGHLIGHT_FS);

    const pos = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const uvs = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    /* 三個程式的屬性位置各自獨立，所以每個都要各自綁一次。
       綁在同一個 VAO 上，換程式的時候不用重綁。 */
    const bind = (p: WebGLProgram) => {
      gl.useProgram(p);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const aPos = gl.getAttribLocation(p, 'a_position');
      if (aPos >= 0) { gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0); }
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      const aUv = gl.getAttribLocation(p, 'a_texCoord');
      if (aUv >= 0) { gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0); }
    };
    // 三個程式的屬性位置都是 0/1，所以綁一次就好；保險起見全部走一遍
    bind(prog); bind(blurProgRef.current); bind(compProgRef.current);bind(highlightProgRef.current);bind(skinBlurProgRef.current);

    videoTexRef.current = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexRef.current);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return () => {
      const rt = rtRef.current;
      for (const t of [rt.scene, rt.ping, rt.pong, rt.blurOut, rt.gPing, rt.gPong,rt.sPing,rt.sPong,rt.wide,rt.narrow,rt.halo,rt.cut]) {
        if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
      }
      rtRef.current = { w: 0, h: 0, bw: 0, bh: 0, gw: 0, gh: 0, sw:0,sh:0,scene: null, ping: null, pong: null, blurOut: null, gPing: null, gPong: null,sPing:null,sPong:null,wide:null,narrow:null,halo:null,cut:null };
      gl.deleteProgram(prog);
      for (const t of [skinRtRef.current.qa, skinRtRef.current.qb]) if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
      skinRtRef.current = { w: 0, h: 0, qw: 0, qh: 0, qa: null, qb: null };
      if (skinMaskTexRef.current) gl.deleteTexture(skinMaskTexRef.current);
      skinMaskTexRef.current = null; skinMaskVerRef.current = -1;
      if (skinBlurProgRef.current) gl.deleteProgram(skinBlurProgRef.current);
      if (blurProgRef.current) gl.deleteProgram(blurProgRef.current);
      if (compProgRef.current) gl.deleteProgram(compProgRef.current);
      if (highlightProgRef.current) gl.deleteProgram(highlightProgRef.current);
      gl.deleteTexture(videoTexRef.current);
      lutCacheRef.current.forEach(tex => gl.deleteTexture(tex));
      lutCacheRef.current.clear();
      lutTexRef.current = null;
      gl.deleteBuffer(buf);
      gl.deleteBuffer(uvBuf);
    };
  }, [gpuEpoch]);

  // Render Loop
  useEffect(() => {
    if (!glRef.current || !progRef.current) return;

    let rafId: number;
    const gl = glRef.current;
    const prog = progRef.current;

    const makeTarget = (w: number, h: number) => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fb, tex };
    };

    /** 只有真的要用特效時才配置這些暫存，沒開特效完全走原本那條路 */
    const ensureTargets = (w: number, h: number) => {
      const rt = rtRef.current;
      const bw = Math.max(1, Math.floor(w / BLUR_DIV));
      const bh = Math.max(1, Math.floor(h / BLUR_DIV));
      if (rt.scene && rt.w === w && rt.h === h) return rt;
      // 柔光的光暈自己一個固定大小的小格網，跟畫面解析度脫鉤
      const gk = Math.max(w, h) / GLOW_LONG;
      const gw = Math.max(2, Math.round(w / gk)), gh = Math.max(2, Math.round(h / gk));
      const sk=Math.max(w,h)/512,sw=Math.max(2,Math.round(w/sk)),sh=Math.max(2,Math.round(h/sk));
      for (const t of [rt.scene, rt.ping, rt.pong, rt.blurOut, rt.gPing, rt.gPong,rt.sPing,rt.sPong,rt.wide,rt.narrow,rt.halo,rt.cut]) {
        if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
      }
      const next = { w, h, bw, bh, gw, gh, scene: makeTarget(w, h), ping: makeTarget(bw, bh),
                     pong: makeTarget(bw, bh), blurOut: makeTarget(bw, bh),
                     gPing: makeTarget(gw, gh), gPong: makeTarget(gw, gh),sw,sh,
                     sPing:makeTarget(sw,sh),sPong:makeTarget(sw,sh),wide:makeTarget(sw,sh),narrow:makeTarget(sw,sh),halo:makeTarget(sw,sh),cut:makeTarget(1,1) };
      rtRef.current = next;
      return next;
    };

    /* 一幀的完整畫法。預覽跟「拍全解析度靜態照」共用這一段，
       所以拍下來的顏色、特效跟畫面上看到的一定一致。 */
    /* 著色器參數的位置每個程式只查一次。以前每一幀要查幾十次
       （getUniformLocation 在 iOS 上是同步的字串查表）。 */
    const uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
    const uloc = (p: WebGLProgram, name: string) => {
      let m = uniformCache.get(p); if (!m) { m = new Map(); uniformCache.set(p, m); }
      if (!m.has(name)) m.set(name, gl.getUniformLocation(p, name));
      return m.get(name)!;
    };
    /** 磨皮的大色塊層：縮小橫模糊 → 直模糊（只在臉的外框裡）。合成在主畫面那一趟。沒臉或還沒載好回 null */
    const skinPass = (w: number, h: number): WebGLTexture | null => {
      const mk = skinMaskRef.current, bp = skinBlurProgRef.current;
      if (!mk || !mk.faces || !bp) return null;
      if (!skinMaskTexRef.current) {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        skinMaskTexRef.current = t;
      }
      if (skinMaskVerRef.current !== mk.version) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, skinMaskTexRef.current);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mk.mask);
        skinMaskVerRef.current = mk.version;
      }
      let r = skinRtRef.current;
      // 大色塊層的模糊半徑跟著臉的大小走（約臉寬的 1.4%）。臉大（半徑大）時在 1/8 尺寸上算，像素少四倍；臉小用 1/4，免得取樣太粗而閃爍
      const sigmaPx = Math.max(4, Math.min(48, mk.faceFrac * w * 0.014));
      const prevDiv = r.qw ? Math.round(r.w / r.qw) : 4;
      const div = sigmaPx >= 18 ? 8 : sigmaPx < 14 ? 4 : (prevDiv === 8 ? 8 : 4);   // 中間留一段緩衝，臉大小在邊界附近不會一直換
      const qw = Math.max(2, Math.round(w / div)), qh = Math.max(2, Math.round(h / div));
      if (!r.qb || r.w !== w || r.h !== h || r.qw !== qw || r.qh !== qh) {
        for (const t of [r.qa, r.qb]) if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
        r = skinRtRef.current = { w, h, qw, qh, qa: makeTarget(qw, qh), qb: makeTarget(qw, qh) };
      }
      const step = Math.max(0.5, sigmaPx / div / 3);
      /* 只在臉的外框裡算（剪裁區）：其他地方主畫面直接讀原本的影像，所以這張貼圖框外是什麼都沒關係。
         花的力氣跟臉的大小成正比，不是整個相機畫面 */
      const [b0, b1, b2, b3] = mk.box;
      const scissorAt = (sw: number, sh: number, pad: number) => {
        const x = Math.max(0, Math.floor(b0 * sw) - pad), y = Math.max(0, Math.floor(b1 * sh) - pad);
        gl.scissor(x, y, Math.min(sw, Math.ceil(b2 * sw) + pad) - x, Math.min(sh, Math.ceil(b3 * sh) + pad) - y);
      };
      gl.enable(gl.SCISSOR_TEST);
      gl.useProgram(bp);
      gl.uniform1i(uloc(bp, 'u_tex'), 0);
      gl.uniform2f(uloc(bp, 'u_size'), qw, qh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexRef.current);
      gl.bindFramebuffer(gl.FRAMEBUFFER, r.qa!.fb); gl.viewport(0, 0, qw, qh);
      scissorAt(qw, qh, Math.ceil(step * 8) + 2);
      gl.uniform2f(uloc(bp, 'u_dir'), step / qw, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindTexture(gl.TEXTURE_2D, r.qa!.tex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, r.qb!.fb);
      gl.uniform2f(uloc(bp, 'u_dir'), 0, step / qh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.SCISSOR_TEST);
      gl.activeTexture(gl.TEXTURE0);
      return r.qb!.tex;
    };
    const draw = (source: TexImageSource, W: number, H: number) => {
      const f = fxRef.current;
      const input=source as any;
      const sourceW=input.videoWidth||input.naturalWidth||input.width||W;
      const sourceH=input.videoHeight||input.naturalHeight||input.height||H;
      const geometry=cameraPreviewGeometry(W,H,1,sourceW,sourceH);
      const cropX=geometry.cropX,cropY=geometry.cropY;
      const soft = (f.soft || 0) / 100, blurAmt = (f.blur || 0) / 100;
      const soft2=(f.soft2||0)/100,halo=(f.halo||0)/100,lowfi=(f.lowfi||0)/100;
      const anyFx = soft > 0 || blurAmt > 0 || soft2>0 || halo>0 || lowfi>0;
      // All effect passes share sensor coordinates; crop only the final screen pass.
      // This keeps highlight selection and blur extents identical to the captured still.
      const rt = anyFx ? ensureTargets(sourceW, sourceH) : null;

      // ---- 第一趟：影像 → 曝光／色溫／濾鏡 ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, anyFx ? rt!.scene!.fb : null);
      gl.viewport(0, 0, anyFx ? sourceW : W, anyFx ? sourceH : H);
      gl.useProgram(prog);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexRef.current);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as any);
      /* 人臉磨皮：畫面裡有臉才做；結果換掉這一格的影像貼圖，後面的曝光、濾鏡、特效照常疊上去 */
      const skinTex = skinOnRef.current ? skinPass(sourceW, sourceH) : null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, anyFx ? rt!.scene!.fb : null);
      gl.viewport(0, 0, anyFx ? sourceW : W, anyFx ? sourceH : H);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexRef.current);
      gl.uniform1i(uloc(prog, 'u_video'), 0);
      gl.uniform1i(uloc(prog, 'u_useSkin'), skinTex ? 1 : 0);
      if (skinTex) {
        const bx = skinMaskRef.current!.box;
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, skinTex);
        gl.uniform1i(uloc(prog, 'u_coarse'), 3);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, skinMaskTexRef.current);
        gl.uniform1i(uloc(prog, 'u_mask'), 2);
        gl.uniform2f(uloc(prog, 'u_videoPx'), 1 / sourceW, 1 / sourceH);
        gl.uniform4f(uloc(prog, 'u_skinBox'), bx[0], bx[1], bx[2], bx[3]);
        gl.activeTexture(gl.TEXTURE0);
      }

      const useLut = !!lutTexRef.current;
      gl.uniform1i(uloc(prog, 'u_useLut'), useLut ? 1 : 0);
      const pr = paramRef.current;
      gl.uniform1f(uloc(prog, 'u_exposure'), pr.exposure);
      gl.uniform1f(uloc(prog, 'u_kelvin'), pr.kelvin);
      gl.uniform1f(uloc(prog, 'u_zoom'), zoomRef.current);
      gl.uniform2f(uloc(prog,'u_crop'),anyFx ? 1 : cropX,anyFx ? 1 : cropY);
      gl.uniform1i(uloc(prog, 'u_isUserFacing'), pr.isUserFacing ? 1 : 0);
      gl.uniform1i(uloc(prog, 'u_dither'), anyFx ? 0 : 1);

      if (useLut) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTexRef.current);
        gl.uniform1i(uloc(prog, 'u_lut'), 1);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!anyFx) return;

      const bp = blurProgRef.current!, cp = compProgRef.current!;
      const { bw, bh, gw, gh, sw,sh,scene, ping, pong, blurOut, gPing, gPong,sPing,sPong,wide,narrow,halo:haloTarget,cut } = rt!;

      if(soft2>0){
        gl.useProgram(highlightProgRef.current);gl.bindFramebuffer(gl.FRAMEBUFFER,cut!.fb);gl.viewport(0,0,1,1);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,scene!.tex);
        gl.uniform1i(uloc(highlightProgRef.current!,'u_tex'),0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }

      gl.useProgram(bp);
      gl.viewport(0, 0, bw, bh);

      /** 走一趟模糊鏈（橫一趟、直一趟；強度大時兩輪），結果寫進指定的暫存。
          brightTh >= 0 就是「先挑亮部再模糊」，柔光用的 ——
          順序很重要：先挑亮部再模糊，光暈才會從亮的地方往外散開；
          反過來做的話暗部也會被算進去，整張變濁。
          兩種效果各有自己的輸出暫存，不會互相蓋掉。 */
      const chain = (radius: number, passes: number, brightTh: number,
                     W2: number, H2: number,
                     a: { fb: WebGLFramebuffer; tex: WebGLTexture },
                     b: { fb: WebGLFramebuffer; tex: WebGLTexture },
                     out: { fb: WebGLFramebuffer; tex: WebGLTexture },mode=0,box=0) => {
        gl.useProgram(bp);
        gl.viewport(0, 0, W2, H2);
        let srcTex: WebGLTexture = scene!.tex;
        for (let i = 0; i < passes; i++) {
          const last = i === passes - 1;
          gl.uniform1f(uloc(bp, 'u_radius'), radius);
          gl.uniform1i(uloc(bp,'u_mode'),i===0?mode:0);
          gl.uniform1i(uloc(bp,'u_box'),box);
          gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,cut!.tex);gl.uniform1i(uloc(bp,'u_cut'),3);
          // 亮部萃取只在第一趟做，之後就是單純的模糊
          gl.uniform1f(uloc(bp, 'u_brightTh'), i === 0 ? brightTh : -1);
          gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, srcTex);
          gl.uniform1i(uloc(bp, 'u_tex'), 0);
          gl.uniform2f(uloc(bp, 'u_step'), box?CAMERA_SPILL_STEP:1 / W2, 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          gl.uniform1f(uloc(bp, 'u_brightTh'), -1);
          gl.uniform1i(uloc(bp,'u_mode'),0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, last ? out.fb : b.fb);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, a.tex);
          gl.uniform2f(uloc(bp, 'u_step'), 0, box?CAMERA_SPILL_STEP:1 / H2);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          srcTex = last ? out.tex : b.tex;
        }
        return out.tex;
      };

      let blurTex: WebGLTexture = scene!.tex;
      let glowTex: WebGLTexture = scene!.tex;
      if (blurAmt > 0) {
        const st = blurAmt;
        blurTex = chain(0.6 + st * 3.2, st > 0.55 ? 2 : 1, -1, bw, bh, ping!, pong!, blurOut!);
      }
      if (soft > 0) {
        // 柔光固定用這一組（對齊編輯頁調出來的），跟強度無關；
        // 強度只影響最後疊上去的量，擴散範圍不變 —— 編輯頁也是這樣。
        glowTex = chain(GLOW_RADIUS, GLOW_PASSES, 0.70, gw, gh, gPing!, gPong!, gPong!);
      }
      if(soft2>0){chain(1,3,-1,sw,sh,sPing!,sPong!,wide!,1,18);chain(1,3,-1,sw,sh,sPing!,sPong!,narrow!,1,5);}
      if(halo>0)chain(Math.max(.2,sw*.08*.8553125*.30/2),2,-1,sw,sh,sPing!,sPong!,haloTarget!,2);

      // ---- 最後一趟：清晰 + 模糊 合成到畫面 ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(cp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene!.tex);
      gl.uniform1i(uloc(cp, 'u_scene'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurTex);
      gl.uniform1i(uloc(cp, 'u_blur'), 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, glowTex);
      gl.uniform1i(uloc(cp, 'u_glow'), 2);
      gl.uniform1f(uloc(cp, 'u_soft'), soft);
      gl.uniform1f(uloc(cp, 'u_blurAmt'), blurAmt);
      for(const [unit,name,target] of [[3,'u_spill',wide],[4,'u_narrow',narrow],[5,'u_haloTex',haloTarget]] as const){
        gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,target!.tex);gl.uniform1i(uloc(cp,name),unit);
      }
      gl.uniform1f(uloc(cp,'u_soft2'),soft2);gl.uniform1f(uloc(cp,'u_halo'),halo);gl.uniform1f(uloc(cp,'u_lowfi'),lowfi);
      gl.uniform2f(uloc(cp,'u_res'),sourceW,sourceH);
      gl.uniform2f(uloc(cp,'u_effectCrop'),cropX,cropY);
      if(lowfi>0)bindLowfiLut(gl,cp);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    /* 全解析度靜態照：畫布尺寸由 renderStill 負責設好與還原，
       這裡只管把那一幀畫出來。 */
    drawRef.current = (src, w, h) => {
      if (!canvasRef.current) return;
      draw(src, w, h);
    };

    const previewLimit=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
    /* 只在「真的有東西變了」時才畫：相機送來新影格（requestVideoFrameCallback），
       或曝光／色溫／效果／變焦／濾鏡／畫布尺寸改了。螢幕是 60–120Hz，串流只有
       30fps；以前每一個螢幕幀都重新上傳同一張影格、重跑所有效果，白白耗電發熱。
       不支援 rVFC 的瀏覽器維持每幀都畫。 */
    const rvfc = typeof (video as any)?.requestVideoFrameCallback === 'function';
    let newFrame = true, frameHandle = 0, lastState = '', lastLut: WebGLTexture | null = null;
    const onVideoFrame = () => { newFrame = true; frameHandle = (video as any).requestVideoFrameCallback(onVideoFrame); };
    if (rvfc) frameHandle = (video as any).requestVideoFrameCallback(onVideoFrame);
    let warmed = false, drawnFrames = 0;
    const tick = () => {
      if (!stillActiveRef.current && video && video.readyState >= 2) {
        const target=previewTarget(video.videoWidth,video.videoHeight,previewLimit)||{w:video.videoWidth,h:video.videoHeight};
        let resized = false;
        if (canvasRef.current && (canvasRef.current.width !== target.w || canvasRef.current.height !== target.h)) {
          canvasRef.current.width = target.w;
          canvasRef.current.height = target.h;
          resized = true;
        }
        const pr = paramRef.current;
        const state = `${pr.exposure}|${pr.kelvin}|${pr.isUserFacing}|${zoomRef.current}|${JSON.stringify(fxRef.current)}`;
        /* 磨皮開著：每一格新畫面找一次臉（在畫之前，遮罩跟這一格對得上） */
        const mk = skinOnRef.current ? skinMaskRef.current : null;
        // 遮罩回來不另外重畫：下一格影像畫的時候自然會用到（不然每秒畫兩倍的次數）
        let maskChanged = false;
        if (mk && (!rvfc || newFrame)) maskChanged = mk.update(video, performance.now()) && !rvfc;
        const skinState = skinOnRef.current ? `|skin${mk ? mk.faces : 'x'}` : '';
        if (!rvfc || newFrame || maskChanged || resized || state + skinState !== lastState || lastLut !== lutTexRef.current) {
          newFrame = false; lastState = state + skinState; lastLut = lutTexRef.current;
          draw(video, gl.canvas.width, gl.canvas.height);
          /* 預熱：相機穩定後（約半秒）把所有特效的暫存貼圖配好、每個著色器都真的畫過一次。
             iPhone 的著色器是第一次用到時才編譯，暫存也是第一次才配置 —— 以前就是這個讓「第一次開／關特效」卡一下。
             同一個工作裡接著再畫一次正常畫面，所以使用者看不到預熱那一格 */
          if (!warmed && ++drawnFrames > 15) {
            warmed = true;
            const saved = fxRef.current;
            try {
              fxRef.current = { ...saved, soft: 50, blur: 50, soft2: 50, halo: 50, lowfi: 50 };
              draw(video, gl.canvas.width, gl.canvas.height);
            } catch { /* 預熱失敗不影響正常畫面 */ }
            fxRef.current = saved;
            draw(video, gl.canvas.width, gl.canvas.height);
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    tick();
    return () => { cancelAnimationFrame(rafId); if (rvfc) (video as any).cancelVideoFrameCallback?.(frameHandle); drawRef.current = null; };
  }, [video, gpuEpoch]);

  // Handle LUT Loading
  /* 換濾鏡時會閃一下白（其實是閃「沒有濾鏡的原樣」），原因是一按下去就把
     現在這顆清掉，等新的圖檔載完中間那幾幀等於沒有濾鏡。
     改成：新的載好了才換過去，中間畫面維持前一顆。
     而且每顆只解碼一次，之後來回切換都是瞬間的。 */
  const lutCacheRef = useRef<Map<string, WebGLTexture>>(new Map());
  useEffect(() => {
    if (!glRef.current) return;
    if (!lutUrl) {                       // 「原始」要立刻生效，不能延遲
      lutTexRef.current = null;
      setLutLoaded(false);
      return;
    }

    const cached = lutCacheRef.current.get(lutUrl);
    if (cached) { lutTexRef.current = cached; setLutLoaded(true); return; }

    let cancelled = false;
    const upload = (img: HTMLImageElement) => {
      const gl = glRef.current;
      if (!gl || cancelled) return;
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const conversion = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, conversion);
      if (tex) lutCacheRef.current.set(lutUrl, tex);
      lutTexRef.current = tex;
      setLutLoaded(true);
      if (video && video.readyState >= 2 && canvasRef.current && drawRef.current) {
        drawRef.current(video, canvasRef.current.width, canvasRef.current.height, null);
      }
    };
    const ready = readyCameraLut(lutUrl);
    if (ready) upload(ready);
    else void loadCameraLut(lutUrl).then(upload).catch(error => console.error(error));
    return () => { cancelled = true; };
  }, [lutUrl, gpuEpoch]);

  return (
    <div className="w-full h-full relative overflow-hidden" onClick={onClick}
         onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
        <canvas ref={canvasRef} className={coverCss?'block absolute left-1/2 top-1/2':'w-full h-full block object-cover'} data-camera-viewfinder
          style={coverCss?{width:coverCss.w,height:coverCss.h,transform:'translate(-50%,-50%)',transition:'width 300ms cubic-bezier(0.2,0,0,1), height 300ms cubic-bezier(0.2,0,0,1)'}:undefined} />
    </div>
  );
});
