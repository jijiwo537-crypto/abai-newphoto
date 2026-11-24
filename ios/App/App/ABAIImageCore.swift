//
//  ABAIImageCore.swift
//  ABAI — 原生影像核心（App 與相簿編輯擴充共用）
//
//  所有原生外掛共用這一份：
//    ‧ 一個 Core Image context：工作色域是「線性、可延伸的 Display P3」，中間結果用 16 位元浮點。
//      調色時不會因為 8 位元而出現色階斷層，超過 1.0 的亮部（HDR）也不會被切掉。
//    ‧ ImageIO 縮小解碼：讀檔時就只解出需要的大小，4800 萬像素的照片不必整張解開。
//    ‧ 編碼：JPEG（P3）、HEIC、10 位元 HEIC，以及 iOS 18 起帶增益圖的 HDR。
//    ‧ 濾鏡 LUT：讀網頁那邊同一批 8×8 分塊的 webp，換成 Core Image 的 3D 色彩表。
//

import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import UIKit

/// App 和相簿編輯擴充共用的編輯清單格式（存在 Photos 的 adjustmentData 裡）
enum ABAIAdjustment {
    static let formatIdentifier = "com.abai.photo.edits"
    static let formatVersion = "1"
}

enum ABAIImageCore {

    // MARK: 色域與 context

    static let linearP3 = CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!
    static let displayP3 = CGColorSpace(name: CGColorSpace.displayP3)!
    static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

    /// 共用的 context。每次新建會重新配置 GPU 資源，所以整個 App 只有一個。
    static let context: CIContext = CIContext(options: [
        .workingColorSpace: linearP3,
        .workingFormat: CIFormat.RGBAh,
        .cacheIntermediates: false,
    ])

    // MARK: 暫存檔

    /// App 自己的暫存資料夾。系統空間不夠時會清這裡，所以只放「可以重做」的東西。
    static let tempDir: URL = {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("abai", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    /// 相機的相簿（App 裡那一個）的照片：放在 Application Support，不會被系統清暫存清掉、App 更新也還在
    static let keepDir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("abai-camera-roll", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static func newFileURL(ext: String) -> URL {
        tempDir.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
    }

    /// 網頁傳來的路徑可能帶 file:// 或 capacitor 的前綴，統一成檔案 URL
    static func fileURL(from path: String) -> URL? {
        if path.hasPrefix("file://") { return URL(string: path) }
        if let r = path.range(of: "/_capacitor_file_") {
            return URL(fileURLWithPath: String(path[r.upperBound...]).removingPercentEncoding ?? String(path[r.upperBound...]))
        }
        if path.hasPrefix("/") { return URL(fileURLWithPath: path) }
        return nil
    }

    // MARK: 讀取

    /// 原圖的像素尺寸（已經照 EXIF 方向轉正）。只讀檔頭，不解碼。
    static func pixelSize(of url: URL) -> CGSize? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Int,
              let h = props[kCGImagePropertyPixelHeight] as? Int else { return nil }
        let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
        return orientation >= 5 ? CGSize(width: h, height: w) : CGSize(width: w, height: h)
    }

    /// 縮小解碼：長邊最多 maxPixel，轉正方向，保留原本的色彩描述檔。
    /// 對 JPEG／HEIC，ImageIO 會在解碼時就降取樣，記憶體只花在小圖上。
    static func downsample(_ url: URL, maxPixel: Int) -> CGImage? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixel),
        ]
        return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
    }

    /// 讀成 Core Image 影像（轉正方向）。expandHDR：照片帶 HDR 增益圖時，展開成真正的高動態範圍（iOS 18 起）。
    /// 編輯器的構圖（裁切、旋轉、翻轉、微調角度、梯形、縮放平移）：網頁算好的 3×3 投影矩陣（列優先，
    /// 「輸出像素 ← 原圖像素」，座標原點在左上、y 往下，見 utils/compose.ts 的 geoHomography），輸出 outW×outH。
    /// 在原生的浮點流程裡做，構圖過的照片存檔也不會先降成 8 位元
    static func warp(_ input: CIImage, homography m: [Double], outW: Int, outH: Int) -> CIImage? {
        guard m.count == 9, outW > 0, outH > 0 else { return nil }
        let e = input.extent
        guard e.width > 0, e.height > 0, !e.isInfinite else { return nil }
        let img = input.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
        let W = Double(e.width), H = Double(e.height), oh = Double(outH)
        /* 原圖的一個角（網頁座標）→ 輸出的位置（Core Image 座標，y 往上） */
        func corner(_ x: Double, _ y: Double) -> CIVector? {
            let w = m[6] * x + m[7] * y + m[8]
            guard abs(w) > 1e-12 else { return nil }
            return CIVector(x: (m[0] * x + m[1] * y + m[2]) / w, y: oh - (m[3] * x + m[4] * y + m[5]) / w)
        }
        guard let tl = corner(0, 0), let tr = corner(W, 0), let br = corner(W, H), let bl = corner(0, H),
              let f = CIFilter(name: "CIPerspectiveTransform") else { return nil }
        f.setValue(img, forKey: kCIInputImageKey)
        f.setValue(tl, forKey: "inputTopLeft"); f.setValue(tr, forKey: "inputTopRight")
        f.setValue(br, forKey: "inputBottomRight"); f.setValue(bl, forKey: "inputBottomLeft")
        return f.outputImage?.cropped(to: CGRect(x: 0, y: 0, width: outW, height: outH))
    }

    static func ciImage(_ url: URL, expandHDR: Bool = false) -> CIImage? {
        var opts: [CIImageOption: Any] = [.applyOrientationProperty: true]
        if expandHDR, #available(iOS 18.0, *) { opts[.expandToHDR] = true }
        return CIImage(contentsOf: url, options: opts)
    }

    /// 這張照片有沒有 HDR 增益圖（iPhone 拍的 HDR 照片、iOS 18 的 ISO 增益圖）
    static func hasGainMap(_ url: URL) -> Bool {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return false }
        if CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, kCGImageAuxiliaryDataTypeHDRGainMap) != nil { return true }
        if #available(iOS 18.0, *) {
            if CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, kCGImageAuxiliaryDataTypeISOGainMap) != nil { return true }
        }
        return false
    }

    /// 不透明度：檔案格式本身可能帶透明（PNG、HEIC 也可以）
    static func hasAlpha(_ image: CGImage) -> Bool {
        switch image.alphaInfo {
        case .none, .noneSkipFirst, .noneSkipLast: return false
        default: return true
        }
    }

    // MARK: 編碼

    enum Format: String { case jpeg, heic, heic10, png }

    enum CoreError: LocalizedError {
        case decode, encode, unsupported(String)
        var errorDescription: String? {
            switch self {
            case .decode: return "讀不出影像"
            case .encode: return "編碼失敗"
            case .unsupported(let s): return "這台裝置不支援：\(s)"
            }
        }
    }

    /// 把 CGImage 寫成檔案，保留它自己的色彩描述檔（P3 照片維持 P3）
    static func write(_ image: CGImage, to url: URL, format: Format, quality: Double) throws {
        let type: UTType
        switch format {
        case .jpeg: type = .jpeg
        case .png: type = .png
        case .heic, .heic10: type = .heic
        }
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil) else { throw CoreError.encode }
        var props: [CFString: Any] = [:]
        if format != .png { props[kCGImageDestinationLossyCompressionQuality] = quality }
        CGImageDestinationAddImage(dest, image, props as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw CoreError.encode }
    }

    /// 把 Core Image 的結果編碼成檔案。hdr 有值時（iOS 18 起）額外寫進增益圖：
    /// 一般螢幕看到的是 SDR 那一張，支援 HDR 的螢幕會用增益圖把亮部真的提亮。
    static func encode(_ image: CIImage, format: Format, quality: Double, hdr: CIImage? = nil) throws -> Data {
        var opts: [CIImageRepresentationOption: Any] = [
            CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality,
        ]
        if let hdr = hdr {
            if #available(iOS 18.0, *) { opts[.hdrImage] = hdr }
        }
        let data: Data?
        switch format {
        case .jpeg:
            data = context.jpegRepresentation(of: image, colorSpace: displayP3, options: opts)
        case .png:
            data = context.pngRepresentation(of: image, format: .RGBA8, colorSpace: displayP3, options: [:])
        case .heic:
            data = context.heifRepresentation(of: image, format: .RGBA8, colorSpace: displayP3, options: opts)
        case .heic10:
            data = try context.heif10Representation(of: image, colorSpace: displayP3, options: opts)
        }
        guard let out = data else { throw CoreError.encode }
        return out
    }

    /// 把拍照地點寫進照片的 GPS 資訊（只動檔頭的中繼資料，不重新壓縮影像）
    static func addGPS(_ data: Data, lat: Double, lon: Double, alt: Double?, time: Date) -> Data {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil), let type = CGImageSourceGetType(src) else { return data }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, type, 1, nil) else { return data }
        let meta = CGImageMetadataCreateMutable()
        let utc = TimeZone(identifier: "UTC") ?? .current
        let df = DateFormatter(); df.timeZone = utc; df.locale = Locale(identifier: "en_US_POSIX"); df.dateFormat = "yyyy:MM:dd"
        let tf = DateFormatter(); tf.timeZone = utc; tf.locale = Locale(identifier: "en_US_POSIX"); tf.dateFormat = "HH:mm:ss.SS"
        var gps: [(CFString, CFTypeRef)] = [
            (kCGImagePropertyGPSLatitude, NSNumber(value: abs(lat))), (kCGImagePropertyGPSLatitudeRef, (lat >= 0 ? "N" : "S") as NSString),
            (kCGImagePropertyGPSLongitude, NSNumber(value: abs(lon))), (kCGImagePropertyGPSLongitudeRef, (lon >= 0 ? "E" : "W") as NSString),
            (kCGImagePropertyGPSDateStamp, df.string(from: time) as NSString), (kCGImagePropertyGPSTimeStamp, tf.string(from: time) as NSString),
        ]
        if let a = alt { gps += [(kCGImagePropertyGPSAltitude, NSNumber(value: abs(a))), (kCGImagePropertyGPSAltitudeRef, NSNumber(value: a < 0 ? 1 : 0))] }
        for (k, v) in gps { CGImageMetadataSetValueMatchingImageProperty(meta, kCGImagePropertyGPSDictionary, k, v) }
        let opts: [CFString: Any] = [kCGImageDestinationMetadata: meta, kCGImageDestinationMergeMetadata: true]
        guard CGImageDestinationCopyImageSource(dest, src, opts as CFDictionary, nil) else { return data }
        return out as Data
    }

    // MARK: 濾鏡 LUT

    struct Cube {
        let size: Int
        let data: Data          // size³ 個 RGBA Float32，紅色變化最快、藍色最慢
    }

    private static var cubeCache: [String: Cube] = [:]
    private static let cubeLock = NSLock()

    /// 讀網頁那批 LUT（8×8 分塊、每塊 size×size：藍色＝第幾塊，塊裡 x＝紅、y＝綠）
    static func cube(fromAtlas url: URL) -> Cube? {
        let key = url.path
        cubeLock.lock(); defer { cubeLock.unlock() }
        if let c = cubeCache[key] { return c }
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
        let w = img.width, h = img.height
        guard w == h, w % 8 == 0 else { return nil }
        /* 8×8 格、共 64 層藍色。每格可能是 64px（相機濾鏡）或更大（低保真那張是 128px）：
           一律做成 64³ 的色彩表，大格子就等距取 64 個點 —— 不能拿格子寬度當層數，會讀出界 */
        let tile = w / 8
        let size = min(tile, 64)
        guard size >= 2 else { return nil }
        let pick = { (n: Int) -> Int in tile == size ? n : Int((Double(n) * Double(tile - 1) / Double(size - 1)).rounded()) }
        // 一律用 sRGB 讀出 8 位元值：LUT 本身就是在 sRGB 編碼值上做的
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let drawn: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        if url.lastPathComponent == "f3.webp" || url.lastPathComponent == "f19.webp" {
            repairAtlas(&px, width: w)
        }
        var floats = [Float](repeating: 0, count: size * size * size * 4)
        var o = 0
        for bi in 0..<size {
            /* 層數不是 64 的時候（小於 64px 的格子）一樣要對到正確的藍色層 */
            let b = size == 64 ? bi : Int((Double(bi) * 63 / Double(size - 1)).rounded())
            let tx = (b % 8) * tile, ty = (b / 8) * tile
            for g in 0..<size {
                for r in 0..<size {
                    let i = ((ty + pick(g)) * w + tx + pick(r)) * 4
                    floats[o] = Float(px[i]) / 255
                    floats[o + 1] = Float(px[i + 1]) / 255
                    floats[o + 2] = Float(px[i + 2]) / 255
                    floats[o + 3] = 1
                    o += 4
                }
            }
        }
        let cube = Cube(size: size, data: floats.withUnsafeBufferPointer { Data(buffer: $0) })
        cubeCache[key] = cube
        return cube
    }

    /// 跟網頁 utils/lutAtlasRepair 同一個修法：只用同一塊內部的資料重建被壓縮污染的塊邊界
    private static func repairAtlas(_ px: inout [UInt8], width w: Int) {
        let tile = w / 8
        func smooth(_ x: Double) -> Double { let t = max(0, min(1, (x - 16) / 16)); return t * t * (3 - 2 * t) }
        for axis in 0..<2 {
            let before = px
            for by in 0..<8 { for bx in 0..<8 {
                for cross in 0..<tile { for side in 0..<2 { for d in 0..<2 { for k in 0..<3 {
                    func coord(_ n: Int) -> Int { side == 1 ? tile - 1 - n : n }
                    func index(_ n: Int) -> Int {
                        let x = bx * tile + (axis == 1 ? cross : coord(n))
                        let y = by * tile + (axis == 1 ? coord(n) : cross)
                        return (y * w + x) * 4 + k
                    }
                    let anchor = Double(before[index(2)])
                    let slope = (Double(before[index(4)]) - anchor) / 2
                    let predicted = max(0, min(255, anchor + Double(d - 2) * slope))
                    let i = index(d), delta = predicted - Double(before[i])
                    px[i] = UInt8(max(0, min(255, (Double(before[i]) + delta * smooth(abs(delta))).rounded())))
                }}}}
            }}
        }
    }

    /// 色溫：跟網頁觀景窗（components/Viewfinder.tsx 的 kelvinGain）同一條公式，在線性光上乘 R、B 增益、亮度不變
    static func kelvin(_ image: CIImage, _ k: Double) -> CIImage {
        let t = (k - 5000) / 5000 * 0.6
        var r = pow(2, t * 0.55), g = 1.0, b = pow(2, -t * 0.55)
        let n = r * 0.2126 + g * 0.7152 + b * 0.0722
        r /= n; g /= n; b /= n
        return image.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: r, y: 0, z: 0, w: 0),
            "inputGVector": CIVector(x: 0, y: g, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: b, w: 0),
        ])
    }

    /// 存成 8 位元前的抖色：約 1/255 的細微雜訊，把濾鏡在漸層上造成的色階打散（肉眼看不到雜訊）
    static func dither(_ image: CIImage) -> CIImage {
        guard let f = CIFilter(name: "CIDither") else { return image }
        f.setValue(image, forKey: kCIInputImageKey)
        f.setValue(1.0 / 255.0, forKey: "inputIntensity")
        return (f.outputImage ?? image).cropped(to: image.extent)
    }

    /// 超出 sRGB 的顏色（廣色域照片裡很亮、很飽和的地方，例如打光的膚色）保持色相收進 sRGB：太飽和的往同亮度的灰收，
    /// 太亮的用一段平滑的肩部收到 1。
    /// 色彩表是在 sRGB 上查的：不先收的話，查表時每個通道各自被截在 0～1，亮部會在某個亮度突然「撞牆」，
    /// 變成一圈生硬的斷層（觀景窗的畫面本來就在 sRGB 裡，所以預覽看不到、成品才有）。工作色域是線性 Display P3
    private static let srgbGamutKernel = CIColorKernel(source: """
    kernel vec4 abaiSrgbGamut(__sample s) {
        vec3 p = s.rgb;
        vec3 c = vec3(dot(vec3(1.22474527, -0.22490439, 0.0), p),
                      dot(vec3(-0.04205797, 1.04208095, 0.0), p),
                      dot(vec3(-0.01964227, -0.07865486, 1.0985372), p));
        /* 負的（比 sRGB 更飽和）：往同亮度的灰收 */
        float l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        float mn = min(min(c.r, c.g), c.b);
        if (mn < 0.0) c = vec3(l) + (c - vec3(l)) * (l / max(l - mn, 1.0e-6));
        /* 超過 1 的（比 sRGB 更亮的飽和色）：最亮的通道從 0.95 開始平滑地收到 1（三個通道等比例，色相不變）。
           斜率在 0.95 連續、到 P3 最亮的紅（1.2247）剛好收到 1 —— 不會突然撞牆變成一圈斷層 */
        float n = max(max(c.r, c.g), c.b);
        if (n > 0.95) {
            float x = min(1.0, (n - 0.95) / (1.2247 - 0.95));
            float f = 0.95 + 0.05 * (1.0 - pow(1.0 - x, (1.2247 - 0.95) / 0.05));
            c *= f / n;
        }
        return vec4(dot(vec3(0.82259286, 0.17753395, 0.0), c),
                    dot(vec3(0.03319952, 0.96678355, 0.0), c),
                    dot(vec3(0.01708535, 0.07239572, 0.91030145), c), s.a);
    }
    """)
    static func intoSrgbGamut(_ image: CIImage) -> CIImage {
        guard let k = srgbGamutKernel else { return image }
        return k.apply(extent: image.extent, arguments: [image]) ?? image
    }

    /// 套 3D 色彩表（在 sRGB 編碼值上查表，跟網頁一致），amount 0～1 跟原圖混合
    static func apply(cube: Cube, to image: CIImage, amount: Double = 1) -> CIImage {
        guard amount > 0.001, let f = CIFilter(name: "CIColorCubeWithColorSpace") else { return image }
        f.setValue(intoSrgbGamut(image), forKey: kCIInputImageKey)
        f.setValue(cube.size, forKey: "inputCubeDimension")
        f.setValue(cube.data, forKey: "inputCubeData")
        f.setValue(sRGB, forKey: "inputColorSpace")
        guard let out = f.outputImage else { return image }
        if amount >= 0.999 { return out }
        guard let mix = CIFilter(name: "CIDissolveTransition") else { return out }
        mix.setValue(image, forKey: kCIInputImageKey)
        mix.setValue(out, forKey: kCIInputTargetImageKey)
        mix.setValue(amount, forKey: kCIInputTimeKey)
        return mix.outputImage ?? out
    }

    /// 網頁直接傳一張色彩表進來（size³ 個 RGBA Float32，base64）
    static func cube(base64: String, size: Int) -> Cube? {
        guard let d = Data(base64Encoded: base64), d.count == size * size * size * 4 * MemoryLayout<Float>.size else { return nil }
        return Cube(size: size, data: d)
    }

    /// 同上，但色彩表放在檔案裡（64³ 的表 base64 有 5MB 多，不適合整包塞進橋接）
    static func cube(data d: Data, size: Int) -> Cube? {
        guard d.count == size * size * size * 4 * MemoryLayout<Float>.size else { return nil }
        return Cube(size: size, data: d)
    }

    static let linearSRGB = CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!

    /* 補回超出 sRGB 的部分。輸入都在工作色域（線性 P3）：
         l＝色彩表的結果（只看得到 sRGB 範圍內），s＝原圖，c＝原圖夾進 sRGB 範圍後的樣子。
       差值 s−c 就是被色彩表「看不到」的那一塊，拆成兩部分補回：
         亮度（HDR 亮部超過 1 的部分）：整份補回；
         色彩（P3 比 sRGB 更鮮豔的部分）：照色彩表保留了多少彩度等比例補 —— 黑白濾鏡就不會透出殘色，
         加飽和的濾鏡最多補回原本那一份。 */
    /* 補回超出 sRGB 的部分。輸入都在工作色域（線性 P3）：
         l＝編輯後的結果（色彩表的結果，或網頁算好的成品；只看得到 sRGB 範圍內），
         s＝原圖，c＝原圖夾進 sRGB 範圍後的樣子。
       差值 s−c 就是編輯「看不到」的那一塊，拆成兩部分補回：
         亮度（HDR 亮部超過 1 的部分）：照編輯把那裡調亮／調暗了多少等比例補（暗角、壓暗的遮色片也會壓到亮部）；
         色彩（P3 比 sRGB 更鮮豔的部分）：照編輯保留了多少彩度等比例補 —— 黑白濾鏡就不會透出殘色，
         加飽和的濾鏡最多補回原本那一份。 */
    private static let gamutKernel: CIColorKernel? = CIColorKernel(source: """
        kernel vec4 abaiKeepGamut(__sample l, __sample s, __sample c) {
            vec3 w = vec3(0.2289746, 0.6917385, 0.0792869);
            vec3 r = s.rgb - c.rgb;
            float yr = dot(r, w);
            vec3 rc = r - vec3(yr);
            float ky = clamp(dot(l.rgb, w) / max(dot(c.rgb, w), 0.0001), 0.0, 2.0);
            float chL = max(max(l.r, l.g), l.b) - min(min(l.r, l.g), l.b);
            float chC = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
            float k = clamp(chL / max(chC, 0.0001), 0.0, 1.0);
            return vec4(l.rgb + vec3(yr * ky) + rc * k, l.a);
        }
        """)

    /// 原圖夾進 sRGB 範圍（線性、工作色域）
    private static func clampedToSRGB(_ image: CIImage) -> CIImage? {
        guard let inSRGB = image.matchedFromWorkingSpace(to: linearSRGB) else { return nil }
        let clampedSRGB = inSRGB.applyingFilter("CIColorClamp", parameters: ["inputMinComponents": CIVector(x: 0, y: 0, z: 0, w: 0),
                                                                            "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1)])
        return clampedSRGB.matchedToWorkingSpace(from: linearSRGB)
    }

    /// 套色彩表，但保留原圖超出 sRGB 的廣色域顏色與 HDR 亮部（sRGB 範圍內的顏色跟 apply 完全一樣）
    static func applyKeepingGamut(cube: Cube, to image: CIImage) -> CIImage {
        guard let k = gamutKernel, let clamped = clampedToSRGB(image) else { return apply(cube: cube, to: image) }
        let l = apply(cube: cube, to: clamped)
        return k.apply(extent: image.extent, arguments: [l, image, clamped]) ?? l
    }

    /// 網頁算好的成品（sRGB）＋原圖超出 sRGB 的部分。兩張大小不一樣（裁切過）就只用成品
    static func keepGamut(edited: CIImage, original: CIImage) -> CIImage {
        guard edited.extent.size == original.extent.size, let k = gamutKernel, let clamped = clampedToSRGB(original) else { return edited }
        let o = original.transformed(by: CGAffineTransform(translationX: edited.extent.minX - original.extent.minX, y: edited.extent.minY - original.extent.minY))
        let c = clamped.transformed(by: CGAffineTransform(translationX: edited.extent.minX - original.extent.minX, y: edited.extent.minY - original.extent.minY))
        return k.apply(extent: edited.extent, arguments: [edited, o, c]) ?? edited
    }

    /// 像素已經轉正了：屬性裡的方向一律改成 1，不然存出去的檔案會被看圖程式再轉一次
    static func uprightProperties(_ image: CIImage) -> CIImage {
        var props = image.properties
        props[kCGImagePropertyOrientation as String] = 1
        if var tiff = props[kCGImagePropertyTIFFDictionary as String] as? [String: Any] {
            tiff[kCGImagePropertyTIFFOrientation as String] = 1
            props[kCGImagePropertyTIFFDictionary as String] = tiff
        }
        return image.settingProperties(props)
    }

    /// App 內建資源（網頁打包進 App 的 public 資料夾）裡的 LUT
    static func bundledLut(_ name: String) -> URL? {
        let clean = (name as NSString).lastPathComponent
        if let u = Bundle.main.url(forResource: "public/luts/\((clean as NSString).deletingPathExtension)", withExtension: (clean as NSString).pathExtension) { return u }
        return Bundle.main.url(forResource: (clean as NSString).deletingPathExtension, withExtension: (clean as NSString).pathExtension)
    }
}
