import Foundation

/// What one share imports when it carries more than one kind of thing.
///
/// A web URL attachment (Safari's page share, a site's share button) wins
/// over images, since a Recipe page's link imports exactly and needs no AI.
/// Except when the URL is the image itself: sharing an image from Safari can
/// attach the image's own address next to the image, and importing a .jpg
/// link would fail. Then, and whenever there is no URL, images win. A link
/// found only in shared text comes last.
enum SharePick {
    static let imageExtensions: Set<String> = [
        "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff",
    ]

    /// Whether a share with this URL attachment (if any) and this many images
    /// should import the images.
    static func prefersImages(attachedLink: URL?, imageCount: Int) -> Bool {
        guard imageCount > 0 else { return false }
        guard let attachedLink else { return true }
        return looksLikeImageFile(attachedLink)
    }

    /// A URL whose path ends in an image file's extension.
    static func looksLikeImageFile(_ url: URL) -> Bool {
        imageExtensions.contains(url.pathExtension.lowercased())
    }
}
