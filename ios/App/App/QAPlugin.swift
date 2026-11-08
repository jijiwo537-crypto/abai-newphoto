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

    /// 同一份紀錄也寫進 App 的 Documents/abaiqa.log，CI 從模擬器裡直接拿檔案（不靠系統紀錄）
    private static func write(_ line: String) {
        NSLog("ABAIQA %@", line)
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("abaiqa.log")
        let data = Data("\(Date().timeIntervalSince1970) \(line)\n".utf8)
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(data); try? h.close() }
        else { try? data.write(to: url) }
    }

    private static var scenarioName: String {
        if let v = UserDefaults.standard.string(forKey: "abaiQA"), !v.isEmpty { return v }
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-abaiQA"), i + 1 < args.count { return args[i + 1] }
        return ProcessInfo.processInfo.environment["ABAI_QA"] ?? ""
    }

    public override func load() {
        let s = Self.scenarioName
        if !s.isEmpty { Self.write("native loaded scenario=\(s) args=\(ProcessInfo.processInfo.arguments.dropFirst().joined(separator: " "))") }
    }

    @objc func available(_ call: CAPPluginCall) { call.resolve(["available": true]) }

    @objc func scenario(_ call: CAPPluginCall) {
        let s = Self.scenarioName
        if !s.isEmpty { Self.write("web asked scenario=\(s)") }
        call.resolve(["scenario": s])
    }

    @objc func log(_ call: CAPPluginCall) {
        Self.write(call.getString("msg") ?? "")
        call.resolve()
    }
}
