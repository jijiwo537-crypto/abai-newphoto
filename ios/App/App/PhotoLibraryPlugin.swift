//
//  PhotoLibraryPlugin.swift
//  ABAI — App 自己的相簿畫面用的資料來源（PhotoKit）
//
//  網頁那邊的對應：utils/nativeGallery.ts、components/NativeGallery.tsx
//    access()                    目前的相簿權限（不跳詢問）
//    request()                   跳出權限詢問
//    albums({ filter })          相簿清單：最近項目、個人收藏、影片、自拍、人像、螢幕截圖、自己建的相簿
//    assets({ album, filter, offset, limit })   一頁一頁拿照片（新的在前）
//    thumbs({ ids, size })       縮圖檔（快取在 Caches，同一張同尺寸只做一次）
//    export({ ids })             把選好的原檔拿出來（照片原格式、影片原檔），回傳路徑
//    manageLimited()             只開放部分照片時，讓使用者再多選幾張
//    openSettings()              權限被拒時帶到「設定」
//  事件：libraryChanged（開放的照片範圍變了）
//

import Foundation
import Capacitor
import Photos
import PhotosUI
import UniformTypeIdentifiers
import AVFoundation
import ImageIO
import UIKit

@objc(PhotoLibraryPlugin)
public class PhotoLibraryPlugin: CAPPlugin, CAPBridgedPlugin, PHPhotoLibraryChangeObserver {
    public let identifier = "PhotoLibraryPlugin"
    public let jsName = "PhotoLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "access", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "albums", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "assets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alphaFlags", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "thumbs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "export", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageLimited", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    private let imageManager = PHCachingImageManager()
    private let work = DispatchQueue(label: "abai.library", qos: .userInitiated, attributes: .concurrent)
    private var fetchCache: [String: PHFetchResult<PHAsset>] = [:]
    private let cacheLock = NSLock()
    private var observing = false

    private lazy var thumbDir: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("abai-thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    @objc func available(_ call: CAPPluginCall) { call.resolve(["available": true]) }

    private static func statusName(_ s: PHAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "authorized"
        case .limited: return "limited"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default: return "notDetermined"
        }
    }

    @objc func access(_ call: CAPPluginCall) {
        let s = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if s == .authorized || s == .limited { startObserving() }
        call.resolve(["status": Self.statusName(s)])
    }

    @objc func request(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { s in
            self.startObserving()
            call.resolve(["status": Self.statusName(s)])
        }
    }

    private func startObserving() {
        guard !observing else { return }
        observing = true
        PHPhotoLibrary.shared().register(self)
    }

    public func photoLibraryDidChange(_ changeInstance: PHChange) {
        cacheLock.lock(); fetchCache.removeAll(); cacheLock.unlock()
        notifyListeners("libraryChanged", data: [:])
    }

    // MARK: 相簿與照片

    private func options(_ filter: String) -> PHFetchOptions {
        let o = PHFetchOptions()
        o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        switch filter {
        case "images": o.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        case "videos": o.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.video.rawValue)
        default: o.predicate = NSPredicate(format: "mediaType == %d || mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        }
        return o
    }

    private func fetch(album: String, filter: String) -> PHFetchResult<PHAsset> {
        let key = "\(album)|\(filter)"
        cacheLock.lock(); defer { cacheLock.unlock() }
        if let hit = fetchCache[key] { return hit }
        let result: PHFetchResult<PHAsset>
        if album.isEmpty || album == "recents" {
            result = PHAsset.fetchAssets(with: options(filter))
        } else if let col = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [album], options: nil).firstObject {
            result = PHAsset.fetchAssets(in: col, options: options(filter))
        } else {
            result = PHAsset.fetchAssets(with: options(filter))
        }
        fetchCache[key] = result
        return result
    }

    @objc func albums(_ call: CAPPluginCall) {
        let filter = call.getString("filter") ?? "any"
        work.async {
            var out: [[String: Any]] = []
            let recents = self.fetch(album: "recents", filter: filter)
            out.append(["id": "recents", "title": "最近項目", "count": recents.count, "cover": recents.firstObject?.localIdentifier ?? ""])
            let smart: [(PHAssetCollectionSubtype, String)] = [
                (.smartAlbumFavorites, "個人收藏"), (.smartAlbumVideos, "影片"), (.smartAlbumSelfPortraits, "自拍"),
                (.smartAlbumDepthEffect, "人像"), (.smartAlbumLivePhotos, "原況照片"), (.smartAlbumScreenshots, "螢幕截圖"),
            ]
            for (sub, title) in smart {
                if filter == "images" && sub == .smartAlbumVideos { continue }
                guard let col = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: sub, options: nil).firstObject else { continue }
                let r = PHAsset.fetchAssets(in: col, options: self.options(filter))
                if r.count > 0 { out.append(["id": col.localIdentifier, "title": title, "count": r.count, "cover": r.firstObject?.localIdentifier ?? ""]) }
            }
            let user = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
            user.enumerateObjects { col, _, _ in
                let r = PHAsset.fetchAssets(in: col, options: self.options(filter))
                if r.count > 0 { out.append(["id": col.localIdentifier, "title": col.localizedTitle ?? "相簿", "count": r.count, "cover": r.firstObject?.localIdentifier ?? ""]) }
            }
            call.resolve(["albums": out])
        }
    }

    @objc func assets(_ call: CAPPluginCall) {
        let album = call.getString("album") ?? "recents"
        let filter = call.getString("filter") ?? "any"
        let offset = max(0, call.getInt("offset") ?? 0)
        let limit = max(1, call.getInt("limit") ?? 120)
        work.async {
            let r = self.fetch(album: album, filter: filter)
            let end = min(r.count, offset + limit)
            var items: [[String: Any]] = []
            if offset < end {
                for i in offset..<end {
                    let a = r.object(at: i)
                    items.append([
                        "id": a.localIdentifier,
                        "w": a.pixelWidth, "h": a.pixelHeight,
                        "video": a.mediaType == .video,
                        "duration": a.duration,
                        "maybeAlpha": self.mayHaveAlpha(a),
                    ])
                }
            }
            call.resolve(["total": r.count, "items": items])
        }
    }

    // MARK: 去背（透明）偵測
    //
    // 大部分工具不收去背圖，相簿要先把它們藏起來。
    //   ‧ 列表時只看檔案類型（UTI，不讀檔）：PNG／WebP／GIF／TIFF 標成「可能透明」，網頁先不顯示。
    //   ‧ alphaFlags 只查這些：PNG 先讀檔頭幾 KB（顏色格式沒有透明通道、也沒有 tRNS → 不透明，
    //     截圖大多在這一步就確認了）；有透明通道的再解一張 96px 小縮圖逐像素確認。
    //   ‧ 結果依「照片 id＋修改時間」快取（記憶體＋Caches 檔），同一張不會再查。

    private var alphaCache: [String: Bool] = [:]
    private var alphaCacheLoaded = false
    private lazy var alphaCacheURL: URL = thumbDir.appendingPathComponent("alpha-flags.plist")

    private func alphaKey(_ a: PHAsset) -> String {
        "\(a.localIdentifier)|\(Int(a.modificationDate?.timeIntervalSince1970 ?? 0))"
    }

    private func photoResource(_ a: PHAsset) -> PHAssetResource? {
        let res = PHAssetResource.assetResources(for: a)
        return res.first(where: { $0.type == .photo }) ?? res.first(where: { $0.type == .fullSizePhoto }) ?? res.first
    }

    private func alphaCapableType(_ uti: String) -> Bool {
        let u = uti.lowercased()
        return u.contains("png") || u.contains("webp") || u.contains("gif") || u.contains("tiff")
    }

    fileprivate func mayHaveAlpha(_ a: PHAsset) -> Bool {
        guard a.mediaType == .image else { return false }
        loadAlphaCache()
        cacheLock.lock(); let known = alphaCache[alphaKey(a)]; cacheLock.unlock()
        if let k = known { return k }
        guard let r = photoResource(a) else { return false }
        return alphaCapableType(r.uniformTypeIdentifier)
    }

    private func loadAlphaCache() {
        cacheLock.lock(); defer { cacheLock.unlock() }
        if alphaCacheLoaded { return }
        alphaCacheLoaded = true
        if let d = NSDictionary(contentsOf: alphaCacheURL) as? [String: Bool] { alphaCache = d }
    }

    private func saveAlphaCache() {
        cacheLock.lock(); let snapshot = alphaCache; cacheLock.unlock()
        (snapshot as NSDictionary).write(to: alphaCacheURL, atomically: true)
    }

    /// 讀檔頭（最多 8KB）。只在本機有檔案時讀，不從 iCloud 下載。
    private func headBytes(_ r: PHAssetResource) -> Data {
        let lock = NSLock()
        var head = Data()
        var reqId: PHAssetResourceDataRequestID = 0
        var cancelled = false
        let sem = DispatchSemaphore(value: 0)
        let o = PHAssetResourceRequestOptions()
        o.isNetworkAccessAllowed = false
        let mgr = PHAssetResourceManager.default()
        let id = mgr.requestData(for: r, options: o, dataReceivedHandler: { chunk in
            lock.lock()
            if head.count < 8192 { head.append(chunk.prefix(8192 - head.count)) }
            let enough = head.count >= 8192 && !cancelled
            if enough { cancelled = true }
            let rid = reqId
            lock.unlock()
            if enough && rid != 0 { mgr.cancelDataRequest(rid) }
        }, completionHandler: { _ in sem.signal() })
        lock.lock(); reqId = id; let late = cancelled; lock.unlock()
        if late { mgr.cancelDataRequest(id) }
        _ = sem.wait(timeout: .now() + 3)
        lock.lock(); defer { lock.unlock() }
        return head
    }

    /// PNG 檔頭：顏色格式 4（灰階＋透明）、6（RGBA），或 IDAT 之前有 tRNS → 可能透明
    private func pngHeaderMayHaveAlpha(_ d: Data) -> Bool {
        let b = [UInt8](d)
        guard b.count >= 26, b[0] == 0x89, b[1] == 0x50, b[2] == 0x4E, b[3] == 0x47 else { return true }
        let colorType = b[25]
        if colorType == 4 || colorType == 6 { return true }
        // 走過各個區塊，看 IDAT 之前有沒有 tRNS
        var i = 8
        while i + 8 <= b.count {
            let len = Int(b[i]) << 24 | Int(b[i + 1]) << 16 | Int(b[i + 2]) << 8 | Int(b[i + 3])
            let t = String(bytes: b[(i + 4)..<(i + 8)], encoding: .ascii) ?? ""
            if t == "tRNS" { return true }
            if t == "IDAT" || t == "IEND" { return false }
            i += 12 + max(0, len)
        }
        return false
    }

    /// 解一張小縮圖，逐像素看有沒有不是完全不透明的
    private func thumbnailHasAlpha(_ a: PHAsset) -> Bool {
        let o = PHImageRequestOptions()
        o.isSynchronous = true
        o.isNetworkAccessAllowed = false
        o.version = .current
        var data: Data?
        PHImageManager.default().requestImageDataAndOrientation(for: a, options: o) { d, _, _, _ in data = d }
        guard let d = data, let src = CGImageSourceCreateWithData(d as CFData, nil) else { return false }
        if let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
           let has = props[kCGImagePropertyHasAlpha] as? Bool, !has { return false }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 96,
            kCGImageSourceCreateThumbnailWithTransform: true,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return false }
        let w = cg.width, h = cg.height
        var px = [UInt8](repeating: 255, count: w * h * 4)
        guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        ctx.clear(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var i = 3
        while i < px.count { if px[i] < 255 { return true }; i += 4 }
        return false
    }

    private func assetHasAlpha(_ a: PHAsset) -> Bool {
        guard a.mediaType == .image else { return false }
        let key = alphaKey(a)
        cacheLock.lock(); let known = alphaCache[key]; cacheLock.unlock()
        if let k = known { return k }
        var result = false
        if let r = photoResource(a), alphaCapableType(r.uniformTypeIdentifier) {
            let isPng = r.uniformTypeIdentifier.lowercased().contains("png")
            let head = isPng ? headBytes(r) : Data()
            let candidate = isPng ? (head.isEmpty ? true : pngHeaderMayHaveAlpha(head)) : true
            result = candidate ? thumbnailHasAlpha(a) : false
        }
        cacheLock.lock(); alphaCache[key] = result; cacheLock.unlock()
        return result
    }

    /// 網頁：這幾張是不是去背圖（只會傳「可能透明」的那些來）
    @objc func alphaFlags(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        work.async {
            let fetched = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
            var flags: [String: Bool] = [:]
            fetched.enumerateObjects { a, _, _ in
                autoreleasepool { flags[a.localIdentifier] = self.assetHasAlpha(a) }
            }
            for id in ids where flags[id] == nil { flags[id] = false }
            self.saveAlphaCache()
            call.resolve(["flags": flags])
        }
    }

    // MARK: 縮圖

    private func thumbURL(_ id: String, _ size: Int) -> URL {
        let safe = id.replacingOccurrences(of: "/", with: "_")
        return thumbDir.appendingPathComponent("\(safe)_\(size).jpg")
    }

    @objc func thumbs(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        let size = max(64, min(1024, call.getInt("size") ?? 360))
        work.async {
            let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
            var byId: [String: PHAsset] = [:]
            assets.enumerateObjects { a, _, _ in byId[a.localIdentifier] = a }
            var out: [[String: Any]] = []
            let lock = NSLock()
            let group = DispatchGroup()
            /* 先只用手機上現成的資料（很快，iCloud 最佳化的照片手機上也一定有縮圖）；
               真的沒有才允許從 iCloud 下載。每一張單獨完成，不會整批等最慢的那張 */
            func request(_ a: PHAsset, network: Bool, done: @escaping (UIImage?) -> Void) {
                let o = PHImageRequestOptions()
                o.deliveryMode = .highQualityFormat
                o.resizeMode = .fast
                o.isNetworkAccessAllowed = network
                o.isSynchronous = false
                self.imageManager.requestImage(for: a, targetSize: CGSize(width: size, height: size), contentMode: .aspectFill, options: o) { img, _ in done(img) }
            }
            for id in ids {
                let url = self.thumbURL(id, size)
                if FileManager.default.fileExists(atPath: url.path) {
                    lock.lock(); out.append(["id": id, "path": url.path]); lock.unlock(); continue
                }
                guard let a = byId[id] else { continue }
                group.enter()
                let finish: (UIImage?) -> Void = { img in
                    defer { group.leave() }
                    guard let img = img, let data = img.jpegData(compressionQuality: 0.82) else { return }
                    try? data.write(to: url)
                    lock.lock(); out.append(["id": id, "path": url.path]); lock.unlock()
                }
                request(a, network: false) { img in
                    if img != nil { finish(img) } else { request(a, network: true, done: finish) }
                }
            }
            group.notify(queue: .global()) { call.resolve(["items": out]) }
        }
    }

    // MARK: 匯出原檔

    @objc func export(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        work.async {
            let fetched = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
            var byId: [String: PHAsset] = [:]
            fetched.enumerateObjects { a, _, _ in byId[a.localIdentifier] = a }
            var results = [[String: Any]?](repeating: nil, count: ids.count)
            var lastError = ""
            let group = DispatchGroup()
            let lock = NSLock()
            for (i, id) in ids.enumerated() {
                guard let a = byId[id] else { continue }
                group.enter()
                let finish: ([String: Any]?, String?) -> Void = { item, err in
                    lock.lock()
                    if let item = item { results[i] = item }
                    if let err = err { lastError = err }
                    lock.unlock()
                    group.leave()
                }
                let original = PHAssetResource.assetResources(for: a).first?.originalFilename
                if a.mediaType == .video { self.exportVideo(a, name: original, done: finish) }
                else { self.exportPhoto(a, name: original, done: finish) }
            }
            group.notify(queue: .global()) {
                let items = results.compactMap { $0 }
                if items.isEmpty && !ids.isEmpty { call.reject(lastError.isEmpty ? "照片讀不出來" : lastError); return }
                call.resolve(["items": items])
            }
        }
    }

    private func exportPhoto(_ a: PHAsset, name: String?, done: @escaping ([String: Any]?, String?) -> Void) {
        let o = PHImageRequestOptions()
        o.version = .current
        o.deliveryMode = .highQualityFormat
        o.isNetworkAccessAllowed = true
        imageManager.requestImageDataAndOrientation(for: a, options: o) { data, uti, _, info in
            guard let data = data else { done(nil, (info?[PHImageErrorKey] as? Error)?.localizedDescription ?? "照片讀不出來"); return }
            let type = uti.flatMap { UTType($0) } ?? .jpeg
            let ext = type.preferredFilenameExtension ?? "jpg"
            let url = ABAIImageCore.newFileURL(ext: ext)
            do { try data.write(to: url) } catch { done(nil, error.localizedDescription); return }
            let base = ((name ?? "photo") as NSString).deletingPathExtension
            done([
                "path": url.path, "name": "\(base).\(ext)",
                "type": type.preferredMIMEType ?? "image/jpeg",
                "assetId": a.localIdentifier, "width": a.pixelWidth, "height": a.pixelHeight,
            ], nil)
        }
    }

    private func exportVideo(_ a: PHAsset, name: String?, done: @escaping ([String: Any]?, String?) -> Void) {
        let o = PHVideoRequestOptions()
        o.version = .current
        o.deliveryMode = .highQualityFormat
        o.isNetworkAccessAllowed = true
        imageManager.requestAVAsset(forVideo: a, options: o) { asset, _, info in
            let base = ((name ?? "video") as NSString).deletingPathExtension
            if let urlAsset = asset as? AVURLAsset {
                let ext = urlAsset.url.pathExtension.isEmpty ? "mov" : urlAsset.url.pathExtension
                let dest = ABAIImageCore.newFileURL(ext: ext)
                do { try FileManager.default.copyItem(at: urlAsset.url, to: dest) } catch { done(nil, error.localizedDescription); return }
                done(["path": dest.path, "name": "\(base).\(ext)", "type": ext.lowercased() == "mp4" ? "video/mp4" : "video/quicktime",
                      "assetId": a.localIdentifier, "width": a.pixelWidth, "height": a.pixelHeight], nil)
                return
            }
            /* 慢動作之類的合成影片：匯出成一般的 MOV */
            guard let asset = asset, let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
                done(nil, (info?[PHImageErrorKey] as? Error)?.localizedDescription ?? "影片讀不出來"); return
            }
            let dest = ABAIImageCore.newFileURL(ext: "mov")
            session.outputURL = dest
            session.outputFileType = .mov
            session.exportAsynchronously {
                if session.status == .completed {
                    done(["path": dest.path, "name": "\(base).mov", "type": "video/quicktime",
                          "assetId": a.localIdentifier, "width": a.pixelWidth, "height": a.pixelHeight], nil)
                } else { done(nil, session.error?.localizedDescription ?? "影片匯出失敗") }
            }
        }
    }

    // MARK: 權限相關

    @objc func manageLimited(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.resolve(); return }
            self.startObserving()
            PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: vc) { _ in
                self.cacheLock.lock(); self.fetchCache.removeAll(); self.cacheLock.unlock()
                call.resolve()
            }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }
}
