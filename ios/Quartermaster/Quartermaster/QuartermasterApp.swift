import SwiftUI

@main
struct QuartermasterApp: App {
    private let config = ShellConfig.load()

    var body: some Scene {
        WindowGroup {
            // The web view handles the keyboard and safe areas itself, the way
            // Safari does, so SwiftUI must not resize it.
            ShellView(config: config)
                .ignoresSafeArea()
                .background(Color("LaunchBackground"))
        }
    }
}
