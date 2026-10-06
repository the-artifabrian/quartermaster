import SwiftUI

@main
struct QuartermasterApp: App {
    /// For `window.__qmShell` (#346, 5.2).
    private let initAt = LaunchTiming.now()
    private let config = ShellConfig.load()
    private let inbox = PageInbox()

    var body: some Scene {
        WindowGroup {
            // The web view handles the keyboard and safe areas itself, the way
            // Safari does, so SwiftUI must not resize it.
            ShellView(config: config, inbox: inbox, initAt: initAt)
                .ignoresSafeArea()
                .background(Color("LaunchBackground"))
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

/// Passes pages from incoming links to the shell. A link that launched the
/// app can arrive before the shell's view has loaded, so the inbox holds it
/// until the shell attaches.
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
