import Foundation
import Security

/// The handoff from the Share Extension to the app (iOS README, "Share
/// import"). Compiled into both targets.
///
/// The extension writes the shared link into the App Group container under a
/// fresh random nonce, then opens `quartermaster://import?share=<nonce>`.
/// Only the app and its own extension can reach that container, so a nonce
/// that resolves means the share came through Quartermaster's Share
/// Extension, not from a site or another app opening the URL scheme. The app
/// takes each nonce once, and only within `maxAge` of the share.
///
/// One JSON file per nonce, `SharedLinks/<nonce>.json`: removing the file is
/// what uses a share up, and the file system makes that happen once.
struct SharedLinkStore {
    static let appGroup = "group.app.useqm.ios"
    /// How long after the share the app still takes it as one.
    static let maxAge: TimeInterval = 120
    /// A share stamped this far ahead of the clock still counts, for a clock
    /// that moved back between the extension writing and the app reading.
    static let clockSkew: TimeInterval = 5

    enum Lookup: Equatable {
        /// A fresh share of this link.
        case accepted(String)
        /// A share of this link, but too old to import by itself.
        case expired(String)
        /// No share under that nonce, or nothing usable in it.
        case missing
    }

    struct Entry: Codable, Equatable {
        /// The link as shared, an http(s) URL string.
        let url: String
        /// When it was shared, epoch seconds.
        let sharedAt: Double
    }

    let directory: URL

    /// The store in the App Group container, or nil when the container is not
    /// there (a build without the App Groups entitlement).
    static func inAppGroup(fileManager: FileManager = .default) -> SharedLinkStore? {
        fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup).map {
            SharedLinkStore(directory: $0.appending(path: "SharedLinks", directoryHint: .isDirectory))
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

    /// What a stored entry amounts to at `now`.
    static func judge(_ entry: Entry, now: Date) -> Lookup {
        guard isWebLink(entry.url) else { return .missing }
        let age = now.timeIntervalSince1970 - entry.sharedAt
        guard age.isFinite, age <= maxAge, age >= -clockSkew else { return .expired(entry.url) }
        return .accepted(entry.url)
    }

    // MARK: Share Extension

    /// Stores `link` under a new nonce and returns the nonce, or nil when it
    /// is not a web link or could not be written.
    func put(_ link: String, now: Date = Date()) -> String? {
        guard Self.isWebLink(link), let nonce = Self.makeNonce() else { return nil }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            prune(now: now)
            let data = try JSONEncoder().encode(Entry(url: link, sharedAt: now.timeIntervalSince1970))
            try data.write(to: file(for: nonce), options: .atomic)
            return nonce
        } catch {
            return nil
        }
    }

    // MARK: App

    /// The share stored under `nonce`. The entry is removed before anything
    /// else, whatever it holds, so a nonce works once; if it cannot be
    /// removed it is not used. Stale entries go too.
    func take(_ nonce: String, now: Date = Date()) -> Lookup {
        defer { prune(now: now) }
        guard Self.isNonce(nonce) else { return .missing }
        let file = file(for: nonce)
        guard let data = try? Data(contentsOf: file) else { return .missing }
        guard (try? FileManager.default.removeItem(at: file)) != nil else { return .missing }
        guard let entry = try? JSONDecoder().decode(Entry.self, from: data) else { return .missing }
        return Self.judge(entry, now: now)
    }

    /// Removes every file that is not a fresh share: old ones, unreadable
    /// ones, and anything not named like a nonce.
    func prune(now: Date = Date()) {
        let fileManager = FileManager.default
        guard let names = try? fileManager.contentsOfDirectory(atPath: directory.path(percentEncoded: false)) else { return }
        for name in names {
            let file = directory.appending(path: name)
            if name.hasSuffix(".json"), Self.isNonce(String(name.dropLast(5))),
               let data = try? Data(contentsOf: file),
               let entry = try? JSONDecoder().decode(Entry.self, from: data),
               case .accepted = Self.judge(entry, now: now)
            {
                continue
            }
            try? fileManager.removeItem(at: file)
        }
    }

    private func file(for nonce: String) -> URL {
        directory.appending(path: "\(nonce).json")
    }
}
