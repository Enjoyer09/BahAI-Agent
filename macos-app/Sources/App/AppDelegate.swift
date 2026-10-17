import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {

    private var window: NSWindow?
    private var webView: WKWebView?
    private let backend = BackendService()

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupWindow()
        backend.start(projectRoot: BackendService.findProjectRoot())
        waitForBackendThenLoadFrontend(attemptsLeft: 30)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        backend.stop()
        ProcessRegistry.shared.terminateAll()
    }

    // MARK: - Window Setup

    private func setupWindow() {
        let windowRect = NSRect(x: 0, y: 0, width: 1200, height: 800)

        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        window?.title = "bahAI"
        window?.titlebarAppearsTransparent = false
        window?.titleVisibility = .visible
        window?.center()
        window?.setFrameAutosaveName("bahAIMainWindow")
        window?.minSize = NSSize(width: 800, height: 600)

        let toolbar = NSToolbar(identifier: "MainToolbar")
        toolbar.displayMode = .iconAndLabel
        window?.toolbar = toolbar
        window?.toolbarStyle = .unified

        let contentView = NSView(frame: windowRect)
        contentView.wantsLayer = true
        contentView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        window?.contentView = contentView

        let loadingLabel = NSTextField(labelWithString: "bahAI loading...")
        loadingLabel.font = NSFont.systemFont(ofSize: 18, weight: .medium)
        loadingLabel.textColor = .secondaryLabelColor
        loadingLabel.alignment = .center
        loadingLabel.frame = NSRect(x: 0, y: 0, width: 400, height: 50)
        loadingLabel.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
        loadingLabel.tag = 100
        contentView.addSubview(loadingLabel)

        window?.makeKeyAndOrderFront(nil)
        setupMenu()
    }

    // MARK: - Menu Setup

    private func setupMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(NSMenuItem(title: "About bahAI", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit bahAI", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu
        fileMenu.addItem(NSMenuItem(title: "New Chat", action: #selector(newChat), keyEquivalent: "n"))

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))

        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: ""))
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(NSMenuItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: ""))

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    @objc private func newChat() {
        webView?.evaluateJavaScript("window.bahAIBridge?.newChat()")
    }

    // MARK: - Frontend Loading

    private func waitForBackendThenLoadFrontend(attemptsLeft: Int) {
        guard attemptsLeft > 0 else {
            print("[bahAI] ERROR: Backend never became ready")
            loadFrontend()
            return
        }

        var request = URLRequest(url: URL(string: "http://localhost:3001/")!)
        request.timeoutInterval = 2

        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                if ok {
                    print("[bahAI] Backend ready, loading frontend")
                    self?.loadFrontend()
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        self?.waitForBackendThenLoadFrontend(attemptsLeft: attemptsLeft - 1)
                    }
                }
            }
        }.resume()
    }

    private func loadFrontend() {
        guard let contentView = window?.contentView else { return }

        let config = WKWebViewConfiguration()
        #if DEBUG
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif

        config.userContentController.add(WKBridgeMessageHandler(), name: "native")

        let wv = WKWebView(frame: contentView.bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.customUserAgent = "bahAI-macOS/1.0"
        wv.navigationDelegate = self

        contentView.viewWithTag(100)?.removeFromSuperview()
        contentView.addSubview(wv)
        webView = wv

        let frontendURL = URL(string: "http://localhost:3001")!
        wv.load(URLRequest(url: frontendURL))
        print("[bahAI] Loading frontend from \(frontendURL)")
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadError(error)
    }

    private func showLoadError(_ error: Error) {
        print("[bahAI] WebView load failed: \(error.localizedDescription)")

        let escaped = error.localizedDescription
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")

        let html = """
        <html><body style="font-family:-apple-system;padding:40px;color:#333">
        <h2>bahAI yüklənə bilmədi</h2>
        <p><b>Xəta:</b> \(escaped)</p>
        <p>Backend <code>http://localhost:3001</code> cavab vermir.</p>
        <p>Terminalda yoxlayın: <code>node backend/index.js</code></p>
        </body></html>
        """
        webView?.loadHTMLString(html, baseURL: nil)
    }
}
