import SafariServices
import SwiftUI
import UIKit
import WebKit

/// Hosts the shell's view controller in the SwiftUI scene.
struct ShellView: UIViewControllerRepresentable {
    let config: ShellConfig

    func makeUIViewController(context: Context) -> ShellViewController {
        ShellViewController(config: config)
    }

    func updateUIViewController(_ controller: ShellViewController, context: Context) {}
}

/// The web view that presents the Web app, plus the native offline view.
final class ShellViewController: UIViewController {
    private let config: ShellConfig
    private let links: LinkPolicy
    private let offline = OfflineModel()
    private var offlineController: UIHostingController<OfflineView>?
    private var webView: WKWebView!
    /// The last main-frame URL the web view tried to load, for Retry.
    private var lastRequestedURL: URL?

    init(config: ShellConfig) {
        self.config = config
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

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
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
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        load(config.startURL)
    }

    private func load(_ url: URL) {
        lastRequestedURL = url
        webView.load(URLRequest(url: url))
    }

    // MARK: Offline view

    private func showOffline() {
        offline.isRetrying = false
        guard offlineController == nil else { return }
        let controller = UIHostingController(
            rootView: OfflineView(model: offline) { [weak self] in self?.retry() })
        controller.view.backgroundColor = .clear
        addChild(controller)
        controller.view.frame = view.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(controller.view)
        controller.didMove(toParent: self)
        offlineController = controller
    }

    private func hideOffline() {
        offline.isRetrying = false
        guard let controller = offlineController else { return }
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
        offlineController = nil
    }

    private func retry() {
        offline.isRetrying = true
        load(lastRequestedURL ?? config.startURL)
    }

    // MARK: Leaving the web view

    private func open(_ url: URL, in destination: LinkPolicy.Destination) {
        switch destination {
        case .safari:
            guard presentedViewController == nil else { return }
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

        // Embedded frames load in place; only top-level navigations (and new
        // windows, whose target frame is nil) leave the app.
        if let frame = action.targetFrame, !frame.isMainFrame {
            return decisionHandler(.allow)
        }

        let destination = links.destination(for: url)
        if destination == .webView {
            if action.targetFrame != nil, url.scheme?.hasPrefix("http") == true {
                lastRequestedURL = url
            }
            decisionHandler(.allow)
        } else {
            open(url, in: destination)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        hideOffline()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        let error = error as NSError
        // A newer navigation replaced this one, or the policy above cancelled
        // it (WebKitErrorFrameLoadInterruptedByPolicyChange).
        if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return }
        if error.domain == "WebKitErrorDomain", error.code == 102 { return }

        if let failed = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL,
           links.destination(for: failed) == .webView {
            lastRequestedURL = failed
        }
        showOffline()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // iOS reclaimed the page's process; without a reload the app is blank.
        if webView.url != nil {
            webView.reload()
        } else {
            load(lastRequestedURL ?? config.startURL)
        }
    }
}

// MARK: - WKUIDelegate

extension ShellViewController: WKUIDelegate {
    /// `target="_blank"` and `window.open`. Same-host pages load in this web
    /// view, since the app has no tabs; other hosts go to Safari.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        let destination = links.destination(for: url)
        if destination == .webView {
            lastRequestedURL = url
            webView.load(action.request)
        } else {
            open(url, in: destination)
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
    // that cannot be shown answers at once instead.

    private var canPresentPanel: Bool {
        viewIfLoaded?.window != nil && presentedViewController == nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor () -> Void
    ) {
        guard canPresentPanel else { return completionHandler() }
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
        guard canPresentPanel else { return completionHandler(false) }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}
