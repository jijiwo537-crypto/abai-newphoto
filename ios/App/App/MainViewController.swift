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
        /* 網頁 → 原生的二進位通道（見 ABAIIOSchemeHandler）。已經有人登記、或是系統自己處理的協定就不登記
           （登記重複會直接丟例外），網頁那邊探不到就照舊走 base64 */
        let io = ABAIIOSchemeHandler.scheme
        if !WKWebView.handlesURLScheme(io) && c.urlSchemeHandler(forURLScheme: io) == nil {
            c.setURLSchemeHandler(ABAIIOSchemeHandler.shared, forURLScheme: io)
        }
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
        #if DEBUG
        /* 開發版：讓 Mac 的 Safari 網頁檢閱器看得到這個 WebView（iOS 16.4 起預設關閉），
           用來讀實機量測（[abai-perf]）。正式版（Release）不會開 */
        if #available(iOS 16.4, *) { bridge?.webView?.isInspectable = true }
        #endif
        bridge?.registerPluginInstance(HeicExportPlugin())
        bridge?.registerPluginInstance(RawDecodePlugin())
        bridge?.registerPluginInstance(MemoryPressurePlugin())
        bridge?.registerPluginInstance(NativeImagePlugin())
        bridge?.registerPluginInstance(NativePhotosPlugin())
        bridge?.registerPluginInstance(NativePreviewPlugin())
        bridge?.registerPluginInstance(NativeCameraPlugin())
        bridge?.registerPluginInstance(HapticsPlugin())
        bridge?.registerPluginInstance(NativeGlassPlugin())
        bridge?.registerPluginInstance(VideoWriterPlugin())
        bridge?.registerPluginInstance(PhotoLibraryPlugin())
        bridge?.registerPluginInstance(QAPlugin())
        bridge?.registerPluginInstance(StabilityPlugin())
    }
}

/// 網頁 → 原生的二進位通道：`fetch("abai-io://local/put?ext=png", { method: "POST", body: 位元組 })`
/// 直接把位元組寫成暫存檔，回傳 { path, size }。帶 `&path=` 就接在那個檔後面（分段上傳）。
///
/// 以前網頁交檔案給原生只能走外掛的 JSON 訊息：位元組先轉成 base64 字串（大 33%），一段一段送過去再解回來，
/// 一張 2000 多萬像素的成品光是搬過去就要好幾百毫秒。這條通道走 WebKit 自己的資源載入，位元組原封不動。
///
/// 安全與穩定：
/// ‧ 只會寫進 App 自己的暫存資料夾（ABAIImageCore.tempDir），`path` 指到別處一律當成新檔
/// ‧ 寫檔在自己的背景佇列做，不跟影像編碼搶同一條佇列
/// ‧ WKURLSchemeTask 被網頁取消（stop）之後再回應會直接丟例外閃退：所有回應都在主執行緒做，
///   回應前先查是否已經被取消
/// ‧ 網頁那邊會先送一小段探測、讀回比對每個位元組，對不上就整條不用（照舊走 base64），所以這裡出任何問題都只是變慢、不會壞
final class ABAIIOSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "abai-io"
    static let shared = ABAIIOSchemeHandler()
    private let io = DispatchQueue(label: "abai.io", qos: .userInitiated, autoreleaseFrequency: .workItem)
    /// 已經被網頁取消的請求（只在主執行緒讀寫）
    private var stopped = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        let req = task.request
        guard let url = req.url else { respond(task, id, status: 400, json: ["error": "no url"]); return }
        let method = (req.httpMethod ?? "GET").uppercased()
        if method == "OPTIONS" { respond(task, id, status: 204, body: Data()); return }
        guard method == "POST" || method == "PUT", url.path == "/put" else {
            respond(task, id, status: 404, json: ["error": "not found"]); return
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let rawExt = items.first(where: { $0.name == "ext" })?.value ?? "bin"
        let ext = String(rawExt.lowercased().filter { $0.isLetter || $0.isNumber }.prefix(8))
        let given = items.first(where: { $0.name == "path" })?.value
        let body = req.httpBody
        let stream = body == nil ? req.httpBodyStream : nil
        io.async { [weak self] in
            var out: [String: Any]
            var status = 200
            do {
                let fm = FileManager.default
                var dest = ABAIImageCore.newFileURL(ext: ext.isEmpty ? "bin" : ext)
                var append = false
                if let g = given, let u = ABAIImageCore.fileURL(from: g), Self.inTemp(u), fm.fileExists(atPath: u.path) { dest = u; append = true }
                if !append { fm.createFile(atPath: dest.path, contents: nil) }
                let h = try FileHandle(forWritingTo: dest)
                defer { try? h.close() }
                try h.seekToEnd()
                var got = 0
                if let b = body {
                    if !b.isEmpty { try h.write(contentsOf: b) }
                    got = b.count
                } else if let s = stream {
                    s.open()
                    defer { s.close() }
                    let cap = 1 << 20
                    var buf = [UInt8](repeating: 0, count: cap)
                    while true {
                        let n = s.read(&buf, maxLength: cap)
                        if n < 0 { throw s.streamError ?? ABAIImageCore.CoreError.decode }
                        if n == 0 { break }
                        try h.write(contentsOf: Data(buf[0..<n]))
                        got += n
                    }
                }
                let size = ((try? fm.attributesOfItem(atPath: dest.path))?[.size] as? NSNumber)?.intValue ?? -1
                out = ["path": dest.path, "size": size, "got": got]
            } catch {
                status = 500
                out = ["error": error.localizedDescription]
            }
            DispatchQueue.main.async { self?.respond(task, id, status: status, json: out) }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private static func inTemp(_ u: URL) -> Bool {
        let root = ABAIImageCore.tempDir.standardizedFileURL.resolvingSymlinksInPath().path
        let p = u.standardizedFileURL.resolvingSymlinksInPath().path
        return p.hasPrefix(root + "/")
    }

    private func respond(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, status: Int, json: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: json)) ?? Data("{}".utf8)
        respond(task, id, status: status, body: data)
    }

    /// 一律在主執行緒呼叫：已被取消的請求不能再回應（WebKit 會丟例外）
    private func respond(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, status: Int, body: Data) {
        if stopped.remove(id) != nil { return }
        guard let url = task.request.url,
              let r = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [
                "Content-Type": "application/json",
                "Content-Length": String(body.count),
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": "*",
              ]) else { return }
        task.didReceive(r)
        if !body.isEmpty { task.didReceive(body) }
        task.didFinish()
    }
}
