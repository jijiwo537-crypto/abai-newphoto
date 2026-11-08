//
//  ABAICameraFx.swift
//  ABAI — 相機即時特效（柔光、朦朧、低保真）的原生版
//
//  網頁相機的特效是 components/Viewfinder.tsx 裡的 WebGL 著色器。原生相機的觀景窗、拍出來的照片
//  都在原生端畫，所以這裡用 Core Image 照同一組公式再做一次：
//    朦朧    模糊過的自己用（強度 × 0.625）蓋上去
//    柔光    先挑亮部（亮度超過 0.70 的部分 ×5）、在長邊 176 的小圖上模糊，再用濾色疊回去（強度 ×1.5）
//    低保真  色差（越外圈越明顯）＋ 低保真色彩表 80% ＋ 對比 ＋ 曝光 ＋ 依亮度調整的顆粒
//  跟網頁一樣在 sRGB 編碼值上計算，模糊範圍都按畫面大小等比例，觀景窗和拍出來的全解析度照片看起來一樣。
//

import Foundation
import CoreImage

struct ABAICameraFx: Equatable {
    var soft = 0.0, blur = 0.0, lowfi = 0.0
    var isOn: Bool { soft > 0.001 || blur > 0.001 || lowfi > 0.001 }

    init() {}
    init(_ d: [String: Any]?) {
        func v(_ k: String) -> Double { max(0, min(1, (d?[k] as? NSNumber)?.doubleValue ?? 0)) }
        soft = v("soft"); blur = v("blur"); lowfi = v("lowfi")
    }

    /* 低保真的固定參數（跟 utils/glEffects.ts 的預設值一致） */
    private static let lowfiFilter = 0.80, lowfiContrast = 10.0, lowfiExposure = 10.0
    private static let lowfiGrain = 50.0, lowfiAberration = 50.0, lowfiGrainDiv = 0.5 + 50 * 0.025

    private static let brightPass = CIColorKernel(source: """
    kernel vec4 abaiBright(__sample s, float th) {
        float l = dot(s.rgb, vec3(0.299, 0.587, 0.114));
        float a = clamp((l - th) * 5.0, 0.0, 1.0);
        return vec4(s.rgb * a, 1.0);
    }
    """)
    private static let screen = CIColorKernel(source: """
    kernel vec4 abaiScreen(__sample c, __sample g, float amt) {
        vec3 gl = clamp(g.rgb * amt, 0.0, 1.0);
        return vec4(1.0 - (1.0 - c.rgb) * (1.0 - gl), c.a);
    }
    """)
    private static let addDelta = CIColorKernel(source: """
    kernel vec4 abaiAddDelta(__sample c, __sample ab, __sample base, float amt) {
        return vec4(c.rgb + (ab.rgb - base.rgb) * amt, c.a);
    }
    """)
    private static let aberration = CIKernel(source: """
    kernel vec4 abaiAberration(sampler s, float strength, vec2 size) {
        vec2 p = destCoord();
        vec2 d = p / size - 0.5;
        vec2 sh = d * strength * (0.15 + dot(d, d) * 3.0) * size;
        vec4 b = sample(s, samplerTransform(s, p));
        float r = sample(s, samplerTransform(s, p + sh)).r;
        float bl = sample(s, samplerTransform(s, p - sh)).b;
        return vec4(r, b.g, bl, b.a);
    }
    """)
    private static let lowfiTone = CIColorKernel(source: """
    float abaiHash(vec2 p) {
        vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    kernel vec4 abaiLowfi(__sample c0, __sample lutc, __sample base, float filt, float contrast, float expo, float grain, float cell, float amt) {
        vec3 c = mix(c0.rgb, lutc.rgb, filt);
        c = ((c - 0.5) * (1.0 + contrast * 0.004) + 0.5) * exp2(expo * 0.008);
        float lum = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec2 cl = floor(destCoord() / cell);
        float mono = abaiHash(cl + 731.0) - 0.5;
        vec3 n = vec3(abaiHash(cl + 1949.0), abaiHash(cl + 2896.0), abaiHash(cl + 3843.0)) - 0.5;
        c += grain * 1.6 * (0.55 + 0.45 * (1.0 - lum)) * (mono * 0.55 + n * 0.85) / 255.0;
        c = clamp(c, 0.0, 1.0);
        return vec4(mix(c0.rgb, c, amt), c0.a);
    }
    """)

    private static let lowfiCube: ABAIImageCore.Cube? = ABAIImageCore.bundledLut("abai-lowfi.jpg").flatMap { ABAIImageCore.cube(fromAtlas: $0) }

    /// 縮小 → 模糊 → 放大回原尺寸（模糊範圍以「縮小後的像素」計）
    private static func blurred(_ img: CIImage, scale s: CGFloat, sigma: CGFloat, pre: ((CIImage) -> CIImage)? = nil) -> CIImage {
        let e = img.extent
        var small = img.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
            .transformed(by: CGAffineTransform(scaleX: s, y: s))
        if let pre = pre { small = pre(small) }
        let b = small.clampedToExtent().applyingGaussianBlur(sigma: Double(sigma)).cropped(to: small.extent)
        return b.transformed(by: CGAffineTransform(scaleX: 1 / s, y: 1 / s))
            .transformed(by: CGAffineTransform(translationX: e.minX, y: e.minY))
            .cropped(to: e)
    }

    /// 套在已經上好相機濾鏡的畫面上（觀景窗每一格、拍好的照片都走這裡）
    func apply(to input: CIImage) -> CIImage {
        guard isOn else { return input }
        let e = input.extent
        guard e.width > 1, e.height > 1 else { return input }
        /* 跟網頁一樣在 sRGB 編碼值上算 */
        let base = input.applyingFilter("CILinearToSRGBToneCurve")
        var c = base

        if blur > 0.001 {
            /* 網頁：1/4 邊長上模糊，半徑 0.6＋強度×3.2，強度高時兩輪；換算成「畫面寬度的比例」 */
            let r = 0.6 + blur * 3.2, passes = blur > 0.55 ? 2.0 : 1.0
            let sigmaFrac = r * 1.4 * passes.squareRoot() / 270.0
            let s = min(1, 360 / e.width)
            let bl = Self.blurred(base, scale: s, sigma: CGFloat(sigmaFrac) * e.width * s)
            if let f = CIFilter(name: "CIDissolveTransition") {
                f.setValue(c, forKey: kCIInputImageKey); f.setValue(bl, forKey: kCIInputTargetImageKey)
                f.setValue(blur * 0.625, forKey: kCIInputTimeKey)
                c = f.outputImage?.cropped(to: e) ?? c
            }
        }
        if lowfi > 0.001, let k = Self.aberration {
            let size = CIVector(x: e.width, y: e.height)
            let local = base.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
            if let ab = k.apply(extent: local.extent, roiCallback: { _, r in r.insetBy(dx: -64, dy: -64) },
                                arguments: [local.clampedToExtent(), Self.lowfiAberration * 0.00008, size])?
                .transformed(by: CGAffineTransform(translationX: e.minX, y: e.minY)),
               let added = Self.addDelta?.apply(extent: e, arguments: [c, ab, base, lowfi]) {
                c = added
            }
        }
        if soft > 0.001, let bp = Self.brightPass {
            /* 光暈固定在長邊 176 的小圖上算（跟網頁一樣，擴散範圍不隨解析度改變） */
            let s = 176 / max(e.width, e.height)
            let glow = Self.blurred(base, scale: s, sigma: 4.5) { bp.apply(extent: $0.extent, arguments: [$0, 0.70]) ?? $0 }
            if let out = Self.screen?.apply(extent: e, arguments: [c, glow, min(1, soft * 1.5)]) { c = out }
        }
        if lowfi > 0.001, let tone = Self.lowfiTone {
            let lut = Self.lowfiCube.map { cube -> CIImage in
                /* 色彩表本身是在 sRGB 值上查的；這裡的 c 已經是 sRGB 值，先轉回線性交給 CIColorCubeWithColorSpace */
                ABAIImageCore.apply(cube: cube, to: c.applyingFilter("CISRGBToneCurveToLinear")).applyingFilter("CILinearToSRGBToneCurve")
            } ?? c
            let cell = e.width / 1200 * Self.lowfiGrainDiv
            if let out = tone.apply(extent: e, arguments: [c, lut, base, Self.lowfiFilter, Self.lowfiContrast, Self.lowfiExposure,
                                                           Self.lowfiGrain, cell, lowfi]) { c = out }
        }
        return c.cropped(to: e).applyingFilter("CISRGBToneCurveToLinear")
    }
}
