//
//  RawDecodePlugin.swift
//  ABAI — iOS 原生 RAW 解碼
//
//  已經加進 Xcode 專案（App target），由 MainViewController 登記。
//  網頁那邊會自動偵測到（見 utils/rawNative.ts 的 available()），
//  沒有這支（網頁版）就自動走 LibRaw。
//
//  ── 這支在做什麼 ──────────────────────────────────────────────
//  用 Core Image 的 CIRAWFilter 解 RAW。那是 iOS 系統內建的解碼器，
//  「照片」App 打開 RAW 用的就是同一套：Apple 自己維護各家相機的支援，
//  真正的去馬賽克、相機白平衡、亮部處理都在裡面，而且跑在原生程式碼上、
//  吃得到硬體加速 —— 比 WebAssembly 版的 LibRaw 快很多。
//
//  尚未在真機上驗證。照 Apple 的 CIRAWFilter 文件寫的，介面與錯誤處理都留了退路，
//  第一次在 Xcode 執行時先用一張 RAW 測試。
//

import Foundation
import Capacitor
import CoreImage
import UIKit

@objc(RawDecodePlugin)
public class RawDecodePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RawDecodePlugin"
    public let jsName = "RawDecode"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "decode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "decodeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openEditor", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateEditor", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEditorRect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportEditor", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeEditor", returnType: CAPPluginReturnPromise),
    ]

    // MARK: 即時沖洗（見 ABAIRawDevelop.swift）
    //   openEditor({ path, x, y, w, h, look }) → { asShotTemperature, asShotTint }  原生預覽疊在網頁那一塊透明的位置底下
    //   updateEditor({ params, final })   拖滑桿時每一格送；放手送 final（完整品質）
    //   setEditorRect({ x, y, w, h })  exportEditor({ params }) → { path }  closeEditor()

    private var session: ABAIRawSession?
    private var editorView: ABAIMetalView?
    /// 開沖洗之前網頁是不是本來就透明（相機開著時是）：關掉時還原成原本的樣子，不要把相機的觀景窗蓋掉
    private var webWasTransparent = false

    @objc func openEditor(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? "") else { call.reject("沒有路徑"); return }
        let look = call.getObject("look") as [String: Any]?
        let frame = CGRect(x: call.getDouble("x") ?? 0, y: call.getDouble("y") ?? 0, width: call.getDouble("w") ?? 1, height: call.getDouble("h") ?? 1)
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有畫面"); return }
            self.editorView?.removeFromSuperview()
            guard let v = ABAIMetalView.make(frame: frame.offsetBy(dx: web.frame.minX, dy: web.frame.minY)) else { call.reject("這台裝置沒有 Metal"); return }
            v.fill = false
            parent.insertSubview(v, belowSubview: web)
            self.editorView = v
            self.webWasTransparent = !web.isOpaque
            NativePreviewPlugin.setWebTransparent(web, true)
            let side = max(frame.width, frame.height) * UIScreen.main.scale
            DispatchQueue.global(qos: .userInitiated).async {
                guard let s = ABAIRawSession(url: url, look: look, view: v, longSide: max(600, side)) else {
                    DispatchQueue.main.async { self.tearDown() }
                    call.reject("系統不認得這個 RAW 格式"); return
                }
                self.session = s
                call.resolve(["asShotTemperature": s.asShotTemperature, "asShotTint": s.asShotTint])
            }
        }
    }

    @objc func updateEditor(_ call: CAPPluginCall) {
        session?.update(ABAIRawParams(call.getObject("params") as [String: Any]?), final: call.getBool("final") ?? false)
        call.resolve()
    }

    @objc func setEditorRect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let v = self.editorView, let web = self.bridge?.webView {
                v.frame = CGRect(x: web.frame.minX + (call.getDouble("x") ?? 0), y: web.frame.minY + (call.getDouble("y") ?? 0),
                                 width: call.getDouble("w") ?? 1, height: call.getDouble("h") ?? 1)
            }
            call.resolve()
        }
    }

    @objc func exportEditor(_ call: CAPPluginCall) {
        guard let s = session else { call.reject("沒有開沖洗"); return }
        let p = ABAIRawParams(call.getObject("params") as [String: Any]?)
        DispatchQueue.global(qos: .userInitiated).async {
            autoreleasepool {
                do { call.resolve(["path": try s.export(p).path]) } catch { call.reject(error.localizedDescription) }
            }
        }
    }

    @objc func closeEditor(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.tearDown(); call.resolve() }
    }

    private func tearDown() {
        session = nil
        editorView?.removeFromSuperview(); editorView = nil
        if let web = bridge?.webView { NativePreviewPlugin.setWebTransparent(web, webWasTransparent) }
    }

    /// 共用原生影像核心的 context（線性 P3、16 位元浮點）：RAW 的寬色域不會在中間被切掉
    private var ciContext: CIContext { ABAIImageCore.context }

    /// 網頁那邊拿來探「外掛在不在」用的。存在就回 true。
    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    /// 解一張 RAW。
    /// 參數：data（base64 的原始檔案位元組）、name（檔名，只用來推副檔名）
    /// 回傳：jpeg（base64）、width、height
    @objc func decode(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let raw = Data(base64Encoded: b64) else {
            call.reject("沒有收到檔案資料")
            return
        }
        // 解碼很重，不能佔著主執行緒
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let jpeg = try self.decodeRaw(data: raw, name: call.getString("name") ?? "photo.dng")
                call.resolve([
                    "jpeg": jpeg.data.base64EncodedString(),
                    "width": jpeg.width,
                    "height": jpeg.height,
                ])
            } catch {
                call.reject("RAW 解碼失敗：\(error.localizedDescription)")
            }
        }
    }

    /* 色溫拉到很極端時，RAW 解出來的顏色有些會超出 Display P3（負值），亮的地方有些通道會超過 1。
       直接存成 8 位元的話，每個通道各自被切掉 —— 色相就跑掉了（黃變綠、紅變洋紅、亮部一塊死白）。
       專業的 RAW 軟體是「保住色相、讓飽和度和亮度讓步」：
         ① 超出色域（有負值）的顏色往同亮度的灰拉，拉到剛好進色域為止 —— 色相不變，只少一點飽和度
         ② 太亮的：整個顏色一起等比例往下壓（最亮的那個通道走一條柔和的肩部曲線），三個通道的比例不變 = 色相、飽和度都保住
       在線性 P3（工作色域）上算。 */
    private static let gamutKernel = CIColorKernel(source: """
    kernel vec4 abaiRawGamut(__sample s) {
        vec3 c = s.rgb;
        float l = max(dot(c, vec3(0.2290, 0.6917, 0.0793)), 0.0);
        float mn = min(min(c.r, c.g), c.b);
        if (mn < 0.0) { float k = l / max(l - mn, 1e-6); c = vec3(l) + (c - vec3(l)) * k; }
        float mx = max(max(c.r, c.g), c.b);
        float knee = 0.85;
        if (mx > knee) {
            float nm = knee + (1.0 - knee) * (1.0 - exp(-(mx - knee) / (1.0 - knee)));
            c *= nm / mx;
        }
        return vec4(max(c, vec3(0.0)), s.a);
    }
    """)

    /// 讀檔案路徑、寫檔案路徑（不經過 base64）。照片從系統選擇器來的時候走這條；相機「底片模式」的重新沖洗也是這條。
    /// 參數：path、exposure（EV，預設 0）、boost（0＝線性、1＝相機階調）、
    ///      temperature（色溫 K，不給＝拍攝當下的白平衡）、tint（色調，不給＝拍攝當下）、
    ///      maxPixel（長邊最多幾 px，沖洗時的即時預覽用；0＝原尺寸）、draft（快速預覽品質）
    /// 回傳：path、width、height、asShotTemperature、asShotTint（拍攝當下的白平衡，給滑桿當預設值）
    @objc func decodeFile(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? "") else { call.reject("沒有路徑"); return }
        let ev = Float(call.getDouble("exposure") ?? 0), boost = Float(call.getDouble("boost") ?? 1)
        let temperature = call.getDouble("temperature"), tint = call.getDouble("tint")
        let maxPixel = call.getDouble("maxPixel") ?? 0
        let draft = call.getBool("draft") ?? false
        DispatchQueue.global(qos: .userInitiated).async {
            autoreleasepool {
                guard let filter = CIRAWFilter(imageURL: url) else { call.reject(RawError.notRaw.localizedDescription); return }
                let asShotTemp = filter.neutralTemperature, asShotTint = filter.neutralTint
                filter.isDraftModeEnabled = draft
                filter.boostAmount = boost
                filter.exposure = ev
                if let t = temperature { filter.neutralTemperature = Float(t) }
                if let t = tint { filter.neutralTint = Float(t) }
                filter.isGamutMappingEnabled = true
                /* 預覽：在解碼時就縮小（比解完整張再縮快很多） */
                let native = filter.nativeSize
                if maxPixel > 0, native.width > 0, native.height > 0 {
                    filter.scaleFactor = Float(min(1, maxPixel / Double(max(native.width, native.height))))
                }
                guard let raw = filter.outputImage, raw.extent.width > 0 else { call.reject(RawError.renderFailed.localizedDescription); return }
                let output = RawDecodePlugin.gamutKernel?.apply(extent: raw.extent, arguments: [raw]) ?? raw
                do {
                    let data = try ABAIImageCore.encode(output, format: .jpeg, quality: draft ? 0.85 : 0.97)
                    let out = ABAIImageCore.newFileURL(ext: "jpg")
                    try data.write(to: out)
                    call.resolve(["path": out.path, "width": Int(output.extent.width), "height": Int(output.extent.height),
                                  "asShotTemperature": Double(asShotTemp), "asShotTint": Double(asShotTint)])
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }

    private enum RawError: LocalizedError {
        case notRaw, renderFailed, encodeFailed
        var errorDescription: String? {
            switch self {
            case .notRaw:        return "系統不認得這個 RAW 格式"
            case .renderFailed:  return "算不出影像"
            case .encodeFailed:  return "編不成 JPEG"
            }
        }
    }

    private func decodeRaw(data: Data, name: String) throws -> (data: Data, width: Int, height: Int) {
        // CIRAWFilter 在 iOS 15 之後是這個 API；更早的用 CIFilter(imageData:options:)
        guard let filter = CIRAWFilter(imageData: data, identifierHint: nil) else {
            throw RawError.notRaw
        }

        /* 這幾項就是「RAW 值錢的地方」——
           相機白平衡照用、亮部盡量救回來、其餘交給系統的預設。
           想接成使用者可調的面板時，改的就是這裡。 */
        filter.isDraftModeEnabled = false          // 要完整畫質，不要草稿模式
        filter.boostAmount = 1.0                   // 1.0 ＝ 照相機的階調，0 ＝ 完全線性
        filter.isGamutMappingEnabled = true        // 超出色域的顏色壓回來，不要斷階

        guard let output = filter.outputImage else { throw RawError.renderFailed }
        let extent = output.extent
        guard extent.width > 0, extent.height > 0 else { throw RawError.renderFailed }

        guard let cg = ciContext.createCGImage(output, from: extent, format: .RGBA8, colorSpace: ABAIImageCore.displayP3) else {
            throw RawError.renderFailed
        }
        let image = UIImage(cgImage: cg)
        // 0.95：肉眼上無損，但比 PNG 小非常多 —— 這張還要經過 Capacitor 的
        // JSON 橋接送回網頁層，尺寸直接決定會不會爆記憶體。
        guard let jpeg = image.jpegData(compressionQuality: 0.95) else {
            throw RawError.encodeFailed
        }
        return (jpeg, Int(extent.width), Int(extent.height))
    }
}
