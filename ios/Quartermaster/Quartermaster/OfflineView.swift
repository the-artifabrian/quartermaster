import SwiftUI

final class OfflineModel: ObservableObject {
    enum Reason {
        /// The device could not reach the server.
        case offline
        /// Anything else: a server or TLS error, or the page crashing twice.
        case failed
    }

    @Published var reason = Reason.offline
    @Published var isRetrying = false
}

/// Covers the screen when there is no page to show: a first launch that could
/// not load and that the service worker had nothing cached for, or a page
/// whose process keeps crashing.
struct OfflineView: View {
    @ObservedObject var model: OfflineModel
    let retry: () -> Void

    var body: some View {
        ZStack {
            Color("LaunchBackground").ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: model.reason == .offline ? "wifi.slash" : "exclamationmark.triangle")
                    .font(.system(size: 36))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)
                Text(model.reason == .offline ? "Can’t reach Quartermaster" : "Quartermaster didn’t load")
                    .font(.system(.title2, design: .serif))
                Text(model.reason == .offline
                    ? "Check your connection, then try again."
                    : "Something went wrong. Try again in a moment.")
                    .foregroundStyle(.secondary)
                Button(action: retry) {
                    ZStack {
                        Text("Retry").opacity(model.isRetrying ? 0 : 1)
                        if model.isRetrying {
                            ProgressView().tint(Color("LaunchBackground"))
                        }
                    }
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color("LaunchBackground"))
                    .frame(minWidth: 120, minHeight: 44)
                    .background(Color.accentColor, in: Capsule())
                }
                .disabled(model.isRetrying)
                .padding(.top, 12)
                .accessibilityLabel(model.isRetrying ? "Retrying" : "Retry")
            }
            .multilineTextAlignment(.center)
            .padding(32)
        }
    }
}
