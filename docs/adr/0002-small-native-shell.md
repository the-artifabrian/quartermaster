---
status: accepted
date: 2026-10-04
---

# Ship the iOS app as a small native shell around the Web app

The Web app is server-rendered, so the iOS app cannot carry the UI in its
binary. It has to load `https://quartermaster.app` in a `WKWebView`. Everything
that shell needs is a thin layer over system frameworks: a web view with
App-Bound Domains so the service worker runs, a navigation policy that keeps the
site in the app and sends other hosts to Safari, an offline view, Associated
Domains for passkeys and universal links, and a Share Extension. That is a few
hundred lines of Swift in `ios/`, and the work that takes time (signing,
entitlements, the extension target, App Store Connect) is the same whichever
tool produces the web view. So we write the shell ourselves.

## Considered options

- **Capacitor.** Actively maintained, but its supported mode bundles the web
  build into the app. Loading a remote URL is a live-reload convenience that its
  documentation marks "not intended for use in production". Its value is the
  JavaScript-to-native bridge, and nothing in the Web app calls one. If the
  shell ever needs several native bridges (haptics, keyboard insets, status bar
  control), Capacitor becomes the better base.
- **PWABuilder iOS.** Generates exactly this wrapper from the web manifest, but
  the project is archived (last change June 2025). Its template,
  `khmyznikov/ios-pwa-wrap`, is useful reference code for the launch screen and
  status bar, and brings CocoaPods, Firebase push, and in-app purchase code
  along with it.
- **Hotwire Native.** Built for server-rendered apps, but it drives native
  navigation from Turbo link visits. The Web app routes with React Router and
  does not load Turbo.
- **Commercial wrappers** (for example Median). Maintained and built for this,
  at a yearly cost and as a closed dependency for a two-person product.
- **Bundling the web build, or a React Native rewrite.** Either a client-side
  rewrite of the server-rendered app or a second UI to keep in step.

## Consequences

- The server identifies the iOS app by a user-agent token and hides what the app
  must not show: Pro purchasing (ADR 0001) and Google sign-in.
- Google sign-in is unavailable in the app, since Google refuses OAuth in
  embedded web views. Password and passkey login remain.
- Android later can use a Trusted Web Activity, which Play accepts for PWAs
  without wrapper code.
