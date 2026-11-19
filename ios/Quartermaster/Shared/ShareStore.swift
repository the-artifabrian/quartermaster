import Foundation
import Security

/// The handoff from the Share Extension to the app (iOS README, "Share
/// import"). Compiled into both targets.
///
/// The extension writes what was shared, a link or screenshots, into the App
/// Group container under a fresh random nonce, then opens
/// `quartermaster://import?share=<nonce>`. Only the app and its own extension
/// can reach that container, so a nonce that resolves means the share came
/// through Quartermaster's Share Extension, not from a site or another app
/// opening the URL scheme. The app takes each nonce once, and only within
/// `maxAge` of the share.
///
/// Layout: `Shares/<nonce>.json` is the record, written last; screenshots sit
/// in `Shares/<nonce>/1.jpg` … `n.jpg`, named by their count, never by
/// anything the record says. Removing the record is what uses a share up, and
/// the file system makes that happen once.
struct ShareStore {
    static let appGroup = "group.app.useqm.ios"
    /// How long after the share the app still takes it as one.
    static let maxAge: TimeInterval = 120
    /// A share stamped this far ahead of the clock still counts, for a clock
    /// that moved back between the extension writing and the app reading.
    static let clockSkew: TimeInterval = 5
    /// Screenshots in one import, as the import page takes them
    /// (`MAX_IMPORT_IMAGE_COUNT`).
    static let maxImages = 5
    /// Each screenshot's limit at the import (`MAX_IMPORT_IMAGE_SIZE`).
    static let maxImageBytes = 5 * 1024 * 1024

    enum Payload: Equatable {
        /// A link, as shared: an http(s) URL string.
        case link(String)
        /// JPEG screenshots, in the order they were shared.
        case images([Data])
    }

    enum Lookup: Equatable {
        /// A fresh share.
        case accepted(Payload)
        /// A share too old to import by itself: its link, or nil for
        /// screenshots, which are dropped.
        case expired(link: String?)
        /// No share under that nonce, or nothing usable in it.
        case missing
    }

    /// The record. Exactly one of `url` and `images` is set.
    struct Entry: Codable, Equatable {
        var url: String?
        /// How many screenshots sit in the share's folder.
        var images: Int?
        /// When it was shared, epoch seconds.
        var sharedAt: Double
    }

    let directory: URL

    /// The store in the App Group container, or nil when the container is not
    /// there (a build without the App Groups entitlement).
    static func inAppGroup(fileManager: FileManager = .default) -> ShareStore? {
        fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup).map {
            ShareStore(directory: $0.appending(path: "Shares", directoryHint: .isDirectory))
        }
    }

    // MARK: Rules

    /// 128 random bits as 32 lowercase hex characters, or nil when the system
    /// has no randomness to give.
    static func makeNonce() -> String? {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Exactly 32 lowercase hex characters. A nonce names a file, so nothing
    /// else, a `/` or `..` least of all, may reach the file system.
    static func isNonce(_ value: String) -> Bool {
        value.utf8.count == 32 && value.utf8.allSatisfy { (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }
    }

    /// An http or https URL with a host.
    static func isWebLink(_ value: String) -> Bool {
        guard let url = URL(string: value) else { return false }
        return ["http", "https"].contains(url.scheme?.lowercased()) && !(url.host() ?? "").isEmpty
    }

    /// A JPEG within the import's size limit.
    static func isImportableJPEG(_ data: Data) -> Bool {
        data.count >= 3 && data.count <= maxImageBytes && data.prefix(3) == Data([0xFF, 0xD8, 0xFF])
    }

    /// Whether a record shared at `sharedAt` is still fresh at `now`.
    static func isFresh(sharedAt: Double, now: Date) -> Bool {
        let age = now.timeIntervalSince1970 - sharedAt
        return age.isFinite && age <= maxAge && age >= -clockSkew
    }

    /// What kind of share a record is, if it is a well-formed one.
    enum Kind: Equatable {
        case link(String)
        case images(count: Int)
    }

    static func kind(of entry: Entry) -> Kind? {
        switch (entry.url, entry.images) {
        case (let url?, nil) where isWebLink(url):
            return .link(url)
        case (nil, let count?) where (1...maxImages).contains(count):
            return .images(count: count)
        default:
            return nil
        }
    }

    // MARK: Share Extension

    /// Stores a link under a new nonce and returns the nonce, or nil when it
    /// is not a web link or could not be written.
    func put(link: String, now: Date = Date()) -> String? {
        guard Self.isWebLink(link) else { return nil }
        return put(Entry(url: link, sharedAt: now.timeIntervalSince1970), images: [], now: now)
    }

    /// Stores screenshots under a new nonce and returns the nonce, or nil
    /// when there are none, too many, one is not an importable JPEG, or they
    /// could not be written.
    func put(images: [Data], now: Date = Date()) -> String? {
        guard (1...Self.maxImages).contains(images.count), images.allSatisfy(Self.isImportableJPEG) else {
            return nil
        }
        return put(Entry(images: images.count, sharedAt: now.timeIntervalSince1970), images: images, now: now)
    }

    /// The screenshots first, the record last, so the app never finds a
    /// record whose files are still being written.
    private func put(_ entry: Entry, images: [Data], now: Date) -> String? {
        guard let nonce = Self.makeNonce() else { return nil }
        let folder = imageFolder(for: nonce)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            prune(now: now)
            if !images.isEmpty {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
                for (index, image) in images.enumerated() {
                    try image.write(to: imageFile(index + 1, in: folder), options: .atomic)
                }
            }
            try JSONEncoder().encode(entry).write(to: record(for: nonce), options: .atomic)
            return nonce
        } catch {
            try? FileManager.default.removeItem(at: folder)
            return nil
        }
    }

    // MARK: App

    /// The share stored under `nonce`. The record is removed before anything
    /// else, whatever it holds, so a nonce works once; if it cannot be
    /// removed it is not used. The share's screenshots and any stale shares
    /// go too.
    func take(_ nonce: String, now: Date = Date()) -> Lookup {
        defer { prune(now: now) }
        guard Self.isNonce(nonce) else { return .missing }
        let record = record(for: nonce)
        let folder = imageFolder(for: nonce)
        defer { try? FileManager.default.removeItem(at: folder) }
        guard let data = try? Data(contentsOf: record) else { return .missing }
        guard (try? FileManager.default.removeItem(at: record)) != nil else { return .missing }
        guard let entry = try? JSONDecoder().decode(Entry.self, from: data), let kind = Self.kind(of: entry) else {
            return .missing
        }
        let fresh = Self.isFresh(sharedAt: entry.sharedAt, now: now)
        switch kind {
        case .link(let link):
            return fresh ? .accepted(.link(link)) : .expired(link: link)
        case .images(let count):
            guard fresh else { return .expired(link: nil) }
            var images: [Data] = []
            for index in 1...count {
                let file = imageFile(index, in: folder)
                // The size before the read, so an oversized file is never
                // loaded.
                guard
                    let size = (try? FileManager.default.attributesOfItem(atPath: file.path(percentEncoded: false)))?[.size]
                        as? Int,
                    size <= Self.maxImageBytes,
                    let image = try? Data(contentsOf: file),
                    Self.isImportableJPEG(image)
                else { return .missing }
                images.append(image)
            }
            return .accepted(.images(images))
        }
    }

    /// Removes everything that is not part of a fresh share: old records,
    /// unreadable ones, folders without a fresh record, and anything not
    /// named like a nonce.
    func prune(now: Date = Date()) {
        let fileManager = FileManager.default
        guard let names = try? fileManager.contentsOfDirectory(atPath: directory.path(percentEncoded: false)) else {
            return
        }
        let freshNonces = Set(names.compactMap { name -> String? in
            guard name.hasSuffix(".json") else { return nil }
            let nonce = String(name.dropLast(5))
            guard
                Self.isNonce(nonce),
                let data = try? Data(contentsOf: directory.appending(path: name)),
                let entry = try? JSONDecoder().decode(Entry.self, from: data),
                Self.kind(of: entry) != nil,
                Self.isFresh(sharedAt: entry.sharedAt, now: now)
            else { return nil }
            return nonce
        })
        for name in names {
            let nonce = name.hasSuffix(".json") ? String(name.dropLast(5)) : name
            if freshNonces.contains(nonce) { continue }
            try? fileManager.removeItem(at: directory.appending(path: name))
        }
    }

    private func record(for nonce: String) -> URL {
        directory.appending(path: "\(nonce).json")
    }

    private func imageFolder(for nonce: String) -> URL {
        directory.appending(path: nonce, directoryHint: .isDirectory)
    }

    private func imageFile(_ index: Int, in folder: URL) -> URL {
        folder.appending(path: "\(index).jpg")
    }
}
