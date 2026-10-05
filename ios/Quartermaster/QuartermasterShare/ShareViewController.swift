import UIKit
import UniformTypeIdentifiers

/// Takes the link someone shares and opens it on the app's Recipe import page,
/// through `quartermaster://import?url=<encoded link>`. The app's
/// `IncomingURL` reads that URL; keep the two in step.
///
/// No network and no web view here: the app does the fetch.
final class ShareViewController: UIViewController {
    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    // The responder chain only reaches UIApplication once the view is in a
    // window, so the work starts on appear.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        Task { await share() }
    }

    private func share() async {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        guard let link = await Self.firstLink(in: items), let appURL = Self.importURL(for: link) else {
            extensionContext?.cancelRequest(withError: NSError(
                domain: "app.useqm.ios.share", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No link to import"]))
            return
        }
        await openApp(appURL)
        extensionContext?.completeRequest(returningItems: nil)
    }

    // MARK: Finding the link

    /// A URL attachment first (Safari, a Recipe site's share button), then a
    /// link inside shared text (Messages, Notes).
    private static func firstLink(in items: [NSExtensionItem]) async -> URL? {
        let providers = items.flatMap { $0.attachments ?? [] }

        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            let item = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier)
            let url = (item as? URL)
                ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
                ?? (item as? String).flatMap(URL.init(string:))
            if let url, isWebLink(url) { return url }
        }

        var texts = items.compactMap { $0.attributedContentText?.string }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let item = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
            if let text = (item as? String) ?? (item as? Data).flatMap({ String(data: $0, encoding: .utf8) }) {
                texts.insert(text, at: 0)
            }
        }
        return texts.lazy.compactMap(firstLink(inText:)).first
    }

    private static func firstLink(inText text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return nil
        }
        return detector.matches(in: text, range: NSRange(text.startIndex..., in: text))
            .lazy
            .compactMap(\.url)
            .first(where: isWebLink)
    }

    private static func isWebLink(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased()) && url.host() != nil
    }

    // MARK: Opening the app

    /// Only unreserved characters stay as they are, so `&`, `?`, `#` and `+`
    /// in the shared link survive the trip. Same set as the app's
    /// `IncomingURL.queryValueAllowed`.
    private static let queryValueAllowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private static func importURL(for link: URL) -> URL? {
        guard let value = link.absoluteString.addingPercentEncoding(withAllowedCharacters: queryValueAllowed) else {
            return nil
        }
        return URL(string: "quartermaster://import?url=\(value)")
    }

    /// A Share Extension has no supported way to open its app:
    /// `UIApplication.shared` and `open(_:options:)` are unavailable to
    /// extensions, and `NSExtensionContext.open` only works for Today and
    /// iMessage extensions. The extension process still has a UIApplication
    /// at the end of the responder chain, and calling its
    /// `open(_:options:completionHandler:)` through the Objective-C runtime
    /// opens the app. Undocumented but widely shipped (the Capacitor
    /// share-target plugins do this). The bare `openURL:` selector stopped
    /// working in iOS 18, so this calls the three-argument one.
    @discardableResult
    private func openApp(_ url: URL) async -> Bool {
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let current = responder {
            if current is UIApplication, current.responds(to: selector),
               let method = current.method(for: selector) {
                typealias Open = @convention(c) (
                    AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?
                ) -> Void
                let open = unsafeBitCast(method, to: Open.self)
                return await withCheckedContinuation { continuation in
                    open(current, selector, url as NSURL, NSDictionary()) { continuation.resume(returning: $0) }
                }
            }
            responder = current.next
        }
        return await extensionContext?.open(url) ?? false
    }
}
