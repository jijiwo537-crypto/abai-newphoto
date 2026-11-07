//
//  VideoWriterPlugin.swift
//  ABAI — 原生影片輸出（AVAssetWriter＋硬體 HEVC）
//
//  網頁逐格畫好畫面，一格一格交過來；這裡用硬體編碼器編成 HEVC（不支援就 H.264），
//  時間戳是算出來的（第 i 格＝i ÷ fps），所以不管合成多慢，每一格都在，播放起來是順的。
//  整段在背景工作裡進行，切到別的 App 也能把剩下的編完。
//
//  網頁那邊的對應：utils/nativeVideo.ts
//    begin({ width, height, fps, bitrate, codec })  → { id }
//    append({ id, data, index })   data 是一格的 JPEG（base64）
//    finish({ id })  → { path }      cancel({ id })
//

import Foundation
import Capacitor
import AVFoundation
import CoreImage
import ImageIO
import UIKit

@objc(VideoWriterPlugin)
public class VideoWriterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VideoWriterPlugin"
    public let jsName = "VideoWriter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    private final class Job {
        let writer: AVAssetWriter
        let input: AVAssetWriterInput
        let adaptor: AVAssetWriterInputPixelBufferAdaptor
        let url: URL
        let fps: Int32
        let width: Int, height: Int
        var task: UIBackgroundTaskIdentifier = .invalid
        init(writer: AVAssetWriter, input: AVAssetWriterInput, adaptor: AVAssetWriterInputPixelBufferAdaptor, url: URL, fps: Int32, width: Int, height: Int) {
            self.writer = writer; self.input = input; self.adaptor = adaptor; self.url = url; self.fps = fps; self.width = width; self.height = height
        }
    }

    private var jobs: [Int: Job] = [:]
    private var nextId = 1
    private let queue = DispatchQueue(label: "abai.videowriter", qos: .userInitiated)

    @objc func available(_ call: CAPPluginCall) {
        let hevc = AVAssetExportSession.allExportPresets().contains(AVAssetExportPresetHEVCHighestQuality)
        call.resolve(["available": true, "hevc": hevc])
    }

    @objc func begin(_ call: CAPPluginCall) {
        let w = (call.getInt("width") ?? 1080) & ~1, h = (call.getInt("height") ?? 1920) & ~1
        let fps = Int32(max(1, min(120, call.getInt("fps") ?? 30)))
        let bitrate = call.getInt("bitrate") ?? 10_000_000
        let wantHEVC = (call.getString("codec") ?? "hevc") == "hevc"
        queue.async {
            let url = ABAIImageCore.newFileURL(ext: "mp4")
            do {
                let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
                let codec: AVVideoCodecType = wantHEVC ? .hevc : .h264
                let settings: [String: Any] = [
                    AVVideoCodecKey: codec,
                    AVVideoWidthKey: w,
                    AVVideoHeightKey: h,
                    AVVideoCompressionPropertiesKey: [
                        AVVideoAverageBitRateKey: bitrate,
                        AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
                        AVVideoExpectedSourceFrameRateKey: Int(fps),
                    ],
                    AVVideoColorPropertiesKey: [
                        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
                    ],
                ]
                let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
                input.expectsMediaDataInRealTime = false
                let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                    kCVPixelBufferWidthKey as String: w,
                    kCVPixelBufferHeightKey as String: h,
                    kCVPixelBufferCGImageCompatibilityKey as String: true,
                    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
                ])
                guard writer.canAdd(input) else { throw ABAIImageCore.CoreError.unsupported("影片編碼") }
                writer.add(input)
                guard writer.startWriting() else { throw writer.error ?? ABAIImageCore.CoreError.encode }
                writer.startSession(atSourceTime: .zero)
                let job = Job(writer: writer, input: input, adaptor: adaptor, url: url, fps: fps, width: w, height: h)
                let id = self.nextId; self.nextId += 1
                self.jobs[id] = job
                DispatchQueue.main.async {
                    job.task = UIApplication.shared.beginBackgroundTask(withName: "abai-video") { [weak self] in
                        self?.queue.async { self?.abort(id) }
                    }
                }
                call.resolve(["id": id])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func append(_ call: CAPPluginCall) {
        let id = call.getInt("id") ?? 0, index = call.getInt("index") ?? 0
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("沒有畫面資料"); return }
        queue.async {
            guard let job = self.jobs[id] else { call.reject("找不到這個輸出"); return }
            autoreleasepool {
                guard let src = CGImageSourceCreateWithData(data as CFData, nil),
                      let img = CGImageSourceCreateImageAtIndex(src, 0, nil),
                      let pool = job.adaptor.pixelBufferPool else { call.reject("畫面解不開"); return }
                var pb: CVPixelBuffer?
                CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
                guard let buffer = pb else { call.reject("配置畫面失敗"); return }
                CVPixelBufferLockBaseAddress(buffer, [])
                if let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: job.width, height: job.height, bitsPerComponent: 8,
                                       bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: ABAIImageCore.sRGB,
                                       bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) {
                    ctx.interpolationQuality = .high
                    ctx.draw(img, in: CGRect(x: 0, y: 0, width: job.width, height: job.height))
                }
                CVPixelBufferUnlockBaseAddress(buffer, [])
                /* 編碼器忙的時候等一下，不丟格 */
                var waited = 0
                while !job.input.isReadyForMoreMediaData && waited < 2000 { usleep(1000); waited += 1 }
                let ok = job.adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(index), timescale: job.fps))
                if ok { call.resolve() } else { call.reject(job.writer.error?.localizedDescription ?? "寫入失敗") }
            }
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        let id = call.getInt("id") ?? 0
        queue.async {
            guard let job = self.jobs.removeValue(forKey: id) else { call.reject("找不到這個輸出"); return }
            job.input.markAsFinished()
            job.writer.finishWriting {
                DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(job.task) }
                if job.writer.status == .completed { call.resolve(["path": job.url.path]) }
                else { call.reject(job.writer.error?.localizedDescription ?? "影片輸出失敗") }
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let id = call.getInt("id") ?? 0
        queue.async { self.abort(id); call.resolve() }
    }

    private func abort(_ id: Int) {
        guard let job = jobs.removeValue(forKey: id) else { return }
        job.writer.cancelWriting()
        try? FileManager.default.removeItem(at: job.url)
        DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(job.task) }
    }
}
