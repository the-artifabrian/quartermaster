// Checks for the share handoff's pure parts (ShareStore, ShareIntent,
// IncomingURL, SharedImageEncoder) and the Share Extension's activation rule.
// There is no Xcode test target; this compiles the sources with them and runs
// on the Mac (ios/README.md, "Share import"):
//
//   cd ios/Quartermaster
//   xcrun swiftc -o /tmp/share-checks Shared/ShareStore.swift \
//     Quartermaster/ShareIntent.swift Quartermaster/IncomingURL.swift \
//     Quartermaster/LinkPolicy.swift QuartermasterShare/SharedImageEncoder.swift \
//     QuartermasterShare/SharePick.swift ../checks/share/main.swift
//   /tmp/share-checks QuartermasterShare/Info.plist

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

var failures = 0
func check(_ ok: Bool, _ name: String, line: Int = #line) {
    if ok { print("ok   \(name)") } else { failures += 1; print("FAIL \(name) (line \(line))") }
}

let base = URL(string: "https://useqm.app")!
let links = LinkPolicy(host: "useqm.app")
let link = "https://example.com/recipe?a=1&b=2+3#step-2"

// Nonce format
let nonce = ShareStore.makeNonce()!
check(ShareStore.isNonce(nonce), "fresh nonce is 32 lowercase hex")
check(ShareStore.makeNonce() != nonce, "two nonces differ")
check(!ShareStore.isNonce("../../etc/passwd0000000000000000"), "path traversal is not a nonce")
check(!ShareStore.isNonce(nonce.uppercased()), "uppercase is not a nonce")
check(!ShareStore.isNonce(String(nonce.dropLast())), "31 chars is not a nonce")
check(!ShareStore.isNonce(nonce + "0"), "33 chars is not a nonce")
check(!ShareStore.isNonce(""), "empty is not a nonce")

// Store rules
let now = Date(timeIntervalSince1970: 1_800_000_000)
check(ShareStore.isFresh(sharedAt: now.timeIntervalSince1970 - 120, now: now), "share at 2 min fresh")
check(!ShareStore.isFresh(sharedAt: now.timeIntervalSince1970 - 121, now: now), "share past 2 min stale")
check(!ShareStore.isFresh(sharedAt: now.timeIntervalSince1970 + 60, now: now), "share from the future stale")
check(ShareStore.isFresh(sharedAt: now.timeIntervalSince1970 + 3, now: now), "small clock skew fresh")
check(!ShareStore.isFresh(sharedAt: .nan, now: now), "NaN timestamp stale")
check(ShareStore.kind(of: .init(url: link, sharedAt: 0)) == .link(link), "link record")
check(ShareStore.kind(of: .init(url: "javascript:alert(1)", sharedAt: 0)) == nil, "javascript: record refused")
check(ShareStore.kind(of: .init(url: "file:///etc/passwd", sharedAt: 0)) == nil, "file: record refused")
check(ShareStore.kind(of: .init(url: "https://", sharedAt: 0)) == nil, "hostless record refused")
check(ShareStore.kind(of: .init(images: 3, sharedAt: 0)) == .images(count: 3), "images record")
check(ShareStore.kind(of: .init(images: 0, sharedAt: 0)) == nil, "zero images refused")
check(ShareStore.kind(of: .init(images: 6, sharedAt: 0)) == nil, "six images refused")
check(ShareStore.kind(of: .init(url: link, images: 1, sharedAt: 0)) == nil, "record with both refused")
check(ShareStore.kind(of: .init(sharedAt: 0)) == nil, "empty record refused")
let jpegBytes = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
check(ShareStore.isImportableJPEG(jpegBytes), "JPEG magic accepted")
check(!ShareStore.isImportableJPEG(Data([0x89, 0x50, 0x4E, 0x47])), "PNG refused")
check(!ShareStore.isImportableJPEG(Data([0xFF, 0xD8, 0xFF]) + Data(count: ShareStore.maxImageBytes)), "over 5 MB refused")

// Store round trip
let dir = FileManager.default.temporaryDirectory.appending(path: "qm-store-\(UUID().uuidString)")
let store = ShareStore(directory: dir)
func names() -> Set<String> { Set((try? FileManager.default.contentsOfDirectory(atPath: dir.path(percentEncoded: false))) ?? []) }
let n1 = store.put(link: link, now: now)!
check(store.take(n1, now: now.addingTimeInterval(5)) == .accepted(.link(link)), "take returns the link")
check(store.take(n1, now: now.addingTimeInterval(6)) == .missing, "second take finds nothing (single use)")
let n2 = store.put(link: link, now: now)!
check(store.take(n2, now: now.addingTimeInterval(200)) == .expired(link: link), "late take is expired")
check(store.take(n2, now: now.addingTimeInterval(201)) == .missing, "expired entry is gone after take")
check(store.put(link: "javascript:alert(1)", now: now) == nil, "put refuses a non-web link")
// Images
let img1 = jpegBytes + Data("one".utf8), img2 = jpegBytes + Data("two".utf8)
let n3 = store.put(images: [img1, img2], now: now)!
check(names().contains(n3) && names().contains("\(n3).json"), "images stored as folder and record")
check(store.take(n3, now: now.addingTimeInterval(1)) == .accepted(.images([img1, img2])), "take returns the images in order")
check(!names().contains(n3) && !names().contains("\(n3).json"), "images and record removed after take")
check(store.take(n3, now: now.addingTimeInterval(2)) == .missing, "images taken once")
check(store.put(images: [], now: now) == nil, "no images refused")
check(store.put(images: Array(repeating: img1, count: 6), now: now) == nil, "six images refused")
check(store.put(images: [Data([0x89, 0x50])], now: now) == nil, "non-JPEG refused")
let n4 = store.put(images: [img1], now: now)!
check(store.take(n4, now: now.addingTimeInterval(500)) == .expired(link: nil), "late images expired, no link")
check(!names().contains(n4), "expired images removed")
// A record whose image file was swapped for something else
let n5 = store.put(images: [img1], now: now)!
try! Data([0x89, 0x50, 0x4E, 0x47]).write(to: dir.appending(path: "\(n5)/1.jpg"))
check(store.take(n5, now: now.addingTimeInterval(1)) == .missing, "tampered image refused")
check(!names().contains(n5), "tampered share removed")
// A record claiming more images than exist
let n6 = store.put(images: [img1], now: now)!
try! JSONEncoder().encode(ShareStore.Entry(images: 2, sharedAt: now.timeIntervalSince1970)).write(to: dir.appending(path: "\(n6).json"))
check(store.take(n6, now: now.addingTimeInterval(1)) == .missing, "missing image file refused")
// An oversized screenshot is refused by its size, never read
var reads: [String] = []
var watched = ShareStore(directory: dir)
watched.readFile = { url in reads.append(url.lastPathComponent); return try? Data(contentsOf: url) }
let n7 = watched.put(images: [img1, img2], now: now)!
let oversized = Data([0xFF, 0xD8, 0xFF]) + Data(count: ShareStore.maxImageBytes)
try! oversized.write(to: dir.appending(path: "\(n7)/2.jpg"))
check(watched.take(n7, now: now.addingTimeInterval(1)) == .missing, "oversized screenshot refuses the share")
check(reads == ["1.jpg"], "oversized screenshot never read (read: \(reads))")
// Discarding a share the app never took
let n8 = store.put(images: [img1], now: now)!
store.discard(n8)
check(!names().contains(n8) && !names().contains("\(n8).json"), "discard removes record and folder")
store.discard("../..")
check(FileManager.default.fileExists(atPath: dir.path(percentEncoded: false)), "discard ignores a non-nonce")

// Pruning
let stale = store.put(images: [img1], now: now)!
try! "junk".write(to: dir.appending(path: "notes.txt"), atomically: true, encoding: .utf8)
try! FileManager.default.createDirectory(at: dir.appending(path: "0123456789abcdef0123456789abcdef"), withIntermediateDirectories: true)
let fresh = store.put(link: link, now: now.addingTimeInterval(300))!  // put prunes
check(!names().contains("\(stale).json") && !names().contains(stale), "put prunes a stale share and its folder")
check(!names().contains("notes.txt"), "put prunes a stray file")
check(!names().contains("0123456789abcdef0123456789abcdef"), "put prunes a folder without a record")
check(names().contains("\(fresh).json"), "put keeps the fresh share")
check(store.take("../\(fresh)", now: now.addingTimeInterval(301)) == .missing, "take refuses a non-nonce")
check(store.take(fresh, now: now.addingTimeInterval(301)) == .accepted(.link(link)), "fresh share still taken after a refused lookup")

// IncomingURL
func dest(_ s: String) -> IncomingURL.Destination? { IncomingURL.destination(for: URL(string: s)!, baseURL: base) }
check(dest("quartermaster://import?share=\(nonce)") == .share(nonce: nonce), "share URL gives its nonce")
check(dest("quartermaster://import?share=\(nonce)&url=https%3A%2F%2Fevil.example") == .share(nonce: nonce), "share wins over url")
let legacy = dest("quartermaster://import?url=" + IncomingURL.encodeQueryValue(link))
check(legacy == .page(URL(string: "https://useqm.app/recipes/import?url=" + IncomingURL.encodeQueryValue(link))!), "legacy url still opens the import page")
check(dest("quartermaster://import?url=javascript%3Aalert(1)") == nil, "legacy javascript: ignored")
check(dest("quartermaster://other?share=\(nonce)") == nil, "other host ignored")
check(dest("quartermaster://import/x?share=\(nonce)") == nil, "other path ignored")
check(dest("https://useqm.app/recipes") == .page(URL(string: "https://useqm.app/recipes")!), "universal link loads as is")
check(dest("https://evil.example/recipes") == nil, "other host universal link ignored")

let accepted = IncomingURL.sharedImport(.accepted(.link(link)), baseURL: base)
check(accepted.intent?.payload == .link(link), "accepted share carries its intent")
check(accepted.page.absoluteString == "https://useqm.app/recipes/import?url=" + IncomingURL.encodeQueryValue(link), "accepted share opens its import page")
let expired = IncomingURL.sharedImport(.expired(link: link), baseURL: base)
check(expired.intent == nil && expired.page == accepted.page, "expired share opens the same page, no intent")
let missing = IncomingURL.sharedImport(.missing, baseURL: base)
check(missing.intent == nil && missing.page.absoluteString == "https://useqm.app/recipes/import", "missing share opens the empty import page")

// ShareIntent
let shotsShare = IncomingURL.sharedImport(.accepted(.images([img1])), baseURL: base)
check(shotsShare.page.absoluteString == "https://useqm.app/recipes/import" && shotsShare.intent?.payload == .images([img1]), "images open the plain import page with their intent")
check(IncomingURL.sharedImport(.expired(link: nil), baseURL: base).intent == nil, "expired images open the plain page, no intent")
let intent = ShareIntent(.link(link), now: now)
let shots = ShareIntent(.images([img1]), now: now)
check(shots.matches(URL(string: "https://useqm.app/recipes/import")!, links: links), "images intent matches the plain import page")
check(!shots.matches(accepted.page, links: links), "images intent refuses a page offering a link")
check(!shots.matches(URL(string: "https://useqm.app/recipes")!, links: links), "images intent refuses another page")
check(!shots.matches(URL(string: "https://evil.example/recipes/import")!, links: links), "images intent refuses another host")
let shotArgs = shots.arguments(baseURL: base)["images"] as! [[String: String]]
check(shotArgs.count == 1 && shotArgs[0]["data"] == img1.base64EncodedString() && shotArgs[0]["type"] == "image/jpeg", "images go as base64 arguments")
check(shots.script == ShareIntent.imagesScript && intent.script == ShareIntent.linkScript, "each kind runs its own script")
check(intent.matches(accepted.page, links: links), "intent matches its import page")
check(!intent.matches(URL(string: "https://useqm.app/recipes/import?url=https%3A%2F%2Fother.example")!, links: links), "intent refuses another link")
check(!intent.matches(URL(string: "https://useqm.app/login?redirectTo=" + IncomingURL.encodeQueryValue("/recipes/import?url=" + IncomingURL.encodeQueryValue(link)))!, links: links), "intent refuses the login page")
check(!intent.matches(URL(string: "https://evil.example/recipes/import?url=" + IncomingURL.encodeQueryValue(link))!, links: links), "intent refuses another host")
check(!intent.matches(URL(string: "https://useqm.app/recipes/import")!, links: links), "intent refuses the empty import page")
// After a sign-in the server rebuilds the query with URLSearchParams (a different encoding of the same value).
let reencoded = "https://useqm.app/recipes/import?url=" + link.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*-._"))!
check(intent.matches(URL(string: reencoded)!, links: links), "intent matches the same link encoded differently")
check(!intent.isExpired(now: now.addingTimeInterval(299)), "intent alive before 5 min")
check(intent.isExpired(now: now.addingTimeInterval(300)), "intent expired at 5 min")
check(ShareIntent.origin(of: base) == "https://useqm.app", "origin of the base URL")
check(ShareIntent.origin(of: URL(string: "http://localhost:3000")!) == "http://localhost:3000", "origin keeps a non-default port")
check(ShareIntent.origin(of: URL(string: "https://useqm.app:443")!) == "https://useqm.app", "origin drops the default port")
check(!ShareIntent.linkScript.contains(link), "script source never holds the link")

try? FileManager.default.removeItem(at: dir)

// Image encoder: a large PNG, a HEIC, a rotated JPEG
func makeImage(width: Int, height: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    for y in stride(from: 0, to: height, by: 16) {
        for x in stride(from: 0, to: width, by: 16) {
            ctx.setFillColor(CGColor(red: CGFloat(x % 255) / 255, green: CGFloat(y % 255) / 255, blue: CGFloat((x ^ y) % 255) / 255, alpha: 1))
            ctx.fill(CGRect(x: x, y: y, width: 16, height: 16))
        }
    }
    return ctx.makeImage()!
}
func encode(_ image: CGImage, type: UTType, orientation: Int? = nil) -> Data {
    let data = NSMutableData()
    let dest = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil)!
    var props: [CFString: Any] = [:]
    if let orientation { props[kCGImagePropertyOrientation] = orientation }
    CGImageDestinationAddImage(dest, image, props as CFDictionary)
    precondition(CGImageDestinationFinalize(dest))
    return data as Data
}
func size(of jpeg: Data) -> (Int, Int) {
    let src = CGImageSourceCreateWithData(jpeg as CFData, nil)!
    let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as! [CFString: Any]
    return (p[kCGImagePropertyPixelWidth] as! Int, p[kCGImagePropertyPixelHeight] as! Int)
}
let screenshot = encode(makeImage(width: 1179, height: 2556), type: .png)
let fromPNG = SharedImageEncoder.jpeg(fromData: screenshot)!
check(ShareStore.isImportableJPEG(fromPNG) && fromPNG.count <= SharedImageEncoder.byteBudget, "PNG screenshot becomes an importable JPEG within budget")
let (w1, h1) = size(of: fromPNG)
check(max(w1, h1) == 1568 && abs(Double(w1) / Double(h1) - 1179.0 / 2556.0) < 0.01, "screenshot scaled to a 1568 edge, aspect kept (\(w1)x\(h1))")
let heic = encode(makeImage(width: 4032, height: 3024), type: .heic)
let fromHEIC = SharedImageEncoder.jpeg(fromData: heic)
check(fromHEIC.map(ShareStore.isImportableJPEG) == true, "HEIC photo becomes an importable JPEG")
if let fromHEIC { let (w, h) = size(of: fromHEIC); check(max(w, h) <= 1568, "HEIC scaled down (\(w)x\(h))") }
let rotated = encode(makeImage(width: 400, height: 200), type: .jpeg, orientation: 6)
let (w2, h2) = size(of: SharedImageEncoder.jpeg(fromData: rotated)!)
check(w2 == 200 && h2 == 400, "EXIF orientation applied (\(w2)x\(h2))")
let small = encode(makeImage(width: 300, height: 600), type: .png)
let (w3, h3) = size(of: SharedImageEncoder.jpeg(fromData: small)!)
check(w3 == 300 && h3 == 600, "small image not enlarged (\(w3)x\(h3))")
check(SharedImageEncoder.jpeg(fromData: Data("not an image".utf8)) == nil, "garbage gives nil")
let tmp = FileManager.default.temporaryDirectory.appending(path: "shot-\(UUID().uuidString).png")
try! screenshot.write(to: tmp)
check(SharedImageEncoder.jpeg(fromFile: tmp).map(ShareStore.isImportableJPEG) == true, "file representation encodes")
try? FileManager.default.removeItem(at: tmp)

// Encoder limits, read from the header before decoding
check(SharedImageEncoder.fits(width: 8064, height: 6048, type: "public.heic"), "48 MP HEIC fits")
check(!SharedImageEncoder.fits(width: 12000, height: 9000, type: "public.jpeg"), "108 MP JPEG refused")
check(SharedImageEncoder.fits(width: 1179, height: 2556, type: "public.png"), "screenshot PNG fits")
check(!SharedImageEncoder.fits(width: 4100, height: 4100, type: "public.png"), "17 MP PNG refused")
check(!SharedImageEncoder.fits(width: 8064, height: 6048, type: "com.adobe.raw-image"), "48 MP RAW refused")
check(!SharedImageEncoder.fits(width: Int.max, height: 2, type: "public.jpeg"), "overflowing size refused")
check(!SharedImageEncoder.fits(width: 0, height: 10, type: "public.png"), "empty size refused")
let hugePNG = encode(makeImage(width: 4100, height: 4100), type: .png)
check(SharedImageEncoder.jpeg(fromData: hugePNG) == nil, "17 MP PNG never decoded")
check(SharedImageEncoder.jpeg(fromData: Data(count: SharedImageEncoder.maxSourceBytes + 1)) == nil, "data over 64 MB refused")
// An image already in memory is drawn at the target size, never at full size
var drawn: [(Int, Int)] = []
let fromMemory = SharedImageEncoder.jpeg(width: 4032, height: 3024) { w, h in
    drawn.append((w, h)); return makeImage(width: w, height: h)
}
check(fromMemory.map(ShareStore.isImportableJPEG) == true && drawn.first.map { $0 == (1568, 1176) } == true,
      "in-memory image drawn at 1568 on the long edge (\(drawn))")

// The payload for five text screenshots, handed to the page as base64
func textScreenshot(seed: Int) -> CGImage {
    let width = 1179, height = 2556
    let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let font = CTFontCreateWithName("Helvetica" as CFString, 42, nil)
    let words = ["2 cups flour", "1 tsp salt", "Whisk the eggs", "and sugar until", "pale, then fold", "in the butter.", "Bake 25 min at", "180°C until golden."]
    var y = height - 120
    var line = seed
    while y > 80 {
        let text = (0..<3).map { words[($0 + line) % words.count] }.joined(separator: " · ")
        let attributed = NSAttributedString(string: text, attributes: [kCTFontAttributeName as NSAttributedString.Key: font])
        ctx.textPosition = CGPoint(x: 60, y: y)
        CTLineDraw(CTLineCreateWithAttributedString(attributed), ctx)
        y -= 64; line += 1
    }
    return ctx.makeImage()!
}
let payload = (0..<5).compactMap { SharedImageEncoder.jpeg(fromData: encode(textScreenshot(seed: $0), type: .png)) }
let base64Bytes = payload.reduce(0) { $0 + $1.base64EncodedString().utf8.count }
print("info five text screenshots: \(payload.map { $0.count / 1024 }) KB each, \(base64Bytes / 1024) KB as base64")
check(payload.count == 5 && base64Bytes < 4 * 1024 * 1024, "five text screenshots stay under 4 MB of base64")

// Which kind a share imports
let pageLink = URL(string: "https://example.com/recipes/chickpea-lunch")!
let imageLink = URL(string: "https://cdn.example.com/photos/IMG_0001.JPG?w=1200")!
check(!SharePick.prefersImages(attachedLink: pageLink, imageCount: 1), "pick: a page URL with an image imports the URL")
check(SharePick.prefersImages(attachedLink: imageLink, imageCount: 1), "pick: an image's own URL with the image imports the image")
check(SharePick.prefersImages(attachedLink: nil, imageCount: 3), "pick: images alone import")
check(!SharePick.prefersImages(attachedLink: imageLink, imageCount: 0), "pick: an image URL with no image imports the URL")
check(!SharePick.prefersImages(attachedLink: nil, imageCount: 0), "pick: nothing picks no images")
check(SharePick.looksLikeImageFile(URL(string: "https://example.com/a/b.webp")!), "pick: .webp is an image file")
check(!SharePick.looksLikeImageFile(URL(string: "https://example.com/recipe.html")!), "pick: .html is not")

// Activation rule, read from the extension's Info.plist
let plistURL = URL(fileURLWithPath: CommandLine.arguments[1])
let plist = NSDictionary(contentsOf: plistURL)!
let rule = ((plist["NSExtension"] as! NSDictionary)["NSExtensionAttributes"] as! NSDictionary)["NSExtensionActivationRule"] as! String
let predicate = NSPredicate(format: rule)
func attachment(_ types: String...) -> NSDictionary { ["registeredTypeIdentifiers": types] }
func share(_ attachments: [NSDictionary], items: Int = 1) -> NSDictionary {
    ["extensionItems": Array(repeating: ["attachments": attachments] as NSDictionary, count: items)]
}
let webURL = attachment("public.url")
let text = attachment("public.plain-text")
let png = attachment("public.png")
let heicPhoto = attachment("public.heic", "public.file-url")
let fileURL = attachment("public.file-url")
func shows(_ s: NSDictionary) -> Bool { predicate.evaluate(with: s) }
check(shows(share([webURL])), "rule: a web URL")
check(shows(share([text])), "rule: text")
check(shows(share([webURL, text])), "rule: a web URL with text")
check(shows(share([png])), "rule: one screenshot")
check(shows(share(Array(repeating: heicPhoto, count: 5))), "rule: five photos")
check(!shows(share(Array(repeating: heicPhoto, count: 6))), "rule: not six photos")
check(shows(share([webURL, png])), "rule: a URL with an image")
check(!shows(share([webURL, webURL])), "rule: not two URLs")
check(!shows(share([fileURL])), "rule: not a bare file")
check(!shows(share([png], items: 2)), "rule: not two items")
check(!shows(share([attachment("com.adobe.pdf")])), "rule: not a PDF")
print(failures == 0 ? "ALL PASSED" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
