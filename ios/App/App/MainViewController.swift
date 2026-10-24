import UIKit
import Capacitor

/// App 的主畫面。跟 Capacitor 預設的一樣，只多做一件事：
/// 把放在 App 裡的自製外掛（HEIC 輸出、RAW 解碼）登記給網頁那邊用。
/// Main.storyboard 的 customClass 指向這裡。
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HeicExportPlugin())
        bridge?.registerPluginInstance(RawDecodePlugin())
    }
}
