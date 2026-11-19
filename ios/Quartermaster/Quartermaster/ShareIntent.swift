import Foundation

/// A link shared through the app's own Share Extension, waiting to be handed
/// to the import page the shell opened for it (iOS README, "Share import").
/// The page imports a link only when the shell hands it over this way, so a
/// universal link or another app's `quartermaster://import?url=` still waits
/// for a tap.
///
/// Kept in memory only: a cold start that reopens the import page, or any
/// other page, carries none.
struct ShareIntent: Equatable {
    /// How long a share may wait for its page, a sign-in included.
    static let lifetime: TimeInterval = 300

    /// The link as shared, the same string the page's `?url=` holds.
    let link: String
    let expiresAt: Date

    init(link: String, now: Date = Date()) {
        self.link = link
        self.expiresAt = now.addingTimeInterval(Self.lifetime)
    }

    func isExpired(now: Date = Date()) -> Bool {
        now >= expiresAt
    }

    /// Whether `page` is the import page offering this link, on the app's
    /// host.
    func matches(_ page: URL, links: LinkPolicy) -> Bool {
        guard
            links.isAppPage(page),
            page.path(percentEncoded: false) == IncomingURL.importPath,
            let items = URLComponents(url: page, resolvingAgainstBaseURL: false)?.queryItems,
            let offered = items.first(where: { $0.name == "url" })?.value
        else { return false }
        return offered == link
    }

    /// Run with `callAsyncJavaScript` in the page's content world, with the
    /// arguments from `arguments(baseURL:)`. It checks the page again, since
    /// a navigation can land between the shell's check and the script, then
    /// sets `window.__qmShareImport` (read by a page that mounts later) and
    /// dispatches `qm:share-import` (heard by a page already up). True when
    /// it handed the link over. The link is an argument, never part of the
    /// source. `tests/e2e/share-import.test.ts` runs the same body.
    static let deliveryScript = """
        if (location.origin !== origin || location.pathname !== path) return false
        if (new URLSearchParams(location.search).get('url') !== link) return false
        window.__qmShareImport = { url: link }
        window.dispatchEvent(new CustomEvent('qm:share-import', { detail: { url: link } }))
        return true
        """

    func arguments(baseURL: URL) -> [String: Any] {
        ["link": link, "origin": Self.origin(of: baseURL), "path": IncomingURL.importPath]
    }

    /// `location.origin` for a page on `url`'s host: scheme, host, and the
    /// port only when it is not the scheme's default.
    static func origin(of url: URL) -> String {
        let scheme = url.scheme?.lowercased() ?? ""
        let host = url.host()?.lowercased() ?? ""
        let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
        if let port = url.port, port != defaultPort {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }
}
