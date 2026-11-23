//
//  ABAIRawDevelop.swift
//  ABAI — 專業的 RAW 沖洗（底片模式拍的 ProRAW、匯入的 RAW）
//
//  為什麼之前不專業：每改一次就把 RAW 解成 8 位元 JPEG，再在 JPEG 上調 —— 寬容度在第一步就丟光了。
//  現在整條都在「場景線性、延伸範圍的 Display P3、16 位元浮點」上做，最後一步才印成看得到的範圍：
//
//   ① RAW 解碼（CIRAWFilter）：
//      曝光：在感光元件的線性資料上乘（跟當下真的多開／少開光圈一樣），亮部從 RAW 的餘裕裡救回來，
//            extendedDynamicRangeAmount 讓超過白的亮部保留下來，不在這一步被切掉。
//      色溫、色調：在相機原生的色彩空間裡做白平衡（相機的色彩矩陣之前），不是在成品上加黃加藍 ——
//            所以拉很極端也不會「死黃」「死藍」。
//   ② 光線（在亮度的「格數」上調，三個通道等比例縮放 → 色相不變）：
//      對比（以中灰為支點）、高光、陰影、白色（白點）、黑色（黑點）
//   ③ 色彩：自然飽和度（越不飽和的顏色加越多、膚色附近少一點）、飽和度
//   ④ 印出來：超過白的部分用肩部柔柔地收、超出色域的往同亮度的灰拉 —— 色相永遠保住
//   ⑤ 曲線（RGB 總曲線＋紅綠藍各自）、HSL（八個色相各自的色相、飽和度、明度）
//   ⑥ 拍照當下的樣子：濾鏡、特效、比例裁切、小框、日期（只在輸出時）
//
//  即時預覽：RAW 那一步（①）只有曝光、色溫、色調改了才重算，結果存成一張螢幕大小的線性浮點小圖；
//  其他的調整都是在這張小圖上的 GPU 運算，拖滑桿時每一格都能重畫。
//

import Foundation
import CoreImage
import UIKit

struct ABAIRawParams: Equatable {
    var exposure = 0.0, temperature: Double? = nil, tint: Double? = nil
    var contrast = 0.0, highlights = 0.0, shadows = 0.0, whites = 0.0, blacks = 0.0
    var vibrance = 0.0, saturation = 0.0
    /// 八個色相（紅橙黃綠青藍紫洋紅）× [色相, 飽和度, 明度]，各 -1～1
    var hsl: [Double] = Array(repeating: 0, count: 24)
    /// 曲線：256 格 × RGB（已經把總曲線和各通道合在一起），nil＝直線
    var curve: [Float]? = nil

    init() {}
    init(_ d: [String: Any]?) {
        guard let d = d else { return }
        func n(_ k: String) -> Double { (d[k] as? NSNumber)?.doubleValue ?? 0 }
        exposure = n("exposure")
        temperature = (d["temperature"] as? NSNumber)?.doubleValue
        tint = (d["tint"] as? NSNumber)?.doubleValue
        contrast = n("contrast"); highlights = n("highlights"); shadows = n("shadows"); whites = n("whites"); blacks = n("blacks")
        vibrance = n("vibrance"); saturation = n("saturation")
        if let h = d["hsl"] as? [Any], h.count == 24 { hsl = h.map { ($0 as? NSNumber)?.doubleValue ?? 0 } }
        if let c = d["curve"] as? [Any], c.count == 768 { curve = c.map { Float(($0 as? NSNumber)?.doubleValue ?? 0) } }
    }
    var rawKey: String { "\(exposure)|\(temperature ?? -1)|\(tint ?? -999)" }
}

enum ABAIRawDevelop {

    // MARK: RAW 解碼

    static func rawFilter(_ url: URL, longSide: CGFloat?, draft: Bool) -> CIRAWFilter? {
        guard let f = CIRAWFilter(imageURL: url) else { return nil }
        f.isDraftModeEnabled = draft
        f.isGamutMappingEnabled = false          // 色域交給最後一步（保住色相的那一套）
        f.extendedDynamicRangeAmount = 1         // 超過白的亮部留著，曝光拉低時救得回來
        if let ls = longSide, f.nativeSize.width > 0 {
            f.scaleFactor = Float(min(1, ls / max(f.nativeSize.width, f.nativeSize.height)))
        }
        return f
    }

    static func applyRaw(_ f: CIRAWFilter, _ p: ABAIRawParams) -> CIImage? {
        f.exposure = Float(p.exposure)
        if let t = p.temperature { f.neutralTemperature = Float(max(1800, min(50000, t))) }
        if let t = p.tint { f.neutralTint = Float(max(-150, min(150, t))) }
        return f.outputImage
    }

    // MARK: 光線、色彩

    private static let toneKernel = CIColorKernel(source: """
    kernel vec4 abaiRawTone(__sample s, float contrast, float highlights, float shadows, float whites, float blacks, float vibrance, float saturation) {
        vec3 c = max(s.rgb, vec3(0.0));
        vec3 W = vec3(0.2290, 0.6917, 0.0793);
        float Y = max(dot(c, W), 1e-6);
        float e = log2(Y / 0.18);
        float e2 = e * (1.0 + contrast * 0.55);
        e2 += highlights * 1.6 * smoothstep(-0.5, 2.5, e);
        e2 += shadows * 1.6 * (1.0 - smoothstep(-4.5, 0.0, e));
        e2 += whites * 1.0 * smoothstep(1.0, 3.2, e);
        e2 += blacks * 1.4 * (1.0 - smoothstep(-7.0, -2.5, e));
        float Y2 = 0.18 * exp2(e2);
        vec3 o = c * (Y2 / Y);
        float Y3 = dot(o, W);
        float mx = max(max(o.r, o.g), o.b), mn = min(min(o.r, o.g), o.b);
        float sat = (mx - mn) / max(mx, 1e-6);
        float vib = vibrance * (1.0 - sat) * (vibrance > 0.0 ? 1.0 : 0.7);
        o = vec3(Y3) + (o - vec3(Y3)) * max(0.0, (1.0 + saturation)) * max(0.0, (1.0 + vib));
        return vec4(o, s.a);
    }
    """)

    /// 印出來：超出色域的往同亮度的灰拉（剛好進色域為止），超過白的整個顏色等比例柔收 —— 色相永遠保住
    private static let printKernel = CIColorKernel(source: """
    kernel vec4 abaiRawPrint(__sample s) {
        vec3 c = s.rgb;
        float l = max(dot(c, vec3(0.2290, 0.6917, 0.0793)), 0.0);
        float mn = min(min(c.r, c.g), c.b);
        if (mn < 0.0) { float k = l / max(l - mn, 1e-6); c = vec3(l) + (c - vec3(l)) * k; }
        float mx = max(max(c.r, c.g), c.b);
        float knee = 0.8;
        if (mx > knee) { float nm = knee + (1.0 - knee) * (1.0 - exp(-(mx - knee) / (1.0 - knee))); c *= nm / mx; }
        return vec4(max(c, vec3(0.0)), s.a);
    }
    """)

    // MARK: HSL（在 sRGB 編碼值的 HSV 上，八個色相之間平順地過渡）

    private static let hslKernel = CIColorKernel(source: """
    vec3 abaiRgb2Hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 abaiHsv2Rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }
    vec3 abaiBand(float h, vec3 a, vec3 b, float h0, float h1) {
        float t = clamp((h - h0) / (h1 - h0), 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);
        return mix(a, b, t);
    }
    kernel vec4 abaiRawHsl(__sample s, vec3 b0, vec3 b1, vec3 b2, vec3 b3, vec3 b4, vec3 b5, vec3 b6, vec3 b7) {
        vec3 hsv = abaiRgb2Hsv(clamp(s.rgb, 0.0, 1.0));
        float h = hsv.x * 360.0;
        vec3 a;
        if (h < 30.0) a = abaiBand(h, b0, b1, 0.0, 30.0);
        else if (h < 60.0) a = abaiBand(h, b1, b2, 30.0, 60.0);
        else if (h < 120.0) a = abaiBand(h, b2, b3, 60.0, 120.0);
        else if (h < 180.0) a = abaiBand(h, b3, b4, 120.0, 180.0);
        else if (h < 240.0) a = abaiBand(h, b4, b5, 180.0, 240.0);
        else if (h < 270.0) a = abaiBand(h, b5, b6, 240.0, 270.0);
        else if (h < 300.0) a = abaiBand(h, b6, b7, 270.0, 300.0);
        else a = abaiBand(h, b7, b0, 300.0, 360.0);
        float w = smoothstep(0.02, 0.25, hsv.y);
        hsv.x = fract(hsv.x + a.x * w * 30.0 / 360.0 + 1.0);
        hsv.y = clamp(hsv.y * (1.0 + a.y * w), 0.0, 1.0);
        hsv.z = clamp(hsv.z * (1.0 + a.z * w * 0.45), 0.0, 1.0);
        return vec4(abaiHsv2Rgb(hsv), s.a);
    }
    """)

    // MARK: 整條

    /// 從 RAW 解出來的線性圖（①之後）往下做 ②～⑤
    static func finish(_ linear: CIImage, _ p: ABAIRawParams) -> CIImage {
        let e = linear.extent
        var img = linear
        if let k = toneKernel {
            img = k.apply(extent: e, arguments: [img, p.contrast, p.highlights, p.shadows, p.whites, p.blacks, p.vibrance, p.saturation]) ?? img
        }
        if let k = printKernel { img = k.apply(extent: e, arguments: [img]) ?? img }
        if let curve = p.curve, let f = CIFilter(name: "CIColorCurves") {
            let data = curve.withUnsafeBufferPointer { Data(buffer: $0) }
            f.setValue(img, forKey: kCIInputImageKey)
            f.setValue(data, forKey: "inputCurvesData")
            f.setValue(CIVector(x: 0, y: 1), forKey: "inputCurvesDomain")
            f.setValue(ABAIImageCore.sRGB, forKey: "inputColorSpace")
            img = f.outputImage?.cropped(to: e) ?? img
        }
        if p.hsl.contains(where: { abs($0) > 0.001 }), let k = hslKernel {
            let b = (0..<8).map { i in CIVector(x: CGFloat(p.hsl[i * 3]), y: CGFloat(p.hsl[i * 3 + 1]), z: CGFloat(p.hsl[i * 3 + 2])) }
            let enc = img.applyingFilter("CILinearToSRGBToneCurve")
            if let out = k.apply(extent: e, arguments: ([enc] as [Any]) + b.map { $0 as Any }) { img = out.applyingFilter("CISRGBToneCurveToLinear") }
        }
        return img.cropped(to: e)
    }

    /// 拍照當下的樣子（⑥）：比例裁切、小框、色溫外的濾鏡、特效、日期
    static func applyLook(_ input: CIImage, look: [String: Any]?, withDate: Bool) -> CIImage {
        guard let look = look else { return input }
        var img = input
        let aspect = (look["aspect"] as? NSNumber)?.doubleValue ?? 0
        let zoom = max(1, (look["zoom"] as? NSNumber)?.doubleValue ?? 1)
        if aspect > 0 || zoom > 1.001 {
            var e = img.extent
            if aspect > 0 {
                if Double(e.width / e.height) > aspect { let w = e.height * CGFloat(aspect); e = CGRect(x: e.midX - w / 2, y: e.minY, width: w, height: e.height) }
                else { let h = e.width / CGFloat(aspect); e = CGRect(x: e.minX, y: e.midY - h / 2, width: e.width, height: h) }
            }
            if zoom > 1.001 { e = e.insetBy(dx: e.width * CGFloat(1 - 1 / zoom) / 2, dy: e.height * CGFloat(1 - 1 / zoom) / 2) }
            let r = e.integral
            img = img.cropped(to: r).transformed(by: CGAffineTransform(translationX: -r.minX, y: -r.minY))
        }
        if let name = look["lut"] as? String, !name.isEmpty, let u = ABAIImageCore.bundledLut(name), let cube = ABAIImageCore.cube(fromAtlas: u) {
            img = ABAIImageCore.apply(cube: cube, to: img, amount: (look["amount"] as? NSNumber)?.doubleValue ?? 1)
        }
        let fx = ABAICameraFx(look["fx"] as? [String: Any])
        if fx.isOn { img = fx.apply(to: img) }
        if withDate, let d = look["date"] as? String, !d.isEmpty { img = ABAIDateStamp.stampDate(d, on: img) }
        return img
    }
}

/// 一次沖洗（即時預覽）：RAW 那一步的結果快取成螢幕大小的線性浮點小圖，其他調整都在小圖上即時算
final class ABAIRawSession {
    let url: URL
    let look: [String: Any]?
    let view: ABAIMetalView
    private let queue = DispatchQueue(label: "abai.raw.session", qos: .userInteractive)
    private var filter: CIRAWFilter?
    private var proxy: CIImage?
    private var proxyKey = ""
    private var proxyDraft = true
    private var pending: (ABAIRawParams, Bool)?
    private var busy = false
    private let longSide: CGFloat
    /// 拍攝當下的白平衡（滑桿的中點）
    private(set) var asShotTemperature: Double = 5500
    private(set) var asShotTint: Double = 0

    init?(url: URL, look: [String: Any]?, view: ABAIMetalView, longSide: CGFloat) {
        self.url = url; self.look = look; self.view = view; self.longSide = longSide
        guard let f = ABAIRawDevelop.rawFilter(url, longSide: longSide, draft: true) else { return nil }
        filter = f
        asShotTemperature = Double(f.neutralTemperature)
        asShotTint = Double(f.neutralTint)
    }

    /// final：手指放開了 —— 用完整品質（非 draft）重算 RAW 那一步
    func update(_ p: ABAIRawParams, final: Bool) {
        queue.async {
            self.pending = (p, final)
            if self.busy { return }
            self.drain()
        }
    }

    private func drain() {
        guard let next = pending else { busy = false; return }
        let (p, final) = next
        pending = nil
        busy = true
        autoreleasepool {
            if proxy == nil || p.rawKey != proxyKey || (final && proxyDraft) {
                if final && proxyDraft { filter = ABAIRawDevelop.rawFilter(url, longSide: longSide, draft: false) ?? filter; proxyDraft = false }
                else if !final && !proxyDraft && p.rawKey != proxyKey { filter = ABAIRawDevelop.rawFilter(url, longSide: longSide, draft: true) ?? filter; proxyDraft = true }
                if let f = filter, let out = ABAIRawDevelop.applyRaw(f, p) {
                    /* 存成線性、延伸範圍的 16 位元浮點：超過白的亮部也留著 */
                    let ext = out.extent
                    if let cg = ABAIImageCore.context.createCGImage(out, from: ext, format: .RGBAh, colorSpace: ABAIImageCore.linearP3) {
                        proxy = CIImage(cgImage: cg)
                        proxyKey = p.rawKey
                    }
                }
            }
            if let base = proxy {
                let img = ABAIRawDevelop.applyLook(ABAIRawDevelop.finish(base, p), look: look, withDate: false)
                DispatchQueue.main.async { self.view.source = img }
            }
        }
        queue.async { self.drain() }
    }

    /// 原尺寸、完整品質輸出成 JPEG（含拍照當下的濾鏡、特效、裁切、日期）
    func export(_ p: ABAIRawParams) throws -> URL {
        guard let f = ABAIRawDevelop.rawFilter(url, longSide: nil, draft: false), let raw = ABAIRawDevelop.applyRaw(f, p) else {
            throw ABAIImageCore.CoreError.decode
        }
        let img = ABAIRawDevelop.applyLook(ABAIRawDevelop.finish(raw, p), look: look, withDate: true)
        let data = try ABAIImageCore.encode(ABAIImageCore.dither(img), format: .jpeg, quality: 0.95)
        let out = ABAIImageCore.newFileURL(ext: "jpg")
        try data.write(to: out)
        return out
    }
}
