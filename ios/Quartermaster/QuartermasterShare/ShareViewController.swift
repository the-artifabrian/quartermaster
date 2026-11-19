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

    /// The URL that opens the app, and the nonce of the share stored for it,
    /// if one was.
    private struct Handoff {
        let url: URL
        let nonce: String?
    }

    /// Why a share could not be handed over, as the alert says it.
    private enum Failure: Error {
        case unreadableImage
        case imageTooLarge
        case imageNotArrived
        case appUnavailable

        var title: String {
            switch self {
            case .unreadableImage: return "Couldn’t read that image"
            case .imageTooLarge: return "That image is too large to read"
            case .imageNotArrived: return "Couldn’t get that image"
            case .appUnavailable: return "Couldn’t open Quartermaster"
            }
        }

        var message: String {
            switch self {
            case .unreadableImage: return "Share a screenshot or a photo."
            case .imageTooLarge: return "Share a smaller screenshot, or one screen of it at a time."
            case .imageNotArrived: return "If it’s in iCloud, open it in Photos first, then share it again."
            case .appUnavailable: return "Open Quartermaster and import it from there."
            }
        }
    }

    private func share() async {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let images = Self.imageProviders(in: providers)
        let attached = await Self.attachedLink(in: providers)
        let handoff: Handoff
        if SharePick.prefersImages(attachedLink: attached, imageCount: images.count) {
            guard let store = ShareStore.inAppGroup() else { return fail(.appUnavailable) }
            let jpegs: [Data]
            switch await Self.jpegs(from: images, deadline: Date().addingTimeInterval(Self.imageDeadline)) {
            case .success(let encoded): jpegs = encoded
            case .failure(let failure): return fail(failure)
            }
            guard let nonce = store.put(images: jpegs), let url = Self.shareURL(nonce: nonce) else {
                return fail(.appUnavailable)
            }
            handoff = Handoff(url: url, nonce: nonce)
        } else if let link = attached {
            guard let linkHandoff = Self.handoff(for: link) else { return fail(.appUnavailable) }
            handoff = linkHandoff
        } else if let link = await Self.linkInText(items: items, providers: providers) {
            guard let linkHandoff = Self.handoff(for: link) else { return fail(.appUnavailable) }
            handoff = linkHandoff
        } else {
            extensionContext?.cancelRequest(withError: NSError(
                domain: "app.useqm.ios.share", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Nothing to import"]))
            return
        }
        guard await openApp(handoff.url) else {
            // Nothing will take it, so it does not wait in the container.
            if let nonce = handoff.nonce { ShareStore.inAppGroup()?.discard(nonce) }
            return fail(.appUnavailable)
        }
        extensionContext?.completeRequest(returningItems: nil)
    }

    /// Says what went wrong, then closes the share sheet.
    private func fail(_ failure: Failure) {
        let alert = UIAlertController(title: failure.title, message: failure.message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.extensionContext?.cancelRequest(withError: NSError(
                domain: "app.useqm.ios.share", code: 2,
                userInfo: [NSLocalizedDescriptionKey: failure.title]))
        })
        present(alert, animated: true)
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
    /// nonce; when the App Group is not there or the write failed,
    /// `quartermaster://import?url=…`, which waits for a tap.
    private static func handoff(for link: URL) -> Handoff? {
        if let nonce = ShareStore.inAppGroup()?.put(link: link.absoluteString), let url = shareURL(nonce: nonce) {
            return Handoff(url: url, nonce: nonce)
        }
        return importURL(for: link).map { Handoff(url: $0, nonce: nil) }
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

    /// Each image as an importable JPEG, or why one could not be had: a
    /// Recipe from some of the screenshots could be missing half its steps,
    /// so it is all of them or none. One at a time, to stay inside the
    /// extension's memory limit, and all before `deadline`.
    private static func jpegs(from providers: [NSItemProvider], deadline: Date) async -> Result<[Data], Failure> {
        var images: [Data] = []
        for provider in providers {
            switch await jpeg(from: provider, deadline: deadline) {
            case .image(let image): images.append(image)
            case .unreadable: return .failure(.unreadableImage)
            case .tooLarge: return .failure(.imageTooLarge)
            case .timedOut: return .failure(.imageNotArrived)
            }
        }
        return .success(images)
    }

    /// How long all of a share's images may take to arrive and be encoded: an
    /// iCloud photo that is not on the phone downloads first, or never.
    static let imageDeadline: TimeInterval = 25

    private enum Loaded {
        case image(Data)
        case unreadable
        case tooLarge
        case timedOut

        init(_ outcome: SharedImageEncoder.Outcome) {
            switch outcome {
            case .jpeg(let data): self = .image(data)
            case .tooLarge: self = .tooLarge
            case .unreadable: self = .unreadable
            }
        }
    }

    /// The image as an importable JPEG. A file representation first, which
    /// ImageIO decodes at the target size; when the provider has no file,
    /// whatever it hands over itself: a file URL, data, or a UIImage (the
    /// screenshot editor). Each is decoded in the provider's completion
    /// handler, off the main thread. A file representation still loading at
    /// the deadline is cancelled and the share gives up, rather than asking
    /// again and restarting an iCloud download.
    private static func jpeg(from provider: NSItemProvider, deadline: Date) async -> Loaded {
        let fromFile: Loaded? = await withDeadline(deadline, timedOut: .timedOut) { finish in
            let progress = provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
                // The file is gone once this returns, so it is read here.
                finish(url.map { Loaded(SharedImageEncoder.encode(fileAt: $0)) })
            }
            return { progress.cancel() }
        }
        if let fromFile { return fromFile }
        return await withDeadline(deadline, timedOut: .timedOut) { finish in
            provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { item, _ in
                switch item {
                case let url as URL where url.isFileURL: finish(Loaded(SharedImageEncoder.encode(fileAt: url)))
                case let data as Data: finish(Loaded(SharedImageEncoder.encode(data: data)))
                case let image as UIImage: finish(Loaded(encode(image)))
                default: finish(.unreadable)
                }
            }
            return {}
        } ?? .unreadable
    }

    /// A UIImage the provider already decoded: drawn upright at the target
    /// size, never encoded at full size first.
    private static func encode(_ image: UIImage) -> SharedImageEncoder.Outcome {
        let width = Int((image.size.width * image.scale).rounded())
        let height = Int((image.size.height * image.scale).rounded())
        return SharedImageEncoder.encode(width: width, height: height) { targetWidth, targetHeight in
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let size = CGSize(width: targetWidth, height: targetHeight)
            return UIGraphicsImageRenderer(size: size, format: format).image { context in
                UIColor.white.setFill()
                context.fill(CGRect(origin: .zero, size: size))
                image.draw(in: CGRect(origin: .zero, size: size))
            }.cgImage
        }
    }

    /// Runs `start`, which calls `finish` once with its result (nil for
    /// nothing to give) and returns a way to cancel. At `deadline` the result
    /// is `timedOut` and `start` is cancelled. Whichever comes first wins.
    private static func withDeadline<T>(
        _ deadline: Date,
        timedOut: T,
        _ start: (_ finish: @escaping (T?) -> Void) -> () -> Void
    ) async -> T? {
        let remaining = deadline.timeIntervalSinceNow
        guard remaining > 0 else { return timedOut }
        return await withCheckedContinuation { (continuation: CheckedContinuation<T?, Never>) in
            let once = ResumeOnce(continuation)
            let cancel = start { once.resume($0) }
            DispatchQueue.global().asyncAfter(deadline: .now() + remaining) {
                if once.resume(timedOut) { cancel() }
            }
        }
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

/// Resumes a continuation once, from whichever thread gets there first.
private final class ResumeOnce<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Never>?

    init(_ continuation: CheckedContinuation<T, Never>) {
        self.continuation = continuation
    }

    /// True when this call resumed it.
    @discardableResult
    func resume(_ value: T) -> Bool {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(returning: value)
        return pending != nil
    }
}
