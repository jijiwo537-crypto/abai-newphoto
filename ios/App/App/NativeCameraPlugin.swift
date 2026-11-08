//
//  NativeCameraPlugin.swift
//  ABAI — 原生相機（專業模式）
//
//  網頁版相機（getUserMedia）拿不到的東西，這裡都有：
//    ‧ 4800 萬像素（iOS 16 起的 maxPhotoDimensions）
//    ‧ Apple ProRAW（支援的機型）
//    ‧ 零快門延遲、快速連拍優先、反應式拍攝（iOS 17 起）
//    ‧ 相機控制按鈕（iPhone 16 起）：滑動調變焦、曝光；音量鍵與相機控制按鈕都能當快門
//  觀景窗用原生 Metal 畫，濾鏡（同一批 LUT）直接在觀景窗上即時套用。
//
//  網頁那邊的對應：utils/nativeCamera.ts
//    start({ position, x, y, w, h, lut, amount, proRAW })   stop()
//    capture({ flash, raw })  → { path, width, height, rawPath? }
//    setZoom({ factor })  focus({ x, y })  setExposureBias({ ev })  setLut({ lut, amount })
//    事件：shutter（實體按鈕按下）、zoom（相機控制按鈕改了變焦）
//
//  不用「延後處理」（deferred photo delivery）：那種照片只能直接進相簿，
//  拿不到像素就沒辦法再套 ABAI 的濾鏡。改用零快門延遲＋反應式拍攝，按下去的速度差不多。
//

import Foundation
import Capacitor
import AVFoundation
import AVKit
import CoreImage
import UIKit
import WebKit

@objc(NativeCameraPlugin)
public class NativeCameraPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
    public let identifier = "NativeCameraPlugin"
    public let jsName = "NativeCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setZoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "focus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setExposureBias", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWhiteBalance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFx", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRect", returnType: CAPPluginReturnPromise),
    ]

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "abai.camera.session")
    private let videoQueue = DispatchQueue(label: "abai.camera.video", qos: .userInteractive)
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private var device: AVCaptureDevice?
    private var position: AVCaptureDevice.Position = .back
    private var view: ABAIMetalView?
    private var cube: ABAIImageCore.Cube?
    private var amount: Double = 1
    private var configured = false
    private var proRAW = false
    private var pendingCapture: CAPPluginCall?
    private var captured: [String: Any] = [:]
    private var interaction: UIInteraction?
    private var lastFrame = CFAbsoluteTimeGetCurrent()

    @objc func available(_ call: CAPPluginCall) {
        let ok = AVCaptureDevice.default(for: .video) != nil
        var proRAWSupported = false
        if ok {
            let probe = AVCapturePhotoOutput()
            proRAWSupported = probe.isAppleProRAWSupported
        }
        call.resolve(["available": ok, "proRAW": proRAWSupported])
    }

    // MARK: 開啟、關閉

    /* 開、關相機的順序號碼：關掉之後，還在路上的「開相機」就作廢 ——
       不然它晚一步把網頁設成透明，離開相機後網頁就一直是透明的（狀態列透出白色） */
    private var generation = 0

    @objc func start(_ call: CAPPluginCall) {
        generation += 1
        let gen = generation
        position = call.getString("position") == "front" ? .front : .back
        proRAW = call.getBool("proRAW") ?? false
        amount = call.getDouble("amount") ?? 1
        if let name = call.getString("lut"), !name.isEmpty, let u = ABAIImageCore.bundledLut(name) { cube = ABAIImageCore.cube(fromAtlas: u) } else { cube = nil }
        AVCaptureDevice.requestAccess(for: .video) { granted in
            guard granted else { call.reject("沒有相機權限"); return }
            DispatchQueue.main.async {
                guard gen == self.generation else { call.reject("相機已經關掉"); return }
                guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有 WebView"); return }
                if self.view == nil {
                    guard let v = ABAIMetalView.make(frame: .zero) else { call.reject("這台裝置沒有 Metal"); return }
                    v.fill = true
                    parent.insertSubview(v, belowSubview: web)
                    self.view = v
                }
                self.view?.cube = self.cube
                self.view?.amount = self.amount
                self.view?.fx = self.fx
                self.place(call, web: web)
                NativePreviewPlugin.setWebTransparent(web, true)
                self.installHardwareShutter(on: web)
                self.sessionQueue.async {
                    do {
                        ABAICameraFx.prewarm()
                        try self.configure()
                        if !self.session.isRunning { self.session.startRunning() }
                        /* 後鏡頭：真的閃光燈；前鏡頭：螢幕補光（跟內建相機一樣把整個螢幕打亮） */
                        let ledFlash = self.photoOutput.supportedFlashModes.contains(.on)
                        call.resolve(["proRAW": self.photoOutput.isAppleProRAWEnabled,
                                      "maxWidth": self.maxDimensions.width, "maxHeight": self.maxDimensions.height,
                                      "flash": ledFlash || self.position == .front,
                                      "screenFlash": !ledFlash && self.position == .front])
                    } catch { call.reject(error.localizedDescription) }
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.generation += 1 }
        sessionQueue.async {
            if self.session.isRunning { self.session.stopRunning() }
            DispatchQueue.main.async {
                self.view?.removeFromSuperview(); self.view = nil
                if let i = self.interaction, let web = self.bridge?.webView { web.removeInteraction(i) }
                self.interaction = nil
                if let web = self.bridge?.webView { NativePreviewPlugin.setWebTransparent(web, false) }
                call.resolve()
            }
        }
    }

    @objc func setRect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let web = self.bridge?.webView { self.place(call, web: web) }
            call.resolve()
        }
    }

    private func place(_ call: CAPPluginCall, web: WKWebView) {
        guard let v = view, let x = call.getDouble("x"), let y = call.getDouble("y"),
              let w = call.getDouble("w"), let h = call.getDouble("h") else { return }
        v.frame = CGRect(x: web.frame.minX + x, y: web.frame.minY + y, width: w, height: h)
        /* 跟網頁的觀景窗外框一樣的圓角 */
        let r = CGFloat(call.getDouble("radius") ?? 0)
        v.layer.cornerRadius = r
        v.layer.cornerCurve = .continuous
        v.layer.masksToBounds = r > 0
    }

    private var maxDimensions: CMVideoDimensions {
        if #available(iOS 16.0, *) { return photoOutput.maxPhotoDimensions }
        return CMVideoDimensions(width: 0, height: 0)
    }

    private func bestDevice(_ pos: AVCaptureDevice.Position) -> AVCaptureDevice? {
        let types: [AVCaptureDevice.DeviceType] = pos == .back
            ? [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
            : [.builtInTrueDepthCamera, .builtInWideAngleCamera]
        return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: pos).devices.first
    }

    private func configure() throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        for input in session.inputs { session.removeInput(input) }
        guard let dev = bestDevice(position) else { throw ABAIImageCore.CoreError.unsupported("相機") }
        let input = try AVCaptureDeviceInput(device: dev)
        guard session.canAddInput(input) else { throw ABAIImageCore.CoreError.unsupported("相機輸入") }
        session.addInput(input)
        device = dev
        /* 虛擬鏡頭預設倍率 1 是超廣角；一打開要停在主鏡頭（介面上的 1x） */
        if let base = dev.virtualDeviceSwitchOverVideoZoomFactors.first, (try? dev.lockForConfiguration()) != nil {
            dev.videoZoomFactor = CGFloat(truncating: base)
            dev.unlockForConfiguration()
        }

        if !configured {
            guard session.canAddOutput(photoOutput), session.canAddOutput(videoOutput) else { throw ABAIImageCore.CoreError.unsupported("相機輸出") }
            session.addOutput(photoOutput)
            videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
            session.addOutput(videoOutput)
            configured = true
        }

        /* 最大解析度：這顆鏡頭目前格式支援的最大尺寸（4800 萬像素的機型就是 48MP） */
        if #available(iOS 16.0, *) {
            let dims = dev.activeFormat.supportedMaxPhotoDimensions
            /* 最多約 2400 萬像素：4800 萬像素的照片在原生端套濾鏡、特效時要好幾百 MB，
               系統會直接把 App 收掉（拍照時重啟就是這個原因）。2400 萬像素已經是內建相機的預設解析度 */
            let cap = 24_500_000
            let fit = dims.filter { Int($0.width) * Int($0.height) <= cap }
            if let best = (fit.isEmpty ? dims : fit).max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) {
                photoOutput.maxPhotoDimensions = best
            }
        }
        photoOutput.maxPhotoQualityPrioritization = .quality
        photoOutput.isAppleProRAWEnabled = proRAW && photoOutput.isAppleProRAWSupported
        if #available(iOS 17.0, *) {
            if photoOutput.isZeroShutterLagSupported { photoOutput.isZeroShutterLagEnabled = true }
            if photoOutput.isResponsiveCaptureSupported { photoOutput.isResponsiveCaptureEnabled = true }
            if photoOutput.isFastCapturePrioritizationSupported { photoOutput.isFastCapturePrioritizationEnabled = true }
        }

        for conn in [videoOutput.connection(with: .video), photoOutput.connection(with: .video)].compactMap({ $0 }) {
            if #available(iOS 17.0, *) {
                if conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }
            } else if conn.isVideoOrientationSupported {
                conn.videoOrientation = .portrait
            }
        }
        if let c = videoOutput.connection(with: .video), c.isVideoMirroringSupported {
            c.automaticallyAdjustsVideoMirroring = false
            c.isVideoMirrored = position == .front
        }
        installSystemControls(dev)
    }

    // MARK: 觀景窗

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let img = CIImage(cvPixelBuffer: pb)
        DispatchQueue.main.async { self.view?.source = img }
    }

    // MARK: 拍照

    @objc func capture(_ call: CAPPluginCall) {
        sessionQueue.async {
            guard self.pendingCapture == nil else { call.reject("上一張還在處理"); return }
            /* 相機還沒開好（或剛關掉）就按快門：capturePhoto 會丟例外讓 App 閃退，先擋下來 */
            guard self.session.isRunning, let conn = self.photoOutput.connection(with: .video), conn.isEnabled, conn.isActive else {
                call.reject("相機還沒準備好"); return
            }
            /* 開閃光燈時不拍 RAW：RAW 不一定支援閃光燈，混在一起設定會讓系統丟例外 */
            let flashWanted = (call.getString("flash") ?? "off") != "off"
            let wantRaw = (call.getBool("raw") ?? false) && self.photoOutput.isAppleProRAWEnabled && !flashWanted
            let hevc = self.photoOutput.availablePhotoCodecTypes.contains(.hevc)
            let processed: [String: Any] = [AVVideoCodecKey: hevc ? AVVideoCodecType.hevc : AVVideoCodecType.jpeg]
            let settings: AVCapturePhotoSettings
            if wantRaw, let raw = self.photoOutput.availableRawPhotoPixelFormatTypes.first(where: { AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) }) {
                settings = AVCapturePhotoSettings(rawPixelFormatType: raw, processedFormat: processed)
            } else {
                settings = AVCapturePhotoSettings(format: processed)
            }
            if #available(iOS 16.0, *) { settings.maxPhotoDimensions = self.photoOutput.maxPhotoDimensions }
            settings.photoQualityPrioritization = .balanced
            switch call.getString("flash") ?? "off" {
            case "on": if self.photoOutput.supportedFlashModes.contains(.on) { settings.flashMode = .on }
            case "auto": if self.photoOutput.supportedFlashModes.contains(.auto) { settings.flashMode = .auto }
            default: settings.flashMode = .off
            }
            self.captured = [:]
            self.pendingCapture = call
            let wantFlash = (call.getString("flash") ?? "off") == "on"
            if wantFlash && settings.flashMode == .off && self.position == .front {
                /* 前鏡頭沒有閃光燈：螢幕整片打白、亮度拉滿，等一下下讓測光跟上，再拍 */
                DispatchQueue.main.async {
                    self.beginScreenFlash()
                    self.sessionQueue.asyncAfter(deadline: .now() + 0.28) {
                        self.photoOutput.capturePhoto(with: settings, delegate: self)
                    }
                }
            } else {
                self.photoOutput.capturePhoto(with: settings, delegate: self)
            }
        }
    }

    private var flashView: UIView?
    private var savedBrightness: CGFloat?

    private func beginScreenFlash() {
        guard flashView == nil, let window = bridge?.webView?.window else { return }
        let v = UIView(frame: window.bounds)
        v.backgroundColor = UIColor(red: 1, green: 0.97, blue: 0.92, alpha: 1)   // 偏暖一點的白，膚色比較好看
        v.isUserInteractionEnabled = false
        window.addSubview(v)
        flashView = v
        savedBrightness = UIScreen.main.brightness
        UIScreen.main.brightness = 1
    }

    private func endScreenFlash() {
        DispatchQueue.main.async {
            guard let v = self.flashView else { return }
            self.flashView = nil
            if let b = self.savedBrightness { UIScreen.main.brightness = b }
            self.savedBrightness = nil
            UIView.animate(withDuration: 0.18, animations: { v.alpha = 0 }, completion: { _ in v.removeFromSuperview() })
        }
    }

    public func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard error == nil, let data = photo.fileDataRepresentation() else { return }
        let isRaw = photo.isRawPhoto
        let url = ABAIImageCore.newFileURL(ext: isRaw ? "dng" : (output.availablePhotoCodecTypes.contains(.hevc) ? "heic" : "jpg"))
        do { try data.write(to: url) } catch { return }
        if isRaw { captured["rawPath"] = url.path }
        else {
            captured["path"] = url.path
            if let s = ABAIImageCore.pixelSize(of: url) { captured["width"] = Int(s.width); captured["height"] = Int(s.height) }
        }
    }

    public func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        let call = pendingCapture
        pendingCapture = nil
        endScreenFlash()
        if let e = error { call?.reject(e.localizedDescription); return }
        if captured["path"] == nil, let raw = captured["rawPath"] { captured["path"] = raw }
        call?.resolve(captured)
    }

    // MARK: 變焦、對焦、曝光、濾鏡

    /// factor：鏡頭本身的倍率；或 uiZoom：介面上的倍率（1＝主鏡頭、0.5＝超廣角），自動換算
    @objc func setZoom(_ call: CAPPluginCall) {
        sessionQueue.async {
            guard let d = self.device, (try? d.lockForConfiguration()) != nil else { call.resolve(); return }
            /* 三鏡頭／雙廣角的虛擬鏡頭：倍率 1 是超廣角，主鏡頭在第一個切換點 */
            let base = d.virtualDeviceSwitchOverVideoZoomFactors.first.map { CGFloat(truncating: $0) } ?? 1
            let f: CGFloat = call.getDouble("uiZoom").map { CGFloat($0) * base } ?? CGFloat(call.getDouble("factor") ?? 1)
            d.videoZoomFactor = max(d.minAvailableVideoZoomFactor, min(d.maxAvailableVideoZoomFactor, f))
            d.unlockForConfiguration()
            call.resolve(["factor": Double(d.videoZoomFactor)])
        }
    }

    /// x、y：觀景窗裡的位置，0～1（左上角是 0,0）
    @objc func focus(_ call: CAPPluginCall) {
        let x = call.getDouble("x") ?? 0.5, y = call.getDouble("y") ?? 0.5
        sessionQueue.async {
            guard let d = self.device, (try? d.lockForConfiguration()) != nil else { call.resolve(); return }
            /* 感光元件的座標是橫的：直拿時畫面的 (x, y) 對應到 (y, 1 - x) */
            let p = CGPoint(x: y, y: self.position == .front ? x : 1 - x)
            /* 每一項都先確認這顆鏡頭支援，不支援的設定會讓系統丟例外 */
            if d.isFocusPointOfInterestSupported && d.isFocusModeSupported(.autoFocus) { d.focusPointOfInterest = p; d.focusMode = .autoFocus }
            if d.isExposurePointOfInterestSupported && d.isExposureModeSupported(.autoExpose) { d.exposurePointOfInterest = p; d.exposureMode = .autoExpose }
            d.isSubjectAreaChangeMonitoringEnabled = true
            d.unlockForConfiguration()
            call.resolve()
        }
    }

    @objc func setExposureBias(_ call: CAPPluginCall) {
        let ev = Float(call.getDouble("ev") ?? 0)
        sessionQueue.async {
            guard let d = self.device, (try? d.lockForConfiguration()) != nil else { call.resolve(); return }
            d.setExposureTargetBias(max(d.minExposureTargetBias, min(d.maxExposureTargetBias, ev)), completionHandler: nil)
            d.unlockForConfiguration()
            call.resolve()
        }
    }

    /// 即時特效（柔光、朦朧、低保真，0～1）：直接畫在原生觀景窗上，切換不用重開相機
    private var fx = ABAICameraFx()
    @objc func setFx(_ call: CAPPluginCall) {
        let f = ABAICameraFx(call.options as? [String: Any])
        DispatchQueue.main.async { self.fx = f; self.view?.fx = f; call.resolve() }
    }

    /// kelvin：色溫（2500～9000）；auto＝true 或沒給就交回自動白平衡
    @objc func setWhiteBalance(_ call: CAPPluginCall) {
        let auto = call.getBool("auto") ?? (call.getDouble("kelvin") == nil)
        let kelvin = Float(call.getDouble("kelvin") ?? 5500)
        sessionQueue.async {
            guard let d = self.device, (try? d.lockForConfiguration()) != nil else { call.resolve(); return }
            defer { d.unlockForConfiguration() }
            if auto || !d.isLockingWhiteBalanceWithCustomDeviceGainsSupported {
                if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
                call.resolve(); return
            }
            var g = d.deviceWhiteBalanceGains(for: AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(temperature: kelvin, tint: 0))
            let maxG = d.maxWhiteBalanceGain
            g.redGain = max(1, min(maxG, g.redGain)); g.greenGain = max(1, min(maxG, g.greenGain)); g.blueGain = max(1, min(maxG, g.blueGain))
            d.setWhiteBalanceModeLocked(with: g, completionHandler: nil)
            call.resolve()
        }
    }

    @objc func setLut(_ call: CAPPluginCall) {
        let name = call.getString("lut") ?? ""
        let a = call.getDouble("amount") ?? 1
        let c = name.isEmpty ? nil : ABAIImageCore.bundledLut(name).flatMap { ABAIImageCore.cube(fromAtlas: $0) }
        DispatchQueue.main.async {
            self.cube = c; self.amount = a
            self.view?.cube = c; self.view?.amount = a
            call.resolve()
        }
    }

    // MARK: 實體按鈕

    /// 音量鍵、相機控制按鈕按下時通知網頁（iOS 17.2 起）。網頁決定要不要拍。
    private func installHardwareShutter(on web: WKWebView) {
        guard interaction == nil else { return }
        if #available(iOS 17.2, *) {
            let i = AVCaptureEventInteraction { [weak self] event in
                if event.phase == .began { self?.notifyListeners("shutter", data: [:]) }
            }
            web.addInteraction(i)
            interaction = i
        }
    }

    /// 相機控制按鈕（iOS 18 起）：系統內建的變焦和曝光滑桿
    private func installSystemControls(_ dev: AVCaptureDevice) {
        guard #available(iOS 18.0, *), session.supportsControls else { return }
        for c in session.controls { session.removeControl(c) }
        let zoom = AVCaptureSystemZoomSlider(device: dev) { [weak self] factor in
            self?.notifyListeners("zoom", data: ["factor": Double(factor)])
        }
        let exposure = AVCaptureSystemExposureBiasSlider(device: dev)
        for c in [zoom, exposure] as [AVCaptureControl] where session.canAddControl(c) { session.addControl(c) }
        session.setControlsDelegate(ControlsDelegate.shared, queue: sessionQueue)
    }
}

/// 相機控制按鈕的生命週期回呼（規定一定要有，目前不需要做事）
@available(iOS 18.0, *)
final class ControlsDelegate: NSObject, AVCaptureSessionControlsDelegate {
    static let shared = ControlsDelegate()
    func sessionControlsDidBecomeActive(_ session: AVCaptureSession) {}
    func sessionControlsWillEnterFullscreenAppearance(_ session: AVCaptureSession) {}
    func sessionControlsWillExitFullscreenAppearance(_ session: AVCaptureSession) {}
    func sessionControlsDidBecomeInactive(_ session: AVCaptureSession) {}
}
