import WebKit

/// When the shell started and when it started the first load, for the page
/// to measure the shell's share of a cold start (#346, 5.2). The page reads
/// them from `window.__qmShell`.
enum LaunchTiming {
    /// Epoch milliseconds, the unit of `Date.now()` in the page.
    static func now() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    /// A main-frame, document-start script defining `window.__qmShell`.
    static func script(initAt: Double, loadAt: Double) -> WKUserScript {
        let source = "window.__qmShell = { initAt: \(Int64(initAt.rounded())), loadAt: \(Int64(loadAt.rounded())) };"
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
}
