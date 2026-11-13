import UIKit
import Capacitor

/// App 的主畫面。跟 Capacitor 預設的一樣，只多做一件事：
/// 把放在 App 裡的自製外掛（影像核心、相簿、自製相簿畫面、預覽、相機、觸覺、影片、HEIC、RAW、記憶體警告）登記給網頁那邊用。
/// Main.storyboard 的 customClass 指向這裡。
class MainViewController: CAPBridgeViewController {
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
        disableWebLoupe()
    }

    /* 快點兩下會跳出一個橢圓放大鏡（WebKit 的文字選取放大鏡），點兩下也會先等一下看是不是要放大／選字。
       這些是網頁元件內建、掛在內容那一層的手勢，CSS 的 user-select:none 擋不掉 —— 直接把那幾個手勢關掉。
       一般點擊、拖曳、捲動、雙指縮放（我們自己的）都不是這幾個，不受影響。
       網頁程序被系統收掉重開時內容那一層會換新的，所以 App 回到前景時再檢查一次。 */
    private var loupeObservers: [NSObjectProtocol] = []
    /// 打字時（鍵盤升起）放大鏡與點兩下選字要正常；其他時候關掉
    private var typing = false
    func disableWebLoupe() { setWebLoupe(enabled: typing) }
    private func setWebLoupe(enabled: Bool) {
        guard let web = bridge?.webView else { return }
        func walk(_ v: UIView) {
            for g in v.gestureRecognizers ?? [] {
                let name = NSStringFromClass(type(of: g))
                if name.contains("Loupe") || name.contains("TapAndAHalf") { g.isEnabled = enabled }
                else if let t = g as? UITapGestureRecognizer, t.numberOfTapsRequired == 2, name.contains("UITapGestureRecognizer") { g.isEnabled = enabled }
            }
            v.subviews.forEach(walk)
        }
        walk(web.scrollView)
        if loupeObservers.isEmpty {
            let nc = NotificationCenter.default
            loupeObservers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.disableWebLoupe() })
            loupeObservers.append(nc.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in self?.typing = true; self?.setWebLoupe(enabled: true) })
            loupeObservers.append(nc.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in self?.typing = false; self?.setWebLoupe(enabled: false) })
        }
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
        // 網頁內容那一層載入後才有那些手勢
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.disableWebLoupe() }
    }
}
