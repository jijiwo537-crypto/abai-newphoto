//
//  QAPlugin.swift
//  ABAI — 自動測試用（GitHub 上的 iOS 模擬器測試）
//
//  平常完全不做事：只有用「-abaiQA 情境名稱」這個啟動參數打開 App 時，網頁那邊（utils/nativeQA.ts）
//  才會照情境自己點按鈕、開相簿、輸出影片，每一步寫一行「ABAIQA …」到系統紀錄，給 CI 收集。
//

import Foundation
import Capacitor
import UIKit
import os

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

    private var asked = false

    public override func load() {
        let s = Self.scenarioName
        guard !s.isEmpty else { return }
        Self.write("native loaded scenario=\(s) args=\(ProcessInfo.processInfo.arguments.dropFirst().joined(separator: " "))")
        /* App 切到背景、收到記憶體警告、網頁的處理程序被系統收掉：都記下來 */
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in Self.write("native: did enter background") }
        nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in Self.write("native: will enter foreground") }
        nc.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
            Self.write("native: MEMORY WARNING available=\(os_proc_available_memory() / 1_048_576)MB")
        }
        nc.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { _ in Self.write("native: will terminate") }
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
            Self.write("native: alive, available memory \(os_proc_available_memory() / 1_048_576)MB")
        }
        /* 不完全靠網頁來問：過幾秒原生自己看網頁的狀態，必要時直接叫網頁開始，
           之後每秒把網頁攢下來的紀錄（window.__abaiQALog）收過來 */
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self = self, let web = self.bridge?.webView else { Self.write("native: no webView"); return }
            let diag = "JSON.stringify({ href: location.href, cap: !!window.Capacitor, native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()), headers: ((window.Capacitor && window.Capacitor.PluginHeaders) || []).map(function(h){ return h.name; }), hook: typeof window.__abaiQA, root: (document.getElementById('root')||{}).childElementCount })"
            web.evaluateJavaScript(diag) { r, e in
                Self.write("native diag: \(r ?? "nil") \(e?.localizedDescription ?? "")")
                if !self.asked {
                    web.evaluateJavaScript("typeof window.__abaiQA === 'function' ? (window.__abaiQA('\(s)'), 'kicked') : 'no hook'") { r2, e2 in
                        Self.write("native kick: \(r2 ?? "nil") \(e2?.localizedDescription ?? "")")
                    }
                }
            }
            Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                web.evaluateJavaScript("(window.__abaiQALog || []).splice(0).join('\\n')") { r, _ in
                    if let t = r as? String, !t.isEmpty { t.split(separator: "\n").forEach { Self.write("web: " + $0) } }
                }
            }
        }
    }

    @objc func available(_ call: CAPPluginCall) { call.resolve(["available": true]) }

    @objc func scenario(_ call: CAPPluginCall) {
        let s = Self.scenarioName
        if !s.isEmpty { asked = true; Self.write("web asked scenario=\(s)") }
        call.resolve(["scenario": s])
    }

    @objc func log(_ call: CAPPluginCall) {
        Self.write(call.getString("msg") ?? "")
        call.resolve()
    }
}
