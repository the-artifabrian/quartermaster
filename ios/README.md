# iOS app

A small Swift shell whose `WKWebView` loads https://useqm.app. Why a shell of
our own: [ADR 0002](../docs/adr/0002-small-native-shell.md). The app is
distributed through TestFlight only (TestFlight builds below).

`Quartermaster/Quartermaster/` and `Quartermaster/QuartermasterShare/` are Xcode
buildable folders: any file added there joins the app or the Share Extension
target without touching the project file. Files in `Quartermaster/Shared/` join
both.

| File                                           | Role                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `QuartermasterApp.swift`                       | App entry, one SwiftUI scene, incoming links, page inbox                                     |
| `ShellViewController.swift`                    | Web view, navigation and UI delegates, offline view hosting, appearance                      |
| `ShellBridge.swift`                            | Page-to-shell messages, pull to refresh, launch timing (Shell bridge)                        |
| `SafeArea.swift`                               | The screen's insets, handed to the page before its first paint                               |
| `ShellConfig.swift`                            | Base URL, start path, user agent token, app-bound check, back swipe                          |
| `LinkPolicy.swift`                             | Where a URL opens: web view, Safari sheet, or iOS; what is an app page                       |
| `IncomingURL.swift`                            | Which page an incoming link opens                                                            |
| `ShareIntent.swift`                            | A share waiting for its import page, and the scripts that hand it over                       |
| `Shared/ShareStore.swift`                      | The App Group handoff from the Share Extension: nonces, single use, expiry, screenshot files |
| `ResumeState.swift`                            | Which page a cold start reopens                                                              |
| `QuickActions.swift`                           | Home Screen quick actions, app and scene delegates                                           |
| `OfflineView.swift`                            | Native offline view with Retry                                                               |
| `Info.plist`                                   | App-bound domains, base URL, URL scheme, quick actions, launch screen, permission strings    |
| `QuartermasterShare/ShareViewController.swift` | Share Extension: picks the shared link or screenshots, hands them to the app                 |
| `QuartermasterShare/SharedImageEncoder.swift`  | Share Extension: re-encodes shared images as the JPEG the import takes                       |
| `QuartermasterShare/SharePick.swift`           | Share Extension: whether a share imports its link or its images                              |
| `QuartermasterShare/Info.plist`                | Share Extension activation rule                                                              |
| `*.entitlements`                               | Associated Domains (app), and the `group.app.useqm.ios` App Group (both targets)             |

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

The app registers the `quartermaster` URL scheme. It opens two URLs:

```
quartermaster://import?share=<nonce>
quartermaster://import?url=<percent-encoded http(s) URL>
```

`share` is the app's own Share Extension (Share import, below): the import page
opens and imports the link at once. `url` loads
`<base URL>/recipes/import?url=<same URL>`, which waits for a tap on Import.
Older Share Extension builds open it, and so can any app, or a site after
Safari's prompt, so it never imports by itself. Anything else on the scheme, or
a `url` that is not http or https, is ignored. Universal links on the base URL's
host load as they are and never import by themselves either. `IncomingURL.swift`
holds the rules.

The first page starts loading as soon as the shell's view loads. A link that
launched the app has usually reached the shell by then and loads instead of the
start page; one that arrives later replaces the start page mid-flight.

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

## Shell bridge

The page and the shell talk through four `WKScriptMessageHandler`s, two
CustomEvents and two injected scripts. `ShellBridge.swift` holds the shell's
side. The shell only listens to the main frame of the app's own host. Each
message body is a string, and anything outside the values below is ignored.

| Page to shell                                      | Body                                                          | Shell does                                                              |
| -------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `webkit.messageHandlers.haptic.postMessage(body)`  | `selection`, `light`, `medium`, `success`, `warning`, `error` | Plays it: selection, light or medium impact, or a notification feedback |
| `webkit.messageHandlers.theme.postMessage(body)`   | `light`, `dark`                                               | Status bar for that theme; post on load and on every theme change       |
| `webkit.messageHandlers.refresh.postMessage(body)` | `done`                                                        | Stops the pull-to-refresh spinner                                       |
| `webkit.messageHandlers.launch.postMessage(body)`  | `painted`                                                     | Lifts the launch screen; post once a frame of the page is up            |

- **Pull to refresh.** Pulling the page down dispatches
  `window.dispatchEvent(new CustomEvent('qm:refresh'))`. The page revalidates
  its data and posts `done` to `refresh`; the spinner stops then, or after 5 s
  if nothing answers. While the offline view is up there is no pull, since that
  view has its own Retry.
- **Share import.** For a share through the app's own Share Extension the shell
  hands it to the import page (Share import, below): it sets
  `window.__qmShareImport` to `{ url }` for a link or `{ files }` (an array of
  `File`) for screenshots, each with `for` (the page's path and query when it
  was handed over) and `expiresAt` (epoch ms, 60 s on), then dispatches
  `qm:share-import`. The page reads the global when it mounts and on the event,
  and clears it.
- **Launch timing.** The first document after launch gets a document-start
  script, main frame only: `window.__qmShell = { initAt, loadAt }`, both epoch
  milliseconds (`Date.now()` units). `initAt` is when the app started and
  `loadAt` when the shell started the first load. The script is removed once
  that document finishes loading, or once the first load fails (a load replaced
  by an incoming link keeps it), so a later reload or Retry does not see it.
  When iOS prewarmed the app, `initAt` would predate the tap by an unknown time,
  so there is no `__qmShell` at all. The page adds to these
  `performance.timeOrigin - loadAt` (WebKit's processes starting and the
  navigation being set up) and the document's `responseStart` (the service
  worker booting and the document round trip).
- **Safe area.** The page pads its header and tab bar with
  `env(safe-area-inset-top)` and `-bottom`, which WebKit reports as 0 until its
  first layout has landed: a cold start painted the page under the status bar
  and shifted it down a frame later. So the shell sets `--qm-shell-safe-top` and
  `--qm-shell-safe-bottom` on `<html>` in a document-start script
  (`SafeArea.swift`), and `tailwind.css` takes the larger of those and `env()`
  as `--safe-top` and `--safe-bottom`. The values are the window's safe-area
  insets, which leave out the keyboard; they are stored in UserDefaults
  (`QMSafeAreaInsets`) for the next launch, whose first document starts before
  the view has a window, and set again on the live page whenever they change.
- **Launch screen.** `Info.plist`'s `UILaunchScreen` is the launch colour
  (`LaunchBackground`, light and dark) with the logo (`LaunchLogo`, the favicon
  at 72pt) in the middle. iOS takes it down as soon as the app has a frame, most
  of a second before the page has one, so the shell draws the same screen over
  the web view at launch and fades it out (200 ms) when the page posts
  `painted`, or 250 ms after the first document finishes loading, or after 4 s,
  whichever comes first; a failed load or a crashed web process drops it at
  once. A link that replaces the first load keeps it, since that page has not
  painted either.
- **Theme and appearance.** Until the page posts a theme the status bar follows
  the system. The scene applies the page's theme with `.preferredColorScheme`,
  which would also reach the page as `prefers-color-scheme` and freeze a page on
  the System theme. So the web view keeps the system's appearance, and catches
  up with a system change the next time the app becomes active (on iOS 17 and
  later at once while the page has no theme override). The canvas behind the
  page and the offline view use the page's theme.
- **User agent.** WebKit's user agent ends with `QuartermasterShell/1`, which
  the server checks to hide Pro.

## Back swipe

`allowsBackForwardNavigationGestures` is on, behind
`ShellConfig.allowsBackSwipe`. WebKit slides between snapshots of whole
documents, and the app is a single document with client-side navigation, so the
page shown under the swipe can be stale or blank. Setting the constant to false
turns the swipe off. Every pushed page has a Back button in its nav bar
(`docs/DESIGN_SYSTEM.md`, Navigation), so the swipe is not the only way back.
Link previews on long-press are off (`allowsLinkPreview = false`).

## Resume where you left off

When the app goes to the background the shell saves the current page's URL
(`QMResumePage` in UserDefaults). A cold start loads it instead of `/plan` when
it is still an app page: http or https on the base URL's host (`LinkPolicy`),
and not under `/login`, `/logout`, `/signup`, `/verify`, `/onboarding`,
`/forgot-password`, `/reset-password`, `/auth`, `/webauthn` or
`/household/join`. Leaving from one of those clears the saved page. A link or
quick action that opened the app wins over the saved page. With the offline view
up, or before any page has loaded, the saved page is left as it was.

## Home Screen quick actions

Long-press the app icon for **Shopping** (`/shopping`) and **Import recipe**
(`/recipes/import`). They are static `UIApplicationShortcutItems` in Info.plist;
`QuickActions.swift` maps their types to pages. SwiftUI's `App` has no hook for
them, so an `AppDelegate` (through `UIApplicationDelegateAdaptor`) installs a
`SceneDelegate`. A cold start from a quick action hands the page to the inbox
before the shell loads, so it opens that page, not `/plan` and not the saved
one. With the app running, the scene delegate hands it over the same way.

## Share Extension

`QuartermasterShare` (`app.useqm.ios.share`) appears in the share sheet for one
shared item holding a web URL, text, or up to five images (the import's limit).
One share carries one thing (`SharePick.swift`): a web URL attachment (Safari, a
site's share button) wins, then images (Photos, the screenshot editor), then the
first link found in shared text (Messages, Notes). Images win over a URL that is
the image's own address (its path ends in an image extension), which sharing an
image from Safari can attach. A social app that shares a screenshot with a
caption holding a link imports the screenshot, which is what the user picked.
The extension hands the share to the app (Share import, below) and closes; with
nothing usable it cancels. No network and no web view in the extension: the app
fetches the link, and the page's image import reads the screenshots.

Screenshots are re-encoded in the extension with ImageIO
(`SharedImageEncoder.swift`), one at a time: JPEG at 0.88, at most 1568 px on
the long edge (the server's own resize in `recipe-extract-llm.server.ts`), and
under 2 MB each, shrinking further if needed. PNG screenshots and HEIC photos
come out as JPEG, which the import takes. Five text screenshots come to about
370 KB each, 2.4 MB as base64 on their way into the page.

- **Memory.** Each image is decoded with `CGImageSourceCreateThumbnailAtIndex`
  straight to its target size (`kCGImageSourceThumbnailMaxPixelSize`), never at
  full size, and only the image a multi-image HEIC shows
  (`CGImageSourceGetPrimaryImageIndex`). On a Mac a 48 MP HEIC peaked at about
  25 MB this way. Before decoding, the extension reads the size from the header
  and refuses what it cannot afford: over 64 MB, over 64 MP for JPEG and HEIC
  (decoded at a reduced scale), or over 16 MP for formats decoded in full (PNG,
  RAW), such as a stitched long screenshot. An image the provider already
  decoded (a UIImage) is drawn at the target size, never encoded at full size.
  Decoding runs in the providers' completion handlers, off the main thread.
- **Time.** All of a share's images get 25 seconds together, from when the
  extension starts on them. A file representation still loading then (an iCloud
  photo not on the phone) is cancelled and the share gives up; the extension
  never asks the same provider again, which would restart the download.
- **Failures.** All the images or none: a Recipe from some of the screenshots
  could be missing half its steps. The extension says why and closes: "Couldn’t
  read that image" (not an image it can read), "That image is too large to read"
  (over the limits above), or "Couldn’t get that image" (the deadline; "If it’s
  in iCloud, open it in Photos first"). If the app does not open, it says
  "Couldn’t open Quartermaster" and removes the share it stored.

Extensions have no supported way to open their app, so it calls
`open(_:options:completionHandler:)` on the UIApplication at the end of its
responder chain, as the Capacitor share-target plugins do.

### Share import

Sharing to Quartermaster is a deliberate act, so a share imports at once. A link
shows "Importing from …" and opens the Recipe, or shows the error on the URL tab
with the link filled in. Screenshots show "Reading your screenshots…" and open
the Recipe, or show the error on the image tab with the screenshots still
attached, so trying again is one tap on Extract with AI. Screenshots are read by
the AI extraction, which is Pro; a free account gets "Screenshot import isn’t
available on your account" and nothing is sent.

But anyone can open `/recipes/import?url=…` (a universal link from any site) or
`quartermaster://import?url=…` (any app, or a site after Safari's prompt), and
an import saves, so the page must be able to tell the app's own Share Extension
from everyone else. Nothing a URL carries can do that, so the proof travels
outside the URL:

1. **App Group nonce.** The extension writes the share to the
   `group.app.useqm.ios` App Group container under 128 random bits
   (`SecRandomCopyBytes`) as 32 hex characters: screenshots first, as
   `Shares/<nonce>/1.jpg` … `n.jpg`, then the record `Shares/<nonce>.json` (the
   link, or the number of screenshots, and a timestamp). Then it opens
   `quartermaster://import?share=<nonce>`. Only the app and its extension carry
   the App Group entitlement, so nobody else can write there, and a nonce cannot
   be guessed. Without the container (a build lacking the entitlement), or if
   the write fails, a link opens `quartermaster://import?url=…` instead, which
   waits for a tap, and screenshots cancel.
2. **The app takes the nonce once** (`Shared/ShareStore.swift`). It accepts a
   nonce of exactly 32 lowercase hex characters whose record exists, is under 2
   minutes old (5 seconds of clock skew allowed), and holds either an http(s)
   link with a host or a count of 1 to 5 screenshots. It deletes the record
   before using it, and if the delete fails the share is not used, so a nonce
   works once. Screenshot files are named by their count, never by the record,
   and each must be a JPEG under 5 MB, checked by size before it is read; the
   share's folder goes after the read. Every read and write, and each app
   launch, also prunes stale records, folders without a fresh record, and stray
   files. An expired link opens its import page waiting for a tap; expired
   screenshots, or an unknown, used or malformed nonce, open the plain import
   page.
3. **The shell hands the share to the page.** For a link it loads
   `/recipes/import?url=<link>`, for screenshots the plain `/recipes/import`,
   and keeps a `ShareIntent` (the link or the screenshots, for 5 minutes) in
   memory. Each time a document finishes loading, and each time `webView.url`
   changes while nothing is loading (the page's own navigations, such as the
   redirect after signing in), it checks that the page is that import page on
   the app's host: offering the same link, or offering none for screenshots. If
   so it runs `ShareIntent.linkScript` or `imagesScript` with
   `callAsyncJavaScript` in the page's content world, with what was shared
   passed as arguments (screenshots as base64) rather than written into the
   source. The script checks the page again, sets the global and dispatches the
   event (Shell bridge, above), and returns true. The intent is cleared before
   the script runs and comes back only if the script found another page. Any
   other incoming link or quick action replaces it, so it never reaches a page
   the user did not share into, and a cold start that reopens the import page
   carries none.
4. **The page imports only on a match.** In the shell, the import page reads
   `window.__qmShareImport` at mount and on `qm:share-import`, and deletes it
   whatever it holds. One handed to another page (`for`), or past its
   `expiresAt`, is dropped unread. While a navigation is in flight the page
   waits, and if the import page goes away it takes the share with it, so a
   share handed over just as the user tapped away never imports on a later visit
   or Back. A link is imported only when it equals the page's `?url=` and the
   offer is showing: the offer's own Import form is submitted, the same POST and
   the same duplicate check, so a link already in the Household shows "Already
   in your Recipes" instead. Screenshots (1 to 5 `File`s) are imported only on
   the plain import page: they go onto the image form's file input and that form
   is submitted, the same multipart POST, Pro check, limits and AI extraction as
   picking them by hand. Query string, hash and storage play no part, and
   outside the shell nothing listens.

There is no Xcode test target. `ios/checks/share/main.swift` checks the pure
parts (nonces, single use, expiry, pruning, screenshot files, page matching,
image re-encoding and its limits, which kind a share imports) and evaluates the
activation rule against sample shares; it compiles with those sources and runs
on the Mac, with the command at its top. `tests/e2e/share-import.test.ts` runs
`linkScript` and `imagesScript` as read from `ShareIntent.swift`.

Checks by hand, on the Simulator and then a device:

1. Safari on a Recipe page, Share, Quartermaster: the app opens on the import
   page, imports, and opens the Recipe with no tap. Sharing it again opens on
   "Already in your Recipes".
2. Messages, long-press a message holding a Recipe link, Share, Quartermaster:
   same result.
3. A Recipe site's own share button (Web Share), Quartermaster: same result.
4. A page that is not a Recipe: the import page shows its usual error on the URL
   tab, with the link filled in.
5. A screenshot of a Recipe, from the screenshot editor's share button and from
   Photos, on a Pro account: "Reading your screenshots…", then the Recipe. Then
   three screenshots selected in Photos: one Recipe. Six selected: Quartermaster
   is not offered. A HEIC photo of a cookbook page: imports. A 48 MP HEIF Max
   photo: imports without the extension being killed. A photo only in iCloud:
   "Couldn’t get that image" within about 25 seconds. A long stitched screenshot
   saved as PNG: "That image is too large to read".
6. The same screenshot on a free account: "Screenshot import isn’t available on
   your account", nothing saved, no mention of Pro.
7. A screenshot with no Recipe in it: the error on the image tab, the screenshot
   still attached; airplane mode before sharing, and again by leaving the app
   mid-import: "Couldn’t reach Quartermaster to confirm the import. Check your
   Recipes before you try again.", the screenshot still attached and the image
   tab showing, and Extract with AI works once back online. Same for a link,
   with the link still in the URL field.
8. Each of the above with the app killed first (cold start) and with it already
   open, and once while logged out: after logging in, the import runs.
9. `xcrun simctl openurl booted 'quartermaster://import?url=https%3A%2F%2Fexample.com%2Frecipe'`
   still waits for the tap, and
   `xcrun simctl openurl booted 'quartermaster://import?share=00000000000000000000000000000000'`
   opens the plain import page.

The App Groups capability registers with the App ID on the first archive with
automatic signing (`-allowProvisioningUpdates`).

## TestFlight builds

The app is distributed through TestFlight internal testing; there is no App
Store listing. TestFlight builds expire 90 days after upload, so a fresh upload
from master about every two months keeps the app installable:

```sh
sh ios/upload-testflight.sh
```

Every build that reaches a phone goes through TestFlight. The archive and the
upload run from the command line, signed automatically with the team's Apple
Distribution certificate, and use the Apple ID signed in to Xcode (Xcode >
Settings > Accounts). The script runs these two commands:

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
`app.useqm.ios` exists; the export fails with "App record … not found" if it is
ever removed. Testers are the team's App Store Connect users (internal testing),
which needs no Beta App Review. Both Info.plists set
`ITSAppUsesNonExemptEncryption` to false (HTTPS only), so no export-compliance
question per build.

## App icon

`AppIcon-1024.png` is the recipe card from `other/generate-favicons.mjs`
(`makeAppIcon`) rendered full-bleed at 1024 px with no corner radius and no
alpha, since iOS applies its own mask. Launch colours follow
`app/utils/pwa-launch.ts`: `#f6f1eb` light, `#1a1816` dark.

## Checks on a phone

Run these on a notched iPhone after a shell change, from a TestFlight build:

- **Associated Domains.** The entitlement in
  `Quartermaster/Quartermaster/Quartermaster.entitlements`
  (`webcredentials:useqm.app`, `applinks:useqm.app`) pairs with the AASA file
  the site serves from `app/routes/_seo/apple-app-site-association.ts`. Check
  passkey login in the app, and that `https://useqm.app` links from Mail and
  Messages open it.
- **Layout.** The web view fills the screen. In the shell the site's viewport
  meta adds `viewport-fit=cover` (`app/root.tsx`) and the page pads itself with
  `env(safe-area-inset-*)`. Check the status bar, the tab bar above the home
  indicator, and the keyboard on Shopping (FAB, voice button, add row) and the
  Recipe form.
- **Function.** Logins, session after force-quit and after a day, voice input,
  camera and library upload, URL import, airplane mode after first load, Share
  Recipe logged out, links from Mail and Messages.
- **Cold start.** Open Shopping, go to the Home Screen, force-quit, reopen: the
  logo stays on the launch colour until Shopping fades in, with no blank frame
  between, and Shopping lands without a jump at the status bar or the tab bar.
  Then the same in the other system appearance. Then rotate to landscape: the
  header loses its status-bar padding; rotate back and it returns.
