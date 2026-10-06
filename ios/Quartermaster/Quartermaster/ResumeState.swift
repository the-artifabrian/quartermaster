import Foundation

/// The page a cold start reopens: the app page that was showing when the app
/// last went to the background. iOS ends a backgrounded app whenever it wants
/// the memory, and starting over on the start page would lose the user's
/// place.
struct ResumeState {
    static let defaultsKey = "QMResumePage"

    /// Pages for signing up, in or out, plus the household invite, which
    /// carries a one-time token. Reopening one would replay a step that is
    /// over. A path matches itself and anything below it.
    static let excludedPaths = [
        "/login", "/logout", "/signup", "/verify", "/onboarding",
        "/forgot-password", "/reset-password", "/auth", "/webauthn",
        "/household/join",
    ]

    let links: LinkPolicy
    var defaults: UserDefaults = .standard

    /// Remembers `url`, or forgets the saved page when `url` should not be
    /// reopened, so leaving from the login page does not resume an older one.
    func save(_ url: URL) {
        if isResumable(url) {
            defaults.set(url.absoluteString, forKey: Self.defaultsKey)
        } else {
            defaults.removeObject(forKey: Self.defaultsKey)
        }
    }

    /// The saved page, if it still passes: the base URL can change between
    /// launches in Debug builds.
    func page() -> URL? {
        guard
            let saved = defaults.string(forKey: Self.defaultsKey),
            let url = URL(string: saved),
            isResumable(url)
        else { return nil }
        return url
    }

    func isResumable(_ url: URL) -> Bool {
        guard links.isAppPage(url) else { return false }
        let path = url.path().lowercased()
        return !Self.excludedPaths.contains { path == $0 || path.hasPrefix($0 + "/") }
    }
}
