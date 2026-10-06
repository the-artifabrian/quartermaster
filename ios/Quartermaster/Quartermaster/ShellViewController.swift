import Combine
import SafariServices
import SwiftUI
import UIKit
import WebKit
import os

/// Hosts the shell's view controller in the SwiftUI scene.
struct ShellView: UIViewControllerRepresentable {
    let config: ShellConfig
    let inbox: PageInbox
    let theme: PageTheme
    let initAt: Double

    func makeUIViewController(context: Context) -> ShellViewController {
        ShellViewController(config: config, inbox: inbox, theme: theme, initAt: initAt)
    }

    func updateUIViewController(_ controller: ShellViewController, context: Context) {}
}

private let log = Logger(subsystem: "app.useqm.ios", category: "shell")

/// Errors that mean the device could not reach the server, as opposed to the
/// server answering badly.
private let connectivityErrors: Set<Int> = [
    NSURLErrorNotConnectedToInternet,
    NSURLErrorNetworkConnectionLost,
    NSURLErrorTimedOut,
    NSURLErrorCannotFindHost,
    NSURLErrorCannotConnectToHost,
    NSURLErrorDNSLookupFailed,
    NSURLErrorDataNotAllowed,
    NSURLErrorInternationalRoamingOff,
]

/// The web view that presents the Web app, plus the native offline view.
final class ShellViewController: UIViewController {
    private let config: ShellConfig
    private let inbox: PageInbox
    private let theme: PageTheme
    private let links: LinkPolicy
    /// When the app started, epoch ms, for `window.__qmShell`.
    private let initAt: Double
    private let offline = OfflineModel()
    private var offlineController: UIHostingController<OfflineView>?
    private var webView: WKWebView!
    private let contentController = WKUserContentController()
    private var refresh: PageRefresh!
    /// Whether `window.__qmShell` is still injected. Only the first document
    /// should see it; a reload would report a launch that did not happen.
    private var hasLaunchTimingScript = false
    private var themeObservation: AnyCancellable?
    /// The last main-frame URL the web view tried to load, for Retry.
    private var lastRequestedURL: URL?
    /// Whether any page has committed. WKWebView.url already holds the
    /// pending URL while the first load is in flight, so it can't tell.
    private var hasCommittedPage = false
    /// When the web content process last died, to stop a crash-reload loop.
    private var lastProcessTermination: Date?
    /// Where each running download is being written.
    private var downloadFiles: [ObjectIdentifier: URL] = [:]

    init(config: ShellConfig, inbox: PageInbox, theme: PageTheme, initAt: Double) {
        self.config = config
        self.inbox = inbox
        self.theme = theme
        self.initAt = initAt
        self.links = LinkPolicy(host: config.host)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.limitsNavigationsToAppBoundDomains = config.limitsNavigationsToAppBoundDomains
        // Keep WebKit's own suffix ("Mobile/…") and append the shell token.
        configuration.applicationNameForUserAgent = [
            configuration.applicationNameForUserAgent, ShellConfig.userAgentToken,
        ]
        .compactMap { $0 }
        .filter { !$0.isEmpty }
        .joined(separator: " ")
        configuration.allowsInlineMediaPlayback = true
        let bridge = ShellBridge(links: links, theme: theme) { [weak self] in self?.refresh.finish() }
        bridge.install(in: contentController)
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = ShellConfig.allowsBackSwipe
        // Long-pressing a link opens the menu without a page preview, as in
        // a native app.
        webView.allowsLinkPreview = false
        // Show the launch colour, not white, until the first page paints.
        let canvas = UIColor(named: "LaunchBackground")
        webView.isOpaque = false
        webView.backgroundColor = canvas
        webView.scrollView.backgroundColor = canvas
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        self.webView = webView
        refresh = PageRefresh(webView: webView)
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        installDebugSession { [weak self] in self?.loadFirstPage() }
    }

    override func viewIsAppearing(_ animated: Bool) {
        super.viewIsAppearing(animated)
        applyAppearance()
        observeAppearance()
    }

    /// Starts at once, without waiting for the app to become active. A link
    /// that launched the app usually reaches the inbox first; one that
    /// arrives later replaces this load mid-flight.
    private func loadFirstPage() {
        let incoming = inbox.attach { [weak self] page in self?.openIncoming(page) }
        let page = incoming ?? config.startURL
        contentController.addUserScript(LaunchTiming.script(initAt: initAt, loadAt: LaunchTiming.now()))
        hasLaunchTimingScript = true
        load(page)
    }

    /// Debug builds take `-QMSessionCookie <value>`: the site's session cookie,
    /// set before the first load, so a screenshot run starts logged in without
    /// typing into the simulator. The value comes from a browser login.
    private func installDebugSession(then proceed: @escaping () -> Void) {
        #if DEBUG
        if let value = UserDefaults.standard.string(forKey: "QMSessionCookie") {
            // The presence of `.secure` marks the cookie secure, whatever its
            // value, so a local http server gets no such key.
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: "en_session", .value: value, .domain: config.host, .path: "/",
            ]
            if config.baseURL.scheme?.lowercased() == "https" { properties[.secure] = "TRUE" }
            guard let cookie = HTTPCookie(properties: properties) else {
                NSLog("QMSessionCookie: HTTPCookie init failed for host %@", config.host)
                return proceed()
            }
            let store = webView.configuration.websiteDataStore.httpCookieStore
            let host = config.host
            store.setCookie(cookie) {
                store.getAllCookies { all in
                    NSLog("QMSessionCookie: set for %@; store now has %d cookies: %@", host, all.count,
                          all.map { "\($0.name)@\($0.domain)\($0.path) secure=\($0.isSecure)" }.joined(separator: ", "))
                    proceed()
                }
            }
            return
        }
        #endif
        proceed()
    }

    private func load(_ url: URL) {
        lastRequestedURL = url
        webView.load(URLRequest(url: url))
    }

    /// A page from a link opened while the app was running. A Safari sheet
    /// left open would hide it, so it closes; alerts stay, since WebKit is
    /// waiting on their answer.
    private func openIncoming(_ page: URL) {
        if presentedViewController is SFSafariViewController {
            dismiss(animated: false)
        }
        load(page)
    }

    private func isAppPage(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased()) && links.isAppHost(url.host())
    }

    // MARK: Appearance

    /// The scene follows the page's theme (`.preferredColorScheme`, for the
    /// status bar), but the web view must not: it passes its appearance on to
    /// the page as `prefers-color-scheme`, and a page on the System theme
    /// would then stay on whatever it reported last. So the web view takes the
    /// screen's appearance, which is the system's, while the canvas around
    /// the page and the offline view take the page's.
    private func applyAppearance() {
        guard let screen = view.window?.windowScene?.screen else { return }
        let system = screen.traitCollection.userInterfaceStyle
        let page: UIUserInterfaceStyle
        switch theme.colorScheme {
        case .light: page = .light
        case .dark: page = .dark
        default: page = system
        }
        if webView.overrideUserInterfaceStyle != system {
            webView.overrideUserInterfaceStyle = system
        }
        let canvas = UIColor(named: "LaunchBackground")?.resolvedColor(with: UITraitCollection(userInterfaceStyle: page))
        webView.backgroundColor = canvas
        webView.scrollView.backgroundColor = canvas
        offlineController?.view.overrideUserInterfaceStyle = page
    }

    /// UIKit reports no change of the screen's appearance while the scene is
    /// overridden. Changing it from Control Center or Settings, or on a
    /// schedule while the phone is locked, makes the app active again
    /// afterwards, which is when the web view catches up.
    private func observeAppearance() {
        guard themeObservation == nil, let scene = view.window?.windowScene else { return }
        themeObservation = theme.$colorScheme
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.applyAppearance() }
        NotificationCenter.default.addObserver(
            self, selector: #selector(appearanceMayHaveChanged),
            name: UIApplication.didBecomeActiveNotification, object: nil)
        // Without an override the scene follows the system at once.
        if #available(iOS 17, *) {
            scene.registerForTraitChanges([UITraitUserInterfaceStyle.self]) { [weak self] (_: UIWindowScene, _) in
                self?.applyAppearance()
            }
        }
    }

    @objc private func appearanceMayHaveChanged() {
        applyAppearance()
    }

    // MARK: Offline view

    private func showOffline(_ reason: OfflineModel.Reason) {
        offline.reason = reason
        offline.isRetrying = false
        guard offlineController == nil else { return }
        refresh.isAvailable = false
        let controller = UIHostingController(
            rootView: OfflineView(model: offline) { [weak self] in self?.retry() })
        controller.view.backgroundColor = .clear
        addChild(controller)
        controller.view.frame = view.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(controller.view)
        controller.didMove(toParent: self)
        offlineController = controller
        applyAppearance()
    }

    private func hideOffline() {
        offline.isRetrying = false
        guard let controller = offlineController else { return }
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
        offlineController = nil
        refresh.isAvailable = true
    }

    private func retry() {
        offline.isRetrying = true
        load(lastRequestedURL ?? config.startURL)
    }

    // MARK: Presenting

    /// UIKit drops a presentation while another one is showing or animating.
    private var canPresent: Bool {
        viewIfLoaded?.window != nil
            && presentedViewController == nil
            && transitionCoordinator == nil
            && !isBeingPresented
            && !isBeingDismissed
    }

    private func open(_ url: URL, in destination: LinkPolicy.Destination) {
        switch destination {
        case .safari:
            guard canPresent else { return }
            let safari = SFSafariViewController(url: url)
            safari.dismissButtonStyle = .done
            present(safari, animated: true)
        case .system:
            UIApplication.shared.open(url)
        case .webView, .ignore:
            break
        }
    }
}

// MARK: - WKNavigationDelegate

extension ShellViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }

        // <a download>.
        if action.shouldPerformDownload {
            return decisionHandler(.download)
        }

        // Embedded frames load in place; only top-level navigations (and new
        // windows, whose target frame is nil) leave the app.
        if let frame = action.targetFrame, !frame.isMainFrame {
            return decisionHandler(.allow)
        }

        let destination = links.destination(for: url)
        if destination == .webView {
            if action.targetFrame != nil, isAppPage(url) {
                lastRequestedURL = url
            }
            decisionHandler(.allow)
        } else {
            open(url, in: destination)
            decisionHandler(.cancel)
        }
    }

    /// The data exports in Settings are JSON sent as attachments.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor response: WKNavigationResponse,
        decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
    ) {
        let disposition = (response.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?
            .trimmingCharacters(in: .whitespaces)
            .lowercased()
        let isAttachment = disposition?.hasPrefix("attachment") == true
        decisionHandler(isAttachment || !response.canShowMIMEType ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        hasCommittedPage = true
        hideOffline()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offline.isRetrying = false
        if hasLaunchTimingScript {
            hasLaunchTimingScript = false
            contentController.removeAllUserScripts()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        offline.isRetrying = false
        // Only the domain and code: an NSURLError carries the failing URL, which
        // can hold a verification code or a shared link.
        let failure = error as NSError
        log.error("Navigation failed after commit: \(failure.domain, privacy: .public) \(failure.code)")
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        offline.isRetrying = false
        let error = error as NSError
        // A newer navigation replaced this one, or a policy decision cancelled
        // it (WebKitErrorFrameLoadInterruptedByPolicyChange, which is also how
        // a navigation that turned into a download ends).
        if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return }
        if error.domain == "WebKitErrorDomain", error.code == 102 { return }

        if let failed = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL, isAppPage(failed) {
            lastRequestedURL = failed
        }
        let isConnectivity = error.domain == NSURLErrorDomain && connectivityErrors.contains(error.code)
        log.error("Load failed: \(error.domain, privacy: .public) \(error.code)")

        // With a page already showing, keep it. The offline view is for when
        // there is nothing else on screen.
        if !hasCommittedPage || offlineController != nil {
            showOffline(isConnectivity ? .offline : .failed)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let now = Date()
        defer { lastProcessTermination = now }
        log.error("Web content process terminated")

        // A page that kills its process on load would reload forever.
        if let last = lastProcessTermination, now.timeIntervalSince(last) < 10 {
            showOffline(.failed)
            return
        }
        // iOS reclaimed the page's process; without a reload the app is blank.
        if webView.url != nil {
            webView.reload()
        } else {
            load(lastRequestedURL ?? config.startURL)
        }
    }
}

// MARK: - WKDownloadDelegate

extension ShellViewController: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping @MainActor (URL?) -> Void
    ) {
        // A folder per download, so two files with the same name don't clash.
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "Downloads/\(UUID().uuidString)", directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            log.error("Download folder failed: \((error as NSError).domain, privacy: .public) \((error as NSError).code)")
            return completionHandler(nil)
        }
        let file = folder.appending(path: suggestedFilename.isEmpty ? "Download" : suggestedFilename)
        downloadFiles[ObjectIdentifier(download)] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let folder = file.deletingLastPathComponent()
        guard canPresent else {
            log.error("Download finished while another sheet was showing")
            try? FileManager.default.removeItem(at: folder)
            return
        }
        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: folder)
        }
        present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        log.error("Download failed: \((error as NSError).domain, privacy: .public) \((error as NSError).code)")
        if let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        }
    }
}

// MARK: - WKUIDelegate

extension ShellViewController: WKUIDelegate {
    /// `target="_blank"` and `window.open`. App pages load in this web view,
    /// since the app has no tabs; other hosts go to Safari. Anything else
    /// (about:blank, blob:, a window.open with no URL) opens nothing.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if isAppPage(url) {
            lastRequestedURL = url
            webView.load(action.request)
        } else {
            let destination = links.destination(for: url)
            if destination == .safari || destination == .system {
                open(url, in: destination)
            }
        }
        return nil
    }

    /// Voice input records through getUserMedia. iOS still asks for the
    /// microphone once (NSMicrophoneUsageDescription); this stops WebKit from
    /// asking again on every recording for the app's own pages.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void
    ) {
        decisionHandler(links.isAppHost(origin.host) ? .grant : .prompt)
    }

    // WKWebView drops alert() and answers confirm() with false unless the app
    // shows them. The Web app confirms destructive actions with confirm().
    // WebKit blocks the page until the completion handler runs, so a panel
    // that cannot be shown answers with the default at once.

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor () -> Void
    ) {
        guard canPresent else { return completionHandler() }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor (Bool) -> Void
    ) {
        guard canPresent else { return completionHandler(false) }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor (String?) -> Void
    ) {
        guard canPresent else { return completionHandler(nil) }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text ?? "")
        })
        present(alert, animated: true)
    }
}
