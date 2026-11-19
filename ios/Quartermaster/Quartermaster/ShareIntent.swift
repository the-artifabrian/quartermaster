import Foundation

/// What was shared through the app's own Share Extension, waiting to be handed
/// to the import page the shell opened for it (iOS README, "Share import"):
/// a link, for the page offering that link, or screenshots, for the plain
/// import page. The page imports only what the shell hands over this way, so a
/// universal link or another app's `quartermaster://import?url=` still waits
/// for a tap.
///
/// Kept in memory only: a cold start that reopens the import page, or any
/// other page, carries none.
struct ShareIntent: Equatable {
    /// How long a share may wait for its page, a sign-in included.
    static let lifetime: TimeInterval = 300

    let payload: ShareStore.Payload
    let expiresAt: Date

    init(_ payload: ShareStore.Payload, now: Date = Date()) {
        self.payload = payload
        self.expiresAt = now.addingTimeInterval(Self.lifetime)
    }

    func isExpired(now: Date = Date()) -> Bool {
        now >= expiresAt
    }

    /// Whether `page` is the import page this share belongs on, on the app's
    /// host: the one offering the link, or the plain one for screenshots.
    func matches(_ page: URL, links: LinkPolicy) -> Bool {
        guard links.isAppPage(page), page.path(percentEncoded: false) == IncomingURL.importPath else { return false }
        let offered = URLComponents(url: page, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "url" })?.value
        switch payload {
        case .link(let link): return offered == link
        case .images: return offered == nil
        }
    }

    /// Run with `callAsyncJavaScript` in the page's content world, with the
    /// arguments from `arguments(baseURL:)`. Each checks the page again, since
    /// a navigation can land between the shell's check and the script, then
    /// sets `window.__qmShareImport` (read by a page that mounts later) and
    /// dispatches `qm:share-import` (heard by a page already up). True when it
    /// handed the share over. What was shared is an argument, never part of
    /// the source. `tests/e2e/share-import.test.ts` runs the same bodies.
    var script: String {
        switch payload {
        case .link: return Self.linkScript
        case .images: return Self.imagesScript
        }
    }

    static let linkScript = """
        if (location.origin !== origin || location.pathname !== path) return false
        if (new URLSearchParams(location.search).get('url') !== link) return false
        window.__qmShareImport = { url: link }
        window.dispatchEvent(new CustomEvent('qm:share-import', { detail: { url: link } }))
        return true
        """

    static let imagesScript = """
        if (location.origin !== origin || location.pathname !== path) return false
        if (new URLSearchParams(location.search).has('url')) return false
        const files = images.map((image) => {
            const binary = atob(image.data)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            return new File([bytes], image.name, { type: image.type })
        })
        window.__qmShareImport = { files }
        window.dispatchEvent(new CustomEvent('qm:share-import'))
        return true
        """

    func arguments(baseURL: URL) -> [String: Any] {
        var arguments: [String: Any] = ["origin": Self.origin(of: baseURL), "path": IncomingURL.importPath]
        switch payload {
        case .link(let link):
            arguments["link"] = link
        case .images(let images):
            arguments["images"] = images.enumerated().map { index, data in
                ["name": "Screenshot \(index + 1).jpg", "type": "image/jpeg", "data": data.base64EncodedString()]
            }
        }
        return arguments
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
