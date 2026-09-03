# Favicon

This directory has the icons used for android devices. In some cases, we cannot
reliably detect light/dark mode preference. Hence these icons should not have a
transparent background. These icons are referenced in the `site.webmanifest`
file.

The icons used by modern browsers and Apple devices are in `app/assets/favicons`
as they can be imported with a fingerprint to bust the browser cache.

`maskable-icon-512x512.png` is a separate full-bleed Android icon whose recipe
card stays inside the platform mask-safe area. Generate it with the other raster
icons by running `bun other/generate-favicons.mjs` from the repository root.

Note, there's also a `favicon.ico` in the root of `/public` which some older
browsers will request automatically. This is a fallback for those browsers.
