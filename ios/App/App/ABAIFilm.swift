//
//  ABAIFilm.swift
//  ABAI — 底片相機模擬（原生觀景窗、拍出來的照片共用同一套）
//
//  手機相機會把每個場景都自動曝光到「剛好」；真的底片相機不會。這裡照實體相機的物理來做：
//
//  ① 曝光（這是「預覽會暗暗的」的原因）
//     手機每一格畫面都帶著它當下用的快門、ISO、光圈。換算成 ISO 100 的曝光值
//         S = log2(N² / t) − log2(ISO / 100)
//     手機畫面本身已經是「剛好」的亮度，所以 S 就等於這個場景需要的曝光。
//     模擬的相機只能用自己的曝光 C（一次性相機是固定一組；傻瓜相機在一個範圍裡自動）：
//         C = clamp(S, evMin, evMax)
//     這一張比「剛好」多吃了 Δ = S − C 格光 —— 太陽下過曝、室內暗好幾格。
//     在線性光上乘 2^Δ，就是那台相機真正拍到的亮度。
//     開閃光燈：閃光燈只把近處打到大約「剛好」，背景照樣暗 —— 光是加起來的：
//         2^Δ' = 2^Δ + 2^flashLevel
//
//  ② 底片＋沖印（都在「以 18% 灰為 0 的格數」上算）
//     底片（H&D 曲線）：中間一段是直線（斜率＝反差）；亮部肩部慢慢壓（負片寬容度很大），
//       暗部趾部掉到片基的灰黑（曝光不足時是悶悶的灰黑＋粗顆粒，不是乾淨的黑）。
//       三個通道各自走：過曝時顏色變淡，曝光不足時暗部偏色（各支底片不同）。
//     沖印：沖印店的機器會把太濃（過曝）的底片印淡一點，太薄（曝光不足）的只能救一點點 ——
//       所以大太陽下過曝 3 格照樣好看（亮、通透、反差變低），室內暗 5 格就救不回來。
//       正片（反轉片）沒有這一步，過曝就是過曝。
//     相紙：最亮到紙白，接近紙白時柔柔地收。
//
//  ③ 光暈（halation）：強光穿過乳劑、在片基背面反射回來，亮部邊緣一圈紅橘色的暈 —— 底片獨有。
//  ④ 鏡頭：暗角（在線性光上乘，跟光學一樣）、塑膠鏡頭的四角發軟。
//  ⑤ 顆粒：平滑的值雜訊（不是方塊）、兩種大小疊在一起；中間調與暗部最明顯；
//     曝光不足會更粗。觀景窗每一格換一次種子，顆粒會像真的底片一樣「動」。
//  ⑥ 日期：橘紅色七段顯示器的字，從底片背面印上去（加光、帶一點暈）。
//
//  網頁那邊：utils/filmCameras.ts（每台相機的參數）、utils/nativeCamera.ts
//

import Foundation
import CoreImage
import CoreGraphics
import UIKit

struct ABAIFilm: Equatable {
    var id = ""
    /// 這台相機能用的曝光範圍（ISO 100 的 EV）。一樣＝固定曝光
    var evMin = 11.6, evMax = 11.6
    /// 中間那段的反差（1＝跟原本一樣）
    var gamma = 1.0
    /// 底片肩部從幾格開始彎、最多再多幾格
    var knee = 2.0, shoulder = 2.5
    /// 趾部從幾格以下開始彎、最多再暗幾格
    var toeStart = 3.0, toe = 2.6
    /// 三個通道的反差差異（底片每一層感光層不一樣）→ 曝光不足／過曝時的偏色
    var chanGamma = [1.0, 1.0, 1.0]
    /// 暗部、亮部的偏色（乘在顏色上，依曝光程度混進來）
    var shadowTint = [1.0, 1.0, 1.0], highlightTint = [1.0, 1.0, 1.0]
    var saturation = 1.0
    /// 黑白：用這組權重混成單色（在曝光之前，像相機前面加了濾鏡）
    var mono = false, monoMix = [0.30, 0.59, 0.11]
    /// 底片本身的色調（App 內建的同一批濾鏡）
    var lut = "", lutAmount = 1.0
    var grain = 0.5, grainSize = 1.0
    var halation = 0.3
    var vignette = 0.3, softCorners = 0.0
    /// 閃光燈把近處打到「剛好」再差幾格
    var flashLevel = -0.4
    /// 沖印補償：過曝的每一格印回幾成、曝光不足的（最多 1.5 格）救回幾成。正片兩個都是 0
    var printOver = 0.6, printUnder = 0.5

    var isOn: Bool { !id.isEmpty }

    init() {}
    init(_ d: [String: Any]?) {
        guard let d = d else { return }
        func n(_ k: String, _ def: Double) -> Double { (d[k] as? NSNumber)?.doubleValue ?? def }
        func v3(_ k: String, _ def: [Double]) -> [Double] {
            guard let a = d[k] as? [Any], a.count == 3 else { return def }
            return a.map { ($0 as? NSNumber)?.doubleValue ?? 1 }
        }
        id = d["id"] as? String ?? ""
        evMin = n("evMin", evMin); evMax = max(evMin, n("evMax", evMax))
        gamma = n("gamma", gamma); knee = n("knee", knee); shoulder = max(0.2, n("shoulder", shoulder))
        toeStart = n("toeStart", toeStart); toe = max(0.2, n("toe", toe))
        chanGamma = v3("chanGamma", chanGamma); shadowTint = v3("shadowTint", shadowTint); highlightTint = v3("highlightTint", highlightTint)
        saturation = n("saturation", saturation)
        mono = d["mono"] as? Bool ?? false; monoMix = v3("monoMix", monoMix)
        lut = d["lut"] as? String ?? ""; lutAmount = n("lutAmount", lutAmount)
        grain = n("grain", grain); grainSize = max(0.3, n("grainSize", grainSize))
        halation = n("halation", halation); vignette = n("vignette", vignette); softCorners = n("softCorners", softCorners)
        flashLevel = n("flashLevel", flashLevel)
        printOver = n("printOver", printOver); printUnder = n("printUnder", printUnder)
    }

    // MARK: 曝光

    /// 快門（秒）、ISO、光圈 → ISO 100 的曝光值
    static func ev100(duration: Double, iso: Double, aperture: Double) -> Double? {
        guard duration > 0, iso > 0, aperture > 0 else { return nil }
        return log2(aperture * aperture / duration) - log2(iso / 100)
    }

    /// 這一格／這一張比「剛好」多了幾格光（含閃光燈、使用者自己加減的曝光）
    func exposureDelta(sceneEV s: Double, userEV: Double, flash: Bool) -> Double {
        let c = min(evMax, max(evMin, s))
        var d = s - c
        if flash { d = log2(pow(2, d) + pow(2, flashLevel)) }
        return d + userEV
    }

    // MARK: GPU 程式

    private static let toneKernel = CIColorKernel(source: """
    kernel vec4 abaiFilmTone(__sample s, float delta, float comp, float gamma, vec3 chan, float knee, float shoulder, float toeStart, float toe,
                             vec3 shTint, vec3 hiTint, float sat, float mono, vec3 monoMix) {
        vec3 x = max(s.rgb, vec3(0.0));
        if (mono > 0.5) { float m = dot(x, monoMix); x = vec3(m); }
        x = max(x, vec3(1e-6));
        // 底片吃到的光（格數）：場景的反差 × 這支底片的反差（三層各自），再加上這一張多吃的光
        vec3 e = log2(x / 0.18) * gamma * chan + delta;
        // 底片肩部、趾部
        vec3 ov = max(e - knee, vec3(0.0));
        e = e - ov + shoulder * (1.0 - exp(-ov / shoulder));
        vec3 un = max(-toeStart - e, vec3(0.0));
        e = e + un - toe * (1.0 - exp(-un / toe));
        // 沖印補償，再印到相紙上（接近紙白時柔柔地收，最亮＝紙白）
        vec3 p = e - comp;
        vec3 po = max(p - 1.8, vec3(0.0));
        p = p - po + 0.75 * (1.0 - exp(-po / 0.75));
        vec3 y = 0.18 * exp2(p);
        // 偏色：照「印出來有多暗／多亮」混進來
        float l = dot(p, vec3(0.2126, 0.7152, 0.0722));
        float ds = clamp((-l - 1.0) / 3.0, 0.0, 1.0);
        float hs = clamp((l - 0.8) / 1.6, 0.0, 1.0);
        y *= mix(vec3(1.0), shTint, ds) * mix(vec3(1.0), hiTint, hs);
        float ly = dot(y, vec3(0.2126, 0.7152, 0.0722));
        y = max(mix(vec3(ly), y, sat), vec3(0.0));
        return vec4(y, s.a);
    }
    """)

    /// 暗角：在線性光上乘（光學上的光量衰減），以半對角線為 1
    private static let vignetteKernel = CIColorKernel(source: """
    kernel vec4 abaiFilmVignette(__sample s, vec2 center, float halfDiag, float amt) {
        vec2 d = (destCoord() - center) / halfDiag;
        float r2 = dot(d, d);
        float f = 1.0 - amt * smoothstep(0.08, 1.0, r2) * (0.55 + 0.45 * r2);
        return vec4(s.rgb * max(f, 0.0), s.a);
    }
    """)

    private static let brightKernel = CIColorKernel(source: """
    kernel vec4 abaiFilmBright(__sample s, float gain) {
        vec3 x = s.rgb * gain;
        float l = max(max(x.r, x.g), x.b);
        float a = smoothstep(0.75, 1.6, l);
        return vec4(x * a, 1.0);
    }
    """)

    private static let halationKernel = CIColorKernel(source: """
    kernel vec4 abaiFilmHalation(__sample s, __sample g, __sample b, float amt) {
        float e = max(dot(g.rgb - b.rgb * 0.6, vec3(0.3333)), 0.0);
        vec3 glow = vec3(1.0, 0.32, 0.08) * e * amt;
        return vec4(s.rgb + glow, s.a);
    }
    """)

    /// 顆粒：平滑的值雜訊、兩種大小。在 sRGB 編碼值上加（看起來的顆粒感才對）
    private static let grainKernel = CIColorKernel(source: """
    float abaiH(vec2 p) {
        vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float abaiN(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = abaiH(i), b = abaiH(i + vec2(1.0, 0.0)), c = abaiH(i + vec2(0.0, 1.0)), d = abaiH(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) - 0.5;
    }
    kernel vec4 abaiFilmGrain(__sample s, float cell, float amt, vec2 seed, float mono) {
        vec3 c = clamp(s.rgb, 0.0, 1.0);
        vec2 p = destCoord() / cell + seed;
        float g1 = abaiN(p) + 0.6 * abaiN(p * 2.37 + 17.0);
        vec3 col = vec3(abaiN(p * 1.3 + 41.0), abaiN(p * 1.3 + 97.0), abaiN(p * 1.3 + 151.0));
        vec3 n = mono > 0.5 ? vec3(g1) : vec3(g1) * 0.75 + col * 0.45;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // 中間調、暗部最明顯，最亮的地方幾乎沒有
        float w = 0.25 + 3.0 * l * (1.0 - l) + 0.35 * (1.0 - l);
        c += n * amt * w;
        return vec4(clamp(c, 0.0, 1.0), s.a);
    }
    """)

    /// 縮小 → 模糊 → 放大回原尺寸
    private static func blurred(_ img: CIImage, scale s: CGFloat, sigma: CGFloat) -> CIImage {
        let e = img.extent
        let small = img.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
            .transformed(by: CGAffineTransform(scaleX: s, y: s))
        let b = small.clampedToExtent().applyingGaussianBlur(sigma: Double(sigma)).cropped(to: small.extent)
        return b.transformed(by: CGAffineTransform(scaleX: 1 / s, y: 1 / s))
            .transformed(by: CGAffineTransform(translationX: e.minX, y: e.minY))
            .cropped(to: e)
    }

    private static var cubeCache: [String: ABAIImageCore.Cube] = [:]
    private static let cubeLock = NSLock()
    private func cube() -> ABAIImageCore.Cube? {
        guard !lut.isEmpty else { return nil }
        Self.cubeLock.lock(); defer { Self.cubeLock.unlock() }
        if let c = Self.cubeCache[lut] { return c }
        guard let u = ABAIImageCore.bundledLut(lut), let c = ABAIImageCore.cube(fromAtlas: u) else { return nil }
        Self.cubeCache[lut] = c
        return c
    }

    /// 沖印店能印回來幾格：過曝最多算 3 格、曝光不足最多救 1.5 格
    func printComp(_ delta: Double) -> Double {
        printOver * min(3, max(0, delta)) + printUnder * min(0, max(-1.5, delta))
    }

    /// 整套底片處理。input：線性光（已經套好色溫）。delta：這一張多了幾格光（exposureDelta）。
    /// seed：顆粒的種子（觀景窗每格換、照片固定）。輸出也是線性光。
    func apply(to input: CIImage, delta: Double, seed: CGPoint) -> CIImage {
        guard isOn else { return input }
        let e = input.extent
        guard e.width > 1, e.height > 1 else { return input }
        let gain = pow(2, delta)
        var x = input

        /* 四角發軟（塑膠鏡頭）：在光進底片之前 */
        if softCorners > 0.001, let mask = CIFilter(name: "CIRadialGradient", parameters: [
            "inputCenter": CIVector(x: e.midX, y: e.midY),
            "inputRadius0": hypot(e.width, e.height) * 0.22,
            "inputRadius1": hypot(e.width, e.height) * 0.55,
            "inputColor0": CIColor(red: 0, green: 0, blue: 0),
            "inputColor1": CIColor(red: 1, green: 1, blue: 1),
        ])?.outputImage?.cropped(to: e) {
            x = x.clampedToExtent().applyingFilter("CIMaskedVariableBlur", parameters: [
                "inputMask": mask, "inputRadius": Double(e.width) * 0.006 * softCorners,
            ]).cropped(to: e)
        }
        if vignette > 0.001, let k = Self.vignetteKernel,
           let v = k.apply(extent: e, arguments: [x, CIVector(x: e.midX, y: e.midY), Double(hypot(e.width, e.height) / 2), vignette]) { x = v }

        /* 光暈：強光（已經乘上曝光）在小圖上擴散，紅橘色加回去 */
        if halation > 0.001, let bk = Self.brightKernel, let hk = Self.halationKernel {
            let s = min(1, 320 / max(e.width, e.height))
            let bright = bk.apply(extent: e, arguments: [x, gain]) ?? x
            /* 只取「擴散出去的那一圈」：寬的模糊減掉一點原本的亮部，亮部本身不會整塊被染紅 */
            let glow = Self.blurred(bright, scale: s, sigma: 320 * 0.012)
            // 光暈本身是曝光後的光，除回 gain 讓下一步的曲線一起處理
            if let h = hk.apply(extent: e, arguments: [x, glow, bright, halation * 0.8 / max(gain, 1e-4)]) { x = h }
        }

        if let k = Self.toneKernel,
           let t = k.apply(extent: e, arguments: [x, delta, printComp(delta), gamma,
                                                   CIVector(x: chanGamma[0], y: chanGamma[1], z: chanGamma[2]),
                                                   knee, shoulder, toeStart, toe,
                                                   CIVector(x: shadowTint[0], y: shadowTint[1], z: shadowTint[2]),
                                                   CIVector(x: highlightTint[0], y: highlightTint[1], z: highlightTint[2]),
                                                   saturation, mono ? 1.0 : 0.0,
                                                   CIVector(x: monoMix[0], y: monoMix[1], z: monoMix[2])]) { x = t }

        if let c = cube() { x = ABAIImageCore.apply(cube: c, to: x, amount: lutAmount) }

        if grain > 0.001, let gk = Self.grainKernel {
            /* 顆粒大小照畫面寬度等比例（觀景窗與全解析度照片看起來一樣大）；曝光不足越多越粗、越明顯 */
            let under = max(0, min(1, (-delta - 0.5) / 4))
            let cell = Double(e.width) / 1500 * grainSize * (1 + under * 0.6)
            let amt = grain * 0.075 * (1 + under * 1.4)
            let enc = x.applyingFilter("CILinearToSRGBToneCurve")
            if let g = gk.apply(extent: e, arguments: [enc, cell, amt, CIVector(x: seed.x, y: seed.y), mono ? 1.0 : 0.0]) {
                x = g.applyingFilter("CISRGBToneCurveToLinear")
            }
        }
        return x.cropped(to: e)
    }

    // MARK: 日期（七段顯示器）

    /*  一個字 1 × 1.75 的格子，線寬 0.2，斜體 7°。七段的編號：
           _a_
         f|   |b
           _g_
         e|   |c
           _d_          */
    private static let digitSegs: [Character: String] = [
        "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
        "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g",
    ]

    /// 一個七段字的六角形線段（單位：字高 1.75、字寬 1）
    static func segmentPolys(_ ch: Character) -> [[CGPoint]] {
        guard let segs = digitSegs[ch] else { return [] }
        let w: CGFloat = 1, h: CGFloat = 1.75, t: CGFloat = 0.2, g: CGFloat = 0.035
        func hseg(_ y: CGFloat) -> [CGPoint] {
            let x0 = t / 2 + g, x1 = w - t / 2 - g
            return [CGPoint(x: x0, y: y), CGPoint(x: x0 + t / 2, y: y - t / 2), CGPoint(x: x1 - t / 2, y: y - t / 2),
                    CGPoint(x: x1, y: y), CGPoint(x: x1 - t / 2, y: y + t / 2), CGPoint(x: x0 + t / 2, y: y + t / 2)]
        }
        func vseg(_ x: CGFloat, _ y0: CGFloat, _ y1: CGFloat) -> [CGPoint] {
            let a = y0 + g, b = y1 - g
            return [CGPoint(x: x, y: a), CGPoint(x: x + t / 2, y: a + t / 2), CGPoint(x: x + t / 2, y: b - t / 2),
                    CGPoint(x: x, y: b), CGPoint(x: x - t / 2, y: b - t / 2), CGPoint(x: x - t / 2, y: a + t / 2)]
        }
        let top = t / 2, mid = h / 2, bot = h - t / 2
        var out: [[CGPoint]] = []
        for s in segs {
            switch s {
            case "a": out.append(hseg(top))
            case "g": out.append(hseg(mid))
            case "d": out.append(hseg(bot))
            case "f": out.append(vseg(t / 2, top, mid))
            case "b": out.append(vseg(w - t / 2, top, mid))
            case "e": out.append(vseg(t / 2, mid, bot))
            case "c": out.append(vseg(w - t / 2, mid, bot))
            default: break
            }
        }
        return out
    }

    /// 日期字的圖（只跟文字、字高有關，觀景窗每一格都要用，所以記起來）
    private static var stampCache: (key: String, image: CGImage, pad: Int)?
    private static let stampLock = NSLock()
    private static func stampImage(_ text: String, charH: CGFloat) -> (CGImage, Int)? {
        let key = "\(text)|\(Int(charH.rounded()))"
        stampLock.lock(); defer { stampLock.unlock() }
        if let c = stampCache, c.key == key { return (c.image, c.pad) }
        let unit = charH / 1.75
        let advance = unit * 1.32, spaceAdv = unit * 0.7, quoteAdv = unit * 0.55
        var width: CGFloat = 0
        for ch in text { width += ch == " " ? spaceAdv : ch == "'" ? quoteAdv : advance }
        let pad = Int(ceil(unit * 2))   // 留給外圈的暈
        let W = Int(ceil(width + charH * tan(7 * CGFloat.pi / 180))) + pad * 2, H = Int(ceil(charH)) + pad * 2
        guard W > 4, H > 4, let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                                                 space: ABAIImageCore.sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        // 用「往下為正」的座標畫（跟字形的定義一樣）
        ctx.translateBy(x: 0, y: CGFloat(H)); ctx.scaleBy(x: 1, y: -1)
        ctx.setFillColor(UIColor(red: 1.0, green: 0.5, blue: 0.16, alpha: 1).cgColor)
        let skew = tan(7 * CGFloat.pi / 180)
        var penX = CGFloat(pad)
        let baseY = CGFloat(pad)
        for ch in text {
            if ch == " " { penX += spaceAdv; continue }
            if ch == "'" {
                let p = CGMutablePath()
                let x0 = penX + unit * 0.2 + charH * skew, y0 = baseY
                p.addLines(between: [CGPoint(x: x0 + unit * 0.12, y: y0), CGPoint(x: x0 + unit * 0.3, y: y0),
                                     CGPoint(x: x0 + unit * 0.02, y: y0 + unit * 0.55), CGPoint(x: x0 - unit * 0.14, y: y0 + unit * 0.55)])
                p.closeSubpath(); ctx.addPath(p); ctx.fillPath()
                penX += quoteAdv; continue
            }
            for poly in segmentPolys(ch) {
                let p = CGMutablePath()
                p.addLines(between: poly.map { pt in
                    let yy = pt.y * unit
                    return CGPoint(x: penX + pt.x * unit + (charH - yy) * skew, y: baseY + yy)
                })
                p.closeSubpath(); ctx.addPath(p)
            }
            ctx.fillPath()
            penX += advance
        }
        guard let cg = ctx.makeImage() else { return nil }
        stampCache = (key, cg, pad)
        return (cg, pad)
    }

    /// 把日期（例如 "'25 11 23"）用橘紅色七段字印在右下角。input、output 都是線性光
    static func stampDate(_ text: String, on input: CIImage) -> CIImage {
        let e = input.extent
        let short = min(e.width, e.height)
        let charH = (short * 0.034).rounded()
        guard charH >= 4, let made = stampImage(text, charH: charH) else { return input }
        let (cg, pad) = made
        let unit = charH / 1.75
        var stamp = CIImage(cgImage: cg)   // 讀進來會轉成工作色域（線性）
        let margin = short * 0.045
        let tx = e.maxX - CGFloat(cg.width) - margin + CGFloat(pad), ty = e.minY + margin - CGFloat(pad)
        stamp = stamp.transformed(by: CGAffineTransform(translationX: tx, y: ty))
        /* 從底片背面印上去：字本身有一點點糊，外面再一圈暈；光是加上去的 */
        let soft = stamp.clampedToExtent().applyingGaussianBlur(sigma: Double(unit) * 0.06).cropped(to: stamp.extent)
        let glow = stamp.clampedToExtent().applyingGaussianBlur(sigma: Double(unit) * 0.55).cropped(to: stamp.extent)
            .applyingFilter("CIColorMatrix", parameters: ["inputRVector": CIVector(x: 0.9, y: 0, z: 0, w: 0),
                                                         "inputGVector": CIVector(x: 0, y: 0.6, z: 0, w: 0),
                                                         "inputBVector": CIVector(x: 0, y: 0, z: 0.5, w: 0),
                                                         "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0)])
        let light = soft.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: glow])
        return light.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: input]).cropped(to: e)
    }

    /// 先把底片的 GPU 程式編譯好（第一次切到底片相機時才不會卡一下）
    private static var warmed = false
    static func prewarm() {
        guard !warmed else { return }
        warmed = true
        DispatchQueue.global(qos: .utility).async {
            let img = CIImage(color: CIColor(red: 0.5, green: 0.4, blue: 0.3)).cropped(to: CGRect(x: 0, y: 0, width: 64, height: 64))
            var f = ABAIFilm(); f.id = "warm"; f.softCorners = 0.5
            _ = ABAIImageCore.context.createCGImage(f.apply(to: img, delta: 0, seed: .zero), from: img.extent)
        }
    }
}
