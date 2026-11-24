//
//  ABAIDateStamp.swift
//  ABAI — 相機的日期戳記，以及「底片模式」（RAW）照片的沖洗
//
//  日期：橘紅色七段顯示器的字（'25 11 23），像底片相機從底片背面印上去的 —— 加光、帶一點暈。
//       觀景窗與拍出來的照片同一個位置（右下角），網頁那邊：utils/dateStamp.ts
//
//  底片模式：開 RAW 時相機刻意少曝光 1 格，保護亮部（RAW 的暗部之後拉得回來，爆掉的亮部救不回來），
//       所以觀景窗看起來暗暗的。存下來的那張成品照片再沖回 +1 格，亮部用肩部柔柔地收，不會爆。
//

import Foundation
import CoreImage
import CoreGraphics
import UIKit

enum ABAIDateStamp {

    /// 曝光補償＋亮部柔收（在線性光上）：中間調照常乘 2^ev，接近白的地方慢慢收到 1，不會一刀切掉
    private static let developKernel = CIColorKernel(source: """
    kernel vec4 abaiDevelop(__sample s, float gain) {
        vec3 x = max(s.rgb, vec3(0.0)) * gain;
        vec3 k = vec3(0.6);
        vec3 over = max(x - k, vec3(0.0));
        vec3 y = min(x, k) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
        return vec4(y, s.a);
    }
    """)

    /// 底片模式拍的照片沖回來：ev 格（通常是 +1）
    static func develop(_ input: CIImage, ev: Double) -> CIImage {
        guard abs(ev) > 0.001, let k = developKernel else { return input }
        return k.apply(extent: input.extent, arguments: [input, pow(2, ev)]) ?? input
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

    /// 一個七段字的線段（單位：字高 1.75、字寬 1）。真的七段顯示器那樣：
    ///   ‧ 直的永遠是上、下兩段，在中間接起來（中間那個尖尖的接點），「1」也是兩段，不是一整根
    ///   ‧ 每個字一樣高：直的那段外側那一端，旁邊有橫的就跟它接、沒有橫的（1、4、7 的頂或底）就把尖端伸到字的最頂（最底），
    ///     不然 1、4、7 會比別的字矮一截
    static func segmentPolys(_ ch: Character) -> [[CGPoint]] {
        guard let segs = digitSegs[ch] else { return [] }
        let w: CGFloat = 1, h: CGFloat = 1.75, t: CGFloat = 0.2, g: CGFloat = 0.035
        let has = { (c: Character) in segs.contains(c) }
        func hseg(_ y: CGFloat) -> [CGPoint] {
            let x0 = t / 2 + g, x1 = w - t / 2 - g
            return [CGPoint(x: x0, y: y), CGPoint(x: x0 + t / 2, y: y - t / 2), CGPoint(x: x1 - t / 2, y: y - t / 2),
                    CGPoint(x: x1, y: y), CGPoint(x: x1 - t / 2, y: y + t / 2), CGPoint(x: x0 + t / 2, y: y + t / 2)]
        }
        /// 直的一段：兩端都是尖的，尖端在 a、b
        func vseg(_ x: CGFloat, _ a: CGFloat, _ b: CGFloat) -> [CGPoint] {
            [CGPoint(x: x, y: a), CGPoint(x: x + t / 2, y: a + t / 2), CGPoint(x: x + t / 2, y: b - t / 2),
             CGPoint(x: x, y: b), CGPoint(x: x - t / 2, y: b - t / 2), CGPoint(x: x - t / 2, y: a + t / 2)]
        }
        let top = t / 2, mid = h / 2, bot = h - t / 2
        /* 外側那一端：有橫的就跟它留一點縫接起來；沒有就伸到最頂／最底 */
        let upperA = has("a") ? top + g : 0, lowerB = has("d") ? bot - g : h
        var out: [[CGPoint]] = []
        if has("a") { out.append(hseg(top)) }
        if has("g") { out.append(hseg(mid)) }
        if has("d") { out.append(hseg(bot)) }
        if has("f") { out.append(vseg(t / 2, upperA, mid - g)) }
        if has("b") { out.append(vseg(w - t / 2, upperA, mid - g)) }
        if has("e") { out.append(vseg(t / 2, mid + g, lowerB)) }
        if has("c") { out.append(vseg(w - t / 2, mid + g, lowerB)) }
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

    /// 把日期（例如 "'25 11 23"）用橘紅色七段字印在照片上 —— 跟底片相機一樣，字一定沿著照片的「長邊」：
    ///   橫的照片：右下角、橫著寫；直的照片：右邊靠上、字轉 90°（由下往上讀）——
    ///   就像底片相機直拿著拍，字印在底片（橫的）右下角，照片轉正之後看到的位置。
    /// region：照片實際的範圍（觀景窗有小框構圖時，只有框裡面那一塊會變成照片）。
    /// uprightTurns：這張圖要逆時針轉幾個 90° 才是照片擺正的樣子（觀景窗在手機橫拿時用；照片本身已經擺正＝0）。
    /// input、output 都是線性光。
    static func stampDate(_ text: String, on input: CIImage, region: CGRect? = nil, uprightTurns: Int = 0) -> CIImage {
        let full = input.extent
        guard full.width > 1, full.height > 1, !full.isInfinite else { return input }
        let r0 = region.map { $0.intersection(full) }.flatMap { $0.isNull || $0.width < 8 ? nil : $0 } ?? full
        /* 直的、橫的都一樣：字正著印在照片的右下角（以前直的會把字轉 90° 沿著右邊印） */
        let turns = ((uprightTurns % 4) + 4) % 4
        if turns == 0 { return stampLandscape(text, on: input, region: r0) }
        /* 整張轉成「字橫著印」的方向、印好、再轉回來（90° 的倍數，沒有重新取樣的損失） */
        let ang = CGFloat(turns) * .pi / 2
        let newW = turns % 2 == 0 ? full.width : full.height, newH = turns % 2 == 0 ? full.height : full.width
        let m = CGAffineTransform(translationX: -full.midX, y: -full.midY)
            .concatenating(CGAffineTransform(rotationAngle: ang))
            .concatenating(CGAffineTransform(translationX: newW / 2, y: newH / 2))
        let rotated = input.transformed(by: m)
        let rr = r0.applying(m).integral
        let stamped = stampLandscape(text, on: rotated, region: rr)
        return stamped.transformed(by: m.inverted()).cropped(to: full)
    }

    private static func stampLandscape(_ text: String, on input: CIImage, region: CGRect) -> CIImage {
        let full = input.extent
        let e = region
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
        return light.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: input]).cropped(to: full)
    }
}
