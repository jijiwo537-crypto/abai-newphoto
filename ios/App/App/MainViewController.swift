import UIKit
import Capacitor

/// App 的主畫面。跟 Capacitor 預設的一樣，只多做一件事：
/// 把放在 App 裡的自製外掛（影像核心、相簿、預覽、相機、觸覺、影片、HEIC、RAW、記憶體警告）登記給網頁那邊用。
/// Main.storyboard 的 customClass 指向這裡。
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HeicExportPlugin())
        bridge?.registerPluginInstance(RawDecodePlugin())
        bridge?.registerPluginInstance(MemoryPressurePlugin())
        bridge?.registerPluginInstance(NativeImagePlugin())
        bridge?.registerPluginInstance(NativePhotosPlugin())
        bridge?.registerPluginInstance(NativePreviewPlugin())
        bridge?.registerPluginInstance(NativeCameraPlugin())
        bridge?.registerPluginInstance(HapticsPlugin())
        bridge?.registerPluginInstance(VideoWriterPlugin())
    }
}
