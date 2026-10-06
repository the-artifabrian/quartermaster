import UIKit

/// The Home Screen quick actions. Their titles and icons are the
/// `UIApplicationShortcutItems` in Info.plist; the types there must match.
enum QuickAction: String {
    case shopping = "app.useqm.ios.shopping"
    case importRecipe = "app.useqm.ios.import-recipe"

    var path: String {
        switch self {
        case .shopping: return "/shopping"
        case .importRecipe: return IncomingURL.importPath
        }
    }

    static func page(for item: UIApplicationShortcutItem, baseURL: URL) -> URL? {
        QuickAction(rawValue: item.type).map { baseURL.appending(path: $0.path) }
    }

    /// Hands the action's page to the shell, which loads it now or, on a cold
    /// start, instead of the start page.
    @discardableResult
    static func perform(_ item: UIApplicationShortcutItem) -> Bool {
        guard let page = page(for: item, baseURL: Shell.config.baseURL) else { return false }
        Shell.inbox.deliver(page)
        return true
    }
}

/// SwiftUI's `App` has no hook for quick actions, so the app installs a scene
/// delegate for them.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting session: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        // A quick action that launched the app arrives here, before the shell
        // has loaded, so the inbox holds it for the first load. UIKit can skip
        // this call when it reconnects a saved session, so the scene delegate
        // reads it too; a second delivery only overwrites the same page.
        if let item = options.shortcutItem {
            QuickAction.perform(item)
        }
        let configuration = UISceneConfiguration(name: nil, sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

/// Quick actions that launch the app into a reconnected scene, and those that
/// arrive while it is running.
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        if let item = connectionOptions.shortcutItem {
            QuickAction.perform(item)
        }
    }

    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(QuickAction.perform(shortcutItem))
    }
}
