import SwiftUI

@main
struct QuartermasterApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var theme = PageTheme()
    /// For `window.__qmShell` (#346, 5.2).
    private let initAt = LaunchTiming.appInit()
    private let config = Shell.config
    private let inbox = Shell.inbox

    var body: some Scene {
        WindowGroup {
            // The web view handles the keyboard and safe areas itself, the way
            // Safari does, so SwiftUI must not resize it.
            ShellView(config: config, inbox: inbox, theme: theme, initAt: initAt)
                .ignoresSafeArea()
                .background(Color("LaunchBackground"))
                // The page draws under the status bar, so the bar follows the
                // page's theme rather than the system's.
                .preferredColorScheme(theme.colorScheme)
                // quartermaster://import from the Share Extension.
                .onOpenURL { url in
                    if let page = IncomingURL.page(for: url, baseURL: config.baseURL) {
                        inbox.deliver(page)
                    }
                }
                // Universal links, once the applinks entitlement is on (#327, 1.6).
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL,
                       let page = IncomingURL.page(for: url, baseURL: config.baseURL) {
                        inbox.deliver(page)
                    }
                }
        }
    }
}

/// What the scene and the UIKit delegates share. SwiftUI creates the
/// delegates itself, so they reach these here rather than being handed them.
enum Shell {
    static let config = ShellConfig.load()
    static let inbox = PageInbox()
}

/// Passes pages from incoming links and quick actions to the shell. A link
/// that launched the app can arrive before the shell's view has loaded, so the
/// inbox holds it until the shell attaches.
final class PageInbox {
    private var pending: URL?
    private var handler: ((URL) -> Void)?

    func deliver(_ page: URL) {
        if let handler {
            handler(page)
        } else {
            pending = page
        }
    }

    /// Starts handing pages to `handler`, and returns the one that arrived
    /// first, if any.
    func attach(_ handler: @escaping (URL) -> Void) -> URL? {
        self.handler = handler
        defer { pending = nil }
        return pending
    }
}
