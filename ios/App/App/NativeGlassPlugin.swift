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

    static func view(radius: CGFloat, interactive: Bool = true) -> UIVisualEffectView {
        var effect: UIVisualEffect = UIBlurEffect(style: .systemUltraThinMaterialDark)
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let g = UIGlassEffect()
            g.isInteractive = interactive
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
    static func levelIcon(size: CGFloat = 20) -> UIImage {
        let r = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        return r.image { ctx in
            let c = ctx.cgContext
            c.setStrokeColor(UIColor.white.cgColor)
            c.setFillColor(UIColor.white.cgColor)
            c.setLineWidth(1.5)
            let tube = CGRect(x: 1.5, y: size / 2 - 3.5, width: size - 3, height: 7)
            c.addPath(UIBezierPath(roundedRect: tube, cornerRadius: 3.5).cgPath)
            c.strokePath()
            c.fillEllipse(in: CGRect(x: size / 2 - 2.2, y: size / 2 - 2.2, width: 4.4, height: 4.4))
            c.move(to: CGPoint(x: size / 2 - 4.5, y: tube.minY)); c.addLine(to: CGPoint(x: size / 2 - 4.5, y: tube.maxY))
            c.move(to: CGPoint(x: size / 2 + 4.5, y: tube.minY)); c.addLine(to: CGPoint(x: size / 2 + 4.5, y: tube.maxY))
            c.setLineWidth(1)
            c.strokePath()
        }.withRenderingMode(.alwaysTemplate)
    }

    static func image(_ symbol: String, pointSize: CGFloat = 19, weight: UIImage.SymbolWeight = .regular) -> UIImage? {
        if symbol == "abai.level" { return levelIcon(size: pointSize + 2) }
        return UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: pointSize, weight: weight))
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
            for item in items { box.addSubview(self.makeItem(item, group: group, into: &map)) }
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
        let symbol = call.getString("symbol"), tint = call.getString("tint"), enabled = call.getBool("enabled")
        DispatchQueue.main.async {
            if let b = self.buttons[group]?[id] {
                if let s = symbol { b.setImage(ABAIGlass.image(s), for: .normal) }
                if let t = tint { b.tintColor = Self.color(t) }
                if let e = enabled { b.isEnabled = e; b.alpha = e ? 1 : 0.35 }
            }
            call.resolve()
        }
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
        if let s = spec["symbol"] as? String { b.setImage(ABAIGlass.image(s), for: .normal) }
        if let t = spec["title"] as? String {
            b.setTitle(t, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
            b.setTitleColor(.white, for: .normal)
        }
        if let e = spec["enabled"] as? Bool, !e { b.isEnabled = false; b.alpha = 0.35 }
        b.addAction(UIAction { [weak self] _ in
            self?.tapFeedback.impactOccurred(intensity: 0.6)
            self?.notifyListeners("tap", data: ["group": group, "id": id])
        }, for: .touchUpInside)
        map[id] = b
        return b
    }

    private func makeItem(_ item: [String: Any], group: String, into map: inout [String: UIButton]) -> UIView {
        func n(_ k: String) -> CGFloat { CGFloat((item[k] as? NSNumber)?.doubleValue ?? 0) }
        let frame = CGRect(x: n("x"), y: n("y"), width: max(1, n("w")), height: max(1, n("h")))
        let glass = ABAIGlass.view(radius: frame.height / 2)
        glass.frame = frame
        let specs: [[String: Any]] = (item["kind"] as? String) == "capsule"
            ? (item["buttons"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
            : [item]
        let content = glass.contentView
        let count = max(1, specs.count)
        let pad: CGFloat = specs.count > 1 ? 8 : 0
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
    init(frame: CGRect, items: [[String: Any]], anchor: CGRect, bounds: CGRect) {
        let width: CGFloat = 248
        let rowsH = items.reduce(CGFloat(0)) { $0 + (($1["type"] as? String) == "choice" ? 76 : 46) }
        let height = rowsH + 16
        let right = min(bounds.maxX, frame.width) - 8
        let x = max(bounds.minX + 8, right - width)
        let y = min(anchor.maxY + 6, max(bounds.minY + 8, frame.height - height - 8))
        panel = ABAIGlass.view(radius: 24, interactive: false)
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
        let icon = UIImageView(image: ABAIGlass.image(item["symbol"] as? String ?? "circle", pointSize: 15, weight: .medium))
        icon.tintColor = .white
        icon.contentMode = .center
        icon.widthAnchor.constraint(equalToConstant: 22).isActive = true
        let label = UILabel()
        label.text = item["title"] as? String
        label.font = .systemFont(ofSize: 15, weight: .regular)
        label.textColor = .white
        label.setContentHuggingPriority(.defaultLow, for: .horizontal)
        if (item["type"] as? String) == "choice" {
            let options = (item["options"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
            let seg = UISegmentedControl(items: options.map { $0["label"] as? String ?? "" })
            let current = item["value"] as? String
            seg.selectedSegmentIndex = options.firstIndex { ($0["value"] as? String) == current } ?? 0
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
