import Foundation

/// Turns a URL the app was opened with into what the shell does with it.
///
/// Three kinds arrive:
/// - `quartermaster://import?share=<nonce>`, from the app's own Share
///   Extension. A link or screenshots wait in the App Group under that nonce
///   (`ShareStore`); the shell opens the import page for them and hands them
///   to the page, which imports them at once.
/// - `quartermaster://import?url=<percent-encoded http(s) URL>`, from older
///   builds of the Share Extension or anything else that opens the scheme,
///   opens the Recipe import page with that URL, ready to import with one
///   tap.
/// - A universal link (`https://useqm.app/…`) loads as it is.
///
/// Anything else gives nil and is ignored.
enum IncomingURL {
    static let scheme = "quartermaster"
    static let importPath = "/recipes/import"

    enum Destination: Equatable {
        /// Load this page.
        case page(URL)
        /// A share through the app's own Share Extension, under this nonce.
        case share(nonce: String)
    }

    static func destination(for url: URL, baseURL: URL) -> Destination? {
        switch url.scheme?.lowercased() {
        case scheme:
            return schemeDestination(for: url, baseURL: baseURL)
        case "http", "https":
            return LinkPolicy(host: baseURL.host()?.lowercased() ?? "").isAppPage(url) ? .page(url) : nil
        default:
            return nil
        }
    }

    private static func schemeDestination(for url: URL, baseURL: URL) -> Destination? {
        guard
            url.host()?.lowercased() == "import",
            url.path().isEmpty || url.path() == "/",
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        else { return nil }
        if let nonce = items.first(where: { $0.name == "share" })?.value {
            return .share(nonce: nonce)
        }
        guard
            let shared = items.first(where: { $0.name == "url" })?.value,
            let page = importPage(for: shared, baseURL: baseURL)
        else { return nil }
        return .page(page)
    }

    /// What a share's nonce opens. A fresh link opens the import page
    /// offering it, and fresh screenshots the plain import page, each with the
    /// share to hand over. An old link opens its page waiting for a tap; old
    /// screenshots, or an unknown or used nonce, open the plain import page.
    static func sharedImport(_ lookup: ShareStore.Lookup, baseURL: URL) -> (page: URL, intent: ShareIntent?) {
        let plainImport = baseURL.appending(path: importPath)
        switch lookup {
        case .accepted(.link(let link)):
            guard let page = importPage(for: link, baseURL: baseURL) else { return (plainImport, nil) }
            return (page, ShareIntent(.link(link)))
        case .accepted(.images(let images)):
            return (plainImport, ShareIntent(.images(images)))
        case .expired(let link?):
            return (importPage(for: link, baseURL: baseURL) ?? plainImport, nil)
        case .expired(nil), .missing:
            return (plainImport, nil)
        }
    }

    /// `<base URL>/recipes/import?url=<shared>` for an http(s) URL with a
    /// host, keeping `shared` exactly as given.
    static func importPage(for shared: String, baseURL: URL) -> URL? {
        guard
            let sharedURL = URL(string: shared),
            ["http", "https"].contains(sharedURL.scheme?.lowercased()),
            sharedURL.host() != nil,
            var page = URLComponents(url: baseURL.appending(path: importPath), resolvingAgainstBaseURL: false)
        else { return nil }
        page.percentEncodedQuery = "url=" + encodeQueryValue(shared)
        return page.url
    }

    /// Characters a query value keeps unencoded. Everything else, including
    /// `&`, `=`, `?`, `#`, `+` and `/`, is percent-encoded, so the shared URL
    /// reaches the server whole and `+` is not read as a space. The Share
    /// Extension encodes with the same set.
    static let queryValueAllowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    static func encodeQueryValue(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: queryValueAllowed) ?? value
    }
}
