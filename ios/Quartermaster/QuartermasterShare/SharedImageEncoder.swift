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

    /// The largest image file or data read at all.
    static let maxSourceBytes = 64 * 1024 * 1024
    /// JPEG and HEIC decode at a fraction of their size, so a 48 MP photo is
    /// cheap; other formats (PNG, RAW, TIFF) decode in full before shrinking,
    /// about 4 bytes a pixel, which a Share Extension's memory cannot spare
    /// for more than this.
    static let maxSubsampledPixels = 64_000_000
    static let maxFullDecodePixels = 16_000_000
    static let subsampledTypes: Set<String> = ["public.jpeg", "public.heic", "public.heif"]

    /// Whether an image of this size and type can be decoded within the
    /// extension's memory.
    static func fits(width: Int, height: Int, type: String?) -> Bool {
        guard width > 0, height > 0 else { return false }
        let pixels = width.multipliedReportingOverflow(by: height)
        guard !pixels.overflow else { return false }
        let limit = type.map(subsampledTypes.contains) == true ? maxSubsampledPixels : maxFullDecodePixels
        return pixels.partialValue <= limit
    }

    /// Reads the size from the file's header, without decoding it.
    static func fits(_ source: CGImageSource) -> Bool {
        guard
            CGImageSourceGetCount(source) > 0,
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int
        else { return false }
        return fits(width: width, height: height, type: CGImageSourceGetType(source) as String?)
    }

    /// A JPEG of the image at `source`'s first frame, upright, at most
    /// `maxEdge` on its longest side and `byteBudget` in size, or nil when it
    /// cannot be decoded or will not fit.
    static func jpeg(from source: CGImageSource) -> Data? {
        guard fits(source) else { return nil }
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
        guard
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
            size <= maxSourceBytes
        else { return nil }
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        return CGImageSourceCreateWithURL(url as CFURL, options).flatMap(jpeg(from:))
    }

    static func jpeg(fromData data: Data) -> Data? {
        guard data.count <= maxSourceBytes else { return nil }
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        return CGImageSourceCreateWithData(data as CFData, options).flatMap(jpeg(from:))
    }

    /// Smallest first try that fits the budget, for an image already in
    /// memory (a UIImage from the provider): `draw` renders it at the size
    /// given, upright.
    static func jpeg(width: Int, height: Int, draw: (_ width: Int, _ height: Int) -> CGImage?) -> Data? {
        guard width > 0, height > 0 else { return nil }
        let longest = Double(max(width, height))
        for step in shrinkSteps {
            let scale = min(1, Double(maxEdge) * step / longest)
            let targetWidth = max(1, Int((Double(width) * scale).rounded()))
            let targetHeight = max(1, Int((Double(height) * scale).rounded()))
            let encoded: Data? = autoreleasepool {
                draw(targetWidth, targetHeight).flatMap(encode)
            }
            guard let encoded else { return nil }
            if encoded.count <= byteBudget { return encoded }
        }
        return nil
    }

    static func encode(_ image: CGImage) -> Data? {
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
