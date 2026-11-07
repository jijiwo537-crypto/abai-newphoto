//
//  HapticsPlugin.swift
//  ABAI — 觸覺回饋
//
//  滑桿經過 0、拉到頭、物件吸附到對齊線時輕輕震一下。
//  產生器先 prepare 好，Taptic Engine 已經醒著，震動才會跟手指同步。
//  網頁那邊的對應：utils/haptics.ts
//

import Foundation
import Capacitor
import UIKit

@objc(HapticsPlugin)
public class HapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HapticsPlugin"
    public let jsName = "ABAIHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "selection", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "impact", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "notify", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnNone),
    ]

    private lazy var selectionGen = UISelectionFeedbackGenerator()
    private lazy var light = UIImpactFeedbackGenerator(style: .light)
    private lazy var medium = UIImpactFeedbackGenerator(style: .medium)
    private lazy var rigid = UIImpactFeedbackGenerator(style: .rigid)
    private lazy var notifier = UINotificationFeedbackGenerator()

    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.selectionGen.prepare(); self.light.prepare(); self.rigid.prepare() }
    }

    /// 刻度感：滑桿經過 0、切換選項
    @objc func selection(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.selectionGen.selectionChanged(); self.selectionGen.prepare() }
    }

    /// style：light（吸附）、medium、rigid（拉到頭）；intensity 0～1
    @objc func impact(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        let intensity = CGFloat(call.getDouble("intensity") ?? 1)
        DispatchQueue.main.async {
            let g: UIImpactFeedbackGenerator = style == "rigid" ? self.rigid : (style == "medium" ? self.medium : self.light)
            g.impactOccurred(intensity: intensity)
            g.prepare()
        }
    }

    /// type：success、warning、error（存檔完成、失敗）
    @objc func notify(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "success"
        DispatchQueue.main.async {
            self.notifier.notificationOccurred(type == "error" ? .error : (type == "warning" ? .warning : .success))
        }
    }
}
