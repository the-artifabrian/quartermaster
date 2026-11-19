import UIKit
import UniformTypeIdentifiers

/// Takes the link or screenshots someone shares and opens them on the app's
/// Recipe import page. They go into the App Group under a fresh nonce
/// (`ShareStore`) and the app opens through
/// `quartermaster://import?share=<nonce>`, which tells it the share came from
/// here, so it imports at once. Without the App Group a link falls back to
/// `quartermaster://import?url=<encoded link>`, which waits for a tap, and
/// screenshots cancel. The app's `IncomingURL` reads both URLs; keep them in
/// step.
///
/// One share carries one thing: a URL attachment (Safari, a site's share
/// button) wins, then images (Photos, the screenshot editor), then a link
/// found in shared text (Messages, Notes). A social app that shares a
/// screenshot with a caption holding a link imports the screenshot.
///
/// No network and no web view here: the app does the fetch, and the page's
/// image import reads the screenshots.
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
        let providers = items.flatMap { $0.attachments ?? [] }
        let images = Self.imageProviders(in: providers)
        let appURL: URL?
        if let link = await Self.attachedLink(in: providers) {
            appURL = Self.shareURL(for: link) ?? Self.importURL(for: link)
        } else if !images.isEmpty {
            appURL = await Self.shareURL(forImages: images)
        } else if let link = await Self.linkInText(items: items, providers: providers) {
            appURL = Self.shareURL(for: link) ?? Self.importURL(for: link)
        } else {
            appURL = nil
        }
        guard let appURL else {
            extensionContext?.cancelRequest(withError: NSError(
                domain: "app.useqm.ios.share", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Nothing to import"]))
            return
        }
        await openApp(appURL)
        extensionContext?.completeRequest(returningItems: nil)
    }

    // MARK: Finding the link

    /// A web URL attachment (Safari, a Recipe site's share button). A file
    /// URL, such as a photo's, is not one.
    private static func attachedLink(in providers: [NSItemProvider]) async -> URL? {
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            let item = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier)
            let url = (item as? URL)
                ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
                ?? (item as? String).flatMap(URL.init(string:))
            if let url, isWebLink(url) { return url }
        }
        return nil
    }

    /// A link inside shared text (Messages, Notes).
    private static func linkInText(items: [NSExtensionItem], providers: [NSItemProvider]) async -> URL? {
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

    /// `quartermaster://import?share=<nonce>`, with the link stored under the
    /// nonce, or nil when the App Group is not there or the write failed.
    private static func shareURL(for link: URL) -> URL? {
        ShareStore.inAppGroup()?.put(link: link.absoluteString).flatMap(shareURL(nonce:))
    }

    private static func shareURL(nonce: String) -> URL? {
        URL(string: "quartermaster://import?share=\(nonce)")
    }

    // MARK: Screenshots

    /// Image attachments, at most as many as one import takes (the activation
    /// rule already stops at that many).
    private static func imageProviders(in providers: [NSItemProvider]) -> [NSItemProvider] {
        Array(providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
            .prefix(ShareStore.maxImages))
    }

    /// `quartermaster://import?share=<nonce>` with the screenshots stored
    /// under the nonce, or nil when one cannot be read or the App Group is not
    /// there: a Recipe from some of the screenshots could be missing half its
    /// steps, so it is all of them or none.
    private static func shareURL(forImages providers: [NSItemProvider]) async -> URL? {
        guard let store = ShareStore.inAppGroup() else { return nil }
        var images: [Data] = []
        // One at a time, to stay inside the extension's memory limit.
        for provider in providers {
            guard let image = await jpeg(from: provider) else { return nil }
            images.append(image)
        }
        return store.put(images: images).flatMap(shareURL(nonce:))
    }

    /// The image as an importable JPEG. A file representation first, which
    /// ImageIO decodes at the target size; then whatever the provider hands
    /// over itself: a file URL, data, or a UIImage (the screenshot editor).
    private static func jpeg(from provider: NSItemProvider) async -> Data? {
        let fromFile: Data? = await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
                // The file is gone once this returns, so it is read here.
                continuation.resume(returning: url.flatMap(SharedImageEncoder.jpeg(fromFile:)))
            }
        }
        if let fromFile { return fromFile }
        let item = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier)
        if let url = item as? URL, url.isFileURL { return SharedImageEncoder.jpeg(fromFile: url) }
        if let data = item as? Data { return SharedImageEncoder.jpeg(fromData: data) }
        if let image = item as? UIImage, let data = image.jpegData(compressionQuality: 1) {
            return SharedImageEncoder.jpeg(fromData: data)
        }
        return nil
    }

    /// The fallback, which the app opens waiting for a tap.
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
