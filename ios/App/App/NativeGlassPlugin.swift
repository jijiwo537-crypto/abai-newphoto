//
//  NativeGlassPlugin.swift
//  ABAI — 原生的液態玻璃按鈕（iOS 26 起系統的 Liquid Glass；更早的系統用毛玻璃）
//
//  網頁那邊排好位置（CSS px，相對於 WebView），這裡在 WebView 上面疊真正的原生按鈕：
//    show({ group, items })   一組按鈕（同一組再 show 一次＝整組換掉）
//      item：{ id, kind: 'circle' | 'capsule', x, y, w, h,
//              symbol?, title?,                     ← circle：一顆
//              buttons?: [{ id, symbol?, title? }] } ← capsule：一條膠囊裡並排好幾顆（像照片 App 下面那條）
//    update({ group, id, symbol?, tint?, enabled? })  換圖示（例如愛心填滿）、顏色、能不能按
//    hide({ group })
//    事件 tap { group, id }
//  網頁那邊：utils/nativeGlass.ts
//
//  另外放了相機設定選單（ABAISettingsPanel）用的玻璃面板，跟這些按鈕同一種材質。
//

import Foundation
import Capacitor
import UIKit

/// 玻璃材質：iOS 26 起是系統的液態玻璃（會折射、會跟著手指亮起來），更早的系統用深色毛玻璃＋一圈細邊
enum ABAIGlass {
    static var isLiquid: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    /// darkAlpha：深色玻璃那層黑色的濃度（不給＝0.3）。個別地方要淺一點時才給（例如成品頁的按鈕）
    static func view(radius: CGFloat, interactive: Bool = true, dark: Bool = false, darkAlpha: CGFloat = 0.3) -> UIVisualEffectView {
        var effect: UIVisualEffect = UIBlurEffect(style: dark ? .systemUltraThinMaterialDark : .systemUltraThinMaterialDark)
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let g = UIGlassEffect()
            g.isInteractive = interactive
            /* 黑色液態玻璃（App 的介面是黑的）：玻璃帶一層深色 */
            /* 0.55 太深（⋯ 選單、詢問框、登入面板看起來幾乎是黑的）：降到 0.3，仍是深色但透得出後面 */
            if dark { g.tintColor = UIColor(white: 0, alpha: darkAlpha) }
            effect = g
        }
        #endif
        let v = UIVisualEffectView(effect: effect)
        v.layer.cornerRadius = radius
        v.layer.cornerCurve = .continuous
        v.clipsToBounds = true
        v.overrideUserInterfaceStyle = .dark
        if !isLiquid {
            v.layer.borderWidth = 0.5
            v.layer.borderColor = UIColor(white: 1, alpha: 0.14).cgColor
        }
        return v
    }

    /// 水平儀的圖示（SF Symbols 沒有好看的）：一根水平管、中間一顆氣泡
    /// 尺：圓角長條＋三條刻度（中間長、兩邊短），簡單好認
    static func rulerIcon(size: CGFloat = 22) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
            let c = ctx.cgContext
            let u = size / 24
            c.setStrokeColor(UIColor.white.cgColor)
            c.setLineWidth(1.7 * u)
            c.setLineCap(.round)
            let body = CGRect(x: 2.5 * u, y: 8 * u, width: 19 * u, height: 8 * u)
            c.addPath(UIBezierPath(roundedRect: body, cornerRadius: 1.8 * u).cgPath)
            c.strokePath()
            for (x, len) in [(CGFloat(7.5), CGFloat(2.6)), (12, 4.2), (16.5, 2.6)] {
                c.move(to: CGPoint(x: x * u, y: body.minY)); c.addLine(to: CGPoint(x: x * u, y: body.minY + len * u))
            }
            c.strokePath()
        }.withRenderingMode(.alwaysTemplate)
    }
    /// 水平線：一條地平線，中間留一個小圓（跟專業相機的水平儀同一種語彙），簡單、跟其他線條圖示同樣粗細
    static func levelIcon(size: CGFloat = 20) -> UIImage {
        let r = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        return r.image { ctx in
            let c = ctx.cgContext
            let u = size / 24, mid = size / 2, rad = 3.2 * u
            c.setStrokeColor(UIColor.white.cgColor)
            c.setLineWidth(1.8 * u)
            c.setLineCap(.round)
            c.move(to: CGPoint(x: 2.5 * u, y: mid)); c.addLine(to: CGPoint(x: mid - rad - 2 * u, y: mid))
            c.move(to: CGPoint(x: mid + rad + 2 * u, y: mid)); c.addLine(to: CGPoint(x: size - 2.5 * u, y: mid))
            c.strokePath()
            c.strokeEllipse(in: CGRect(x: mid - rad, y: mid - rad, width: rad * 2, height: rad * 2))
        }.withRenderingMode(.alwaysTemplate)
    }

    /// 把圖示照「圖形本身」的範圍（不含 SF Symbol 的基線留白）等比縮放進 box×box 的方框、置中：每一顆視覺上一樣大
    static func uniform(_ img: UIImage?, box: CGFloat) -> UIImage? {
        guard let img = img else { return nil }
        let a = img.alignmentRectInsets
        let content = CGRect(x: a.left, y: a.top, width: img.size.width - a.left - a.right, height: img.size.height - a.top - a.bottom)
        guard content.width > 0, content.height > 0 else { return img }
        let k = box / max(content.width, content.height)
        let size = CGSize(width: box, height: box)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let w = img.size.width * k, h = img.size.height * k
            let ox = (box - content.width * k) / 2 - a.left * k, oy = (box - content.height * k) / 2 - a.top * k
            img.withTintColor(.white, renderingMode: .alwaysOriginal).draw(in: CGRect(x: ox, y: oy, width: w, height: h))
        }.withRenderingMode(.alwaysTemplate)
    }

    static func image(_ symbol: String, pointSize: CGFloat = 19, weight: UIImage.SymbolWeight = .regular) -> UIImage? {
        /* 水平線：一把簡單的尺（系統的 ruler 刻度太密），線條粗細跟其他圖示一樣 */
        if symbol == "abai.level" { return rulerIcon(size: pointSize + 3) }
        if symbol == "abai.film" {
            /* 一格底片（直的）：左右兩條齒孔帶、每邊三個齒孔，中間是畫面。
               比 SF Symbol 大一點、線條留空隙，跟旁邊的編輯、愛心看起來一樣重 */
            let side = pointSize + 5
            let size = CGSize(width: side, height: side)
            return UIGraphicsImageRenderer(size: size).image { ctx in
                let c = ctx.cgContext
                let u = side / 24
                c.setStrokeColor(UIColor.white.cgColor)
                c.setFillColor(UIColor.white.cgColor)
                c.setLineWidth(1.6 * u)
                c.setLineCap(.round)
                c.setLineJoin(.round)
                c.addPath(UIBezierPath(roundedRect: CGRect(x: 4.5 * u, y: 3 * u, width: 15 * u, height: 18 * u), cornerRadius: 2.4 * u).cgPath)
                c.move(to: CGPoint(x: 8.5 * u, y: 3 * u)); c.addLine(to: CGPoint(x: 8.5 * u, y: 21 * u))
                c.move(to: CGPoint(x: 15.5 * u, y: 3 * u)); c.addLine(to: CGPoint(x: 15.5 * u, y: 21 * u))
                c.strokePath()
                for y: CGFloat in [7, 12, 17] {
                    for x: CGFloat in [6.5, 17.5] {
                        c.addPath(UIBezierPath(roundedRect: CGRect(x: (x - 0.9) * u, y: (y - 1.1) * u, width: 1.8 * u, height: 2.2 * u), cornerRadius: 0.5 * u).cgPath)
                    }
                }
                c.fillPath()
            }.withRenderingMode(.alwaysTemplate)
        }
        if symbol == "abai.raw" {
            /* 24×24 的設計稿，跟著 pointSize 等比例縮放（19pt 時剛好跟其他 SF Symbol 一樣大） */
            let k = (pointSize + 3) / 24
            let size = CGSize(width: 24 * k, height: 24 * k)
            return UIGraphicsImageRenderer(size: size).image { ctx in
                let c = ctx.cgContext
                c.scaleBy(x: k, y: k)
                c.setStrokeColor(UIColor.white.cgColor)
                c.setFillColor(UIColor(white: 0.08, alpha: 1).cgColor)
                c.setLineWidth(1.7)
                c.setLineCap(.round)
                for y: CGFloat in [6, 12, 18] {
                    c.move(to: CGPoint(x: 3.5, y: y))
                    c.addLine(to: CGPoint(x: 20.5, y: y))
                }
                c.strokePath()
                for (x, y) in [(CGFloat(8), CGFloat(6)), (15, 12), (10.5, 18)] {
                    c.fillEllipse(in: CGRect(x: x - 2, y: y - 2, width: 4, height: 4))
                    c.strokeEllipse(in: CGRect(x: x - 2, y: y - 2, width: 4, height: 4))
                }
            }.withRenderingMode(.alwaysTemplate)
        }
        return UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: pointSize, weight: weight))
    }

    /// SF Symbol 的圖片框含有文字基線的留白（分享、垃圾桶這類圖示放進按鈕會看起來偏上／偏下）。
    /// 照圖形本身的範圍（alignment rect）重新畫成一張置中的圖，放進按鈕就是視覺上的正中間。
    static func opticallyCentered(_ img: UIImage) -> UIImage {
        let ins = img.alignmentRectInsets
        let w = img.size.width - ins.left - ins.right, h = img.size.height - ins.top - ins.bottom
        guard w > 0, h > 0, ins != .zero else { return img }
        let r = UIGraphicsImageRenderer(size: CGSize(width: w, height: h))
        return r.image { _ in img.draw(at: CGPoint(x: -ins.left, y: -ins.top)) }.withRenderingMode(.alwaysTemplate)
    }
}

/// 只有點在按鈕（子視圖）上才接，其他地方的點擊照樣交給底下的網頁
final class ABAIPassthroughView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let v = super.hitTest(point, with: event)
        return v === self ? nil : v
    }
}

@objc(NativeGlassPlugin)
public class NativeGlassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeGlassPlugin"
    public let jsName = "NativeGlass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "menu", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeMenu", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dialog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeDialog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "offset", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sheet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeSheet", returnType: CAPPluginReturnPromise),
    ]

    private var groups: [String: ABAIPassthroughView] = [:]
    private var buttons: [String: [String: UIButton]] = [:]
    private let tapFeedback = UIImpactFeedbackGenerator(style: .light)

    @objc func available(_ call: CAPPluginCall) { call.resolve(["available": true, "liquid": ABAIGlass.isLiquid]) }

    @objc func show(_ call: CAPPluginCall) {
        let group = call.getString("group") ?? "default"
        let items = (call.getArray("items") ?? []).compactMap { $0 as? [String: Any] }
        let animate = call.getBool("animate") ?? true
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有畫面"); return }
            let old = self.groups[group]
            let box = ABAIPassthroughView(frame: web.frame)
            box.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            parent.insertSubview(box, aboveSubview: web)
            var map: [String: UIButton] = [:]
            for item in items {
                let v = (item["kind"] as? String) == "tile" ? self.makeTile(item, group: group, into: &map) : self.makeItem(item, group: group, into: &map)
                box.addSubview(v)
            }
            self.groups[group] = box
            self.buttons[group] = map
            if let o = old { o.removeFromSuperview() }
            if animate && old == nil {
                box.alpha = 0
                box.transform = CGAffineTransform(translationX: 0, y: 10)
                UIView.animate(withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
                    box.alpha = 1; box.transform = .identity
                }
            }
            call.resolve()
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        let group = call.getString("group") ?? "default", id = call.getString("id") ?? ""
        let symbol = call.getString("symbol"), tint = call.getString("tint"), enabled = call.getBool("enabled"), title = call.getString("title")
        DispatchQueue.main.async {
            if let b = self.buttons[group]?[id] {
                /* 只換字（例如「儲存中…」→「已存到相簿」）：原地換，不重建整組（重建時玻璃會重新長出來、閃一下） */
                if let t = title { UIView.performWithoutAnimation { b.setTitle(t, for: .normal); b.layoutIfNeeded() } }
                if let s = symbol { b.setImage(ABAIGlass.image(s), for: .normal) }
                if let t = tint { b.tintColor = Self.color(t) }
                if let e = enabled { b.isEnabled = e; b.alpha = e ? 1 : 0.35 }
            }
            call.resolve()
        }
    }

    /// menu({ anchor, items, width? })：各工具「儲存」旁邊 ⋯ 的選項面板（黑色液態玻璃，跟相機設定面板同一套）。
    /// items 跟相機設定面板一樣（choice：分段按鈕，options 可帶 enabled:false）。事件 menu { id, value }、menuClosed。
    /// 面板開著時再呼叫一次＝收起來
    private var menuPanel: ABAISettingsPanel?
    @objc func menu(_ call: CAPPluginCall) {
        let items = (call.getArray("items") ?? []).compactMap { $0 as? [String: Any] }
        let o = call.getObject("anchor")
        let anchor = CGRect(x: (o?["x"] as? NSNumber)?.doubleValue ?? 0, y: (o?["y"] as? NSNumber)?.doubleValue ?? 0,
                            width: (o?["w"] as? NSNumber)?.doubleValue ?? 1, height: (o?["h"] as? NSNumber)?.doubleValue ?? 1)
        let width = CGFloat(call.getDouble("width") ?? 264)
        let pl = call.getObject("place")
        let place: CGRect? = pl.map { CGRect(x: ($0["x"] as? NSNumber)?.doubleValue ?? 0, y: ($0["y"] as? NSNumber)?.doubleValue ?? 0,
                                               width: ($0["w"] as? NSNumber)?.doubleValue ?? 264, height: 1) }
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有畫面"); return }
            if let open = self.menuPanel { open.dismiss(); call.resolve(["opened": false]); return }
            let p = ABAISettingsPanel(frame: web.frame, items: items, anchor: anchor, bounds: web.bounds, dark: true, width: width, place: place)
            p.onChange = { [weak self] id, value in self?.notifyListeners("menu", data: ["id": id, "value": value]) }
            p.onClose = { [weak self, weak p] in
                if self?.menuPanel === p { self?.menuPanel = nil }
                self?.notifyListeners("menuClosed", data: [:])
            }
            parent.addSubview(p)
            self.menuPanel = p
            p.present()
            call.resolve(["opened": true])
        }
    }
    /// dialog({ title, message?, buttons: [{ id, title, role?: 'primary' | 'normal' }], style: 'clear' | 'dark' })
    /// 畫面正中間的詢問框（原生）：每一顆按鈕都是一條玻璃膠囊。按了哪一顆就回傳 { id }（框跟著收起來）。
    /// style：clear＝透明的玻璃面板（不帶黑色）；dark＝跟「儲存」旁 ⋯ 選單同一種深色玻璃
    private var dialogView: ABAIDialog?
    @objc func dialog(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let message = call.getString("message")
        let buttons = (call.getArray("buttons") ?? []).compactMap { $0 as? [String: Any] }
        let dark = call.getString("style") == "dark"
        let bottom = call.getBool("bottom") ?? false
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有畫面"); return }
            self.dialogView?.dismiss(nil)
            let d = ABAIDialog(frame: web.frame, title: title, message: message, buttons: buttons, dark: dark, bottom: bottom, safeBottom: web.safeAreaInsets.bottom)
            d.onPick = { [weak self, weak d] id in
                if self?.dialogView === d { self?.dialogView = nil }
                call.resolve(["id": id ?? ""])
            }
            /* 放在最上層：主頁、成品頁那些原生按鈕也是疊在網頁上的，詢問框一定要蓋過它們 */
            parent.addSubview(d)
            self.dialogView = d
            d.present()
        }
    }
    @objc func closeDialog(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.dialogView?.dismiss(nil); self.dialogView = nil; call.resolve() }
    }
    /// offset({ group, x, y })：整組按鈕跟著網頁捲動位移（不重建按鈕）
    @objc func offset(_ call: CAPPluginCall) {
        let group = call.getString("group") ?? "default"
        let x = CGFloat(call.getDouble("x") ?? 0), y = CGFloat(call.getDouble("y") ?? 0)
        DispatchQueue.main.async {
            self.groups[group]?.transform = CGAffineTransform(translationX: x, y: y)
            call.resolve()
        }
    }

    /// sheet({ title, back, rows?: [{ id, title, checked? }], sections?: [{ head?, body }], note? })
    /// 畫面正中間的深色玻璃面板（跟 ⋯ 選單同一種材質）：設定、語言、條款這類「一頁一頁」的內容。
    /// 已經開著時再呼叫＝換成新的那一頁（面板原地換內容、調整高度）。事件 sheet { id }：點了哪一列，或 __back（左上返回）、__close（右上關閉、點面板外面）
    private var sheetView: ABAISheet?
    @objc func sheet(_ call: CAPPluginCall) {
        let o = call.options as? [String: Any] ?? [:]
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, let parent = web.superview else { call.reject("沒有畫面"); return }
            if let open = self.sheetView, open.superview != nil { open.update(o); call.resolve(); return }
            let v = ABAISheet(frame: web.frame, content: o)
            v.onEvent = { [weak self] id in self?.notifyListeners("sheet", data: ["id": id]) }
            v.onGone = { [weak self, weak v] in if self?.sheetView === v { self?.sheetView = nil } }
            parent.addSubview(v)
            self.sheetView = v
            v.present()
            call.resolve()
        }
    }
    @objc func closeSheet(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.sheetView?.dismiss(); self.sheetView = nil; call.resolve() }
    }

    @objc func closeMenu(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.menuPanel?.dismiss(); call.resolve() }
    }

    @objc func hide(_ call: CAPPluginCall) {
        let group = call.getString("group") ?? "default"
        let animate = call.getBool("animate") ?? true
        DispatchQueue.main.async {
            if let box = self.groups.removeValue(forKey: group) {
                self.buttons.removeValue(forKey: group)
                if animate {
                    UIView.animate(withDuration: 0.18, animations: { box.alpha = 0 }, completion: { _ in box.removeFromSuperview() })
                } else { box.removeFromSuperview() }
            }
            call.resolve()
        }
    }

    private static func color(_ name: String) -> UIColor {
        switch name {
        case "red": return .systemRed
        case "pink": return .systemPink
        case "yellow": return .systemYellow
        default: return .white
        }
    }

    private func makeButton(_ spec: [String: Any], group: String, into map: inout [String: UIButton]) -> UIButton {
        let id = spec["id"] as? String ?? ""
        let b = UIButton(type: .system)
        b.tintColor = Self.color(spec["tint"] as? String ?? "white")
        /* pointSize：這顆圖示多大（不給＝19）。有指定的就照圖形本身置中（見 opticallyCentered） */
        let ps = (spec["pointSize"] as? NSNumber).map { CGFloat($0.doubleValue) }
        if let s = spec["symbol"] as? String, let img = ABAIGlass.image(s, pointSize: ps ?? 19) {
            b.setImage(ps != nil ? ABAIGlass.opticallyCentered(img) : img, for: .normal)
        }
        b.imageView?.contentMode = .center
        if let t = spec["title"] as? String {
            b.setTitle(t, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
            /* titleColor: "black"＝白底按鈕上的黑字（見 makeItem 的 fill） */
            b.setTitleColor((spec["titleColor"] as? String) == "black" ? .black : .white, for: .normal)
            if (spec["titleColor"] as? String) == "black" { b.tintColor = .black; b.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold) }
        }
        if let e = spec["enabled"] as? Bool, !e { b.isEnabled = false; b.alpha = 0.35 }
        b.addAction(UIAction { [weak self] _ in
            self?.tapFeedback.impactOccurred(intensity: 0.6)
            self?.notifyListeners("tap", data: ["group": group, "id": id])
        }, for: .touchUpInside)
        map[id] = b
        return b
    }

    /// tile：主頁那種「一整塊」的按鈕（編輯、相機、四個工具、藝術效果卡）。玻璃底（dark／fill white）、圓角 radius，
    /// 裡面的圖示、文字、白色小膠囊照網頁量好的位置畫（parts：相對這一塊的 x、y、w、h）。
    /// enterDelay（ms）：有給就播進場 —— 玻璃從無長出來（材質本身的動畫，不是透明度）＋從下方浮上來、微微放大到原尺寸，內容跟著淡入
    private func makeTile(_ item: [String: Any], group: String, into map: inout [String: UIButton]) -> UIView {
        func n(_ d: [String: Any], _ k: String) -> CGFloat { CGFloat((d[k] as? NSNumber)?.doubleValue ?? 0) }
        let id = item["id"] as? String ?? ""
        let frame = CGRect(x: n(item, "x"), y: n(item, "y"), width: max(1, n(item, "w")), height: max(1, n(item, "h")))
        let white = (item["fill"] as? String) == "white"
        let glass = ABAIGlass.view(radius: n(item, "radius"), interactive: true, dark: (item["dark"] as? Bool) ?? false,
                                   darkAlpha: CGFloat((item["darkAlpha"] as? NSNumber)?.doubleValue ?? 0.3))
        glass.frame = frame
        if white { glass.contentView.backgroundColor = .white; glass.layer.borderWidth = 0 }
        let b = UIButton(type: .custom)
        b.frame = glass.bounds
        b.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        glass.contentView.addSubview(b)
        let content = UIView(frame: glass.bounds)
        content.isUserInteractionEnabled = false
        glass.contentView.addSubview(content)
        func color(_ d: [String: Any]) -> UIColor {
            let c = d["color"] as? [Any] ?? [255, 255, 255, 1]
            func f(_ i: Int) -> CGFloat { CGFloat((c.count > i ? c[i] as? NSNumber : nil)?.doubleValue ?? 1) }
            return UIColor(red: f(0) / 255, green: f(1) / 255, blue: f(2) / 255, alpha: f(3))
        }
        for case let p as [String: Any] in item["parts"] as? [Any] ?? [] {
            let r = CGRect(x: n(p, "x"), y: n(p, "y"), width: n(p, "w"), height: n(p, "h"))
            switch p["type"] as? String {
            case "symbol":
                let iv = UIImageView(image: ABAIGlass.uniform(ABAIGlass.image(p["symbol"] as? String ?? "", pointSize: n(p, "size"), weight: .regular), box: n(p, "size")))
                iv.tintColor = color(p)
                iv.contentMode = .center
                iv.frame = r
                content.addSubview(iv)
            case "pill":
                /* 白色小膠囊（立即使用 ›） */
                let pill = UIView(frame: r)
                pill.backgroundColor = .white
                pill.layer.cornerRadius = r.height / 2
                pill.layer.cornerCurve = .continuous
                let l = UILabel()
                l.attributedText = NSAttributedString(string: p["text"] as? String ?? "", attributes: [
                    .font: UIFont.systemFont(ofSize: n(p, "size"), weight: .black), .foregroundColor: UIColor.black, .kern: n(p, "kern")])
                let ch = UIImageView(image: UIImage(systemName: "chevron.right", withConfiguration: UIImage.SymbolConfiguration(pointSize: n(p, "size") - 1, weight: .bold)))
                ch.tintColor = .black
                let row = UIStackView(arrangedSubviews: [l, ch])
                row.spacing = 3
                row.alignment = .center
                row.frame = CGRect(x: n(p, "padL"), y: 0, width: r.width - n(p, "padL") - n(p, "padR"), height: r.height)
                pill.addSubview(row)
                content.addSubview(pill)
            default:
                let l = UILabel(frame: r)
                let w = n(p, "weight")
                let weight: UIFont.Weight = w >= 850 ? .black : w >= 750 ? .heavy : w >= 650 ? .bold : w >= 550 ? .semibold : .regular
                l.attributedText = NSAttributedString(string: p["text"] as? String ?? "", attributes: [
                    .font: UIFont.systemFont(ofSize: n(p, "size"), weight: weight), .foregroundColor: color(p), .kern: n(p, "kern")])
                l.textAlignment = (p["align"] as? String) == "center" ? .center : .left
                l.lineBreakMode = .byTruncatingTail
                content.addSubview(l)
            }
        }
        /* 按下去：整塊輕輕縮一點（跟網頁原本的 active:scale 一樣） */
        b.addAction(UIAction { [weak glass] _ in UIView.animate(withDuration: 0.12) { glass?.transform = CGAffineTransform(scaleX: 0.98, y: 0.98) } }, for: .touchDown)
        for ev: UIControl.Event in [.touchUpInside, .touchUpOutside, .touchCancel] {
            b.addAction(UIAction { [weak glass] _ in UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.7, initialSpringVelocity: 0) { glass?.transform = .identity } }, for: ev)
        }
        b.addAction(UIAction { [weak self] _ in
            self?.tapFeedback.impactOccurred(intensity: 0.6)
            self?.notifyListeners("tap", data: ["group": group, "id": id])
        }, for: .touchUpInside)
        map[id] = b
        if let d = item["enterDelay"] as? NSNumber {
            let effect = glass.effect
            let bg = glass.contentView.backgroundColor
            glass.effect = nil
            glass.contentView.backgroundColor = bg?.withAlphaComponent(0)
            content.alpha = 0
            glass.transform = CGAffineTransform(translationX: 0, y: 22).scaledBy(x: 0.94, y: 0.94)
            UIView.animate(withDuration: 0.7, delay: d.doubleValue / 1000, usingSpringWithDamping: 0.82, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
                glass.effect = effect
                glass.contentView.backgroundColor = bg
                glass.transform = .identity
            }
            UIView.animate(withDuration: 0.45, delay: d.doubleValue / 1000 + 0.12, options: [.curveEaseOut, .allowUserInteraction]) { content.alpha = 1 }
        }
        return glass
    }

    private func makeItem(_ item: [String: Any], group: String, into map: inout [String: UIButton]) -> UIView {
        func n(_ k: String) -> CGFloat { CGFloat((item[k] as? NSNumber)?.doubleValue ?? 0) }
        let frame = CGRect(x: n("x"), y: n("y"), width: max(1, n("w")), height: max(1, n("h")))
        /* dark：深色玻璃（跟 ⋯ 選單同一種）；fill "white"：白底（成品頁的主要按鈕，例如「儲存圖片」） */
        let glass = ABAIGlass.view(radius: (item["shape"] as? String) == "roundedSquare" ? 11 : frame.height / 2,
                                   interactive: group != "camera-viewer", dark: (item["dark"] as? Bool) ?? false,
                                   darkAlpha: CGFloat((item["darkAlpha"] as? NSNumber)?.doubleValue ?? 0.3))
        glass.frame = frame
        if (item["fill"] as? String) == "white" {
            /* fillAlpha：白底的濃度（不給＝1，完全不透明）。成品頁的儲存給 0.85：白色、但透一點點後面的玻璃 */
            glass.contentView.backgroundColor = UIColor(white: 1, alpha: CGFloat((item["fillAlpha"] as? NSNumber)?.doubleValue ?? 1))
            glass.layer.borderWidth = 0
        }
        let specs: [[String: Any]] = (item["kind"] as? String) == "capsule"
            ? (item["buttons"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
            : [item]
        let content = glass.contentView
        let count = max(1, specs.count)
        /* 膠囊左右內距：不給＝8（給 pad 的話照給的，例如相簿大圖把三顆平均分滿整條膠囊） */
        let pad: CGFloat = specs.count > 1 ? ((item["pad"] as? NSNumber).map { CGFloat($0.doubleValue) } ?? 8) : 0
        let w = (frame.width - pad * 2) / CGFloat(count)
        for (i, s) in specs.enumerated() {
            let b = makeButton(s, group: group, into: &map)
            b.frame = CGRect(x: pad + CGFloat(i) * w, y: 0, width: w, height: frame.height)
            b.autoresizingMask = [.flexibleHeight]
            content.addSubview(b)
        }
        return glass
    }
}

// MARK: - 相機設定面板

/// 相機右上「⋯」的設定面板：玻璃面板（液態玻璃）、原生開關與分段按鈕。
/// 貼在觀景窗右上角裡面（不超出相機畫面）、沒有箭頭；點面板外面就收起來。
final class ABAISettingsPanel: UIView {
    var onChange: ((String, Any) -> Void)?
    var onClose: (() -> Void)?
    private let panel: UIVisualEffectView
    private let menuAnchorPoint: CGPoint

    /// items 跟 NativeCameraPlugin.showMenu 一樣；anchor＝那顆按鈕、bounds＝觀景窗（面板不會超出它）
    /// place：給了就照它擺（x、y、寬，CSS px）—— 儲存旁的選單照原本網頁選單的位置與寬度
    init(frame: CGRect, items: [[String: Any]], anchor: CGRect, bounds: CGRect, dark: Bool = false, width: CGFloat = 248, place: CGRect? = nil) {
        let width: CGFloat = place?.width ?? width
        let rowsH = items.reduce(CGFloat(0)) { $0 + (($1["type"] as? String) == "choice" ? 76 : 46) }
        let height = rowsH + 16
        let right = min(bounds.maxX, frame.width) - 8
        let x = place?.minX ?? max(bounds.minX + 8, right - width)
        let y = place.map { min($0.minY, frame.height - height - 8) } ?? min(anchor.maxY + 6, max(bounds.minY + 8, frame.height - height - 8))
        panel = ABAIGlass.view(radius: 24, interactive: false, dark: dark)
        panel.frame = CGRect(x: x, y: y, width: width, height: height)
        menuAnchorPoint = CGPoint(x: anchor.midX, y: anchor.midY)
        super.init(frame: frame)
        backgroundColor = .clear
        autoresizingMask = [.flexibleWidth, .flexibleHeight]

        let stack = UIStackView()
        stack.axis = .vertical
        stack.frame = panel.bounds.insetBy(dx: 16, dy: 8)
        stack.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        panel.contentView.addSubview(stack)
        for item in items { stack.addArrangedSubview(row(item)) }
        addSubview(panel)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /* 點面板外面：收起來（這一下不會傳到底下的相機，跟系統選單一樣） */
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first, !panel.frame.contains(t.location(in: self)) { dismiss() }
    }

    func present() {
        /* 從那顆按鈕的位置長出來 */
        let p = panel.frame
        panel.layer.anchorPoint = CGPoint(x: min(1, max(0, (menuAnchorPoint.x - p.minX) / p.width)), y: min(1, max(0, (menuAnchorPoint.y - p.minY) / p.height)))
        panel.frame = p
        panel.alpha = 0
        panel.transform = CGAffineTransform(scaleX: 0.6, y: 0.6)
        UIView.animate(withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.2, options: [.allowUserInteraction]) {
            self.panel.alpha = 1
            self.panel.transform = .identity
        }
    }

    func dismiss() {
        UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseIn], animations: {
            self.panel.alpha = 0
            self.panel.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)
        }, completion: { _ in
            self.removeFromSuperview()
            self.onClose?()
        })
    }

    private func row(_ item: [String: Any]) -> UIView {
        let id = item["id"] as? String ?? ""
        /* 圖示一律放進同一個 18×18 的方框、照圖形本身的範圍等比縮到剛好（SF Symbol 每個圖形本身大小不一：
           細長的定位箭頭看起來小、方方的格線看起來大），視覺上每一顆一樣大 */
        let sym = item["symbol"] as? String
        let icon = UIImageView(image: sym.flatMap { ABAIGlass.uniform(ABAIGlass.image($0, pointSize: 17, weight: .medium), box: 18) })
        icon.tintColor = .white
        icon.contentMode = .center
        icon.widthAnchor.constraint(equalToConstant: sym == nil ? 0 : 22).isActive = true
        icon.isHidden = sym == nil
        let label = UILabel()
        label.text = item["title"] as? String
        label.font = .systemFont(ofSize: 15, weight: .regular)
        label.textColor = .white
        label.setContentHuggingPriority(.defaultLow, for: .horizontal)
        /* action：點一下就做事、面板收起來（例如拼圖 ⋯ 裡的「預覽」） */
        if (item["type"] as? String) == "action" {
            let b = UIButton(type: .system)
            b.contentHorizontalAlignment = .leading
            b.addAction(UIAction { [weak self] _ in
                UISelectionFeedbackGenerator().selectionChanged()
                self?.onChange?(id, "tap")
                self?.dismiss()
            }, for: .touchUpInside)
            let r = UIStackView(arrangedSubviews: [icon, label])
            r.spacing = 10
            r.alignment = .center
            r.isUserInteractionEnabled = false
            let wrap = UIView()
            wrap.heightAnchor.constraint(equalToConstant: 46).isActive = true
            r.translatesAutoresizingMaskIntoConstraints = false
            b.translatesAutoresizingMaskIntoConstraints = false
            wrap.addSubview(r); wrap.addSubview(b)
            NSLayoutConstraint.activate([
                r.leadingAnchor.constraint(equalTo: wrap.leadingAnchor), r.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
                r.topAnchor.constraint(equalTo: wrap.topAnchor), r.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
                b.leadingAnchor.constraint(equalTo: wrap.leadingAnchor), b.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
                b.topAnchor.constraint(equalTo: wrap.topAnchor), b.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
            ])
            return wrap
        }
        if (item["type"] as? String) == "choice" {
            let options = (item["options"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
            let seg = UISegmentedControl(items: options.map { $0["label"] as? String ?? "" })
            let current = item["value"] as? String
            seg.selectedSegmentIndex = options.firstIndex { ($0["value"] as? String) == current } ?? 0
            for (i, o) in options.enumerated() where (o["enabled"] as? Bool) == false { seg.setEnabled(false, forSegmentAt: i) }
            /* 選中的不要系統藍／白底黑字：淡淡的白，跟面板同一個調性 */
            seg.selectedSegmentTintColor = UIColor(white: 1, alpha: 0.24)
            seg.backgroundColor = UIColor(white: 1, alpha: 0.06)
            seg.setTitleTextAttributes([.foregroundColor: UIColor(white: 1, alpha: 0.7), .font: UIFont.systemFont(ofSize: 13, weight: .medium)], for: .normal)
            seg.setTitleTextAttributes([.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 13, weight: .semibold)], for: .selected)
            seg.addAction(UIAction { [weak self, weak seg] _ in
                guard let s = seg, s.selectedSegmentIndex >= 0, s.selectedSegmentIndex < options.count else { return }
                UISelectionFeedbackGenerator().selectionChanged()
                self?.onChange?(id, options[s.selectedSegmentIndex]["value"] as? String ?? "")
            }, for: .valueChanged)
            let head = UIStackView(arrangedSubviews: [icon, label])
            head.spacing = 10
            head.alignment = .center
            head.heightAnchor.constraint(equalToConstant: 30).isActive = true
            seg.heightAnchor.constraint(equalToConstant: 32).isActive = true
            let col = UIStackView(arrangedSubviews: [head, seg])
            col.axis = .vertical
            col.spacing = 6
            col.heightAnchor.constraint(equalToConstant: 76).isActive = true
            col.layoutMargins = UIEdgeInsets(top: 2, left: 0, bottom: 6, right: 0)
            col.isLayoutMarginsRelativeArrangement = true
            return col
        }
        let sw = UISwitch()
        sw.isOn = item["value"] as? Bool ?? false
        /* 開著的顏色不要系統綠：半透明的白（跟相機其他地方的開關一樣） */
        sw.onTintColor = UIColor(white: 1, alpha: 0.42)
        sw.transform = CGAffineTransform(scaleX: 0.86, y: 0.86)
        sw.addAction(UIAction { [weak self, weak sw] _ in self?.onChange?(id, sw?.isOn ?? false) }, for: .valueChanged)
        let r = UIStackView(arrangedSubviews: [icon, label, sw])
        r.spacing = 10
        r.alignment = .center
        r.heightAnchor.constraint(equalToConstant: 46).isActive = true
        return r
    }
}

/// 畫面正中間的詢問框：標題、說明、直排的玻璃膠囊按鈕（主要的那顆白底黑字）。點框外面不會關（一定要選一個）
final class ABAIDialog: UIView {
    var onPick: ((String?) -> Void)?
    private let panel: UIVisualEffectView
    private let dim = UIView()
    private var picked = false
    private let bottom: Bool

    /// bottom：從畫面下方升上來的面板（登入），點面板外面＝關掉（回傳空字串）；不是 bottom 的一定要選一個
    init(frame: CGRect, title: String, message: String?, buttons: [[String: Any]], dark: Bool, bottom: Bool = false, safeBottom: CGFloat = 0) {
        self.bottom = bottom
        let width = bottom ? min(430, frame.width) : min(320, frame.width - 64)
        let btnH: CGFloat = bottom ? 50 : 48, gap: CGFloat = bottom ? 10 : 8, pad: CGFloat = 24
        let btnR: CGFloat = bottom ? 14 : btnH / 2
        let titleL = UILabel()
        titleL.text = title
        titleL.font = .systemFont(ofSize: bottom ? 22 : 17, weight: bottom ? .heavy : .bold)
        titleL.textColor = .white
        titleL.textAlignment = bottom ? .left : .center
        titleL.numberOfLines = 0
        let msgL = UILabel()
        msgL.text = message
        msgL.font = .systemFont(ofSize: 13, weight: .regular)
        msgL.textColor = UIColor(white: 1, alpha: 0.55)
        msgL.textAlignment = bottom ? .left : .center
        /* 置中的詢問框：說明一行放完（字太長就自動縮小，不換行，跟原本網頁版一樣）；登入面板的錯誤訊息可以換行 */
        msgL.numberOfLines = bottom ? 0 : 1
        if !bottom { msgL.adjustsFontSizeToFitWidth = true; msgL.minimumScaleFactor = 0.6; msgL.font = .systemFont(ofSize: 12, weight: .regular) }
        let inner = width - pad * 2
        let tH = ceil(titleL.sizeThatFits(CGSize(width: inner, height: .greatestFiniteMagnitude)).height)
        let mH = message == nil ? 0 : ceil(msgL.sizeThatFits(CGSize(width: inner, height: .greatestFiniteMagnitude)).height)
        let head = tH + (message == nil ? 0 : 8 + mH)
        let height = pad + head + 24 + CGFloat(buttons.count) * btnH + CGFloat(max(0, buttons.count - 1)) * gap + pad + (bottom ? safeBottom + 20 : 0)
        panel = ABAIGlass.view(radius: bottom ? 24 : 28, interactive: false, dark: dark)
        panel.frame = bottom
            ? CGRect(x: (frame.width - width) / 2, y: frame.height - height, width: width, height: height + 40)
            : CGRect(x: (frame.width - width) / 2, y: (frame.height - height) / 2, width: width, height: height)
        super.init(frame: frame)
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        dim.frame = bounds
        dim.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        dim.backgroundColor = UIColor(white: 0, alpha: dark ? 0.45 : 0.3)
        addSubview(dim)
        titleL.frame = CGRect(x: pad, y: pad, width: inner, height: tH)
        panel.contentView.addSubview(titleL)
        if message != nil { msgL.frame = CGRect(x: pad, y: pad + tH + 8, width: inner, height: mH); panel.contentView.addSubview(msgL) }
        if bottom {
            /* 右上角關閉 */
            let x = UIButton(type: .system)
            x.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .regular)), for: .normal)
            x.tintColor = UIColor(white: 1, alpha: 0.4)
            x.frame = CGRect(x: width - pad - 30, y: pad - 6, width: 36, height: 36)
            x.addAction(UIAction { [weak self] _ in self?.dismiss("") }, for: .touchUpInside)
            panel.contentView.addSubview(x)
            titleL.frame.size.width = inner - 40
        }
        var y = pad + head + 24
        for spec in buttons {
            let id = spec["id"] as? String ?? ""
            let primary = (spec["role"] as? String) == "primary"
            let b = UIButton(type: .system)
            b.frame = CGRect(x: pad, y: y, width: inner, height: btnH)
            b.setTitle(spec["title"] as? String, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 15, weight: primary ? .bold : .semibold)
            /* 按鈕前面的圖示：SF Symbol，或網頁畫好的圖（data URL，例如 Google 的四色標誌，照原色畫） */
            var icon: UIImage?
            /* iconSize：圖示的視覺大小（pt）。每個圖形本身的比例不同（蘋果標誌細長、信封扁），各自給一個值，看起來才一樣大 */
            let isz = CGFloat((spec["iconSize"] as? NSNumber)?.doubleValue ?? 18)
            if let sym = spec["symbol"] as? String { icon = ABAIGlass.uniform(ABAIGlass.image(sym, pointSize: 17, weight: .medium), box: isz) }
            if let du = spec["image"] as? String, let comma = du.firstIndex(of: ","), let data = Data(base64Encoded: String(du[du.index(after: comma)...])),
               let img = UIImage(data: data) {
                icon = UIGraphicsImageRenderer(size: CGSize(width: isz, height: isz)).image { _ in img.draw(in: CGRect(x: 0, y: 0, width: isz, height: isz)) }.withRenderingMode(.alwaysOriginal)
            }
            if let ic = icon {
                b.setImage(ic, for: .normal)
                b.tintColor = primary ? .black : .white
                b.imageEdgeInsets = UIEdgeInsets(top: 0, left: -5, bottom: 0, right: 5)
                b.titleEdgeInsets = UIEdgeInsets(top: 0, left: 5, bottom: 0, right: -5)
            }
            if primary {
                b.backgroundColor = .white
                b.setTitleColor(.black, for: .normal)
                b.layer.cornerRadius = btnR
                b.layer.cornerCurve = .continuous
                panel.contentView.addSubview(b)
            } else {
                /* 其他按鈕：一條玻璃膠囊（跟 App 裡其他原生按鈕同一種材質） */
                let g = ABAIGlass.view(radius: btnR, interactive: true, dark: false)
                g.frame = b.frame
                b.frame = g.bounds
                b.setTitleColor(UIColor(white: 1, alpha: 0.85), for: .normal)
                g.contentView.addSubview(b)
                panel.contentView.addSubview(g)
            }
            b.addAction(UIAction { [weak self] _ in
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self?.dismiss(id)
            }, for: .touchUpInside)
            y += btnH + gap
        }
        addSubview(panel)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        if bottom, let t = touches.first, !panel.frame.contains(t.location(in: self)) { dismiss("") }
    }

    func present() {
        dim.alpha = 0
        if bottom {
            panel.transform = CGAffineTransform(translationX: 0, y: panel.frame.height)
            UIView.animate(withDuration: 0.45, delay: 0, usingSpringWithDamping: 0.9, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
                self.dim.alpha = 1
                self.panel.transform = .identity
            }
            return
        }
        panel.alpha = 0
        panel.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
        UIView.animate(withDuration: 0.38, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
            self.dim.alpha = 1
            self.panel.alpha = 1
            self.panel.transform = .identity
        }
    }

    /// id：按了哪一顆（nil＝被網頁那邊收掉）
    func dismiss(_ id: String?) {
        if picked { return }
        picked = true
        isUserInteractionEnabled = false
        onPick?(id)
        UIView.animate(withDuration: bottom ? 0.26 : 0.18, delay: 0, options: [.curveEaseIn], animations: {
            self.dim.alpha = 0
            if self.bottom { self.panel.transform = CGAffineTransform(translationX: 0, y: self.panel.frame.height) }
            else { self.panel.alpha = 0; self.panel.transform = CGAffineTransform(scaleX: 0.95, y: 0.95) }
        }, completion: { _ in self.removeFromSuperview() })
    }
}

/// 設定這類的面板：深色玻璃、標題列（返回／關閉）、下面是一列一列的選項或一段可以捲動的文字
final class ABAISheet: UIView {
    var onEvent: ((String) -> Void)?
    var onGone: (() -> Void)?
    private let panel: UIVisualEffectView
    private var body = UIView()
    private let width: CGFloat
    private var closing = false

    init(frame: CGRect, content: [String: Any]) {
        width = min(384, frame.width - 48)
        panel = ABAIGlass.view(radius: 24, interactive: false, dark: true)
        super.init(frame: frame)
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        backgroundColor = UIColor(white: 0, alpha: 0.35)
        addSubview(panel)
        build(content)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first, !panel.frame.contains(t.location(in: self)) { onEvent?("__close") }
    }

    private func iconButton(_ symbol: String, _ id: String) -> UIButton {
        let b = UIButton(type: .system)
        b.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .regular)), for: .normal)
        b.tintColor = UIColor(white: 1, alpha: 0.7)
        b.addAction(UIAction { [weak self] _ in self?.onEvent?(id) }, for: .touchUpInside)
        return b
    }

    /// 依內容排好面板（第一次、或換頁）
    private func build(_ c: [String: Any]) {
        let pad: CGFloat = 20, inner = width - pad * 2
        let v = UIView()
        var y: CGFloat = pad
        /* 標題列 */
        let back = (c["back"] as? Bool) ?? false
        let title = UILabel()
        title.text = c["title"] as? String
        title.font = .systemFont(ofSize: 14, weight: .medium)
        title.textColor = UIColor(white: 1, alpha: 0.9)
        let tx: CGFloat = back ? pad + 26 : pad + 8
        title.frame = CGRect(x: tx, y: y, width: inner - 60, height: 36)
        v.addSubview(title)
        if back { let b = iconButton("chevron.left", "__back"); b.frame = CGRect(x: pad - 6, y: y, width: 32, height: 36); v.addSubview(b) }
        let x = iconButton("xmark", "__close"); x.frame = CGRect(x: width - pad - 36, y: y, width: 36, height: 36); v.addSubview(x)
        y += 36 + 16
        let maxH = bounds.height * 0.72
        if let rows = c["rows"] as? [Any] {
            for case let r as [String: Any] in rows {
                let id = r["id"] as? String ?? ""
                let checked = (r["checked"] as? Bool) ?? false
                let b = UIButton(type: .custom)
                b.frame = CGRect(x: pad, y: y, width: inner, height: 48)
                b.backgroundColor = UIColor(white: 1, alpha: 0.06)
                b.layer.cornerRadius = 12
                b.layer.cornerCurve = .continuous
                b.layer.borderWidth = 0.5
                b.layer.borderColor = UIColor(white: 1, alpha: checked ? 0.9 : 0.1).cgColor
                /* 有圖示的列（問題反饋的信箱、IG）：左邊一顆小圓底圖示 */
                var lx: CGFloat = 16
                if let sym = r["symbol"] as? String {
                    let dot = UIView(frame: CGRect(x: 10, y: 8, width: 32, height: 32))
                    dot.backgroundColor = UIColor(white: 1, alpha: 0.08)
                    dot.layer.cornerRadius = 16
                    dot.isUserInteractionEnabled = false
                    let ic = UIImageView(image: ABAIGlass.uniform(ABAIGlass.image(sym, pointSize: 15, weight: .regular), box: 16))
                    ic.tintColor = .white
                    ic.contentMode = .center
                    ic.frame = dot.bounds
                    dot.addSubview(ic)
                    b.addSubview(dot)
                    lx = 52
                }
                let l = UILabel(frame: CGRect(x: lx, y: 0, width: inner - lx - 36, height: 48))
                l.text = r["title"] as? String
                l.adjustsFontSizeToFitWidth = true
                l.minimumScaleFactor = 0.75
                l.font = .systemFont(ofSize: 13, weight: .regular)
                l.textColor = .white
                b.addSubview(l)
                if checked {
                    let ck = UIImageView(image: UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 14, weight: .medium)))
                    ck.tintColor = .white
                    ck.frame = CGRect(x: inner - 34, y: 14, width: 20, height: 20)
                    ck.contentMode = .center
                    b.addSubview(ck)
                }
                b.addAction(UIAction { [weak b] _ in
                    UIView.animate(withDuration: 0.08, animations: { b?.alpha = 0.6 }) { _ in UIView.animate(withDuration: 0.15) { b?.alpha = 1 } }
                }, for: .touchDown)
                b.addAction(UIAction { [weak self] _ in self?.onEvent?(id) }, for: .touchUpInside)
                v.addSubview(b)
                y += 48 + 8
            }
            /* 列表下面的一行小字（例如「已複製」） */
            if let foot = c["foot"] as? String, !foot.isEmpty {
                let f = UILabel(frame: CGRect(x: pad, y: y, width: inner, height: 18))
                f.text = foot
                f.font = .systemFont(ofSize: 11, weight: .regular)
                f.textColor = UIColor(white: 1, alpha: 0.45)
                f.textAlignment = .center
                v.addSubview(f)
                y += 18 + 8
            }
            y += pad - 8
        } else if let secs = c["sections"] as? [Any] {
            /* 一段長文字（條款、隱私權）：放在可以捲動的區塊裡 */
            let text = NSMutableAttributedString()
            let para = NSMutableParagraphStyle(); para.lineSpacing = 5; para.paragraphSpacing = 10
            let headStyle = NSMutableParagraphStyle(); headStyle.paragraphSpacing = 4
            if let intro = c["intro"] as? String, !intro.isEmpty {
                text.append(NSAttributedString(string: intro + "\n", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: UIColor(white: 1, alpha: 0.75), .paragraphStyle: para]))
            }
            if let note = c["note"] as? String, !note.isEmpty {
                text.append(NSAttributedString(string: note + "\n", attributes: [.font: UIFont.systemFont(ofSize: 10), .foregroundColor: UIColor(white: 1, alpha: 0.35), .paragraphStyle: para]))
            }
            for case let sec as [String: Any] in secs {
                if let h = sec["head"] as? String { text.append(NSAttributedString(string: h + "\n", attributes: [.font: UIFont.systemFont(ofSize: 12, weight: .bold), .foregroundColor: UIColor(white: 1, alpha: 0.85), .paragraphStyle: headStyle])) }
                text.append(NSAttributedString(string: (sec["body"] as? String ?? "") + "\n", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: UIColor(white: 1, alpha: 0.7), .paragraphStyle: para]))
            }
            let tv = UITextView()
            tv.attributedText = text
            tv.isEditable = false
            tv.backgroundColor = .clear
            tv.textContainerInset = .zero
            tv.textContainer.lineFragmentPadding = 0
            tv.showsVerticalScrollIndicator = false
            let need = ceil(tv.sizeThatFits(CGSize(width: inner - 8, height: .greatestFiniteMagnitude)).height)
            let h = min(need, max(120, maxH - y - pad))
            tv.frame = CGRect(x: pad + 8, y: y, width: inner - 8, height: h)
            v.addSubview(tv)
            y += h + pad
        }
        let height = min(y, maxH)
        body.removeFromSuperview()
        body = v
        v.frame = CGRect(x: 0, y: 0, width: width, height: height)
        panel.contentView.addSubview(v)
        panel.bounds = CGRect(x: 0, y: 0, width: width, height: height)
        panel.center = CGPoint(x: bounds.midX, y: bounds.midY)
    }

    /// 換頁：舊的內容淡出、面板改成新的高度、新的內容淡入
    func update(_ c: [String: Any]) {
        let old = body
        UIView.animate(withDuration: 0.12, animations: { old.alpha = 0 }) { _ in
            self.build(c)
            self.body.alpha = 0
            UIView.animate(withDuration: 0.18) { self.body.alpha = 1 }
        }
    }

    func present() {
        alpha = 0
        panel.transform = CGAffineTransform(scaleX: 0.6, y: 0.6)
        UIView.animate(withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.2, options: [.allowUserInteraction]) {
            self.alpha = 1
            self.panel.transform = .identity
        }
    }

    func dismiss() {
        if closing { return }
        closing = true
        isUserInteractionEnabled = false
        UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseIn], animations: {
            self.alpha = 0
            self.panel.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)
        }, completion: { _ in self.removeFromSuperview(); self.onGone?() })
    }
}
