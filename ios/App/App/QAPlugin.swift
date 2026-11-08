//
//  QAPlugin.swift
//  ABAI — 自動測試用（GitHub 上的 iOS 模擬器測試）
//
//  平常完全不做事：只有用「-abaiQA 情境名稱」這個啟動參數打開 App 時，網頁那邊（utils/nativeQA.ts）
//  才會照情境自己點按鈕、開相簿、輸出影片，每一步寫一行「ABAIQA …」到系統紀錄，給 CI 收集。
//

import Foundation
import Capacitor

@objc(QAPlugin)
public class QAPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QAPlugin"
    public let jsName = "ABAIQA"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scenario", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "log", returnType: CAPPluginReturnPromise),
    ]

    @objc func available(_ call: CAPPluginCall) { call.resolve(["available": true]) }

    @objc func scenario(_ call: CAPPluginCall) {
        call.resolve(["scenario": UserDefaults.standard.string(forKey: "abaiQA") ?? ""])
    }

    @objc func log(_ call: CAPPluginCall) {
        NSLog("ABAIQA %@", call.getString("msg") ?? "")
        call.resolve()
    }
}
