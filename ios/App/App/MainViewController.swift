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

    /* 快點兩下會跳出放大鏡（iOS 26 是液態玻璃造型的那一顆），點兩下也會先等一下看是不是要放大／選字。
       這些是網頁元件內建、掛在內容那一層的手勢，CSS 的 user-select:none 擋不掉 —— 直接把那幾個手勢關掉。
       各版 iOS 的手勢名稱不一樣（iOS 26 改過名），所以用寬一點的規則：跟「選字、放大鏡、點兩下」有關的都關，
       但點一下、捲動、雙指縮放、觸控事件那幾個一定留著。WebKit 會自己補回或重新打開這些手勢，
       所以每 2 秒、回到前景、鍵盤收起時都再檢查一次。打字時（鍵盤升起）全部恢復，選字照常。 */
    private var loupeObservers: [NSObjectProtocol] = []
    private var loupeTimer: Timer?
    private var typing = false
    private var loggedGestures = false
    func disableWebLoupe() { setWebLoupe(enabled: typing) }
    private static func isLoupeGesture(_ g: UIGestureRecognizer) -> Bool {
        let name = NSStringFromClass(type(of: g))
        // 一定要留的：觸控事件、點一下產生 click、捲動、縮放、拖曳
        for keep in ["WKTouch", "Synthetic", "Scroll", "Pinch", "Pan", "Swipe", "Hover", "WKMouse", "DeferringGesture", "DeferringGestureRecognizer", "Inspector"] where name.contains(keep) { return false }
        for kill in ["Loupe", "TapAndAHalf", "TextTap", "MultiTap", "Selection", "DoubleTap", "TextInteraction", "Highlight", "TwoFingerSingleTap", "Lookup"] where name.contains(kill) { return true }
        if let t = g as? UITapGestureRecognizer, t.numberOfTapsRequired >= 2 { return true }
        if g is UILongPressGestureRecognizer { return true }      // 長按的選字／放大鏡（我們沒有用到網頁的長按選單）
        return false
    }
    private func setWebLoupe(enabled: Bool) {
        guard let web = bridge?.webView else { return }
        var names: [String] = []
        func walk(_ v: UIView) {
            for g in v.gestureRecognizers ?? [] {
                let off = MainViewController.isLoupeGesture(g)
                if !loggedGestures { names.append("\(NSStringFromClass(type(of: g)))\(off ? "×" : "")") }
                if off && g.isEnabled != enabled { g.isEnabled = enabled }
            }
            v.subviews.forEach(walk)
        }
        walk(web.scrollView)
        if !loggedGestures && !names.isEmpty { loggedGestures = true; NSLog("ABAIQA gestures: %@", names.joined(separator: ", ")) }
        if loupeObservers.isEmpty {
            let nc = NotificationCenter.default
            loupeObservers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.disableWebLoupe() })
            loupeObservers.append(nc.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in self?.typing = true; self?.setWebLoupe(enabled: true) })
            loupeObservers.append(nc.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in self?.typing = false; self?.setWebLoupe(enabled: false) })
            loupeTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
                guard let self = self, !self.typing, UIApplication.shared.applicationState == .active else { return }
                self.setWebLoupe(enabled: false)
            }
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
