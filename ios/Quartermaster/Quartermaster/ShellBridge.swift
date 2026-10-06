import SwiftUI
import UIKit
import WebKit

/// The messages the page sends the shell, through
/// `window.webkit.messageHandlers.<name>.postMessage(<string>)`. The README's
/// "Shell bridge" section is the contract with the Web app.
///
/// Only the app's own pages, in the main frame, are heard; an embedded frame
/// from another site cannot buzz the phone or recolour the status bar.
final class ShellBridge: NSObject, WKScriptMessageHandler {
    enum Handler: String, CaseIterable {
        /// `selection`, `light`, `medium`, `success`, `warning` or `error`.
        case haptic
        /// `light` or `dark`, on load and whenever the page's theme changes.
        case theme
        /// `done`, once the page has revalidated after `qm:refresh`.
        case refresh
    }

    private let links: LinkPolicy
    private let theme: PageTheme
    private let refreshDone: () -> Void
    private let haptics = Haptics()

    /// The user content controller keeps its handlers alive, so `refreshDone`
    /// should not hold the shell strongly.
    init(links: LinkPolicy, theme: PageTheme, refreshDone: @escaping () -> Void) {
        self.links = links
        self.theme = theme
        self.refreshDone = refreshDone
    }

    func install(in controller: WKUserContentController) {
        for handler in Handler.allCases {
            controller.add(self, name: handler.rawValue)
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.frameInfo.isMainFrame,
            links.isAppHost(message.frameInfo.securityOrigin.host),
            let handler = Handler(rawValue: message.name),
            let body = message.body as? String
        else { return }

        switch handler {
        case .haptic:
            haptics.play(body)
        case .theme:
            switch body {
            case "light": theme.colorScheme = .light
            case "dark": theme.colorScheme = .dark
            default: break
            }
        case .refresh:
            if body == "done" { refreshDone() }
        }
    }
}

/// The page's theme, which the scene applies with `.preferredColorScheme` so
/// the status bar text stays readable over the page. Nil, meaning the system
/// scheme, until the page reports one.
final class PageTheme: ObservableObject {
    @Published var colorScheme: ColorScheme?
}

/// UIKit's feedback generators, by the names the page uses. Kept for the
/// app's lifetime, which lets the Taptic Engine stay warm between taps.
private final class Haptics {
    private let selection = UISelectionFeedbackGenerator()
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let medium = UIImpactFeedbackGenerator(style: .medium)
    private let notification = UINotificationFeedbackGenerator()

    func play(_ name: String) {
        switch name {
        case "selection": selection.selectionChanged()
        case "light": light.impactOccurred()
        case "medium": medium.impactOccurred()
        case "success": notification.notificationOccurred(.success)
        case "warning": notification.notificationOccurred(.warning)
        case "error": notification.notificationOccurred(.error)
        default: break
        }
    }
}

/// Pull to refresh on the web view. A pull dispatches `qm:refresh` on the
/// page's window; the spinner stops when the page posts `done` to the
/// `refresh` handler, or after `timeout`, whichever comes first.
final class PageRefresh: NSObject {
    static let timeout: TimeInterval = 5

    private let control = UIRefreshControl()
    private weak var webView: WKWebView?
    private var pendingTimeout: DispatchWorkItem?

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        control.addTarget(self, action: #selector(pulled), for: .valueChanged)
        webView.scrollView.refreshControl = control
    }

    /// Off while the offline view covers the page: there is no page to ask,
    /// and the offline view has its own Retry.
    var isAvailable = true {
        didSet {
            guard isAvailable != oldValue else { return }
            if !isAvailable { finish() }
            webView?.scrollView.refreshControl = isAvailable ? control : nil
        }
    }

    @objc private func pulled() {
        let timeout = DispatchWorkItem { [weak self] in self?.finish() }
        pendingTimeout?.cancel()
        pendingTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeout, execute: timeout)

        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('qm:refresh'))") { [weak self] _, error in
            // No page to run it in (a load in flight, say): nothing will answer.
            if error != nil { self?.finish() }
        }
    }

    func finish() {
        pendingTimeout?.cancel()
        pendingTimeout = nil
        if control.isRefreshing { control.endRefreshing() }
    }
}

/// When the shell started and when it started the first load, for the page
/// to measure the shell's share of a cold start (#346, 5.2). The page reads
/// them from `window.__qmShell`.
enum LaunchTiming {
    /// Epoch milliseconds, the unit of `Date.now()` in the page.
    static func now() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    /// A main-frame, document-start script defining `window.__qmShell`.
    static func script(initAt: Double, loadAt: Double) -> WKUserScript {
        let source = "window.__qmShell = { initAt: \(Int64(initAt.rounded())), loadAt: \(Int64(loadAt.rounded())) };"
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
}
