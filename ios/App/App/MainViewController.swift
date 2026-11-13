import UIKit
import WebKit
import Capacitor

/// App 的主畫面。跟 Capacitor 預設的一樣，只多做一件事：
/// 把放在 App 裡的自製外掛（影像核心、相簿、自製相簿畫面、預覽、相機、觸覺、影片、HEIC、RAW、記憶體警告）登記給網頁那邊用。
/// Main.storyboard 的 customClass 指向這裡。
class MainViewController: CAPBridgeViewController {
    /* 放大鏡的正解：WebKit 官方的「文字互動」開關（iOS 14.5 起）。關掉之後網頁上的選字、放大鏡、
       點兩下／點一下半選字整套都不會啟動 —— 不靠猜手勢名稱，所以 iOS 26 改名也不受影響。
       打字時（鍵盤升起）打開，文字框照常能選字、移游標；鍵盤收起就關回去。 */
    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let c = super.webViewConfiguration(for: instanceConfiguration)
        if #available(iOS 14.5, *) { c.preferences.isTextInteractionEnabled = false }
        return c
    }
    private func setTextInteraction(_ on: Bool) {
        guard #available(iOS 14.5, *), let web = bridge?.webView else { return }
        if web.configuration.preferences.isTextInteractionEnabled != on { web.configuration.preferences.isTextInteractionEnabled = on }
    }

    /* 原生預覽、原生相機打開時網頁會變透明，透出來的是這個畫面的底色。
       系統預設底色在淺色模式是白的，狀態列那一排就會變成白色色塊 —— 一律固定黑色。 */
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        overrideUserInterfaceStyle = .dark
    }

    /* Capacitor 的「畫面」就是網頁本身；網頁變透明時透出來的是更後面的視窗底色（系統預設白色）。
       視窗和網頁的上一層也一律塗黑。 */
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        view.window?.backgroundColor = .black
        view.superview?.backgroundColor = .black
        watchKeyboardForTextInteraction()
    }

    /// 打字時（鍵盤升起）打開文字互動，文字框照常能選字、移游標；鍵盤收起就關回去
    private var keyboardObservers: [NSObjectProtocol] = []
    func watchKeyboardForTextInteraction() {
        guard keyboardObservers.isEmpty else { return }
        let nc = NotificationCenter.default
        keyboardObservers.append(nc.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in self?.setTextInteraction(true) })
        keyboardObservers.append(nc.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in self?.setTextInteraction(false) })
    }

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
        bridge?.registerPluginInstance(PhotoLibraryPlugin())
        bridge?.registerPluginInstance(QAPlugin())
    }
}
