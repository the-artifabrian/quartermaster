# iOS app

A small Swift shell whose `WKWebView` loads https://useqm.app. Why a shell of
our own: [ADR 0002](../docs/adr/0002-small-native-shell.md). The plan is in
issue #325 and its phases #326 to #329.

`Quartermaster/Quartermaster/` and `Quartermaster/QuartermasterShare/` are Xcode
buildable folders: any file added there joins the app or the Share Extension
target without touching the project file.

| File                                           | Role                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `QuartermasterApp.swift`                       | App entry, one SwiftUI scene, incoming links                               |
| `ShellViewController.swift`                    | Web view, navigation and UI delegates, offline view hosting                |
| `ShellConfig.swift`                            | Base URL, start path, user agent token, app-bound check, back swipe        |
| `LinkPolicy.swift`                             | Where a URL opens: web view, Safari sheet, or iOS                          |
| `IncomingURL.swift`                            | Which page an incoming link opens                                          |
| `OfflineView.swift`                            | Native offline view with Retry                                             |
| `Info.plist`                                   | App-bound domains, base URL, URL scheme, launch screen, permission strings |
| `QuartermasterShare/ShareViewController.swift` | Share Extension: finds the shared link, opens the app                      |
| `QuartermasterShare/Info.plist`                | Share Extension activation rule                                            |

## Open and run

1. Open `ios/Quartermaster/Quartermaster.xcodeproj` in Xcode 16 or later.
2. For a device: Signing & Capabilities, pick your team. The project ships with
   no team set, and the Associated Domains entitlement in
   `Quartermaster/Quartermaster.entitlements` needs the paid Developer Program:
   a Personal Team cannot sign it, so a free Apple ID builds only for the
   simulator.
3. Choose the Quartermaster scheme and an iPhone simulator or device, then Run.

From the command line (prefix with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` while `xcode-select`
points at the Command Line Tools):

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
App-bound limits, and with them the service worker, only apply when the host is
listed in `WKAppBoundDomains`, so a local server runs without them. Plain HTTP
is allowed for local hosts only (`NSAllowsLocalNetworking`).

Debug builds also take `-QMSessionCookie <value>`, the site's `en_session`
cookie from a browser login, set before the first load. A screenshot run starts
logged in without typing into the simulator. The cookie storage drops cookies
for hosts without a dot, so this works with the real site, not with `localhost`
or `127.0.0.1`:

```sh
xcrun simctl launch booted app.useqm.ios -QMSessionCookie "$EN_SESSION" -QMStartPath /recipes
```

`-QMStartPath </path>` (Debug only) opens that page instead of `/plan`.

## Incoming links

The app registers the `quartermaster` URL scheme. It opens one URL:

```
quartermaster://import?url=<percent-encoded http(s) URL>
```

which loads `<base URL>/recipes/import?url=<same URL>`, so the import page
starts fetching. Anything else on the scheme, or a `url` that is not http or
https, is ignored. Universal links on the base URL's host load as they are, once
the `applinks` entitlement is on (1.6 below). `IncomingURL.swift` holds the
rules.

A link that launches the app loads instead of the start page, not after it: the
start page waits until the app is active, which costs a normal launch under 100
ms.

To try it in the Simulator (iOS asks "Open in Quartermaster?" first, so tap
Open):

```sh
xcrun simctl openurl booted 'quartermaster://import?url=https%3A%2F%2Fexample.com%2Frecipe'
```

Run it with the app open and again after
`xcrun simctl terminate booted app.useqm.ios` for a cold start; both should land
on the import page. `quartermaster://something-else` and
`quartermaster://import?url=javascript:alert(1)` should leave the app where it
was.

## Back swipe

`allowsBackForwardNavigationGestures` is on, behind
`ShellConfig.allowsBackSwipe`. WebKit slides between snapshots of whole
documents, and the app is a single document with client-side navigation, so the
page shown under the swipe can be stale or blank. To be judged on a phone; set
the constant to false to drop it. Link previews on long-press are off
(`allowsLinkPreview = false`).

## Share Extension

`QuartermasterShare` (`app.useqm.ios.share`) appears in the share sheet for one
shared item holding a web URL, or text with a URL in it. It takes the first
http(s) link (a URL attachment first, then a link found in the text), opens
`quartermaster://import?url=…` and closes. If there is no link it cancels. No
network and no web view in the extension; the app does the fetch.

Extensions have no supported way to open their app, so it calls
`open(_:options:completionHandler:)` on the UIApplication at the end of its
responder chain, as the Capacitor share-target plugins do. If App Review
objects, the fallback (#328) is to write the URL to an App Group container and
show an "Open Quartermaster" button.

Checks by hand (#328, 2.2), on the Simulator and then a device:

1. Safari on a Recipe page, Share, Quartermaster: the app opens on the import
   page with the fetch running.
2. Messages, long-press a message holding a Recipe link, Share, Quartermaster:
   same result.
3. A Recipe site's own share button (Web Share), Quartermaster: same result.
4. A page that is not a Recipe: the import page shows its usual error.
5. Each of the above with the app killed first (cold start) and with it already
   open.
6. Then retire the "Send to Quartermaster" Shortcut (#326, 0.6).

## TestFlight and App Store builds

Every build that reaches a phone goes through TestFlight. The archive and the
upload run from the command line, signed automatically with the team's Apple
Distribution certificate, and use the Apple ID signed in to Xcode (Xcode >
Settings > Accounts).

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -project ios/Quartermaster/Quartermaster.xcodeproj -scheme Quartermaster \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath /tmp/Quartermaster.xcarchive -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=<team id> archive
xcodebuild -exportArchive -archivePath /tmp/Quartermaster.xcarchive \
  -exportOptionsPlist ios/ExportOptions.plist -exportPath /tmp/export \
  -allowProvisioningUpdates
```

`ios/ExportOptions.plist` uploads straight to App Store Connect and lets it pick
the build number (`manageAppVersionAndBuildNumber`), so the project's
`CURRENT_PROJECT_VERSION` can stay at 1. The App Store Connect app record for
`app.useqm.ios` must exist first; the export fails with "App record … not found"
otherwise. Both Info.plists set `ITSAppUsesNonExemptEncryption` to false (HTTPS
only), so no export-compliance question per build.

## App icon

`AppIcon-1024.png` is the recipe card from `other/generate-favicons.mjs`
(`makeAppIcon`) rendered full-bleed at 1024 px with no corner radius and no
alpha, since iOS applies its own mask. Launch colours follow
`app/utils/pwa-launch.ts`: `#f6f1eb` light, `#1a1816` dark.

## Still to do in #327

- **1.6 Associated Domains.** The entitlement is in
  `Quartermaster/Quartermaster.entitlements` (`webcredentials:useqm.app`,
  `applinks:useqm.app`) and the app handles universal links and the
  `quartermaster://` scheme (Incoming links above). What remains is on Apple's
  side: the paid program active (#329, 3.1), the capability on the App ID (the
  first `-allowProvisioningUpdates` build registers it), and the AASA file live
  (#326, 0.5). Until then passkey login in the app fails with `NotAllowedError`
  and links open in Safari.
- **1.7 Layout checks** on a notched iPhone: status bar and safe areas, keyboard
  on Shopping (FAB, voice button, add row) and the Recipe form. The web view
  fills the screen and lets WebKit inset content, like Safari; the site has no
  `viewport-fit=cover` yet (#326, 0.7).
- **1.8 Function checks** on the device: logins, session after force-quit and
  after a day, voice input, camera and library upload, URL import, airplane mode
  after first load, Share Recipe logged out, links from Mail and Messages.
