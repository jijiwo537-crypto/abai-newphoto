//
//  MemoryPressurePlugin.swift
//  ABAI — 系統記憶體警告轉給網頁
//
//  由 MainViewController 登記。iOS 覺得記憶體快不夠時會發 didReceiveMemoryWarning，
//  這支把它轉成網頁那邊的 "memoryWarning" 事件（見 utils/memoryPressure.ts），
//  網頁收到後先把可以重建的快取放掉，降低整個網頁被系統收掉的機會。
//
//  尚未在真機上驗證。寫法照 Capacitor 外掛的標準格式（同 RawDecodePlugin），
//  可在模擬器用 Debug ▸ Simulate Memory Warning 測試。
//

import Foundation
import Capacitor
import UIKit

@objc(MemoryPressurePlugin)
public class MemoryPressurePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MemoryPressurePlugin"
    public let jsName = "MemoryPressure"
    public let pluginMethods: [CAPPluginMethod] = []

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("memoryWarning", data: [:])
        }
    }

    deinit {
        if let observer = observer { NotificationCenter.default.removeObserver(observer) }
    }
}
