# iOS app

A small Swift shell whose `WKWebView` loads https://useqm.app. Why a shell of
our own: [ADR 0002](../docs/adr/0002-small-native-shell.md). The plan is in
issue #325 and its phases #326 to #329.

`Quartermaster/Quartermaster/` is an Xcode buildable folder: any file added
there joins the app target without touching the project file.

| File | Role |
| --- | --- |
| `QuartermasterApp.swift` | App entry, one SwiftUI scene |
| `ShellViewController.swift` | Web view, navigation and UI delegates, offline view hosting |
| `ShellConfig.swift` | Base URL, start path, user agent token, app-bound check |
| `LinkPolicy.swift` | Where a URL opens: web view, Safari sheet, or iOS |
| `OfflineView.swift` | Native offline view with Retry |
| `Info.plist` | App-bound domains, base URL, launch screen, permission strings |

## Open and run

1. Open `ios/Quartermaster/Quartermaster.xcodeproj` in Xcode 16 or later.
2. For a device: Signing & Capabilities, pick your team (a free Apple ID works
   until 1.6). The project ships with no team set.
3. Choose the Quartermaster scheme and an iPhone simulator or device, then Run.

From the command line (prefix with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` while
`xcode-select` points at the Command Line Tools):

```sh
cd ios/Quartermaster
xcodebuild -scheme Quartermaster -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build build
xcrun simctl boot "iPhone 18 Pro"
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Quartermaster.app
xcrun simctl launch booted app.useqm.ios
```

## Pointing at another server

The base URL is the `QM_BASE_URL` build setting (`https://useqm.app`). Debug
builds also take a launch argument, so no rebuild is needed:

```sh
xcrun simctl launch booted app.useqm.ios -QMBaseURL http://localhost:3000
xcrun simctl launch booted app.useqm.ios -QMBaseURL https://nowhere.invalid  # offline view
```

The scheme has the localhost argument ready under Run > Arguments, unchecked.
App-bound limits, and with them the service worker, only apply when the host
is listed in `WKAppBoundDomains`, so a local server runs without them. Plain
HTTP is allowed for local hosts only (`NSAllowsLocalNetworking`).

## App icon

`AppIcon-1024.png` is the recipe card from `other/generate-favicons.mjs`
(`makeAppIcon`) rendered full-bleed at 1024 px with no corner radius and no
alpha, since iOS applies its own mask. Launch colours follow
`app/utils/pwa-launch.ts`: `#f6f1eb` light, `#1a1816` dark.

## Still to do in #327

- **1.6 Associated Domains.** Needs the paid program (#329, 3.1) and the AASA
  file live (#326, 0.5). Add the Associated Domains capability with
  `webcredentials:useqm.app` and `applinks:useqm.app`, then handle incoming
  universal links and `quartermaster://import?url=…` by loading the matching
  `https://useqm.app` route in the web view. Until then passkey login fails
  with `NotAllowedError`.
- **1.7 Layout checks** on a notched iPhone: status bar and safe areas,
  keyboard on Shopping (FAB, voice button, add row) and the Recipe form. The
  web view fills the screen and lets WebKit inset content, like Safari; the
  site has no `viewport-fit=cover` yet (#326, 0.7).
- **1.8 Function checks** on the device: logins, session after force-quit and
  after a day, voice input, camera and library upload, URL import, airplane
  mode after first load, Share Recipe logged out, links from Mail and
  Messages.
