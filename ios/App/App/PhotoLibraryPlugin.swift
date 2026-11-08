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
                    ])
                }
            }
            call.resolve(["total": r.count, "items": items])
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
            let opts = PHImageRequestOptions()
            opts.deliveryMode = .highQualityFormat
            opts.resizeMode = .fast
            opts.isNetworkAccessAllowed = true
            opts.isSynchronous = false
            for id in ids {
                let url = self.thumbURL(id, size)
                if FileManager.default.fileExists(atPath: url.path) {
                    lock.lock(); out.append(["id": id, "path": url.path]); lock.unlock(); continue
                }
                guard let a = byId[id] else { continue }
                group.enter()
                self.imageManager.requestImage(for: a, targetSize: CGSize(width: size, height: size), contentMode: .aspectFill, options: opts) { img, info in
                    defer { group.leave() }
                    if (info?[PHImageResultIsDegradedKey] as? Bool) == true { group.enter(); return }   // 之後還會再回呼一次正式的
                    guard let img = img, let data = img.jpegData(compressionQuality: 0.82) else { return }
                    try? data.write(to: url)
                    lock.lock(); out.append(["id": id, "path": url.path]); lock.unlock()
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
