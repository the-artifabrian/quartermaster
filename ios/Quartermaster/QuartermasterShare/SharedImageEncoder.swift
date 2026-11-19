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

    /// What became of one image.
    enum Outcome: Equatable {
        case jpeg(Data)
        /// Too big to decode within the extension's memory, or to fit the
        /// budget even at the smallest size.
        case tooLarge
        /// Not an image ImageIO can read.
        case unreadable

        var data: Data? {
            if case .jpeg(let data) = self { return data }
            return nil
        }
    }

    /// The image a multi-image file shows (HEIC can hold several), its size
    /// read from the header without decoding it.
    static func encode(_ source: CGImageSource) -> Outcome {
        guard CGImageSourceGetCount(source) > 0 else { return .unreadable }
        let index = CGImageSourceGetPrimaryImageIndex(source)
        guard
            let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int
        else { return .unreadable }
        guard fits(width: width, height: height, type: CGImageSourceGetType(source) as String?) else {
            return .tooLarge
        }
        for step in shrinkSteps {
            let edge = max(1, Int((Double(maxEdge) * step).rounded()))
            let encoded: Data? = autoreleasepool {
                // Decoded straight to `edge` (JPEG and HEIC at a reduced
                // scale), never at full size, and not kept once encoded.
                let options: [CFString: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceShouldCacheImmediately: true,
                    kCGImageSourceThumbnailMaxPixelSize: edge,
                ]
                guard let image = CGImageSourceCreateThumbnailAtIndex(source, index, options as CFDictionary) else {
                    return nil
                }
                return encode(image)
            }
            guard let encoded else { return .unreadable }
            if encoded.count <= byteBudget { return .jpeg(encoded) }
        }
        return .tooLarge
    }

    static func encode(fileAt url: URL) -> Outcome {
        guard let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize else { return .unreadable }
        guard size <= maxSourceBytes else { return .tooLarge }
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        return CGImageSourceCreateWithURL(url as CFURL, options).map(encode) ?? .unreadable
    }

    static func encode(data: Data) -> Outcome {
        guard data.count <= maxSourceBytes else { return .tooLarge }
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        return CGImageSourceCreateWithData(data as CFData, options).map(encode) ?? .unreadable
    }

    /// An image already in memory (a UIImage from the provider): `draw`
    /// renders it upright at the size given, so it is never encoded at full
    /// size.
    static func encode(width: Int, height: Int, draw: (_ width: Int, _ height: Int) -> CGImage?) -> Outcome {
        guard width > 0, height > 0 else { return .unreadable }
        let longest = Double(max(width, height))
        for step in shrinkSteps {
            let scale = min(1, Double(maxEdge) * step / longest)
            let targetWidth = max(1, Int((Double(width) * scale).rounded()))
            let targetHeight = max(1, Int((Double(height) * scale).rounded()))
            let encoded: Data? = autoreleasepool {
                draw(targetWidth, targetHeight).flatMap(encode)
            }
            guard let encoded else { return .unreadable }
            if encoded.count <= byteBudget { return .jpeg(encoded) }
        }
        return .tooLarge
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
