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
        CAPPluginMethod(name: "beginBackgroundTask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endBackgroundTask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
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
        let format = ABAIImageCore.Format(rawValue: call.getString("format") ?? "jpeg") ?? .jpeg
        let quality = call.getDouble("quality") ?? 0.95
        let maxPixel = call.getInt("maxPixel") ?? 0
        let amount = call.getDouble("amount") ?? 1
        let wantHDR = call.getBool("hdr") ?? false
        let lutName = call.getString("lut")
        let cubeB64 = call.getString("cube"), cubeSize = call.getInt("cubeSize") ?? 0
        let aspect = call.getDouble("aspect") ?? 0          // 寬÷高；有給就從中間裁成這個比例
        let zoom = max(1, call.getDouble("zoom") ?? 1)      // 再從中間放大裁切（相機的小框構圖）
        queue.async {
            autoreleasepool {
                var image: CIImage?
                if maxPixel > 0, let cg = ABAIImageCore.downsample(url, maxPixel: maxPixel) { image = CIImage(cgImage: cg) }
                else { image = ABAIImageCore.ciImage(url, expandHDR: wantHDR) }
                guard var img = image else { call.reject("讀不出影像"); return }
                if aspect > 0 || zoom > 1.001 {
                    var e = img.extent
                    if aspect > 0 {
                        if e.width / e.height > aspect { let w = e.height * aspect; e = CGRect(x: e.midX - w / 2, y: e.minY, width: w, height: e.height) }
                        else { let h = e.width / aspect; e = CGRect(x: e.minX, y: e.midY - h / 2, width: e.width, height: h) }
                    }
                    if zoom > 1.001 { e = e.insetBy(dx: e.width * (1 - 1 / zoom) / 2, dy: e.height * (1 - 1 / zoom) / 2) }
                    img = img.cropped(to: e.integral).transformed(by: CGAffineTransform(translationX: -e.integral.minX, y: -e.integral.minY))
                }
                var cube: ABAIImageCore.Cube?
                if let b = cubeB64, cubeSize > 1 { cube = ABAIImageCore.cube(base64: b, size: cubeSize) }
                else if let n = lutName, let u = ABAIImageCore.bundledLut(n) { cube = ABAIImageCore.cube(fromAtlas: u) }
                if let c = cube { img = ABAIImageCore.apply(cube: c, to: img, amount: amount) }
                /* HDR：調完色的結果就是 HDR 那一張；SDR 那一張是把亮部壓回 1.0 以內的版本。
                   原圖本身沒有 HDR 資訊時，兩張一樣，就不帶增益圖。 */
                var hdr: CIImage? = nil
                var sdr = img
                if wantHDR, #available(iOS 18.0, *) {
                    hdr = img
                    sdr = img.applyingFilter("CIToneMapHeadroom", parameters: ["inputTargetHeadroom": 1.0])
                }
                do {
                    let data = try ABAIImageCore.encode(sdr, format: format, quality: quality, hdr: hdr)
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

    /// 只刪 App 自己暫存資料夾裡的檔案
    @objc func remove(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? ""),
              url.standardizedFileURL.path.hasPrefix(ABAIImageCore.tempDir.standardizedFileURL.path) else { call.resolve(); return }
        try? FileManager.default.removeItem(at: url)
        call.resolve()
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
