//
//  RawDecodePlugin.swift
//  ABAI — iOS 原生 RAW 解碼
//
//  ── 這個檔案要放哪裡 ────────────────────────────────────────────
//  跑過 `npx cap add ios` 之後，把這個檔案拖進 Xcode 的
//      ios/App/App/
//  資料夾（記得勾 "Copy items if needed"、Target 選 App）。
//  Capacitor 7 是純 Swift 註冊，不需要再寫 .m 檔。
//  加進去之後網頁那邊會自動偵測到（見 utils/rawNative.ts 的 available()），
//  沒加就自動走 LibRaw，不會壞。
//
//  ── 這支在做什麼 ──────────────────────────────────────────────
//  用 Core Image 的 CIRAWFilter 解 RAW。那是 iOS 系統內建的解碼器，
//  「照片」App 打開 RAW 用的就是同一套：Apple 自己維護各家相機的支援，
//  真正的去馬賽克、相機白平衡、亮部處理都在裡面，而且跑在原生程式碼上、
//  吃得到硬體加速 —— 比 WebAssembly 版的 LibRaw 快很多。
//
//  ⚠ 誠實說明：這段 Swift 沒有在真機上跑過（開發環境沒有 Xcode）。
//    它是照 Apple 的 CIRAWFilter 文件寫的，介面與錯誤處理都留了退路，
//    但第一次在 Xcode 裡跑起來時請先用一張 RAW 實測。
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
    ]

    /// 共用一個 CIContext：每次都新建的話，每張圖都要重新配置 GPU 資源。
    private lazy var ciContext: CIContext = {
        // 用 sRGB 工作色空間，跟網頁那邊的畫布一致
        return CIContext(options: [
            .workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB) as Any,
            .useSoftwareRenderer: false,
        ])
    }()

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

        guard let cg = ciContext.createCGImage(output, from: extent) else {
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
