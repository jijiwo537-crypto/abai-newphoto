//
//  ABAIRawDevelop.swift
//  ABAI — 專業 RAW 沖洗（底片模式拍的 ProRAW、匯入的 RAW）
//
//  整條流程跟專業沖洗軟體（Lightroom／Capture One）同一個架構：場景線性 → 調整 → 最後才「印」成顯示的範圍。
//  全部在延伸範圍的線性 Display P3、16 位元浮點上做，中間不會有任何一步把亮部切掉或量化成 8 位元。
//
//   ① RAW 解碼（CIRAWFilter，系統的 RAW 引擎）
//      ‧ 起點是系統 RAW 引擎本身的成像（跟相簿裡那張一樣自然），亮部保留到 EDR 上限（extendedDynamicRangeAmount = 2），
//        所以曝光、高光往回拉時救得回來。
//      ‧ 曝光：在感光元件的線性資料上乘（等同拍的當下多開／少開光圈）。
//      ‧ 白平衡（色溫 K、色調）：照 DNG 規格在「相機原生色彩空間」裡做 ——
//        用相機兩組校正光源（例如 2850K、6500K）的色彩矩陣依色溫內插，再把中性點對到指定的色溫／色調。
//        這是固有色（物體本來的顏色）保得住的關鍵：調的是「光源」，不是在成品上整片加黃加藍。
//        膚色、綠葉、天空在不同色溫下還是對的顏色，灰色才會真的變中性；拉很極端也不會「死黃」「死藍」。
//      ‧ 細節：銳利化、明度降噪、色彩降噪交給 RAW 引擎在去馬賽克時做（品質遠比事後處理好）。
//   ② 局部亮度底圖：亮度取 log 之後做大範圍模糊（並限制跟原像素的差距，避免邊緣光暈）。
//      高光、陰影、清晰度都看這張底圖決定作用多少 —— 跟 Lightroom 一樣是「局部」的：
//      亮部壓下來時，亮部裡的細節、紋理還在，不會變成一片平平的灰。
//   ③ 光線：在亮度的「格數」（EV）上調，三個通道等比例縮放 → 色相、飽和度都不變。
//      對比（以中灰為支點）、高光、陰影、白色、黑色、清晰度（中間調的局部對比）。
//   ④ 色彩：在 Oklab（感知均勻的色彩空間）上做。
//      飽和度：整體色度；自然飽和度：越不飽和加越多、膚色色相附近自動減量；
//      HSL：八個色相，相鄰色相之間平滑過渡，只動有顏色的地方（灰色不受影響），調明度時色相不會跑。
//   ⑤ 印出來：0.8 以下完全不動；超過白的亮部以最亮的通道為準等比例柔收（色相不變），超出色域的往同亮度的灰拉。
//   ⑥ 曲線（RGB 總曲線＋紅綠藍）在顯示值上做；⑦ 拍照當下的樣子（濾鏡、特效、裁切、日期）。
//
//  即時預覽：① 只有曝光、白平衡、細節改了才重算，結果存成螢幕大小的線性浮點小圖（連同 ② 的底圖），
//  其他調整都是在小圖上的 GPU 運算，拖滑桿時每一格都能重畫。
//

import Foundation
import CoreImage
import UIKit

struct ABAIRawParams: Equatable {
    var exposure = 0.0
    /// 白平衡：色溫（K）、色調（DNG 的 tint，綠 − ↔ ＋ 洋紅）。nil＝拍攝當下
    var temperature: Double? = nil, tint: Double? = nil
    var contrast = 0.0, highlights = 0.0, shadows = 0.0, whites = 0.0, blacks = 0.0, clarity = 0.0
    var vibrance = 0.0, saturation = 0.0
    /// 八個色相（紅橙黃綠青藍紫洋紅）× [色相, 飽和度, 明度]，各 -1～1
    var hsl: [Double] = Array(repeating: 0, count: 24)
    /// 曲線：256 格 × RGB（已經把總曲線和各通道合在一起），nil＝直線
    var curve: [Float]? = nil
    /// 細節（-1～1，0＝RAW 引擎針對這台相機的預設）
    var sharpen = 0.0, lumaNR = 0.0, colorNR = 0.0

    init() {}
    init(_ d: [String: Any]?) {
        guard let d = d else { return }
        func n(_ k: String) -> Double { (d[k] as? NSNumber)?.doubleValue ?? 0 }
        exposure = n("exposure")
        temperature = (d["temperature"] as? NSNumber)?.doubleValue
        tint = (d["tint"] as? NSNumber)?.doubleValue
        contrast = n("contrast"); highlights = n("highlights"); shadows = n("shadows"); whites = n("whites"); blacks = n("blacks")
        clarity = n("clarity")
        vibrance = n("vibrance"); saturation = n("saturation")
        sharpen = n("sharpen"); lumaNR = n("lumaNR"); colorNR = n("colorNR")
        if let h = d["hsl"] as? [Any], h.count == 24 { hsl = h.map { ($0 as? NSNumber)?.doubleValue ?? 0 } }
        if let c = d["curve"] as? [Any], c.count == 768 { curve = c.map { Float(($0 as? NSNumber)?.doubleValue ?? 0) } }
    }
    /// RAW 那一步（①）用到的參數；變了才要重新解 RAW
    var rawKey: String { "\(exposure)|\(temperature ?? -1)|\(tint ?? -999)|\(sharpen)|\(lumaNR)|\(colorNR)" }
}

/// RAW 引擎針對這台相機的細節預設值（滑桿的 0）
struct ABAIRawDefaults {
    var sharp: Float = 0, luma: Float = 0, color: Float = 0
    init(_ f: CIRAWFilter) {
        if f.isSharpnessSupported { sharp = f.sharpnessAmount }
        if f.isLuminanceNoiseReductionSupported { luma = f.luminanceNoiseReductionAmount }
        if f.isColorNoiseReductionSupported { color = f.colorNoiseReductionAmount }
    }
}

enum ABAIRawDevelop {

    // MARK: ① RAW 解碼

    static func rawFilter(_ url: URL, longSide: CGFloat?, draft: Bool) -> CIRAWFilter? {
        guard let f = CIRAWFilter(imageURL: url) else { return nil }
        f.isDraftModeEnabled = draft
        /* 起點用系統 RAW 引擎本身的成像（相機的階調、Apple 的色彩科學），打開時就跟相簿裡那張一樣自然；
           只把亮部保留到 EDR 上限（extendedDynamicRangeAmount = 2），我們的調整都疊在這上面 */
        f.extendedDynamicRangeAmount = 2
        if f.isLensCorrectionSupported { f.isLensCorrectionEnabled = true }
        if let ls = longSide, f.nativeSize.width > 0 {
            f.scaleFactor = Float(min(1, ls / max(f.nativeSize.width, f.nativeSize.height)))
        }
        return f
    }

    /// 0 ＝ 預設值；往 +1 走到 1、往 -1 走到 0
    private static func around(_ def: Float, _ v: Double) -> Float {
        let x = Float(max(-1, min(1, v)))
        return x >= 0 ? def + (1 - def) * x : def * (1 + x)
    }

    static func applyRaw(_ f: CIRAWFilter, _ p: ABAIRawParams, defaults d: ABAIRawDefaults) -> CIImage? {
        f.exposure = Float(p.exposure)
        if let t = p.temperature { f.neutralTemperature = Float(max(2000, min(50000, t))) }
        if let t = p.tint { f.neutralTint = Float(max(-150, min(150, t))) }
        if f.isSharpnessSupported { f.sharpnessAmount = around(d.sharp, p.sharpen) }
        if f.isLuminanceNoiseReductionSupported { f.luminanceNoiseReductionAmount = around(d.luma, p.lumaNR) }
        if f.isColorNoiseReductionSupported { f.colorNoiseReductionAmount = around(d.color, p.colorNR) }
        return f.outputImage
    }

    // MARK: ①' 白平衡不改亮度

    /// 整張圖的「感覺亮度」：log 亮度的平均（幾何平均，跟人眼的感覺一致）
    static func logMean(_ img: CIImage) -> Double? {
        let e = img.extent
        guard e.width > 0, e.height > 0, let k = logLumaKernel, let l = k.apply(extent: e, arguments: [img]) else { return nil }
        let avg = l.applyingFilter("CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: e)])
        var px = [Float](repeating: 0, count: 4)
        ABAIImageCore.context.render(avg, toBitmap: &px, rowBytes: 16, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBAf, colorSpace: nil)
        return px[0].isFinite ? Double(px[0]) : nil
    }

    /// 系統 RAW 引擎改色溫、色調時，整體亮度會跟著變（白平衡的增益沒有保持亮度）——
    /// 看起來就像同時動到了曝光。專業沖洗軟體的白平衡只改顏色，所以這裡補回來：
    /// 用一張很小的 RAW 在同樣曝光下各解一次（拍攝當下的白平衡、現在的白平衡），比較感覺亮度，差多少補多少。
    /// small：共用的小解碼器和它拍攝當下的白平衡（量之前先放回去）；不給就自己開一個
    static func wbGain(_ url: URL, _ p: ABAIRawParams, small: (CIRAWFilter, Float, Float)? = nil) -> Double {
        guard p.temperature != nil || p.tint != nil else { return 1 }
        let f: CIRAWFilter
        if let sm = small { f = sm.0; f.neutralTemperature = sm.1; f.neutralTint = sm.2 }
        else if let made = rawFilter(url, longSide: 320, draft: true) { f = made }
        else { return 1 }
        f.exposure = Float(p.exposure)
        guard let a = f.outputImage, let la = logMean(a) else { return 1 }
        if let t = p.temperature { f.neutralTemperature = Float(max(2000, min(50000, t))) }
        if let t = p.tint { f.neutralTint = Float(max(-150, min(150, t))) }
        guard let b = f.outputImage, let lb = logMean(b) else { return 1 }
        return pow(2, max(-2, min(2, la - lb)))
    }

    static func gain(_ img: CIImage, _ g: Double) -> CIImage {
        guard abs(g - 1) > 0.002 else { return img }
        let v = CGFloat(g)
        return img.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: v, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: v, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: v, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
        ])
    }

    // MARK: ② 局部亮度底圖

    private static let logLumaKernel = CIColorKernel(source: """
    kernel vec4 abaiLogLuma(__sample s) {
        float Y = max(dot(max(s.rgb, vec3(0.0)), vec3(0.2289746, 0.6917385, 0.0792869)), 1.0e-5);
        float e = log2(Y / 0.18);
        return vec4(e, e, e, 1.0);
    }
    """)

    /// 亮度（EV，以中灰為 0）的大範圍模糊。sigma 跟著圖的大小走（預覽、原尺寸看起來一樣）
    static func localBase(_ linear: CIImage) -> CIImage {
        let e = linear.extent
        guard let k = logLumaKernel, let lum = k.apply(extent: e, arguments: [linear]) else { return linear }
        let sigma = Double(max(e.width, e.height)) * 0.012
        /* 兩個尺度混合：大的負責「這一區整體多亮」，小的讓邊緣附近不會整圈發亮（光暈） */
        let big = lum.clampedToExtent().applyingGaussianBlur(sigma: sigma).cropped(to: e)
        let small = lum.clampedToExtent().applyingGaussianBlur(sigma: sigma * 0.25).cropped(to: e)
        return big.applyingFilter("CIDissolveTransition", parameters: ["inputTargetImage": small, "inputTime": 0.35]).cropped(to: e)
    }

    // MARK: ③ 光線

    private static let toneKernel = CIColorKernel(source: """
    kernel vec4 abaiRawTone(__sample s, __sample b, float contrast, float highlights, float shadows, float whites, float blacks, float clarity) {
        vec3 c = max(s.rgb, vec3(0.0));
        float Y = max(dot(c, vec3(0.2289746, 0.6917385, 0.0792869)), 1.0e-5);
        float e = log2(Y / 0.18);
        /* 底圖跟像素的差距限制在 ±1.5 EV：亮暗交界處不會被對面那一側拖著走（光暈） */
        float base = e + clamp(b.r - e, -1.5, 1.5);
        float detail = e - base;
        float e2 = e * (1.0 + contrast * 0.6);
        float hw = smoothstep(-1.0, 2.5, base);
        float sw = 1.0 - smoothstep(-5.5, -0.5, base);
        e2 += highlights * 2.5 * hw;
        e2 += shadows * 2.5 * sw;
        e2 += whites * 1.5 * smoothstep(0.5, 3.5, e);
        e2 += blacks * 1.6 * (1.0 - smoothstep(-8.0, -3.0, e));
        float mid = exp(-(base * base) / 9.0);
        e2 += clarity * 0.9 * detail * mid;
        float Y2 = 0.18 * exp2(e2);
        return vec4(c * (Y2 / Y), s.a);
    }
    """)

    // MARK: ④ 色彩（Oklab）

    private static let colorKernel = CIColorKernel(source: """
    vec3 abaiToLab(vec3 c) {
        vec3 l = vec3(dot(c, vec3(0.48132726, 0.46206791, 0.05649561)),
                      dot(c, vec3(0.22883813, 0.65323438, 0.11795440)),
                      dot(c, vec3(0.08398602, 0.22427280, 0.69222086)));
        l = sign(l) * pow(abs(l), vec3(1.0 / 3.0));
        return vec3(dot(l, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
                    dot(l, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
                    dot(l, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
    }
    vec3 abaiFromLab(vec3 o) {
        vec3 l = vec3(o.x + 0.39633779 * o.y + 0.21580376 * o.z,
                      o.x - 0.10556134 * o.y - 0.06385417 * o.z,
                      o.x - 0.08948418 * o.y - 1.29148554 * o.z);
        l = l * l * l;
        return vec3(dot(l, vec3(3.12811105, -2.25707542, 0.12930476)),
                    dot(l, vec3(-1.09112853, 2.41326708, -0.32216814)),
                    dot(l, vec3(-0.02601361, -0.50802769, 1.53331664)));
    }
    float abaiHueDist(float a, float b) { float d = abs(a - b); return min(d, 360.0 - d); }
    /* 一個色相的權重：中心 c，往前到上一個中心的距離 lo、往後到下一個中心的距離 hi（升餘弦，到隔壁中心剛好歸零） */
    float abaiBandW(float h, float c, float lo, float hi) {
        float d = h - c;
        if (d > 180.0) d -= 360.0;
        if (d < -180.0) d += 360.0;
        float span = d >= 0.0 ? hi : lo;
        float a = abs(d);
        return a < span ? 0.5 + 0.5 * cos(3.14159265 * a / span) : 0.0;
    }
    kernel vec4 abaiRawColor(__sample s, float vibrance, float saturation, vec4 h0, vec4 h1, vec4 h2, vec4 h3, vec4 h4, vec4 h5, vec4 h6, vec4 h7) {
        vec3 c = s.rgb;
        vec3 lab = abaiToLab(max(c, vec3(0.0)));
        float C = length(lab.yz);
        if (C < 1.0e-6) return s;
        float h = degrees(atan(lab.z, lab.y));
        if (h < 0.0) h += 360.0;
        /* 八個色相（中心在 h?.w）：相鄰兩個之間平滑交接，兩個權重加起來是 1 */
        float w0 = abaiBandW(h, h0.w, 40.0, 30.0), w1 = abaiBandW(h, h1.w, 30.0, 45.0), w2 = abaiBandW(h, h2.w, 45.0, 45.0), w3 = abaiBandW(h, h3.w, 45.0, 55.0);
        float w4 = abaiBandW(h, h4.w, 55.0, 60.0), w5 = abaiBandW(h, h5.w, 60.0, 45.0), w6 = abaiBandW(h, h6.w, 45.0, 40.0), w7 = abaiBandW(h, h7.w, 40.0, 40.0);
        vec3 adj = h0.xyz * w0 + h1.xyz * w1 + h2.xyz * w2 + h3.xyz * w3 + h4.xyz * w4 + h5.xyz * w5 + h6.xyz * w6 + h7.xyz * w7;
        float wsum = w0 + w1 + w2 + w3 + w4 + w5 + w6 + w7;
        adj /= max(wsum, 1.0e-4);
        /* 越接近灰色越不受 HSL 影響 */
        float cw = smoothstep(0.0, 0.06, C);
        h += adj.x * 30.0 * cw;
        C *= max(0.0, 1.0 + adj.y * cw);
        lab.x *= exp2(adj.z * 0.75 * cw);
        /* 飽和度：整體色度。自然飽和度：越不飽和加越多，膚色色相（約 40°～75°）附近自動減量 */
        float skin = exp(-pow(abaiHueDist(h, 58.0) / 22.0, 2.0));
        float vib = vibrance > 0.0 ? vibrance * (1.0 - smoothstep(0.0, 0.22, C)) * (1.0 - 0.65 * skin) : vibrance * 0.8;
        C *= max(0.0, 1.0 + saturation) * max(0.0, 1.0 + vib);
        float hr = radians(h);
        return vec4(abaiFromLab(vec3(lab.x, C * cos(hr), C * sin(hr))), s.a);
    }
    """)
    /// 八個色相的中心（Oklab 的色相角）：紅、橙、黃、綠、青、藍、紫、洋紅
    private static let bandHues: [CGFloat] = [25, 55, 100, 145, 200, 260, 305, 345]

    // MARK: ⑤ 顯示轉換

    private static let viewKernel = CIColorKernel(source: """
    kernel vec4 abaiRawView(__sample s) {
        vec3 c = s.rgb;
        vec3 W = vec3(0.2289746, 0.6917385, 0.0792869);
        float l = max(dot(c, W), 0.0);
        /* 超出色域（有負值）：往同亮度的灰拉，拉到剛好進色域 —— 色相不變 */
        float mn = min(min(c.r, c.g), c.b);
        if (mn < 0.0) { float k = l / max(l - mn, 1.0e-6); c = vec3(l) + (c - vec3(l)) * k; }
        /* 超過白的亮部：以最亮的通道為準、三個通道等比例柔收（色相不變），0.8 以下完全不動 */
        float n = max(max(c.r, c.g), c.b);
        float knee = 0.8;
        if (n > knee) {
            float f = knee + (1.0 - knee) * (1.0 - exp(-(n - knee) / (1.0 - knee)));
            c *= f / n;
            float t = smoothstep(0.9, 1.0, f);
            c = mix(c, vec3(f), t * t * 0.6);
        }
        return vec4(clamp(c, 0.0, 1.0), s.a);
    }
    """)

    // MARK: ③～⑥ 整條

    /// 從 RAW 解出來的線性圖（①之後）＋底圖（②）往下做 ③～⑥
    static func finish(_ linear: CIImage, base: CIImage, _ p: ABAIRawParams) -> CIImage {
        let e = linear.extent
        var img = linear
        if let k = toneKernel {
            img = k.apply(extent: e, arguments: [img, base, p.contrast, p.highlights, p.shadows, p.whites, p.blacks, p.clarity]) ?? img
        }
        let hslOn = p.hsl.contains(where: { abs($0) > 0.001 })
        if hslOn || abs(p.vibrance) > 0.001 || abs(p.saturation) > 0.001, let k = colorKernel {
            var arguments: [Any] = [img, p.vibrance, p.saturation]
            for i in 0..<8 {
                let offset = i * 3
                let hue = CGFloat(p.hsl[offset])
                let saturation = CGFloat(p.hsl[offset + 1])
                let lightness = CGFloat(p.hsl[offset + 2])
                let band = CIVector(x: hue, y: saturation, z: lightness, w: bandHues[i])
                arguments.append(band)
            }
            img = k.apply(extent: e, arguments: arguments) ?? img
        }
        if let k = viewKernel { img = k.apply(extent: e, arguments: [img]) ?? img }
        if let curve = p.curve, let f = CIFilter(name: "CIColorCurves") {
            let data = curve.withUnsafeBufferPointer { Data(buffer: $0) }
            f.setValue(img, forKey: kCIInputImageKey)
            f.setValue(data, forKey: "inputCurvesData")
            f.setValue(CIVector(x: 0, y: 1), forKey: "inputCurvesDomain")
            f.setValue(ABAIImageCore.sRGB, forKey: "inputColorSpace")
            img = f.outputImage?.cropped(to: e) ?? img
        }
        return img.cropped(to: e)
    }

    /// 拍照當下的樣子（⑦）：比例裁切、小框、濾鏡、特效、日期
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

    /// 線性圖 → 存成浮點小圖（快取用，超過白的亮部也留著）
    static func bake(_ img: CIImage) -> CIImage? {
        guard let cg = ABAIImageCore.context.createCGImage(img, from: img.extent, format: .RGBAh, colorSpace: ABAIImageCore.linearP3) else { return nil }
        return CIImage(cgImage: cg)
    }
}

/// 一次沖洗（即時預覽）：RAW 那一步的結果（和它的亮度底圖）快取成螢幕大小的線性浮點小圖，其他調整都在小圖上即時算
final class ABAIRawSession {
    let url: URL
    let look: [String: Any]?
    let view: ABAIMetalView
    private let queue = DispatchQueue(label: "abai.raw.session", qos: .userInteractive)
    private var filter: CIRAWFilter?
    private let defaults: ABAIRawDefaults
    private var proxy: CIImage?
    private var proxyBase: CIImage?
    private var proxyKey = ""
    private var proxyDraft = true
    private var pending: (ABAIRawParams, Bool)?
    private var busy = false
    private let longSide: CGFloat
    /// 拍攝當下的白平衡（滑桿的預設值）
    private(set) var asShotTemperature: Double = 5500
    private(set) var asShotTint: Double = 0

    init?(url: URL, look: [String: Any]?, view: ABAIMetalView, longSide: CGFloat) {
        self.url = url; self.look = look; self.view = view; self.longSide = longSide
        guard let f = ABAIRawDevelop.rawFilter(url, longSide: longSide, draft: true) else { return nil }
        filter = f
        defaults = ABAIRawDefaults(f)
        asShotTemperature = Double(f.neutralTemperature)
        asShotTint = Double(f.neutralTint)
    }

    private var gainCache: [String: Double] = [:]
    /// 量白平衡亮度用的小解碼器（整段沖洗共用一個，不用每次重新開 RAW 檔）
    private var smallFilter: (CIRAWFilter, Float, Float)?
    private func wbGain(_ p: ABAIRawParams) -> Double {
        let key = "\(p.exposure)|\(p.temperature ?? -1)|\(p.tint ?? -999)"
        if let g = gainCache[key] { return g }
        if smallFilter == nil, let f = ABAIRawDevelop.rawFilter(url, longSide: 320, draft: true) { smallFilter = (f, f.neutralTemperature, f.neutralTint) }
        let g = ABAIRawDevelop.wbGain(url, p, small: smallFilter)
        if gainCache.count > 64 { gainCache.removeAll() }
        gainCache[key] = g
        return g
    }

    private func rebuild(_ p: ABAIRawParams) {
        guard let f = filter, let raw = ABAIRawDevelop.applyRaw(f, p, defaults: defaults),
              let baked = ABAIRawDevelop.bake(ABAIRawDevelop.gain(raw, wbGain(p))) else { return }
        proxy = baked
        proxyBase = ABAIRawDevelop.bake(ABAIRawDevelop.localBase(baked)) ?? ABAIRawDevelop.localBase(baked)
        proxyKey = p.rawKey
    }

    private func render(_ p: ABAIRawParams) -> CIImage? {
        guard let lin = proxy, let base = proxyBase else { return nil }
        return ABAIRawDevelop.applyLook(ABAIRawDevelop.finish(lin, base: base, p), look: look, withDate: false)
    }

    /// 打開時的第一格：同步算好（在沖洗自己的佇列上），讓畫面先有圖，網頁才把那一塊挖空 ——
    /// 不然挖空的瞬間底下什麼都還沒畫，會透出後面的畫面。
    func renderFirst(_ p: ABAIRawParams) -> CIImage? {
        queue.sync { autoreleasepool { () -> CIImage? in rebuild(p); return render(p) } }
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
                rebuild(p)
            }
            if let img = render(p) { DispatchQueue.main.async { self.view.source = img } }
        }
        queue.async { self.drain() }
    }

    /// 原尺寸、完整品質輸出成 JPEG（含拍照當下的濾鏡、特效、裁切、日期）
    func export(_ p: ABAIRawParams) throws -> URL {
        guard let f = ABAIRawDevelop.rawFilter(url, longSide: nil, draft: false),
              let raw = ABAIRawDevelop.applyRaw(f, p, defaults: ABAIRawDefaults(f)),
              let lin = ABAIRawDevelop.bake(ABAIRawDevelop.gain(raw, ABAIRawDevelop.wbGain(url, p))) else {
            throw ABAIImageCore.CoreError.decode
        }
        let base = ABAIRawDevelop.localBase(lin)
        let img = ABAIRawDevelop.applyLook(ABAIRawDevelop.finish(lin, base: base, p), look: look, withDate: true)
        let data = try ABAIImageCore.encode(ABAIImageCore.dither(img), format: .jpeg, quality: 0.95)
        let out = ABAIImageCore.newFileURL(ext: "jpg")
        try data.write(to: out)
        return out
    }
}
