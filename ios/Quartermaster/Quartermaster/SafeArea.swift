import Foundation
import UIKit
import WebKit

/// The screen's insets, handed to the page before its first paint.
///
/// The page pads its header with `env(safe-area-inset-top)` and its tab bar
/// with the bottom inset, but WebKit reports both as 0 until its first layout
/// has landed, so a cold start paints the page under the status bar and
/// shifts it into place a frame later. The shell sets
/// `--qm-shell-safe-top` and `--qm-shell-safe-bottom` on `<html>` at document
/// start instead, and the page's stylesheet takes the larger of those and
/// `env()`. The values come from the window, which knows nothing of the
/// keyboard; the last ones seen are kept for the next launch, when the first
/// document starts before the view has a window.
enum ShellSafeArea {
    static let defaultsKey = "QMSafeAreaInsets"

    struct Insets: Equatable {
        var top: Double
        var bottom: Double

        init(top: Double, bottom: Double) {
            self.top = max(0, top)
            self.bottom = max(0, bottom)
        }

        init(_ insets: UIEdgeInsets) {
            self.init(top: insets.top, bottom: insets.bottom)
        }
    }

    static func stored(in defaults: UserDefaults = .standard) -> Insets? {
        guard let values = defaults.array(forKey: defaultsKey) as? [Double], values.count == 2 else { return nil }
        return Insets(top: values[0], bottom: values[1])
    }

    static func store(_ insets: Insets, in defaults: UserDefaults = .standard) {
        defaults.set([insets.top, insets.bottom], forKey: defaultsKey)
    }

    /// A main-frame, document-start script. WebKit runs it once the document
    /// element exists and before any content loads, which is before the
    /// first style resolution.
    static func script(_ insets: Insets) -> WKUserScript {
        WKUserScript(source: source(insets), injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /// The same assignment for a document that is already up.
    static func source(_ insets: Insets) -> String {
        let top = Int(insets.top.rounded())
        let bottom = Int(insets.bottom.rounded())
        return "document.documentElement.style.setProperty('--qm-shell-safe-top','\(top)px');"
            + "document.documentElement.style.setProperty('--qm-shell-safe-bottom','\(bottom)px');"
    }
}
