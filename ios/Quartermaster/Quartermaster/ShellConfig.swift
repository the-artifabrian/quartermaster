import Foundation

/// Where the shell points and how it identifies itself.
///
/// The base URL comes from the `QMBaseURL` Info.plist key, which the
/// `QM_BASE_URL` build setting fills in. Debug builds also read a
/// `-QMBaseURL <url>` launch argument, so the app can point at a local server
/// or an unreachable host without a rebuild, and a `-QMStartPath </path>`
/// argument, so a screenshot run can open any page.
struct ShellConfig {
    /// Appended to WebKit's own user agent suffix. The server looks for it to
    /// hide Pro and Google sign-in.
    static let userAgentToken = "QuartermasterShell/1"

    /// The manifest's `start_url`.
    static let defaultStartPath = "/plan"

    /// Swipe from the screen edge to go back or forward. WebKit slides
    /// between snapshots of whole documents, and the app is one document, so
    /// after in-app navigations the page under the swipe can be stale or
    /// blank. Set to false to drop the gesture.
    static let allowsBackSwipe = true

    let baseURL: URL
    let appBoundDomains: Set<String>
    let startPath: String

    var host: String { baseURL.host()?.lowercased() ?? "" }

    var startURL: URL { baseURL.appending(path: startPath) }

    /// App-bound limits are what let the service worker run, but with them on
    /// WebKit refuses any host missing from `WKAppBoundDomains`. A base URL
    /// pointing elsewhere (a local server) runs without them.
    var limitsNavigationsToAppBoundDomains: Bool { appBoundDomains.contains(host) }

    static func load(bundle: Bundle = .main) -> ShellConfig {
        var configured = bundle.object(forInfoDictionaryKey: "QMBaseURL") as? String
        #if DEBUG
        if let override = UserDefaults.standard.string(forKey: "QMBaseURL") {
            configured = override
        }
        #endif
        let fallback = URL(string: "https://useqm.app")!
        let baseURL = configured.flatMap(URL.init(string:)).flatMap { url in
            ["http", "https"].contains(url.scheme?.lowercased()) && url.host() != nil ? url : nil
        } ?? fallback

        var startPath = Self.defaultStartPath
        #if DEBUG
        if let override = UserDefaults.standard.string(forKey: "QMStartPath"),
           override.hasPrefix("/"), !override.hasPrefix("//")
        {
            startPath = override
        }
        #endif

        let domains = bundle.object(forInfoDictionaryKey: "WKAppBoundDomains") as? [String] ?? []
        return ShellConfig(
            baseURL: baseURL, appBoundDomains: Set(domains.map { $0.lowercased() }), startPath: startPath)
    }
}
