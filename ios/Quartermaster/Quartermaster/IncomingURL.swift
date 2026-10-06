import Foundation

/// Turns a URL the app was opened with into the page the web view loads.
///
/// Two kinds arrive:
/// - `quartermaster://import?url=<percent-encoded http(s) URL>`, from the
///   Share Extension, opens the Recipe import page with that URL, which starts
///   the fetch.
/// - A universal link (`https://useqm.app/…`) loads as it is.
///
/// Anything else gives nil and is ignored.
enum IncomingURL {
    static let scheme = "quartermaster"
    static let importPath = "/recipes/import"

    static func page(for url: URL, baseURL: URL) -> URL? {
        switch url.scheme?.lowercased() {
        case scheme:
            return importPage(for: url, baseURL: baseURL)
        case "http", "https":
            return LinkPolicy(host: baseURL.host()?.lowercased() ?? "").isAppPage(url) ? url : nil
        default:
            return nil
        }
    }

    private static func importPage(for url: URL, baseURL: URL) -> URL? {
        guard
            url.host()?.lowercased() == "import",
            url.path().isEmpty || url.path() == "/",
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let shared = components.queryItems?.first(where: { $0.name == "url" })?.value,
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
