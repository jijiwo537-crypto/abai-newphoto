//
//  NativePreviewPlugin.swift
//  ABAI — 原生預覽層（Metal＋Core Image，支援 HDR／EDR）
//
//  做法：在網頁「底下」放一個 Metal 畫面，網頁把照片那一塊變成透明，照片就由原生畫。
//  按鈕、滑桿還是網頁的；照片本身用 16 位元浮點、線性 P3 繪製，螢幕支援 EDR 時，
//  HDR 照片的亮部會真的比白色更亮（網頁做不到）。
//
//  網頁那邊的對應：utils/nativePreview.ts
//    show({ path, x, y, w, h, lut | cube+cubeSize, amount, hdr })
//    update({ ...同上任意幾項 })     改色彩表、強度、位置
//    hide()
//  座標是網頁的 CSS 像素（相對整個 WebView）。
//

import Foundation
import Capacitor
import CoreImage
import Metal
import MetalKit
import UIKit
import WebKit

final class ABAIMetalView: MTKView, MTKViewDelegate {
    private let commandQueue: MTLCommandQueue
    private let ciContext: CIContext
    var source: CIImage? { didSet { setNeedsDisplay() } }
    var cube: ABAIImageCore.Cube? { didSet { setNeedsDisplay() } }
    var amount: Double = 1 { didSet { setNeedsDisplay() } }
    /// true＝填滿畫面（相機觀景窗），false＝照原比例完整放進來（編輯預覽）
    var fill = false

    init?(frame: CGRect) {
        guard let device = MTLCreateSystemDefaultDevice(), let q = device.makeCommandQueue() else { return nil }
        commandQueue = q
        ciContext = CIContext(mtlDevice: device, options: [
            .workingColorSpace: ABAIImageCore.linearP3,
            .workingFormat: CIFormat.RGBAh,
            .cacheIntermediates: false,
        ])
        super.init(frame: frame, device: device)
        delegate = self
        isPaused = true
        enableSetNeedsDisplay = true
        framebufferOnly = false
        isOpaque = false
        backgroundColor = .clear
        clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        colorPixelFormat = .rgba16Float
        if let layer = layer as? CAMetalLayer {
            layer.colorspace = ABAIImageCore.linearP3
            if #available(iOS 16.0, *) { layer.wantsExtendedDynamicRangeContent = true }
            layer.isOpaque = false
        }
        isUserInteractionEnabled = false
    }

    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) { setNeedsDisplay() }

    func draw(in view: MTKView) {
        guard let src = source, let drawable = currentDrawable,
              let buffer = commandQueue.makeCommandBuffer() else { return }
        var img = src
        if let c = cube { img = ABAIImageCore.apply(cube: c, to: img, amount: amount) }
        /* 照原比例縮進畫面、置中 */
        let ds = drawableSize
        let e = img.extent
        guard e.width > 0, e.height > 0, ds.width > 0, ds.height > 0 else { return }
        let k = fill ? max(ds.width / e.width, ds.height / e.height) : min(ds.width / e.width, ds.height / e.height)
        img = img.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
            .transformed(by: CGAffineTransform(scaleX: k, y: k))
        img = img.transformed(by: CGAffineTransform(translationX: (ds.width - e.width * k) / 2, y: (ds.height - e.height * k) / 2))
        let bg = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: 0)).cropped(to: CGRect(origin: .zero, size: ds))
        img = img.composited(over: bg)
        let dest = CIRenderDestination(width: Int(ds.width), height: Int(ds.height), pixelFormat: colorPixelFormat,
                                       commandBuffer: buffer, mtlTextureProvider: { drawable.texture })
        dest.colorSpace = ABAIImageCore.linearP3
        _ = try? ciContext.startTask(toRender: img, to: dest)
        buffer.present(drawable)
        buffer.commit()
    }
}

@objc(NativePreviewPlugin)
public class NativePreviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePreviewPlugin"
    public let jsName = "NativePreview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
    ]

    private var view: ABAIMetalView?
    private var loadedPath: String?
    private let loadQueue = DispatchQueue(label: "abai.preview.load", qos: .userInitiated)

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": MTLCreateSystemDefaultDevice() != nil])
    }

    @objc func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有 WebView"); return }
            if self.view == nil {
                guard let v = ABAIMetalView(frame: .zero) else { call.reject("這台裝置沒有 Metal"); return }
                parent.insertSubview(v, belowSubview: web)
                self.view = v
            }
            NativePreviewPlugin.setWebTransparent(web, true)
            self.apply(call, web: web)
            call.resolve()
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, self.view != nil else { call.resolve(); return }
            self.apply(call, web: web)
            call.resolve()
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.view?.removeFromSuperview()
            self.view = nil
            self.loadedPath = nil
            if let web = self.bridge?.webView { NativePreviewPlugin.setWebTransparent(web, false) }
            call.resolve()
        }
    }

    /// WebView 變透明，底下的原生畫面才看得到。關掉時恢復成黑底（跟 capacitor.config 的 backgroundColor 一致）
    static func setWebTransparent(_ web: WKWebView, _ on: Bool) {
        web.isOpaque = !on
        web.backgroundColor = on ? .clear : .black
        web.scrollView.backgroundColor = on ? .clear : .black
    }

    private func apply(_ call: CAPPluginCall, web: WKWebView) {
        guard let v = view else { return }
        if let x = call.getDouble("x"), let y = call.getDouble("y"), let w = call.getDouble("w"), let h = call.getDouble("h") {
            v.frame = CGRect(x: web.frame.minX + x, y: web.frame.minY + y, width: w, height: h)
        }
        if let a = call.getDouble("amount") { v.amount = a }
        if let b = call.getString("cube"), let n = call.getInt("cubeSize") {
            v.cube = ABAIImageCore.cube(base64: b, size: n)
        } else if let name = call.getString("lut") {
            v.cube = name.isEmpty ? nil : ABAIImageCore.bundledLut(name).flatMap { ABAIImageCore.cube(fromAtlas: $0) }
        }
        if let path = call.getString("path"), path != loadedPath, let url = ABAIImageCore.fileURL(from: path) {
            loadedPath = path
            let hdr = call.getBool("hdr") ?? false
            /* 只解到畫面需要的大小（再多留一點縮放空間），HDR 照片則交給 Core Image 延遲解碼 */
            let need = Int(max(v.bounds.width, v.bounds.height) * UIScreen.main.scale * 1.5)
            loadQueue.async {
                var img: CIImage?
                if hdr { img = ABAIImageCore.ciImage(url, expandHDR: true) }
                if img == nil, let cg = ABAIImageCore.downsample(url, maxPixel: max(1024, need)) { img = CIImage(cgImage: cg) }
                DispatchQueue.main.async { if self.loadedPath == path { self.view?.source = img } }
            }
        } else {
            v.setNeedsDisplay()
        }
    }
}
