//
//  StabilityPlugin.swift
//  ABAI — 穩定性紀錄（正式版也開著，只存在手機裡，不外傳）
//
//  記錄：
//    ‧ 網頁程序被 iOS 關掉（App 最常見的「閃退」）：網頁每 5 秒回報一次「在哪個工具、剩多少記憶體」，只放在記憶體裡；
//      網頁被關掉、自己重新載入時會再打一次招呼，原生這邊就知道剛剛發生了什麼，把最後一次回報寫進紀錄
//    ‧ App 本身沒有正常結束（下次打開時記一筆）
//    ‧ 系統記憶體警告
//    ‧ Apple MetricKit 的正式診斷（當掉、卡死、被系統終止的原因；系統最晚隔天才交給 App）
//    ‧ 網頁的程式錯誤（網頁那邊有限制次數）
//  使用者在「設定」裡按「複製穩定性紀錄」貼給開發者。紀錄檔最多約 200KB，超過就輪替。
//

import Foundation
import Capacitor
import UIKit
import MetricKit
import os

@objc(StabilityPlugin)
public class StabilityPlugin: CAPPlugin, CAPBridgedPlugin, MXMetricManagerSubscriber {
    public let identifier = "StabilityPlugin"
    public let jsName = "Stability"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "hello", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "log", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "report", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyReport", returnType: CAPPluginReturnPromise),
    ]

    private static let queue = DispatchQueue(label: "abai.stability")
    private static var url: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("stability.log") }
    private static let maxBytes = 200_000
    private static let cleanKey = "abai.stability.running"

    private static func stamp() -> String {
        let f = DateFormatter(); f.dateFormat = "MM/dd HH:mm:ss"; return f.string(from: Date())
    }
    private static var memMB: Int { Int(os_proc_available_memory() / 1_048_576) }
    static func write(_ line: String) {
        let text = "\(stamp()) \(line)\n"
        queue.async {
            let fm = FileManager.default
            if let size = (try? fm.attributesOfItem(atPath: url.path)[.size]) as? Int, size > maxBytes {
                // 輪替：只留後半段
                if let d = try? Data(contentsOf: url) { try? d.suffix(maxBytes / 2).write(to: url) }
            }
            let data = Data(text.utf8)
            if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(data); try? h.close() }
            else { try? data.write(to: url) }
        }
    }

    /// 網頁這一次「活著」期間打過幾次招呼：超過一次＝網頁程序被關掉、自己重新載入了
    private var hellos = 0
    /// 網頁最後一次回報（只放記憶體，不寫檔）
    private var lastBeat = ""

    public override func load() {
        let d = UserDefaults.standard
        if d.bool(forKey: Self.cleanKey) {
            Self.write("⚠️ 上次 App 沒有正常結束（閃退、或在背景被系統關掉）")
        }
        d.set(true, forKey: Self.cleanKey)
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        Self.write("啟動 App \(v)，iOS \(UIDevice.current.systemVersion)，可用記憶體 \(Self.memMB)MB")
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
            Self.write("記憶體警告：可用 \(Self.memMB)MB；最後回報：\(self?.lastBeat ?? "")")
        }
        // 正常離開（切到背景）就不算閃退；回到前景再標回「執行中」
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in d.set(false, forKey: Self.cleanKey) }
        nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in d.set(true, forKey: Self.cleanKey) }
        nc.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { _ in d.set(false, forKey: Self.cleanKey) }
        if #available(iOS 14.0, *) { MXMetricManager.shared.add(self) }
    }

    @objc func hello(_ call: CAPPluginCall) {
        hellos += 1
        if hellos > 1 {
            Self.write("⚠️ 網頁程序被 iOS 關掉後重新載入（第 \(hellos - 1) 次）；被關掉前最後回報：\(lastBeat.isEmpty ? "無" : lastBeat)；現在可用記憶體 \(Self.memMB)MB")
        }
        call.resolve(["reloads": hellos - 1])
    }

    @objc func beat(_ call: CAPPluginCall) {
        lastBeat = "\(Self.stamp()) \(call.getString("where") ?? "?")，可用記憶體 \(Self.memMB)MB \(call.getString("extra") ?? "")"
        call.resolve(["availableMB": Self.memMB])
    }

    @objc func log(_ call: CAPPluginCall) {
        Self.write(String((call.getString("msg") ?? "").prefix(500)))
        call.resolve()
    }

    @objc func report(_ call: CAPPluginCall) {
        Self.queue.async {
            let text = (try? String(contentsOf: Self.url, encoding: .utf8)) ?? "（還沒有紀錄）"
            call.resolve(["text": text + "\n目前可用記憶體 \(Self.memMB)MB；最後回報：\(self.lastBeat)"])
        }
    }

    /// 直接寫進 iPhone 的剪貼簿（不靠網頁的剪貼簿權限）
    @objc func copyReport(_ call: CAPPluginCall) {
        Self.queue.async {
            let text = ((try? String(contentsOf: Self.url, encoding: .utf8)) ?? "（還沒有紀錄）") + "\n目前可用記憶體 \(Self.memMB)MB；最後回報：\(self.lastBeat)"
            DispatchQueue.main.async { UIPasteboard.general.string = "ABAI 穩定性紀錄\n" + text; call.resolve(["ok": true]) }
        }
    }

    // ── MetricKit：系統的正式診斷 ──────────────────────────────
    @available(iOS 14.0, *)
    public func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for p in payloads {
            for c in p.crashDiagnostics ?? [] {
                Self.write("🧾 系統診斷：App 當掉 type=\(c.exceptionType?.stringValue ?? "-") code=\(c.exceptionCode?.stringValue ?? "-") signal=\(c.signal?.stringValue ?? "-") reason=\(c.terminationReason ?? "-") 版本=\(c.metaData.applicationBuildVersion)")
            }
            for h in p.hangDiagnostics ?? [] {
                Self.write("🧾 系統診斷：畫面卡住 \(h.hangDuration.formatted())")
            }
            if #available(iOS 16.0, *) {
                for a in p.appLaunchDiagnostics ?? [] { Self.write("🧾 系統診斷：啟動太慢 \(a.launchDuration.formatted())") }
            }
            for r in p.cpuExceptionDiagnostics ?? [] { Self.write("🧾 系統診斷：CPU 用太多 \(r.totalCPUTime.formatted())") }
            for r in p.diskWriteExceptionDiagnostics ?? [] { Self.write("🧾 系統診斷：寫入太多 \(r.totalWritesCaused.formatted())") }
        }
    }
    @available(iOS 14.0, *)
    public func didReceive(_ payloads: [MXMetricPayload]) {
        for p in payloads {
            if let exits = p.applicationExitMetrics {
                let bg = exits.backgroundExitData, fg = exits.foregroundExitData
                Self.write("🧾 系統統計（\(p.timeStampBegin.formatted(date: .numeric, time: .omitted))）：前景 記憶體不足被關 \(fg.cumulativeMemoryResourceLimitExitCount)、當掉 \(fg.cumulativeBadAccessExitCount + fg.cumulativeIllegalInstructionExitCount + fg.cumulativeAbnormalExitCount)、卡死被關 \(fg.cumulativeAppWatchdogExitCount)；背景 記憶體壓力被關 \(bg.cumulativeMemoryPressureExitCount)、記憶體超量被關 \(bg.cumulativeMemoryResourceLimitExitCount)")
            }
            if let m = p.memoryMetrics { Self.write("🧾 系統統計：記憶體高峰 \(m.peakMemoryUsage.formatted())") }
        }
    }
}
