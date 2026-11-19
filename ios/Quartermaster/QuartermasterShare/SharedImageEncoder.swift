import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Turns a shared image (a PNG screenshot, a HEIC photo, a JPEG) into the
/// JPEG the Recipe image import takes, small enough to hand to the page.
///
/// ImageIO decodes straight to the target size from the file, so a 48 MP
/// photo never sits in memory at full size: a Share Extension has a tight
/// memory limit. The longest edge matches the server's own resize
/// (`IMAGE_MAX_DIMENSION` in `recipe-extract-llm.server.ts`), which keeps
/// small recipe type legible, and the quality matches its JPEG quality.
enum SharedImageEncoder {
    static let maxEdge = 1568
    static let quality = 0.88
    /// Well under the import's 5 MB per image, so five screenshots stay a
    /// few megabytes on their way into the page.
    static let byteBudget = 2 * 1024 * 1024
    /// Each try shrinks the image further until it fits the budget.
    static let shrinkSteps: [Double] = [1, 0.75, 0.55, 0.4]

    /// A JPEG of the image at `source`'s first frame, upright, at most
    /// `maxEdge` on its longest side and `byteBudget` in size, or nil when it
    /// cannot be decoded or will not fit.
    static func jpeg(from source: CGImageSource) -> Data? {
        for step in shrinkSteps {
            let edge = max(1, Int((Double(maxEdge) * step).rounded()))
            let encoded: Data? = autoreleasepool {
                let options: [CFString: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceShouldCacheImmediately: true,
                    kCGImageSourceThumbnailMaxPixelSize: edge,
                ]
                guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                    return nil
                }
                return encode(image)
            }
            guard let encoded else { return nil }
            if encoded.count <= byteBudget { return encoded }
        }
        return nil
    }

    static func jpeg(fromFile url: URL) -> Data? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        return CGImageSourceCreateWithURL(url as CFURL, options).flatMap(jpeg(from:))
    }

    static func jpeg(fromData data: Data) -> Data? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        return CGImageSourceCreateWithData(data as CFData, options).flatMap(jpeg(from:))
    }

    private static func encode(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        let properties = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        CGImageDestinationAddImage(destination, image, properties)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }
}
