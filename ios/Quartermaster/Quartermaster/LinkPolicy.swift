import Foundation

/// Decides where a URL the page navigates to should open.
struct LinkPolicy {
    enum Destination: Equatable {
        /// Stays in the web view.
        case webView
        /// Another site: shown in an in-app Safari sheet.
        case safari
        /// Handed to iOS (Mail, Phone, Messages).
        case system
        /// Dropped.
        case ignore
    }

    /// The app's own host, lowercased.
    let host: String

    func destination(for url: URL) -> Destination {
        switch url.scheme?.lowercased() {
        case "http", "https":
            return isAppHost(url.host()) ? .webView : .safari
        case "mailto", "tel", "sms":
            return .system
        case "about", "blob", "data":
            return .webView
        default:
            return .ignore
        }
    }

    func isAppHost(_ candidate: String?) -> Bool {
        candidate?.lowercased() == host
    }

    /// A page of the Web app: http(s) on the app's host.
    func isAppPage(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased()) && isAppHost(url.host())
    }
}
