//
//  NativeCameraPlugin.swift
//  ABAI — 原生相機（專業模式）
//
//  網頁版相機（getUserMedia）拿不到的東西，這裡都有：
//    ‧ 4800 萬像素（iOS 16 起的 maxPhotoDimensions）
//    ‧ Apple ProRAW（支援的機型：iPhone 12 Pro 以後的 Pro 機型）；其他機型不開放 RAW
//    ‧ 零快門延遲、快速連拍優先、反應式拍攝（iOS 17 起）
//    ‧ 相機控制按鈕（iPhone 16 起）：滑動調變焦、曝光；音量鍵與相機控制按鈕都能當快門
//  觀景窗用原生 Metal 畫，濾鏡（同一批 LUT）直接在觀景窗上即時套用。
//
//  網頁那邊的對應：utils/nativeCamera.ts
//    start({ position, x, y, w, h, lut, amount, proRAW })   stop()
//    capture({ flash, raw, turns, opticalZoom })  → { path, width, height, rawPath?, location?, zoomApplied? }
//    setZoom({ factor })  focus({ x, y })  setExposureBias({ ev })  setLut({ lut, amount })
//    setDate({ date, zoom })   日期戳記（見 ABAIDateStamp.swift）
//    snapshot() → { path }      觀景窗現在這一格（離開相機的過場用）
//    setLevel({ on })  setLocation({ on })  showMenu({ anchor, items })   水平儀、位置、原生設定選單
//    事件 level { roll, flat }、menu { id, value }、menuClosed
//    事件 orientation { turns }：手機怎麼拿（0 直拿、1 頂端朝左、3 頂端朝右），介面圖示跟著轉、橫拿拍出橫的照片
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
import CoreMotion
import CoreLocation
import AudioToolbox
import ImageIO
import UIKit
import WebKit

@objc(NativeCameraPlugin)
public class NativeCameraPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate, CLLocationManagerDelegate {
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
        CAPPluginMethod(name: "setRawMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWhiteBalance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFx", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLevel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showMenu", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPreviewHidden", returnType: CAPPluginReturnPromise),
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
        call.resolve(["available": ok, "proRAW": proRAWSupported, "raw": proRAWSupported])
    }

    // MARK: 開啟、關閉

    /* 開、關相機的順序號碼：關掉之後，還在路上的「開相機」就作廢 ——
       不然它晚一步把網頁設成透明，離開相機後網頁就一直是透明的（狀態列透出白色） */
    private var generation = 0
    private let genLock = NSLock()
    private func nextGeneration() -> Int { genLock.lock(); defer { genLock.unlock() }; generation += 1; return generation }
    private func currentGeneration() -> Int { genLock.lock(); defer { genLock.unlock() }; return generation }

    @objc func start(_ call: CAPPluginCall) {
        /* 號碼在收到呼叫的當下就拿（照網頁呼叫的先後），不是排到主執行緒才拿：
           翻轉鏡頭是「先關、再開」，關的號碼晚一步生效的話，會把剛開的相機誤判成作廢 */
        let gen = nextGeneration()
        position = call.getString("position") == "front" ? .front : .back
        proRAW = call.getBool("proRAW") ?? false
        amount = call.getDouble("amount") ?? 1
        if let name = call.getString("lut"), !name.isEmpty, let u = ABAIImageCore.bundledLut(name) { cube = ABAIImageCore.cube(fromAtlas: u) } else { cube = nil }
        AVCaptureDevice.requestAccess(for: .video) { granted in
            guard granted else { call.reject("沒有相機權限"); return }
            DispatchQueue.main.async {
                guard gen == self.currentGeneration() else { call.reject("superseded"); return }
                guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有 WebView"); return }
                if self.view == nil {
                    guard let v = ABAIMetalView.make(frame: .zero) else { call.reject("這台裝置沒有 Metal"); return }
                    v.fill = true
                    v.isHidden = self.previewHidden   // 相簿還開著時重開相機：照樣藏著
                    parent.insertSubview(v, belowSubview: web)
                    self.view = v
                }
                self.view?.cube = self.cube
                self.view?.amount = self.amount
                self.view?.fx = self.fx
                self.view?.kelvin = self.kelvin
                self.place(call, web: web)
                self.startMotion()
                NativePreviewPlugin.setWebTransparent(web, true)
                self.installHardwareShutter(on: web)
                self.sessionQueue.async {
                    guard gen == self.currentGeneration() else { call.reject("superseded"); return }
                    do {
                        ABAICameraFx.prewarm()
                        try self.configure()
                        if !self.session.isRunning { self.session.startRunning() }
                        /* 後鏡頭：真的閃光燈；前鏡頭：螢幕補光（跟內建相機一樣把整個螢幕打亮） */
                        let ledFlash = self.photoOutput.supportedFlashModes.contains(.on)
                        /* 介面倍率的範圍（1＝主鏡頭）：0.5 以下＝有超廣角；最大到多少倍 */
                        let base = self.device?.virtualDeviceSwitchOverVideoZoomFactors.first.map { CGFloat(truncating: $0) } ?? 1
                        let minUI = Double((self.device?.minAvailableVideoZoomFactor ?? 1) / base)
                        let maxUI = Double((self.device?.maxAvailableVideoZoomFactor ?? 1) / base)
                        call.resolve(["proRAW": self.photoOutput.isAppleProRAWEnabled, "turns": self.turns,
                                      "minZoom": minUI, "maxZoom": maxUI,
                                      "raw": self.rawFormat() != nil,
                                      "maxWidth": self.maxDimensions.width, "maxHeight": self.maxDimensions.height,
                                      "flash": ledFlash || self.position == .front,
                                      "screenFlash": !ledFlash && self.position == .front])
                    } catch { call.reject(error.localizedDescription) }
                }
            }
        }
    }

    /// 相簿、RAW 沖洗蓋在相機上面時，把觀景窗整個藏起來：網頁哪裡挖空都不會透出相機畫面。
    /// 相機本身繼續開著（回到相機時不用重新啟動）
    private var previewHidden = false
    @objc func setPreviewHidden(_ call: CAPPluginCall) {
        let hidden = call.getBool("hidden") ?? false
        DispatchQueue.main.async {
            self.previewHidden = hidden
            self.view?.isHidden = hidden
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        let stopGeneration = nextGeneration()
        sessionQueue.async {
            guard stopGeneration == self.currentGeneration() else { call.resolve(); return }
            if self.session.isRunning { self.session.stopRunning() }
            DispatchQueue.main.async {
                guard stopGeneration == self.currentGeneration() else { call.resolve(); return }
                self.view?.removeFromSuperview(); self.view = nil
                self.stopMotion()
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

    /// 使用者開著 RAW 開關：見 applyRawMode
    private var rawMode = false
    /* RAW：跟原相機一樣每一張都完整多張合成。「回應式拍攝」「快速拍攝優先」會在連按、前一張還在處理時
       自動降低合成品質換速度 —— ProRAW 的寬容度就是從多張合成來的，開 RAW 時兩個都關掉；沒開 RAW 時照舊開著（拍得快） */
    private func applyRawMode() {
        if #available(iOS 17.0, *) {
            /* 「快速拍攝優先」要在「回應式拍攝」開著時才能開：關的時候先關它、開的時候後開它（順序錯了系統會丟例外） */
            if rawMode {
                if photoOutput.isFastCapturePrioritizationSupported { photoOutput.isFastCapturePrioritizationEnabled = false }
                if photoOutput.isResponsiveCaptureSupported { photoOutput.isResponsiveCaptureEnabled = false }
            } else {
                if photoOutput.isResponsiveCaptureSupported { photoOutput.isResponsiveCaptureEnabled = true }
                if photoOutput.isResponsiveCaptureEnabled && photoOutput.isFastCapturePrioritizationSupported { photoOutput.isFastCapturePrioritizationEnabled = true }
            }
        }
    }
    /// setRawMode({ on })：RAW 開關切換時呼叫
    @objc func setRawMode(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        sessionQueue.async {
            self.rawMode = on
            if self.configured {
                self.session.beginConfiguration()
                self.applyRawMode()
                self.session.commitConfiguration()
            }
            call.resolve()
        }
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
            /* RAW：跟原相機一樣每一張都完整多張合成。「回應式拍攝」「快速拍攝優先」會在連按、前一張還在處理時
               自動降低合成品質換速度 —— ProRAW 的寬容度就是從多張合成來的，開 RAW 時兩個都關掉 */
            applyRawMode()
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
        /* 拍出來的照片不鏡像（跟 iPhone 原相機預設「前置鏡頭鏡像」關閉一樣：觀景窗像照鏡子，成品是別人看到的樣子）。
           照片輸出的連線預設會自動跟著前鏡頭鏡像，要明確關掉；RAW 本來就不鏡像，兩者一致 */
        if let c = photoOutput.connection(with: .video), c.isVideoMirroringSupported {
            c.automaticallyAdjustsVideoMirroring = false
            c.isVideoMirrored = false
        }
        installSystemControls(dev)
    }

    // MARK: 觀景窗

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        if previewFrozen { return }   // 小框構圖拍照的那一下（見 capture）
        let img = CIImage(cvPixelBuffer: pb)
        DispatchQueue.main.async { self.view?.source = img }
    }

    // MARK: 日期戳記

    /// date：日期字（null／空字串＝不印）；zoom：小框構圖的倍率。跟拍出來的照片同一個位置、同樣大小
    @objc func setDate(_ call: CAPPluginCall) {
        let date = call.getString("date").flatMap { $0.isEmpty ? nil : $0 }
        let zoom = CGFloat(max(1, call.getDouble("zoom") ?? 1))
        DispatchQueue.main.async {
            self.view?.dateText = date; self.view?.dateZoom = zoom; self.view?.dateTurns = self.turns
            call.resolve()
        }
    }

    // MARK: 手機方向（介面鎖在直的，用重力感應判斷手機實際怎麼拿）

    private let motion = CMMotionManager()
    /// 0＝直拿、1＝頂端朝左（逆時針轉了 90°）、3＝頂端朝右。倒過來拿不算（跟內建相機一樣）
    private var turns = 0

    /// 水平儀開著沒（開著才把傾斜角度送給網頁）
    private var levelOn = false
    private var lastLevelSent = 0.0

    /* 用 CMDeviceMotion 的重力向量（比原始加速度乾淨，手晃的時候不抖）：判斷手機怎麼拿、水平儀的角度 */
    private func startMotion() {
        guard !motion.isDeviceMotionActive, !motion.isAccelerometerActive else { return }
        if motion.isDeviceMotionAvailable {
            motion.deviceMotionUpdateInterval = 1.0 / 30
            motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
                guard let self = self, let g = data?.gravity else { return }
                self.handleGravity(x: g.x, y: g.y, z: g.z)
            }
        } else if motion.isAccelerometerAvailable {
            motion.accelerometerUpdateInterval = 0.1
            motion.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
                guard let self = self, let a = data?.acceleration else { return }
                self.handleGravity(x: a.x, y: a.y, z: a.z)
            }
        }
    }

    private func handleGravity(x: Double, y: Double, z: Double) {
        /* 手機方向：平放在桌上時不判斷（重力幾乎都在 z）；兩軸要差夠多才換，在 45° 附近不會一直跳來跳去 */
        if abs(z) <= 0.85 {
            var t = turns
            if y < -0.55 && abs(y) > abs(x) + 0.2 { t = 0 }
            else if abs(x) > 0.55 && abs(x) > abs(y) + 0.2 { t = x < 0 ? 1 : 3 }
            if t != turns {
                turns = t
                view?.dateTurns = t
                notifyListeners("orientation", data: ["turns": t])
            }
        }
        /* 水平儀：畫面（直拿時）的傾斜角度，度。0＝跟地平線平行；平放時沒有意義 → 不送 */
        if levelOn {
            let now = CFAbsoluteTimeGetCurrent()
            if now - lastLevelSent >= 1.0 / 30 {
                lastLevelSent = now
                let flat = abs(z) > 0.9
                let roll = atan2(x, -y) * 180 / .pi
                notifyListeners("level", data: ["roll": roll, "flat": flat])
            }
        }
    }

    private func stopMotion() {
        if motion.isDeviceMotionActive { motion.stopDeviceMotionUpdates() }
        if motion.isAccelerometerActive { motion.stopAccelerometerUpdates() }
    }

    /// 水平儀開關：on＝開始送傾斜角度（事件 level { roll, flat }）
    @objc func setLevel(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async { self.levelOn = on; call.resolve() }
    }

    // MARK: 位置（拍照時把地點記在照片裡）

    private lazy var locationManager: CLLocationManager = {
        let m = CLLocationManager()
        m.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        m.delegate = self
        return m
    }()
    private var lastLocation: CLLocation?
    private var locationOn = false

    @objc func setLocation(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            self.locationOn = on
            if on {
                if self.locationManager.authorizationStatus == .notDetermined { self.locationManager.requestWhenInUseAuthorization() }
                self.locationManager.startUpdatingLocation()
            } else {
                self.locationManager.stopUpdatingLocation()
                self.lastLocation = nil
            }
            call.resolve(["authorized": self.locationManager.authorizationStatus == .authorizedWhenInUse || self.locationManager.authorizationStatus == .authorizedAlways,
                          "denied": self.locationManager.authorizationStatus == .denied || self.locationManager.authorizationStatus == .restricted])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let l = locations.last, l.horizontalAccuracy >= 0 { lastLocation = l }
    }
    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if locationOn, manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways { manager.startUpdatingLocation() }
    }

    /// 拍照那一刻的位置（給網頁轉交 NativeImage.render 寫進照片的 GPS）
    private func locationPayload() -> [String: Any]? {
        guard locationOn, let l = lastLocation, abs(l.timestamp.timeIntervalSinceNow) < 120 else { return nil }
        return ["lat": l.coordinate.latitude, "lon": l.coordinate.longitude, "alt": l.altitude,
                "time": l.timestamp.timeIntervalSince1970, "accuracy": l.horizontalAccuracy]
    }

    // MARK: 設定選單（原生的玻璃面板：iOS 26 起是液態玻璃＋原生開關、分段按鈕）

    private weak var settingsPanel: ABAISettingsPanel?

    /// anchor：網頁那顆按鈕的位置；bounds：觀景窗的範圍（面板貼在它的右上角裡面）（CSS px）
    /// items：[{ id, type: 'toggle'|'choice', title, symbol, value, options? }]。改了就送 menu { id, value }，關掉送 menuClosed
    @objc func showMenu(_ call: CAPPluginCall) {
        let items = (call.getArray("items") ?? []).compactMap { $0 as? [String: Any] }
        func rect(_ o: JSObject?) -> CGRect {
            CGRect(x: (o?["x"] as? NSNumber)?.doubleValue ?? 0, y: (o?["y"] as? NSNumber)?.doubleValue ?? 0,
                   width: (o?["w"] as? NSNumber)?.doubleValue ?? 1, height: (o?["h"] as? NSNumber)?.doubleValue ?? 1)
        }
        let anchor = rect(call.getObject("anchor"))
        let bounds = call.getObject("bounds") != nil ? rect(call.getObject("bounds")) : .infinite
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有畫面"); return }
            if let open = self.settingsPanel { open.dismiss(); call.resolve(); return }   // 再按一次＝收起來
            let p = ABAISettingsPanel(frame: web.frame, items: items, anchor: anchor, bounds: bounds.isInfinite ? web.bounds : bounds)
            p.onChange = { [weak self] id, value in self?.notifyListeners("menu", data: ["id": id, "value": value]) }
            p.onClose = { [weak self] in self?.notifyListeners("menuClosed", data: [:]) }
            parent.insertSubview(p, aboveSubview: web)
            self.settingsPanel = p
            p.present()
            call.resolve()
        }
    }

    /// 拍照的方向：橫拿拍出來就是橫的照片（照片檔本身擺正）
    private func applyCaptureRotation(_ t: Int) {
        guard let c = photoOutput.connection(with: .video) else { return }
        if #available(iOS 17.0, *) {
            let angle: CGFloat = t == 1 ? 0 : t == 3 ? 180 : 90
            if c.isVideoRotationAngleSupported(angle) { c.videoRotationAngle = angle }
        } else if c.isVideoOrientationSupported {
            c.videoOrientation = t == 1 ? .landscapeRight : t == 3 ? .landscapeLeft : .portrait
        }
    }

    /// 不要快門聲：系統要播快門音效之前把它丟掉。
    /// （日本、韓國等地區法規強制快門聲的機型，系統還是會播，這是硬體層級的，沒辦法關）
    public func photoOutput(_ output: AVCapturePhotoOutput, willCapturePhotoFor resolvedSettings: AVCaptureResolvedPhotoSettings) {
        AudioServicesDisposeSystemSoundID(1108)
    }

    /// 觀景窗現在這一格（離開相機的過場用：網頁那邊拿它蓋住觀景窗，再整頁滑走）→ { path }
    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let v = self.view else { call.reject("相機沒開"); return }
            let side = max(v.bounds.width, v.bounds.height) * v.contentScaleFactor
            DispatchQueue.global(qos: .userInteractive).async {
                if let url = v.snapshotFile(maxSide: max(64, side)) { call.resolve(["path": url.path]) }
                else { call.reject("沒有畫面") }
            }
        }
    }

    // MARK: 拍照

    @objc func capture(_ call: CAPPluginCall) {
        sessionQueue.async {
            guard self.pendingCapture == nil else { call.reject("上一張還在處理"); return }
            /* 相機還沒開好（或剛關掉）就按快門：capturePhoto 會丟例外讓 App 閃退，先擋下來 */
            guard self.session.isRunning, let conn = self.photoOutput.connection(with: .video), conn.isEnabled, conn.isActive else {
                call.reject("相機還沒準備好"); return
            }
            /* 開閃光燈也照樣拍 RAW（ProRAW 支援閃光燈；閃光燈模式下面會先確認這個設定支援才開） */
            let wantRaw = call.getBool("raw") ?? false
            let hevc = self.photoOutput.availablePhotoCodecTypes.contains(.hevc)
            let processed: [String: Any] = [AVVideoCodecKey: hevc ? AVVideoCodecType.hevc : AVVideoCodecType.jpeg]
            let settings: AVCapturePhotoSettings
            if wantRaw, let raw = self.rawFormat() {
                settings = AVCapturePhotoSettings(rawPixelFormatType: raw, processedFormat: processed)
                /* RAW 檔裡內嵌一張預覽圖（跟原相機的 ProRAW 一樣）：存進相簿時「照片」App 直接顯示這張，
                   不用等它自己把 RAW 沖完（不然一開始是灰的、過一陣子才出現） */
                /* 只指定格式、尺寸交給系統（跟 Apple 官方範例相機 AVCam 一樣）：自己指定尺寸萬一不被接受，拍照時會丟例外 */
                if let codec = settings.availableRawEmbeddedThumbnailPhotoCodecTypes.first {
                    settings.rawEmbeddedThumbnailPhotoFormat = [AVVideoCodecKey: codec]
                }
            } else {
                settings = AVCapturePhotoSettings(format: processed)
            }
            if #available(iOS 16.0, *) { settings.maxPhotoDimensions = self.photoOutput.maxPhotoDimensions }
            /* RAW 跟原相機一樣用「品質優先」：ProRAW 會多張合成（Smart HDR／Deep Fusion），雜訊低、寬容度大很多。
               「平衡」合成得少，拉亮暗部、救亮部時就差很多（看起來像假的 RAW） */
            settings.photoQualityPrioritization = (wantRaw && self.rawFormat() != nil) ? .quality : .balanced
            switch call.getString("flash") ?? "off" {
            case "on": if self.photoOutput.supportedFlashModes.contains(.on) { settings.flashMode = .on }
            case "auto": if self.photoOutput.supportedFlashModes.contains(.auto) { settings.flashMode = .auto }
            default: settings.flashMode = .off
            }
            self.applyCaptureRotation(call.getInt("turns") ?? self.turns)
            let loc = self.locationPayload()   // 只讀最後一筆位置（主執行緒寫、這裡讀，讀到上一筆也沒關係）
            self.captured = [:]
            if let l = loc { self.captured["location"] = l }
            self.pendingCapture = call
            let wantFlash = (call.getString("flash") ?? "off") == "on"
            let fire = {
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
            /* 小框構圖（線框）：不是拍完再從 1x 的照片裁一小塊（那樣解析度只剩幾分之一，照片和日期都會糊），
               而是拍的那一下讓鏡頭真的變焦到框的倍率 —— 到 3x 會自動換成長焦鏡頭，超過的部分系統用超解析變焦補。
               變焦那一瞬間觀景窗停在上一格，不會看到畫面跳；拍完再變回來 */
            if let want = call.getDouble("opticalZoom"), let d = self.device, (try? d.lockForConfiguration()) != nil {
                let base = d.virtualDeviceSwitchOverVideoZoomFactors.first.map { CGFloat(truncating: $0) } ?? 1
                let target = max(d.minAvailableVideoZoomFactor, min(d.maxAvailableVideoZoomFactor, CGFloat(want) * base))
                if target > d.videoZoomFactor * 1.01 {
                    self.zoomToRestore = d.videoZoomFactor
                    self.previewFrozen = true
                    d.videoZoomFactor = target
                    d.unlockForConfiguration()
                    self.captured["zoomApplied"] = Double(target / base)
                    /* 等鏡頭切換、對焦測光跟上 */
                    self.sessionQueue.asyncAfter(deadline: .now() + 0.4) { fire() }
                    return
                }
                d.unlockForConfiguration()
            }
            fire()
        }
    }

    /// 小框構圖拍照時暫時變焦：拍完要變回去的倍率；這段期間觀景窗停在上一格
    private var zoomToRestore: CGFloat?
    private var previewFrozen = false
    private func restoreZoomAfterCapture() {
        guard let z = zoomToRestore else { return }
        zoomToRestore = nil
        sessionQueue.async {
            if let d = self.device, (try? d.lockForConfiguration()) != nil { d.videoZoomFactor = z; d.unlockForConfiguration() }
            /* 等鏡頭變回來、畫面穩了再放開觀景窗 */
            self.sessionQueue.asyncAfter(deadline: .now() + 0.35) { self.previewFrozen = false }
        }
    }

    /// 現在這顆鏡頭能拍的 ProRAW 格式（沒開 ProRAW、或這顆鏡頭不支援就回 nil）
    private func rawFormat() -> OSType? {
        guard photoOutput.isAppleProRAWEnabled else { return nil }
        return photoOutput.availableRawPhotoPixelFormatTypes.first(where: { AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) })
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
        restoreZoomAfterCapture()
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

    /// kelvin：色溫（2500～9000）。照網頁觀景窗同一條公式算 R、B 增益，套在畫面上（觀景窗、拍出來的照片都一樣）。
    /// 不鎖鏡頭本身的白平衡：三鏡頭這類組合鏡頭大多不支援自訂增益，鎖不住就等於沒反應
    private var kelvin: Double = 5500
    @objc func setWhiteBalance(_ call: CAPPluginCall) {
        let k = (call.getBool("auto") ?? false) ? 5500 : (call.getDouble("kelvin") ?? 5500)
        DispatchQueue.main.async { self.kelvin = k; self.view?.kelvin = k; call.resolve() }
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
