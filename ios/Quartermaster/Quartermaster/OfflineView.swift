import SwiftUI

final class OfflineModel: ObservableObject {
    @Published var isRetrying = false
}

/// Shown when a page fails to load and the service worker has nothing cached
/// for it, most often a first launch without a connection.
struct OfflineView: View {
    @ObservedObject var model: OfflineModel
    let retry: () -> Void

    var body: some View {
        ZStack {
            Color("LaunchBackground").ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 36))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)
                Text("Can’t reach Quartermaster")
                    .font(.system(.title2, design: .serif))
                Text("Check your connection, then try again.")
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
