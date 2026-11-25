//
//  NativeImagePlugin.swift
//  ABAI — 讀圖、縮圖、存檔、記憶體預算的原生端
//
//  網頁那邊的對應：utils/nativeImage.ts
//    ‧ memory：系統現在還讓這個 App 用多少記憶體（os_proc_available_memory），
//      網頁的照片快取預算照這個數字調，而不是寫死一個值。
//    ‧ downsample：用 ImageIO 在解碼時就縮小，網頁拿到的是已經縮好的小檔，
//      WebKit 完全不必解開整張原圖。
//    ‧ render：原圖在原生端用 16 位元浮點、線性 P3 套色彩表，直接編成 JPEG／HEIC／10 位元 HEIC，
//      必要時帶 HDR 增益圖。整張原圖不經過網頁，也不受網頁的記憶體上限限制。
//    ‧ encode：把網頁合成好的成品轉成 HEIC／10 位元 HEIC／P3 JPEG。
//    ‧ beginBackgroundTask／endBackgroundTask：存檔時切到背景也能做完。
//

import Foundation
import Capacitor
import CoreImage
import UIKit
import os
import Vision

@objc(NativeImagePlugin)
public class NativeImagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeImagePlugin"
    public let jsName = "NativeImage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "memory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downsample", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeTemp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendTemp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "encode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "persist", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepDir", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginBackgroundTask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endBackgroundTask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "subjectMask", returnType: CAPPluginReturnPromise),
    ]

    /// 縮圖、編碼都是重工作：用一條序列佇列，同時只做一件，記憶體尖峰可預期
    private let queue = DispatchQueue(label: "abai.nativeimage", qos: .userInitiated)
    private var tasks: [Int: UIBackgroundTaskIdentifier] = [:]
    private var nextTask = 1

    @objc func available(_ call: CAPPluginCall) { call.resolve(["available": true]) }

    @objc func capabilities(_ call: CAPPluginCall) {
        var hdr = false, heic10 = true
        if #available(iOS 18.0, *) { hdr = true }
        if #unavailable(iOS 15.0) { heic10 = false }
        let screen = UIScreen.main
        var headroom = 1.0
        if #available(iOS 16.0, *) { headroom = Double(screen.potentialEDRHeadroom) }
        call.resolve(["hdrGainMap": hdr, "heic10": heic10, "edrHeadroom": headroom])
    }

    /// available：系統現在還讓這個 App 再用多少位元組（超過就會被系統關掉）
    @objc func memory(_ call: CAPPluginCall) {
        let avail = os_proc_available_memory()
        call.resolve([
            "available": Double(avail),
            "physical": Double(ProcessInfo.processInfo.physicalMemory),
        ])
    }

    @objc func info(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? ""),
              let size = ABAIImageCore.pixelSize(of: url) else { call.reject("讀不到這個檔案"); return }
        call.resolve(["width": Int(size.width), "height": Int(size.height), "hdr": ABAIImageCore.hasGainMap(url)])
    }

    /// subjectMask({ path, kind: 'subject' | 'person' }) → { path, width, height }：遮色片的「自動選取」。
    /// 用 iOS 內建的影像分析（照片 App「拷貝主體」同一套）：
    ///   subject：畫面裡的主體（人、動物、物品都算；iOS 17 起）
    ///   person ：人物（精細模式，頭髮邊緣也算；iOS 15 起）
    /// 輸入先縮到長邊 1536 再分析（夠精細、記憶體固定在幾十 MB 內，不會因為原圖很大而吃爆），
    /// 輸出一張灰階 PNG（白＝選到），網頁再放大到照片的尺寸使用。
    @objc func subjectMask(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? "") else { call.reject("沒有路徑"); return }
        let kind = call.getString("kind") ?? "subject"
        queue.async {
            autoreleasepool {
                do {
                    guard let src = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else { call.reject("讀不到這張照片"); return }
                    let ext = src.extent
                    let scale = min(1, 1536 / max(ext.width, ext.height))
                    let small = src.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                    let sw = Int(small.extent.width.rounded()), sh = Int(small.extent.height.rounded())
                    guard sw > 8, sh > 8,
                          let cg = ABAIImageCore.context.createCGImage(small, from: CGRect(x: small.extent.minX, y: small.extent.minY, width: CGFloat(sw), height: CGFloat(sh))) else { call.reject("縮小失敗"); return }
                    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
                    var mask: CIImage? = nil
                    if kind == "person" {
                        let req = VNGeneratePersonSegmentationRequest()
                        req.qualityLevel = .accurate
                        req.outputPixelFormat = kCVPixelFormatType_OneComponent8
                        try handler.perform([req])
                        if let pb = req.results?.first?.pixelBuffer { mask = CIImage(cvPixelBuffer: pb) }
                    } else {
                        guard #available(iOS 17.0, *) else { call.reject("需要 iOS 17 以上"); return }
                        let req = VNGenerateForegroundInstanceMaskRequest()
                        try handler.perform([req])
                        if let obs = req.results?.first {
                            let pb = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler)
                            mask = CIImage(cvPixelBuffer: pb)
                        }
                    }
                    guard let m = mask, m.extent.width > 0 else { call.reject("沒有找到"); return }
                    /* 人物分割在沒有人的照片上也會回一張全黑的遮罩：最亮的地方都很暗＝沒有找到 */
                    let maxF = CIFilter(name: "CIAreaMaximum", parameters: [kCIInputImageKey: m, kCIInputExtentKey: CIVector(cgRect: m.extent)])
                    if let mx = maxF?.outputImage {
                        var px = [UInt8](repeating: 0, count: 4)
                        ABAIImageCore.context.render(mx, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
                        if px[0] < 40 { call.reject("沒有找到"); return }
                    }
                    /* 遮罩跟縮小後的照片對齊（人物分割輸出的尺寸可能不同）：拉到 sw×sh */
                    let fitted = m.transformed(by: CGAffineTransform(scaleX: CGFloat(sw) / m.extent.width, y: CGFloat(sh) / m.extent.height))
                    let out = ABAIImageCore.newFileURL(ext: "png")
                    let gray = CGColorSpaceCreateDeviceGray()
                    try ABAIImageCore.context.writePNGRepresentation(of: fitted, to: out, format: .L8, colorSpace: gray, options: [:])
                    call.resolve(["path": out.path, "width": sw, "height": sh])
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }

    /// 縮小解碼並存成小檔。有透明的存 PNG，其餘存 P3 JPEG。
    @objc func downsample(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? "") else { call.reject("沒有路徑"); return }
        let maxPixel = call.getInt("maxPixel") ?? 1024
        let quality = call.getDouble("quality") ?? 0.95
        queue.async {
            autoreleasepool {
                guard let img = ABAIImageCore.downsample(url, maxPixel: maxPixel) else { call.reject("讀不出影像"); return }
                let alpha = ABAIImageCore.hasAlpha(img)
                let out = ABAIImageCore.newFileURL(ext: alpha ? "png" : "jpg")
                do {
                    try ABAIImageCore.write(img, to: out, format: alpha ? .png : .jpeg, quality: quality)
                    call.resolve(["path": out.path, "width": img.width, "height": img.height])
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }

    /// 網頁的 Blob（沒有原生路徑的檔案）先寫到暫存，之後就能用路徑處理
    @objc func writeTemp(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("沒有資料"); return }
        let ext = call.getString("ext") ?? "bin"
        queue.async {
            let out = ABAIImageCore.newFileURL(ext: ext)
            do { try data.write(to: out); call.resolve(["path": out.path]) }
            catch { call.reject(error.localizedDescription) }
        }
    }

    /// 分段寫檔：大檔案一次用 base64 傳過來會太大，切成幾 MB 一段依序接上。
    /// 第一段不給 path（建新檔），之後每段帶上一段回傳的 path
    @objc func appendTemp(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("沒有資料"); return }
        let ext = call.getString("ext") ?? "bin"
        let given = call.getString("path").flatMap { ABAIImageCore.fileURL(from: $0) }
        queue.async {
            let url = given ?? ABAIImageCore.newFileURL(ext: ext)
            do {
                if given == nil || !FileManager.default.fileExists(atPath: url.path) {
                    try data.write(to: url)
                } else {
                    let h = try FileHandle(forWritingTo: url)
                    defer { try? h.close() }
                    try h.seekToEnd()
                    try h.write(contentsOf: data)
                }
                call.resolve(["path": url.path])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    /// 原生全解析度輸出：原圖 → （色彩表）→ 編碼。
    /// 參數：path、format（jpeg／heic／heic10／png）、quality、maxPixel（0＝原尺寸）、
    ///      lut（App 內建 LUT 檔名，例如 f3.webp）或 cube＋cubeSize（網頁算好的色彩表）、amount、hdr（帶增益圖）
    @objc func render(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? "") else { call.reject("沒有路徑"); return }
        var format = ABAIImageCore.Format(rawValue: call.getString("format") ?? "jpeg") ?? .jpeg
        let quality = call.getDouble("quality") ?? 0.95
        /* 拍攝資訊要從哪個檔讀（RAW：原本的 RAW 檔；不給＝就是 path 那張） */
        let metaURL = call.getString("metaPath").flatMap { ABAIImageCore.fileURL(from: $0) }
        let maxPixel = call.getInt("maxPixel") ?? 0
        let amount = call.getDouble("amount") ?? 1
        // HDR 只在原圖真的帶增益圖時才做：沒有的照片寫一張一樣的增益圖只是白白變大
        let wantHDR = (call.getBool("hdr") ?? false) && ABAIImageCore.hasGainMap(url)
        // 修圖存檔：色彩表只套在 sRGB 範圍內，超出的廣色域與 HDR 亮部另外補回（見 ABAIImageCore.applyKeepingGamut）
        let keepGamut = call.getBool("keepGamut") ?? false
        let cubePath = call.getString("cubePath")
        let basePath = call.getString("basePath")             // 網頁算好的成品（有局部、空間類的編輯時）
        /* baseOnly：畫面完全用網頁的成品，原生只負責編碼成指定格式、寫入原圖的拍攝資訊（不補色、不動任何像素） */
        let baseOnly = call.getBool("baseOnly") ?? false
        if wantHDR && format == .heic10 { format = .heic }   // 帶增益圖的 HDR 照片用系統標準的 8 位元 HEIC＋增益圖
        let lutName = call.getString("lut")
        let cubeB64 = call.getString("cube"), cubeSize = call.getInt("cubeSize") ?? 0
        let aspect = call.getDouble("aspect") ?? 0          // 寬÷高；有給就從中間裁成這個比例
        let zoom = max(1, call.getDouble("zoom") ?? 1)      // 再從中間放大裁切（相機的小框構圖）
        let fx = ABAICameraFx(call.getObject("fx"))          // 相機特效（跟觀景窗同一套）
        let kelvin = call.getDouble("kelvin")                // 相機色溫（跟觀景窗同一條公式）
        let develop = call.getDouble("develop") ?? 0         // 底片模式：少曝光拍的照片沖回幾格（見 ABAIDateStamp.swift）
        let dateText = call.getString("date").flatMap { $0.isEmpty ? nil : $0 }   // 日期戳記
        let gps = call.getObject("gps")                      // 拍照地點（相機開了「位置」時）
        /* 編輯器的構圖：3×3 投影矩陣＋輸出尺寸（見 ABAIImageCore.warp） */
        let homography = (call.getArray("homography") as? [NSNumber])?.map { $0.doubleValue }
        let outW = call.getInt("outW") ?? 0, outH = call.getInt("outH") ?? 0
        queue.async {
            autoreleasepool {
                var image: CIImage?
                if maxPixel > 0, let cg = ABAIImageCore.downsample(url, maxPixel: maxPixel) { image = CIImage(cgImage: cg) }
                else { image = ABAIImageCore.ciImage(url, expandHDR: wantHDR) }
                guard var img = image else { call.reject("讀不出影像"); return }
                if let hm = homography {
                    guard let w = ABAIImageCore.warp(img, homography: hm, outW: outW, outH: outH) else { call.reject("構圖失敗"); return }
                    img = w
                }
                if aspect > 0 || zoom > 1.001 {
                    var e = img.extent
                    if aspect > 0 {
                        if e.width / e.height > aspect { let w = e.height * aspect; e = CGRect(x: e.midX - w / 2, y: e.minY, width: w, height: e.height) }
                        else { let h = e.width / aspect; e = CGRect(x: e.minX, y: e.midY - h / 2, width: e.width, height: h) }
                    }
                    if zoom > 1.001 { e = e.insetBy(dx: e.width * (1 - 1 / zoom) / 2, dy: e.height * (1 - 1 / zoom) / 2) }
                    img = img.cropped(to: e.integral).transformed(by: CGAffineTransform(translationX: -e.integral.minX, y: -e.integral.minY))
                }
                if let k = kelvin { img = ABAIImageCore.kelvin(img, k) }
                if abs(develop) > 0.001 { img = ABAIDateStamp.develop(img, ev: develop) }
                var cube: ABAIImageCore.Cube?
                if let cp = cubePath, cubeSize > 1, let u = ABAIImageCore.fileURL(from: cp), let d = try? Data(contentsOf: u) { cube = ABAIImageCore.cube(data: d, size: cubeSize) }
                else if let b = cubeB64, cubeSize > 1 { cube = ABAIImageCore.cube(base64: b, size: cubeSize) }
                else if let n = lutName, let u = ABAIImageCore.bundledLut(n) { cube = ABAIImageCore.cube(fromAtlas: u) }
                if baseOnly, let bp = basePath, let bu = ABAIImageCore.fileURL(from: bp), let base = ABAIImageCore.ciImage(bu) {
                    img = base
                } else if keepGamut, let bp = basePath, let bu = ABAIImageCore.fileURL(from: bp), let base = ABAIImageCore.ciImage(bu) {
                    img = ABAIImageCore.keepGamut(edited: base, original: img)
                } else if let c = cube { img = keepGamut ? ABAIImageCore.applyKeepingGamut(cube: c, to: img) : ABAIImageCore.apply(cube: c, to: img, amount: amount) }
                if keepGamut { img = ABAIImageCore.uprightProperties(img) }
                if fx.isOn { img = fx.apply(to: img) }
                if let d = dateText { img = ABAIDateStamp.stampDate(d, on: img) }
                /* HDR：調完色的結果就是 HDR 那一張；SDR 那一張是把亮部壓回 1.0 以內的版本。
                   原圖本身沒有 HDR 資訊時，兩張一樣，就不帶增益圖。 */
                var hdr: CIImage? = nil
                var sdr = img
                if wantHDR, #available(iOS 18.0, *) {
                    hdr = img
                    sdr = img.applyingFilter("CIToneMapHeadroom", parameters: ["inputTargetHeadroom": 1.0])
                }
                /* 套了濾鏡、又要存成 8 位元（JPEG／一般 HEIC）：存檔前加約一階的抖色。
                   色彩表在漸層（天空、皮膚）上會讓相鄰顏色擠在一起，直接截成 8 位元就是一圈一圈的色階；
                   跟網頁編輯頁的著色器同一招（±½ 階），肉眼看不到雜訊，但色階會被打散。10 位元不需要。 */
                if cube != nil && format != .heic10 { sdr = ABAIImageCore.dither(sdr) }
                do {
                    /* baseOnly：網頁成品是 sRGB，照 sRGB 存（像素不轉色彩空間，跟網頁成品一模一樣） */
                    var data = try ABAIImageCore.encode(sdr, format: format, quality: quality, hdr: hdr, space: baseOnly ? CGColorSpace(name: CGColorSpace.sRGB) : nil)
                    /* 原圖的拍攝資訊（機型、鏡頭、光圈、快門、ISO、拍攝時間、GPS）帶進成品（只動檔頭、不重新壓縮） */
                    data = ABAIImageCore.copyMetadata(data, from: metaURL ?? url)
                    if let g = gps, let lat = (g["lat"] as? NSNumber)?.doubleValue, let lon = (g["lon"] as? NSNumber)?.doubleValue {
                        let t = (g["time"] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue) } ?? Date()
                        data = ABAIImageCore.addGPS(data, lat: lat, lon: lon, alt: (g["alt"] as? NSNumber)?.doubleValue, time: t)
                    }
                    let out = ABAIImageCore.newFileURL(ext: format == .png ? "png" : (format == .jpeg ? "jpg" : "heic"))
                    try data.write(to: out)
                    call.resolve(["path": out.path, "width": Int(img.extent.width), "height": Int(img.extent.height)])
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }

    /// 網頁合成好的成品（path 或 base64）轉成指定格式
    @objc func encode(_ call: CAPPluginCall) {
        let format = ABAIImageCore.Format(rawValue: call.getString("format") ?? "heic") ?? .heic
        let quality = call.getDouble("quality") ?? 0.97
        let path = call.getString("path"), b64 = call.getString("data")
        queue.async {
            autoreleasepool {
                var src: URL?
                if let p = path { src = ABAIImageCore.fileURL(from: p) }
                else if let b = b64, let d = Data(base64Encoded: b) {
                    let u = ABAIImageCore.newFileURL(ext: "png"); try? d.write(to: u); src = u
                }
                guard let s = src, let img = ABAIImageCore.ciImage(s) else { call.reject("讀不出影像"); return }
                do {
                    let data = try ABAIImageCore.encode(img, format: format, quality: quality)
                    let out = ABAIImageCore.newFileURL(ext: format == .png ? "png" : (format == .jpeg ? "jpg" : "heic"))
                    try data.write(to: out)
                    if b64 != nil { try? FileManager.default.removeItem(at: s) }
                    call.resolve(["path": out.path])
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }

    /// 只刪 App 自己的檔案（暫存資料夾、相機相簿資料夾）
    @objc func remove(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? "") else { call.resolve(); return }
        let p = url.standardizedFileURL.path
        guard p.hasPrefix(ABAIImageCore.tempDir.standardizedFileURL.path) || p.hasPrefix(ABAIImageCore.keepDir.standardizedFileURL.path) else { call.resolve(); return }
        try? FileManager.default.removeItem(at: url)
        call.resolve()
    }

    /// 相機相簿資料夾現在的位置。App 更新後整個 App 資料夾的路徑會換（檔案還在），網頁要用這個把記住的舊路徑換過來
    /// 也可以帶 paths：回傳其中已經不存在的（missing）
    @objc func keepDir(_ call: CAPPluginCall) {
        let paths = (call.getArray("paths") as? [String]) ?? []
        let missing = paths.filter { p in
            guard let u = ABAIImageCore.fileURL(from: p) else { return true }
            return !FileManager.default.fileExists(atPath: u.path)
        }
        call.resolve(["path": ABAIImageCore.keepDir.standardizedFileURL.path, "missing": missing])
    }

    /// 暫存資料夾裡的檔案搬進相機相簿資料夾（永久保存），回傳新路徑。已經在裡面就原樣回傳
    @objc func persist(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? "") else { call.reject("沒有路徑"); return }
        queue.async {
            let keep = ABAIImageCore.keepDir.standardizedFileURL.path
            if url.standardizedFileURL.path.hasPrefix(keep) { call.resolve(["path": url.path]); return }
            let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
            let dest = ABAIImageCore.keepDir.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
            do {
                if url.standardizedFileURL.path.hasPrefix(ABAIImageCore.tempDir.standardizedFileURL.path) { try FileManager.default.moveItem(at: url, to: dest) }
                else { try FileManager.default.copyItem(at: url, to: dest) }
                call.resolve(["path": dest.path])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    /// 存檔開始時呼叫：切到背景後系統會再多給幾十秒把事情做完
    @objc func beginBackgroundTask(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let id = self.nextTask; self.nextTask += 1
            var task: UIBackgroundTaskIdentifier = .invalid
            task = UIApplication.shared.beginBackgroundTask(withName: call.getString("name") ?? "abai-export") { [weak self] in
                UIApplication.shared.endBackgroundTask(task)
                self?.tasks[id] = nil
                self?.notifyListeners("backgroundTaskExpired", data: ["id": id])
            }
            self.tasks[id] = task
            call.resolve(["id": id])
        }
    }

    @objc func endBackgroundTask(_ call: CAPPluginCall) {
        let id = call.getInt("id") ?? 0
        DispatchQueue.main.async {
            if let t = self.tasks.removeValue(forKey: id) { UIApplication.shared.endBackgroundTask(t) }
            call.resolve()
        }
    }
}
