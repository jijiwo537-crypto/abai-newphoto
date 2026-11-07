//
//  NativePhotosPlugin.swift
//  ABAI — 系統照片選擇器、存回相簿、可還原的編輯紀錄
//
//  網頁那邊的對應：utils/nativePhotos.ts
//    ‧ pick：系統的照片選擇器（PHPicker）。不需要相簿權限，使用者只把選的那幾張交給 App。
//      原檔直接複製到 App 的暫存資料夾（HEIC 就是 HEIC，不轉檔），網頁用路徑讀。
//    ‧ save：存進相簿。帶 assetId＋adjustment 時，是「改原本那一張」：
//      Photos 會保留原圖，使用者在「照片」App 裡隨時可以按「回復」，
//      之後回到 ABAI 也能從原圖、照上次的編輯清單接著改（像 Lightroom 的可逆編輯）。
//    ‧ readAdjustment：讀回某張照片上次在 ABAI 的編輯清單和原圖。
//

import Foundation
import Capacitor
import Photos
import PhotosUI
import UniformTypeIdentifiers
import UIKit

@objc(NativePhotosPlugin)
public class NativePhotosPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "NativePhotosPlugin"
    public let jsName = "NativePhotos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readAdjustment", returnType: CAPPluginReturnPromise),
    ]

    private var pickCall: CAPPluginCall?

    @objc func available(_ call: CAPPluginCall) { call.resolve(["available": true]) }

    // MARK: 選照片

    /// 參數：limit（0＝不限）、filter（images／videos／any）
    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.selectionLimit = call.getInt("limit") ?? 1
            config.preferredAssetRepresentationMode = .current   // 原檔原格式，不讓系統轉成 JPEG
            if #available(iOS 15.0, *) { config.selection = .ordered }
            switch call.getString("filter") ?? "images" {
            case "videos": config.filter = .videos
            case "any": config.filter = .any(of: [.images, .videos])
            default: config.filter = .images
            }
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            self.pickCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pickCall else { return }
        pickCall = nil
        if results.isEmpty { call.resolve(["items": []]); return }
        var items = [[String: Any]?](repeating: nil, count: results.count)
        let lock = NSLock()
        let group = DispatchGroup()
        for (i, r) in results.enumerated() {
            let provider = r.itemProvider
            let isMovie = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
            /* 優先拿原檔的那個格式（HEIC／RAW／PNG），拿不到才退回通用的 public.image */
            let type = provider.registeredTypeIdentifiers.first { id in
                guard let t = UTType(id) else { return false }
                return isMovie ? t.conforms(to: .movie) : t.conforms(to: .image)
            } ?? (isMovie ? UTType.movie.identifier : UTType.image.identifier)
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                defer { group.leave() }
                guard let url = url else { return }
                /* 這個檔案只在回呼裡有效，要先複製出來 */
                let ext = url.pathExtension.isEmpty ? (UTType(type)?.preferredFilenameExtension ?? "bin") : url.pathExtension
                let dest = ABAIImageCore.newFileURL(ext: ext)
                do { try FileManager.default.copyItem(at: url, to: dest) } catch { return }
                var item: [String: Any] = [
                    "path": dest.path,
                    "name": provider.suggestedName.map { "\($0).\(ext)" } ?? url.lastPathComponent,
                    "type": UTType(filenameExtension: ext)?.preferredMIMEType ?? (isMovie ? "video/quicktime" : "image/jpeg"),
                    "size": (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int) ?? 0,
                ]
                if let id = r.assetIdentifier { item["assetId"] = id }
                if !isMovie, let s = ABAIImageCore.pixelSize(of: dest) {
                    item["width"] = Int(s.width); item["height"] = Int(s.height)
                }
                lock.lock(); items[i] = item; lock.unlock()
            }
        }
        group.notify(queue: .main) { call.resolve(["items": items.compactMap { $0 }]) }
    }

    // MARK: 權限

    /// level：addOnly（只存新照片）或 readWrite（改原本那張需要）
    @objc func authorize(_ call: CAPPluginCall) {
        let level: PHAccessLevel = (call.getString("level") == "readWrite") ? .readWrite : .addOnly
        PHPhotoLibrary.requestAuthorization(for: level) { status in
            let s: String
            switch status {
            case .authorized: s = "authorized"
            case .limited: s = "limited"
            case .denied: s = "denied"
            case .restricted: s = "restricted"
            default: s = "notDetermined"
            }
            call.resolve(["status": s])
        }
    }

    // MARK: 存檔

    /// 參數：path、kind（photo／video）、assetId（選擇性）、adjustment（編輯清單 JSON，選擇性）
    @objc func save(_ call: CAPPluginCall) {
        guard let url = ABAIImageCore.fileURL(from: call.getString("path") ?? "") else { call.reject("沒有路徑"); return }
        let isVideo = call.getString("kind") == "video"
        let assetId = call.getString("assetId")
        let adjustment = call.getString("adjustment")

        /* 存檔途中切到背景也要做完 */
        var task: UIBackgroundTaskIdentifier = .invalid
        let begin = { task = UIApplication.shared.beginBackgroundTask(withName: "abai-save") { UIApplication.shared.endBackgroundTask(task) } }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
        let finish: (Result<[String: Any], Error>) -> Void = { result in
            switch result {
            case .success(let data): call.resolve(data)
            case .failure(let e): call.reject(e.localizedDescription)
            }
            DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(task) }
        }

        if !isVideo, let id = assetId, let adj = adjustment, PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
           let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject, asset.canPerform(.content) {
            editOriginal(asset: asset, rendered: url, adjustment: adj, finish: finish)
            return
        }
        createNew(url: url, isVideo: isVideo, finish: finish)
    }

    private func createNew(url: URL, isVideo: Bool, finish: @escaping (Result<[String: Any], Error>) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                finish(.failure(NSError(domain: "abai", code: 1, userInfo: [NSLocalizedDescriptionKey: "沒有存到相簿的權限"]))); return
            }
            var placeholder: String?
            PHPhotoLibrary.shared().performChanges({
                let req = PHAssetCreationRequest.forAsset()
                let opts = PHAssetResourceCreationOptions()
                req.addResource(with: isVideo ? .video : .photo, fileURL: url, options: opts)
                placeholder = req.placeholderForCreatedAsset?.localIdentifier
            }) { ok, err in
                if ok { finish(.success(["saved": true, "mode": "created", "assetId": placeholder ?? ""])) }
                else { finish(.failure(err ?? NSError(domain: "abai", code: 2, userInfo: [NSLocalizedDescriptionKey: "存檔失敗"]))) }
            }
        }
    }

    /// 改原本那一張：Photos 保留原圖，加上我們的成品和編輯清單
    private func editOriginal(asset: PHAsset, rendered: URL, adjustment: String,
                              finish: @escaping (Result<[String: Any], Error>) -> Void) {
        let opts = PHContentEditingInputRequestOptions()
        opts.isNetworkAccessAllowed = true
        opts.canHandleAdjustmentData = { _ in false }
        asset.requestContentEditingInput(with: opts) { input, _ in
            guard let input = input else {
                self.createNew(url: rendered, isVideo: false, finish: finish); return
            }
            let output = PHContentEditingOutput(contentEditingInput: input)
            output.adjustmentData = PHAdjustmentData(formatIdentifier: ABAIAdjustment.formatIdentifier,
                                                     formatVersion: ABAIAdjustment.formatVersion,
                                                     data: Data(adjustment.utf8))
            do {
                /* renderedContentURL 規定是 JPEG（iOS 17 起也可以用 defaultRenderedContentType 指定 HEIC） */
                let target = output.renderedContentURL
                if let img = ABAIImageCore.ciImage(rendered) {
                    let data = try ABAIImageCore.encode(img, format: .jpeg, quality: 0.97)
                    try data.write(to: target)
                } else {
                    try FileManager.default.copyItem(at: rendered, to: target)
                }
            } catch {
                self.createNew(url: rendered, isVideo: false, finish: finish); return
            }
            PHPhotoLibrary.shared().performChanges({
                let req = PHAssetChangeRequest(for: asset)
                req.contentEditingOutput = output
            }) { ok, err in
                if ok { finish(.success(["saved": true, "mode": "edited", "assetId": asset.localIdentifier])) }
                else { self.createNew(url: rendered, isVideo: false, finish: finish); _ = err }
            }
        }
    }

    // MARK: 讀回編輯清單

    /// 回傳 adjustment（上次在 ABAI 的編輯清單 JSON）和 originalPath（原圖的複本）
    @objc func readAdjustment(_ call: CAPPluginCall) {
        guard let id = call.getString("assetId"),
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            call.resolve([:]); return
        }
        let opts = PHContentEditingInputRequestOptions()
        opts.isNetworkAccessAllowed = true
        /* 回答「看得懂」，Photos 才會給原圖而不是上次編輯過的成品 */
        opts.canHandleAdjustmentData = { $0.formatIdentifier == ABAIAdjustment.formatIdentifier }
        asset.requestContentEditingInput(with: opts) { input, _ in
            guard let input = input else { call.resolve([:]); return }
            var out: [String: Any] = [:]
            if let adj = input.adjustmentData, adj.formatIdentifier == ABAIAdjustment.formatIdentifier {
                out["adjustment"] = String(data: adj.data, encoding: .utf8) ?? ""
                out["formatVersion"] = adj.formatVersion
            }
            if let src = input.fullSizeImageURL {
                let dest = ABAIImageCore.newFileURL(ext: src.pathExtension.isEmpty ? "jpg" : src.pathExtension)
                if (try? FileManager.default.copyItem(at: src, to: dest)) != nil { out["originalPath"] = dest.path }
            }
            call.resolve(out)
        }
    }
}
